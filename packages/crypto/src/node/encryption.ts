import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';

interface KeyEntry {
  id: string;
  key: Buffer;
}

function toEntry(base64Key: string): KeyEntry {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes');
  return { id: createHash('sha256').update(key).digest('hex').slice(0, 8), key };
}

/**
 * Authenticated field-level encryption (AES-256-GCM) for secrets at rest
 * (TOTP secrets, WireGuard pre-shared keys). Supports key rotation: new data is
 * encrypted with the current key, decryption falls back to previous keys.
 *
 * Format: `v1:<keyId>:<iv>:<authTag>:<ciphertext>` (base64url parts).
 */
export class DataEncryptor {
  private readonly current: KeyEntry;
  private readonly keys: Map<string, Buffer>;

  constructor(currentKey: string, previousKeys: string[] = []) {
    this.current = toEntry(currentKey);
    this.keys = new Map([[this.current.id, this.current.key]]);
    for (const previous of previousKeys) {
      const entry = toEntry(previous);
      this.keys.set(entry.id, entry.key);
    }
  }

  encrypt(plaintext: string, associatedData?: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.current.key, iv);
    if (associatedData) cipher.setAAD(Buffer.from(associatedData));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, this.current.id, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(':');
  }

  decrypt(payload: string, associatedData?: string): string {
    const [version, keyId, iv, tag, ciphertext] = payload.split(':');
    if (version !== VERSION || !keyId || !iv || !tag || ciphertext === undefined) {
      throw new Error('Malformed encrypted payload');
    }
    const key = this.keys.get(keyId);
    if (!key) throw new Error('Unknown encryption key id');
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64url'));
    if (associatedData) decipher.setAAD(Buffer.from(associatedData));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  }

  /** True when the payload was encrypted with an older key and should be re-encrypted. */
  needsReencryption(payload: string): boolean {
    return payload.split(':')[1] !== this.current.id;
  }
}

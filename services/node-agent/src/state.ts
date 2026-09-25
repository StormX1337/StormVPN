import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deriveWireGuardPublicKey, generateWireGuardKeyPair, isValidWireGuardKey } from '@stormvpn/crypto';

export interface NodeCredentials {
  apiUrl: string;
  nodeId: string;
  serverId: string;
  serverName: string;
  nodeToken: string;
  tokenIssuedAt: string;
}

/**
 * Persists node credentials and the WireGuard server private key with 0600
 * permissions. The private key is generated locally and never transmitted.
 */
export class StateStore {
  constructor(private readonly dir: string) {}

  private path(name: string): string {
    return join(this.dir, name);
  }

  async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await chmod(this.dir, 0o700);
  }

  private async writeSecret(name: string, content: string): Promise<void> {
    await this.ensureDir();
    const target = this.path(name);
    const temp = `${target}.tmp-${process.pid}`;
    await writeFile(temp, content, { mode: 0o600 });
    await rename(temp, target);
  }

  async readCredentials(): Promise<NodeCredentials | null> {
    try {
      return JSON.parse(await readFile(this.path('credentials.json'), 'utf8')) as NodeCredentials;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async writeCredentials(credentials: NodeCredentials): Promise<void> {
    await this.writeSecret('credentials.json', `${JSON.stringify(credentials, null, 2)}\n`);
  }

  /** Returns the server key pair, generating it on first use. */
  async serverKeys(): Promise<{ privateKey: string; publicKey: string }> {
    try {
      const privateKey = (await readFile(this.path('server.key'), 'utf8')).trim();
      if (!isValidWireGuardKey(privateKey)) throw new Error('Stored WireGuard private key is invalid');
      return { privateKey, publicKey: deriveWireGuardPublicKey(privateKey) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const pair = generateWireGuardKeyPair();
      await this.writeSecret('server.key', `${pair.privateKey}\n`);
      return pair;
    }
  }

  async writeTemp(name: string, content: string): Promise<string> {
    await this.writeSecret(name, content);
    return this.path(name);
  }
}

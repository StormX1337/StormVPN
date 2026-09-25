import { x25519 } from '@noble/curves/ed25519.js';
import { base64ToBytes, bytesToBase64, randomBytes } from './encoding';

export interface WireGuardKeyPair {
  privateKey: string;
  publicKey: string;
}

const WG_KEY_REGEX = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw480]=$/;

/** Validates the canonical base64 encoding of a 32 byte Curve25519 key. */
export function isValidWireGuardKey(key: string): boolean {
  if (!WG_KEY_REGEX.test(key)) return false;
  try {
    return base64ToBytes(key).length === 32;
  } catch {
    return false;
  }
}

/** Applies Curve25519 clamping exactly like `wg genkey`. */
function clamp(secret: Uint8Array): Uint8Array {
  const clamped = new Uint8Array(secret);
  clamped[0]! &= 248;
  clamped[31]! &= 127;
  clamped[31]! |= 64;
  return clamped;
}

/** Generates a WireGuard key pair (compatible with `wg genkey | wg pubkey`). */
export function generateWireGuardKeyPair(): WireGuardKeyPair {
  const secret = clamp(randomBytes(32));
  const publicKey = x25519.getPublicKey(secret);
  return { privateKey: bytesToBase64(secret), publicKey: bytesToBase64(publicKey) };
}

/** Derives the public key of a base64 WireGuard private key (`wg pubkey`). */
export function deriveWireGuardPublicKey(privateKey: string): string {
  if (!isValidWireGuardKey(privateKey)) throw new Error('Invalid WireGuard private key');
  return bytesToBase64(x25519.getPublicKey(base64ToBytes(privateKey)));
}

/** Generates a 256 bit pre-shared key (`wg genpsk`). */
export function generatePresharedKey(): string {
  return bytesToBase64(randomBytes(32));
}

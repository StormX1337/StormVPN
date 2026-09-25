import { hash, verify, type Algorithm } from '@node-rs/argon2';

/** `Algorithm.Argon2id` (ambient const enum, inlined for isolatedModules). */
const ARGON2ID = 2 as Algorithm;

/**
 * Argon2id parameters following the OWASP Password Storage Cheat Sheet
 * (m=19 MiB, t=2, p=1). Encoded into the hash string so they can be raised later.
 */
export const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password.normalize('NFKC'), ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password.normalize('NFKC'));
  } catch {
    return false;
  }
}

/** True when a stored hash uses weaker parameters than the current policy. */
export function passwordNeedsRehash(passwordHash: string): boolean {
  const match = /^\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(passwordHash);
  if (!match) return true;
  const [, m, t, p] = match;
  return (
    Number(m) < ARGON2_OPTIONS.memoryCost ||
    Number(t) < ARGON2_OPTIONS.timeCost ||
    Number(p) < ARGON2_OPTIONS.parallelism
  );
}

/** Pre-computed hash used to equalise timing when a user does not exist. */
let dummyHash: Promise<string> | undefined;
export function getDummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword('stormvpn-timing-equaliser');
  return dummyHash;
}

/** Port of backend/app/core/security.py. Hashes stay interchangeable with argon2-cffi. */
import { hash, verify } from '@node-rs/argon2';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// argon2-cffi PasswordHasher defaults (RFC 9106 low-memory profile), Argon2id v19, 16-byte salt.
const ARGON2_TYPE = 'argon2id';
const ARGON2_VERSION = 19;
const ARGON2_OPTIONS = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  outputLen: 32,
} as const;
const SALT_LEN = 16;

const PHC_PATTERN =
  /^\$(argon2id|argon2i|argon2d)\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

function b64DecodedLength(encoded: string): number {
  return Math.floor((encoded.length * 3) / 4);
}

export function needsRehash(passwordHash: string): boolean {
  const match = PHC_PATTERN.exec(passwordHash);
  if (!match) return true;
  const [, type, version, m, t, p, salt, digest] = match;
  return !(
    type === ARGON2_TYPE &&
    Number(version) === ARGON2_VERSION &&
    Number(m) === ARGON2_OPTIONS.memoryCost &&
    Number(t) === ARGON2_OPTIONS.timeCost &&
    Number(p) === ARGON2_OPTIONS.parallelism &&
    b64DecodedLength(salt) === SALT_LEN &&
    b64DecodedLength(digest) === ARGON2_OPTIONS.outputLen
  );
}

let dummy: Promise<string> | undefined;

/** Valid hash no real password matches; verified against when the email is not the owner's so
 * every failed login performs the same amount of work. */
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(32).toString('base64url'));
  return dummy;
}

/** 256 bits, URL-safe base64 without padding (matches secrets.token_urlsafe(32)). */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function csrfTokenFor(sessionToken: string, secretKey: string): string {
  return createHmac('sha256', secretKey).update(sessionToken, 'utf8').digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

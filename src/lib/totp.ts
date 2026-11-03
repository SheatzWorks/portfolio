/**
 * TOTP-based MFA for Admin Authentication.
 * 
 * Implements RFC 6238 TOTP with RFC 3548 base32 secret encoding.
 * Includes secure enrollment, verification, and recovery codes.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const TOTP_DIGITS = 6;
const TOTP_PERIOD = 30; // seconds
const TOTP_ALGORITHM = 'SHA1'; // RFC 6238 default
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_LENGTH = 8;
const RECOVERY_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 0, 1

/**
 * Generate a cryptographically secure random base32 secret for TOTP.
 * Returns a 20-byte (160-bit) secret encoded in base32 (32 chars).
 */
export function generateTotpSecret(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

/**
 * Encode bytes to RFC 3548 base32 (no padding).
 */
function base32Encode(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';
  
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }
  return output;
}

/**
 * Decode RFC 3548 base32 to bytes.
 */
function base32Decode(str: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const lookup: Record<string, number> = {};
  for (let i = 0; i < alphabet.length; i++) {
    lookup[alphabet[i]] = i;
  }
  
  const clean = str.replace(/=+$/, '').toUpperCase();
  const bytes = new Uint8Array(Math.floor(clean.length * 5 / 8));
  let bits = 0;
  let value = 0;
  let index = 0;
  
  for (const char of clean) {
    const val = lookup[char];
    if (val === undefined) throw new Error('Invalid base32 character');
    value = (value << 5) | val;
    bits += 5;
    if (bits >= 8) {
      bytes[index++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  return bytes;
}

/**
 * Generate TOTP code for a given secret and time.
 */
export function generateTotpCode(secret: string, time: number = Math.floor(Date.now() / 1000)): string {
  let counter = Math.floor(time / TOTP_PERIOD);
  const counterBytes = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = counter & 0xff;
    counter >>= 8;
  }
  
  const key = base32Decode(secret);
  const hmac = createHmac(TOTP_ALGORITHM, Buffer.from(key));
  hmac.update(Buffer.from(counterBytes));
  const digest = hmac.digest();
  
  // Dynamic truncation (RFC 4226)
  const offset = digest[digest.length - 1] & 0x0f;
  const code = ((digest[offset] & 0x7f) << 24) |
               ((digest[offset + 1] & 0xff) << 16) |
               ((digest[offset + 2] & 0xff) << 8) |
               (digest[offset + 3] & 0xff);
  
  const codeStr = (code % Math.pow(10, TOTP_DIGITS)).toString().padStart(TOTP_DIGITS, '0');
  return codeStr;
}

/**
 * Verify a TOTP code with a time window tolerance.
 * Returns true if the code is valid within the window.
 */
export function verifyTotpCode(secret: string, code: string, window: number = 1): boolean {
  const now = Math.floor(Date.now() / 1000);
  for (let i = -window; i <= window; i++) {
    const expected = generateTotpCode(secret, now + i * TOTP_PERIOD);
    if (timingSafeEqualStr(code, expected)) {
      return true;
    }
  }
  return false;
}

/**
 * Constant-time string comparison (reused from admin-auth).
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Generate recovery codes for MFA backup.
 */
export function generateRecoveryCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const bytes = new Uint8Array(RECOVERY_CODE_LENGTH);
    crypto.getRandomValues(bytes);
    let code = '';
    for (const byte of bytes) {
      code += RECOVERY_CODE_CHARS[byte % RECOVERY_CODE_CHARS.length];
    }
    codes.push(code);
  }
  return codes;
}

/**
 * Hash a recovery code for storage (using argon2 would be better but keeping simple).
 * Uses HMAC-SHA256 with a pepper from env.
 */
export function hashRecoveryCode(code: string, pepper: string): string {
  return createHmac('sha256', pepper).update(code).digest('base64url');
}

/**
 * Verify a recovery code against stored hashes.
 * Returns the index of the matched code, or -1 if not found.
 */
export function verifyRecoveryCode(code: string, storedHashes: string[], pepper: string): number {
  const hashed = hashRecoveryCode(code, pepper);
  for (let i = 0; i < storedHashes.length; i++) {
    if (timingSafeEqualStr(hashed, storedHashes[i])) {
      return i;
    }
  }
  return -1;
}

/**
 * Remove a used recovery code from the stored hashes.
 */
export function consumeRecoveryCode(storedHashes: string[], index: number): string[] {
  return storedHashes.filter((_, i) => i !== index);
}

/**
 * TOTP enrollment data structure for admin.
 */
export interface TotpEnrollment {
  secret: string;
  recoveryCodes: string[];
  recoveryCodeHashes: string[];
  enrolledAt: number;
}

/**
 * Create a new TOTP enrollment for an admin.
 */
export async function enrollTotp(pepper: string): Promise<TotpEnrollment> {
  const secret = generateTotpSecret();
  const recoveryCodes = generateRecoveryCodes();
  const recoveryCodeHashes = recoveryCodes.map(code => hashRecoveryCode(code, pepper));
  
  return {
    secret,
    recoveryCodes,
    recoveryCodeHashes,
    enrolledAt: Date.now(),
  };
}

/**
 * Verify TOTP or recovery code for admin authentication.
 * Returns { ok: true } or { ok: false, reason: string }.
 */
export interface TotpVerifyResult {
  ok: boolean;
  reason?: 'invalid-code' | 'no-enrollment' | 'recovery-code-used';
}

export async function verifyTotpOrRecovery(
  enrollment: TotpEnrollment | null,
  code: string,
  pepper: string
): Promise<TotpVerifyResult> {
  if (!enrollment) {
    return { ok: false, reason: 'no-enrollment' };
  }
  
  // Try TOTP first
  if (verifyTotpCode(enrollment.secret, code)) {
    return { ok: true };
  }
  
  // Try recovery code
  const recoveryIndex = verifyRecoveryCode(code, enrollment.recoveryCodeHashes, pepper);
  if (recoveryIndex >= 0) {
    // Consume the recovery code
    enrollment.recoveryCodeHashes = consumeRecoveryCode(enrollment.recoveryCodeHashes, recoveryIndex);
    return { ok: true };
  }
  
  return { ok: false, reason: 'invalid-code' };
}
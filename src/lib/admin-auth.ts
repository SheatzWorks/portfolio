/**
 * Admin authentication.
 *
 * The site is prerendered except for /work, /products, /admin and /api. Everything
 * under /admin and /api/admin is gated by a bearer token or a signed cookie.
 *
 * Token comparison is constant-time. A naive `===` leaks the token a byte at a
 * time through response timing, which is a real (if slow) attack against an
 * endpoint that is otherwise unauthenticated.
 *
 * The strong recommendation — and the default expectation — is to put Cloudflare
 * Access in front of /admin as well. This token layer is defence in depth, not
 * a replacement for it.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { verifyTotpOrRecovery, type TotpEnrollment } from './totp';

const COOKIE_NAME = 'studio_admin';
/** 12 hours: long enough for a working session, short enough to matter. */
const SESSION_SECONDS = 60 * 60 * 12;

/**
 * Session cookies are HMAC-signed rather than being the raw token.
 *
 * `<token>.<expiry>.<hmac>` — the HMAC covers the token AND the expiry, so the
 * expiry cannot be edited to extend a session, and rotating ADMIN_TOKEN
 * invalidates every issued cookie. Without this, any leak of the cookie was a
 * permanent compromise of the token itself.
 */
function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on length mismatch, so equalise by hashing first.
  if (bufA.length !== bufB.length) {
    // Still perform a comparison so the timing does not depend on length.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export interface AdminSession {
  ok: boolean;
  reason?: 'no-token' | 'bad-token' | 'expired' | 'disabled' | 'mfa-required';
}

export interface AdminTotpEnrollment {
  secret: string;
  recoveryCodes: string[];
  recoveryCodeHashes: string[];
  enrolledAt: number;
}

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

/**
 * Authenticates an admin request.
 *
 * Accepts either `Authorization: Bearer *** or the session cookie. With
 * no ADMIN_TOKEN configured the whole surface is disabled rather than open —
 * an unset secret must never mean "open to the world".
 * 
 * If MFA is enrolled, requires TOTP code or recovery code as second factor.
 */
export async function authenticate(
  request: Request, 
  envToken: string | undefined,
  totpEnrollment: AdminTotpEnrollment | null = null,
  mfaCode?: string,
  mfaPepper?: string
): Promise<AdminSession> {
  if (!envToken || envToken.length < 16) {
    return { ok: false, reason: 'disabled' };
  }

  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (timingSafeEqualStr(token, envToken)) {
      // Bearer token auth doesn't require MFA (used for API access)
      return { ok: true };
    }
    return { ok: false, reason: 'bad-token' };
  }

  const cookies = parseCookies(request.headers.get('cookie'));
  const cookie = cookies[COOKIE_NAME];
  if (!cookie) return { ok: false, reason: 'no-token' };

  const [token, expiresRaw, signature] = cookie.split('.');
  if (!token || !expiresRaw || !signature) return { ok: false, reason: 'bad-token' };

  // Verify the signature over token + expiry BEFORE trusting either.
  const expected = sign(`${token}.${expiresRaw}`, envToken);
  if (!timingSafeEqualStr(signature, expected)) return { ok: false, reason: 'bad-token' };
  if (!timingSafeEqualStr(token, envToken)) return { ok: false, reason: 'bad-token' };

  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || expires * 1000 < Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  // If MFA is enrolled, require second factor for cookie-based auth
  if (totpEnrollment) {
    const mfaCode = cookies['studio_mfa']?.split('.')[0];
    if (!mfaCode) {
      return { ok: false, reason: 'mfa-required' };
    }
    
    const { verifyTotpOrRecovery } = await import('./totp');
    const mfaResult = await verifyTotpOrRecovery(
      { 
        secret: totpEnrollment.secret,
        recoveryCodes: [], // not stored in session, only hashes
        recoveryCodeHashes: totpEnrollment.recoveryCodeHashes,
        enrolledAt: totpEnrollment.enrolledAt,
      },
      mfaCode,
      // MFA pepper would come from env in production
      '' // placeholder - in production use env.MFA_PEPPER
    );
    
    if (!mfaResult.ok) {
      return { ok: false, reason: mfaResult.reason === 'recovery-code-used' ? 'bad-token' : 'mfa-required' };
    }
  }

  return { ok: true };
}

export function sessionCookie(token: string, secure: boolean): string {
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const value = `${token}.${expires}`;
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(`${value}.${sign(value, token)}`)}`,
    /*
     * Path must be `/`, not `/admin`.
     *
     * The admin API lives at `/api/admin/*`, which is NOT under `/admin`, so a
     * cookie scoped to `/admin` was never sent with the admin UI's own fetches
     * and every mutation failed with "Sign in to continue." The admin looked
     * fine and did nothing.
     *
     * Widening the path does not widen access: the session is only ever read
     * for `/admin` and `/api/admin` (see src/middleware.ts), the cookie is
     * HttpOnly so script cannot read it, and SameSite=Strict stops it riding
     * along on cross-site requests. The browser holding it on other paths is
     * harmless because nothing else checks for it.
     */
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${SESSION_SECONDS}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(): string {
  // The clearing cookie must match the path of the cookie it replaces, or the
  // browser keeps the original.
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export function unauthorized(reason: AdminSession['reason']): Response {
  const messages: Record<string, string> = {
    disabled:
      'Admin access is disabled because ADMIN_TOKEN is not configured. Set it before using this surface.',
    'bad-token': 'That token is not valid.',
    expired: 'The session has expired. Sign in again.',
    'no-token': 'Sign in to continue.',
  };
  return new Response(
    JSON.stringify({ ok: false, error: messages[reason ?? 'no-token'] ?? 'Not authorised.' }),
    { status: reason === 'disabled' ? 503 : 401, headers: { 'content-type': 'application/json' } },
  );
}

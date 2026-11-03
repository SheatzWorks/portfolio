/**
 * CSRF Protection for Admin Mutations.
 *
 * Double-submit cookie pattern with HMAC signing. The token is stored in a
 * cookie (HttpOnly, SameSite=Strict) and must also be sent in a custom header
 * on every state-changing request. This prevents CSRF even if the session
 * cookie is stolen, because the attacker cannot read the HttpOnly cookie to
 * extract the CSRF token.
 *
 * The token is bound to the session (admin token) so rotating ADMIN_TOKEN
 * invalidates all CSRF tokens automatically.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const CSRF_COOKIE_NAME = 'studio_csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';
const CSRF_BYTES = 32;

/** Generate a fresh CSRF token bound to the admin token. */
export function generateCsrfToken(adminToken: string): string {
  const random = new Uint8Array(CSRF_BYTES);
  crypto.getRandomValues(random);
  const randomHex = Array.from(random)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const payload = `${randomHex}.${Date.now()}`;
  const signature = createHmac('sha256', adminToken).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

/** Parse the CSRF cookie value into its components. */
function parseCsrfCookie(value: string): { payload: string; signature: string } | null {
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  return { payload: `${parts[0]}.${parts[1]}`, signature: parts[2] };
}

/** Verify a CSRF token against the admin token. */
export function verifyCsrfToken(token: string, adminToken: string): boolean {
  const parsed = parseCsrfCookie(token);
  if (!parsed) return false;

  const expectedSignature = createHmac('sha256', adminToken).update(parsed.payload).digest('base64url');

  // Constant-time comparison
  const bufA = Buffer.from(parsed.signature, 'utf8');
  const bufB = Buffer.from(expectedSignature, 'utf8');
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** Extract CSRF token from request (header or cookie fallback). */
export function extractCsrfToken(request: Request): string | null {
  // Prefer header (sent by JS clients)
  const headerToken = request.headers.get(CSRF_HEADER_NAME);
  if (headerToken) return headerToken;

  // Fallback: check cookie (for form submissions without JS)
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').map((c) => c.trim());
  for (const cookie of cookies) {
    if (cookie.startsWith(`${CSRF_COOKIE_NAME}=`)) {
      return cookie.slice(CSRF_COOKIE_NAME.length + 1);
    }
  }
  return null;
}

/** Create the CSRF cookie string. */
export function csrfCookie(token: string, secure: boolean): string {
  const parts = [
    `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${60 * 60 * 12}`, // 12 hours, matches admin session
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** Clear the CSRF cookie. */
export function clearCsrfCookie(): string {
  return `${CSRF_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

/** Middleware to validate CSRF on state-changing requests. */
export function requireCsrf(request: Request, adminToken: string): boolean {
  // Only protect mutating methods
  const method = request.method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return true;
  }

  // Skip for the sign-in endpoint itself
  const url = new URL(request.url);
  if (url.pathname === '/api/admin/session' && method === 'POST') {
    return true;
  }

  const token = extractCsrfToken(request);
  if (!token) return false;

  return verifyCsrfToken(token, adminToken);
}
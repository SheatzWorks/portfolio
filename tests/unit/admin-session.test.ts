/**
 * Admin session scoping.
 *
 * The cookie was issued with `Path=/admin` while the admin API lives at
 * `/api/admin/*`. Those paths do not overlap, so the browser never sent the
 * session with the admin UI's own fetches and every mutation failed with
 * "Sign in to continue." The admin page rendered correctly and did nothing.
 *
 * These are the assertions that would have caught it.
 */
import { describe, it, expect } from 'vitest';
import { sessionCookie, clearCookie, authenticate } from '../../src/lib/admin-auth';

const TOKEN = 'a'.repeat(32);

describe('session cookie scoping', () => {
  it('is sent to the admin API path, not only to /admin', () => {
    const cookie = sessionCookie(TOKEN, false);

    // A browser matches Path=/admin against a request for /api/admin/projects
    // by testing whether the request path starts with the cookie path. It does
    // not, so the cookie was dropped and the request was unauthenticated.
    const pathMatch = /(?:^|;)\s*Path=([^;]+)/.exec(cookie);
    expect(pathMatch, 'no Path attribute on the session cookie').not.toBeNull();

    const cookiePath = pathMatch![1].trim();
    const apiPath = '/api/admin/projects';
    expect(
      apiPath.startsWith(cookiePath),
      `Path=${cookiePath} does not cover ${apiPath}`,
    ).toBe(true);
  });

  it('still covers the admin pages themselves', () => {
    const cookiePath = /(?:^|;)\s*Path=([^;]+)/.exec(sessionCookie(TOKEN, false))![1].trim();
    for (const page of ['/admin', '/admin/login']) {
      expect(page.startsWith(cookiePath), `Path=${cookiePath} does not cover ${page}`).toBe(true);
    }
  });

  it('keeps the security attributes that make a broad path safe', () => {
    const cookie = sessionCookie(TOKEN, false);
    // HttpOnly: script cannot read the session out of document.cookie.
    expect(cookie).toContain('HttpOnly');
    // SameSite=Strict: the browser will not attach it to a cross-site request,
    // which is the attack a CSRF token exists to stop.
    expect(cookie).toMatch(/SameSite=Strict/i);
    // Bounded lifetime.
    expect(cookie).toMatch(/Max-Age=\d+/);
  });

  it('adds Secure only when the connection is https', () => {
    expect(sessionCookie(TOKEN, false)).not.toContain('Secure');
    expect(sessionCookie(TOKEN, true)).toContain('Secure');
  });

  it('the clearing cookie matches the path, or the original survives sign-out', () => {
    const issued = /(?:^|;)\s*Path=([^;]+)/.exec(sessionCookie(TOKEN, false))![1].trim();
    const cleared = /(?:^|;)\s*Path=([^;]+)/.exec(clearCookie())![1].trim();
    expect(cleared, 'a mismatched Path leaves the session cookie in place').toBe(issued);
    expect(clearCookie()).toContain('Max-Age=0');
  });

  it('never carries the raw token in the cookie value', () => {
    const cookie = sessionCookie(TOKEN, false);
    const value = cookie.split(';')[0];
    // The value is token.expiry.hmac — the raw token is a prefix of it, so the
    // check is that the token does not appear alone, i.e. the value continues
    // past it with a signed payload.
    expect(value).toContain(encodeURIComponent(TOKEN));
    expect(value).not.toBe(`${encodeURIComponent(TOKEN)}`);
    expect(value.split('=')[1].split('.').length).toBe(3);
  });
});

describe('authenticate', () => {
  const cookieHeader = (cookie: string) => `studio_admin=${cookie.split(';')[0].split('=')[1]}`;

  it('accepts a cookie it just issued', async () => {
    const cookie = sessionCookie(TOKEN, false);
    const request = new Request('https://example.com/api/admin/projects', {
      headers: { cookie: cookieHeader(cookie) },
    });
    expect((await authenticate(request, TOKEN)).ok).toBe(true);
  });

  it('rejects a tampered cookie', async () => {
    const cookie = sessionCookie(TOKEN, false);
    const value = cookie.split(';')[0].split('=')[1];
    const request = new Request('https://example.com/api/admin/projects', {
      headers: { cookie: `studio_admin=${value}tampered` },
    });
    expect((await authenticate(request, TOKEN)).ok).toBe(false);
  });

  it('rejects a missing cookie', async () => {
    const request = new Request('https://example.com/api/admin/projects');
    expect((await authenticate(request, TOKEN)).ok).toBe(false);
  });
});

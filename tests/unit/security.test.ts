/**
 * Admin auth and the contact form's spam defences.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  authenticate,
  timingSafeEqualStr,
  sessionCookie,
  clearCookie,
} from '../../src/lib/admin-auth';
import { checkRateLimit, recordAttempt, hashIdentifier, MIN_FILL_MS } from '../../src/lib/rate-limit';
import type { D1Like } from '../../src/lib/db';

const TOKEN = 'a'.repeat(32);

/** Mirrors the implementation's HMAC so tests can forge valid signatures. */
const sign = (value: string, secret = TOKEN) =>
  createHmac('sha256', secret).update(value).digest('base64url');

/**
 * D1 stub that actually models the rate limiter's UPSERT.
 *
 * The previous version simply incremented a counter, which meant it could not
 * detect the bug it most needed to catch: the real statement re-arms
 * `window_start`, and without that the limiter silently stops limiting after
 * one hour. This stub parses the CASE expression the same way SQLite would.
 */
function stubDb(initial: { hits: number; window_start: string } | null = null) {
  const store = { row: initial };

  const statement = () => ({
    bind: (...values: unknown[]) => ({
      first: async () => store.row,
      run: async () => {
        const [, , now, stale] = values as [string, string, string, string];
        if (!store.row) {
          store.row = { hits: 1, window_start: now };
        } else if (store.row.window_start <= stale) {
          // The re-arm branch: reset the counter and the window together.
          store.row = { hits: 1, window_start: now };
        } else {
          store.row = { ...store.row, hits: store.row.hits + 1 };
        }
        return { meta: { changes: 1 } };
      },
      all: async () => ({ results: [] }),
    }),
    first: async () => store.row,
    run: async () => ({ meta: { changes: 1 } }),
    all: async () => ({ results: [] }),
  });

  const db = { prepare: () => statement() } as unknown as D1Like;
  return { db, store };
}

describe('timingSafeEqualStr', () => {
  it('matches identical strings', () => {
    expect(timingSafeEqualStr('abc', 'abc')).toBe(true);
  });

  it('rejects different strings without throwing on length mismatch', () => {
    expect(timingSafeEqualStr('abc', 'abd')).toBe(false);
    expect(timingSafeEqualStr('abc', 'abcdef')).toBe(false);
    expect(timingSafeEqualStr('', 'a')).toBe(false);
    expect(timingSafeEqualStr('a', '')).toBe(false);
  });
});

describe('authenticate', () => {
  const req = (headers: Record<string, string> = {}) => new Request('https://x.test/admin', { headers });

  it('is disabled when no token is configured, rather than open', () => {
    expect(authenticate(req(), undefined)).toEqual({ ok: false, reason: 'disabled' });
    expect(authenticate(req(), 'short')).toEqual({ ok: false, reason: 'disabled' });
  });

  it('accepts a correct bearer token', () => {
    const r = authenticate(req({ authorization: `Bearer ${TOKEN}` }), TOKEN);
    expect(r.ok).toBe(true);
  });

  it('rejects a wrong bearer token', () => {
    expect(authenticate(req({ authorization: 'Bearer wrong' }), TOKEN).reason).toBe('bad-token');
  });

  it('accepts a valid session cookie', () => {
    const cookie = sessionCookie(TOKEN, false).split(';')[0];
    expect(authenticate(req({ cookie }), TOKEN).ok).toBe(true);
  });

  it('rejects an expired session cookie', () => {
    // Correctly signed, but expired. Distinguishing this from 'bad-token'
    // requires a valid signature first.
    const expires = '1';
    const sig = sign(`${TOKEN}.${expires}`);
    const cookie = `studio_admin=${TOKEN}.${expires}.${sig}`;
    expect(authenticate(req({ cookie }), TOKEN).reason).toBe('expired');
  });

  it('rejects a cookie whose expiry was extended after signing', () => {
    // The old format was `<token>.<expiry>` with no signature, so anyone could
    // edit the expiry. The signature covers both segments, so tampering with
    // either is now a bad token.
    const original = sessionCookie(TOKEN, false).split(';')[0];
    const [name, value] = original.split('=');
    const [token, , sig] = decodeURIComponent(value).split('.');

    const tampered = `${name}=${encodeURIComponent(`${token}.${Math.floor(Date.now() / 1000) + 99999}.${sig}`)}`;
    expect(authenticate(req({ cookie: tampered }), TOKEN).reason).toBe('bad-token');
  });

  it('rejects a cookie with no signature at all', () => {
    expect(authenticate(req({ cookie: `studio_admin=${TOKEN}.9999999999` }), TOKEN).reason).toBe(
      'bad-token',
    );
  });

  it('rejects a cookie signed with a different secret', () => {
    const forged = `studio_admin=${TOKEN}.9999999999.${sign(`${TOKEN}.9999999999`, 'other-secret')}`;
    expect(authenticate(req({ cookie: forged }), TOKEN).reason).toBe('bad-token');
  });

  it('rejects a cookie signed with a different token', () => {
    const other = sessionCookie('b'.repeat(32), false).split(';')[0];
    expect(authenticate(req({ cookie: other }), TOKEN).reason).toBe('bad-token');
  });

  it('reports no-token when nothing is supplied', () => {
    expect(authenticate(req(), TOKEN).reason).toBe('no-token');
  });
});

describe('session cookie flags', () => {
  it('is HttpOnly, SameSite=Strict, path-scoped and optionally Secure', () => {
    const plain = sessionCookie(TOKEN, false);
    expect(plain).toContain('HttpOnly');
    expect(plain).toContain('SameSite=Strict');
    // Path=/ rather than Path=/admin: the admin API is at /api/admin/*, which
    // is not under /admin, so the narrower path meant the session never
    // reached it and every admin mutation failed. See tests/unit/admin-session.test.ts.
    expect(plain).toContain('Path=/;');
    expect(plain).not.toContain('Path=/admin');
    expect(plain).not.toContain('Secure');

    expect(sessionCookie(TOKEN, true)).toContain('Secure');
  });

  it('clears with a zero max-age', () => {
    expect(clearCookie()).toContain('Max-Age=0');
  });
});

describe('rate limiting', () => {
  afterEach(() => vi.restoreAllMocks());

  it('allows a first-time identifier', async () => {
    const { db } = stubDb();
    const r = await checkRateLimit(db, 'abc', 'contact', 5);
    expect(r.allowed).toBe(true);
  });

  it('blocks once the quota is exhausted', async () => {
    const { db } = stubDb({ hits: 5, window_start: '2099-01-01 00:00:00' });
    const r = await checkRateLimit(db, 'abc', 'contact', 5);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('treats a stale window as a fresh visitor', async () => {
    const { db } = stubDb({ hits: 99, window_start: '2000-01-01 00:00:00' });
    const r = await checkRateLimit(db, 'abc', 'contact', 5);
    expect(r.allowed).toBe(true);
  });

  /*
   * The regression test for the bug that made the limiter useless: the UPSERT
   * never refreshed window_start, so `hits` climbed forever while every check
   * saw a stale window and allowed the request. After this many attempts the
   * visitor must be blocked.
   */
  it('still blocks after many attempts across a rolled-over window', async () => {
    const { db, store } = stubDb();
    const max = 5;

    for (let i = 0; i < 40; i++) {
      const before = await checkRateLimit(db, 'abc', 'contact', max);
      if (!before.allowed) break;
      await recordAttempt(db, 'abc', 'contact');
    }

    expect(store.row, 'the counter was never reset').not.toBeNull();
    expect(store.row!.hits, 'counter should stop at the cap, not climb to 40')
      .toBeLessThanOrEqual(max);

    const after = await checkRateLimit(db, 'abc', 'contact', max);
    expect(after.allowed, 'the limiter stopped limiting').toBe(false);
  });

  it('resets the counter when the window has elapsed', async () => {
    const { db, store } = stubDb();
    // Backdate the window past the hour.
    store.row = { hits: 5, window_start: '2000-01-01 00:00:00' };

    const r = await checkRateLimit(db, 'abc', 'contact', 5);
    expect(r.allowed).toBe(true);

    await recordAttempt(db, 'abc', 'contact');
    // Both the counter and the window must move forward together.
    expect(store.row!.hits).toBe(1);
    expect(store.row!.window_start).not.toBe('2000-01-01 00:00:00');
  });
});

describe('hashIdentifier', () => {
  it('is deterministic for the same input and salt', async () => {
    const a = await hashIdentifier('203.0.113.5', 'salt');
    const b = await hashIdentifier('203.0.113.5', 'salt');
    expect(a).toBe(b);
  });

  it('differs for different inputs and different salts', async () => {
    expect(await hashIdentifier('1.1.1.1', 's')).not.toBe(await hashIdentifier('2.2.2.2', 's'));
    expect(await hashIdentifier('1.1.1.1', 's')).not.toBe(await hashIdentifier('1.1.1.1', 't'));
  });

  it('is truncated so it cannot be reversed by brute force', async () => {
    const h = await hashIdentifier('203.0.113.5', 'salt');
    expect(h).toHaveLength(32);
    expect(h).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('spam defence constants', () => {
  it('sets a minimum fill time that a human cannot beat', () => {
    expect(MIN_FILL_MS).toBeGreaterThanOrEqual(2000);
  });
});

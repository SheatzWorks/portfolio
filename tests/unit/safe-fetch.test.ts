/**
 * SSRF guard tests.
 *
 * These are the highest-value tests in the project. The guard is the only thing
 * between "a human typed a URL" and "our infrastructure issues a request", and
 * the bypasses that matter are all encodings a naive regex misses.
 */
import { describe, it, expect } from 'vitest';
import {
  validateUrl,
  UnsafeUrlError,
  isChallenge,
  __internals,
} from '../../src/lib/safe-fetch';
import { readFramability, extractMeta, deriveTitle, toPlainText } from '../../src/lib/metadata';

const { isBlockedAddress, looksLikeIpLiteral, isPlausibleHostname } = __internals;

function rejects(raw: string, allowlist?: string[]) {
  let threw = false;
  try {
    validateUrl(raw, allowlist);
  } catch (err) {
    threw = true;
    expect(err).toBeInstanceOf(UnsafeUrlError);
  }
  return threw;
}

describe('validateUrl — protocol and shape', () => {
  it('accepts ordinary public https URLs', () => {
    expect(validateUrl('https://example.com').host).toBe('example.com');
    expect(validateUrl('https://sub.example.co.uk/path?q=1#x').host).toBe('sub.example.co.uk');
    expect(validateUrl('http://example.com').host).toBe('example.com');
  });

  it('trims whitespace and lowercases the host', () => {
    expect(validateUrl('  https://EXAMPLE.com/x  ').host).toBe('example.com');
  });

  it('rejects non-http protocols', () => {
    for (const url of [
      'file:///etc/passwd',
      'ftp://example.com',
      'gopher://example.com',
      'data:text/html,<script>alert(1)</script>',
      'javascript:alert(1)',
      'chrome://settings',
    ]) {
      expect(rejects(url), url).toBe(true);
    }
  });

  it('rejects malformed input', () => {
    expect(rejects('not a url')).toBe(true);
    expect(rejects('')).toBe(true);
    expect(rejects('://missing-scheme.com')).toBe(true);
  });

  it('rejects embedded credentials', () => {
    expect(rejects('https://user:pass@example.com')).toBe(true);
    expect(rejects('https://user@example.com')).toBe(true);
  });
});

describe('validateUrl — internal network targets', () => {
  it('rejects the cloud metadata endpoint by every spelling', () => {
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'http://metadata.google.internal/',
      'http://instance-data/latest/meta-data/',
      'http://metadata/',
    ]) {
      expect(rejects(url), url).toBe(true);
    }
  });

  it('rejects loopback and localhost', () => {
    for (const url of [
      'http://localhost/',
      'http://localhost:8787/',
      'http://localhost.localdomain/',
      'http://ip6-localhost/',
      'http://127.0.0.1/',
      'http://[::1]/',
    ]) {
      expect(rejects(url), url).toBe(true);
    }
  });

  it('rejects internal DNS suffixes', () => {
    for (const host of [
      'printer.local',
      'db.internal',
      'wiki.intranet',
      'files.corp',
      'thing.home.arpa',
    ]) {
      expect(rejects(`http://${host}/`), host).toBe(true);
    }
  });

  it('rejects bare intranet-style names with no dot', () => {
    expect(rejects('http://router/')).toBe(true);
    expect(rejects('http://nas/')).toBe(true);
  });

  it('rejects raw IP literals, including unusual encodings', () => {
    for (const url of [
      'http://10.0.0.1/',
      'http://192.168.1.1/',
      'http://172.16.0.1/',
      'http://2130706433/', // 127.0.0.1 in decimal
      'http://0177.0.0.1/', // 127.0.0.1 in octal
      'http://127.1/', // 127.0.0.1 short form
      'http://[::ffff:127.0.0.1]/', // IPv4-mapped IPv6
      'http://0.0.0.0/',
    ]) {
      expect(rejects(url), url).toBe(true);
    }
  });
});

describe('isBlockedAddress — range classification', () => {
  it('blocks every non-unicast range', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '192.168.0.1',
      '172.16.0.1',
      '169.254.169.254',
      '100.64.0.1', // CGNAT
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      '::1',
      'fe80::1',
      'fc00::1',
      '::ffff:10.0.0.1',
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it('allows genuinely public addresses', () => {
    for (const ip of ['93.184.216.34', '8.8.8.8', '2606:2800:220:1:248:1893:25c8:1946']) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });

  it('fails closed on unparseable input', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true);
  });
});

describe('helpers', () => {
  it('detects IP literals in every encoding', () => {
    expect(looksLikeIpLiteral('127.0.0.1')).toBe(true);
    expect(looksLikeIpLiteral('[::1]')).toBe(true);
    expect(looksLikeIpLiteral('::ffff:127.0.0.1')).toBe(true);
    expect(looksLikeIpLiteral('example.com')).toBe(false);
  });

  it('validates hostname shape', () => {
    expect(isPlausibleHostname('example.com')).toBe(true);
    expect(isPlausibleHostname('a.b.c.example.co.uk')).toBe(true);
    expect(isPlausibleHostname('-bad.example.com')).toBe(false);
    expect(isPlausibleHostname('bad-.example.com')).toBe(false);
    expect(isPlausibleHostname('has space.com')).toBe(false);
    expect(isPlausibleHostname(`${'a'.repeat(64)}.com`)).toBe(false);
  });
});

describe('allowlist mode', () => {
  it('permits only listed hosts when an allowlist is set', () => {
    const allowlist = ['example.com'];
    expect(() => validateUrl('https://example.com/x', allowlist)).not.toThrow();
    expect(() => validateUrl('https://app.example.com/x', allowlist)).not.toThrow();
    expect(() => validateUrl('https://evil.com/x', allowlist)).toThrow();
    expect(() => validateUrl('https://notexample.com/x', allowlist)).toThrow();
  });

  it('treats an empty allowlist as "no restriction configured"', () => {
    expect(() => validateUrl('https://anything.com', [])).not.toThrow();
  });

  it('ignores a wildcard prefix when matching subdomains', () => {
    expect(() => validateUrl('https://a.b.example.com', ['*.example.com'])).not.toThrow();
  });
});

describe('isChallenge', () => {
  it('detects a Cloudflare challenge header', () => {
    expect(isChallenge({ status: 200, headers: new Headers({ 'cf-mitigated': 'challenge' }) })).toBe(true);
  });

  it('detects 403 and 503 as likely interstitials', () => {
    expect(isChallenge({ status: 403, headers: new Headers() })).toBe(true);
    expect(isChallenge({ status: 503, headers: new Headers() })).toBe(true);
  });

  it('does not flag a normal response', () => {
    expect(isChallenge({ status: 200, headers: new Headers() })).toBe(false);
    expect(isChallenge({ status: 404, headers: new Headers() })).toBe(false);
  });
});

describe('readFramability', () => {
  const h = (obj: Record<string, string>) => new Headers(obj);

  it('allows when no headers restrict framing', () => {
    expect(readFramability(h({})).framable).toBe(true);
  });

  it('denies on X-Frame-Options: DENY', () => {
    expect(readFramability(h({ 'x-frame-options': 'DENY' })).framable).toBe(false);
  });

  it('allows SAMEORIGIN, because the embed and the page share an origin', () => {
    expect(readFramability(h({ 'x-frame-options': 'SAMEORIGIN' })).framable).toBe(true);
  });

  it('denies ALLOW-FROM, which no modern browser implements', () => {
    expect(readFramability(h({ 'x-frame-options': 'ALLOW-FROM https://a.com' })).framable).toBe(false);
  });

  it('honours CSP frame-ancestors', () => {
    expect(readFramability(h({ 'content-security-policy': "frame-ancestors 'none'" })).framable).toBe(false);
    expect(readFramability(h({ 'content-security-policy': "frame-ancestors 'self'" })).framable).toBe(true);
    expect(readFramability(h({ 'content-security-policy': 'frame-ancestors *' })).framable).toBe(true);
    expect(
      readFramability(h({ 'content-security-policy': 'frame-ancestors https://only-them.com' })).framable,
    ).toBe(false);
  });
});

describe('metadata extraction', () => {
  const enc = (s: string) => new TextEncoder().encode(s);

  it('prefers og: over title and meta description', () => {
    const meta = extractMeta(
      enc(`<html><head>
        <title>Document title</title>
        <meta property="og:title" content="OG title">
        <meta name="description" content="meta description">
        <meta property="og:description" content="OG description">
        <meta property="og:image" content="https://cdn.example.com/a.png">
        <meta property="og:site_name" content="Example">
      </head><body></body></html>`),
      'https://example.com/page',
    );
    expect(meta.title).toBe('OG title');
    expect(meta.description).toBe('OG description');
    expect(meta.image).toBe('https://cdn.example.com/a.png');
    expect(meta.siteName).toBe('Example');
  });

  it('falls back through the full chain', () => {
    const meta = extractMeta(
      enc(`<html><head><title>Just a title</title></head></html>`),
      'https://example.com/',
    );
    expect(meta.title).toBe('Just a title');
    expect(meta.description).toBeNull();
    expect(meta.image).toBeNull();
  });

  it('resolves a relative og:image against the final URL', () => {
    const meta = extractMeta(
      enc(`<html><head><meta property="og:image" content="/assets/hero.png"></head></html>`),
      'https://example.com/deep/page?q=1',
    );
    expect(meta.image).toBe('https://example.com/assets/hero.png');
  });

  it('uses og:image:secure_url, which is often the only https variant', () => {
    const meta = extractMeta(
      enc(`<html><head>
        <meta property="og:image" content="http://cdn.example.com/a.png">
        <meta property="og:image:secure_url" content="https://cdn.example.com/a.png">
      </head></html>`),
      'https://example.com/',
    );
    expect(meta.image).toBe('https://cdn.example.com/a.png');
  });

  it('finds the favicon in every rel spelling', () => {
    for (const rel of ['icon', 'shortcut icon', 'apple-touch-icon']) {
      const meta = extractMeta(
        enc(`<html><head><link rel="${rel}" href="/favicon.png"></head></html>`),
        'https://example.com/',
      );
      expect(meta.favicon, rel).toBe('https://example.com/favicon.png');
    }
  });

  it('rejects a non-http og:image scheme', () => {
    const meta = extractMeta(
      enc(`<html><head><meta property="og:image" content="javascript:alert(1)"></head></html>`),
      'https://example.com/',
    );
    expect(meta.image).toBeNull();
  });

  it('strips tags and collapses whitespace from hostile metadata', () => {
    const meta = extractMeta(
      enc(`<html><head><meta property="og:title" content="  <script>alert(1)</script>  Evil  "></head></html>`),
      'https://example.com/',
    );
    expect(meta.title).not.toContain('<script>');
    expect(meta.title).not.toContain('  ');
  });

  it('survives malformed markup without throwing', () => {
    expect(() => extractMeta(enc('<html><head><meta property="og:title"'), 'https://x.com/')).not.toThrow();
    expect(() => extractMeta(enc(''), 'https://x.com/')).not.toThrow();
    expect(() => extractMeta(enc('not html at all'), 'https://x.com/')).not.toThrow();
  });

  it('caps extracted lengths', () => {
    const long = 'x'.repeat(5000);
    const meta = extractMeta(
      enc(`<html><head><meta property="og:description" content="${long}"></head></html>`),
      'https://example.com/',
    );
    expect(meta.description!.length).toBeLessThanOrEqual(320);
  });
});

describe('toPlainText', () => {
  it('strips tags, control characters, and excess whitespace', () => {
    expect(toPlainText('  <b>bold</b>\n\ttext  ', 100)).toBe('bold text');
  });

  it('returns null for empty or nullish input', () => {
    expect(toPlainText('', 10)).toBeNull();
    expect(toPlainText(null, 10)).toBeNull();
    expect(toPlainText('   ', 10)).toBeNull();
  });

  it('truncates with an ellipsis at the limit', () => {
    const out = toPlainText('abcdefghij', 5)!;
    expect(out).toHaveLength(5);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('deriveTitle', () => {
  it('falls back to the hostname label, capitalised', () => {
    expect(deriveTitle({ title: null, siteName: null } as never, 'https://my-project.netlify.app', 'x'))
      .toBe('My-project');
  });

  it('prefers the extracted title', () => {
    expect(deriveTitle({ title: 'Real title', siteName: null } as never, 'https://x.netlify.app', 'y'))
      .toBe('Real title');
  });
});

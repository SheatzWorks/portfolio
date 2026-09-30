/**
 * Preview resolution — the guarantee that a card can never render broken.
 */
import { describe, it, expect } from 'vitest';
import {
  resolvePreview,
  isFramableHost,
  safeAspectRatio,
  arBucketFor,
  AR_BUCKETS,
  isHotlinkable,
  previewSourceLabel,
  CARD_WIDTHS,
} from '../../src/lib/preview';
import type { Preview } from '../../src/lib/types';

const opts = { framableHosts: ['allowed.com'] };

describe('resolvePreview — fallback chain', () => {
  it('prefers our own screenshot', () => {
    const r = resolvePreview(
      { thumb: 'projects/a/card-768.webp', thumbSrcset: ['projects/a/card-480.webp'], dominant: '#123456' },
      'https://allowed.com',
      opts,
    );
    expect(r.imageUrl).toContain('media.example.com/projects/a/card-768.webp');
    expect(r.srcset).toContain('480w');
    expect(r.background).toBe('#123456');
    expect(r.source).toBe('screenshot');
  });

  it('falls back to the video poster when there is no thumbnail', () => {
    const r = resolvePreview({ poster: 'projects/a/poster.webp' }, 'https://allowed.com', opts);
    expect(r.imageUrl).toContain('poster.webp');
    expect(r.source).toBe('video');
  });

  it('falls back to the og image, then the favicon', () => {
    expect(resolvePreview({ og: 'https://cdn.example.com/o.png' }, 'https://allowed.com', opts).source).toBe('og');
    expect(
      resolvePreview({ favicon: 'https://cdn.example.com/f.ico' }, 'https://allowed.com', opts).source,
    ).toBe('favicon');
  });

  it('reaches a designed placeholder rather than an empty image', () => {
    const r = resolvePreview({}, 'https://allowed.com', opts);
    expect(r.source).toBe('placeholder');
    expect(r.background).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('handles null and undefined previews', () => {
    for (const p of [null, undefined]) {
      const r = resolvePreview(p as unknown as Preview, 'https://allowed.com', opts);
      expect(r.background).toBeTruthy();
      expect(r.source).toBe('placeholder');
    }
  });

  it('keeps a valid dominant colour and rejects a hostile one', () => {
    expect(resolvePreview({ dominant: '#abcdef' }, 'https://a.com', opts).background).toBe('#abcdef');
    expect(resolvePreview({ dominant: 'red' }, 'https://a.com', opts).background).toMatch(/^#[0-9a-f]{6}$/i);
    expect(
      resolvePreview({ dominant: 'javascript:alert(1)' }, 'https://a.com', opts).background,
    ).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('live iframe gating', () => {
  it('never allows a live frame unless explicitly permitted', () => {
    const r = resolvePreview(
      { thumb: 'x.webp', frameable: true },
      'https://allowed.com',
      { ...opts, allowLive: false },
    );
    expect(r.live).toBe(false);
  });

  it('requires allowLive, frameable, AND an allowlisted host', () => {
    const p: Preview = { thumb: 'x.webp', frameable: true };
    expect(resolvePreview(p, 'https://allowed.com', { ...opts, allowLive: true }).live).toBe(true);
    expect(resolvePreview(p, 'https://evil.com', { ...opts, allowLive: true }).live).toBe(false);
    expect(
      resolvePreview({ ...p, frameable: false }, 'https://allowed.com', { ...opts, allowLive: true }).live,
    ).toBe(false);
  });

  it('refuses to frame anything when the allowlist is empty', () => {
    const r = resolvePreview(
      { thumb: 'x.webp', frameable: true },
      'https://anything.com',
      { framableHosts: [], allowLive: true },
    );
    expect(r.live).toBe(false);
  });
});

describe('isFramableHost', () => {
  it('matches exact hosts and subdomains', () => {
    expect(isFramableHost('https://allowed.com/x', ['allowed.com'])).toBe(true);
    expect(isFramableHost('https://app.allowed.com/x', ['allowed.com'])).toBe(true);
    expect(isFramableHost('https://notallowed.com/x', ['allowed.com'])).toBe(false);
    // A suffix match must respect the dot boundary.
    expect(isFramableHost('https://evallowed.com/x', ['allowed.com'])).toBe(false);
  });

  it('handles wildcard entries and invalid URLs', () => {
    expect(isFramableHost('https://a.b.example.com', ['*.example.com'])).toBe(true);
    expect(isFramableHost('not a url', ['example.com'])).toBe(false);
  });
});

describe('aspect ratio safety', () => {
  it('clamps to a range that cannot break the grid', () => {
    expect(safeAspectRatio(99)).toBeLessThanOrEqual(2.4);
    expect(safeAspectRatio(0.01)).toBeGreaterThanOrEqual(0.6);
    expect(safeAspectRatio(NaN)).toBe(1.6);
    expect(safeAspectRatio(null)).toBe(1.6);
    expect(safeAspectRatio(1.7778)).toBeCloseTo(1.7778, 3);
  });

  it('always picks a defined bucket', () => {
    for (const ratio of [0.1, 0.8, 1, 1.33, 1.78, 3, 99]) {
      expect(AR_BUCKETS).toContain(arBucketFor(safeAspectRatio(ratio)));
    }
  });
});

describe('isHotlinkable', () => {
  it('accepts plain http(s) and rejects everything else', () => {
    expect(isHotlinkable('https://cdn.example.com/a.png')).toBe(true);
    expect(isHotlinkable('http://cdn.example.com/a.png')).toBe(true);
    expect(isHotlinkable('javascript:alert(1)')).toBe(false);
    expect(isHotlinkable('data:image/png;base64,AAA')).toBe(false);
    expect(isHotlinkable('https://cdn.example.com:8443/a.png')).toBe(false);
    expect(isHotlinkable('nonsense')).toBe(false);
  });
});

describe('card widths and labels', () => {
  it('exposes an ascending width list including mobile-first sizes', () => {
    expect([...CARD_WIDTHS].sort((a, b) => a - b)).toEqual([...CARD_WIDTHS]);
    expect(CARD_WIDTHS[0]).toBeLessThanOrEqual(640);
  });

  it('labels every source tier', () => {
    for (const s of ['screenshot', 'video', 'og', 'favicon', 'placeholder'] as const) {
      expect(previewSourceLabel(s)).toBeTruthy();
    }
  });
});

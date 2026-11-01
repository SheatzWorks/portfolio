/**
 * Preview resolution — the guarantee that a card can never render broken.
 */
import { describe, it, expect } from 'vitest';
import {
  resolvePreview,
  safeAspectRatio,
  arBucketFor,
  AR_BUCKETS,
  isHotlinkable,
  previewSourceLabel,
  CARD_WIDTHS,
} from '../../src/lib/preview';
import type { Preview } from '../../src/lib/types';

describe('resolvePreview — fallback chain', () => {
  it('prefers our own screenshot', () => {
    const r = resolvePreview({
      thumb: 'projects/a/card-768.webp',
      thumbSrcset: ['projects/a/card-480.webp'],
      dominant: '#123456',
    });
    expect(r.imageUrl).toContain('media.example.com/projects/a/card-768.webp');
    expect(r.srcset).toContain('480w');
    expect(r.background).toBe('#123456');
    expect(r.source).toBe('screenshot');
  });

  it('falls back to the video poster when there is no thumbnail', () => {
    const r = resolvePreview({ poster: 'projects/a/poster.webp' });
    expect(r.imageUrl).toContain('poster.webp');
    expect(r.source).toBe('video');
  });

  it('falls back to the og image, then the favicon', () => {
    expect(resolvePreview({ og: 'https://cdn.example.com/o.png' }).source).toBe('og');
    expect(resolvePreview({ favicon: 'https://cdn.example.com/f.ico' }).source).toBe('favicon');
  });

  it('reaches a designed placeholder rather than an empty image', () => {
    const r = resolvePreview({});
    expect(r.source).toBe('placeholder');
    expect(r.background).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('handles null and undefined previews', () => {
    for (const p of [null, undefined]) {
      const r = resolvePreview(p as unknown as Preview);
      expect(r.background).toBeTruthy();
      expect(r.source).toBe('placeholder');
    }
  });

  it('keeps a valid dominant colour and rejects a hostile one', () => {
    expect(resolvePreview({ dominant: '#abcdef' }).background).toBe('#abcdef');
    expect(resolvePreview({ dominant: 'red' }).background).toMatch(/^#[0-9a-f]{6}$/i);
    expect(resolvePreview({ dominant: 'javascript:alert(1)' }).background).toMatch(/^#[0-9a-f]{6}$/i);
  });

  /*
   * The live iframe tier is gone. A third-party page is never rendered inside
   * this site — a screenshot, or the product's own mark, is the honest
   * rendering. The descriptor therefore has no field that could carry a
   * frame target, whatever a stored preview record happens to contain.
   */
  it('never exposes a frame target, whatever the stored record contains', () => {
    const hostile = {
      thumb: 'x.webp',
      frameable: true,
      live: true,
      liveUrl: 'https://evil.com',
    } as unknown as Preview;
    const r = resolvePreview(hostile) as unknown as Record<string, unknown>;
    expect(r.live).toBeUndefined();
    expect(r.liveUrl).toBeUndefined();
    expect(r.frameable).toBeUndefined();
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

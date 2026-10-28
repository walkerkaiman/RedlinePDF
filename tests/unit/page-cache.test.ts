import { describe, it, expect } from 'vitest';
import { PageCache, cacheKey } from '../../src/pdf/pageCache.ts';

/**
 * Page cache unit tests — pure LRU + pixel-budget logic, pdfjs mocked out.
 * A PageInfo is mocked as { canvas: { width, height } } plus passthrough fields;
 * the cache only reads canvas pixel dimensions for budget accounting.
 */

function fakeInfo(pageIndex: number, w: number, h: number) {
  return {
    pageNumber: pageIndex + 1,
    widthPts: w,
    heightPts: h,
    canvas: { width: w, height: h } as unknown as HTMLCanvasElement,
    viewport: {} as any,
  };
}

describe('cacheKey', () => {
  it('rounds scale to 3 decimals so float wheel zooms still hit', () => {
    expect(cacheKey(2, 1.1000000000000003)).toBe(cacheKey(2, 1.1));
    expect(cacheKey(2, 1.1)).toBe('2@1.100');
  });
});

describe('PageCache', () => {
  it('miss then hit for the same (page, scale)', () => {
    const c = new PageCache(1000);
    const info = fakeInfo(0, 100, 10); // 1000 px
    expect(c.get(0, 1)).toBeNull();
    c.put(0, 1, info);
    expect(c.get(0, 1)).toBe(info);
  });

  it('different scale is a different entry', () => {
    const c = new PageCache(10_000);
    c.put(0, 1, fakeInfo(0, 100, 10));
    expect(c.get(0, 2)).toBeNull();
  });

  it('evicts oldest while over the pixel budget', () => {
    const c = new PageCache(1000);
    c.put(0, 1, fakeInfo(0, 500, 1));  // 500 px
    c.put(1, 1, fakeInfo(1, 500, 1));  // 500 px → total 1000, fits
    c.put(2, 1, fakeInfo(2, 500, 1));  // 1500 > 1000 → evict page 0
    expect(c.get(0, 1)).toBeNull();
    expect(c.get(1, 1)).not.toBeNull();
    expect(c.get(2, 1)).not.toBeNull();
  });

  it('a hit refreshes recency so the re-accessed entry survives eviction', () => {
    const c = new PageCache(1000);
    c.put(0, 1, fakeInfo(0, 500, 1));
    c.put(1, 1, fakeInfo(1, 500, 1));
    c.get(0, 1);                        // page 0 becomes newest
    c.put(2, 1, fakeInfo(2, 500, 1));   // evicts page 1 (now oldest)
    expect(c.get(0, 1)).not.toBeNull();
    expect(c.get(1, 1)).toBeNull();
  });

  it('a single entry larger than the budget is stored then evicted, leaving it retrievable once', () => {
    const c = new PageCache(100);
    c.put(0, 1, fakeInfo(0, 500, 1));   // 500 > 100 budget
    expect(c.get(0, 1)).not.toBeNull(); // eviction only drops OTHER refs when this is the only entry
  });

  it('eviction never mutates the canvas (a Konva bgImage may still display it)', () => {
    const c = new PageCache(500);
    const info = fakeInfo(0, 500, 1);
    c.put(0, 1, info);
    c.put(1, 1, fakeInfo(1, 500, 1));   // evicts page 0
    expect(info.canvas.width).toBe(500); // untouched
    expect(info.canvas.height).toBe(1);
  });
});

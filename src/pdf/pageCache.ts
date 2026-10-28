import type { PageInfo } from './renderer.ts';

/**
 * Per-renderer page cache: PageInfo keyed by (pageIndex, rounded scale),
 * insertion-order LRU under a total pixel budget. Lives inside the loadPdf
 * closure — a structural op destroys the renderer and builds a new one, so
 * the cache dies with it automatically (page indices change meaning after
 * reorder/delete; never cache across renderer instances).
 */

/** Round the scale (toFixed(3)) — wheel zoom produces floats like
 * 1.1000000000000003; unrounded keys make every hit a miss. */
export function cacheKey(pageIndex: number, scale: number): string {
  return `${pageIndex}@${scale.toFixed(3)}`;
}

/** ~60 MP: a 7000×5000 canvas is 35 MP, so this caps at ~2–4 hi-res
 * entries; placeholders (scale ≤ 1) are cheap. */
export const DEFAULT_PIXEL_BUDGET = 60_000_000;

export class PageCache {
  private map = new Map<string, PageInfo>();
  private totalPixels = 0;

  constructor(private budget: number = DEFAULT_PIXEL_BUDGET) {}

  get(pageIndex: number, scale: number): PageInfo | null {
    const key = cacheKey(pageIndex, scale);
    const info = this.map.get(key);
    if (!info) return null;
    // Re-insert on hit → most-recently-used position (Map preserves insertion order).
    this.map.delete(key);
    this.map.set(key, info);
    return info;
  }

  put(pageIndex: number, scale: number, info: PageInfo): void {
    const key = cacheKey(pageIndex, scale);
    const existing = this.map.get(key);
    if (existing) this.totalPixels -= existing.canvas.width * existing.canvas.height;
    this.map.delete(key);
    this.map.set(key, info);
    this.totalPixels += info.canvas.width * info.canvas.height;
    // Evict oldest while over budget. Oldest is always evictable: the newest
    // entry (just inserted) is never dropped, so an oversized single entry
    // still survives until something newer arrives. Eviction only drops the
    // map reference — never mutate/clear a canvas (a Konva bgImage may still
    // be displaying it).
    while (this.totalPixels > this.budget && this.map.size > 1) {
      const oldestKey = this.map.keys().next().value as string;
      const oldest = this.map.get(oldestKey)!;
      this.map.delete(oldestKey);
      this.totalPixels -= oldest.canvas.width * oldest.canvas.height;
    }
  }
}

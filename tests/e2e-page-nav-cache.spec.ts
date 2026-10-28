import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Phase 3 (per-renderer page cache): revisiting a page at the same zoom must
 * be served from the cache — asserted via the __REDLINE_DEBUG seam
 * lastRenderWasCacheHit, which only the main render path sets.
 */

const PDF3_PATH = path.join(__dirname, 'fixtures', 'test-3page-mixed.pdf');

type NavDebug = { totalPages?: number; pageIndex?: number; lastRenderWasCacheHit?: boolean };
const dbg = (page: import('@playwright/test').Page) =>
  page.evaluate(() => ((window as unknown as { __REDLINE_DEBUG?: object })['__REDLINE_DEBUG'] ?? {}) as NavDebug);

async function loadPdf3(page: import('@playwright/test').Page) {
  await expect.poll(async () => (await page.locator('#file-input-pdf').count()), { timeout: 10_000 }).toBe(1);
  const loaded = async (): Promise<boolean> =>
    page.evaluate(() => { const d = ((window as unknown) as Record<string, any>)['__REDLINE_DEBUG']; return !!d && d.totalPages === 3; });
  await Promise.all([
    expect.poll(loaded, { timeout: 30_000 }).toBe(true),
    page.setInputFiles('#file-input-pdf', PDF3_PATH),
  ]);
  await expect(page.locator('#canvas-scroll-container')).toBeVisible({ timeout: 15_000 });
}

test('revisiting a page at the same zoom is a cache hit', async ({ page }) => {
  await page.goto('/');
  await loadPdf3(page);

  // First visit to page 2 (index 1): cold.
  await page.click('#btn-next-page');
  await expect.poll(async () => (await dbg(page)).pageIndex, { timeout: 10_000 }).toBe(1);
  // Back to page 1 (index 0): its placeholder AND hi-res rasters are cached
  // from the initial load at the same zoom → the render is served from cache.
  await page.click('#btn-prev-page');
  await expect.poll(async () => (await dbg(page)).pageIndex, { timeout: 10_000 }).toBe(0);
  await expect.poll(async () => (await dbg(page)).lastRenderWasCacheHit, { timeout: 10_000 }).toBe(true);
});

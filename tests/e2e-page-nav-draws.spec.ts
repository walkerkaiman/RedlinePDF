import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Phase 1 (batched draws): one navigation must not draw the same layer
 * repeatedly. Counters are incremented inside stage.ts at each sync draw()
 * (as opposed to batchDraw()); a batched navigation keeps markup sync-draws
 * at 0 and bg sync-draws at <=1.
 */

const PDF3_PATH = path.join(__dirname, 'fixtures', 'test-3page-mixed.pdf');

type NavDebug = {
  totalPages?: number; pageIndex?: number;
  drawCounts?: { markupSync: number; bgSync: number; stageSync: number };
};
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

test('a page navigation performs batched draws, not per-node sync draws', async ({ page }) => {
  await page.goto('/');
  await loadPdf3(page);

  // Navigate to page 2 and back to page 1; measure counters across both navs.
  const before = await dbg(page);
  await page.click('#btn-next-page');
  await expect.poll(async () => (await dbg(page)).pageIndex, { timeout: 10_000 }).toBe(1);
  await page.click('#btn-prev-page');
  await expect.poll(async () => (await dbg(page)).pageIndex, { timeout: 10_000 }).toBe(0);

  const after = await dbg(page);
  const dMarkup = after.drawCounts!.markupSync - before.drawCounts!.markupSync;
  const dBg = after.drawCounts!.bgSync - before.drawCounts!.bgSync;

  // Two navigations: markups are added via addMarkupNodes (one batchDraw each).
  // The only sync markup draws allowed are standalone single-node ops the page
  // -change handler runs outside any loop (legend ensure+refresh = 1 per nav).
  // The old per-node loop would add one draw per markup node.
  expect(dMarkup).toBeLessThanOrEqual(2);
  expect(dBg).toBeLessThanOrEqual(2);
});

import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Regression: loading a PDF must NOT seed count state onto the page.
 * The Count tool self-seeds a default category on first click; eagerly
 * adding one at load time painted a "Count Legend" box onto fresh documents.
 */

const PDF3_PATH = path.join(__dirname, 'fixtures', 'test-3page-mixed.pdf');

type Dbg = { totalPages?: number; markupTypes?: string[]; pageMarkups?: number[] };
const dbg = (page: import('@playwright/test').Page) =>
  page.evaluate(() => ((window as unknown as { __REDLINE_DEBUG?: object })['__REDLINE_DEBUG'] ?? {}) as Dbg);

test('a freshly loaded PDF carries no count categories or legend markup', async ({ page }) => {
  await page.goto('/');
  await expect.poll(async () => (await page.locator('#file-input-pdf').count()), { timeout: 10_000 }).toBe(1);
  await Promise.all([
    expect.poll(async () => (await dbg(page)).totalPages, { timeout: 30_000 }).toBe(3),
    page.setInputFiles('#file-input-pdf', PDF3_PATH),
  ]);
  await expect(page.locator('#canvas-scroll-container')).toBeVisible({ timeout: 15_000 });

  const d = await dbg(page);
  expect(d.markupTypes).toEqual([]);          // no count-legend (or anything) on page 0
  expect(d.pageMarkups).toEqual([0, 0, 0]);   // and none on any other page

  // The Count tool must still work without pre-seeded state: first click
  // self-seeds a category and stamps.
  await page.click('[data-tool="count"]');
  const box = await page.locator('#konva-container canvas').first().boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.5);
  await expect.poll(async () => ((await dbg(page)).markupTypes ?? []).filter(t => t === 'count').length, { timeout: 5_000 }).toBe(1);
});

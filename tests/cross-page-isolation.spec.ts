import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PDF_PATH = path.join(__dirname, 'fixtures', 'test-3page.pdf');

async function loadPdf(page: import('@playwright/test').Page) {
  await expect.poll(async () => (await page.locator('#file-input-pdf').count()), { timeout: 10_000 }).toBe(1);
  const loaded = async (): Promise<boolean> =>
    page.evaluate(() => {
      const d = (window as unknown as Record<string, any>)['__REDLINE_DEBUG'];
      return !!d && typeof d.markups === 'number' && d.markups < 0;
    });
  await Promise.all([
    expect.poll(loaded, { timeout: 30_000 }).toBe(true),
    page.setInputFiles('#file-input-pdf', PDF_PATH),
  ]);
  const scroll = page.locator('#canvas-scroll-container');
  await expect(scroll).toBeVisible({ timeout: 15_000 });
}

type RedlineDebug = { activeTool?: string | null; markups?: number; markupTypes?: string[]; pageIndex?: number };
const dbg = (page: import('@playwright/test').Page) =>
  page.evaluate(() => ((window as unknown as { __REDLINE_DEBUG?: object })['__REDLINE_DEBUG'] ?? {}) as RedlineDebug);

async function center(page: import('@playwright/test').Page) {
  const box = await page.locator('#konva-container canvas').first().boundingBox();
  if (!box) throw new Error('Konva canvas not found');
  return { x: box.x + box.width / 2, y: box.y + Math.min(box.height * 0.4, 300) };
}

test.describe('Cross-page markup isolation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await loadPdf(page);
  });

  test('markup drawn on page 1 does NOT appear on page 2', async ({ page }) => {
    // Draw a line on page 1.
    await page.click('[data-tool="line"]');
    const c = await center(page);
    await page.mouse.move(c.x - 150, c.y - 80);
    await page.mouse.down();
    await page.mouse.move(c.x + 150, c.y + 60, { steps: 4 });
    await page.mouse.up();

    // One real line markup (count-legend is a UI element, not user markup).
    const realTypes = (t: string[] = []) => t.filter((t) => t !== 'count-legend');
    expect(realTypes((await dbg(page)).markupTypes).length, 'page 1 should have 1 real markup').toBe(1);

    // Go to page 2.
    await page.click('#btn-next-page');
    await expect.poll(async () => (await dbg(page)).pageIndex, { timeout: 10_000 }).toBe(1);

    // Page 2 must be empty of user markups.
    const p2 = await dbg(page);
    expect(realTypes(p2.markupTypes).length, 'page 2 should have 0 real markups').toBe(0);

    // Return to page 1 — markup must still be there (persisted, not leaked/lost).
    await page.click('#btn-prev-page');
    await expect.poll(async () => (await dbg(page)).pageIndex, { timeout: 10_000 }).toBe(0);
    expect(realTypes((await dbg(page)).markupTypes).length, 'page 1 should still hold its markup').toBe(1);
  });
});

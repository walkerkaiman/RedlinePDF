import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF_PATH = path.join(__dirname, 'fixtures', 'test-3page.pdf');

async function loadPdf(page: import('@playwright/test').Page) {
  await expect.poll(async () => (await page.locator('#file-input-pdf').count()), { timeout: 10_000 }).toBe(1);
  const loaded = async (): Promise<boolean> =>
    page.evaluate(() => { const d = (window as any).__REDLINE_DEBUG; return !!d && typeof d.markups === 'number' && d.markups < 0; });
  await Promise.all([
    expect.poll(loaded, { timeout: 30_000 }).toBe(true),
    page.setInputFiles('#file-input-pdf', PDF_PATH),
  ]);
  await expect(page.locator('#canvas-scroll-container')).toBeVisible({ timeout: 15_000 });
}

const realTypes = (t: string[] = []) => t.filter((x) => x !== 'count-legend');

test.describe('Multi-page multi-draw — no cross-page leakage', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/'); await loadPdf(page); });

  async function drawEllipse(page: import('@playwright/test').Page) {
    await page.click('[data-tool="ellipse"]');
    const box = await page.locator('#konva-container canvas').first().boundingBox();
    if (!box) throw new Error('no canvas');
    const cx = box.x + box.width / 2, cy = box.y + Math.min(box.height * 0.4, 300);
    await page.mouse.move(cx - 80, cy - 60);
    await page.mouse.down();
    await page.mouse.move(cx + 80, cy + 60, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(150);
  }
  const snap = (page: import('@playwright/test').Page) => page.evaluate(() => {
    const d = (window as any).__REDLINE_DEBUG;
    return { page: d.pageIndex, nodes: d.renderedNodeIds.length, types: d.markupTypes as string[] };
  }).then((s) => ({ page: s.page, nodes: s.nodes, model: realTypes(s.types).length }));

  test('ellipse on page1, ellipse on page2 — each page shows only its own', async ({ page }) => {
    await drawEllipse(page);
    expect((await snap(page)).model).toBe(1);

    await page.click('#btn-next-page');
    await expect.poll(async () => (await snap(page)).page, { timeout: 10_000 }).toBe(1);
    await page.waitForTimeout(200);
    expect((await snap(page)).model, 'page2 empty before drawing').toBe(0);

    await drawEllipse(page);
    expect((await snap(page)).model, 'page2 now has 1').toBe(1);

    // Back to page 1 — must still show exactly its own 1 ellipse, NOT page2's.
    await page.click('#btn-prev-page');
    await expect.poll(async () => (await snap(page)).page, { timeout: 10_000 }).toBe(0);
    await page.waitForTimeout(200);
    const p1 = await snap(page);
    expect(p1.model, 'page1 still shows exactly 1 ellipse').toBe(1);
    expect(p1.nodes, `page1 renders 2 nodes (ellipse + legend), got ${p1.nodes}`).toBe(2);
  });
});

import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF_PATH = path.join(__dirname, 'fixtures', 'test-3page.pdf');

async function loadPdf(page: import('@playwright/test').Page) {
  await expect.poll(async () => (await page.locator('#file-input-pdf').count()), { timeout: 10_000 }).toBe(1);
  const loaded = async (): Promise<boolean> =>
    page.evaluate(() => {
      const d = ((window as unknown) as Record<string, any>)['__REDLINE_DEBUG'];
      return !!d && typeof d.markups === 'number' && d.markups < 0;
    });
  await Promise.all([
    expect.poll(loaded, { timeout: 30_000 }).toBe(true),
    page.setInputFiles('#file-input-pdf', PDF_PATH),
  ]);
  const scroll = page.locator('#canvas-scroll-container');
  await expect(scroll).toBeVisible({ timeout: 15_000 });
}

const pt = async (page: import('@playwright/test').Page, fx: number, fy: number) => {
  const box = await page.locator('#konva-container canvas').first().boundingBox();
  if (!box) throw new Error('Konva canvas not found');
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
};

const polyMarkups = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const d = (window as unknown as any).__REDLINE_DEBUG;
    return (d.markupTypes as string[]).filter((t: string) => t === 'polygon-area').length;
  });

test('polygon area tool: click vertices then click first vertex closes a polygon markup', async ({ page }) => {
  await page.goto('/');
  await loadPdf(page);
  await page.click('[data-tool="polygon-area"]');

  const p1 = await pt(page, 0.35, 0.35);
  const p2 = await pt(page, 0.65, 0.35);
  const p3 = await pt(page, 0.5, 0.6);
  await page.mouse.click(p1.x, p1.y);
  await page.mouse.click(p2.x, p2.y);
  await page.mouse.click(p3.x, p3.y);
  // Click back on the FIRST vertex to close (shared-vertex join).
  await page.mouse.click(p1.x, p1.y);

  await expect.poll(() => polyMarkups(page), { timeout: 5_000 }).toBe(1);
});

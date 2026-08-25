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

test('set scale tool: two clicks open the calibration dialog', async ({ page }) => {
  await page.goto('/');
  await loadPdf(page);
  await page.click('[data-tool="scale-set"]');

  const a = await pt(page, 0.35, 0.4);
  const b = await pt(page, 0.6, 0.55);
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y);

  // Calibration modal should appear with the distance input.
  const input = page.locator('#scale-value');
  await expect(input).toBeVisible({ timeout: 5_000 });
});

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
  await expect(page.locator('#canvas-scroll-container')).toBeVisible({ timeout: 15_000 });
}

const pt = async (page: import('@playwright/test').Page, fx: number, fy: number) => {
  const box = await page.locator('#konva-container canvas').first().boundingBox();
  if (!box) throw new Error('Konva canvas not found');
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
};
const types = (page: import('@playwright/test').Page, t: string) =>
  page.evaluate((tt: string) => {
    const d = (window as unknown as any).__REDLINE_DEBUG;
    return (d.markupTypes as string[]).filter((x: string) => x === tt).length;
  }, t);

// Real flow: selecting a measure tool with no scale redirects to Set Scale.
// Calibrate, then the redirect returns to the measure tool and we can draw.
async function calibrate(page: import('@playwright/test').Page) {
  const a = await pt(page, 0.3, 0.3);
  const b = await pt(page, 0.5, 0.3);
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y);
  const modal = page.locator('#scale-value');
  await expect(modal).toBeVisible({ timeout: 5_000 });
  await modal.fill('10');
  await page.locator('#scale-unit').selectOption({ label: 'in' }).catch(() => {});
  await page.locator('#modal-ok').click();
}

test('measure-linear: after calibration, drag commits a linear dimension markup', async ({ page }) => {
  await page.goto('/'); await loadPdf(page);
  await page.click('[data-tool="measure-linear"]'); // redirects to scale-set
  await calibrate(page);

  const a = await pt(page, 0.3, 0.5), b = await pt(page, 0.6, 0.5);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => types(page, 'measure-linear'), { timeout: 5_000 }).toBe(1);
});

test('measure-rect: after calibration, drag commits a rectangle-area markup', async ({ page }) => {
  await page.goto('/'); await loadPdf(page);
  await page.click('[data-tool="measure-rect"]');
  await calibrate(page);

  const a = await pt(page, 0.3, 0.35), b = await pt(page, 0.6, 0.6);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => types(page, 'measure-rect'), { timeout: 5_000 }).toBe(1);
});

test('measure-poly: after calibration, click vertices then first vertex commits a polygon measurement', async ({ page }) => {
  await page.goto('/'); await loadPdf(page);
  await page.click('[data-tool="measure-poly"]');
  await calibrate(page);

  const p1 = await pt(page, 0.35, 0.35), p2 = await pt(page, 0.65, 0.35), p3 = await pt(page, 0.5, 0.6);
  await page.mouse.click(p1.x, p1.y);
  await page.mouse.click(p2.x, p2.y);
  await page.mouse.click(p3.x, p3.y);
  await page.mouse.click(p1.x, p1.y);
  await expect.poll(() => types(page, 'measure-poly'), { timeout: 5_000 }).toBe(1);
});

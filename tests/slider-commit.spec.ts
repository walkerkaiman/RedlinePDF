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

const countSymbolSize = (page: import('@playwright/test').Page) =>
  page.evaluate(() => ((window as unknown) as Record<string, any>)['__REDLINE_DEBUG'].countSymbolSize as number);

function sizeSlider(page: import('@playwright/test').Page) {
  return page.locator('div.prop-row:has(label:text("Size")) input[type="range"]').first();
}

test('slider: dragging the count Size slider and releasing commits the new value (smooth, commit on mouseup)', async ({ page }) => {
  await page.goto('/'); await loadPdf(page);
  await page.click('[data-tool="count"]'); // opens count tool panel with the Size slider

  const slider = sizeSlider(page);
  await expect(slider).toBeVisible({ timeout: 5_000 });
  const before = await countSymbolSize(page);

  const box = (await slider.boundingBox())!;
  // Drag thumb from left to right to max it out (4 -> 32).
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();

  // After release, countSymbolSize should reflect the new (max) value.
  await expect.poll(() => countSymbolSize(page), { timeout: 5_000 }).toBe(32); // max of the Size slider
  expect(before).not.toBe(32);
});

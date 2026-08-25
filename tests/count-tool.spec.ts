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

const centerPoint = async (page: import('@playwright/test').Page, dy = 0) => {
  const box = await page.locator('#konva-container canvas').first().boundingBox();
  if (!box) throw new Error('Konva canvas not found');
  return { x: box.x + box.width / 2, y: box.y + Math.min(box.height * 0.4, 300) + dy };
};

const countMarkups = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const d = (window as unknown as any).__REDLINE_DEBUG;
    return (d.markupTypes as string[]).filter((t: string) => t === 'count').length;
  });

const activeCat = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as any).__REDLINE_DEBUG.activeCountCategoryId);

test('count tool: still commits after the active category is cleared (seeds a default)', async ({ page }) => {
  await page.goto('/');
  await loadPdf(page);
  await page.click('[data-tool="count"]');

  // Delete the seeded default category via the panel delete button.
  const delBtn = page.locator('.count-delete-btn').first();
  await expect(delBtn).toBeVisible({ timeout: 5_000 });
  await delBtn.click();
  await page.waitForTimeout(150);

  // Now no active category — a click must seed one and still stamp.
  await expect.poll(() => activeCat(page), { timeout: 3_000 }).toBeNull();

  const before = await countMarkups(page);
  const c = await centerPoint(page);
  await page.mouse.move(c.x + 60, c.y - 40, { steps: 2 });
  await page.mouse.down();
  await page.mouse.up();

  await expect.poll(() => countMarkups(page), { timeout: 5_000 }).toBe(before + 1);
});

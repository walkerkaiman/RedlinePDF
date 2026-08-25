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

const centerPoint = async (page: import('@playwright/test').Page) => {
  const box = await page.locator('#konva-container canvas').first().boundingBox();
  if (!box) throw new Error('Konva canvas not found');
  return { x: box.x + box.width / 2, y: box.y + Math.min(box.height * 0.4, 300) };
};

test('text tool: clicking canvas opens editor and commits a text markup', async ({ page }) => {
  await page.goto('/');
  await loadPdf(page);

  await page.click('[data-tool="text"]');
  const c = await centerPoint(page);
  await page.mouse.click(c.x, c.y);

  const editor = page.locator('textarea').last();
  await expect(editor).toBeVisible({ timeout: 5_000 });
  await editor.fill('hello redline');
  await editor.press('Shift+Enter');

  await expect.poll(async () => {
    return await page.evaluate(() => {
      const d = (window as unknown as any).__REDLINE_DEBUG;
      return (d.markupTypes as string[]).filter((t: string) => t === 'text').length;
    });
  }, { timeout: 5_000 }).toBe(1);
});

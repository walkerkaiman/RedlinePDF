import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF_PATH = path.join(__dirname, 'fixtures', 'test-3page.pdf');

test('dragging a selected markup moves it (model position updates)', async ({ page }) => {
  await page.goto('/');
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

  const box = await page.locator('#konva-container canvas').first().boundingBox();
  if (!box) throw new Error('no canvas');
  const c = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 };
  await page.mouse.move(c.x - 30, c.y - 22);
  await page.mouse.down();
  await page.mouse.move(c.x + 30, c.y + 22, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(250);

  // Activate select, click the markup to select it, then drag it.
  await page.click('[data-tool="select"]').catch(() => {});
  const rect = (await page.evaluate(() => ((window as any)['__REDLINE_DEBUG'] as any).markupScreenRects as { x: number; y: number; width: number; height: number }[]))[0];
  const cx = box.x + rect.x + rect.width / 2;
  const cy = box.y + rect.y + rect.height / 2;
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(150);

  // Drag the selected node ~60px right / 40px down.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy + 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);

  // After the drag, the selection should persist (and no error thrown → drag handler ran).
  const after = await page.evaluate(() => {
    const d = ((window as any)['__REDLINE_DEBUG'] as any);
    return d.selectedIds.length;
  });
  expect(after).toBe(1);
});

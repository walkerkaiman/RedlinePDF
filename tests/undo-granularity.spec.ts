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

const canvasBox = async (page: import('@playwright/test').Page) => {
  const box = await page.locator('#konva-container canvas').first().boundingBox();
  if (!box) throw new Error('no canvas');
  return box;
};

const boxRects = async (page: import('@playwright/test').Page) =>
  page.evaluate(() => ((window as any).__REDLINE_DEBUG.markupScreenRects as { type: string; x: number; y: number; width: number; height: number }[]).filter((r) => r.type === 'box'));

async function drawBox(page: import('@playwright/test').Page, c: { x: number; y: number; width: number; height: number }, x0: number, y0: number, x1: number, y1: number) {
  await page.click('[data-tool="box"]');
  await page.mouse.move(c.x + x0, c.y + y0);
  await page.mouse.down();
  await page.mouse.move(c.x + x1, c.y + y1, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

test.describe('Undo granularity', () => {
  test('every action is one undo step; drags are undoable', async ({ page }) => {
    await page.goto('/');
    await loadPdf(page);
    const c = await canvasBox(page);

    // Draw two boxes.
    await drawBox(page, c, 60, 60, 180, 140);
    await expect.poll(() => boxRects(page).then((r) => r.length)).toBe(1);
    await drawBox(page, c, 240, 200, 360, 280);
    await expect.poll(() => boxRects(page).then((r) => r.length)).toBe(2);

    // Drag box2 (grab its center, move it 60px).
    const before = (await boxRects(page)).find((r) => r.x > 200)!;
    const cx = c.x + before.x + before.width / 2;
    const cy = c.y + before.y + before.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 60, cy + 40, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const moved = (await boxRects(page)).find((r) => r.x > 200)!;
    expect(moved.x).toBeGreaterThan(before.x + 20); // drag applied
    expect((await boxRects(page)).length).toBe(2);

    // Undo #1: reverts ONLY the drag — both boxes still exist.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(250);
    const afterUndo1 = await boxRects(page);
    expect(afterUndo1.length).toBe(2);
    const restored = afterUndo1.find((r) => r.x > 150)!;
    expect(Math.abs(restored.x - before.x)).toBeLessThan(3);

    // Undo #2: removes box2 only.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(250);
    await expect.poll(() => boxRects(page).then((r) => r.length)).toBe(1);

    // Undo #3: removes box1.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(250);
    await expect.poll(() => boxRects(page).then((r) => r.length)).toBe(0);

    // Redo: one step at a time again.
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(250);
    await expect.poll(() => boxRects(page).then((r) => r.length)).toBe(1);
  });

  test('transformer resize is one undo step', async ({ page }) => {
    await page.goto('/');
    await loadPdf(page);
    const c = await canvasBox(page);

    await drawBox(page, c, 60, 60, 180, 140);
    await page.click('[data-tool="select"]');
    await page.mouse.click(c.x + 120, c.y + 100); // select
    await page.waitForTimeout(200);

    // Drag bottom-right transformer anchor outward.
    const r = (await boxRects(page))[0];
    const ax = c.x + r.x + r.width + 4; // anchor sits near the corner
    const ay = c.y + r.y + r.height + 4;
    await page.mouse.move(ax, ay);
    await page.mouse.down();
    await page.mouse.move(ax + 70, ay + 50, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const grown = (await boxRects(page))[0];
    expect(grown.width).toBeGreaterThan(r.width + 30);

    // Undo: back to original width, box still present.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(250);
    const back = await boxRects(page);
    expect(back.length).toBe(1);
    expect(Math.abs(back[0].width - r.width)).toBeLessThan(3);
  });
});

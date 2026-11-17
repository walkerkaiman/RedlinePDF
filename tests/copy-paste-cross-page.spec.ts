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

async function pageMarkups(page: import('@playwright/test').Page): Promise<number[]> {
  return page.evaluate(() => ((window as any).__REDLINE_DEBUG.pageMarkups as number[]).slice());
}

async function boxRects(page: import('@playwright/test').Page) {
  return page.evaluate(() => ((window as any).__REDLINE_DEBUG.markupScreenRects as { type: string; x: number; y: number; width: number; height: number }[]).filter((r) => r.type === 'box'));
}

test.describe('Cross-page copy/paste', () => {
  test('copy on page 1, paste on page 2 lands at the same position', async ({ page }) => {
    await page.goto('/');
    await loadPdf(page);

    // Draw a box on page 1 (drawing tools auto-select their result).
    await page.click('[data-tool="box"]');
    const c = await canvasBox(page);
    const mid = { x: c.x + c.width * 0.5, y: c.y + c.height * 0.4 };
    await page.mouse.move(mid.x - 60, mid.y - 40);
    await page.mouse.down();
    await page.mouse.move(mid.x + 60, mid.y + 40, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(250);

    const before = await pageMarkups(page);
    const r0 = (await boxRects(page))[0];
    expect(r0).toBeTruthy();

    // Copy (Ctrl+C) — paste button must light up.
    await page.keyboard.press('Control+c');
    await expect(page.locator('#btn-paste')).toBeEnabled({ timeout: 3_000 });

    // Go to page 2 and paste (Ctrl+V).
    await page.click('#btn-next-page');
    await page.waitForTimeout(400);
    const onPage2Before = await pageMarkups(page);
    expect(onPage2Before[1]).toBe(0);

    await page.keyboard.press('Control+v');
    await page.waitForTimeout(300);

    const after = await pageMarkups(page);
    expect(after[0]).toBe(before[0]);        // source page untouched
    expect(after[1]).toBe(onPage2Before[1] + 1); // new page gained exactly one markup

    // Matched position: same page size/zoom, so the pasted box must sit at the
    // exact same screen rect as the original.
    const r1 = (await boxRects(page))[0];
    expect(Math.abs(r1.x - r0.x)).toBeLessThan(2);
    expect(Math.abs(r1.y - r0.y)).toBeLessThan(2);
    expect(Math.abs(r1.width - r0.width)).toBeLessThan(2);
    expect(Math.abs(r1.height - r0.height)).toBeLessThan(2);

    // Pasted markup is selected with a fresh id (no collision with original).
    const sel = await page.evaluate(() => ((window as any).__REDLINE_DEBUG as any).selectedMarkup);
    expect(sel?.type).toBe('box');
  });
});

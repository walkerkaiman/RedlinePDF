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

async function textRect(page: import('@playwright/test').Page) {
  const rects = await page.evaluate(() => ((window as any).__REDLINE_DEBUG.markupScreenRects as { type: string; x: number; y: number; width: number; height: number }[]).filter((r) => r.type === 'text'));
  if (!rects.length) throw new Error('no text markup rect');
  return rects[0];
}

const markupCount = async (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as any).__REDLINE_DEBUG.markupTypes.filter((t: string) => t === 'text').length);

test.describe('Text box re-editing', () => {
  test('dblclick after clicking away reopens the editor prefilled; commit updates the text', async ({ page }) => {
    await page.goto('/');
    await loadPdf(page);

    // Create a text markup.
    await page.click('[data-tool="text"]');
    const c = await canvasBox(page);
    await page.mouse.click(c.x + c.width / 2, c.y + c.height * 0.35);
    const editor = page.locator('textarea').last();
    await expect(editor).toBeVisible({ timeout: 5_000 });
    await editor.fill('first version');
    await editor.press('Shift+Enter');
    await expect.poll(() => markupCount(page), { timeout: 5_000 }).toBe(1);

    // Click away (deselect) — the user's repro: after this the box seemed dead.
    await page.click('[data-tool="select"]').catch(() => {});
    await page.mouse.click(c.x + 20, c.y + c.height - 20);
    await page.waitForTimeout(200);

    // Double-click the text box -> editor reopens PRE-FILLED.
    const r = await textRect(page);
    await page.mouse.dblclick(c.x + r.x + r.width / 2, c.y + r.y + r.height / 2);
    const editor2 = page.locator('textarea').last();
    await expect(editor2).toBeVisible({ timeout: 5_000 });
    await expect(editor2).toHaveValue('first version');

    // Edit and commit.
    await editor2.fill('edited version');
    await editor2.press('Shift+Enter');
    await page.waitForTimeout(300);

    await expect.poll(() => markupCount(page), { timeout: 5_000 }).toBe(1); // updated in place, not duplicated
    const sel = await page.evaluate(() => ((window as any).__REDLINE_DEBUG as any).selectedMarkup);
    expect(sel?.type).toBe('text');
    expect(sel?.text).toBe('edited version');
  });

  test('emptying the text on re-edit deletes the markup (undoable)', async ({ page }) => {
    await page.goto('/');
    await loadPdf(page);

    await page.click('[data-tool="text"]');
    const c = await canvasBox(page);
    await page.mouse.click(c.x + c.width / 2, c.y + c.height * 0.35);
    const editor = page.locator('textarea').last();
    await expect(editor).toBeVisible({ timeout: 5_000 });
    await editor.fill('doomed text');
    await editor.press('Shift+Enter');
    await expect.poll(() => markupCount(page), { timeout: 5_000 }).toBe(1);

    const r = await textRect(page);
    await page.mouse.dblclick(c.x + r.x + r.width / 2, c.y + r.y + r.height / 2);
    const editor2 = page.locator('textarea').last();
    await expect(editor2).toBeVisible({ timeout: 5_000 });
    await editor2.fill('');
    await editor2.press('Shift+Enter');
    await page.waitForTimeout(300);

    await expect.poll(() => markupCount(page), { timeout: 5_000 }).toBe(0);
  });
});

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

async function textScreenRect(page: import('@playwright/test').Page) {
  const rects = await page.evaluate(() => ((window as any)['__REDLINE_DEBUG'] as any).markupScreenRects as { type: string; x: number; y: number; width: number; height: number }[]);
  const t = rects.find((r) => r.type === 'text');
  if (!t) throw new Error(`no text markup rect; got ${JSON.stringify(rects.map(r => r.type))}`);
  return t;
}

test.describe('Text markup scaling via transformer handles', () => {
  test('dragging a transformer anchor on a text box grows its fontSize (baked, persists)', async ({ page }) => {
    await page.goto('/');
    await loadPdf(page);

    // Commit a text markup.
    await page.click('[data-tool="text"]');
    const c0 = await canvasBox(page);
    await page.mouse.click(c0.x + c0.width / 2, c0.y + Math.min(c0.height * 0.4, 300));
    const editor = page.locator('textarea').last();
    await expect(editor).toBeVisible({ timeout: 5_000 });
    await editor.fill('scale me');
    await editor.press('Shift+Enter');
    await expect.poll(async () => {
      return await page.evaluate(() => ((window as any).__REDLINE_DEBUG.markupTypes as string[]).filter((t: string) => t === 'text').length);
    }, { timeout: 5_000 }).toBe(1);

    // Select the text markup.
    await page.click('[data-tool="select"]').catch(() => {});
    const r0 = await textScreenRect(page);
    const box = await canvasBox(page);
    await page.mouse.click(box.x + r0.x + r0.width / 2, box.y + r0.y + r0.height / 2);
    await page.waitForTimeout(200);

    const before = await page.evaluate(() => ((window as any)['__REDLINE_DEBUG'] as any).selectedMarkup);
    expect(before?.type).toBe('text');
    const fontBefore = before?.style?.fontSize ?? 12;

    // Grab the bottom-right transformer anchor (rect corner) and drag outward.
    const anchor = { x: box.x + r0.x + r0.width, y: box.y + r0.y + r0.height };
    await page.mouse.move(anchor.x, anchor.y);
    await page.mouse.down();
    await page.mouse.move(anchor.x + 70, anchor.y + 50, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    const after = await page.evaluate(() => ((window as any)['__REDLINE_DEBUG'] as any).selectedMarkup);
    console.log('BEFORE>', JSON.stringify({ fontSize: fontBefore, w: r0.width, h: r0.height }));
    console.log('AFTER>', JSON.stringify({ fontSize: after?.style?.fontSize }));

    // Model must reflect the scale (baked into fontSize, not a transient node scale).
    expect(after?.type).toBe('text');
    expect(after?.style?.fontSize).toBeGreaterThan(fontBefore);

    // The rendered box must stay bigger (no snap-back).
    const r1 = await textScreenRect(page);
    expect(r1.height).toBeGreaterThan(r0.height);

    // Persistence proof: navigate away and back — the node is rebuilt from the
    // model, so a transient scale would be gone.
    await page.click('#btn-next-page');
    await page.waitForTimeout(400);
    await page.click('#btn-prev-page');
    await page.waitForTimeout(400);
    const r2 = await textScreenRect(page);
    expect(r2.height).toBeGreaterThan(r0.height);
  });
});

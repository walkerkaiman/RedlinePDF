import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // package.json is "type": "module" — no bare __dirname

/**
 * Draw pipeline e2e — the single deterministic spec for "tools commit markups".
 *
 * Asserts via window.__REDLINE_DEBUG (read-only seam in src/main.ts: active tool + live page markup list),
 * NOT canvas pixels — Konva renders to raw <canvas>, so pixel/DOM-count checks are non-deterministic.
 */

const PDF_PATH = path.join(__dirname, 'fixtures', 'test.pdf');

/** Load the fixture PDF through the real file-input handler and wait until a page exists in app state. */
async function loadPdf(page: import('@playwright/test').Page) {
  await expect.poll(async () => (await page.locator('#file-input-pdf').count()), { timeout: 10_000 }).toBe(1);

  const loaded = async (): Promise<boolean> =>
    // markups === -1 in the debug seam means "page exists, zero marks" (see main.ts __REDLINE_DEBUG).
    page.evaluate(() => { const d = ((window as unknown) as Record<string, any>)['__REDLINE_DEBUG']; return !!d && typeof d.markups === 'number' && d.markups < 0; });

  await Promise.all([
    expect.poll(loaded, { timeout: 30_000 }).toBe(true), // race the async pdfjs render
    page.setInputFiles('#file-input-pdf', PDF_PATH),
  ]);

  const scroll = page.locator('#canvas-scroll-container');
  await expect(scroll).toBeVisible({ timeout: 15_000 });
}

type RedlineDebug = { activeTool?: string | null; markups?: number; markupTypes?: string[] };
const dbg = (page: import('@playwright/test').Page) =>
  page.evaluate(() => ((window as unknown as { __REDLINE_DEBUG?: object })['__REDLINE_DEBUG'] ?? {}) as RedlineDebug);

test.describe('Draw pipeline — tools commit markups end to end', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await loadPdf(page);
  });

  // Deterministic click target: center of the visible canvas viewport (page content fills it after fit).
  async function centerPoint(page: import('@playwright/test').Page) {
    const box = await page.locator('#konva-container canvas').first().boundingBox();
    if (!box) throw new Error('Konva canvas not found');
    return { x: box.x + box.width / 2, y: box.y + Math.min(box.height * 0.4, 300), w: box.width, h: box.height };
  }

  test('line tool → drag commits a line markup', async ({ page }) => {
    await page.click('[data-tool="line"]');
    expect(await dbg(page)).toMatchObject({ activeTool: 'line' }); // Fix A entry resolves the protocol (would be null/undefined otherwise)

    const before = (await dbg(page)).markups ?? 0;
    const c = await centerPoint(page);
    await page.mouse.move(c.x - 150, c.y - 80);
    await page.mouse.down();
    await page.mouse.move(c.x + 150, c.y + 60, { steps: 4 }); // midDraw moves preview shape
    await page.mouse.up();

    const after = await dbg(page);
    expect(after.markups).toBe(before + 1); // Fix B handler pushed to page.markups (was silently swallowed before)
    expect(after.markupTypes ?? []).toEqual(expect.arrayContaining(['line']));
  });

  test('box tool → drag commits a box markup at PDF-space coordinates', async ({ page }) => {
    await page.click('[data-tool="box"]');
    const c = await centerPoint(page);
    await page.mouse.move(c.x - 100, c.y - 60);
    await page.mouse.down();
    await page.mouse.move(c.x + 120, c.y + 80, { steps: 3 });
    await page.mouse.up();

    const after = (await dbg(page)).markupTypes ?? [];
    expect(after).toContain('box'); // konvaToPdf coordinate conversion landed in a finite geometry
  });

  test('count tool → click commits a count stamp', async ({ page }) => {
    await page.click('[data-tool="count"]');
    const c = await centerPoint(page);
    await page.mouse.move(c.x + 60, c.y - 40, { steps: 2 }); // avoid the Konva default-position overlap zone
    await page.mouse.down();
    await page.mouse.up();

    expect((await dbg(page)).markupTypes ?? []).toContain('count');
  });
});

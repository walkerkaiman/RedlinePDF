import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // package.json is "type": "module" — no bare __dirname

/**
 * Pen tool regression spec.
 *
 * Migration commit 1455e54 converted twelve tools to ToolProtocol objects but
 * never touched penTool.ts: it stayed a class-based BaseTool that nothing
 * imports, and 'pen' has no entry in main.ts's toolProtocols map — so the Pen
 * toolbar button resolved to setActiveTool(undefined), zero listeners bound,
 * every stroke silently discarded. Symptom reported from installed 0.2.4:
 * "the pen tool is not drawing to the canvas."
 */

const PDF_PATH = path.join(__dirname, 'fixtures', 'test.pdf');

/** Load the fixture PDF through the real file-input handler (same pattern as e2e-draw-pipeline). */
async function loadPdf(page: import('@playwright/test').Page) {
  await expect.poll(async () => (await page.locator('#file-input-pdf').count()), { timeout: 10_000 }).toBe(1);

  const loaded = async (): Promise<boolean> =>
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

/** Deterministic S-curve drag across the canvas center — enough midDraw points for a freehand stroke. */
async function drawPenStroke(page: import('@playwright/test').Page) {
  const box = await page.locator('#konva-container canvas').first().boundingBox();
  if (!box) throw new Error('Konva canvas not found');
  const cx = box.x + box.width / 2;
  const cy = box.y + Math.min(box.height * 0.4, 300);

  await page.mouse.move(cx - 160, cy - 80);
  await page.mouse.down();
  // S-curve: several intermediate moves so midDraw appends real points (>= 2 pairs).
  await page.mouse.move(cx - 90, cy + 40, { steps: 3 });
  await page.mouse.move(cx, cy - 50, { steps: 3 });
  await page.mouse.move(cx + 100, cy + 60, { steps: 3 });
  await page.mouse.move(cx + 170, cy - 20, { steps: 2 });
  await page.mouse.up();
}

test.describe('Pen tool — freehand strokes commit', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await loadPdf(page);
  });

  test('pen drag commits a pen markup and releases to select', async ({ page }) => {
    await page.click('[data-tool="pen"]');
    expect((await dbg(page)).activeTool).toBe('pen'); // state entry resolves (listeners are the real fix)

    const before = (await dbg(page)).markups ?? 0;
    await drawPenStroke(page);

    const after = await dbg(page);
    expect(after.markups).toBe(before + 1); // stroke reached page.markups via ADD_MARKUP
    expect(after.markupTypes ?? []).toContain('pen');
    expect(after.activeTool).toBe('select'); // addMarkup() auto-switches to select on commit
  });

  test('sub-threshold pen click discards the stroke and stays in pen mode', async ({ page }) => {
    await page.click('[data-tool="pen"]');

    const before = (await dbg(page)).markups ?? 0;
    const box = await page.locator('#konva-container canvas').first().boundingBox();
    if (!box) throw new Error('Konva canvas not found');
    const cx = box.x + box.width / 2;
    const cy = box.y + Math.min(box.height * 0.4, 300);

    // Bare click: one down point + at most one move — under the 2-point commit threshold.
    await page.mouse.move(cx + 60, cy - 40);
    await page.mouse.down();
    await page.mouse.up();

    const after = await dbg(page);
    expect(after.markups).toBe(before); // tiny stroke must NOT commit
    expect(after.activeTool).toBe('pen'); // tool stays engaged for the next real stroke
  });
});

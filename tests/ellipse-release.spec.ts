import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF_PATH = path.join(__dirname, 'fixtures', 'test.pdf');

/**
 * Ellipse tool release regression — user-reported bug (2026-08-25):
 * "When a circle is drawn, it never releases the circle tool so clicking
 *  the radius distance will start drawing an additional circle."
 *
 * Expected behavior after fix:
 * 1. Drawing an ellipse commits exactly one markup.
 * 2. After commit, addMarkup() auto-switches to select (like box/line) — no click
 *    can immediately re-enter a new draw gesture.
 * 3. A plain canvas click (e.g. measuring radius) adds ZERO markups and no console errors.
 * 4. Drawing a second ellipse later still works, commits exactly one more markup.
 */
test.describe('Ellipse tool releases after commit', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect.poll(async () => (await page.locator('#file-input-pdf').count()), { timeout: 10_000 }).toBe(1);

    const loaded = async () =>
      page.evaluate(() => {
        const d = ((window as unknown) as Record<string, any>)['__REDLINE_DEBUG'];
        return !!d && typeof d.markups === 'number' && d.markups < 0;
      });

    await Promise.all([
      expect.poll(loaded, { timeout: 30_000 }).toBe(true),
      page.setInputFiles('#file-input-pdf', PDF_PATH),
    ]);
  });

  const dbg = (page) =>
    page.evaluate(() => {
      const d = ((window as unknown) as Record<string, any>)['__REDLINE_DEBUG'];
      return { activeTool: d.activeTool, markups: d.markups, types: [...d.markupTypes] };
    });

  async function drawEllipse(page, x1, y1, x2, y2) {
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.move(x2, y2, { steps: 6 });
    await page.mouse.up();
  }

  async function center(page): Promise<{ x: number; y: number }> {
    const box = (await page.locator('#konva-container canvas').first().boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + Math.min(box.height * 0.45, 380) };
  }

  test('ellipse commits one markup and releases to select', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.click('[data-tool="ellipse"]');
    expect((await dbg(page)).activeTool).toBe('ellipse');

    const c = await center(page);
    const before = (await dbg(page)).markups;
    // Drag outward ~120pt so final radius comfortably exceeds the 4pt commit threshold.
    await drawEllipse(page, c.x - 150, c.y, c.x - 30, c.y);

    const afterDraw = await dbg(page);
    expect(afterDraw.markups).toBe(before + 1);
    expect(afterDraw.types).toContain('ellipse');

    // THE bug: tool must release to select right after commit (addMarkup parity with box/line).
    expect(afterDraw.activeTool).toBe('select');

    // A plain canvas click — the user's "clicking the radius distance" gesture —
    // must NOT start another draw: markup count unchanged, no runtime errors.
    await page.mouse.click(c.x - 30, c.y);
    await page.waitForTimeout(300);
    const afterClick = await dbg(page);
    expect(afterClick.markups).toBe(before + 1);
    expect(errors.filter((e) => /endDraw|points/i.test(e))).toEqual([]);

    // Second draw still works and releases again.
    await page.click('[data-tool="ellipse"]');
    const before2 = (await dbg(page)).markups;
    await drawEllipse(page, c.x + 10, c.y - 60, c.x + 90, c.y + 40);
    const afterSecond = await dbg(page);
    expect(afterSecond.markups).toBe(before2 + 1);
    expect(afterSecond.activeTool).toBe('select');

    await page.screenshot({ path: 'test-results/ellipse-release.png' });
  });
});

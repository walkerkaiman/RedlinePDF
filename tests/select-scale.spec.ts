import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF_PATH = path.join(__dirname, 'fixtures', 'test-3page.pdf');

async function loadPdf(page: import('@playwright/test').Page) {
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

async function drawBox(page: import('@playwright/test').Page) {
  await page.click('[data-tool="box"]').catch(() => {}); // ensure box tool is active (default is select)
  const box = await canvasBox(page);
  const c = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 };
  await page.mouse.move(c.x - 40, c.y - 30);
  await page.mouse.down();
  await page.mouse.move(c.x + 40, c.y + 30, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

// Screen-space rect of the (first) box markup. The count-legend is also a markup node, so we
// must filter by type — otherwise we'd click the legend and assert the wrong element.
async function boxScreenRect(page: import('@playwright/test').Page) {
  const rects = await page.evaluate(() => ((window as any)['__REDLINE_DEBUG'] as any).markupScreenRects as { type: string; x: number; y: number; width: number; height: number }[]);
  const b = rects.find((r) => r.type === 'box');
  if (!b) throw new Error(`no box markup rect; got ${JSON.stringify(rects.map(r => r.type))}`);
  return b;
}

test.describe('Select tool: scale + highlight alignment', () => {
  test('BUG A: dragging a transformer anchor scales the selected box (model updates)', async ({ page }) => {
    await page.goto('/');
    await loadPdf(page);
    await drawBox(page);

    // Select the box.
    await page.click('[data-tool="select"]').catch(() => {});
    const r0 = await boxScreenRect(page);
    const cx = r0.x + r0.width / 2, cy = r0.y + r0.height / 2;
    const box = await canvasBox(page);
    await page.mouse.click(box.x + cx, box.y + cy);
    await page.waitForTimeout(200);

    const before = await page.evaluate(() => ((window as any)['__REDLINE_DEBUG'] as any).selectedMarkup);
    expect(before?.type).toBe('box');
    expect(before?.width).toBeGreaterThan(0);

    // Grab the bottom-right transformer anchor and drag it outward to enlarge the box.
    const anchor = { x: box.x + cx + r0.width / 2, y: box.y + cy + r0.height / 2 };
    await page.mouse.move(anchor.x, anchor.y);
    await page.mouse.down();
    await page.mouse.move(anchor.x + 80, anchor.y + 60, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    const after = await page.evaluate(() => ((window as any)['__REDLINE_DEBUG'] as any).selectedMarkup);
    console.log('BEFORE>', JSON.stringify(before));
    console.log('AFTER>', JSON.stringify(after));
    // The model dimensions must have grown after the resize drag.
    expect(after?.type).toBe('box');
    expect(after?.width).toBeGreaterThan(before?.width ?? 0);
    expect(after?.height).toBeGreaterThan(before?.height ?? 0);
  });

  test('BUG B: the blue selection highlight aligns with the selected element (no offset)', async ({ page }) => {
    await page.goto('/');
    await loadPdf(page);
    await drawBox(page);

    // Select the box.
    await page.click('[data-tool="select"]').catch(() => {});
    const r0 = await boxScreenRect(page);
    const cx = r0.x + r0.width / 2, cy = r0.y + r0.height / 2;
    const box = await canvasBox(page);
    await page.mouse.click(box.x + cx, box.y + cy);
    await page.waitForTimeout(200);

    const overlay = await page.evaluate(() => ((window as any)['__REDLINE_DEBUG'] as any).selectOverlayRects as { x: number; y: number; width: number; height: number }[]);
    expect(overlay.length).toBe(1);
    // The highlight must sit on the markup, not beside it. Allow a 2px tolerance.
    const o = overlay[0];
    expect(Math.abs(o.x - r0.x)).toBeLessThan(2);
    expect(Math.abs(o.y - r0.y)).toBeLessThan(2);
    expect(Math.abs(o.width - r0.width)).toBeLessThan(2);
    expect(Math.abs(o.height - r0.height)).toBeLessThan(2);
  });
});

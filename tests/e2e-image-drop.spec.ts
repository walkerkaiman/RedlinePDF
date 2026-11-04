import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF_PATH = path.join(__dirname, 'fixtures', 'test-3page.pdf');

test('dropping a PNG onto the viewport adds it as an image layer above the PDF', async ({ page }) => {
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

  const before = await page.evaluate(() => ((window as any)['__REDLINE_DEBUG']).markups as number);
  expect(before).toBe(0);

  // Build a 60x40 PNG in-page and dispatch a real HTML5 drop on the viewport.
  const drop = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 60; c.height = 40;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#e11';
    ctx.fillRect(0, 0, 60, 40);
    const blob = await (await fetch(c.toDataURL('image/png'))).blob();
    const file = new File([blob], 'dropped.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const target = document.getElementById('canvas-viewport')!;
    const r = target.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, dataTransfer: dt,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    target.dispatchEvent(new DragEvent('dragover', opts));
    target.dispatchEvent(new DragEvent('drop', opts));
    return true;
  });
  expect(drop).toBe(true);

  // Model: an image markup landed on the current page.
  await expect.poll(async () =>
    page.evaluate(() => ((window as any)['__REDLINE_DEBUG']).markupTypes as string[]),
    { timeout: 5_000 }).toEqual(expect.arrayContaining(['image']));

  // Rendered on the stage and auto-selected.
  const state = await page.evaluate(() => {
    const d = (window as any)['__REDLINE_DEBUG'];
    return { markups: d.markups, rects: d.markupScreenRects.length, selected: d.selectedIds.length };
  });
  expect(state.markups).toBe(1);
  expect(state.rects).toBe(1);
  expect(state.selected).toBe(1);

  // Per-page bookkeeping: the image belongs to page 0.
  const pageCounts = await page.evaluate(() => ((window as any)['__REDLINE_DEBUG']).pageMarkups as number[]);
  expect(pageCounts[0]).toBe(1);
});

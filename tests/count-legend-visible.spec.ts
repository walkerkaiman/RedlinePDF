import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF_PATH = path.join(__dirname, 'fixtures', 'test-3page.pdf');

async function loadPdf(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => { const d = ((window as any)['__REDLINE_DEBUG']); return !!d && typeof d.markups === 'number' && d.markups < 0; });
  await page.setInputFiles('#file-input-pdf', PDF_PATH);
  await page.waitForSelector('#canvas-scroll-container', { state: 'visible', timeout: 15000 });
}

async function stampCount(page: import('@playwright/test').Page): Promise<void> {
  await page.click('[data-tool="count"]').catch(() => {});
  const box = await page.locator('#konva-container canvas').first().boundingBox();
  if (!box) throw new Error('no canvas');
  const c = { x: box.x + box.width * 0.45, y: box.y + box.height * 0.5 };
  await page.mouse.click(c.x, c.y);
  await page.waitForTimeout(300);
}

test('count stamp and legend render visibly (non-zero size)', async ({ page }) => {
  await loadPdf(page);
  await stampCount(page);

  const rects = await page.evaluate(() => ((window as any)['__REDLINE_DEBUG'] as any).markupScreenRects as { type: string; width: number; height: number }[]);
  const byType = (t: string) => rects.filter(r => r.type === t);

  const counts = byType('count');
  const legends = byType('count-legend');

  // The legend must exist and have a real, visible size.
  expect(legends.length, 'legend should be present').toBeGreaterThanOrEqual(1);
  expect(legends[0].width, 'legend width should be > 0').toBeGreaterThan(20);
  expect(legends[0].height, 'legend height should be > 0').toBeGreaterThan(10);

  // The count stamp must render with a non-zero size (regression: a stray
  // Unicode symbol produced an empty, zero-size, invisible group).
  expect(counts.length, 'count stamp should be present').toBe(1);
  expect(counts[0].width, 'count stamp width should be > 0 (was 0 when symbol was unrenderable)').toBeGreaterThan(0);
  expect(counts[0].height, 'count stamp height should be > 0 (was 0 when symbol was unrenderable)').toBeGreaterThan(0);
});

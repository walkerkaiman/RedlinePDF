import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF_PATH = path.join(__dirname, 'fixtures', 'test-3page.pdf');

async function loadPdf(page: import('@playwright/test').Page): Promise<{x:number;y:number;width:number;height:number}> {
  await page.goto('/');
  await page.waitForFunction(() => { const d = ((window as any)['__REDLINE_DEBUG']); return !!d && typeof d.markups === 'number' && d.markups < 0; });
  await page.setInputFiles('#file-input-pdf', PDF_PATH);
  await page.waitForSelector('#canvas-scroll-container', { state: 'visible', timeout: 15000 });
  const box = await page.locator('#konva-container canvas').first().boundingBox();
  if (!box) throw new Error('no canvas');
  return box;
}

/** Calibrate the page scale so measure tools are usable. */
async function calibrate(page: import('@playwright/test').Page, box: {x:number;y:number;width:number;height:number}): Promise<void> {
  await page.click('[data-tool="scale-set"]').catch(() => {});
  const p1 = { x: box.x + box.width * 0.35, y: box.y + box.height * 0.45 };
  const p2 = { x: box.x + box.width * 0.55, y: box.y + box.height * 0.45 };
  await page.mouse.click(p1.x, p1.y); await page.waitForTimeout(120);
  await page.mouse.click(p2.x, p2.y); await page.waitForTimeout(250);
  const val = page.locator('#scale-value');
  if (await val.count()) { await val.fill('10'); await page.click('#modal-ok'); }
  await page.waitForTimeout(200);
}

test('measurement polygon is selectable across its full area and deletable', async ({ page }) => {
  const box = await loadPdf(page);
  await calibrate(page, box);

  // Draw a polygon with the measure-poly tool.
  await page.click('[data-tool="measure-poly"]').catch(() => {});
  const v1 = { x: box.x + box.width * 0.4, y: box.y + box.height * 0.4 };
  const v2 = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.4 };
  const v3 = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.6 };
  await page.mouse.click(v1.x, v1.y); await page.waitForTimeout(80);
  await page.mouse.click(v2.x, v2.y); await page.waitForTimeout(80);
  await page.mouse.click(v3.x, v3.y); await page.waitForTimeout(80);
  await page.mouse.click(v1.x, v1.y); await page.waitForTimeout(250);

  const typesBefore = await page.evaluate(() => ((window as any)['__REDLINE_DEBUG'] as any).markupTypes);
  expect(typesBefore, 'a measure-poly markup should exist').toContain('measure-poly');

  // Switch to Select and click the polygon's INTERIOR (away from the thin outline),
  // which is the reported failure: only the outline was hittable before the fix.
  await page.click('[data-tool="select"]').catch(() => {});
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.47);
  await page.waitForTimeout(200);

  const selected = await page.evaluate(() => ((window as any)['__REDLINE_DEBUG'] as any).selectedIds as string[]);
  expect(selected.length, 'clicking the polygon interior should select it').toBe(1);
  expect(selected[0], 'selected markup should be the measure-poly').toContain('m_');

  // Delete it — this is the user's actual goal ("cannot delete them").
  await page.keyboard.press('Delete');
  await page.waitForTimeout(200);

  const typesAfter = await page.evaluate(() => ((window as any)['__REDLINE_DEBUG'] as any).markupTypes);
  expect(typesAfter, 'measure-poly should be removed after delete').not.toContain('measure-poly');
  const selectedAfter = await page.evaluate(() => ((window as any)['__REDLINE_DEBUG'] as any).selectedIds as string[]);
  expect(selectedAfter.length, 'selection should be cleared after delete').toBe(0);
});

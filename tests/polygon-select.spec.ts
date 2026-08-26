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

async function drawPolygonArea(page: import('@playwright/test').Page, box: {x:number;y:number;width:number;height:number}, verts: {x:number;y:number}[]): Promise<void> {
  await page.click('[data-tool="polygon-area"]').catch(() => {});
  for (const v of verts) { await page.mouse.click(v.x, v.y); await page.waitForTimeout(70); }
  await page.mouse.click(verts[0].x, verts[0].y); await page.waitForTimeout(200);
}

async function selectViaInterior(page: import('@playwright/test').Page, box: {x:number;y:number;width:number;height:number}, verts: {x:number;y:number}[]): Promise<string[]> {
  const cx = verts.reduce((s, v) => s + v.x, 0) / verts.length;
  const cy = verts.reduce((s, v) => s + v.y, 0) / verts.length;
  await page.click('[data-tool="select"]').catch(() => {});
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(150);
  return await page.evaluate(() => ((window as any)['__REDLINE_DEBUG'] as any).selectedIds as string[]);
}

test('polygon-area is selectable by clicking its interior (full-area hitbox)', async ({ page }) => {
  const box = await loadPdf(page);
  const v1 = { x: box.x + box.width * 0.4, y: box.y + box.height * 0.4 };
  const v2 = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.4 };
  const v3 = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.6 };
  await drawPolygonArea(page, box, [v1, v2, v3]);
  const sel = await selectViaInterior(page, box, [v1, v2, v3]);
  expect(sel.length, 'clicking the polygon interior should select the polygon-area').toBe(1);
});

test('measure-poly is selectable by clicking its interior (full-area hitbox)', async ({ page }) => {
  const box = await loadPdf(page);
  // Calibrate so measure-poly is drawable.
  await page.click('[data-tool="scale-set"]').catch(() => {});
  const p1 = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.45 };
  const p2 = { x: box.x + box.width * 0.45, y: box.y + box.height * 0.45 };
  await page.mouse.click(p1.x, p1.y); await page.waitForTimeout(120);
  await page.mouse.click(p2.x, p2.y); await page.waitForTimeout(250);
  const val = page.locator('#scale-value');
  if (await val.count()) { await val.fill('10'); await page.click('#modal-ok'); }
  await page.waitForTimeout(200);

  const v1 = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.4 };
  const v2 = { x: box.x + box.width * 0.7, y: box.y + box.height * 0.4 };
  const v3 = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.6 };
  await page.click('[data-tool="measure-poly"]').catch(() => {});
  await page.mouse.click(v1.x, v1.y); await page.waitForTimeout(70);
  await page.mouse.click(v2.x, v2.y); await page.waitForTimeout(70);
  await page.mouse.click(v3.x, v3.y); await page.waitForTimeout(70);
  await page.mouse.click(v1.x, v1.y); await page.waitForTimeout(200);

  const sel = await selectViaInterior(page, box, [v1, v2, v3]);
  expect(sel.length, 'clicking the measure-poly interior should select it').toBe(1);
});

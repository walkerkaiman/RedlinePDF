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

async function modelPoints(page: import('@playwright/test').Page): Promise<{x:number;y:number}[] | null> {
  return await page.evaluate(() => {
    const d = ((window as any)['__REDLINE_DEBUG'] as any);
    const sm = d.selectedMarkup;
    return sm && sm.points ? sm.points : null;
  });
}

async function selectAndDrag(page: import('@playwright/test').Page, box: {x:number;y:number;width:number;height:number}, start: {x:number;y:number}, dx: number, dy: number): Promise<void> {
  await page.click('[data-tool="select"]').catch(() => {});
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

function firstPointMoved(before: {x:number;y:number}[], after: {x:number;y:number}[], minDelta: number): boolean {
  if (!before || !after || before.length === 0 || after.length === 0) return false;
  const dx = after[0].x - before[0].x;
  const dy = after[0].y - before[0].y;
  return Math.hypot(dx, dy) >= minDelta;
}

test('polygon-area moves via Select tool and bakes into the model (centroid drag)', async ({ page }) => {
  const box = await loadPdf(page);
  const v1 = { x: box.x + box.width * 0.4, y: box.y + box.height * 0.4 };
  const v2 = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.4 };
  const v3 = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.6 };
  await drawPolygonArea(page, box, [v1, v2, v3]);

  // Select, then read the model BEFORE dragging.
  await page.click('[data-tool="select"]').catch(() => {});
  const centroid = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.47 };
  await page.mouse.click(centroid.x, centroid.y);
  await page.waitForTimeout(150);
  const before = await modelPoints(page);
  expect(before, 'polygon should be selected before drag').not.toBeNull();

  // Drag from the centroid.
  await page.mouse.move(centroid.x, centroid.y);
  await page.mouse.down();
  await page.mouse.move(centroid.x + 60, centroid.y + 40, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  const after = await modelPoints(page);
  expect(after, 'polygon should remain selected after drag').not.toBeNull();
  expect(firstPointMoved(before!, after!, 1), 'polygon model points should move after drag').toBe(true);
});

test('polygon-area moves via Select tool (multi-vertex + edge-start drag)', async ({ page }) => {
  const box = await loadPdf(page);
  const v1 = { x: box.x + box.width * 0.4, y: box.y + box.height * 0.4 };
  const v2 = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.4 };
  const v3 = { x: box.x + box.width * 0.62, y: box.y + box.height * 0.55 };
  const v4 = { x: box.x + box.width * 0.45, y: box.y + box.height * 0.58 };
  const v5 = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.6 };
  await drawPolygonArea(page, box, [v1, v2, v3, v4, v5]);

  // Select from edge midpoint of v1-v2, read model, drag.
  const edge = { x: (v1.x + v2.x) / 2, y: (v1.y + v2.y) / 2 };
  await page.click('[data-tool="select"]').catch(() => {});
  await page.mouse.click(edge.x, edge.y);
  await page.waitForTimeout(150);
  const before = await modelPoints(page);
  expect(before, 'polygon should be selected before edge drag').not.toBeNull();

  await selectAndDrag(page, box, edge, 60, 40);
  const after = await modelPoints(page);
  expect(after, 'polygon should remain selected after edge drag').not.toBeNull();
  expect(firstPointMoved(before!, after!, 1), 'multi-vertex polygon should move after edge drag').toBe(true);
});

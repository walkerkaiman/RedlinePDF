import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Combine e2e — dropping a second PDF onto an open document appends its pages,
 * existing markups stay put, and Ctrl+Z / Ctrl+Y reverse/reapply the merge.
 * Asserted through the __REDLINE_DEBUG seam (totalPages, pageSourceFiles,
 * pageMarkups), not pixels.
 */

const PDF_PATH = path.join(__dirname, 'fixtures', 'test.pdf');           // 1 page
const PDF3_PATH = path.join(__dirname, 'fixtures', 'test-3page-mixed.pdf'); // 3 pages

type RedlineDebug = {
  markups?: number; totalPages?: number; pageSourceFiles?: string[];
  pageMarkups?: number[]; pageIds?: string[];
};
const dbg = (page: import('@playwright/test').Page) =>
  page.evaluate(() => ((window as unknown as { __REDLINE_DEBUG?: object })['__REDLINE_DEBUG'] ?? {}) as RedlineDebug);

async function loadPdf(page: import('@playwright/test').Page) {
  await expect.poll(async () => (await page.locator('#file-input-pdf').count()), { timeout: 10_000 }).toBe(1);
  const loaded = async (): Promise<boolean> =>
    page.evaluate(() => { const d = ((window as unknown) as Record<string, any>)['__REDLINE_DEBUG']; return !!d && typeof d.markups === 'number' && d.markups < 0; });
  await Promise.all([
    expect.poll(loaded, { timeout: 30_000 }).toBe(true),
    page.setInputFiles('#file-input-pdf', PDF_PATH),
  ]);
  await expect(page.locator('#canvas-scroll-container')).toBeVisible({ timeout: 15_000 });
}

async function dropPdf(page: import('@playwright/test').Page, filePath: string) {
  const buffer = await import('node:fs/promises').then(fs => fs.readFile(filePath));
  await page.evaluate(async ({ b64, name }) => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const file = new File([bytes], name, { type: 'application/pdf' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const viewport = document.getElementById('canvas-viewport')!;
    viewport.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    viewport.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, { b64: buffer.toString('base64'), name: path.basename(filePath) });
}

test.describe('Combine PDFs by drag-drop', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await loadPdf(page);
  });

  test('dropping a PDF appends its pages', async ({ page }) => {
    expect((await dbg(page)).totalPages).toBe(1);

    await dropPdf(page, PDF3_PATH);
    await expect.poll(async () => (await dbg(page)).totalPages, { timeout: 15_000 }).toBe(4);
    const d = await dbg(page);
    expect(d.pageSourceFiles).toEqual(['test.pdf', 'test-3page-mixed.pdf', 'test-3page-mixed.pdf', 'test-3page-mixed.pdf']);
    expect(d.pageIds?.length).toBe(4);
    expect(new Set(d.pageIds).size).toBe(4); // unique page ids
  });

  test('existing markups stay on their page after combine', async ({ page }) => {
    // Draw a box on page 1 (the only page) via the real tool — same proven
    // drag geometry as e2e-draw-pipeline.spec.ts.
    await page.click('[data-tool="box"]');
    const box = await page.locator('#konva-container canvas').first().boundingBox();
    if (!box) throw new Error('Konva canvas not found');
    const cx = box.x + box.width / 2;
    const cy = box.y + Math.min(box.height * 0.4, 300);
    await page.mouse.move(cx - 100, cy - 60);
    await page.mouse.down();
    await page.mouse.move(cx + 120, cy + 80, { steps: 3 });
    await page.mouse.up();
    await expect.poll(async () => (await dbg(page)).markups, { timeout: 5_000 }).toBeGreaterThan(0);
    const drawn = (await dbg(page)).markups ?? 0;

    await dropPdf(page, PDF3_PATH);
    await expect.poll(async () => (await dbg(page)).totalPages, { timeout: 15_000 }).toBe(4);
    const pm = (await dbg(page)).pageMarkups ?? [];
    expect(pm[0]).toBe(drawn);          // every drawn markup stayed on page 1
    expect(pm.slice(1)).toEqual([0, 0, 0]); // appended pages start clean
  });

  test('Ctrl+Z undoes the merge, Ctrl+Y redoes it', async ({ page }) => {
    await dropPdf(page, PDF3_PATH);
    await expect.poll(async () => (await dbg(page)).totalPages, { timeout: 15_000 }).toBe(4);

    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await dbg(page)).totalPages, { timeout: 15_000 }).toBe(1);

    await page.keyboard.press('Control+y');
    await expect.poll(async () => (await dbg(page)).totalPages, { timeout: 15_000 }).toBe(4);
  });

  test('dropping a garbage PDF leaves the document untouched', async ({ page }) => {
    const tmp = path.join(__dirname, 'fixtures', '.garbage-tmp.pdf');
    await import('node:fs/promises').then(fs => fs.writeFile(tmp, 'not a pdf at all'));
    try {
      await dropPdf(page, tmp);
      await page.waitForTimeout(1500);
      const d = await dbg(page);
      expect(d.totalPages).toBe(1);
      expect(d.pageSourceFiles).toEqual(['test.pdf']);
    } finally {
      await import('node:fs/promises').then(fs => fs.unlink(tmp));
    }
  });
});

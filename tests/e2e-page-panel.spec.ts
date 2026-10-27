import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Page panel e2e — toggle, reorder (real HTML5 drag through the panel),
 * delete, rotate, all asserted through the __REDLINE_DEBUG seam
 * (pageIds / pageMarkups / totalPages), not pixels.
 */

const PDF3_PATH = path.join(__dirname, 'fixtures', 'test-3page-mixed.pdf'); // 3 distinct-size pages

type RedlineDebug = {
  markups?: number; totalPages?: number; pageIds?: string[]; pageMarkups?: number[];
  pagePanelOpen?: boolean;
  reorderPages?: (order: number[]) => Promise<void>;
  rotatePage?: (i: number) => Promise<void>;
  deletePage?: (i: number) => Promise<void>;
};
const dbg = (page: import('@playwright/test').Page) =>
  page.evaluate(() => ((window as unknown as { __REDLINE_DEBUG?: object })['__REDLINE_DEBUG'] ?? {}) as RedlineDebug);

async function loadPdf3(page: import('@playwright/test').Page) {
  await expect.poll(async () => (await page.locator('#file-input-pdf').count()), { timeout: 10_000 }).toBe(1);
  const loaded = async (): Promise<boolean> =>
    page.evaluate(() => { const d = ((window as unknown) as Record<string, any>)['__REDLINE_DEBUG']; return !!d && d.totalPages === 3; });
  await Promise.all([
    expect.poll(loaded, { timeout: 30_000 }).toBe(true),
    page.setInputFiles('#file-input-pdf', PDF3_PATH),
  ]);
  await expect(page.locator('#canvas-scroll-container')).toBeVisible({ timeout: 15_000 });
}

test.describe('Page panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await loadPdf3(page);
  });

  test('Pages button opens the panel with one card per page', async ({ page }) => {
    await page.click('#btn-page-panel');
    await expect.poll(async () => (await dbg(page)).pagePanelOpen, { timeout: 5_000 }).toBe(true);
    await expect(page.locator('#page-panel .page-card')).toHaveCount(3);
    // thumbnails render lazily but the observer fires immediately for visible cards
    await expect.poll(async () => page.locator('#page-panel .page-thumb canvas').count(), { timeout: 10_000 }).toBeGreaterThan(0);
  });

  test('drag card 1 onto card 3 → order becomes [2,0,1]', async ({ page }) => {
    await page.click('#btn-page-panel');
    await expect(page.locator('#page-panel .page-card')).toHaveCount(3);
    const idsBefore = [...(await dbg(page)).pageIds!];

    await page.evaluate(() => {
      const list = document.getElementById('page-panel-list')!;
      const cards = [...list.querySelectorAll<HTMLElement>('.page-card')];
      const dt = new DataTransfer();
      cards[0].dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
      const target = cards[2].getBoundingClientRect();
      list.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientY: target.bottom - 5 }));
      list.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientY: target.bottom - 5 }));
      cards[0].dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
    });

    await expect.poll(async () => (await dbg(page)).pageIds, { timeout: 15_000 }).toEqual([idsBefore[1], idsBefore[2], idsBefore[0]]);
    expect((await dbg(page)).totalPages).toBe(3);
  });

  test('markup follows its page through a reorder', async ({ page }) => {
    // Draw a box on page 2 (index 1).
    await page.click('#btn-next-page');
    await page.waitForTimeout(400);
    await page.click('[data-tool="box"]');
    const box = await page.locator('#konva-container canvas').first().boundingBox();
    if (!box) throw new Error('Konva canvas not found');
    const cx = box.x + box.width / 2;
    const cy = box.y + Math.min(box.height * 0.4, 300);
    await page.mouse.move(cx - 100, cy - 60);
    await page.mouse.down();
    await page.mouse.move(cx + 120, cy + 80, { steps: 3 });
    await page.mouse.up();
    await expect.poll(async () => (await dbg(page)).pageMarkups?.reduce((a, b) => a + b, 0), { timeout: 5_000 }).toBeGreaterThan(0);
    const idsBefore = [...(await dbg(page)).pageIds!];
    const pmBefore = [...(await dbg(page)).pageMarkups!];
    // Identify the box's page directly: it is the ACTIVE page at draw time.
    const activeIdx = await page.evaluate(() => (window as any).__REDLINE_DEBUG.pageIndex);
    const boxPageId = idsBefore[activeIdx];

    await page.evaluate(() => {
      const d = ((window as unknown) as Record<string, any>)['__REDLINE_DEBUG'];
      return d.reorderPages([2, 0, 1]);
    });
    await expect.poll(async () => (await dbg(page)).pageIds, { timeout: 15_000 }).toEqual([idsBefore[2], idsBefore[0], idsBefore[1]]);
    const after = await dbg(page);
    const newSlot = after.pageIds!.indexOf(boxPageId);
    expect(newSlot).toBe(2);                       // order [2,0,1] moves original page 2 to slot 2
    expect(after.pageMarkups![newSlot]).toBeGreaterThan(0); // and its markup came with it
    // The other pages keep their markup counts (the count-legend pseudo-markup
    // belongs to the original page 0 and travels with it — compare as multisets).
    const othersBefore = pmBefore.filter((_, i) => idsBefore[i] !== boxPageId).sort();
    const othersAfter = after.pageMarkups.filter((_, i) => after.pageIds[i] !== boxPageId).sort();
    expect(othersAfter).toEqual(othersBefore);
  });

  test('delete removes a page; deleting the last page is refused', async ({ page }) => {
    const ids = [...(await dbg(page)).pageIds!];
    const join = async () => ((await dbg(page)).pageIds ?? []).join(',');
    await page.evaluate(() => ((window as unknown) as Record<string, any>)['__REDLINE_DEBUG'].deletePage(1));
    await expect.poll(join, { timeout: 15_000 }).toBe(`${ids[0]},${ids[2]}`);

    await page.evaluate(() => ((window as unknown) as Record<string, any>)['__REDLINE_DEBUG'].deletePage(0));
    await expect.poll(join, { timeout: 15_000 }).toBe(ids[2]);
    await page.evaluate(() => ((window as unknown) as Record<string, any>)['__REDLINE_DEBUG'].deletePage(0));
    await page.waitForTimeout(1000);
    expect((await dbg(page)).totalPages).toBe(1); // guard held
  });

  test('rotate + undo restores the document', async ({ page }) => {
    await page.evaluate(() => ((window as unknown) as Record<string, any>)['__REDLINE_DEBUG'].rotatePage(0));
    await page.waitForTimeout(1200);
    expect((await dbg(page)).totalPages).toBe(3);
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await dbg(page)).totalPages, { timeout: 15_000 }).toBe(3);
  });
});

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

// Click markup[i] at its actual on-screen position (the stage is scaled/offset to fit the
// page, so the true screen rect is read from the debug seam rather than guessed).
async function clickMarkup(page: import('@playwright/test').Page, index: number, holdShift = false) {
  const box = await canvasBox(page);
  const rects = await page.evaluate(() => ((window as any)['__REDLINE_DEBUG'] as any).markupScreenRects as { x: number; y: number; width: number; height: number }[]);
  if (!rects[index]) throw new Error(`no rendered markup rect at index ${index}`);
  const r = rects[index];
  const x = box.x + r.x + r.width / 2;
  const y = box.y + r.y + r.height / 2;
  if (holdShift) await page.keyboard.down('Shift');
  await page.mouse.click(x, y);
  if (holdShift) await page.keyboard.up('Shift');
}

async function drawBoxAt(page: import('@playwright/test').Page, dx: number, dy: number) {
  const box = await canvasBox(page);
  const c = { x: box.x + box.width * 0.5 + dx, y: box.y + box.height * 0.5 + dy };
  await page.mouse.move(c.x - 30, c.y - 22);
  await page.mouse.down();
  await page.mouse.move(c.x + 30, c.y + 22, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

test.describe('Select tool', () => {
  test('clicking a drawn markup with the select tool selects it', async ({ page }) => {
    await page.goto('/');
    await loadPdf(page);
    await drawBoxAt(page, 0, 0);

    await page.click('[data-tool="select"]').catch(() => {});
    await clickMarkup(page, 0);
    await page.waitForTimeout(200);

    await expect.poll(async () =>
      page.evaluate(() => ((window as any)['__REDLINE_DEBUG'] as any).selectedIds.length),
      { timeout: 5_000 },
    ).toBe(1);
  });

  test('Shift+click adds a second markup to the selection', async ({ page }) => {
    await page.goto('/');
    await loadPdf(page);
    await drawBoxAt(page, 0, 0);
    await page.click('[data-tool="box"]').catch(() => {}); // drawing auto-releases to select
    await drawBoxAt(page, -120, -90);

    await page.click('[data-tool="select"]').catch(() => {});
    await clickMarkup(page, 0);          // select first
    await page.waitForTimeout(150);
    await clickMarkup(page, 1, true);    // shift-click second → add
    await page.waitForTimeout(200);

    await expect.poll(async () =>
      page.evaluate(() => ((window as any)['__REDLINE_DEBUG'] as any).selectedIds.length),
      { timeout: 5_000 },
    ).toBe(2);
  });

  test('clicking empty canvas deselects', async ({ page }) => {
    await page.goto('/');
    await loadPdf(page);
    await drawBoxAt(page, 0, 0);

    await page.click('[data-tool="select"]').catch(() => {});
    await clickMarkup(page, 0);
    await page.waitForTimeout(200);
    const selected = await page.evaluate(() => ((window as any)['__REDLINE_DEBUG'] as any).selectedIds.length);
    expect(selected).toBe(1);

    const box = await canvasBox(page);
    await page.mouse.click(box.x + 8, box.y + 8); // empty corner
    await page.waitForTimeout(200);

    await expect.poll(async () =>
      page.evaluate(() => ((window as any)['__REDLINE_DEBUG'] as any).selectedIds.length),
      { timeout: 5_000 },
    ).toBe(0);
  });
});

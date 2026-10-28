import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Phase 2 (two-stage render + navToken race guard): rapid card clicks must
 * settle on the LAST clicked page — a stale hi-res swap must never land.
 * Asserted through the __REDLINE_DEBUG seam (pageIndex, navToken), not pixels.
 */

const PDF3_PATH = path.join(__dirname, 'fixtures', 'test-3page-mixed.pdf');

type NavDebug = { totalPages?: number; pageIndex?: number; navToken?: number };
const dbg = (page: import('@playwright/test').Page) =>
  page.evaluate(() => ((window as unknown as { __REDLINE_DEBUG?: object })['__REDLINE_DEBUG'] ?? {}) as NavDebug);

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

test('rapid card clicks settle on the last page with a monotonic navToken', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto('/');
  await loadPdf3(page);

  await page.click('#btn-page-panel');
  await expect(page.locator('#page-panel .page-card')).toHaveCount(3);

  const token0 = (await dbg(page)).navToken ?? 0;
  expect(typeof token0).toBe('number');

  // Click card 2 then card 3 with no settle between — fire both, then wait.
  await page.locator('#page-panel .page-card').nth(1).click();
  await page.locator('#page-panel .page-card').nth(2).click();

  await expect.poll(async () => (await dbg(page)).pageIndex, { timeout: 10_000 }).toBe(2);
  // Let any stale hi-res swap from the page-2 render have time to (wrongly) land.
  await page.waitForTimeout(1500);

  const after = await dbg(page);
  expect(after.pageIndex).toBe(2);                       // still page 3 — stale swap never moved state
  expect(after.navToken).toBeGreaterThan(token0);        // monotonic
  expect(errors).toEqual([]);
});

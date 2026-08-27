import { test, expect } from '@playwright/test';
import path from 'path';

// Regression: opening a saved .redline project must restore the calibrated page
// scale into appState.state.scale (the mirror measure tools read via getScale()).
// Without this, measure/area tools drew "Set scale first" / "no scale set" even
// though the saved page was calibrated. Reproduces the FABLE 30A project.

const REDLINE = '/home/kaiman/Desktop/FABLE 30A_Rev1_SIGNED.redline';

test('loading a .redline project restores the calibrated scale', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#file-input-project', { state: 'attached', timeout: 15000 });
  await page.setInputFiles('#file-input-project', REDLINE);
  // wait until the project has loaded (markupTypes becomes available)
  await page.waitForFunction(() => (window as any).__REDLINE_DEBUG?.markupTypes?.length >= 0, null, { timeout: 15000 });
  // wait until the active page's scale has been mirrored into appState (calibrated)
  await page.waitForFunction(() => (window as any).__REDLINE_DEBUG?.scaleCalibrated === true, null, { timeout: 15000 });

  const calibrated = await page.evaluate(() => (window as any).__REDLINE_DEBUG?.scaleCalibrated);
  expect(calibrated, 'scale should be calibrated after loading a project that saved a scale').toBe(true);
});

test('a measure-rect drawn after loading a project shows calibrated values (not "Set scale first")', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#file-input-project', { state: 'attached', timeout: 15000 });
  await page.setInputFiles('#file-input-project', REDLINE);
  await page.waitForTimeout(4000);

  // activate measure-rect tool
  await page.click('[data-tool="measure-rect"]');
  await page.waitForTimeout(300);

  // draw a rectangle via real mouse drags on the canvas
  const box = await page.locator('#konva-container').boundingBox();
  if (!box) throw new Error('no canvas');
  const x1 = box.x + box.width * 0.2, y1 = box.y + box.height * 0.3;
  const x2 = box.x + box.width * 0.5, y2 = box.y + box.height * 0.6;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2);
  await page.mouse.up();
  await page.waitForTimeout(500);

  const label = await page.evaluate(() => (window as any).__REDLINE_DEBUG?.selectedMarkup?.label ?? '');
  expect(label, `measure-rect label was: ${label}`).not.toContain('Set scale first');
  expect(label, `measure-rect label was: ${label}`).not.toContain('Not calibrated');
});

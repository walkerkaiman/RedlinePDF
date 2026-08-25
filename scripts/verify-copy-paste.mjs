import { chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF_PATH = path.join(__dirname, '..', 'tests', 'fixtures', 'test.pdf');
const BASE = process.env.PREVIEW_URL || 'http://localhost:4173';

async function dbg(page) {
  return page.evaluate(() => {
    const d = window['__REDLINE_DEBUG'];
    return d ? { activeTool: d.activeTool, markups: d.markups, types: d.markupTypes } : null;
  });
}

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('console', (m) => { if (/error/i.test(m.type())) console.log('[console-err]', m.text().slice(0, 200)); });

await page.goto(BASE, { waitUntil: 'domcontentloaded' });

// load fixture pdf via the real hidden input
await Promise.all([
  page.waitForFunction(() => { const d = window['__REDLINE_DEBUG']; return !!d && typeof d.markups === 'number' && d.markups < 0; }, undefined, { timeout: 30000 }),
  page.setInputFiles('#file-input-pdf', PDF_PATH),
]);
await page.waitForTimeout(800);
console.log('STEP pdf loaded, markups:', (await dbg(page)).markups);

const box = await page.locator('#konva-container canvas').first().boundingBox();
if (!box) throw new Error('no konva canvas');
const cx = box.x + box.width / 2, cy = box.y + Math.min(box.height * 0.45, 380);

// draw one box with the box tool (real mouse events through Konva pipeline)
await page.click('[data-tool="box"]');
console.log('STEP activeTool after clicking box:', (await dbg(page)).activeTool);
const before = (await dbg(page)).markups;
await page.mouse.move(cx - 120, cy - 60);
await page.mouse.down();
await page.mouse.move(cx + 120, cy + 60, { steps: 5 });
await page.mouse.up();
const afterBox = (await dbg(page)).markups;
console.log(`STEP drew box: markups ${before} -> ${afterBox}, types=${JSON.stringify((await dbg(page)).types)}`);
if (!(afterBox === before + 1)) throw new Error('BOX DRAW FAILED');

// click on canvas at the drawn box center to select it (select tool is active after draw)
console.log('STEP activeTool now:', (await dbg(page)).activeTool);
let s = await page.evaluate(() => window['__REDLINE_DEBUG'].selectedIds);
console.log('STEP selectedIds right after draw:', JSON.stringify(s));

// Try the Duplicate TOOLBAR BUTTON first (real user path), then Ctrl+D as fallback.
const dupBtnDisabledBefore = await page.locator('#btn-duplicate').isDisabled();
console.log('STEP btn-duplicate disabled before click:', dupBtnDisabledBefore);
if (!dupBtnDisabledBefore) {
  await page.click('#btn-duplicate');
}
let afterDup = (await dbg(page)).markups;
const viaButton = afterDup === afterBox + 1;
console.log(`STEP duplicate via button: markups ${afterBox} -> ${afterDup}`);

if (!viaButton) {
  // fall back to keyboard shortcut on a fresh selection if needed
  console.log('STEP (button failed) retrying with Ctrl+D');
  await page.keyboard.press('Control+d');
  afterDup = (await dbg(page)).markups;
  console.log(`STEP duplicate via ctrl+d: markups ${afterBox} -> ${afterDup}`);
}

if (!(afterDup === afterBox + 1)) throw new Error('DUPLICATE/COPY-PASTE FAILED — no new markup committed to canvas state');

// Undo check: ctrl+z removes it again (proves snapshot pipeline, not a zombie node)
await page.keyboard.press('Control+z');
const afterUndo = (await dbg(page)).markups;
console.log(`STEP ctrl+z undo: markups ${afterDup} -> ${afterUndo}`);
if (!(afterUndo === afterBox)) throw new Error('UNDO FAILED');

// redo to leave 2 boxes for the visual capture
await page.keyboard.press('Control+y');
const finalCount = (await dbg(page)).markups;

await page.waitForTimeout(600);
await page.screenshot({ path: '/tmp/redline-copy-paste-verify.png' });
console.log(`FINAL markups=${finalCount} screenshot=/tmp/redline-copy-paste-verify.png`);
console.log('RESULT:', finalCount >= 2 && afterDup === afterBox + 1 ? 'COPY/PASTE VERIFIED ON CANVAS PIPELINE' : 'CHECK FAILED');
await browser.close();

#!/usr/bin/env node
// Measure page-navigation latency against the built dist/ under WebKit.
// Usage: node scripts/measure-page-nav.mjs /path/to/multi-page.pdf [--runs N]
//
// For each card navigation it reports:
//   first-change ms — time until the Konva canvas pixels change at all
//                     (the placeholder raster landing = "something on screen")
//   stable ms       — time until the canvas stops changing (hi-res swap done)
// Detection is a pixel-hash probe: the stage canvas is downscaled into a tiny
// 32x32 canvas and hashed every 30ms; a change in the hash = a visible change.

import { chromium, webkit } from '@playwright/test';
import { createServer } from 'http';
import { readFile, stat } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT ?? 4178);

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('usage: node scripts/measure-page-nav.mjs /path/to/multi-page.pdf [--runs N]');
  process.exit(1);
}
const runsFlag = process.argv.indexOf('--runs');
const RUNS = runsFlag >= 0 ? Number(process.argv[runsFlag + 1]) : 2;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.mjs.map': 'text/plain' };

async function serveDist() {
  const server = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const file = path.join(ROOT, 'dist', p);
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
  await new Promise(r => server.listen(PORT, r));
  return () => server.close();
}

// In-page probe: downscale the stage canvas to 32x32 and hash the pixels.
const PROBE = `(() => {
  const c = document.querySelector('#konva-container canvas');
  if (!c) return null;
  const s = document.createElement('canvas'); s.width = 32; s.height = 32;
  const ctx = s.getContext('2d');
  ctx.drawImage(c, 0, 0, 32, 32);
  const d = ctx.getImageData(0, 0, 32, 32).data;
  let h = 0;
  for (let i = 0; i < d.length; i += 4) { h = (h * 31 + d[i] + d[i+1] * 3 + d[i+2] * 7) >>> 0; }
  return h;
})()`;

async function measureNav(page, cardIndex) {
  const before = await page.evaluate(PROBE);
  const t0 = Date.now();
  await page.locator('#page-panel .page-card').nth(cardIndex).click();
  let firstChange = null;
  let lastHash = before;
  let stableSince = Date.now();
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const h = await page.evaluate(PROBE);
    const now = Date.now();
    if (h !== lastHash) {
      if (firstChange === null) firstChange = now - t0;
      lastHash = h;
      stableSince = now;
    }
    if (firstChange !== null && now - stableSince >= 250) break; // settled
    await page.waitForTimeout(30);
  }
  return { firstChange, stable: Date.now() - t0 };
}

async function main() {
  const bytes = await readFile(pdfPath);
  const sizeMb = (await stat(pdfPath)).size / 1e6;
  const close = await serveDist();
  const browser = await webkit.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  console.log(`PDF: ${pdfPath} (${sizeMb.toFixed(1)} MB)`);
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#file-input-pdf', { state: 'attached' });
  await Promise.all([
    page.waitForFunction(() => window.__REDLINE_DEBUG?.totalPages > 1, null, { timeout: 60_000 }),
    page.setInputFiles('#file-input-pdf', pdfPath),
  ]);
  const totalPages = await page.evaluate(() => window.__REDLINE_DEBUG.totalPages);
  console.log(`pages: ${totalPages}, runs: ${RUNS}`);

  await page.click('#btn-page-panel');
  await page.waitForSelector('#page-panel .page-card');

  const results = [];
  for (let run = 0; run < RUNS; run++) {
    const row = [];
    for (let i = 1; i < Math.min(totalPages, 9); i++) {
      row.push(await measureNav(page, i));
    }
    // back to first card between runs
    await measureNav(page, 0);
    results.push(row);
    console.log(`run ${run + 1}: ` + row.map(r => `${r.firstChange}→${r.stable}ms`).join('  '));
  }

  const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const firstChanges = results.flat().map(r => r.firstChange);
  const stables = results.flat().map(r => r.stable);
  console.log(`median first-change: ${med(firstChanges)}ms   median stable: ${med(stables)}ms`);

  await browser.close();
  close();
}

main().catch(e => { console.error(e); process.exit(1); });

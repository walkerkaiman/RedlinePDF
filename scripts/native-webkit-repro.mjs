// Faithful repro on REAL system WebKitGTK (port 4445):
// load PDF -> enter scale (calibrate) -> draw 5-pt polygon -> select tool -> click-select.
const B = `http://localhost:${process.env.PORT || 4445}`;
const SID = process.env.SID;
const PDF = '/home/kaiman/Desktop/FABLE 30A_Rev1_SIGNED.pdf';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EID = (o) => o.ELEMENT || o['element-6066-11e4-a52e-4f735466cecf'];
async function exec(script) {
  const res = await fetch(`${B}/session/${SID}/execute/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ script, args: [] }) });
  const t = await res.text(); try { return JSON.parse(t).value; } catch { return t; }
}
async function wd(method, path, body) {
  const res = await fetch(`${B}/session/${SID}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await res.text(); try { return JSON.parse(t).value; } catch { return t; }
}
async function nav(url) { await fetch(`${B}/session/${SID}/url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) }); }
async function find(sel) { return wd('POST', '/element', { using: 'css selector', value: sel }); }
const md = (x, y) => `(()=>{const c=document.querySelector('.konvajs-content')||document.getElementById('konva-container');c.dispatchEvent(new MouseEvent('mousedown',{clientX:${x},clientY:${y},bubbles:true,view:window}));})()`;
const mu = (x, y) => `(()=>{const c=document.querySelector('.konvajs-content')||document.getElementById('konva-container');c.dispatchEvent(new MouseEvent('mouseup',{clientX:${x},clientY:${y},bubbles:true,view:window}));})()`;
const mm = (x, y) => `(()=>{const c=document.querySelector('.konvajs-content')||document.getElementById('konva-container');c.dispatchEvent(new MouseEvent('mousemove',{clientX:${x},clientY:${y},bubbles:true,view:window}));})()`;

(async () => {
  await nav('http://127.0.0.1:4173/');
  await wd('POST', '/window/rect', { x: 0, y: 0, width: 1400, height: 900 }).catch(() => {});
  await sleep(2000);
  const fi = await find('#file-input-pdf');
  await wd('POST', `/element/${EID(fi)}/value`, { value: [PDF], text: PDF });
  await sleep(400);
  await exec(`document.getElementById('file-input-pdf').dispatchEvent(new Event('change',{bubbles:true}));`);
  await sleep(3500);
  const cr = await exec('const c=document.getElementById("konva-container"); const r=c.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height};');
  console.log('CANVAS', JSON.stringify(cr));

  // ENTER SCALE: scale-set tool, 2 clicks, fill modal, apply
  await exec(`document.querySelector('[data-tool="scale-set"]').click();`);
  await sleep(300);
  const sx1 = cr.x + cr.w * 0.3, sy1 = cr.y + cr.h * 0.4;
  const sx2 = cr.x + cr.w * 0.6, sy2 = cr.y + cr.h * 0.4;
  await exec(md(sx1, sy1)); await sleep(60); await exec(mu(sx1, sy1)); await sleep(200);
  await exec(md(sx2, sy2)); await sleep(60); await exec(mu(sx2, sy2)); await sleep(800);
  console.log('MODAL_PRESENT', await exec('return !!document.getElementById("scale-value");'));
  await exec(`const v=document.getElementById('scale-value'); v.value='10'; v.dispatchEvent(new Event('input',{bubbles:true}));`);
  await sleep(150);
  await exec(`document.getElementById('modal-ok').click();`);
  await sleep(600);
  console.log('CALIBRATED', await exec('return window.__REDLINE_DEBUG ? (window.__REDLINE_DEBUG.markupTypes, window.__REDLINE_DEBUG) && (document.getElementById("page-scale-indicator")?.textContent||"n/a") : "no-seam";'));
  console.log('SCALE_STATE', await exec('return (window.__REDLINE_DEBUG && window.__REDLINE_DEBUG.markupTypes) ? "types-ok" : "no-seam";'));

  // DRAW polygon-area
  await exec(`document.querySelector('[data-tool="polygon-area"]').click();`);
  await sleep(300);
  const cx = cr.x + cr.w / 2, cy = cr.y + cr.h / 2;
  const rx = cr.w * 0.28, ry = cr.h * 0.28;
  const pts = [[cx, cy - ry], [cx + rx, cy - ry * 0.3], [cx + rx, cy + ry], [cx - rx, cy + ry], [cx - rx, cy - ry * 0.3]];
  for (const [px, py] of pts) { await exec(md(px, py)); await sleep(60); await exec(mu(px, py)); await sleep(200); }
  await exec(md(pts[0][0], pts[0][1])); await sleep(60); await exec(mu(pts[0][0], pts[0][1]));
  await sleep(800);
  console.log('TYPES_AFTER_DRAW', JSON.stringify(await exec('return window.__REDLINE_DEBUG.markupTypes;')));

  // SELECT
  await exec(`document.querySelector('[data-tool="select"]').click();`);
  await sleep(300);
  await exec(mm(cx, cy)); await sleep(150);
  console.log('HIT_AT_CENTROID', JSON.stringify(await exec('return window.__REDLINE_DEBUG.hitAtPointer();')));
  await exec(md(cx, cy)); await sleep(60); await exec(mu(cx, cy));
  await sleep(500);
  console.log('SELECTED_AFTER_CLICK', JSON.stringify(await exec('return window.__REDLINE_DEBUG.selectedIds;')));
})().catch((e) => { console.error('FATAL', e); process.exit(1); });

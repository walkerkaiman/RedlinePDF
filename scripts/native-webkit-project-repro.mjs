// Self-contained: load user's .redline, then DRAW a measure-rect and read its label
// to see if the loaded project's scale is applied (or "Not calibrated").
const B = 'http://localhost:4445';
const REDLINE = '/home/kaiman/Desktop/FABLE 30A_Rev1_SIGNED.redline';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EID = (o) => o.ELEMENT || o['element-6066-11e4-a52e-4f735466cecf'];
const SID = process.env.SID;
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
  const pi = await find('#file-input-project');
  await wd('POST', `/element/${EID(pi)}/value`, { value: [REDLINE], text: REDLINE });
  await sleep(400);
  await exec(`document.getElementById('file-input-project').dispatchEvent(new Event('change',{bubbles:true}));`);
  await sleep(4500);
  const cr = await exec('const c=document.getElementById("konva-container"); const r=c.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height};');
  console.log('CANVAS', JSON.stringify(cr));
  console.log('TYPES_LOADED', JSON.stringify(await exec('return window.__REDLINE_DEBUG.markupTypes;')));

  // Draw a measure-rect immediately (does the loaded project have scale?)
  await exec(`document.querySelector('[data-tool="measure-rect"]').click();`);
  await sleep(400);
  console.log('MEASURE_RECT_TOOL', await exec('return window.__REDLINE_DEBUG.activeTool;'));
  const rx = cr.x + cr.w * 0.2, ry = cr.y + cr.h * 0.3;
  const rxx = cr.x + cr.w * 0.5, ryy = cr.y + cr.h * 0.6;
  await exec(md(rx, ry)); await sleep(60); await exec(mm(rxx, ryy)); await sleep(60); await exec(mu(rxx, ryy));
  await sleep(500);
  console.log('DRAWN_TYPES', JSON.stringify(await exec('return window.__REDLINE_DEBUG.markupTypes;')));
  console.log('LABEL_AFTER_LOAD', JSON.stringify(await exec('return window.__REDLINE_DEBUG.selectedMarkup ? window.__REDLINE_DEBUG.selectedMarkup.label : "no-seam";')));
})().catch((e) => { console.error('FATAL', e); process.exit(1); });

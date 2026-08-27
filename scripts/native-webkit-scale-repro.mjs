// Load user's .redline, then RE-ENTER scale via scale-set, then draw measure-rect.
// Tests whether re-entering scale fixes appState.state.scale (symptom 3).
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
async function typeInto(sel, text) { const el = await find(sel); const eid = EID(el); await wd('POST', `/element/${eid}/value`, { value: text, text }); return eid; }
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

  // Re-enter scale via scale-set
  await exec(`document.querySelector('[data-tool="scale-set"]').click();`);
  await sleep(300);
  const sx1 = cr.x + cr.w * 0.3, sy1 = cr.y + cr.h * 0.4;
  const sx2 = cr.x + cr.w * 0.6, sy2 = cr.y + cr.h * 0.4;
  await exec(md(sx1, sy1)); await sleep(60); await exec(mu(sx1, sy1)); await sleep(200);
  await exec(md(sx2, sy2)); await sleep(60); await exec(mu(sx2, sy2)); await sleep(800);
  await typeInto('#scale-value', '10');
  await sleep(150);
  await exec(`document.getElementById('modal-ok').click();`);
  await sleep(800);
  console.log('TOOL_AFTER_CALIB', await exec('return window.__REDLINE_DEBUG.activeTool;'));

  // Draw measure-rect
  await exec(`document.querySelector('[data-tool="measure-rect"]').click();`);
  await sleep(300);
  const rx = cr.x + cr.w * 0.2, ry = cr.y + cr.h * 0.3;
  const rxx = cr.x + cr.w * 0.5, ryy = cr.y + cr.h * 0.6;
  await exec(md(rx, ry)); await sleep(60); await exec(mm(rxx, ryy)); await sleep(60); await exec(mu(rxx, ryy));
  await sleep(500);
  console.log('LABEL_AFTER_REENTER', JSON.stringify(await exec('return window.__REDLINE_DEBUG.selectedMarkup ? window.__REDLINE_DEBUG.selectedMarkup.label : "no-seam";')));
})().catch((e) => { console.error('FATAL', e); process.exit(1); });

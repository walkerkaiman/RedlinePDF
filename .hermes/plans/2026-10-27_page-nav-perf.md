# Task Plan: Snappy page navigation (two-stage render + page cache + batched draws)

## Goal

Page changes (page-panel card click, prev/next, project load) should *feel* instant:
something correct on screen in <150ms, hi-res shortly after, and revisits at the
same zoom doing zero raster work.

Measured baseline (2026-10-27, WebKit, 59 MB / 14-page PDF as large-plan proxy):
first visit ~1.8s visible, warm pages ~90–110ms. Findings + option ranking in
`.hermes/progress.md` (commit 69f4d20).

## Core decisions (the thing everything hangs on)

1. **Two-stage render, not faster raster.** `renderPage` shows a placeholder raster
   at `min(zoom, 1)` immediately, then swaps the hi-res canvas in via the existing
   `stageManager.updatePdfCanvas()` (the wheel-zoom path at main.ts ~710–740 already
   proves this swap pattern works). Konva stretches whatever canvas is on the
   `bgImage`, so the placeholder looks right, just softer.
2. **Per-renderer page cache, pixel-budgeted.** Cache `PageInfo` keyed
   `(pageIndex, scale)` inside the `loadPdf` closure — a structural op destroys the
   renderer and builds a new one, so the cache dies with it automatically. Never
   cache across renderer instances (page indices change meaning after reorder/delete).
3. **One draw per navigation.** No `layer.draw()` inside loops; a single
   `stage.batchDraw()` at the end of `renderPage`.
4. **Navigation race guard.** A monotonically increasing `navToken` in main.ts;
   every async render step checks its token before touching the stage. Rapid card
   clicks must never let a stale hi-res swap land on the wrong page.

## Phases

### Phase 1: Batched draws (smallest, do first — standalone commit)

- `src/canvas/stage.ts`:
  - `setPdfImage` / `updatePdfCanvas`: `bgLayer.draw()` → `bgLayer.batchDraw()`.
  - `addMarkupNode` (line ~665): remove the per-node `markupLayer.draw()`; add
    `addMarkupNodes(markups: Markup[])` that adds all children then one
    `markupLayer.batchDraw()`. Keep `addMarkupNode` (used by draw pipeline) but
    make its draw a `batchDraw`.
- `src/main.ts` `renderPage` (~637–702): replace the `forEach(addMarkupNode)` loop
  with `addMarkupNodes`; `setZoom`'s `stage.draw()` stays (it is also called
  standalone) but renderPage's final activation already redraws — verify no
  double-draw remains by counting `draw` calls in a unit test or a quick
  instrumented run.
- Acceptance: full e2e suite green (40 tests, WebKit production build); no visual
  diff on manual nav.

### Phase 2: Two-stage render in `renderPage`

- In `src/main.ts`:
  - Module-level `let navToken = 0;`. `renderPage` captures `const token = ++navToken;`
    at entry.
  - New flow: `getPageSizePts` → token check → `loadPage(pageIndex, Math.min(zoom, 1))`
    (placeholder) → token check → `setPdfImage(placeholder)` + stage sizing +
    markups + `activateCurrentTool()` (so the page is interactive at placeholder res)
    → then `loadPage(pageIndex, zoom)` (hi-res) → token check + `!pdfRenderer.isDestroyed()`
    → `updatePdfCanvas(hiRes.canvas)`.
  - If placeholder scale ≥ zoom (already low zoom), skip the hi-res pass entirely.
  - Catch `'renderer destroyed'` from either load (structural op mid-render) and bail
    silently — same pattern as pagePanel.ts `renderThumb`.
  - `renderPage` resolves after the placeholder pass + hi-res swap completes
    (callers: `applyStructuralOp` awaits it before re-rendering the panel; keep the
    await semantics — do NOT fire-and-forget the hi-res, or undo/structural flows
    race it).
- Debug seam (main.ts ~804): add `get lastRenderWasCacheHit(): boolean` and
  `get navToken(): number` for tests.
- Acceptance: e2e page-panel + cross-page specs green; new e2e: click card 2 then
  card 3 rapidly (no settle between), assert final visible state = page 3
  (`pageIndex === 2` and seam `navToken` monotonic), no console errors.

### Phase 3: Page cache in `src/pdf/renderer.ts`

- New small module or inline in `loadPdf` closure: `Map<string, PageInfo>` +
  insertion-order LRU (re-insert on hit; evict oldest while
  `totalPixels > PIXEL_BUDGET`, budget ≈ 60 MP total — a 7000×5000 canvas is
  35 MP RGBA, so this caps at ~2–4 hi-res entries; placeholders are cheap).
- `loadPage(pageIndex, scale)`: key `${pageIndex}@${scale.toFixed(3)}`; on hit,
  move to newest and return the cached `PageInfo` (no `page.render`). On miss,
  render, store, evict.
- Eviction only drops the map reference — never mutate/clear a canvas (a Konva
  `bgImage` may still be displaying it).
- Acceptance: vitest unit tests for hit/miss/eviction/LRU order (new file
  `tests/unit/page-cache.spec.ts` — mock the pdfjs page object); e2e: navigate
  1→2→1 and assert seam `lastRenderWasCacheHit === true` on the return.

### Phase 4: Neighbor prefetch (cheap, last)

- After `renderPage`'s hi-res swap completes: `requestIdleCallback` (fallback
  `setTimeout 200ms`) → `doc.getPage(i±1)` to warm page structure (the 1.8s cold
  cost is mostly first `getPage` parse). Do NOT prefetch rasters in v1 — structure
  warm alone makes first visits behave like warm ones; raster prefetch can be a
  follow-up if numbers justify it.
- Guard `isDestroyed()` and token before any stage touch (none needed — prefetch
  only warms pdf.js internals).
- Acceptance: measure script (below) shows first-visit visible time for page i+1
  after visiting i drops toward the warm number.

### Phase 5: Measure + verify + ship

- Add `scripts/measure-page-nav.mjs` (Playwright, WebKit, serves `dist/` on 4173):
  loads a multi-page PDF path from argv, clicks cards, reports ms-to-visible per
  navigation using the pixel-hash probe (the probe script from this session is
  recoverable from `.hermes/progress.md` findings; reimplement in the script).
- Run: `npx tsc -p tsconfig.json --noEmit` && `npx vitest run` &&
  `npm run build` && `npx playwright test --config=playwright.desktop.config.ts`
  (must stay 40+ green; new tests included).
- Report before/after numbers from the measure script on a real large PDF
  (`~/Desktop/Fable_Concept_Presentation.pdf` as the standing proxy).
- Delivery (owner, not implementer): bump `src-tauri/tauri.conf.json` to 0.2.21,
  `npx tauri build` (AppImage linuxdeploy failure is pre-existing — ignore),
  install deb, commit progress note.

## Out of scope (deliberate)

- Viewport-region raster capping (Tier 2 option 4): only worth it if Phase 5
  numbers still show >500ms hi-res at deep zoom on real plans. Design sketch in
  progress.md; do not start without a decision.
- Off-main-thread raster (OffscreenCanvas worker): only if the UI still *freezes*
  after Phases 1–4. WebKitGTK support risk — needs a spike first.
- Zoom-path changes: the wheel handler already does two-stage; the cache (Phase 3)
  makes returning to a previous zoom level free with zero extra code.

## Pitfalls

- `appState.on('page-change')` (main.ts ~1784) awaits `renderPage`; keep that await
  honest (Phase 2 note) or structural undo flows race the hi-res swap.
- `applyStructuralOp` calls `renderPage` with `suppressPageChangeUndoClear` — the
  placeholder path must not emit extra page-change events.
- The placeholder canvas and the hi-res canvas are different elements;
  `updatePdfCanvas` swaps the `bgImage.image` source — do not call `setPdfImage`
  again for the swap (it destroys/recreates the node and re-draws).
- Cache key must round the scale (`toFixed(3)`) — wheel zoom produces floats like
  1.1000000000000003; unrounded keys make every hit a miss.
- e2e runs against the **built** `dist/` under WebKit — always `npm run build`
  before the Playwright suite.

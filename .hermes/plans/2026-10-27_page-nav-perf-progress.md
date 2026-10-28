# Implementation progress: page-nav perf (plan 2026-10-27_page-nav-perf.md)

Seams (pre-agreed in plan): __REDLINE_DEBUG (navToken, lastRenderWasCacheHit, drawCounts),
tests/unit/page-cache.test.ts, e2e specs on built dist/ under WebKit.

## Phase 1: batched draws — complete
- stage.ts: setPdfImage/updatePdfCanvas/addMarkupNode/clearMarkups → batchDraw;
  new addMarkupNodes (one batchDraw for the batch).
- main.ts: renderPage + rebuildMarkupLayer use addMarkupNodes.
- Instrumented seam: drawCounts {markupSync,bgSync,stageSync} on __REDLINE_DEBUG;
  e2e-page-nav-draws.spec.ts asserts per-nav draws are batched (legend
  ensure/refresh = 1 standalone sync markup draw per nav is allowed).

## Phase 2: two-stage render + navToken — complete
- renderPage: token = ++navToken; placeholder at min(zoom,1) → stage sizing +
  markups + activateCurrentTool (interactive at placeholder res) → hi-res
  loadPage + updatePdfCanvas swap, token+isDestroyed checked at every await
  boundary; 'renderer destroyed' bails silently; hi-res pass awaited (undo/
  structural flows keep honest await semantics); skipped when placeholder ≥ zoom.
- e2e-page-nav-race.spec.ts: rapid card 2→3 clicks settle on page 3, navToken
  monotonic, zero console errors.

## Phase 3: page cache — complete
- src/pdf/pageCache.ts: cacheKey (scale.toFixed(3)), PageCache LRU (Map
  re-insert on hit), 60MP pixel budget, eviction drops refs only.
- renderer.ts: cache inside loadPdf closure (dies with renderer); loadPage
  gained opt-in trackCacheHit (thumb/export calls must not pollute the seam);
  lastRenderWasCacheHit() on PdfRenderer.
- tests/unit/page-cache.test.ts (7 tests: key rounding, hit/miss, budget
  eviction, LRU recency, oversized-entry, no-canvas-mutation).
- e2e-page-nav-cache.spec.ts: 1→2→1 revisit = cache hit.

## Phase 4: neighbor prefetch — complete
- After renderPage's hi-res swap: requestIdleCallback (setTimeout 200 fallback)
  → doc.getPage(i±1) structure warm only (no raster prefetch in v1).

## Phase 5: measure + verify — complete
- scripts/measure-page-nav.mjs (WebKit, serves dist/, pixel-hash probe:
  first-change ms = placeholder visible, stable ms = hi-res settled).
- Numbers on Fable_Concept_Presentation.pdf (59MB/14pg), first-change→stable:
  BEFORE (HEAD 4e92bf2): cold 367→637 / 574→965, warm 54–80→~340, median 71→345.
  AFTER: cold 147→416 / 782→1047, warm 25–42→~305, median 40→319.
  Warm revisits ~2x faster (cache); cold navigations show pixels sooner but
  full-raster cost unchanged (two-stage = perceived win, not raster).
  Tier-2 viewport-capping stays out of scope per plan.
- Full verification: tsc clean, vitest 58/58, build OK, Playwright 43/43
  (40 pre-existing + 3 new) on WebKit production build.

## Code review (two-axis, inline — no subagents on this box)
- Standards: no documented repo standards; drawCounts export is test-only
  instrumentation (plan-sanctioned); trackCacheHit param is seam-honesty, not
  speculative generality. Fixed in review: prefetch warmed i and i+1 instead of i±1.
- Spec: all five phases + pitfalls checklist verified (scale rounding, await
  semantics, no extra page-change events, updatePdfCanvas swap not setPdfImage,
  build-before-e2e). Delivery (0.2.21 bump + deb) is owner-side per plan.

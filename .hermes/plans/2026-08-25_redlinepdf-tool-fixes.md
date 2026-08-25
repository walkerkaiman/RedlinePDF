# RedlinePDF Tool Fixes — Serialized TDD Plan

**Context:** User reports 6 broken behaviors in the desktop app (v0.2.8):
1. Text tool not responsive with the canvas.
2. Draw polygon area behaves like the pen tool, not like lines that share vertices (click-to-place-vertices, closed polygon).
3. Set Scale tool not responsive with the canvas.
4. Count tool not getting activated.
5. Sliders not smooth when dragging — values must commit on mouseup (change), not every frame (input).
6. Measuring tools suspected broken (scale tool is the gate — they require a calibrated scale).

**Architecture reality (verified in code):**
- `toolRunner.setActiveTool(protocol: ToolProtocol)` is the ONLY wiring path (main.ts:750). It binds `mousedown`, and dispatches to `protocol.draw` (drag tools) or `protocol.onClick` (click tools).
- A tool with BOTH `draw` and `onClick` is treated as a DRAW tool — `onClick` is NEVER called. `textTool` has `draw: textDrawPhase` whose phases are no-ops → click swallowed. **Fix: textTool must be `onClick`-only.**
- `scaleSetTool`, `measureLinearTool`, `measureRectTool`, `measurePolyTool` are still the OLD `BaseTool` class (use `stage.on('mousedown.scaleset')` + `ctx`). They are NOT `ToolProtocol`, so `setActiveTool` gets a non-protocol object → nothing binds. **These must be converted to `ToolProtocol`.**
- Slider `input` handler in properties.ts:484 calls `onChange` every frame. `onChange`→`appState.setStyleProp`→render+undo-snapshot. **Fix: label updates on `input` (smooth), `onChange`/commit only on `change` (mouseup).**
- `countOnClick` early-returns when `activeCountCategoryId` is falsy. The default category is seeded at PDF load (loadPdfFile), but a fresh project / no-category state makes it no-op. **Fix: ensure an active category exists (seed if missing) before counting.**

**TDD discipline:** No production code without a failing test first. Each cycle: RED (write failing test) → run, watch fail → GREEN (minimal code) → run, watch pass → refactor → full suite. Tests are Playwright e2e against `npm run dev` (real browser) asserting through `window.__REDLINE_DEBUG`, plus unit tests for pure logic (slider throttle, scale compute).

---

## Phase 0 — Pre-flight (no TDD, setup only)
- [ ] Start `npm run dev` (background). Confirm Playwright can load `tests/fixtures/test-3page.pdf` via the real file-input handler (existing e2e proves the seam works).

## Phase 1 — Text tool responsive (tracer bullet)
**RED**
- [ ] e2e: select text tool, click canvas → assert a `text` markup is committed on active page (debug seam `markupTypes` includes 'text').
**GREEN**
- [ ] Remove `draw` from `textTool` (keep `onClick` + `deactivate`). Verify runner reaches `else if (protocol.onClick)`.
**VERIFY** full suite green.

## Phase 2 — Count tool activates
**RED**
- [ ] e2e: select count tool, ensure a category is active, click canvas → assert a `count` markup committed.
- [ ] unit/integration: with NO active category, a click must seed a default category and still commit (covers the silent no-op).
**GREEN**
- [ ] In `countOnClick` (or activation), if `activeCountCategoryId` falsy → call the existing "seed default category" path; then commit. (Reuse `addCountCategory`/`ensureLegend` already in main.ts.)
**VERIFY** full suite green.

## Phase 3 — Set Scale responsive (convert BaseTool → ToolProtocol)
**RED**
- [ ] e2e: select scale-set, click point A, click point B → assert a calibration modal/dialog appears (or scale-set event fires; expose via debug seam `lastScaleSetClickCount`).
**GREEN (minimal, vertical slice)**
- [ ] Convert `ScaleSetTool` to a `ToolProtocol` with a click-driven two-point flow: `onClick` records point 1 (render dot), second `onClick` records point 2, opens the existing calibration modal, emits `scale-set`. Manage dots/preview lines via `toolRunner` interaction layer access + tool-local state reset on `deactivate`.
- [ ] Register `scale-set` in `toolProtocols` map in main.ts.
**VERIFY** full suite green.

## Phase 4 — Polygon Area: click-to-vertex (shared vertices)
**RED**
- [ ] e2e: select polygon-area, click 3+ vertices (separate clicks, NOT a drag), double-click/Enter → assert a `polygon-area` markup committed with N vertices (debug seam exposes `lastPolygonVertices` count).
- [ ] e2e: a quick drag (mousedown+move+up) does NOT create a stray polygon (proves it's now click-mode, not pen-mode).
**GREEN**
- [ ] Rewrite `polygonAreaTool` as a `ToolProtocol` with `onClick`-based vertex accumulation: each `onClick` pushes a vertex + dot; double-click/Enter (via a `deactivate`-safe key handler or via the runner) finalizes a closed polygon, commits via ADD_MARKUP, clears state. Reuse existing area math.
**VERIFY** full suite green.

## Phase 5 — Measure tools (linear/rect/poly) responsive
**RED**
- [ ] e2e (each): with a calibrated scale set, draw measure-linear (drag) → assert `measure-linear` markup + non-empty label. Same for rect (drag) and poly (multi-click).
**GREEN**
- [ ] Convert `MeasureLinearTool`, `MeasureRectTool`, `MeasurePolyTool` to `ToolProtocol` objects, reusing their existing geometry/label math but driven through the runner's event model (drag for linear/rect; click-vertices for poly). Register all three in `toolProtocols`.
- [ ] Wire the `MEASURE_TOOLS` redirect (main.ts:1307) to pass the protocol through.
**VERIFY** full suite green.

## Phase 6 — Sliders commit on mouseup, not every frame
**RED**
- [ ] unit: `createSliderRow` — simulating rapid `input` events fires `onChange` only on `change` (mouseup), while the label updates on every `input`. Assert `onChange` call count == 1 after input×N + change.
**GREEN**
- [ ] In `properties.ts createSliderRow`: split handler — `input` updates the displayed value label only (cheap); `change` (fires on release/keyboard commit) calls `onChange`. Keep the existing dblclick-to-type path.
**VERIFY** full suite green; manual drag feels smooth.

## Phase 7 — Release
- [ ] tsc --noEmit clean; vitest + playwright all green.
- [ ] Bump version, commit, tag, push → GitHub release build (same flow as v0.2.8).
- [ ] Install new .deb locally; smoke-test each affected tool.

---

## Notes / risks
- `toolRunner` double-binds `mousedown` per `setActiveTool` (anonymous closures never individually removed) — observed in code. During Phase 3–5 conversions, verify `deactivate()` fully unbinds (it does `stage.off('mousedown')`). If ghost listeners surface, fix in a dedicated sub-cycle.
- The `scale-set` and measure tools need `interactionLayer` access for dots/preview — `toolRunner.getStageManager()` exposes it (already used by polygonArea/measure tools).
- Measuring tools require a calibrated scale (user's note #6). Phase 5 e2e must set scale first (or the test asserts the "Set scale first" label path). The real fix is gating + the now-working scale-set tool.

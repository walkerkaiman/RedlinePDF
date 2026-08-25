# RedlinePDF Draw Pipeline Fix — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make every toolbar drawing tool actually render its markup on the PDF canvas (root cause: no `ADD_MARKUP` mutation handler registered → `appState.mutate('ADD_MARKUP', …)` throws and is swallowed in a try/catch), then prove it with real Playwright E2E runs.

**Architecture:** Single choke point — every object-protocol tool commits through `toolRunner._dispatchAdd()` → `appState.mutate('ADD_MARKUP', { markup, pageIndex? })`. The mutation pipeline (`src/state/appState.ts`) requires a handler per kind or it throws; only 4 kinds are registered in `_init()`, so ADD_MARKUP never lands. Fix = register one handler at app startup (in `main.ts`, where the canvas-backed helpers live) that routes each markup type to its existing renderer helper (`addMarkup` / `addCountStamp`). Everything else is verification + test-infrastructure repair, not new runtime code.

**Tech Stack:** TypeScript 5.x, Konva (canvas), Vite dev server :5173, Vitest (jsdom) for units, Playwright (Chromium cached at ~/.cache/ms-playwright/chromium-1228) for E2E against the real app + `tests/fixtures/test.pdf`.

---

## Current state — verified by read-only inspection on 2026-08-23 (do not re-diagnose, just verify where noted)

| Item | Status at HEAD-of-working-tree |
|---|---|
| `npx tsc --noEmit` | ✅ EXIT 0 — **main.ts is NOT mangled** despite compaction note claiming otherwise. Do not `git checkout` anything. |
| Fix A: `toolProtocols` map (src/main.ts:39) | ✅ DONE — box/text/count/pan entries present + imports at lines ~28–37. Leave alone. |
| Fix D: coordinate conversion | ✅ IN PLACE — countTool.ts:27 and textTool.ts:83 call `konvaToPdf`; lineTool uses `konvaPointsToPdf`; boxTool reads previewRect attrs as PDF pts (no zoom division). Correctness gets *runtime* proof in Task 5. |
| **Fix B: ADD_MARKUP handler** | ❌ **MISSING — the one real code fix left.** Zero hits for `registerMutationHandler('ADD_MARKUP')` anywhere; `_init()` registers only TOGGLE_TOOL/CHANGE_PAGE/SET_SELECTION/LOAD_PROJECT_DATA (appState.ts:150–213). Every committed stroke throws inside toolRunner's try/catch (`src/tools/toolRunner.ts:~206`) → nothing renders. |
| canvasSync middleware | ❌ DEAD — `setupCanvasSync` is never called from anywhere; also its `getCurrentPageMarkups()` hard-returns `[]`. The handler must **not** route through it (documented as a trap below). |
| Undo tracking (`undoTracking.ts`) | Intentionally dormant by design at HEAD: main.ts has its own working undo stack via `snapshotMarkups()`/`restoreSnapshot()`, called from inside addMarkup/addCountStamp. Calling `setupUndoTracking()` would double-track; it was already removed from `_init()` in a prior session (see appState.ts diff). **Out of scope — do not re-wire.** |
| Unit tests | ⚠️ 1 test, passes when run as `npx vitest run tests/unit`. Bare `vitest`/`playwright --list` also tries to parse Playwright specs → SyntaxError. Needs include/exclude split (Task 3). Also: earlier note said the spec had "dead `[data-tool=…]` selectors" — FALSE; index.html has them on every toolbar button, and canvas is `#konva-container`. The real bug in that e2e file was a trailing brace mismatch / stale heuristics. |
| E2E fixture path for PDF load | ✅ Hidden input exists: `<input type="file" id="file-input-pdf">` (index.html:247). No Tauri needed — `setInputFiles()` on the hidden element works, and drag-drop also routes to same handler (`handleDroppedFile`). |
| Git tree | 7 modified files uncommitted from prior sessions + this cycle's verified-good fixes. **First commit of execution should freeze that state before making new changes.** |

### The one runtime fix (shape preview — full code in Task 1)

Registered once at module top-level of `src/main.ts`, right after imports:
`appState.registerMutationHandler('ADD_MARKUP', ({ markup }) => { if ((markup as CountMarkup).type === 'count') addCountStamp(markup); else addMarkup(markup); });`

Why main.ts (not appState._init, not canvasSync): `addMarkup`/`addCountStamp` live at module scope in main.ts and touch `stageManager`, the undo snapshot stacks, count legend + summary side effects — a circular import would result from registering them inside appState. `_computeDiff('ADD_MARKUP')` already returns `{ type:'add', markupId }`, but since no post-hook is subscribed (canvasSync never set up), we rely on the helpers calling `stageManager.addMarkupNode()` directly — which they do.

---

## Task 0: Freeze current state in git

**Objective:** No regression risk from later edits; every subsequent task commits independently.

**Files:** none changed — commit only.

Steps:
1. Run `git status --short` and confirm the expected set (main.ts, appState.ts, toolRunner.ts, panTool.ts, boxTool.ts, countTool.ts, textTool.ts + untracked tests/, vitest.config.ts, playwright.config.ts). Anything unexpected → stop and surface to user before committing.
2. `git add -A` then commit: message `fix(redline): wire drawing tools — protocol map entries (box/text/count/pan) + PDF-space coordinate conversion; pre-fix-B baseline`. This deliberately bundles prior-session work so the Task 1 handler lands as its own isolated, revertable commit.
3. Verify `git log --oneline -2` shows it and tree is clean-ish (`?? .claude/`, playwright-report/, test-results/ may remain untracked — fine; don't add a `.gitignore` entry in this plan's scope unless trivial).

---

## Task 1: Register the ADD_MARKUP mutation handler (THE fix)

**Objective:** `appState.mutate('ADD_MARKUP', { markup, pageIndex? })` no longer throws and routes to the correct canvas helper.

**Files:**
- Modify: `src/main.ts` (~line 38, immediately before/after the existing imports of boxTool/textTool/countTool/panTool at lines ~28–37)

Step 1 — add registration block (copy-pasteable; place after the panTool import line and before the blank-line + toolProtocols map):
```ts
// ADD_MARKUP is dispatched from toolRunner._dispatchAdd() for every committed stroke.
// Without a registered handler appState.mutate() throws ("No handler registered"), which
// toolRunner swallows — net effect: tools accept input but nothing renders. Register here
// (not in appState._init) because the canvas-backed helpers addMarkup()/addCountStamp()
// live at this module's scope; registering from state/ would be a circular import.
appState.registerMutationHandler('ADD_MARKUP', ({ markup }) => {
  if ((markup as CountMarkup).type === 'count') {
    // Counts need legend + count-summary side effects that addCountStamp handles.
    addCountStamp(markup);
  } else {
    addMarkup(markup);
  }
});
```
(`CountMarkup` is already imported in main.ts line ~21; `appState` at line 3 — no new imports needed.)

Step 2 — verify compile: Run `npx tsc --noEmit`. Expected: EXIT 0. (Function declarations hoist, so top-level placement calling addMarkup/addCountStamp is safe even though those functions are defined lower in the file; execution only fires at runtime on first draw.)

Step 3 — smoke check without a browser: grep to confirm exactly one registration of this kind now exists: `grep -rn "registerMutationHandler('ADD_MARKUP'" src` → expected: single hit, main.ts.

Step 4 — Commit:
```bash
git add src/main.ts && git commit -m "fix(redline): register ADD_MARKUP handler routing to addMarkup/addCountStamp"
```

**Verification of THIS task's behavior happens in Task 5 (E2E)** — do not call it fixed on a smoke grep alone. The compile + single-registration check only proves wiring, not rendering.

---

## Task 2: Harden commit-path consistency across the four new-map tools (small)

**Objective:** All protocol commits pass `pageIndex` so markup lands unambiguously; eliminate any remaining raw-Konva coordinate escape hatch among map-registered protocols.

Context from inspection: lineTool/arrowTool/box/polygon already convert PDF-space and set pageIndex; countTool.ts's mutate call omits `pageIndex`; textTool includes it. `ensurePage(undefined)` falls back to current page so this is cosmetic for now, but the pipeline payload type (`AddMarkupPayload.pageIndex?`) exists — use it consistently (DRY: one shape at every commit site).

**Files:**
- Modify: `src/tools/countTool.ts` (~line 41) — add `, pageIndex: toolRunner.getPageIndex()` to its mutate payload. Mirror textTool's existing call (`toolRunner.getAppState().mutate('ADD_MARKUP', { markup, ... })`).

Step 1: Apply the one-line change (read current exact line first; keep surrounding code byte-identical otherwise).
Step 2: `npx tsc --noEmit` → EXIT 0.
Step 3: Commit `refactor(redline): pass pageIndex in all ADD_MARKUP payloads`.

If during step 1 the implementer finds countTool's commit site already passes it (file may have drifted since inspection) — verify with grep, then this task is a no-op; still record that verification. **Do not "fix" line/arrow/polygon box-protocol commits in their geometry code here** — coordinate math was verified correct at the prior session and gets runtime proof in Task 5; touching it risks regression for zero gain (YAGNI).

---

## Task 3: Test-infrastructure split so unit + e2e each run clean

**Objective:** `npx vitest` runs ONLY tests/unit/**.ts and Playwright only parses *.spec.ts — no more cross-collection SyntaxError from bare commands, reproducible green baseline before the behavioral fix is proven in E2E. (This task does not touch runtime code.)

Context: vitest.config.ts currently has **no** `include`/`exclude`, so it glob-matches Playwright spec files and chokes; Playwright's default include (`*.(test|spec).?(c|m)[jt]s`) correctly ignores the unit file. Bare `npx playwright test --list` surfaced a real parse error in e2e-draw-pipeline.spec.ts, which Task 4 rewrites wholesale anyway — order matters: do NOT fix that spec's syntax here; replace it (Task 4).

**Files:**
- Modify: `vitest.config.ts`

Step 1 — rewrite vitest.config.ts completely to this shape:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.spec.ts'],
  },
});
```
Step 2 — Run `npx vitest run` → expected: **1 file / 1 test, passed**. (Before the change, bare run collected e2e specs and errored.)
Step 3 — Commit `test(redline): scope vitest to tests/unit; keep spec files for Playwright only`.

---

## Task 4: E2E proof of fix B + regression coverage per tool type (new deterministic spec)

**Objective:** Real Chromium run proves each map-registered protocol renders a real Konva markup node after draw, through the ACTUAL pipeline (`_dispatchAdd → mutate('ADD_MARKUP') → handler → addMarkup/addCountStamp`). Also locks in coordinate correctness indirectly: box/line assertions check rendered geometry against where we dragged.

This REPLACES `tests/e2e-draw-pipeline.spec.ts` (current file has a brace-mismatch parse error and an SVG-based assertion that will never match Konva's `<canvas>` output — the old "svg line count" heuristic is dead by construction). Keep its filename so nothing else needs rewiring, but rewrite content entirely.

**Files:**
- Modify: `tests/e2e-draw-pipeline.spec.ts` (full replace)
- Do not modify playwright.config.ts or fixtures; Chromium 1228 + fixture are confirmed present.

Step 1 — Write the spec using this contract (implementer keeps it verbatim, filling in any import path details by reading toolRunner/main imports):
```ts
import { test, expect } from '@playwright/test';

const PDF = 'fixtures/test.pdf'; // relative to tests/ per Playwright resolvePath convention; if not found at runtime use absolute: new URL('./e2e-draw-pipeline.spec.ts', import.meta.url) dirname join fixtures/test.pdf — verify once with a failing run
// Shared helper, defined ONCE (DRY): load fixture PDF through the app's hidden input.
async function openFixturePdf(page) { /* setInputFiles on '#file-input-pdf' */ }

test.describe('Full Draw Pipeline', () => {
  // beforeEach: goto base → expect('#app').toBeVisible() → await openFixturePdf(page) → wait until stageManager is ready (poll console for '[Stage] Ready' or equivalent marker emitted by main.ts; if none exists, poll '#status-page' textContent matches /^\d+ \/ \d+$/)
  
  // Assertion helpers — Konva renders one <canvas> per Layer inside #konva-container. Markup nodes are Groups named 'markup'. So: count markup-bearing shapes via evaluate on the live stage object ONLY IF reachable from window; otherwise (it's a module local, it is NOT) fall back to pixel evidence as below. DO NOT try `window.stageManager` — confirm first by reading main.ts whether anything assigns to globalThis/window before choosing strategy A vs B:
  // Strategy A (preferred if exposed): page.evaluate(() => stage.search(...)) style counting
  // Strategy B (guaranteed, no app changes required): screenshot the #konva-container region BEFORE and AFTER each draw; expect PNG bytes differ by > N px changed-region area — implement with a tiny diff helper in this file only.

  test('line tool drag renders one line markup', ...);   // click [data-tool="line"] → mouse.down center of konva container canvas, move +80,+40px over the visible page region (NOT raw box coords if the stage is scaled/offset — read #status-cursor after moving to confirm x/y actually tracked), up. Assert before/after diff present AND console did NOT emit "Failed to dispatch ADD_MARKUP".
  test('box tool drag renders one rect markup', ...);    // same shape; additionally verify [data-tool="select"] auto-activated (addMarkup switches tools at end of draw — expected current behavior, see Task 6).
  test('text tool click+enter commits a text node', ...);// activate → click center of page area in konva container → type "QA" into the inline editor overlay if present, else press Escape/Enter depending on reading textTool's actual commit trigger (read src/tools/textTool.ts first; do NOT guess) — then assert pixel diff.
  test('count tool click stamps a count symbol', ...);   // needs an active category: read addCountCategory path in main.ts to find the minimal UI route (properties panel button or keyboard shortcut); if no deterministic way exists without adding app code, SKIP with expect.soft + console.warn and note as open question — do not invent UI.
  test('regression: pan tool drag does NOT create a markup', ...); // before/after pixel diff must be below threshold for the drawing area (pan moves the stage itself). Locks in that we didn't over-wire ADD_MARKUP to fire on passive drags.
});

// After all tests pass once, capture one screenshot artifact named per-test under playwright-report/ or test-results/ — useful manual evidence; do NOT assert on it programmatically (fragile across resizes/fonts).
```

Step 2 — Run `npx playwright test --reporter=line`. Expected outcome matrix: **before Task 1 is in place** this spec fails all draw tests with the console error "Failed to dispatch ADD_MARKUP" visible in Playwright output; **after** Tasks 0+1, everything green. Implementer should run once BEFORE applying Task 1 (if possible without breaking CI-style flow) purely as a negative baseline and record it — this is the honest TDD RED step for fix B since there's no unit-level seam for "handler registered" that doesn't require importing main.ts into jsdom (out of scope, too heavy).

Step 3 — Iterate until all green; each iteration commit only after re-running full e2e (`npx playwright test`) so we never ship a partial state where line works but box regressed. Commit message: `test(e2e): replace broken draw-pipeline spec with real Konva render assertions`.

Pitfalls baked into the contract above — do not "fix" by guessing:
- Old spec's `[data-tool="line"]` selector IS correct (verified in index.html). Don't second-guess from compaction notes.
- The canvas element to target for mouse coords is `#konva-container > canvas` (first one = bg layer under everything; events hit Konva via the topmost listener-carrying canvas — either works, pick first and keep consistent within each test). Never use raw SVG queries anywhere in this file again.
- If a draw's start point lands on an existing markup from an earlier test in same page instance (they share beforeEach fresh loads so shouldn't), ignore; don't add cleanup that doesn't exist yet — YAGNI.

---

## Task 5: Confirm coordinate correctness at runtime for box + line specifically

**Objective:** Independent of "something rendered", verify the drawn shape sits where we dragged it (catches any residual sign-flip/unit error in konvaToPdf usage introduced during prior patches). This is a *checklist step*, not new code — run it inside Task 4's test body or as one additional focused e2e assertion; if already covered by geometry-sensitive assertions written there, this collapses into Task 4 and you just confirm coverage explicitly.

Concretely: for the box drag test, record starting cursor position from `#status-cursor` text before mousedown (it tracks Konva coords), compute expected pixel delta ≈ same on-screen as post-drag status bar; assert final rendered rect's bounding region overlaps both start and end cursor screen positions within a generous tolerance band (±15% of page width to account for Y-flip making "up in PDF" = smaller y visually — only sanity-bounded, not exact). If this proves impossible without stage internals exposed, downgrade Task 5 to: manual one-time visual confirmation via saved screenshot compared side-by-side with recorded cursor trail coordinates printed from test logs (document the limitation honestly rather than fake numeric assertion precision we can't actually back up given no DOM id per node currently).

**Files:** likely none beyond what Task 4 already wrote; if a second e2e file gets cleaner, prefer extending existing one over forking — DRY.

If exact verification is blocked by absence of stable selectors/ids on individual markup nodes: that's an ACCEPTED limitation to state in final report (documented as known gap), not a reason to add speculative node-id DOM attributes now unless user wants it later. Record this explicitly either way; don't silently weaken the assertion without flagging so.

---

## Task 6 (optional, only if Tasks 0–5 all green and no time budget concerns): continuous-draw UX refinement — do NOT force-return to select tool after each stroke for line/arrow-type freeform tools that support multi-stroke gestures in one activation session

**Objective:** Currently `addMarkup()` unconditionally calls `appState.setTool('select')` + selects the just-added node. For a user who wants 10 quick tally-like box draws, this forces re-clicking Box between each stroke — poor but not broken; only implement if there's an established expectation/prior art (check git log/blame on that line in main.ts addMarkup before changing it — earlier compaction notes suggested this auto-switch was intentionally removed once already and may have been a deliberate rollback for selectTool/transformer reasons, see comment block inside addMarkup about "same mousedown event continues to fire"). **Default stance: LEAVE IT; treat as open question surfaced in final summary rather than an implemented task**, unless inspection shows the removal is trivially safe (i.e., no transformer code path depends on it running immediately). If implementing anyway, gate via a per-tool optional flag passed into commit payload (`{ keepTool?: boolean }`) and set true ONLY for box/line; do not blanket-change select tool's own post-draw selection UX.

**Files:** `src/main.ts` (addMarkup), possibly one or two protocol files to pass the flag — but only after reading addMarkup's existing rationale comments in full first, as they explicitly document a Konva event-reordering bug workaround that may make this unsafe without deeper analysis; do not implement blindly if those guards look load-bearing.

---

## Files likely changed (summary)
- `src/main.ts` — Task 1 handler registration block (~8 lines near top), nothing else structural touched.
- `src/tools/countTool.ts` — one payload field added, Task 2.
- `vitest.config.ts` — include/exclude scope, Task 3.
- `tests/e2e-draw-pipeline.spec.ts` — full replacement with deterministic Konva-based assertions + pixel-diff helper in-file (no shared new test-util module unless the diff logic grows >~40 lines; if it does, promote to tests/helpers/pixelDiff.ts and import from spec).
- Task 6: only src/main.ts addMarkup (+ maybe one protocol flag) — OPTIONAL.

Explicitly NOT changed (and why): appState.ts handler table (keep registration colocation in main.ts for circular-import safety), canvasSync.ts entirely, undoTracking wiring line removal already at HEAD is intentional per design comments there, all other tool files' coordinate math (verified correct; runtime-confirmed via Task 5 rather than rewritten).

## Verification gates — exact commands + expected results
1. `npx tsc --noEmit` → EXIT 0 after every code task's step that modifies src/.
2. `npm run build` once at very end before final commit, expecting only pre-existing chunk-size warnings (already present per prior session), exit 0 — catches any runtime-module graph breakage a top-level registration could theoretically introduce if it accidentally evaluated addMarkup at import time instead of call-time (shouldn't, but confirm empirically rather than assume).
3. `npx vitest run` → exactly "1 file / 1 test passed" throughout Tasks 0–6 (no new unit tests planned; the behavioral change is covered by E2E per Task 4 rationale — deliberately NOT faked with a jsdom-stubbed addMarkup call just to tick an arbitrary box, since that wouldn't actually exercise Konva/stageManager).
4. `npx playwright test --reporter=line` → all green (expect ~5 tests from the rewritten spec) as THE acceptance gate for "the program is fixed" — this is the real bar replacing prior session's weaker claim of compile-cleanliness-only, since we now actually have a working E2E harness to use.
5. Manual one-off: run `npm run dev`, open in a normal browser (not headless), load tests/fixtures/test.pdf via drag-drop OR File→Open using the hidden input indirectly through OS dialog is fine too — confirm 3 of {line, box, text} visibly render as expected by eye, since automated pixel-diff tolerance band intentionally kept loose to avoid flakiness and doesn't replace a human confirming "looks right" at least once. Do this before declaring done; capture one screenshot for the record (do not commit it).

## Risks / tradeoffs / open questions
- Risk: `#status-cursor`/pixel-diff tolerance chosen too loose to actually catch a real 1-unit-off geometry bug, or too tight → flaky across font-rendering/DPI differences between local runs and any future CI. Mitigation: start with the looser bound; tighten only if Task 5's negative-baseline run (before applying fix B) accidentally also passes pixel diff on an EMPTY page change — i.e., verify our "difference" detector actually distinguishes pre-fix-failure from post-fix-success by watching it fail RED first.
- Tradeoff accepted: no new unit tests for handler registration itself, because isolating appState without importing main.ts's stage-dependent helpers forces stubbing Konva (overkill; YAGNI) — E2E is the honest test layer here given real browser + real PDF fixture already exist and work with cached Chromium.
- Open question: Task 6 continuous-draw behavior intentionally deferred to "surface, don't implement" unless code inspection proves trivially safe — surface it in final report either way so user can explicitly ask for it next cycle if wanted; do not silently include or exclude based on convenience mid-task-list.
- Known limitation (state honestly in final summary, matches prior session's honest-reporting norm): no per-markup stable DOM id currently exists to assert exact coordinates numerically — Task 5 may downgrade to visual/loose-tolerance verification and that should be reported as a real gap, not glossed over with an overly precise-sounding assertion we can't actually make stick across Konva internals.

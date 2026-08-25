# Unit Testing — Phase 1: Pure Logic + State Mutation Pipeline

## Problem Statement

The codebase has grown significantly with tool refactoring (Phase 3), state management redesign (Phase 2), and geometry transforms. Without automated tests, regressions during future refactorings are invisible until they reach the user or break the build in subtle ways. The developer can't confidently:
- Add new tools without breaking existing ones
- Modify mutation pipeline logic without testing diff computation
- Change geometry math without verifying spatial accuracy
- Refactor storage/export modules without losing data integrity

Manual testing requires opening PDFs, drawing markups, exporting — a slow feedback loop that doesn't catch edge cases.

## Solution

Establish an automated test infrastructure using Vitest (already aligned with Vite build system) and write first-tier tests covering:
1. Pure geometry transforms (konvaToPdf, polygonArea, distance calculations)
2. State mutation pipeline behavior (pre-hooks → handler → diff → post-hooks ordering)
3. Tool protocol compliance across all 12 tools

These tests run in seconds, catch mathematical errors immediately, and validate the event-driven architecture contracts — without requiring browser mocks or real PDF files.

## User Stories

As a developer refactoring tool code (Phase 3+), I want to know within seconds if my geometry math breaks spatial accuracy, so that I can fix coordinate conversions before they affect export quality.

As a maintainer modifying the mutation pipeline (phase 2 core), I want tests verifying pre-hooks capture state correctly and diffs compute minimal changes, so that undo/redo and canvas sync stay reliable as features compound.

As someone adding new markup types (Phase 5+), I want tool protocol compliance tests catching contract violations at test time, not build time or runtime, so that new tools integrate cleanly with ToolRunner.

As a developer working on storage modules (export/import/project save), I want pure transformation functions tested (base64 conversion, JSON serialization) so that round-trip data integrity is verifiable without real file I/O setup.

When the build passes, I expect tests to also pass — failing tests should indicate real regressions, not false positives from environment issues.

Tests must run in seconds (<10s total for Tier 1-2), or they won't be used daily.

## Implementation Decisions

**Testing framework:** Vitest + jsdom (not Jest). Already on Vite, zero config needed, native ES modules support, ~50% faster execution for TS projects. Auto-discovers `src/**/*.test.ts` files — tests live next to the code they test for clearer relationship mapping.

**Test organization:** Tiered by complexity and setup cost:
- Tier 1 (geometry): pure math, no mocks needed, <1s execution
- Tier 2 (state): mutation pipeline validation, minimal mocking possible, <2s execution  
- Tier 3 (tool protocols): interface compliance checks across all 12 tools, ~30 assertions total, <2s execution
- Tier 4 (measure math + storage): deferred until Tier 1-3 pass

**Modules targeted for testing:**
- `src/geometry/transform.ts` — konvaToPdf coordinate conversion, distance/polygonArea/polygonPerimeter calculations
- `src/state/appState.ts` — mutation pipeline ordering, diff computation, state management methods (setTool, setPage, setSelection, subscribe/notify)
- `src/tools/toolProtocol.ts` — interface shape compliance of all 12 tool exports
- `src/storage/projectStore.ts` (Tier 4): `uint8ArrayToBase64` / `base64ToUint8Array` pure conversions only

**Modules deferred for future phases:**
- Tool draw phases (`startDraw`, `midDraw`, `endDraw`) — require Konva browser mocks (~30 min setup cost)
- `src/canvas/stage.ts` — depends on live state diffing with Konva layer
- Storage IndexedDB/file I/O operations (require jsdom + File System Access API mocking)
- PDF export pipeline (requires pdfjs-dist rendering, Canvas API access)

**Test pattern:** Tests verify external behavior only — never implementation details. Use real inputs/outputs, not mocked internals that break on refactoring.

**Seam placement:** Testing pure functions at their highest abstraction layer (e.g., `buildRedlinePayload` rather than testing individual JSON field construction). Geometry transforms tested via round-trip verification where possible.

## Testing Decisions

**What makes a good test:**
- Verifies real behavior that users care about, not implementation mechanics
- Catches actual bugs: wrong coordinate conversion, missing diff computation steps, incorrect state update merging
- Survives refactoring — tests `konvaToPdf` output for known inputs, doesn't mock the function itself
- Fast feedback loop: <10s total execution time ensures daily use

**Test strategy by module:**

*Geometry transforms:* Known-input verification (e.g., konva point at 100,200 on A4 page → expected PDF coordinates). Round-trip preservation (konva→pdf→konva should return original coords). Mathematical correctness (polygon area formula verified against known shapes).

*State mutation pipeline:* Ordering verification (pre-hooks run before handler, diffs computed after handler executes). State merging correctness (`update({zoom: 1.5})` leaves other fields unchanged). Diff computation accuracy (style update with no real changes returns null to skip canvas redraw).

*Tool protocols:* Contract compliance (each tool exports `{id, name}` with either `draw` or `onClick`). Interface shape validation (DrawPhase functions accept correct parameter shapes). Behavioral expectations (select/pan/count tools don't have unnecessary draw phases).

**Test isolation:** Each test file imports only what it needs. No global state mutation between tests. Test data constructed inline — no external fixtures needed for Tier 1-2.

## Out of Scope

- Tool draw phase testing (requires Konva browser mocking, deferred to Phase 5)
- Canvas sync behavior verification (depends on live state + stage setup)
- Storage/IndexedDB integration testing (deferred until jsdom + mock setup complete in Month 3)
- PDF export pipeline functional testing (requires pdfjs-dist rendering environment)
- UI component testing (Vue DevTools, toolbar interactions — not part of this phase)
- Performance benchmarking (execution speed measurement beyond "fast enough")

## Further Notes

**Open questions:**
- Should Tier 4 storage tests use jsdom mocks or real IndexedDB? Decision pending based on test setup complexity analysis.
- How to handle Tauri-specific native file dialogs in future test phases (requires @tauri-apps plugin mocking).
- Whether canvasSync.ts diff computation needs direct testing or is covered transitively by mutation pipeline tests.

**Known constraints:**
- jsdom doesn't support Konva's Canvas API rendering — tool draw phase tests require actual browser environment or Konva mocks
- File System Access API (`showSaveFilePicker`) unavailable in Node.js test environments
- pdfjs-dist requires real PDF files and worker thread setup for rendering tests

**Next phases (deferred):**
- Month 2-3: Tool draw phase integration tests with jsdom Konva mocks (~30 min setup, highest payoff)
- Month 4+: Storage/IndexedDB tests once File System Access API mocking is resolved
- Ongoing: Performance regression tests as features compound

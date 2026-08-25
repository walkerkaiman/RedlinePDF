# Unit Testing Phase 1 — Pure Logic + State Mutation Pipeline

## Problem Statement

The RedlinePDF codebase has grown through three major refactoring phases (event-driven architecture v1/v2, tool protocol abstraction), adding substantial logic for geometry transforms, state management via mutations, and 12 interactive markup tools. Currently there are no automated tests — manual verification requires opening PDFs, drawing markups, exporting files, which takes minutes per cycle rather than seconds, making regressions invisible until they reach users or break builds in subtle ways.

Without test infrastructure:
- Adding new markup types risks breaking coordinate conversion math silently
- Modifying the mutation pipeline may produce incorrect diffs for undo/redo and canvas sync
- Changing tool protocol shapes could violate ToolRunner contract expectations at runtime
- Storage/export round-trip integrity is unverified until users actually save/load files

The developer cannot confidently refactor, add features, or fix bugs without a fast feedback loop that catches regressions in seconds rather than requiring full application restarts.

## Solution

Establish an automated test infrastructure using Vitest (already aligned with Vite build system, no additional config needed) and implement Phase 1 tests covering pure logic modules first:

1. **Geometry transforms** — `konvaToPdf()` coordinate conversion, polygon area/perimeter calculations, distance computations
2. **State mutation pipeline** — pre-hook capture ordering, diff computation correctness, state merging behavior  
3. **Tool protocol compliance** — interface shape validation across all 12 tool exports

Phase 1 tests run in <10 seconds total execution time and require no browser mocks or real file I/O setup. Browser-dependent testing (tool draw phases, canvas sync, IndexedDB storage) is deferred to Phase 2+ when jsdom/Konva mock infrastructure is established.

## User Stories

As a developer refactoring tool code in future phases, I want to know within seconds if my geometry math breaks spatial accuracy, so that coordinate conversions don't silently produce misaligned exports.

As a maintainer modifying the mutation pipeline (phase 2 core architecture), I want tests verifying pre-hooks capture state correctly and diffs compute minimal changes, so that undo/redo snapshots and canvas sync stay reliable as features compound.

As someone adding new markup types (future phases), I want tool protocol compliance tests catching contract violations at test time rather than build time or runtime, so that new tools integrate cleanly with ToolRunner's event dispatching.

When I run `vitest run` in the terminal after making changes to geometry math or state management, I expect failing tests to indicate real regressions — not false positives from environment issues or setup problems.

As a developer working on storage/export modules (future phases), I want pure transformation functions tested first (base64 conversion, JSON serialization) so that round-trip data integrity is verifiable without the complexity of file system mocking.

The test suite must execute in seconds (<10s total for Phase 1 Tier 1-2 tests), otherwise developers won't run it daily and the regression safety net becomes theater.

## Implementation Decisions

**Testing framework:** Vitest + jsdom (not Jest). Already on Vite, zero config needed, native ES modules support, ~50% faster execution for TS projects compared to Jest. Auto-discovers `src/**/*.test.ts` files — tests live next to the code they test for clearer relationship mapping and easier navigation in IDEs.

**Test organization by complexity and setup cost:**
- Tier 1 (geometry transforms): pure math, no mocks needed, <1s execution time
- Tier 2 (state mutation pipeline): mutation ordering + diff computation validation, minimal mocking possible, <2s execution time  
- Tier 3 (tool protocol compliance): interface shape checks across all 12 tool exports, ~30 assertions total, <2s execution time

**Modules targeted for Phase 1 testing:**
- `src/geometry/transform.ts` — konvaToPdf coordinate conversion, distance/polygonArea/polygonPerimeter calculations
- `src/state/appState.ts` — mutation pipeline ordering (pre-hooks → handler → diff → post-hooks), diff computation accuracy, state management methods (setTool, setPage, setSelection, subscribe/notify)
- `src/tools/toolProtocol.ts` — interface shape compliance of all 12 tool exports

**Modules deferred to Phase 2+ (require browser mocks or complex setup):**
- Tool draw phases (`startDraw`, `midDraw`, `endDraw`) — require Konva browser mocking (~30 min infrastructure setup cost)
- `src/canvas/stage.ts` — depends on live state diffing with Konva layer state
- Storage IndexedDB/file I/O operations (require jsdom + File System Access API mocking)
- PDF export pipeline (requires pdfjs-dist rendering environment, real PDF files)

**Test pattern and philosophy:** Tests verify external behavior only — never implementation details. Use real inputs/outputs that match what users experience, not mocked internals that break on refactoring. Follow red→green TDD loop: write failing test first, implement minimal code to pass it, refactor if needed without breaking tests.

## Testing Decisions

**What makes a good test (per project standards):**
- Verifies real behavior that users actually care about — not implementation mechanics or internal helper functions
- Catches actual bugs: wrong coordinate conversion producing misaligned exports, missing diff computation steps causing redundant canvas redraws, incorrect state update merging losing selection context
- Survives refactoring — tests `konvaToPdf` output for known inputs regardless of how the function is implemented internally; if you change the algorithm but outputs stay identical, tests still pass

**Test strategy by module:**

*Geometry transforms:* Known-input verification (e.g., konva point at 100,200 on A4 page → expected PDF coordinates based on Y-flip math). Round-trip preservation where possible (konva→pdf→konva should return original coords within floating-point tolerance). Mathematical correctness verified against known shapes (rectangle area = width × height, triangle = base × height / 2, etc.).

*State mutation pipeline:* Ordering verification that pre-hooks run before handler executes and diffs are computed after the handler. State merging correctness — `update({zoom: 1.5})` should leave all other fields unchanged except those explicitly modified. Diff computation accuracy verified: style update with no real changes returns null to skip canvas redraw, preventing N redundant Konva updates during slider drags.

*Tool protocols:* Contract compliance — each tool must export `{id, name}` with either `draw` or `onClick` handler defined (never both missing). Interface shape validation ensuring DrawPhase functions accept correct parameter shapes (`startDraw({x,y})`, not extra args). Behavioral expectations verified: select/pan/count/scaleSet tools should not have unnecessary draw phases when onClick suffices.

**Test isolation strategy:** Each test file imports only what it needs for that specific module's behavior. No global state mutation between tests — appState instance reset or fresh mocks per test where needed. Test data constructed inline within test blocks rather than loading external fixtures, avoiding file path dependencies that break on CI.

## Out of Scope

**Explicitly excluded from Phase 1:**
- Tool draw phase testing (requires Konva browser mocking infrastructure, deferred to Phase 2)
- Canvas sync behavior verification (depends on live state diffing with Konva layer setup, Phase 2 scope)
- Storage/IndexedDB integration testing (deferred until jsdom + File System Access API mocking completed in Month 3+)
- PDF export pipeline functional testing (requires pdfjs-dist rendering environment, not part of pure logic validation)
- UI component testing (Vue DevTools, toolbar interactions — separate concern from core architecture)
- Performance benchmarking and measurement beyond verifying execution speed stays under the <10s threshold

**Phase 2+ scope (deferred):** Browser-dependent module tests once jsdom/Konva mock infrastructure established. Storage/IndexedDB round-trip verification with mocked browser APIs. Canvas sync diff computation testing against real state changes. Tool draw phase integration testing across all 12 tools using Konva stage mocks.

## Further Notes

**Open questions requiring resolution:**
- Should Phase 2 storage tests use jsdom IndexedDB mocks or require actual browser environment? Decision pending based on setup complexity analysis and whether mock fidelity is sufficient for catching real bugs.
- How to handle Tauri-specific native file dialogs in future test phases (requires `@tauri-apps/plugin-dialog` and `@tauri-apps/plugin-fs` plugin mocking strategy).
- Whether canvasSync.ts diff computation needs direct unit testing or is covered transitively by mutation pipeline tests verifying pre-hook capture and handler execution ordering.

**Known constraints affecting Phase 1 scope:**
- jsdom doesn't support Konva's Canvas API rendering — tool draw phase tests require actual browser environment or extensive Konva mock setup (~30 min infrastructure cost)
- File System Access API (`showSaveFilePicker`) unavailable in Node.js test environments without polyfills that may not exist for this use case
- pdfjs-dist requires real PDF files and worker thread setup for rendering tests — not feasible to mock without full document pipeline

**Execution priority recommendation:** Implement Tier 1 first (geometry transforms, fastest feedback loop). Add Tier 2 immediately after (state mutations, validates the event-driven architecture core). Phase 3 tool protocol compliance last in Phase 1 since it's mostly compile-time validation but provides good safety net.

**Future phases timeline estimates:**
- Month 2-3: Tool draw phase integration tests with jsdom Konva mocks (~30 min setup, highest payoff per test)
- Month 4+: Storage/IndexedDB tests once File System Access API mocking is resolved
- Ongoing: Performance regression tests as features compound and mutation pipeline complexity grows

**Alignment with project standards:** Follows Matt Pocock TDD methodology (red→green loop), builds tight feedback loops (<10s execution), verifies real behavior not implementation details, uses highest seams for testing (external function outputs rather than internal helper validation). Tests serve as tracer bullets responding to each cycle's learnings — no speculative tests beyond current functionality.

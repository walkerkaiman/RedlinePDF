
## Redline combine + page panel (2026-10-27) — committed b71894f

- **Done:** all phases 1-4 of .hermes/plans/2026-10-27_combine-and-reorder-pages.md. combine.ts core, project v2 migration, drop-append, page panel (reorder/rotate/delete/insert-at), structural undo, queueStructural serializer, renderer isDestroyed() guard.
- **Delete-test flakiness root cause:** NOT the app — test expectation arithmetic (delete(1) then delete(0) leaves original page 2, not page 0). App behavior verified correct step-by-step via [dbg] seam logs (since removed).
- **Verified:** tsc clean; vitest 51/51; Playwright 39/39 incl. e2e-combine 4/4, e2e-page-panel 5/5.
- **Bonus fix:** project-scale-restore.spec.ts pointed at a deleted Desktop .redline — created committed fixture tests/fixtures/scaled-project.redline (ESM: no __dirname, used process.cwd()).
- **Left:** user drag-drop confirmation on the desktop build; Windows/macOS installers.
- **Update 12:30:** built RedlinePDF_0.2.19_amd64.deb (4.6 MB, sent to user over WhatsApp). AppImage step fails (`failed to run linuxdeploy`) — pre-existing; deb+rpm bundle fine.
- **Update 18:21:** installed 0.2.19 deb system-wide (replaced 0.2.18); removed corrupt junk launcher `redline.desktop**` from ~/.local/share/applications; wrote clean user override RedlinePDF.desktop (validated, pinned to Ubuntu dock favorites); gtk-launch smoke: process starts, stops clean.
- **Update 18:45:** page-panel card click now navigates the editor (PagePanelOps.navigate -> appState.setPage; old handler only set a local highlight). New e2e 'clicking a page card navigates' — full suite 40/40 on WebKit production build, vitest 51/51, tsc clean. Bumped 0.2.20, built deb, installed system-wide (AppImage linuxdeploy failure still pre-existing).
- **Perf probe (page nav):** WebKit + 59MB/14pg PDF: first visit ~1.8s (cold getPage+raster), warm ~90-110ms. Per-nav waste: bg drawn twice (setPdfImage draw + setZoom stage.draw), markupLayer.draw() per addMarkupNode. Raster = full page at zoom (zoom^2 canvas). Options ranked: 1) two-stage render (low-res placeholder via updatePdfCanvas, hi-res swap) 2) LRU canvas cache keyed page+zoom 3) cap raster scale to viewport + re-render on pan-settle 4) batch draws (one stage.batchDraw per nav) 5) prefetch i±1 getPage at idle 6) reuse canvas element 7) OffscreenCanvas worker raster (big, only if freezes persist).
- **Plan authored for implementer agent:** .hermes/plans/2026-10-27_page-nav-perf.md — 5 phases (batched draws → two-stage render w/ navToken race guard → per-renderer LRU page cache (60MP budget) → neighbor getPage prefetch → measure/verify). Baseline + acceptance criteria + pitfalls (scale rounding for cache keys, await semantics in page-change, build-before-e2e) in the plan. Tier-2 viewport-capping and worker raster deliberately out of scope pending Phase 5 numbers.

## Page-nav perf implemented (2026-10-27) — plan 2026-10-27_page-nav-perf.md
- All 5 phases shipped: batched draws (addMarkupNodes + batchDraw), two-stage render (placeholder min(zoom,1) + hi-res swap via updatePdfCanvas, navToken race guard), per-renderer LRU page cache (60MP budget, scale.toFixed(3) keys, opt-in trackCacheHit seam), neighbor getPage prefetch at idle, scripts/measure-page-nav.mjs.
- Measured (59MB/14pg Fable PDF, WebKit, first-change→stable): warm 54–80→25–42ms first-change; cold navigations show pixels sooner (placeholder), full-raster unchanged. Median 71→345 became 40→319.
- Verified: tsc clean, vitest 58/58 (7 new page-cache unit), Playwright 43/43 WebKit prod build (3 new e2e: draws/race/cache). Details + review in .hermes/plans/2026-10-27_page-nav-perf-progress.md.

## Release 0.2.21 (2026-10-27) — page-nav perf shipped locally
- Tag v0.2.21 on eb4bc28 (perf b3a63a5 + version sync via scripts/sync-release-version.mjs).
- npx tauri build → RedlinePDF_0.2.21_amd64.deb built + installed system-wide (dpkg shows 0.2.21, binary smoke-starts). AppImage linuxdeploy failure pre-existing, ignored.

## Count-legend seed bug fixed (2026-10-27) — release 0.2.22
- **Bug:** dragging/opening a fresh PDF stamped a "Count Legend" box on the page. Root cause: loadPdfFile eagerly called addCountCategory() (Count tool self-seeds on first click, so the seed was redundant). Removed (commit d899f01).
- **Test fallout:** 5 specs (select-tool x3, select-drag, cross-page-multidraw) had been passing ONLY because the legend node sat at rect[0] — their draws ran with the select tool active (commits nothing). Fixed honestly: click box tool before drawing; node-count assertion no longer bakes in the legend. New regression spec e2e-count-no-seed.
- **Verified:** Playwright 44/44, vitest 58/58, tsc clean. Combine-drop and .redline restore paths never seeded (unaffected).
- **Release:** tag v0.2.22 on 07dd454; deb build + local reinstall in progress.

## Text-box handle scaling fix (2026-11-17)
- bakeTransform discarded transformer scale for text ("auto-size" era) -> handle drags snapped back. Now bakes scale into style.fontSize (dominant axis), side-handle drags set wrap width, bg box resizes. Commit 0d8ea47. Spec tests/text-scale.spec.ts (fontSize 12->55, persists across page nav).

## Cross-page copy/paste (2026-11-17)
- Ctrl+C/Ctrl+V + toolbar buttons; buffer = deep clones + referenced count categories. Paste lands on CURRENT page at identical PDF coords (no offset); categories carried by id; legend/count summary refreshed. clipboardCount state field drives paste-button enablement. Commit 24d6f5b. Spec tests/copy-paste-cross-page.spec.ts. Suite: 47 e2e + 63 unit green.

## Text-box re-edit (2026-11-17)
- Text was write-only after deselect. dblclick (select tool) -> text-markup-dblclick -> openEditorForMarkup prefilled at box position; 'markup-text-edit' commit updates in place (undoable), empty text deletes; setSelection(null)+id to re-attach transformer post-rebuild. Spec tests/text-reedit.spec.ts (prefill, in-place update count stays 1, empty=delete). 47 e2e + 63 unit green.

## Undo granularity fix (2026-11-17)
- 'markup-transform-start' handler in main.ts was dead code (never emitted): drags/resizes pushed no snapshot, so one Ctrl+Z reverted drag+previous action together. selectTool now emits it on dragstart + transformstart; snapshotMarkups dedupes identical consecutive snapshots (no dead steps from micro-drags). tests/undo-granularity.spec.ts (2 specs). 51 e2e + 63 unit green.

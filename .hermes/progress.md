
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

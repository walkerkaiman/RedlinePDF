
## Redline combine + page panel (2026-10-27) — committed b71894f

- **Done:** all phases 1-4 of .hermes/plans/2026-10-27_combine-and-reorder-pages.md. combine.ts core, project v2 migration, drop-append, page panel (reorder/rotate/delete/insert-at), structural undo, queueStructural serializer, renderer isDestroyed() guard.
- **Delete-test flakiness root cause:** NOT the app — test expectation arithmetic (delete(1) then delete(0) leaves original page 2, not page 0). App behavior verified correct step-by-step via [dbg] seam logs (since removed).
- **Verified:** tsc clean; vitest 51/51; Playwright 39/39 incl. e2e-combine 4/4, e2e-page-panel 5/5.
- **Bonus fix:** project-scale-restore.spec.ts pointed at a deleted Desktop .redline — created committed fixture tests/fixtures/scaled-project.redline (ESM: no __dirname, used process.cwd()).
- **Left:** user drag-drop confirmation on the desktop build; Windows/macOS installers.
- **Update 12:30:** built RedlinePDF_0.2.19_amd64.deb (4.6 MB, sent to user over WhatsApp). AppImage step fails (`failed to run linuxdeploy`) — pre-existing; deb+rpm bundle fine.

# Task Plan: Combine PDFs (drag-in) + page reorder (side panel)

## Goal

Two workbench features in RedlinePDF:
1. **Combine** — dropping a second PDF into the window appends its pages to the open document (or inserts at a chosen position via the page panel).
2. **Reorder** — a collapsible page-thumbnail side panel where pages are reordered by drag, with delete/rotate as freebies.

## Core invariant (the decision everything hangs on)

**`project.pages[i].index === i` and the combined PDF bytes always match that order.**

Instead of a page-identity indirection layer (which would touch renderer, export, autosave, and every `pages[activePageIndex]` lookup in main.ts), we keep the 1:1 positional invariant and **rebuild the combined PDF bytes** when structure changes:

- Merge = `pdf-lib` `PDFDocument.create()` + `copyPages` from both docs → new combined bytes → `loadPdfFile(combinedBytes, name)` re-seeds everything through the existing pipeline.
- Reorder = same rebuild with `copyPages` in the new order.
- Consequence: `pdfRenderer`, `exportPdf.ts`, autosave, `.redline` format all stay untouched. Markups live in the project model, not the PDF, so a bytes rebuild never touches annotations.

Cost: rebuild is O(pages) — fine for plan sets (<100 pages, sub-second with pdf-lib). Do it once per user gesture (drop / drag-release), never per keystroke.

## Data model changes (`src/model/document.ts`)

- `ProjectData.version: 1 → 2`.
- `PageData` gains:
  - `pageId: string` — stable id (`p_...` via `generateId()`), survives reorder; used by the panel for drag bookkeeping.
  - `sourceFile?: string` — which dropped file this page came from (tooltip + "Undo merge" label).
- Migration on load: if `version === 1`, assign `pageId`s, set `sourceFile = pdfFileName`. Autosave records are read fresh each time — no IndexedDB schema bump needed (shape is permissive JSON).
- `markup.pageIndex` stays positional; **any reorder/insert/delete renumbers `pages[].index` and remaps `markup.pageIndex` in one pass** (single helper, unit-tested).

## New module: `src/pdf/combine.ts`

Pure functions, no UI (unit-testable in vitest):
- `mergePdfBytes(a: Uint8Array, b: Uint8Array, insertAt: number | null): Promise<{ bytes: Uint8Array; addedPages: number }>` — pdf-lib copyPages; `insertAt=null` → append.
- `reorderPdfBytes(bytes: Uint8Array, order: number[]): Promise<Uint8Array>` — copyPages in given order.
- `rotatePdfBytes(bytes, pageIndex, deltaDeg)` — page `/Rotate` entry only (no rasterization).
- `remapPageIndices(project, oldOrder, newOrder)` — renumber `pages[].index` + every `markup.pageIndex`.
- Encrypted/invalid PDFs: pdf-lib throws → surface toast, no state change.

## Status (2026-10-27)

Phases 1-4 complete. tsc clean; vitest 51/51; Playwright 39/39 (incl. new
e2e-combine 4/4, e2e-page-panel 5/5). Phase 5 (version bump, README,
installers) pending; desktop .deb drag-drop confirmation pending.

## Phase plan

### Phase 1 — Model + combine core (no UI)
- [x] `document.ts`: `pageId`, `sourceFile`, version 2 + migration in `importProjectFile`/`loadAutosave`.
- [x] `src/pdf/combine.ts` + vitest unit tests (merge 2 fixture PDFs → page count, order; reorder round-trip; index remap correctness incl. markups; rotate).
- [x] `main.ts`: `combinePdfFile(file)` — read bytes → `mergePdfBytes(current, new, null)` → snapshot → replace `pdfBytes`, extend `project.pages` (fresh `PageData` per added page: default scale, empty markups, seeded count category per existing `loadPdfFile` pattern), renumber, `loadPdfFromProject`-style re-render, toast "Added N pages from X (Ctrl+Z to undo)".
- [x] Drop routing in `handleDroppedFile`: PDF + project already open → **combine** (today it replaces the document — this is the behavior change). `.redline` keeps replace semantics.

### Phase 2 — Page side panel UI
- [x] `index.html`: collapsible left rail (`#page-panel`), toggle button in toolbar + `F`-free key (use `[` or toolbar-only; avoid clashing with tool keys V/H/P/L/A/E/B/T/C/S/M).
- [x] `src/ui/pagePanel.ts`: vertical thumbnail strip. Thumbnails rendered via existing `pdfRenderer.loadPage(i, ~0.25)` to small canvases; lazy (IntersectionObserver), cached per pageId, invalidated on structural change.
- [x] Thumbnail chrome: page number badge; markup-count dot; scale-calibrated tick; source-file name in tooltip.
- [x] Click thumbnail → `appState.setPage(i)`; active page highlighted. Current page auto-scrolls into view on page change.

### Phase 3 — Drag interactions
- [x] **Reorder**: HTML5 `draggable` on thumbnails, insertion-line indicator between cards, drop → `order` array → `remapPageIndices` + `reorderPdfBytes` (debounced to drag-release) → re-render panel + current page. Works in both browser drop events and Tauri (panel drag is internal HTML5 DnD, not OS-level — unaffected by the WebView2 `tauri://drag-drop` interception).
- [x] **Insert-at-position**: OS-dropping a PDF file *onto the panel* between cards → `mergePdfBytes(..., insertAt)`. Distinguish from canvas drop (append) via dragover target. Tauri native drop gives `position` — hit-test panel bounds.
- [x] **Context menu** (right-click thumbnail): Rotate 90° CW / Delete page / (v2 later: extract page to new file). Delete = same rebuild path, guard "last page" case.
- [x] Merge/reorder/delete all go through `snapshotMarkups`-style project snapshot for undo (snapshot must include combined `pdfBytes` — store a reference copy in the undo stack entry, not a JSON.stringify of bytes).

### Phase 4 — Verification
- [x] Unit: combine.ts suite green (`npx vitest run`).
- [x] E2E (Playwright, shipped-bundle pattern from konva-markup-editor skill): extend `window.__REDLINE_DEBUG` with `totalPages`, `pageIds`, `sourceFiles`. Load fixture A, drop fixture B → assert count/order; simulate panel drag → assert `page-indicator` + debug seam order + markup followed its page (draw box on page 2, reorder, assert box still on the page that shows it).
- [ ] Desktop check: rebuild `.deb`, user confirms drag-drop combine works under WebView2/WebKitGTK (OS-level drop is engine-sensitive — same class as the WebKitGTK hit-graph lesson).
- [x] `npx tsc --noEmit` + full vitest + existing e2e spec green.

### Phase 5 — Ship
- [ ] Version bump 0.2.17, changelog in README features table (Combine / Page panel rows).
- [ ] Windows + macOS installers per existing release flow.

## UI/UX spec (summary)

- **Combine drop**: dropping a PDF anywhere on the canvas area appends. Toast: "Added 4 pages from site-survey.pdf — Undo". No modal, no confirmation (undo covers it). Dropping a PDF with 0 pages or an encrypted file → error toast, document untouched.
- **Panel**: 160px-wide left rail, dark theme matching current UI (no gray wash — user pref), thumbnails ~130px wide, gap 8px. Toggle persists in appState. Panel hidden by default on <900px viewport width (desktop-first feature; phone stays one-thing-at-a-time).
- **Reorder feel**: dragged card goes 60% opacity; 2px accent insertion line between cards; drop animates card to slot (150ms). Page numbers renumber instantly.
- **Active page**: accent border + number badge; auto-scroll keeps it visible.
- **Empty state**: panel shows only after a document loads.

## Risks / open questions

- Undo-stack memory: each structural snapshot holds a copy of combined bytes (~MBs). Cap structural undo depth at ~10 entries.
- pdf-lib `copyPages` drops form fields/annotations from source docs — acceptable: Redline's own markups are model-side, and plan PDFs rarely carry AcroForms. Note in README.
- Tauri native drop hit-testing against the panel needs the `position` from `tauri://drag-drop` (already available in the existing listener).
- Very large merges (>200 pages) may make the rebuild noticeable — show the existing `showWorking()` spinner during merge/rebuild.

## Key Questions
1. Does anything read `markup.pageIndex` besides render/export? → audit during Phase 1 (grep `pageIndex`); remap helper must cover all.
2. Is `loadPdfFile` re-entrant enough to reload combined bytes in place (renderer swap)? → it already fully re-seeds on open; reuse via a `reloadCombined()` that preserves current page position.

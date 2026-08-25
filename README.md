# RedlinePDF

A lightweight desktop PDF redlining tool built for construction plans.
Import a PDF plan, mark it up, measure it, and export a redlined version.

---

## Installation

Download the latest installer from the [**Releases page**](../../releases):

- **Windows:** Run `RedlinePDF_*_x64-setup.exe` and follow the installer wizard.
- **macOS:** Open `RedlinePDF_*_universal.dmg` and drag RedlinePDF to Applications.

---

## Features

### Drawing Tools
| Tool | Key | Description |
|------|-----|-------------|
| Select | V | Click to select; Shift+click to add/remove from selection; drag empty area for rubber-band multi-select |
| Pan | H | Click-drag to navigate the page |
| Freehand Pen | P | Smooth freehand annotation |
| Line | L | Straight line between two points |
| Arrow | A | Arrow pointing to a detail |
| Ellipse / Circle | E | Click center, drag to set radius; supports fill color and opacity |
| Box | B | Filled box with border color, fill color, width, and opacity |
| Text | T | Click to place an auto-sizing text box; double-click to edit |
| Count | C | Place symbol stamps and auto-populate a legend with totals |

### Measurement Tools
| Tool | Key | Description |
|------|-----|-------------|
| Set Scale | S | Click two points on a known dimension to calibrate the page scale |
| Linear | M | Click two points → shows distance with tick marks |
| Rect Area | Shift+R | Drag a rectangle → area + dimensions label |
| Polygon Area | Shift+P | Click vertices, double-click to close → area + perimeter |

Measurements require a calibrated scale (Set Scale first). Each page stores its own scale independently.

### Units (construction-standard, imperial default)
- **Linear:** Feet-Inches `12'-6 1/2"`, Feet, Inches, Yards, Meters, cm, mm
- **Area:** sq ft, sq yd, acres, sq m, sq cm, sq mm

### Count Tool
Place symbols on the drawing to count items (doors, fixtures, outlets, etc.):
- Add and name categories in the properties panel; pick a symbol shape and color per category
- Click the drawing to stamp a symbol; the legend auto-updates with running totals
- The legend is a moveable, scaleable element that renders on the exported PDF
- Delete individual stamps with the Select tool; the legend count updates automatically

### Properties Panel
Context-sensitive panel on the right updates based on the selected tool or selected markup:
- **Stroke / Border:** color, width, opacity
- **Fill:** color and opacity (Box, Ellipse)
- **Text:** font family, size, bold, italic, text color, background color and opacity
- **All numeric sliders:** double-click the value to type a number directly; Enter or click away to apply
- **Multi-select:** selecting multiple elements shows the union of applicable properties; changes propagate only to elements that support the changed property

### Multi-Select
- Click to select a single element; Shift+click to add or remove from selection
- Drag on empty canvas for rubber-band selection; Shift+drag to add to existing selection
- Arrow keys nudge selected elements 1 pt; Shift+Arrow nudges 10 pt
- Delete, move, resize, and style-edit all work on the full selection

### Navigation
- **Left / Right arrow keys** (nothing selected) → previous / next page
- **Scroll wheel** → zoom in/out centered on cursor
- **F** → fit the current page to the viewport

### Project Files
`.redline` files are fully self-contained — the original PDF is embedded alongside all markups. Send a single `.redline` file to a colleague and they can open and continue editing the project with no separate PDF needed.

### Undo / Redo
Full undo history for all operations including adding, deleting, moving, resizing, and nudging markups.

### Recent Files
Hover over **Open PDF** or **Open Project** to see the 10 most recently opened files. Click any entry to reload it instantly — no file picker needed.

### Snapshot
Capture the current view as a PNG and save it directly to the Desktop:
- If zoomed in, only the visible portion of the PDF is captured — no gray canvas backdrop
- If zoomed out, the image is cropped to the document bounds (gray margins excluded)
- Filenames are derived from the PDF name with an auto-incrementing number (`drawing_1.png`, `drawing_2.png`, …) so files never overwrite each other
- In browser/dev mode, the PNG is downloaded instead

### Export
- **Save Project** (Ctrl+S) → `.redline` file; subsequent saves overwrite silently (desktop). Use **Save As** to save to a new location.
- **Export PDF** (Ctrl+E) → rasterized redlined PDF at selectable resolution (96 / 150 / 300 DPI) with optional page range (all pages, current page, or a custom range like `1, 3-5`)
- **Snapshot** (Ctrl+Shift+S) → PNG of the current viewport saved to the Desktop

---

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Open Project | Ctrl+O |
| Save Project | Ctrl+S |
| Snapshot to Desktop | Ctrl+Shift+S |
| Export PDF | Ctrl+E |
| Undo | Ctrl+Z |
| Redo | Ctrl+Y / Ctrl+Shift+Z |
| Delete selected | Delete / Backspace |
| Zoom In | + |
| Zoom Out | - |
| Fit Page | F |
| Next Page | → (nothing selected) |
| Previous Page | ← (nothing selected) |
| Nudge | Arrow keys (element selected) |
| Nudge large | Shift+Arrow |
| Select tool | V |
| Pan tool | H |
| Pen | P |
| Line | L |
| Arrow | A |
| Ellipse | E |
| Box | B |
| Text | T |
| Count | C |
| Set Scale | S |
| Linear measure | M |
| Rect Area | Shift+R |
| Poly Area | Shift+P |

---

## Architecture Notes

### Coordinate System
All markup is stored in **PDF user-space coordinates** (1 point = 1/72 inch, bottom-left origin).
This makes markup zoom-independent and maps correctly to pdf-lib export coordinates.

- Konva rendering: Y-flip applied (Konva uses top-left origin)
- Export: PDF page rendered via pdfjs → composited with Konva markup canvas → embedded in new PDF via pdf-lib
- Scale calibration: stored as `pointsPerRealInch` — how many PDF points equal 1 real-world inch on the drawing

### State Management
`AppState` is a reactive singleton with an event bus. Components subscribe to state changes or listen for named events (`selection-change`, `style-change`, `markup-transform`, etc.). The properties panel re-renders only when the selection or active tool changes structurally, not on every style slider tick, to prevent mid-drag DOM rebuilds.

### Undo History
Per-page markup snapshots (`JSON.stringify`) pushed onto an undo stack before each mutating operation. Undo/redo clears the Konva Transformer selection before rebuilding the markup layer to prevent stale node references.

---

## Developer Guide (for contributors & coding agents)

This section explains *intended behavior* and the non-obvious design rules so a maintainer can diagnose a misbehaving tool without reading every file.

### 1. Tools are `ToolProtocol` objects, dispatched by `ToolRunner`

Every tool is a plain object (`src/tools/<name>Tool.ts`) conforming to `ToolProtocol`
(`src/tools/toolProtocol.ts`). `ToolRunner` (`src/tools/toolRunner.ts`) binds **one**
set of stage listeners and dispatches to the active protocol. To make a tool available
it MUST be (a) imported and (b) registered in the `toolProtocols` map in `main.ts`
(~line 55). A tool that is missing from that map is silently inert — this is the #1
cause of a "tool does nothing" bug.

**Dispatch rule (in `ToolRunner.handleMouseDown`):**
- If the protocol has a `draw` phase → `mousedown` starts a drag:
  `startDraw(pos)` → (on `mousemove`) `midDraw(pos)` → (on `mouseup`) `endDraw()` →
  the returned `Markup` is committed via `appState.mutate('ADD_MARKUP', …)`.
- Else if it has `onClick` → `mousedown` calls `onClick(pos)` **immediately** (no drag).
- Having BOTH is allowed (drag wins); having NEITHER means the tool does nothing on canvas.

**CRITICAL — click-only tools must NOT have a `draw` phase.** `endDraw()` is only called
on mouseup, so a no-op `draw` phase swallows the click and the tool appears unresponsive
(the classic "text tool doesn't respond" symptom). `text`, `count`, `scale-set`, and
`measure-poly` are intentionally `onClick`-only. See also `onDblClick` / `onKey` (used by
polygon tools to close on Enter/Escape) and `deactivate()` (always clean up preview nodes).

### 2. ToolProtocol objects are stateless — carry state in module scope

Because they're singletons, you cannot store per-drag state on the object. Drag/click
state (e.g. `startPos`, `vertices[]`, `phase`) lives in **module-level `let` variables**
at the top of the tool file. Always reset it in `clearPreview()` / `deactivate()` so a
half-finished gesture doesn't leak into the next use.

### 3. Coordinates: Konva is screen/Y-down, the model is PDF/Y-up

All markups are stored in **PDF user space** (1 pt = 1/72", bottom-left origin). Konva
uses top-left origin. Every tool MUST convert the Konva pointer position to PDF space with
`konvaToPdf(kx, ky, pageHeightPts)` before committing via `ADD_MARKUP`, otherwise the
markup renders flipped/misplaced. `toolRunner.getPageHeightPts()` and
`toolRunner.getStageManager().markupLayer.getRelativePointerPosition()` supply the inputs.
(Note: `endDraw()` receives no event args by design — read positions from your module
closure / `toolRunner.getCurrentShape()` instead of `getRelativePointerPosition()` at
mouseup, which can be null.)

### 4. The Measurement Calibration Gate (easy to trip over)

Measuring requires a calibrated page scale. The gate lives in `main.ts` `setupStateListeners`
(~line 1326): **selecting a measure tool on a page that is not yet calibrated auto-redirects
to Set Scale** and stashes the intended tool in `pendingMeasureTool`. After the user picks two
points and confirms the calibration modal, the `scale-set` handler (~line 1374) mirrors the
scale into `appState.state.scale` and then auto-switches back to the original measure tool.
So a measure tool "doing nothing" is often just the calibration redirect — set the scale first
(Set Scale shortcuts: click two points → enter the real distance → Apply). Each page stores
its own independent scale.

### 5. Sliders: label updates live, commit on release

In `properties.ts` `createSliderRow` the value is split into two handlers on purpose:
- `input` → `applyLabel()` — cheap, synchronous label/thumb update only (runs every drag frame).
- `change` → `applyValue()` — the real commit: calls `onChange()` which re-renders the panel
  and pushes an undo snapshot.

Do NOT merge these. Committing on every `input` frame (the old bug) makes dragging stutter
because each frame triggers a full re-render + undo snapshot. Keep label work on `input`,
commit work on `change` (mouseup / keyboard). Double-clicking a value lets you type a number
and calls `applyValue()` on commit.

### 6. The `__REDLINE_DEBUG` seam (for tests & diagnosis)

`main.ts` exposes a read-only `window.__REDLINE_DEBUG` object so specs (and you) can assert
app behavior without pixel inspection: `activeTool`, `markups` (count; `<0` = loading
sentinel), `markupTypes`, `pageIndex`, `selectedIds`, `selectedMarkup`, `renderedNodeIds`,
`activeCountCategoryId`, `countSymbolSize`. Use these to confirm a tool actually committed a
markup rather than guessing from the canvas.

### 7. Diagnosing a "broken" tool — checklist

1. Is it registered in `toolProtocols` (main.ts ~55)? Missing → inert.
2. `draw` or `onClick`? Click-only tools must have NO `draw` phase.
3. Is the Konva pointer position converted with `konvaToPdf(...)` before `ADD_MARKUP`?
4. Is a measure tool being used on an uncalibrated page? → it redirects to Set Scale by design.
5. Does `endDraw()` / `onClick` return a `Markup` with a `type`, `pageIndex`, and generated `id`?
   `ToolRunner` only commits when the returned markup has an `id`.
6. Did you reset module state in `clearPreview()`/`deactivate()`? A leftover preview shape or
   stale `vertices[]` will ghost or block the next gesture.

---

## Tech Stack
- **Vite + TypeScript** — no framework, 100% client-side
- **pdfjs-dist 4.x** — PDF rendering
- **Konva.js** — vector markup canvas with Transformer for selection/resize
- **pdf-lib** — PDF export (composite render: PDF background + Konva overlay)
- **idb** — IndexedDB autosave and recent-file cache
- **Tauri 2.x** — native desktop packaging with native file dialogs

---

## File Structure

```
src/
  main.ts                App bootstrap and orchestration
  style.css              Dark-themed professional UI
  model/document.ts      Data types and markup model
  state/appState.ts      Reactive state + event bus
  geometry/transform.ts  Coordinate conversion helpers
  measure/
    units.ts             Formatting: feet-inches, metric, area
    scale.ts             Scale calibration math
  pdf/renderer.ts        pdfjs-dist integration
  canvas/stage.ts        Konva stage manager + shape factory
  tools/                 One file per tool (select, pen, line, arrow,
                         ellipse, box, text, count, measureLinear,
                         measureRect, measurePoly, scaleSet, pan)
  ui/
    toolbar.ts           Toolbar init + state sync
    properties.ts        Context-sensitive right panel (single + multi-select)
    colorPicker.ts       Color swatch + native input
    modal.ts             Promise-based dialog + export quality/page picker
    working.ts           Full-screen loading overlay
  export/exportPdf.ts    Composite PDF export (pdfjs + Konva overlay)
  storage/
    projectStore.ts      IndexedDB autosave, recent-file cache, .redline I/O
    recentFiles.ts       Recent files list (localStorage)
  tauri/integration.ts   Native file dialogs and path-based file I/O (Tauri only)
src-tauri/               Tauri Rust shell + icon assets for desktop packaging
public/
  favicon.svg            App icon source (blue background, white document icon)
  app-icon.svg           Square icon used by `tauri icon` to generate all sizes
```

# RedlinePDF — Construction Markup Tool

A lightweight, fully client-side browser PDF redlining tool built for construction.
Import a PDF drawing, mark it up, measure it, and export a redlined PDF — or package it as a native Windows desktop app with Tauri.

---

## Features

### Drawing Tools
| Tool | Key | Description |
|------|-----|-------------|
| Select | V | Click to select; drag an empty area to rubber-band select multiple elements |
| Pan | H | Click-drag to navigate the page |
| Freehand Pen | P | Smooth freehand annotation |
| Line | L | Straight line between two points |
| Arrow | A | Arrow pointing to a detail |
| Rectangle | R | Outline rectangle (border color, width, opacity) |
| Ellipse / Circle | E | Click center, drag to set radius |
| Box | B | Filled box with separate border and fill properties |
| Text | T | Drag to size a text box; edit font, size, color, background |

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

### Properties Panel
Context-sensitive panel on the right updates based on the selected tool or selected markup:
- **Stroke / Border:** color, width, opacity (pen, line, arrow, rectangle, ellipse, box, measurements)
- **Fill:** color and opacity (Box tool)
- **Text:** font family, size, bold, italic, text color, background color and opacity
- **Multi-select:** selecting multiple elements shows the union of applicable properties; changes propagate only to elements that support the changed property (e.g. fill changes only affect boxes)

### Multi-Select
- Click to select a single element
- Drag on empty canvas for rubber-band selection
- Transformer handles wrap all selected elements
- Delete, move, resize, and style-edit all work on the full selection

### Undo / Redo
Full undo history for all operations:
- Adding and deleting markups
- Moving and resizing (drag/transform)
- Multi-delete

### Project Persistence
- **Autosave** to IndexedDB every 2 seconds
- **Save Project** → `.redline` file (JSON + embedded PDF) — fully reopenable and editable
- **Export PDF** → rasterized redlined PDF at selectable resolution (96 / 150 / 300 DPI)
  - Native "Save As" dialog in supported browsers and Tauri
  - Resolution picker before export

---

## Tech Stack
- **Vite + TypeScript** — no framework, 100% client-side
- **pdfjs-dist 4.x** — PDF rendering
- **Konva.js** — vector markup canvas with Transformer for selection/resize
- **pdf-lib** — PDF export (composite render: PDF background + Konva overlay)
- **idb** — IndexedDB autosave
- **Tauri 2.x** (optional) — native desktop packaging with native file dialogs

---

## Running in the Browser

```bash
npm install
npm run dev
# Open http://localhost:5173
```

## Production Build

```bash
npm run build
# Output in dist/
```

The `dist/` folder is a self-contained static site — host it anywhere (Netlify, Vercel, GitHub Pages, or a local HTTP server).

---

## Desktop App (.exe) via Tauri

### Prerequisites
1. Install [Rust](https://rustup.rs/) (includes `cargo`)
2. Install [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (pre-installed on Windows 10/11)
3. `npm install`

### Development
```bash
npm run tauri:dev
```

### Build Installer (.exe for Windows)
```bash
npm run tauri:build
# Installer: src-tauri/target/release/bundle/nsis/RedlinePDF_0.1.0_x64-setup.exe
# Portable:  src-tauri/target/release/bundle/nsis/RedlinePDF_0.1.0_x64.exe
```

The desktop build uses the OS's native WebView2, so the installer is **~5–10 MB** (no bundled Chromium).

### File Type Association
The Tauri installer registers `.redline` project files with the application. Double-clicking a `.redline` file in Windows Explorer will open it directly in RedlinePDF.

### App Icon
The application icon and browser favicon are sourced from `public/favicon.svg`. All required platform icon sizes (ICO, ICNS, PNG at multiple resolutions, Windows APPX tiles, iOS, Android) are generated automatically via `npx tauri icon src-tauri/app-icon.svg`.

---

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Open PDF | Ctrl+O |
| Save Project | Ctrl+S |
| Export PDF | Ctrl+E |
| Undo | Ctrl+Z |
| Redo | Ctrl+Y / Ctrl+Shift+Z |
| Delete selected | Delete |
| Zoom In | + |
| Zoom Out | - |
| Fit Width | F |
| Select tool | V |
| Pan tool | H |
| Pen | P |
| Line | L |
| Arrow | A |
| Rectangle | R |
| Ellipse | E |
| Box | B |
| Text | T |
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
  tools/                 One file per tool (select, pen, line, arrow, rect,
                         ellipse, box, text, measureLinear, measureRect,
                         measurePoly, scaleSet, pan)
  ui/
    toolbar.ts           Toolbar init + state sync
    properties.ts        Context-sensitive right panel (single + multi-select)
    colorPicker.ts       Color swatch + native input
    modal.ts             Promise-based dialog + export quality picker
  export/exportPdf.ts    Composite PDF export (pdfjs + Konva overlay)
  storage/projectStore.ts IndexedDB autosave + .redline file I/O
  tauri/integration.ts   Native file dialogs (Tauri only)
src-tauri/               Tauri Rust shell + icon assets for desktop packaging
public/
  favicon.svg            App icon source (blue background, white document icon)
  app-icon.svg           Square icon used by `tauri icon` to generate all sizes
```

# RedlinePDF — Construction Markup Tool

A lightweight, fully client-side browser PDF redlining tool built for construction.
Import a PDF drawing, mark it up, measure it, and export a redlined PDF.

---

## Features

### Drawing Tools
| Tool | Key | Description |
|------|-----|-------------|
| Select | V | Select, move, resize markup |
| Pan | H | Click-drag to navigate the page |
| Freehand Pen | P | Smooth freehand annotation |
| Line | L | Straight line |
| Arrow | A | Arrow pointing to a detail |
| Rectangle | R | Stroke-only rectangle |
| Ellipse | E | Stroke-only ellipse |
| Box | B | Filled box (border + fill color + opacity) |
| Text | T | Drag to set text box, type text |

### Measurement Tools
| Tool | Key | Description |
|------|-----|-------------|
| Set Scale | S | Calibrate scale by clicking two known points |
| Linear | M | Click two points → distance label |
| Rect Area | Shift+R | Drag → width × height + area label |
| Polygon Area | Shift+P | Click vertices → area + perimeter (shoelace) |

### Units (construction-standard, imperial default)
- Linear: Feet-Inches `12'-6 1/2"`, Feet, Inches, Yards, Meters, cm, mm
- Area: sq ft, sq yd, acres, sq m, sq cm, sq mm

### Properties Panel (right side)
- Stroke color (preset redline colors + custom)
- Stroke width and opacity
- Fill color and opacity (Box tool)
- Font family, size, bold, italic, text color, background (Text tool)

### Project Persistence
- **Autosave** to IndexedDB every 2 seconds
- **Save Project** → `.redline` file (JSON + embedded PDF) — reopenable and fully editable
- **Export PDF** → flattened redlined PDF using pdf-lib (vector overlay)

---

## Tech Stack
- **Vite + TypeScript** — no framework, 100% client-side
- **pdfjs-dist** — PDF rendering
- **Konva.js** — vector markup canvas
- **pdf-lib** — PDF export with vector overlay
- **idb** — IndexedDB autosave
- **Tauri** (optional) — native desktop `.exe` packaging

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

The desktop build uses the OS's native WebView2, so the installer is **~5-10 MB** (no bundled Chromium).

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

## Coordinate System

All markup is stored in **PDF user-space coordinates** (1 point = 1/72 inch, bottom-left origin).
This makes markup zoom-independent and maps directly to pdf-lib export coordinates.

- Konva rendering: Y-flip applied (Konva uses top-left origin)
- pdf-lib export: uses stored PDF coords directly (no Y-flip needed)
- Scale calibration: stored as `pointsPerRealInch` — how many PDF points = 1 real inch on the drawing

---

## File Structure

```
src/
  main.ts              App bootstrap and orchestration
  style.css            Dark-themed professional UI
  model/document.ts    Data types and markup model
  state/appState.ts    Reactive state + event bus
  geometry/transform.ts Coordinate conversion helpers
  measure/
    units.ts           Formatting: feet-inches, metric, area
    scale.ts           Scale calibration math
  pdf/renderer.ts      pdfjs-dist integration
  canvas/stage.ts      Konva stage manager + shape factory
  tools/               One file per tool
  ui/
    toolbar.ts         Toolbar init + state sync
    properties.ts      Context-sensitive right panel
    colorPicker.ts     Color swatch + native input
    modal.ts           Promise-based dialog
  export/exportPdf.ts  pdf-lib vector overlay export
  storage/projectStore.ts IndexedDB + .redline file
  tauri/integration.ts Native file dialogs (Tauri only)
src-tauri/             Tauri Rust shell for desktop packaging
```

# Export PDF Fix: Markups Missing in Rendered Output

## Symptoms

Exporting a PDF via **Ctrl+E** produces a valid PDF with the original page content, but all markups (pen, box, text, measurements, images, etc.) are missing from the output. The console logs `[EXPORT] canvas pixel sample: 0/2500 have alpha` — confirming the markup overlay rendered completely transparent.

## Root Cause

Two independent bugs were found in `src/export/exportPdf.ts`:

### Bug 1: `stage.toCanvas()` produces a blank canvas

The original code used `stage.toCanvas({ pixelRatio })` to capture the Konva stage's markup layer. This method works by:

1. Creating a brand-new `<canvas>` element at the target resolution
2. Calling `this.drawScene(canvas, ...)` on the Stage to re-render the scene graph onto the new canvas
3. Returning the new canvas

The `drawScene()` → `_drawChildren()` → `Layer.drawScene()` chain was producing a blank canvas for reasons that could not be definitively isolated — potentially a `getAbsoluteTransform()` edge case, a `clearBeforeDraw()` interaction with the shared canvas, or a GPU compositor quirk with the off-screen container.

**Diagnosis clue**: `[EXPORT] layer child count: N` showed the correct number of nodes, but the next line `[EXPORT] canvas pixel sample: 0/2500 have alpha` confirmed nothing rendered.

**Fix**: Instead of `toCanvas()`, read the **layer's own internal canvas** directly via `layer.getCanvas()._canvas`. This canvas was already populated by `layer.draw()`, which uses the standard (working) rendering path. If the layer canvas is at a different resolution than the target export dimensions, it's scaled up via `ctx.drawImage()`.

### Bug 2: Image markup `Image` objects load asynchronously, independent of Konva

The `createMarkupNode()` function for image markups creates a `new window.Image()` and assigns it to the `Konva.Image` node via an `img.onload` callback. Separately, the export code was loading its own separate `Image` objects and waiting for those to resolve. These two Image objects are **independent** — waiting for one does not guarantee the other has loaded.

Since `toCanvas()` (now `layer.getCanvas()._canvas`) renders whatever is on the Konva node at capture time, the image was blank because the Konva node's `image` property was still `undefined`.

**Diagnosis clue**: Layer child count = 2 (hitbox rect + `Konva.Image`) but `image` property was `null`/`undefined`.

**Fix**: Bypass Konva entirely for image markups. Render them **directly** onto the composite canvas using native Canvas API:
```
fetch(dataUrl) → blob() → createImageBitmap(blob) → ctx.drawImage(bitmap, ...)
```
`createImageBitmap` is a native Promise-based API that guarantees the bitmap is fully decoded when it resolves. The coordinates are converted from PDF space (bottom-left origin) to canvas space (top-left origin).

## The Complete Fix (`src/export/exportPdf.ts`)

### Changes made:

| File | Change |
|------|--------|
| `src/export/exportPdf.ts` | Added `ImageMarkup` import |
| `src/export/exportPdf.ts` | Split markups into `nonImageMarkups` (→ Konva) and `imageMarkups` (→ direct Canvas API) |
| `src/export/exportPdf.ts` | Replaced `stage.toCanvas()` with `layer.getCanvas()._canvas` |
| `src/export/exportPdf.ts` | Removed unused `pixelRatio` variable and image-loading Promise chain |
| `src/export/exportPdf.ts` | Added try/catch for image markup rendering with per-image logging |

### Key code path — non-image markups:

```typescript
const layerCanvas = layer.getCanvas()._canvas as HTMLCanvasElement;
let rawCanvas: HTMLCanvasElement;
if (layerCanvas.width === targetW && layerCanvas.height === targetH) {
  rawCanvas = layerCanvas;
} else {
  rawCanvas = document.createElement('canvas');
  rawCanvas.width = targetW;
  rawCanvas.height = targetH;
  rawCanvas.getContext('2d')!.drawImage(layerCanvas, 0, 0, targetW, targetH);
}
```

### Key code path — image markups:

```typescript
const resp = await fetch(im.dataUrl);
const blob = await resp.blob();
const bitmap = await createImageBitmap(blob);
const dstX = im.x * pxRatio;
const dstY = (heightPts - im.y - im.height) * pxRatio;
const dstW = im.width * pxRatio;
const dstH = im.height * pxRatio;
ctx.drawImage(bitmap, dstX, dstY, dstW, dstH);
```

## Verification

After applying the fix, the export console should show:

```
[EXPORT] layer canvas: 2700x1800     ← layer's own canvas dimensions
[EXPORT] canvas pixel sample: 1234/2500 have alpha  ← non-zero!
[EXPORT] drew image markup m_xxx at 1446,1101 614x454  ← image rendered directly
```

And the exported PDF should contain all markups at the correct positions.

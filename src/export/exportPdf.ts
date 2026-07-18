import Konva from 'konva';
import { PDFDocument } from 'pdf-lib';
import type { Markup, ProjectData, ImageMarkup } from '../model/document.ts';
import type { PdfRenderer } from '../pdf/renderer.ts';
import { createMarkupNode } from '../canvas/stage.ts';

/**
 * Export a redlined PDF.
 *
 * Strategy: for each page, use pdfjs to render the original page content at
 * exportScale (pdfjs handles rotation, crop-box, and every other PDF quirk
 * correctly). Then render the Konva markup layer at the exact same scale and
 * dimensions. Composite them, embed the result as a new page in a fresh PDF.
 *
 * This guarantees the markup is pixel-perfectly aligned with the content,
 * regardless of page rotation (the most common cause of "90° off" exports).
 *
 * @param exportScale PDF-point scale factor (= desiredDPI / 72). Default 2 ≈ 144 DPI.
 */
export async function exportRedlinedPdf(
  project: ProjectData,
  _originalPdfBytes: Uint8Array,
  pdfRenderer: PdfRenderer,
  exportScale = 2,
  pageIndices: number[] | null = null,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();

  const pagesToExport = pageIndices
    ? project.pages.filter(p => pageIndices.includes(p.index))
    : project.pages;

  for (const pageData of pagesToExport) {
    // pdfjs dimensions are rotation-aware (e.g. a Rotate:90 portrait page
    // is reported as landscape widthPts > heightPts here).
    const { widthPts, heightPts } = await pdfRenderer.getPageSizePts(pageData.index);

    console.log(`[EXPORT] Page ${pageData.index}: ${pageData.markups.length} markups`);
    // Render original page via pdfjs at the export scale.
    const pageInfo = await pdfRenderer.loadPage(pageData.index, exportScale);
    const canvasW = pageInfo.canvas.width;
    const canvasH = pageInfo.canvas.height;

    // Composite canvas: page background + markup overlay.
    const composite = document.createElement('canvas');
    composite.width = canvasW;
    composite.height = canvasH;
    const ctx = composite.getContext('2d')!;

    // 1. Draw the original PDF page content (correctly oriented by pdfjs).
    ctx.drawImage(pageInfo.canvas, 0, 0);

    // 2. Overlay markups (if any) rendered at the same scale.
    const nonImageMarkups = pageData.markups.filter(m => m.type !== 'image');
    if (nonImageMarkups.length > 0) {
      const markupCanvas = await renderMarkupCanvas(
        nonImageMarkups,
        widthPts,
        heightPts,
        canvasW,
        canvasH,
      );
      ctx.drawImage(markupCanvas, 0, 0);
    }

    // 2b. Render image markups directly onto the composite canvas using native
    //     Canvas API — Konva's Image node has proven unreliable in toCanvas().
    const imageMarkups = pageData.markups.filter(m => m.type === 'image') as ImageMarkup[];
    const pxRatio = canvasW / widthPts;
    for (const im of imageMarkups) {
      if (!im.dataUrl?.startsWith('data:')) continue;
      try {
        const resp = await fetch(im.dataUrl);
        const blob = await resp.blob();
        const bitmap = await createImageBitmap(blob);
        // PDF coords use bottom-left origin; canvas uses top-left.
        const dstX = im.x * pxRatio;
        const dstY = (heightPts - im.y - im.height) * pxRatio;
        const dstW = im.width * pxRatio;
        const dstH = im.height * pxRatio;
        ctx.drawImage(bitmap, dstX, dstY, dstW, dstH);
        console.log(`[EXPORT] drew image markup ${im.id} at ${dstX.toFixed(0)},${dstY.toFixed(0)} ${dstW.toFixed(0)}x${dstH.toFixed(0)}`);
      } catch (err) {
        console.warn(`[EXPORT] failed to render image markup ${im.id}:`, err);
      }
    }

    // 3. Embed the composite as a new PDF page at the pdfjs-reported dimensions.
    //    The new page has no rotation entry, so (0,0)→(widthPts,heightPts) is correct.
    const pngBytes = await canvasToPngBytes(composite);
    const newPage = pdfDoc.addPage([widthPts, heightPts]);
    const img = await pdfDoc.embedPng(pngBytes);
    newPage.drawImage(img, { x: 0, y: 0, width: widthPts, height: heightPts });
  }

  return pdfDoc.save();
}

/**
 * Render all markups for one page into an off-screen Konva stage and return
 * the canvas.  The canvas is scaled to exactly (targetW × targetH) pixels to
 * match the pdfjs-rendered page canvas.
 */
async function renderMarkupCanvas(
  markups: Markup[],
  widthPts: number,
  heightPts: number,
  targetW: number,
  targetH: number,
): Promise<HTMLCanvasElement> {
  console.log(`[EXPORT] renderMarkupCanvas: ${markups.length} markups, pts=${widthPts}x${heightPts}, pixels=${targetW}x${targetH}`);

  // Dump markup details for debugging coord issues
  for (const m of markups) {
    console.log(`[EXPORT]   markup ${m.type} id=${m.id}:`, JSON.stringify(m as unknown));
  }

  const container = document.createElement('div');
  // Give the off-screen div real dimensions — Konva won't render into a collapsed/1px container.
  // Position just above viewport so GPU compositor doesn't clip the tile.
  container.style.cssText = [
    `position:fixed;top:${-targetH - 10}px;left:0;`,
    `width:${targetW}px;height:${targetH}px;`,
    'overflow:hidden;pointer-events:none;',
  ].join('');
  document.body.appendChild(container);

  // Verify container actually got the dimensions we asked for.
  const rect = container.getBoundingClientRect();
  console.log('[EXPORT] container rect:', { top: rect.top, width: rect.width, height: rect.height });

  // Stage size matches the PDF page in points.
  const stage = new Konva.Stage({ container, width: widthPts, height: heightPts });
  const layer = new Konva.Layer();
  stage.add(layer);

  // createMarkupNode converts PDF coords → Konva coords (Y-flip) internally.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const markup of markups) {
    const node = createMarkupNode(markup, heightPts);
    layer.add(node as any);
  }

  layer.draw();

  // Verify layer actually has children before capturing.
  console.log('[EXPORT] layer child count:', layer.getChildren().length);

  // Instead of using stage.toCanvas() (which has proven unreliable with
  // drawScene), read the layer's own internal canvas which was just rendered
  // by layer.draw(). Scale it up to match the target pixel dimensions.
  const layerCanvas = layer.getCanvas()._canvas as HTMLCanvasElement;
  console.log(`[EXPORT] layer canvas: ${layerCanvas.width}x${layerCanvas.height}`);

  let rawCanvas: HTMLCanvasElement;
  if (layerCanvas.width === targetW && layerCanvas.height === targetH) {
    rawCanvas = layerCanvas;
  } else {
    rawCanvas = document.createElement('canvas');
    rawCanvas.width = targetW;
    rawCanvas.height = targetH;
    rawCanvas.getContext('2d')!.drawImage(layerCanvas, 0, 0, targetW, targetH);
  }
  console.log(`[EXPORT] rawCanvas: ${rawCanvas.width}x${rawCanvas.height}`);

  // Spot-check a few regions for non-transparent content (avoid full scan on large canvases).
  const checkCtx = rawCanvas.getContext('2d');
  if (checkCtx) {
    const stepX = Math.max(1, Math.floor(rawCanvas.width / 50));
    const stepY = Math.max(1, Math.floor(rawCanvas.height / 50));
    let checked = 0;
    let nonTransparent = 0;
    for (let y = 0; y < rawCanvas.height; y += stepY) {
      for (let x = 0; x < rawCanvas.width; x += stepX) {
        const a = checkCtx.getImageData(x, y, 1, 1).data[3];
        if (a > 0) nonTransparent++;
        checked++;
      }
    }
    console.log(`[EXPORT] canvas pixel sample: ${nonTransparent}/${checked} have alpha`);
  }

  stage.destroy();
  document.body.removeChild(container);

  // If the sizes already match, return the raw canvas directly.
  if (rawCanvas.width === targetW && rawCanvas.height === targetH) {
    return rawCanvas;
  }

  // Otherwise stretch to match exactly (handles sub-pixel rounding differences).
  const out = document.createElement('canvas');
  out.width = targetW;
  out.height = targetH;
  out.getContext('2d')!.drawImage(rawCanvas, 0, 0, targetW, targetH);
  return out;
}

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Canvas.toBlob failed — canvas may be too large or tainted'));
          return;
        }
        blob
          .arrayBuffer()
          .then((buf) => resolve(new Uint8Array(buf)))
          .catch(reject);
      },
      'image/png',
    );
  });
}

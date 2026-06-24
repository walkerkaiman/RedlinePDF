import Konva from 'konva';
import { PDFDocument } from 'pdf-lib';
import type { Markup, ProjectData } from '../model/document.ts';
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
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();

  for (const pageData of project.pages) {
    // pdfjs dimensions are rotation-aware (e.g. a Rotate:90 portrait page
    // is reported as landscape widthPts > heightPts here).
    const { widthPts, heightPts } = await pdfRenderer.getPageSizePts(pageData.index);

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
    if (pageData.markups.length > 0) {
      const markupCanvas = await renderMarkupCanvas(
        pageData.markups,
        widthPts,
        heightPts,
        canvasW,
        canvasH,
      );
      ctx.drawImage(markupCanvas, 0, 0);
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
  const container = document.createElement('div');
  container.style.cssText =
    'position:fixed;top:-99999px;left:-99999px;width:1px;height:1px;overflow:hidden;pointer-events:none;';
  document.body.appendChild(container);

  // Stage size matches the PDF page in points; pixelRatio scales up to pixels.
  const pixelRatio = targetW / widthPts;
  const stage = new Konva.Stage({ container, width: widthPts, height: heightPts });
  const layer = new Konva.Layer();
  stage.add(layer);

  for (const markup of markups) {
    // createMarkupNode converts PDF coords → Konva coords (Y-flip) internally.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    layer.add(createMarkupNode(markup, heightPts) as any);
  }
  layer.draw();

  // toCanvas({ pixelRatio }) renders at widthPts*pixelRatio × heightPts*pixelRatio.
  // We draw the result stretched to (targetW × targetH) in case of rounding diffs.
  const rawCanvas = stage.toCanvas({ pixelRatio });

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

import Konva from 'konva';
import { toolRunner } from './toolRunner.ts';
import type { ToolProtocol } from './toolProtocol.ts';
import { generateId, EllipseMarkup } from '../model/document.ts';
import { konvaToPdf } from '../geometry/transform.ts';

// Module-level drag state — mirrors the boxTool pattern (draw phase receives no
// extra args per signature, so current pointer position must be carried in closure).
let startPos: { x: number; y: number } | null = null;
let currentRadius = 0;

const ellipseDraw = {
  startDraw(e: { x: number; y: number }) {
    const style = toolRunner.getActiveStyle() || {};

    // Center is the drag origin; radius grows toward the cursor during midDraw.
    startPos = { x: e.x, y: e.y };
    currentRadius = 0;

    return new Konva.Ellipse({
      x: e.x, y: e.y,
      radiusX: 0, radiusY: 0,
      stroke: style.strokeColor ?? '#e63946',
      strokeWidth: style.strokeWidth ?? 2,
      opacity: style.strokeOpacity ?? 1,
      fill: 'transparent',
    });
  },

  midDraw(e: { x: number; y: number }) {
    const shape = toolRunner.getCurrentShape() as Konva.Ellipse | null;
    if (!shape || !startPos) return;

    // Radius = distance from drag origin to current cursor. Remember it for endDraw —
    // endDraw receives no event, so the last midDraw value is the authoritative final radius.
    const dx = e.x - startPos.x;
    const dy = e.y - startPos.y;
    currentRadius = Math.sqrt(dx * dx + dy * dy);

    shape.setAttrs({ radiusX: currentRadius, radiusY: currentRadius });
    shape.getLayer()?.batchDraw();
  },

  endDraw(): EllipseMarkup | null {
    if (!startPos || !toolRunner.getCurrentShape()) return null;

    // Commit threshold matches boxTool's <2pt guard (a click without drag = no circle).
    if (currentRadius < 2) return null;

    const pageHeightPts = toolRunner.getPageHeightPts();
    if (!pageHeightPts) return null;

    // Drag origin → PDF y-up center.
    const pdfCenter = konvaToPdf(startPos.x, startPos.y, pageHeightPts);

    // Konva layer units are 1:1 with PDF points (boxTool stores raw pt widths), so rx/ry
    // go straight through — no /72 (that division rendered committed ellipses at 1/72 size).
    return {
      id: generateId(),
      type: 'ellipse',
      pageIndex: toolRunner.getPageIndex(),
      style: { ...(toolRunner.getActiveStyle() ?? {}) },
      cx: pdfCenter.x,
      cy: pdfCenter.y,
      rx: currentRadius,
      ry: currentRadius,
    };
  }
};

export const ellipseTool: ToolProtocol = {
  id: 'ellipse',
  name: 'Ellipse',
  key: 'e',
  draw: ellipseDraw,
};

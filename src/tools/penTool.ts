import Konva from 'konva';
import { toolRunner } from './toolRunner.ts';
import type { ToolProtocol, DrawPhase } from './toolProtocol.ts';
import { generateId } from '../model/document.ts';
import { konvaPointsToPdf } from '../geometry/transform.ts';

/**
 * Declarative freehand pen protocol — replaces the class-based PenTool.
 *
 * The old BaseTool class was orphaned by migration commit 1455e54 (toolProtocol
 * conversion): it imported nothing and was never instantiated, while 'pen' had
 * no entry in main.ts's toolProtocols map — so selecting the Pen tool bound zero
 * listeners and every stroke was silently discarded ("pen not drawing"). This
 * file is now a real ToolProtocol; see tests/pen-tool.spec.ts for the regression.
 */

const MIN_COMMIT_POINTS = 4; // flat [x,y] pairs — two distinct points minimum (matches the old class's <4 discard)

const penDraw: DrawPhase = {
  startDraw(e) {
    const style = toolRunner.getActiveStyle() || {};

    // Live preview line on a single seed point; midDraw appends cursor positions.
    return new Konva.Line({
      points: [e.x, e.y],
      stroke: (style.strokeColor ?? '#e63946') as string,
      strokeWidth: (style.strokeWidth ?? 2) as number,
      opacity: (style.strokeOpacity ?? 1) as number,
      tension: 0.3,
      lineCap: 'round' as any,
      lineJoin: 'round' as any,
    });
  },

  midDraw(e) {
    // Append the cursor position — shape is already parented to the interaction layer by toolRunner.
    const shape = toolRunner.getCurrentShape() as Konva.Line;
    if (!shape) return;

    const points = (shape.points() as number[]).slice();
    points.push(e.x, e.y);
    shape.points(points);
    shape.getLayer()?.batchDraw();
  },

  endDraw() {
    const style = toolRunner.getActiveStyle() || {};
    const shape = toolRunner.getCurrentShape() as Konva.Line;
    if (!shape) return null;

    const points = (shape.points() as number[]).slice();
    // Sub-threshold drag (bare click, or a degenerate stroke): discard.
    // The framework destroys the preview in handleMouseUp's null branch.
    if (points.length < MIN_COMMIT_POINTS) return null;

    const pageHeightPts = toolRunner.getPageHeightPts();
    if (!pageHeightPts) return null;

    // Konva space → PDF space (Y-flip around page height). Flat array in, flat array out —
    // PenMarkup.points is the same shape stage.ts reads back via pdfPointsToKonva.
    const pdfPoints = konvaPointsToPdf(points, pageHeightPts);

    return {
      id: generateId(),
      type: 'pen',
      pageIndex: toolRunner.getPageIndex(),
      style: { ...(style ?? {}) },
      points: pdfPoints,
    } as any;
  }
};

export const penTool: ToolProtocol = {
  id: 'pen',
  name: 'Freehand Pen',
  key: 'p', // Keyboard shortcut hint (main.ts toolKeys already maps p → pen)
  draw: penDraw,
};

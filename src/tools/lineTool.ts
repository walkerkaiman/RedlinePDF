import Konva from 'konva';
import { toolRunner } from './toolRunner.ts';
import type { ToolProtocol, DrawPhase } from './toolProtocol.ts';
import { generateId } from '../model/document.ts';
import { konvaPointsToPdf } from '../geometry/transform.ts';

/** Declarative line drawing protocol — replaces imperative BaseTool/activate() */
const lineDraw: DrawPhase = {
  startDraw(e) {
    const style = toolRunner.getActiveStyle() || {};
    
    // Create live preview shape (zero-length initially, grows during drag)
    return new Konva.Line({
      points: [e.x, e.y, e.x, e.y],
      stroke: (style.strokeColor ?? '#e63946') as string,
      strokeWidth: (style.strokeWidth ?? 2) as number,
      opacity: (style.strokeOpacity ?? 1) as number,
      lineCap: 'round' as any,
    });
  },

  midDraw(e) {
    // Update endpoint to track cursor — shape is already on interaction layer
    const shape = toolRunner.getCurrentShape() as Konva.Line;
    if (!shape) return;
    
    const points = shape.points() as number[];
    if (points.length >= 4) {
      shape.points([points[0], points[1], e.x, e.y]);
    } else {
      shape.points([...points.slice(0, 2), e.x, e.y]);
    }
    
    // Trigger redraw via layer
    shape.getLayer()?.batchDraw();
  },

  endDraw() {
    const style = toolRunner.getActiveStyle() || {};
    const shape = toolRunner.getCurrentShape() as Konva.Line;
    
    if (!shape) return null;
    
    const points = shape.points() as number[];
    if (points.length < 4) return null; // Need start + end points

    // Convert screen→PDF coordinates with Y-flip for bottom-left origin
    const pageHeightPts = toolRunner.getPageHeightPts();
    if (!pageHeightPts) return null;

    const pdfStart = konvaPointsToPdf([points[0], points[1]], pageHeightPts);
    const pdfEnd = konvaPointsToPdf([points[points.length - 2], points[points.length - 1]], pageHeightPts);

    // Build the markup object for ADD_MARKUP mutation
    return {
      id: generateId(),
      type: 'line',
      pageIndex: toolRunner.getPageIndex(),
      style: { ...(style ?? {}) },
      x1: pdfStart[0], y1: pdfStart[1],
      x2: pdfEnd[0], y2: pdfEnd[1],
    } as any;
  }
};

export const lineTool: ToolProtocol = {
  id: 'line',
  name: 'Line',
  key: 'l', // Keyboard shortcut hint
  draw: lineDraw,
};

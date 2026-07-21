import Konva from 'konva';
import { toolRunner } from './toolRunner.ts';
import type { ToolProtocol, DrawPhase } from './toolProtocol.ts';
import { generateId } from '../model/document.ts';
import { konvaToPdf } from '../geometry/transform.ts';

let startPos: { x: number; y: number } | null = null;

const ellipseDraw: DrawPhase = {
  startDraw(e) {
    const style = toolRunner.getActiveStyle() || {};
    
    // Remember start position for radius calculation on endDraw
    startPos = { x: e.x, y: e.y };
    
    return new Konva.Ellipse({
      x: e.x, y: e.y,
      radiusX: 0, radiusY: 0,
      stroke: style.strokeColor ?? '#e63946',
      strokeWidth: style.strokeWidth ?? 2,
      opacity: style.strokeOpacity ?? 1,
      fill: 'transparent',
    });
  },

  midDraw(e) {
    const shape = toolRunner.getCurrentShape() as Konva.Ellipse;
    if (!shape || !startPos) return;
    
    // Calculate radius based on distance from start to current position
    const dx = e.x - startPos.x;
    const dy = e.y - startPos.y;
    const radius = Math.sqrt(dx * dx + dy * dy);
    
    shape.setAttrs({ radiusX: radius, radiusY: radius });
    shape.getLayer()?.batchDraw();
  },

  endDraw() {
    if (!startPos || !toolRunner.getCurrentShape()) return null;
    
    const shape = toolRunner.getCurrentShape() as Konva.Ellipse;
    if (!shape) return null;
    
    // Calculate final radius from stored start position and current ellipse attrs
    const style = toolRunner.getActiveStyle();
    
    // The ellipse center is at startPos, and its radiusX/Y were updated during midDraw
    // We need to get the actual rendered radius
    const points = shape.attrs.points as number[];
    let finalRadius = 0;
    if (points.length >= 2) {
      finalRadius = Math.sqrt(
        Math.pow(points[1] - startPos.x, 2) + Math.pow(points[3] - startPos.y, 2)
      );
    } else {
      // Fallback: use radiusX from the shape's current state
      finalRadius = (shape as any).radiusX ?? 0;
    }
    
    if (finalRadius < 4) return null;

    const pageHeightPts = toolRunner.getPageHeightPts();
    if (!pageHeightPts) return null;

    // Convert start position to PDF coordinates
    const pdfCenter = konvaToPdf(startPos.x, startPos.y, pageHeightPts);

    return {
      id: generateId(),
      type: 'ellipse',
      pageIndex: toolRunner.getPageIndex(),
      style: { ...(style ?? {}) },
      cx: pdfCenter.x,
      cy: pdfCenter.y,
      rx: finalRadius / 72,
      ry: finalRadius / 72,
    } as any;
  }
};

export const ellipseTool: ToolProtocol = {
  id: 'ellipse',
  name: 'Ellipse',
  key: 'e',
  draw: ellipseDraw,
};

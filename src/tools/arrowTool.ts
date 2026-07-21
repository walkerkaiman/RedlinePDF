import Konva from 'konva';
import { toolRunner } from './toolRunner.ts';
import type { ToolProtocol, DrawPhase } from './toolProtocol.ts';
import { generateId } from '../model/document.ts';
import { konvaToPdf } from '../geometry/transform.ts';

const arrowDraw: DrawPhase = {
  startDraw(e) {
    const style = toolRunner.getActiveStyle() || {};
    
    return new Konva.Arrow({
      points: [e.x, e.y, e.x, e.y],
      stroke: style.strokeColor ?? '#e63946',
      strokeWidth: style.strokeWidth ?? 2,
      opacity: style.strokeOpacity ?? 1,
      fill: style.fillColor ?? 'transparent',
      pointerLength: Math.max(8, (style.strokeWidth ?? 2) * 3),
      pointerWidth: Math.max(6, (style.strokeWidth ?? 2) * 2.5),
      lineCap: 'round' as any,
    });
  },

  midDraw(e) {
    const shape = toolRunner.getCurrentShape() as Konva.Arrow;
    if (!shape) return;
    
    const points = shape.points() as number[];
    if (points.length >= 4) {
      shape.points([points[0], points[1], e.x, e.y]);
    } else {
      shape.points([...points.slice(0, 2), e.x, e.y]);
    }
    
    shape.getLayer()?.batchDraw();
  },

  endDraw() {
    const style = toolRunner.getActiveStyle();
    const shape = toolRunner.getCurrentShape() as Konva.Arrow;
    
    if (!shape) return null;
    
    const pageHeightPts = toolRunner.getPageHeightPts();
    if (!pageHeightPts) return null;

    const points = shape.points() as number[];
    if (points.length < 4 || 
        Math.abs(points[0] - points[2]) < 2 && Math.abs(points[1] - points[3]) < 2) {
      return null;
    }

    const p1 = konvaToPdf(points[0], points[1], pageHeightPts);
    const p2 = konvaToPdf(points[points.length - 2], 
                          points[points.length - 1], pageHeightPts);

    return {
      id: generateId(),
      type: 'arrow',
      pageIndex: toolRunner.getPageIndex(),
      style: { ...(style ?? {}) },
      x1: p1.x, y1: p1.y,
      x2: p2.x, y2: p2.y,
    } as any;
  }
};

export const arrowTool: ToolProtocol = {
  id: 'arrow',
  name: 'Arrow',
  key: 'a',
  draw: arrowDraw,
};

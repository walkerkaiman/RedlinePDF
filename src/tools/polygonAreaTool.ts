import Konva from 'konva';
import type { ToolProtocol } from './toolProtocol';
import { toolRunner } from './toolRunner';
import { polygonArea as calcPolygonArea, konvaPointsToPdf } from '../geometry/transform';
import { generateId } from '../model/document.ts';

let isDrawing = false;
let currentPoints: number[] = [];
let previewPolyline: Konva.Line | null = null;
let previewLabel: Konva.Text | null = null;
let previewLabelBg: Konva.Rect | null = null;

const polygonAreaDrawPhase = {
  startDraw(e: any) {
    isDrawing = true;
    currentPoints = [];
    
    const stageManager = toolRunner.getStageManager();
    if (!stageManager?.interactionLayer) return;
    
    previewPolyline = new Konva.Line({
      points: [], stroke: '#0077cc', strokeWidth: 1.5, dash: [6, 3], lineCap: 'round', lineJoin: 'round',
    });
    stageManager.interactionLayer.add(previewPolyline);

    previewLabel = new Konva.Text({ text: '', fontSize: 11, fontFamily: 'Arial', fill: '#0077cc', padding: 3, visible: false });
    stageManager.interactionLayer.add(previewLabel);

    previewLabelBg = new Konva.Rect({ fill: 'rgba(255,255,255,0.85)', cornerRadius: 2, visible: false, listening: false });
    stageManager.interactionLayer.add(previewLabelBg);

    currentPoints.push(e.x, e.y);
    if (previewPolyline) previewPolyline.points([e.x, e.y]);
  },

  midDraw(e: any) {
    const stageManager = toolRunner.getStageManager();
    if (!stageManager?.interactionLayer || !isDrawing) return;

    currentPoints.push(e.x, e.y);
    if (previewPolyline) previewPolyline.points([...currentPoints]);

    if (currentPoints.length >= 6) {
      const h = toolRunner.getPageHeightPts();
      try {
        const pdfPoints: any[] = konvaPointsToPdf(currentPoints, h);
        const areaMm = calcPolygonArea(pdfPoints) * 100;

        if (previewLabel && previewLabelBg) {
          previewLabel.setAttrs({ text: `${areaMm.toFixed(1)} mm²`, visible: true });
          const cx = currentPoints.reduce((s, v, i) => i % 2 === 0 ? s + v : s, 0) / currentPoints.length;
          const cy = currentPoints.filter((_, i) => i % 2 !== 0).reduce((s, v) => s + v, 0) / (currentPoints.length / 2);
          previewLabelBg.setAttrs({ x: cx - 5, y: cy - 16, width: previewLabel.width() + 10, height: previewLabel.height() + 4, visible: true });
        }
      } catch {}

    }

    stageManager.interactionLayer.draw();
  },

  endDraw(): any {
    const stageManager = toolRunner.getStageManager();
    if (!isDrawing || currentPoints.length < 6) return null;

    isDrawing = false;
    previewPolyline?.destroy(); previewLabel?.destroy(); previewLabelBg?.destroy();
    previewPolyline = null; previewLabel = null; previewLabelBg = null;

    const h = toolRunner.getPageHeightPts();
    try {
      const pdfPoints: any[] = konvaPointsToPdf(currentPoints, h);
      const areaMm = calcPolygonArea(pdfPoints) * 100;

      if (areaMm < 40) return null;

      currentPoints = [];
      let cx = 0, cy = 0;
      for (let i = 0; i < pdfPoints.length; i++) { cx += pdfPoints[i].x; cy += pdfPoints[i].y; }
      cx /= pdfPoints.length; cy /= pdfPoints.length;

      return {
        id: generateId(), type: 'polygon-area', pageIndex: toolRunner.getPageIndex(),
        style: { strokeColor: '#0077cc', strokeWidth: 1.5 }, points: pdfPoints as any,
      };
    } catch (err) {
      console.error('[polygonAreaTool] endDraw error:', err);
      return null;
    }
  },
};

export const polygonAreaTool: ToolProtocol = {
  id: 'polygon-area', name: 'Polygon Area', key: 'a', draw: polygonAreaDrawPhase,
};

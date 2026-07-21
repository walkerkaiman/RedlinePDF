import Konva from 'konva';
import type { ToolProtocol } from './toolProtocol';
import { toolRunner } from './toolRunner';
import { generateId, BoxMarkup } from '../model/document.ts';

let isDrawing = false;
let startPos: { x: number; y: number } | null = null;
let previewRect: Konva.Rect | null = null;

const boxDrawPhase = {
  startDraw(e: any) {
    isDrawing = true;
    const sm = toolRunner.getStageManager();
    if (!sm?.interactionLayer) return null;
    
    startPos = { x: e.x, y: e.y };
    
    previewRect = new Konva.Rect({
      x: e.x, y: e.y, width: 0, height: 0,
      stroke: appState.state.activeStyle.strokeColor || '#e63946',
      strokeWidth: appState.state.activeStyle.strokeWidth || 2,
    });
    sm.interactionLayer.add(previewRect);

    return previewRect;
  },

  midDraw(e: any) {
    if (!isDrawing || !previewRect || !startPos) return null;
    
    const x = Math.min(startPos.x, e.x);
    const y = Math.min(startPos.y, e.y);
    const w = Math.abs(e.x - startPos.x);
    const h = Math.abs(e.y - startPos.y);
    
    previewRect.setAttrs({ x, y, width: w, height: h });

    toolRunner.getStageManager()?.interactionLayer.draw();
  },

  endDraw(): BoxMarkup | null {
    if (!isDrawing || !previewRect) return null;

    isDrawing = false;
    const sm = toolRunner.getStageManager();
    
    const h = toolRunner.getPageHeightPts();
    let x = Math.min(startPos!.x, previewRect.x() + previewRect.width());
    let y = Math.min(startPos!.y, previewRect.y() + previewRect.height());

    // Ensure minimum size for valid markup (10 pixels)
    if (previewRect.width() < 10 || previewRect.height() < 10) {
      previewRect.destroy();
      return null;
    }

    const pdfPoints = toolRunner.konvaToPdf([x, y], h);
    
    const markup: BoxMarkup = {
      id: generateId(), type: 'box', pageIndex: toolRunner.getPageIndex(),
      x: pdfPoints[0], y: pdfPoints[1], width: 50, height: 30, style: appState.state.activeStyle || {},
    };

    previewRect.destroy();
    return markup;
  },
};

export const boxTool: ToolProtocol = {
  id: 'box', name: 'Box / Rectangle', key: 'r', draw: { ...boxDrawPhase, startPos },
};

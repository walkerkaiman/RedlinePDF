import Konva from 'konva';
import type { ToolProtocol } from './toolProtocol';
import { appState } from '../state/appState.ts';
import { toolRunner } from './toolRunner';
import { konvaToPdf } from '../geometry/transform.ts';
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

    // previewRect attrs are in markupLayer (PDF-point) units — same space every tool's
    // event coords use. Convert the bottom-left corner to PDF y-up space for storage.
    const h = toolRunner.getPageHeightPts();

    if (previewRect.width() < 2 || previewRect.height() < 2) {
      previewRect.destroy();
      return null;
    }

    // Konva top-left → PDF bottom-left: flip the y axis using the rect's BOTTOM edge.
    const pdf = konvaToPdf(previewRect.x(), previewRect.y() + previewRect.height(), h);

    const markup: BoxMarkup = {
      id: generateId(), type: 'box', pageIndex: toolRunner.getPageIndex(),
      x: pdf.x, y: pdf.y, width: Math.abs(previewRect.width()), height: Math.abs(previewRect.height()),
      style: appState.state.activeStyle || {},
    };

    previewRect.destroy();
    return markup;
  },
};

export const boxTool: ToolProtocol = {
  id: 'box', name: 'Box / Rectangle', key: 'r', draw: { ...boxDrawPhase, startPos },
};

import Konva from 'konva';
import type { ToolProtocol } from './toolProtocol';
import { toolRunner } from './toolRunner';
import { konvaToPdf, distance } from '../geometry/transform.ts';
import { formatLinear } from '../measure/units.ts';
import { generateId } from '../model/document.ts';
import type { MeasureLinearMarkup } from '../model/document.ts';

// Module-level drag state — mirrors the ellipse/box pattern (draw phase receives no
// extra args per signature, so intermediate values are carried in closure).
let startPos: { x: number; y: number } | null = null;
let lastPos: { x: number; y: number } | null = null;
let previewLine: Konva.Line | null = null;
let previewLabel: Konva.Text | null = null;
let previewLabelBg: Konva.Rect | null = null;

function getScale() { return toolRunner.getScale(); }
function getUnits() { return toolRunner.getAppState().state.units; }

function getLabel(kx1: number, ky1: number, kx2: number, ky2: number): string {
  const h = toolRunner.getPageHeightPts();
  const scale = getScale();
  if (!scale.calibrated) return 'Set scale first';
  const p1 = konvaToPdf(kx1, ky1, h);
  const p2 = konvaToPdf(kx2, ky2, h);
  return formatLinear(distance(p1, p2), scale.pointsPerUnit, getUnits().linearUnit);
}

function clearPreview(): void {
  previewLine?.destroy(); previewLine = null;
  previewLabel?.destroy(); previewLabel = null;
  previewLabelBg?.destroy(); previewLabelBg = null;
}

const measureLinearDraw = {
  startDraw(e: { x: number; y: number }) {
    const sm = toolRunner.getStageManager();
    if (!sm?.interactionLayer) return null;
    startPos = { x: e.x, y: e.y };
    lastPos = { x: e.x, y: e.y };

    previewLine = new Konva.Line({ points: [e.x, e.y, e.x, e.y], stroke: '#0077cc', strokeWidth: 1.5, dash: [6, 3] });
    previewLabel = new Konva.Text({ x: e.x + 6, y: e.y - 16, text: '', fontSize: 11, fontFamily: 'Arial', fill: '#0077cc', padding: 3 });
    previewLabelBg = new Konva.Rect({ x: e.x + 3, y: e.y - 19, width: 0, height: 0, fill: 'rgba(255,255,255,0.85)', cornerRadius: 2 });
    sm.interactionLayer.add(previewLine, previewLabelBg, previewLabel);
    return previewLine;
  },

  midDraw(e: { x: number; y: number }) {
    if (!previewLine || !previewLabel || !previewLabelBg || !startPos) return;
    lastPos = { x: e.x, y: e.y };
    previewLine.points([startPos.x, startPos.y, e.x, e.y]);
    const label = getLabel(startPos.x, startPos.y, e.x, e.y);
    const midX = (startPos.x + e.x) / 2;
    const midY = (startPos.y + e.y) / 2;
    previewLabel.setAttrs({ x: midX + 6, y: midY - 16, text: label });
    previewLabelBg.setAttrs({ x: midX + 3, y: midY - 19, width: previewLabel.width() + 6, height: previewLabel.height() + 6 });
    previewLine.getLayer()?.batchDraw();
  },

  endDraw(): MeasureLinearMarkup | null {
    if (!startPos || !lastPos) { clearPreview(); return null; }
    const endPos = lastPos;
    clearPreview();

    const h = toolRunner.getPageHeightPts();
    if (!h) return null;
    const p1 = konvaToPdf(startPos.x, startPos.y, h);
    const p2 = konvaToPdf(endPos.x, endPos.y, h);
    if (distance(p1, p2) < 4) return null;

    const style = toolRunner.getActiveStyle() ?? { strokeColor: '#0077cc', strokeWidth: 1.5 };
    return {
      id: generateId(),
      type: 'measure-linear',
      pageIndex: toolRunner.getPageIndex(),
      style: { strokeColor: style.strokeColor ?? '#0077cc', strokeWidth: style.strokeWidth ?? 1.5 },
      x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
      label: getLabel(startPos.x, startPos.y, endPos.x, endPos.y),
    };
  },
};

export const measureLinearTool: ToolProtocol = {
  id: 'measure-linear',
  name: 'Measure Linear',
  key: 'l',
  draw: measureLinearDraw,
  deactivate() {
    clearPreview();
    const sm = toolRunner.getStageManager();
    if (sm?.stage) sm.stage.container().style.cursor = 'default';
  },
};

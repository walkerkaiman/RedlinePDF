import Konva from 'konva';
import type { ToolProtocol } from './toolProtocol';
import { toolRunner } from './toolRunner';
import { konvaRectToPdf } from '../geometry/transform.ts';
import { formatLinear, formatArea } from '../measure/units.ts';
import { generateId } from '../model/document.ts';
import type { MeasureRectMarkup } from '../model/document.ts';

let startPos: { x: number; y: number } | null = null;
let lastPos: { x: number; y: number } | null = null;
let previewRect: Konva.Rect | null = null;
let previewLabel: Konva.Text | null = null;
let previewLabelBg: Konva.Rect | null = null;

function getScale() { return toolRunner.getScale(); }
function getUnits() { return toolRunner.getAppState().state.units; }

function getLabel(kx: number, ky: number, kw: number, kh: number): string {
  const scale = getScale();
  if (!scale.calibrated) return 'Set scale first';
  const unit = getUnits().linearUnit;
  const ppi = scale.pointsPerUnit;
  return `W: ${formatLinear(kw, ppi, unit)}\nH: ${formatLinear(kh, ppi, unit)}\n${formatArea(kw * kh, ppi, unit)}`;
}

function clearPreview(): void {
  previewRect?.destroy(); previewRect = null;
  previewLabel?.destroy(); previewLabel = null;
  previewLabelBg?.destroy(); previewLabelBg = null;
}

const measureRectDraw = {
  startDraw(e: { x: number; y: number }) {
    const sm = toolRunner.getStageManager();
    if (!sm?.interactionLayer) return null;
    startPos = { x: e.x, y: e.y };
    lastPos = { x: e.x, y: e.y };

    previewRect = new Konva.Rect({ x: e.x, y: e.y, width: 0, height: 0, stroke: '#0077cc', strokeWidth: 1.5, dash: [6, 3], fill: 'rgba(0,119,204,0.08)' });
    previewLabel = new Konva.Text({ x: e.x, y: e.y, text: '', fontSize: 11, fontFamily: 'Arial', fill: '#0077cc', padding: 3, align: 'center' });
    previewLabelBg = new Konva.Rect({ x: e.x, y: e.y, width: 0, height: 0, fill: 'rgba(255,255,255,0.85)', cornerRadius: 2 });
    sm.interactionLayer.add(previewRect, previewLabelBg, previewLabel);
    return previewRect;
  },

  midDraw(e: { x: number; y: number }) {
    if (!previewRect || !previewLabel || !previewLabelBg || !startPos) return;
    lastPos = { x: e.x, y: e.y };
    const x = Math.min(e.x, startPos.x);
    const y = Math.min(e.y, startPos.y);
    const w = Math.abs(e.x - startPos.x);
    const h = Math.abs(e.y - startPos.y);
    previewRect.setAttrs({ x, y, width: w, height: h });

    const label = getLabel(x, y, w, h);
    const cx = x + w / 2;
    const cy = y + h / 2;
    previewLabel.setAttrs({ text: label, x: cx - 40, y: cy - 20, width: 80 });
    previewLabelBg.setAttrs({ x: cx - 43, y: cy - 23, width: 86, height: previewLabel.height() + 6 });
    previewRect.getLayer()?.batchDraw();
  },

  endDraw(): MeasureRectMarkup | null {
    if (!startPos || !lastPos) { clearPreview(); return null; }
    const endPos = lastPos;
    clearPreview();

    const kx = Math.min(endPos.x, startPos.x);
    const ky = Math.min(endPos.y, startPos.y);
    const kw = Math.abs(endPos.x - startPos.x);
    const kh = Math.abs(endPos.y - startPos.y);
    if (kw < 4 || kh < 4) return null;

    const pdfRect = konvaRectToPdf(kx, ky, kw, kh, toolRunner.getPageHeightPts());
    const style = toolRunner.getActiveStyle() ?? { strokeColor: '#0077cc', strokeWidth: 1.5 };
    return {
      id: generateId(),
      type: 'measure-rect',
      pageIndex: toolRunner.getPageIndex(),
      style: { strokeColor: style.strokeColor ?? '#0077cc', strokeWidth: style.strokeWidth ?? 1.5 },
      ...pdfRect,
      label: getLabel(kx, ky, kw, kh),
    };
  },
};

export const measureRectTool: ToolProtocol = {
  id: 'measure-rect',
  name: 'Measure Rectangle',
  key: 'r',
  draw: measureRectDraw,
  deactivate() {
    clearPreview();
    const sm = toolRunner.getStageManager();
    if (sm?.stage) sm.stage.container().style.cursor = 'default';
  },
};

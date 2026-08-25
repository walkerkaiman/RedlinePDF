import Konva from 'konva';
import type { ToolProtocol } from './toolProtocol';
import { toolRunner } from './toolRunner';
import { konvaToPdf, polygonArea, polygonPerimeter, distance } from '../geometry/transform.ts';
import { formatLinear, formatArea } from '../measure/units.ts';
import { generateId } from '../model/document.ts';
import type { MeasurePolyMarkup, Point } from '../model/document.ts';

interface Vtx { kx: number; ky: number; dot: Konva.Circle; }
let vertices: Vtx[] = [];
let lines: Konva.Line[] = [];
let closingLine: Konva.Line | null = null;
let labelNode: Konva.Text | null = null;
let labelBg: Konva.Rect | null = null;

function getScale() { return toolRunner.getScale(); }
function getUnits() { return toolRunner.getAppState().state.units; }

function clearPreview(): void {
  vertices.forEach(v => v.dot.destroy());
  vertices = [];
  lines.forEach(l => l.destroy());
  lines = [];
  closingLine?.destroy(); closingLine = null;
  labelNode?.destroy(); labelNode = null;
  labelBg?.destroy(); labelBg = null;
  toolRunner.getStageManager()?.interactionLayer?.draw();
}

function buildLabel(): string {
  const scale = getScale();
  if (!scale.calibrated || vertices.length < 3) return '';
  const h = toolRunner.getPageHeightPts();
  const pdfPts = vertices.map(v => konvaToPdf(v.kx, v.ky, h));
  const unit = getUnits().linearUnit;
  const ppi = scale.pointsPerUnit;
  return `Area: ${formatArea(polygonArea(pdfPts), ppi, unit)}\n\nPerim: ${formatLinear(polygonPerimeter(pdfPts), ppi, unit)}`;
}

function refreshPreview(): void {
  const sm = toolRunner.getStageManager();
  if (!sm?.interactionLayer) return;
  if (vertices.length >= 2 && closingLine) {
    const first = vertices[0];
    const last = vertices[vertices.length - 1];
    closingLine.points([last.kx, last.ky, first.kx, first.ky]);
  }
  const label = buildLabel();
  if (label && vertices.length >= 3) {
    const cx = vertices.reduce((s, v) => s + v.kx, 0) / vertices.length;
    const cy = vertices.reduce((s, v) => s + v.ky, 0) / vertices.length;
    labelNode?.setAttrs({ x: cx - 75, y: cy - 12, text: label, visible: true });
    labelBg?.setAttrs({ x: cx - 78, y: cy - 15, width: 156, height: (labelNode?.height() ?? 0) + 6, visible: true });
  } else {
    labelNode?.visible(false);
    labelBg?.visible(false);
  }
  sm.interactionLayer.draw();
}

function commitPoly(): void {
  if (vertices.length < 3) { clearPreview(); return; }
  const h = toolRunner.getPageHeightPts();
  const scale = getScale();
  const unit = getUnits().linearUnit;
  const pdfPts = vertices.map(v => konvaToPdf(v.kx, v.ky, h));
  const area = polygonArea(pdfPts);
  const perimeter = polygonPerimeter(pdfPts);

  let label: string;
  if (scale.calibrated) {
    const ppi = scale.pointsPerUnit;
    label = `Area: ${formatArea(area, ppi, unit)}\n\nPerim: ${formatLinear(perimeter, ppi, unit)}`;
  } else {
    label = `${pdfPts.length} vertices\n(Set scale to measure)`;
  }

  const markup: MeasurePolyMarkup = {
    id: generateId(),
    type: 'measure-poly',
    pageIndex: toolRunner.getPageIndex(),
    style: { strokeColor: '#0077cc', strokeWidth: 1.5 },
    points: pdfPts as Point[],
    label,
  };
  clearPreview();
  toolRunner.getAppState().mutate('ADD_MARKUP', { markup, pageIndex: toolRunner.getPageIndex() });
}

export const measurePolyTool: ToolProtocol = {
  id: 'measure-poly',
  name: 'Measure Polygon',
  key: 'p',
  onClick(e: { x: number; y: number }) {
    const sm = toolRunner.getStageManager();
    if (!sm?.interactionLayer) return;
    const layer = sm.interactionLayer as unknown as Konva.Layer;

    // Close when clicking near the FIRST vertex (shared-vertex join) with >= 3 placed.
    if (vertices.length >= 3) {
      const first = vertices[0];
      if (distance({ x: e.x, y: e.y }, { x: first.kx, y: first.ky }) <= 12) {
        commitPoly();
        return;
      }
    }

    const dot = new Konva.Circle({ x: e.x, y: e.y, radius: 5, fill: '#0077cc', stroke: '#fff', strokeWidth: 1 });
    layer.add(dot as unknown as Konva.Shape);
    vertices.push({ kx: e.x, ky: e.y, dot });

    if (vertices.length >= 2) {
      const prev = vertices[vertices.length - 2];
      const line = new Konva.Line({ points: [prev.kx, prev.ky, e.x, e.y], stroke: '#0077cc', strokeWidth: 1.5, dash: [6, 3] });
      lines.push(line);
      layer.add(line as unknown as Konva.Shape);
    }
    if (closingLine) closingLine.destroy();
    closingLine = new Konva.Line({ points: [e.x, e.y, e.x, e.y], stroke: '#0077cc', strokeWidth: 1.5, dash: [4, 4], opacity: 0.6 });
    layer.add(closingLine as unknown as Konva.Shape);

    if (!labelNode) {
      labelNode = new Konva.Text({ x: 0, y: 0, text: '', fontSize: 11, fontFamily: 'Arial', fill: '#0077cc', visible: false, width: 150, align: 'center' });
      labelBg = new Konva.Rect({ x: 0, y: 0, width: 156, height: 0, fill: 'rgba(255,255,255,0.85)', cornerRadius: 2, visible: false });
      layer.add(labelBg as unknown as Konva.Shape, labelNode as unknown as Konva.Shape);
    }
    refreshPreview();
  },
  onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') commitPoly();
    else if (e.key === 'Escape') clearPreview();
  },
  deactivate() {
    clearPreview();
    const sm = toolRunner.getStageManager();
    if (sm?.stage) sm.stage.container().style.cursor = 'default';
  },
};

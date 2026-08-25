import Konva from 'konva';
import type { ToolProtocol } from './toolProtocol';
import { toolRunner } from './toolRunner';
import { konvaToPdf } from '../geometry/transform.ts';
import { generateId } from '../model/document.ts';
import type { Markup } from '../model/document.ts';

/**
 * Polygon Area tool — CLICK-VERTEX mode (NOT freehand drag).
 * Each click drops a shared vertex and extends a live polyline. The polygon closes when the
 * user clicks near the FIRST vertex (the "lines that share vertices" behavior) or presses
 * Enter; Esc cancels. This is deliberate: a continuous-drag `draw` phase made it behave like
 * the pen tool, which was the reported bug. Konva `dblclick` is unreliable under synthetic
 * (Playwright) events, so first-vertex-click is the primary close gesture.
 * Module state (`vertices[]`, `liveLine`) must be reset in clearPreview()/deactivate().
 */
// Click-state (ToolProtocol objects are stateless by design).
interface Vtx { kx: number; ky: number; dot: Konva.Circle; }
let vertices: Vtx[] = [];
let liveLine: Konva.Line | null = null;

function clearPreview(): void {
  const sm = toolRunner.getStageManager();
  vertices.forEach(v => v.dot.destroy());
  vertices = [];
  liveLine?.destroy(); liveLine = null;
  sm?.interactionLayer?.draw();
}

function refreshLiveLine(): void {
  const sm = toolRunner.getStageManager();
  if (!sm?.interactionLayer) return;
  const layer = sm.interactionLayer as unknown as Konva.Layer;
  if (!liveLine) {
    liveLine = new Konva.Line({ stroke: '#ff9900', strokeWidth: 2, dash: [6, 4], points: [] });
    layer.add(liveLine as unknown as Konva.Shape);
  }
  const pts: number[] = [];
  vertices.forEach(v => { pts.push(v.kx, v.ky); });
  liveLine.points(pts);
  layer.draw();
}

function commitPolygon(): void {
  if (vertices.length < 3) return;
  const h = toolRunner.getPageHeightPts();
  const pdfPoints = vertices.map(v => {
    const p = konvaToPdf(v.kx, v.ky, h);
    return { x: p.x, y: p.y };
  });

  const markup: Markup = {
    id: generateId(),
    type: 'polygon-area',
    pageIndex: toolRunner.getPageIndex(),
    style: toolRunner.getActiveStyle(),
    points: pdfPoints,
    // Area is computed downstream from pdfPoints; keep model fields consistent.
    area: 0,
  } as Markup;

  toolRunner.getAppState().mutate('ADD_MARKUP', { markup, pageIndex: toolRunner.getPageIndex() });
}

export const polygonAreaTool: ToolProtocol = {
  id: 'polygon-area',
  name: 'Polygon Area',
  key: 'a',

  onClick(e: { x: number; y: number }) {
    const sm = toolRunner.getStageManager();
    if (!sm?.interactionLayer) return;
    const layer = sm.interactionLayer as unknown as Konva.Layer;

    // Close the polygon when the user clicks near the FIRST vertex (shared-vertex join).
    if (vertices.length >= 3) {
      const first = vertices[0];
      const dx = e.x - first.kx;
      const dy = e.y - first.ky;
      if (Math.hypot(dx, dy) <= 12) {
        commitPolygon();
        clearPreview();
        return;
      }
    }

    const dot = new Konva.Circle({ x: e.x, y: e.y, radius: 5, fill: '#ff9900', stroke: '#fff', strokeWidth: 1 });
    layer.add(dot as unknown as Konva.Shape);
    vertices.push({ kx: e.x, ky: e.y, dot });
    refreshLiveLine();
  },

  onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') { commitPolygon(); clearPreview(); }
    else if (e.key === 'Escape') { clearPreview(); }
  },

  deactivate() {
    const sm = toolRunner.getStageManager();
    if (sm?.stage) sm.stage.container().style.cursor = 'default';
    clearPreview();
  },
};

import Konva from 'konva';
import type { ToolProtocol } from './toolProtocol';
import { toolRunner } from './toolRunner';
import { appState } from '../state/appState.ts';

/**
 * Select / Move tool.
 *
 * This is the canvas-click selection system. Historically selection was handled by a
 * BaseTool/SelectTool class bound through per-tool listeners; the ToolProtocol migration
 * dropped the click handler, leaving the tool inert (nothing selected a markup on canvas
 * click). This ToolProtocol restores that: clicking a markup selects it, Shift+click toggles
 * it in/out of the multi-selection, and clicking empty canvas deselects.
 *
 * On selection it also draws a visible highlight and attaches a Konva.Transformer so the
 * selected markup(s) can be moved (drag) and resized/rotated; both emit `markup-transform`
 * which main.ts bakes back into the PDF-space model.
 *
 * The legacy `SelectTool` class below is retained only because main.ts still imports it for
 * `instanceof` checks; it is no longer instantiated and its methods are not called.
 */
export class SelectTool {
  private _selectedNode: Konva.Rect | null = null;
  stageManager: any = null;
  constructor() {}
  selectNode(node: Konva.Shape, sm: any): void {
    if (this._selectedNode) this._selectedNode.remove();
    const rect = new Konva.Rect({
      width: (node as any).width(), height: (node as any).height(),
      stroke: '#0077cc', strokeWidth: 2, dash: [8, 4], listening: false,
    });
    sm.interactionLayer.add(rect);
    rect.y((node as any).y());
    this._selectedNode = rect;
  }
  deselect(): void { this._selectedNode?.remove(); this._selectedNode = null; }
  isAnySelected(): boolean { return !!this._selectedNode; }
  clearSelection(): void { this.deselect(); }
  refreshDraggable(): void {}
  refreshTransformerForNode(id: string): void {
    const layer = this.stageManager?.markupsLayer;
    if (!layer) return;
    const nodes = layer.find(`[markupId="${id}"]`);
    if (nodes.length && !this._selectedNode) this.selectNode(nodes[0], this.stageManager);
    else if (!nodes.length) this.deselect();
  }
  refreshTransformerForNodes(ids: string[]): void {
    for (const id of ids) this.refreshTransformerForNode(id);
  }
}

// ── Active selection system (ToolProtocol) ────────────────────────────────────

let transformer: Konva.Transformer | null = null;
let highlights: Konva.Rect[] = [];
let shiftHeld = false;

// Track Shift so Shift+click can toggle multi-selection. ToolProtocol.onClick only
// receives {x,y}, so we read the modifier from the raw pointer event.
if (typeof window !== 'undefined') {
  window.addEventListener('mousedown', (e) => { shiftHeld = e.shiftKey; }, true);
  window.addEventListener('keydown', (e) => { if (e.key === 'Shift') shiftHeld = true; }, true);
  window.addEventListener('keyup', (e) => { if (e.key === 'Shift') shiftHeld = false; }, true);
}

function getSM() { return toolRunner.getStageManager(); }

function clearHighlights(): void {
  highlights.forEach((h) => h.destroy());
  highlights = [];
}

/** Hit-test the markup node under the pointer using absolute stage coords. */
function hitTest(): Konva.Node | null {
  const sm = getSM();
  if (!sm?.stage) return null;
  const abs = sm.stage.getPointerPosition();
  if (!abs) return null;
  let node: Konva.Node | undefined = sm.markupLayer.getIntersection(abs) ?? undefined;
  // Walk up from the hit shape to the markup group (the node that carries the markup id).
  while (node && !node.id()) {
    const parent = node.getParent() as Konva.Node | null;
    if (!parent) break;
    node = parent;
  }
  if (node && node.id()) return node;
  return null;
}

/** Redraw selection highlight + (re)attach the transformer to the selected nodes. */
function refreshSelectionVisual(): void {
  const sm = getSM();
  if (!sm) return;
  clearHighlights();

  const ids = appState.state.selectedMarkupIds;
  const nodes = ids
    .map((id) => sm.findNode(id))
    .filter((n): n is Konva.Node => !!n);

  for (const n of nodes) {
    const b = n.getClientRect({ relativeTo: sm.interactionLayer });
    const r = new Konva.Rect({
      x: b.x, y: b.y, width: b.width, height: b.height,
      stroke: '#0077cc', strokeWidth: 1.5, dash: [6, 4], listening: false,
    });
    sm.interactionLayer.add(r);
    highlights.push(r);

    // Make the node movable; bake the new position on drag end.
    n.draggable(true);
    n.off('.seldrag');
    n.on('dragmove.seldrag', () => {
      const box = n.getClientRect({ relativeTo: sm.interactionLayer });
      r.setAttrs({ x: box.x, y: box.y, width: box.width, height: box.height });
    });
    n.on('dragend.seldrag', () => appState.emit('markup-transform', { id: n.id() }));
  }

  if (!transformer) {
    transformer = new Konva.Transformer({
      id: 'select-transformer',
      rotateEnabled: true,
      borderStroke: '#0077cc',
      anchorStroke: '#0077cc',
      keepRatio: false,
    });
    sm.interactionLayer.add(transformer);
    transformer.on('transform', () => {
      for (const n of transformer!.nodes()) {
        const box = n.getClientRect({ relativeTo: sm.interactionLayer });
        const hr = highlights.find((h) => Math.abs(h.x() - box.x) < 1 && Math.abs(h.y() - box.y) < 1);
        hr?.setAttrs({ x: box.x, y: box.y, width: box.width, height: box.height });
      }
    });
    transformer.on('transformend', () => {
      for (const n of transformer!.nodes()) appState.emit('markup-transform', { id: n.id() });
    });
  }
  transformer.nodes(nodes);
  transformer.getLayer()?.batchDraw();
}

// Keep the visual in sync with the model (fires on selection change, draw-commit,
// style change, page change, etc.). Registered once at module load.
if (typeof window !== 'undefined') {
  appState.on('selection-change', () => refreshSelectionVisual());
}

export const selectTool: ToolProtocol = {
  id: 'select',
  name: 'Select',
  key: 'v',

  onClick() {
    const sm = getSM();
    if (!sm) return;
    const node = hitTest();
    const ids = appState.state.selectedMarkupIds;

    if (!node) {
      appState.setSelection(null);
      return;
    }

    const id = node.id();
    if (shiftHeld) {
      // Toggle this id in/out of the current selection.
      const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
      if (next.length === 0) appState.setSelection(null);
      else if (next.length === 1) appState.setSelection(next[0]);
      else appState.setMultiSelection(next);
    } else {
      appState.setSelection(id);
    }
  },

  deactivate() {
    const sm = getSM();
    clearHighlights();
    if (transformer) {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
    }
    // Drop draggable so non-select tools don't accidentally move markups.
    const sm2 = getSM();
    if (sm2) {
      for (const id of appState.state.selectedMarkupIds) {
        const n = sm2.findNode(id);
        if (n) { n.draggable(false); n.off('.seldrag'); }
      }
    }
    const stage = sm?.stage;
    if (stage) stage.container().style.cursor = 'default';
  },
};

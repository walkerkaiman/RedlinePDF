import Konva from 'konva';
// ── Select / Move tool (class wrapper for main.ts instanceof checks) ─────────
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
    if (nodes.length && !this._selectedNode) {
      this.selectNode(nodes[0], this.stageManager);
    } else if (!nodes.length) {
      this.deselect();
    }
  }

  refreshTransformerForNodes(ids: string[]): void {
    for (const id of ids) { this.refreshTransformerForNode(id); }
  }
}

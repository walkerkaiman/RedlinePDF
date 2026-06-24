import Konva from 'konva';
import { BaseTool, type ToolContext } from './baseTool.ts';
import { appState } from '../state/appState.ts';

export class SelectTool extends BaseTool {
  private transformer: Konva.Transformer | null = null;
  private selectionRect: Konva.Rect | null = null;
  private isSelecting = false;
  private selStart = { x: 0, y: 0 };

  constructor(ctx: ToolContext) {
    super('select', ctx);
  }

  activate(): void {
    const { stage, markupLayer, interactionLayer } = this.ctx.stageManager;

    // Transformer for resizing selected nodes
    this.transformer = new Konva.Transformer({
      nodes: [],
      padding: 4,
      rotateEnabled: false,
      anchorSize: 8,
      anchorStroke: '#0077cc',
      anchorFill: '#fff',
      borderStroke: '#0077cc',
      borderDash: [4, 2],
    });
    interactionLayer.add(this.transformer);

    // Rubber-band selection rect
    this.selectionRect = new Konva.Rect({
      stroke: '#0077cc', strokeWidth: 1, dash: [4, 2],
      fill: 'rgba(0,119,204,0.08)', visible: false,
    });
    interactionLayer.add(this.selectionRect);

    stage.on('mousedown.select touchstart.select', (e) => {
      const target = e.target;

      // Click on empty space → deselect
      if (target === stage || (target as unknown) === markupLayer) {
        this.transformer!.nodes([]);
        appState.setSelection(null);
        this.isSelecting = true;
        const pos = this.ctx.stageManager.getLayerPointer();
        if (pos) this.selStart = pos;
        this.selectionRect!.setAttrs({ x: pos?.x ?? 0, y: pos?.y ?? 0, width: 0, height: 0, visible: true });
        interactionLayer.draw();
        return;
      }

      // Click on markup
      if (target.hasName('markup') || target.parent?.hasName('markup')) {
        const node = target.hasName('markup') ? target : target.parent!;
        this.transformer!.nodes([node as Konva.Shape]);
        appState.setSelection(node.id());
        interactionLayer.draw();
        e.cancelBubble = true;
      }
    });

    stage.on('mousemove.select touchmove.select', () => {
      if (!this.isSelecting) return;
      const pos = this.ctx.stageManager.getLayerPointer();
      if (!pos) return;
      const sx = Math.min(pos.x, this.selStart.x);
      const sy = Math.min(pos.y, this.selStart.y);
      const sw = Math.abs(pos.x - this.selStart.x);
      const sh = Math.abs(pos.y - this.selStart.y);
      this.selectionRect!.setAttrs({ x: sx, y: sy, width: sw, height: sh });
      interactionLayer.draw();
    });

    stage.on('mouseup.select touchend.select', () => {
      if (!this.isSelecting) return;
      this.isSelecting = false;
      this.selectionRect!.visible(false);

      const box = this.selectionRect!.getClientRect();
      const selected = markupLayer.find('.markup').filter((node) => {
        const nb = node.getClientRect();
        return (
          nb.x < box.x + box.width &&
          nb.x + nb.width > box.x &&
          nb.y < box.y + box.height &&
          nb.y + nb.height > box.y
        );
      });

      if (selected.length > 0) {
        this.transformer!.nodes(selected as Konva.Shape[]);
        if (selected.length === 1) appState.setSelection(selected[0].id());
        else appState.setSelection(null);
      }
      interactionLayer.draw();
    });

    // Listen for transformer changes (move/resize)
    this.transformer.on('transformend', () => {
      const nodes = this.transformer!.nodes();
      nodes.forEach((node) => {
        // Emit update so the model stays in sync (simplified: just re-read position)
        appState.emit('markup-transform', { id: node.id(), node });
      });
    });

    this.transformer.on('dragend', () => {
      const nodes = this.transformer!.nodes();
      nodes.forEach((node) => {
        appState.emit('markup-transform', { id: node.id(), node });
      });
    });

    // Enable dragging on markup nodes in this tool
    markupLayer.find('.markup').forEach((n) => (n as Konva.Shape).draggable(true));
  }

  deactivate(): void {
    const { stage, markupLayer } = this.ctx.stageManager;
    stage.off('mousedown.select touchstart.select');
    stage.off('mousemove.select touchmove.select');
    stage.off('mouseup.select touchend.select');

    if (this.transformer) {
      this.transformer.nodes([]);
      this.transformer.destroy();
      this.transformer = null;
    }
    if (this.selectionRect) {
      this.selectionRect.destroy();
      this.selectionRect = null;
    }

    // Disable dragging when not in select mode
    markupLayer.find('.markup').forEach((n) => (n as Konva.Shape).draggable(false));

    appState.setSelection(null);
  }

  /** Call to deselect everything (e.g., when a markup is deleted) */
  clearSelection(): void {
    if (this.transformer) this.transformer.nodes([]);
    appState.setSelection(null);
    this.ctx.stageManager.interactionLayer.draw();
  }
}

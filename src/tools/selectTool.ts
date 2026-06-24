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

    // Rubber-band selection rect — listening:false so it never intercepts events
    this.selectionRect = new Konva.Rect({
      stroke: '#0077cc', strokeWidth: 1, dash: [4, 2],
      fill: 'rgba(0,119,204,0.08)', visible: false, listening: false,
    });
    interactionLayer.add(this.selectionRect);

    stage.on('mousedown.select touchstart.select', (e) => {
      const target = e.target;

      // If the click landed on the Transformer itself or any of its anchors /
      // border line, let Konva's built-in Transformer handling take over.
      // We must NOT clear the transformer nodes here — doing so would cancel
      // any resize/rotate operation before it begins.  In WebView2 (Tauri),
      // Konva's internal cancelBubble sometimes doesn't prevent the stage
      // handler from firing, so we guard explicitly.
      let checkNode: Konva.Node | null = target;
      while (checkNode) {
        if (checkNode === this.transformer) return;
        checkNode = checkNode.getParent?.() ?? null;
      }

      // Determine whether the click landed on a markup node (or its child).
      const markupNode = target.hasName('markup')
        ? target
        : target.parent?.hasName('markup') ? target.parent : null;

      if (markupNode) {
        // Single-click on a markup → select it
        this.transformer!.nodes([markupNode as Konva.Shape]);
        appState.setSelection(markupNode.id());
        interactionLayer.draw();
        e.cancelBubble = true;
        return;
      }

      // Anything that is not a markup or transformer handle (stage background,
      // the page image, etc.) starts a rubber-band selection.
      this.transformer!.nodes([]);
      appState.setSelection(null);
      this.isSelecting = true;
      const pos = this.ctx.stageManager.getLayerPointer();
      if (pos) this.selStart = { ...pos };
      this.selectionRect!.setAttrs({
        x: pos?.x ?? 0, y: pos?.y ?? 0, width: 0, height: 0, visible: true,
      });
      interactionLayer.draw();
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
      interactionLayer.draw();

      // Only bother if the user dragged more than a tiny amount (not just a click)
      const sw = this.selectionRect!.width();
      const sh = this.selectionRect!.height();
      if (sw < 4 && sh < 4) return;

      // Compare everything in the markupLayer's coordinate space to avoid
      // any issues with stage scale / position affecting getClientRect().
      const selBox = {
        x: this.selectionRect!.x(),
        y: this.selectionRect!.y(),
        width: sw,
        height: sh,
      };

      const selected = markupLayer.find('.markup').filter((node) => {
        const nb = node.getClientRect({ relativeTo: markupLayer });
        return (
          nb.x < selBox.x + selBox.width &&
          nb.x + nb.width > selBox.x &&
          nb.y < selBox.y + selBox.height &&
          nb.y + nb.height > selBox.y
        );
      });

      if (selected.length > 0) {
        this.transformer!.nodes(selected as Konva.Shape[]);
        if (selected.length === 1) appState.setSelection(selected[0].id());
        else appState.setMultiSelection(selected.map(n => n.id()));
      }
      interactionLayer.draw();
    });

    // Listen for transformer changes (move/resize)
    this.transformer.on('transformstart dragstart', () => {
      // Snapshot BEFORE the operation so it can be fully undone.
      appState.emit('markup-transform-start');
    });

    this.transformer.on('transformend', () => {
      const nodes = this.transformer!.nodes();
      nodes.forEach((node) => {
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

  /**
   * Re-attach the Transformer to a single node that was just recreated
   * (e.g. after a style update rebuilt the Konva node for the selected markup).
   */
  refreshTransformerForNode(id: string): void {
    this.refreshTransformerForNodes([id]);
  }

  /**
   * Re-attach the Transformer to all nodes in `ids` (used after a multi-select
   * style update rebuilds several Konva nodes simultaneously).
   */
  refreshTransformerForNodes(ids: string[]): void {
    if (!this.transformer) return;
    const nodes = ids
      .map(id => this.ctx.stageManager.findNode(id))
      .filter(Boolean) as Konva.Shape[];
    if (nodes.length > 0) {
      this.transformer.nodes(nodes);
      this.ctx.stageManager.interactionLayer.draw();
    }
  }
}

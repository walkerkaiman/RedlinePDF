import Konva from 'konva';
import { BaseTool, type ToolContext } from './baseTool.ts';
import { konvaRectToPdf } from '../geometry/transform.ts';
import { generateId } from '../model/document.ts';
import type { RectMarkup } from '../model/document.ts';

export class RectTool extends BaseTool {
  private isDrawing = false;
  private startPos = { x: 0, y: 0 };
  private previewRect: Konva.Rect | null = null;

  constructor(ctx: ToolContext) {
    super('rect', ctx);
  }

  activate(): void {
    const { stage, interactionLayer } = this.ctx.stageManager;
    stage.container().style.cursor = 'crosshair';

    stage.on('mousedown.rect touchstart.rect', () => {
      const pos = this.ctx.stageManager.getLayerPointer();
      if (!pos) return;
      this.isDrawing = true;
      this.startPos = { ...pos };
      const style = this.ctx.getStyle();
      this.previewRect = new Konva.Rect({
        x: pos.x, y: pos.y, width: 0, height: 0,
        stroke: style.strokeColor ?? '#e63946',
        strokeWidth: style.strokeWidth ?? 2,
        opacity: style.strokeOpacity ?? 1,
        fill: 'transparent',
      });
      interactionLayer.add(this.previewRect);
    });

    stage.on('mousemove.rect touchmove.rect', () => {
      if (!this.isDrawing || !this.previewRect) return;
      const pos = this.ctx.stageManager.getLayerPointer();
      if (!pos) return;
      const x = Math.min(pos.x, this.startPos.x);
      const y = Math.min(pos.y, this.startPos.y);
      const w = Math.abs(pos.x - this.startPos.x);
      const h = Math.abs(pos.y - this.startPos.y);
      this.previewRect.setAttrs({ x, y, width: w, height: h });
      interactionLayer.draw();
    });

    stage.on('mouseup.rect touchend.rect', () => {
      if (!this.isDrawing || !this.previewRect) return;
      this.isDrawing = false;

      const pos = this.ctx.stageManager.getLayerPointer();
      if (!pos) { this.previewRect.destroy(); this.previewRect = null; return; }

      const x = Math.min(pos.x, this.startPos.x);
      const y = Math.min(pos.y, this.startPos.y);
      const w = Math.abs(pos.x - this.startPos.x);
      const h = Math.abs(pos.y - this.startPos.y);

      this.previewRect.destroy();
      this.previewRect = null;

      if (w < 4 || h < 4) return;

      const pdfRect = konvaRectToPdf(x, y, w, h, this.ctx.getPageHeightPts());
      const markup: RectMarkup = {
        id: generateId(),
        type: 'rect',
        pageIndex: this.ctx.getPageIndex(),
        style: { ...this.ctx.getStyle() },
        ...pdfRect,
      };
      this.ctx.onMarkupAdd(markup);
    });
  }

  deactivate(): void {
    const { stage } = this.ctx.stageManager;
    stage.off('mousedown.rect touchstart.rect');
    stage.off('mousemove.rect touchmove.rect');
    stage.off('mouseup.rect touchend.rect');
    stage.container().style.cursor = 'default';
    if (this.previewRect) { this.previewRect.destroy(); this.previewRect = null; }
    this.isDrawing = false;
  }
}

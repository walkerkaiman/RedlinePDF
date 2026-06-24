import Konva from 'konva';
import { BaseTool, type ToolContext } from './baseTool.ts';
import { konvaToPdf } from '../geometry/transform.ts';
import { generateId } from '../model/document.ts';
import type { EllipseMarkup } from '../model/document.ts';

export class EllipseTool extends BaseTool {
  private isDrawing = false;
  private startPos = { x: 0, y: 0 };
  private previewEllipse: Konva.Ellipse | null = null;

  constructor(ctx: ToolContext) {
    super('ellipse', ctx);
  }

  activate(): void {
    const { stage, interactionLayer } = this.ctx.stageManager;
    stage.container().style.cursor = 'crosshair';

    stage.on('mousedown.ellipse touchstart.ellipse', () => {
      const pos = this.ctx.stageManager.getLayerPointer();
      if (!pos) return;
      this.isDrawing = true;
      this.startPos = { ...pos };
      const style = this.ctx.getStyle();
      this.previewEllipse = new Konva.Ellipse({
        x: pos.x, y: pos.y, radiusX: 0, radiusY: 0,
        stroke: style.strokeColor ?? '#e63946',
        strokeWidth: style.strokeWidth ?? 2,
        opacity: style.strokeOpacity ?? 1,
        fill: 'transparent',
      });
      interactionLayer.add(this.previewEllipse);
    });

    stage.on('mousemove.ellipse touchmove.ellipse', () => {
      if (!this.isDrawing || !this.previewEllipse) return;
      const pos = this.ctx.stageManager.getLayerPointer();
      if (!pos) return;
      const rx = Math.abs(pos.x - this.startPos.x) / 2;
      const ry = Math.abs(pos.y - this.startPos.y) / 2;
      const cx = (this.startPos.x + pos.x) / 2;
      const cy = (this.startPos.y + pos.y) / 2;
      this.previewEllipse.setAttrs({ x: cx, y: cy, radiusX: rx, radiusY: ry });
      interactionLayer.draw();
    });

    stage.on('mouseup.ellipse touchend.ellipse', () => {
      if (!this.isDrawing || !this.previewEllipse) return;
      this.isDrawing = false;

      const pos = this.ctx.stageManager.getLayerPointer();
      if (!pos) { this.previewEllipse.destroy(); this.previewEllipse = null; return; }

      const rx = Math.abs(pos.x - this.startPos.x) / 2;
      const ry = Math.abs(pos.y - this.startPos.y) / 2;

      this.previewEllipse.destroy();
      this.previewEllipse = null;

      if (rx < 4 || ry < 4) return;

      const cx = (this.startPos.x + pos.x) / 2;
      const cy = (this.startPos.y + pos.y) / 2;
      const h = this.ctx.getPageHeightPts();
      const pdfCenter = konvaToPdf(cx, cy, h);

      const markup: EllipseMarkup = {
        id: generateId(),
        type: 'ellipse',
        pageIndex: this.ctx.getPageIndex(),
        style: { ...this.ctx.getStyle() },
        cx: pdfCenter.x, cy: pdfCenter.y, rx, ry,
      };
      this.ctx.onMarkupAdd(markup);
    });
  }

  deactivate(): void {
    const { stage } = this.ctx.stageManager;
    stage.off('mousedown.ellipse touchstart.ellipse');
    stage.off('mousemove.ellipse touchmove.ellipse');
    stage.off('mouseup.ellipse touchend.ellipse');
    stage.container().style.cursor = 'default';
    if (this.previewEllipse) { this.previewEllipse.destroy(); this.previewEllipse = null; }
    this.isDrawing = false;
  }
}

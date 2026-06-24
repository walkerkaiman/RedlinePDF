import Konva from 'konva';
import { BaseTool, type ToolContext } from './baseTool.ts';
import { konvaToPdf } from '../geometry/transform.ts';
import { generateId } from '../model/document.ts';
import type { EllipseMarkup } from '../model/document.ts';

export class EllipseTool extends BaseTool {
  private isDrawing = false;
  private centerPos = { x: 0, y: 0 };
  private previewEllipse: Konva.Ellipse | null = null;
  /** Small cross-hair lines rendered at the center while dragging */
  private centerMark: Konva.Line | null = null;

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
      this.centerPos = { ...pos };
      const style = this.ctx.getStyle();

      this.previewEllipse = new Konva.Ellipse({
        x: pos.x, y: pos.y, radiusX: 0, radiusY: 0,
        stroke: style.strokeColor ?? '#e63946',
        strokeWidth: style.strokeWidth ?? 2,
        opacity: style.strokeOpacity ?? 1,
        fill: 'transparent',
      });

      // Small cross-hair to mark the center point while dragging
      const T = 6;
      this.centerMark = new Konva.Line({
        points: [pos.x - T, pos.y, pos.x + T, pos.y, NaN, NaN, pos.x, pos.y - T, pos.x, pos.y + T],
        stroke: style.strokeColor ?? '#e63946',
        strokeWidth: 1,
        opacity: 0.6,
      });

      interactionLayer.add(this.previewEllipse, this.centerMark);
    });

    stage.on('mousemove.ellipse touchmove.ellipse', () => {
      if (!this.isDrawing || !this.previewEllipse) return;
      const pos = this.ctx.stageManager.getLayerPointer();
      if (!pos) return;
      const dx = pos.x - this.centerPos.x;
      const dy = pos.y - this.centerPos.y;
      const radius = Math.sqrt(dx * dx + dy * dy);
      this.previewEllipse.setAttrs({ radiusX: radius, radiusY: radius });
      interactionLayer.draw();
    });

    stage.on('mouseup.ellipse touchend.ellipse', () => {
      if (!this.isDrawing || !this.previewEllipse) return;
      this.isDrawing = false;

      const pos = this.ctx.stageManager.getLayerPointer();

      this.previewEllipse.destroy();
      this.previewEllipse = null;
      this.centerMark?.destroy();
      this.centerMark = null;

      if (!pos) return;

      const dx = pos.x - this.centerPos.x;
      const dy = pos.y - this.centerPos.y;
      const radius = Math.sqrt(dx * dx + dy * dy);

      if (radius < 4) return;

      const h = this.ctx.getPageHeightPts();
      const pdfCenter = konvaToPdf(this.centerPos.x, this.centerPos.y, h);

      const markup: EllipseMarkup = {
        id: generateId(),
        type: 'ellipse',
        pageIndex: this.ctx.getPageIndex(),
        style: { ...this.ctx.getStyle() },
        cx: pdfCenter.x,
        cy: pdfCenter.y,
        rx: radius,
        ry: radius,
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
    if (this.centerMark) { this.centerMark.destroy(); this.centerMark = null; }
    this.isDrawing = false;
  }
}

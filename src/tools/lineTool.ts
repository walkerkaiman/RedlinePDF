import Konva from 'konva';
import { BaseTool, type ToolContext } from './baseTool.ts';
import { konvaToPdf } from '../geometry/transform.ts';
import { generateId } from '../model/document.ts';
import type { LineMarkup } from '../model/document.ts';

export class LineTool extends BaseTool {
  private isDrawing = false;
  private startPos = { x: 0, y: 0 };
  private previewLine: Konva.Line | null = null;

  constructor(ctx: ToolContext) {
    super('line', ctx);
  }

  activate(): void {
    const { stage, interactionLayer } = this.ctx.stageManager;
    stage.container().style.cursor = 'crosshair';

    stage.on('mousedown.line touchstart.line', () => {
      const pos = this.ctx.stageManager.getLayerPointer();
      if (!pos) return;
      this.isDrawing = true;
      this.startPos = { ...pos };
      const style = this.ctx.getStyle();
      this.previewLine = new Konva.Line({
        points: [pos.x, pos.y, pos.x, pos.y],
        stroke: style.strokeColor ?? '#e63946',
        strokeWidth: style.strokeWidth ?? 2,
        opacity: style.strokeOpacity ?? 1,
        lineCap: 'round',
      });
      interactionLayer.add(this.previewLine);
    });

    stage.on('mousemove.line touchmove.line', () => {
      if (!this.isDrawing || !this.previewLine) return;
      const pos = this.ctx.stageManager.getLayerPointer();
      if (!pos) return;
      this.previewLine.points([this.startPos.x, this.startPos.y, pos.x, pos.y]);
      interactionLayer.draw();
    });

    stage.on('mouseup.line touchend.line', () => {
      if (!this.isDrawing || !this.previewLine) return;
      this.isDrawing = false;
      this.previewLine.destroy();
      this.previewLine = null;

      const pos = this.ctx.stageManager.getLayerPointer();
      if (!pos) return;

      const h = this.ctx.getPageHeightPts();
      const p1 = konvaToPdf(this.startPos.x, this.startPos.y, h);
      const p2 = konvaToPdf(pos.x, pos.y, h);

      if (Math.abs(p2.x - p1.x) < 2 && Math.abs(p2.y - p1.y) < 2) return;

      const markup: LineMarkup = {
        id: generateId(),
        type: 'line',
        pageIndex: this.ctx.getPageIndex(),
        style: { ...this.ctx.getStyle() },
        x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
      };
      this.ctx.onMarkupAdd(markup);
    });
  }

  deactivate(): void {
    const { stage } = this.ctx.stageManager;
    stage.off('mousedown.line touchstart.line');
    stage.off('mousemove.line touchmove.line');
    stage.off('mouseup.line touchend.line');
    stage.container().style.cursor = 'default';
    if (this.previewLine) { this.previewLine.destroy(); this.previewLine = null; }
    this.isDrawing = false;
  }
}

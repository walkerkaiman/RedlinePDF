import Konva from 'konva';
import { BaseTool, type ToolContext } from './baseTool.ts';
import { konvaPointsToPdf } from '../geometry/transform.ts';
import { generateId } from '../model/document.ts';
import type { PenMarkup } from '../model/document.ts';

export class PenTool extends BaseTool {
  private isDrawing = false;
  private currentLine: Konva.Line | null = null;
  private currentPoints: number[] = [];

  constructor(ctx: ToolContext) {
    super('pen', ctx);
  }

  activate(): void {
    const { stage, interactionLayer } = this.ctx.stageManager;
    stage.container().style.cursor = 'crosshair';

    stage.on('mousedown.pen touchstart.pen', () => {
      const pos = this.ctx.stageManager.getLayerPointer();
      if (!pos) return;
      this.isDrawing = true;
      this.currentPoints = [pos.x, pos.y];
      const style = this.ctx.getStyle();
      this.currentLine = new Konva.Line({
        points: [...this.currentPoints],
        stroke: style.strokeColor ?? '#e63946',
        strokeWidth: style.strokeWidth ?? 2,
        opacity: style.strokeOpacity ?? 1,
        tension: 0.3,
        lineCap: 'round',
        lineJoin: 'round',
      });
      interactionLayer.add(this.currentLine);
    });

    stage.on('mousemove.pen touchmove.pen', () => {
      if (!this.isDrawing || !this.currentLine) return;
      const pos = this.ctx.stageManager.getLayerPointer();
      if (!pos) return;
      this.currentPoints.push(pos.x, pos.y);
      this.currentLine.points([...this.currentPoints]);
      interactionLayer.draw();
    });

    stage.on('mouseup.pen touchend.pen', () => {
      if (!this.isDrawing || !this.currentLine) return;
      this.isDrawing = false;
      this.currentLine.destroy();
      this.currentLine = null;

      if (this.currentPoints.length < 4) { this.currentPoints = []; return; }

      const pdfPoints = konvaPointsToPdf(this.currentPoints, this.ctx.getPageHeightPts());
      const markup: PenMarkup = {
        id: generateId(),
        type: 'pen',
        pageIndex: this.ctx.getPageIndex(),
        style: { ...this.ctx.getStyle() },
        points: pdfPoints,
      };
      this.ctx.onMarkupAdd(markup);
      this.currentPoints = [];
    });
  }

  deactivate(): void {
    const { stage } = this.ctx.stageManager;
    stage.off('mousedown.pen touchstart.pen');
    stage.off('mousemove.pen touchmove.pen');
    stage.off('mouseup.pen touchend.pen');
    stage.container().style.cursor = 'default';
    if (this.currentLine) { this.currentLine.destroy(); this.currentLine = null; }
    this.isDrawing = false;
  }
}

import Konva from 'konva';
import { BaseTool, type ToolContext } from './baseTool.ts';
import { konvaToPdf } from '../geometry/transform.ts';
import { generateId } from '../model/document.ts';
import type { ArrowMarkup } from '../model/document.ts';

export class ArrowTool extends BaseTool {
  private isDrawing = false;
  private startPos = { x: 0, y: 0 };
  private previewArrow: Konva.Arrow | null = null;

  constructor(ctx: ToolContext) {
    super('arrow', ctx);
  }

  activate(): void {
    const { stage, interactionLayer } = this.ctx.stageManager;
    stage.container().style.cursor = 'crosshair';

    stage.on('mousedown.arrow touchstart.arrow', () => {
      const pos = this.ctx.stageManager.getLayerPointer();
      if (!pos) return;
      this.isDrawing = true;
      this.startPos = { ...pos };
      const style = this.ctx.getStyle();
      const sw = style.strokeWidth ?? 2;
      this.previewArrow = new Konva.Arrow({
        points: [pos.x, pos.y, pos.x, pos.y],
        stroke: style.strokeColor ?? '#e63946',
        strokeWidth: sw,
        opacity: style.strokeOpacity ?? 1,
        fill: style.strokeColor ?? '#e63946',
        pointerLength: Math.max(10, sw * 4),
        pointerWidth: Math.max(8, sw * 3),
        lineCap: 'round',
      });
      interactionLayer.add(this.previewArrow);
    });

    stage.on('mousemove.arrow touchmove.arrow', () => {
      if (!this.isDrawing || !this.previewArrow) return;
      const pos = this.ctx.stageManager.getLayerPointer();
      if (!pos) return;
      this.previewArrow.points([this.startPos.x, this.startPos.y, pos.x, pos.y]);
      interactionLayer.draw();
    });

    stage.on('mouseup.arrow touchend.arrow', () => {
      if (!this.isDrawing || !this.previewArrow) return;
      this.isDrawing = false;
      this.previewArrow.destroy();
      this.previewArrow = null;

      const pos = this.ctx.stageManager.getLayerPointer();
      if (!pos) return;

      const h = this.ctx.getPageHeightPts();
      const p1 = konvaToPdf(this.startPos.x, this.startPos.y, h);
      const p2 = konvaToPdf(pos.x, pos.y, h);

      if (Math.abs(p2.x - p1.x) < 2 && Math.abs(p2.y - p1.y) < 2) return;

      const markup: ArrowMarkup = {
        id: generateId(),
        type: 'arrow',
        pageIndex: this.ctx.getPageIndex(),
        style: { ...this.ctx.getStyle() },
        x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
      };
      this.ctx.onMarkupAdd(markup);
    });
  }

  deactivate(): void {
    const { stage } = this.ctx.stageManager;
    stage.off('mousedown.arrow touchstart.arrow');
    stage.off('mousemove.arrow touchmove.arrow');
    stage.off('mouseup.arrow touchend.arrow');
    stage.container().style.cursor = 'default';
    if (this.previewArrow) { this.previewArrow.destroy(); this.previewArrow = null; }
    this.isDrawing = false;
  }
}

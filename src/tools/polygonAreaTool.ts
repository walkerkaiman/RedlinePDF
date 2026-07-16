import Konva from 'konva';
import { BaseTool, type ToolContext } from './baseTool.ts';
import { konvaToPdf, polygonArea, polygonPerimeter, distance } from '../geometry/transform.ts';
import { generateId } from '../model/document.ts';
import type { PolygonAreaMarkup, Point } from '../model/document.ts';

export class PolygonAreaTool extends BaseTool {
  private vertices: Point[] = []; // Konva space
  private lines: Konva.Line[] = [];
  private dots: Konva.Circle[] = [];
  private polygon: Konva.Line | null = null; // filled preview polygon
  private closingLine: Konva.Line | null = null;
  private instructions: Konva.Text | null = null;

  constructor(ctx: ToolContext) {
    super('polygon-area', ctx);
  }

  activate(): void {
    const { stage, interactionLayer } = this.ctx.stageManager;
    stage.container().style.cursor = 'crosshair';

    // Instructions text
    this.instructions = new Konva.Text({
      x: 10, y: 10,
      text: 'Click to place vertices · Double-click or Enter to close · Esc to cancel',
      fontSize: 11, fontFamily: 'Arial', fill: '#0077cc',
      padding: 4,
    });
    const instrBg = new Konva.Rect({
      x: 7, y: 7,
      width: this.instructions.width() + 8,
      height: this.instructions.height() + 8,
      fill: 'rgba(255,255,255,0.9)', cornerRadius: 4,
    });
    interactionLayer.add(instrBg, this.instructions);

    stage.on('click.mpolygon tap.mpolygon', (e) => {
      const pos = this.ctx.stageManager.getLayerPointer();
      if (!pos) return;

      // Double-click closes the polygon
      if (e.evt.type === 'dblclick' || (e.evt as MouseEvent).detail === 2) {
        this.finalizePolygon();
        return;
      }

      // If clicking near first vertex (within 10px), close
      if (this.vertices.length >= 3) {
        const first = this.vertices[0];
        const d = distance(pos, first);
        const scale = this.ctx.stageManager.stage.scaleX();
        if (d * scale < 12) {
          this.finalizePolygon();
          return;
        }
      }

      // Add vertex
      this.addVertex(pos);
    });

    stage.on('mousemove.mpolygon touchmove.mpolygon', () => {
      if (this.vertices.length === 0 || !this.closingLine) return;
      const pos = this.ctx.stageManager.getLayerPointer();
      if (!pos) return;
      const last = this.vertices[this.vertices.length - 1];
      this.closingLine.points([last.x, last.y, pos.x, pos.y]);

      // Update filled preview polygon
      if (this.polygon && this.vertices.length >= 2) {
        const points = this.vertices.map(v => [v.x, v.y]).flat() as number[];
        points.push(pos.x, pos.y);
        this.polygon.points(points);
      }

      interactionLayer.draw();
    });

    // Keyboard shortcuts
    this._onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); this.finalizePolygon(); }
      if (e.key === 'Escape') { e.preventDefault(); this.clearPreview(); }
    };
    window.addEventListener('keydown', this._onKeyDown);

    interactionLayer.draw();
  }

  private _onKeyDown: ((e: KeyboardEvent) => void) | null = null;

  private addVertex(pos: Point): void {
    const { interactionLayer } = this.ctx.stageManager;
    this.vertices.push({ ...pos });

    // Add vertex dot
    const dot = new Konva.Circle({ x: pos.x, y: pos.y, radius: 5, fill: '#0077cc', stroke: '#fff', strokeWidth: 1 });
    this.dots.push(dot);
    interactionLayer.add(dot);

    // Add connecting line (only if we have at least 2 vertices)
    if (this.vertices.length >= 2) {
      const prev = this.vertices[this.vertices.length - 2];
      const line = new Konva.Line({
        points: [prev.x, prev.y, pos.x, pos.y],
        stroke: '#0077cc', strokeWidth: 1.5, dash: [6, 3],
      });
      this.lines.push(line);
      interactionLayer.add(line);
    }

    // Create the filled preview polygon (appears once we have >= 3 vertices)
    if (this.polygon) this.polygon.destroy();
    
    if (this.vertices.length >= 3) {
      const points = this.vertices.map(v => [v.x, v.y]).flat() as number[];
      // Add current cursor position to show preview while drawing
      const pointerPos = interactionLayer.getRelativePointerPosition();
      if (pointerPos) {
        points.push(pointerPos.x, pointerPos.y);
      }
      
      this.polygon = new Konva.Line({
        points: points,
        closed: true,
        stroke: '#0077cc',
        strokeWidth: 1.5,
        fill: 'rgba(0,119,204,0.08)',
        dash: [6, 3],
      });
      interactionLayer.add(this.polygon);
    }

    // Create/update the dynamic cursor-tracking line (last vertex to cursor)
    if (this.closingLine) this.closingLine.destroy();
    this.closingLine = new Konva.Line({
      points: [pos.x, pos.y, pos.x, pos.y],
      stroke: '#0077cc', strokeWidth: 1.5, dash: [4, 4], opacity: 0.6,
    });
    interactionLayer.add(this.closingLine);

    interactionLayer.draw();
  }

  private finalizePolygon(): void {
    if (this.vertices.length < 3) { this.clearPreview(); return; }

    const h = this.ctx.stageManager.pageHeightPts;
    const pdfPoints = this.vertices.map(v => konvaToPdf(v.x, v.y, h));

    const markup: PolygonAreaMarkup = {
      id: generateId(),
      type: 'polygon-area',
      pageIndex: this.ctx.getPageIndex(),
      style: { strokeColor: '#0077cc', strokeWidth: 1.5, fillColor: '#0077cc', fillOpacity: 0.08 },
      points: pdfPoints,
    };

    this.clearPreview();
    this.ctx.onMarkupAdd(markup);
  }

  private clearPreview(): void {
    this.vertices = [];
    this.lines.forEach(l => l.destroy());
    this.lines = [];
    this.dots.forEach(d => d.destroy());
    this.dots = [];
    if (this.polygon) { this.polygon.destroy(); this.polygon = null; }
    if (this.closingLine) { this.closingLine.destroy(); this.closingLine = null; }
    if (this.instructions) { 
      this.instructions.destroy(); 
      this.instructions = null; 
    }
    const instrBg = this.ctx.stageManager.interactionLayer.findOne('Rect');
    if (instrBg) instrBg.destroy();
    this.ctx.stageManager.interactionLayer.draw();
  }

  deactivate(): void {
    const { stage } = this.ctx.stageManager;
    stage.off('click.mpolygon tap.mpolygon');
    stage.off('mousemove.mpolygon touchmove.mpolygon');
    stage.container().style.cursor = 'default';
    if (this._onKeyDown) { 
      window.removeEventListener('keydown', this._onKeyDown); 
      this._onKeyDown = null; 
    }
    this.clearPreview();
  }
}

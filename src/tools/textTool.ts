import Konva from 'konva';
import { BaseTool, type ToolContext } from './baseTool.ts';
import { konvaRectToPdf, pdfRectToKonva } from '../geometry/transform.ts';
import { generateId } from '../model/document.ts';
import type { TextMarkup } from '../model/document.ts';
import { hexWithOpacity } from '../canvas/stage.ts';

export class TextTool extends BaseTool {
  private isDrawing = false;
  private startPos = { x: 0, y: 0 };
  private previewRect: Konva.Rect | null = null;
  private textarea: HTMLTextAreaElement | null = null;

  constructor(ctx: ToolContext) {
    super('text', ctx);
  }

  activate(): void {
    const { stage, interactionLayer } = this.ctx.stageManager;
    stage.container().style.cursor = 'text';

    stage.on('mousedown.text touchstart.text', () => {
      if (this.textarea) return; // Already editing
      const pos = this.ctx.stageManager.getLayerPointer();
      if (!pos) return;
      this.isDrawing = true;
      this.startPos = { ...pos };
      const style = this.ctx.getStyle();
      this.previewRect = new Konva.Rect({
        x: pos.x, y: pos.y, width: 0, height: 0,
        stroke: style.strokeColor ?? '#e63946',
        strokeWidth: 1,
        dash: [4, 2],
        fill: hexWithOpacity(style.bgColor ?? '#ffffff', (style.bgOpacity ?? 0.8) * 0.5),
      });
      interactionLayer.add(this.previewRect);
    });

    stage.on('mousemove.text touchmove.text', () => {
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

    stage.on('mouseup.text touchend.text', () => {
      if (!this.isDrawing || !this.previewRect) return;
      this.isDrawing = false;

      const pos = this.ctx.stageManager.getLayerPointer();
      if (!pos) { this.previewRect.destroy(); this.previewRect = null; return; }

      const kx = Math.min(pos.x, this.startPos.x);
      const ky = Math.min(pos.y, this.startPos.y);
      const kw = Math.abs(pos.x - this.startPos.x);
      const kh = Math.abs(pos.y - this.startPos.y);

      this.previewRect.destroy();
      this.previewRect = null;

      // Minimum size for text box
      const minW = Math.max(kw, 80);
      const minH = Math.max(kh, 30);

      this.showTextEditor(kx, ky, minW, minH);
    });
  }

  private showTextEditor(kx: number, ky: number, kw: number, kh: number): void {
    const { stage } = this.ctx.stageManager;
    const style = this.ctx.getStyle();
    const stageBox = stage.container().getBoundingClientRect();
    const scale = stage.scaleX();
    const stagePos = stage.position();

    // Position textarea absolutely over the Konva canvas region
    const screenX = stageBox.left + kx * scale + stagePos.x;
    const screenY = stageBox.top + ky * scale + stagePos.y;

    const ta = document.createElement('textarea');
    ta.style.cssText = `
      position: fixed;
      left: ${screenX}px;
      top: ${screenY}px;
      width: ${kw * scale}px;
      min-height: ${kh * scale}px;
      font-size: ${(style.fontSize ?? 12) * scale}px;
      font-family: ${style.fontFamily ?? 'Arial'};
      font-weight: ${style.bold ? 'bold' : 'normal'};
      font-style: ${style.italic ? 'italic' : 'normal'};
      color: ${style.textColor ?? '#e63946'};
      background: ${hexWithOpacity(style.bgColor ?? '#ffffff', style.bgOpacity ?? 0.8)};
      border: 1.5px dashed ${style.strokeColor ?? '#e63946'};
      border-radius: 2px;
      padding: 4px;
      resize: both;
      outline: none;
      z-index: 9999;
      box-sizing: border-box;
      line-height: 1.4;
    `;
    ta.placeholder = 'Type text here...';
    document.body.appendChild(ta);
    ta.focus();
    this.textarea = ta;

    const finish = () => {
      const text = ta.value.trim();
      ta.remove();
      this.textarea = null;

      if (!text) return;

      // Compute actual rendered size
      const actualW = ta.offsetWidth / scale;
      const actualH = ta.offsetHeight / scale;

      const pdfRect = konvaRectToPdf(kx, ky, Math.max(kw, actualW), Math.max(kh, actualH), this.ctx.getPageHeightPts());

      const markup: TextMarkup = {
        id: generateId(),
        type: 'text',
        pageIndex: this.ctx.getPageIndex(),
        style: { ...this.ctx.getStyle() },
        ...pdfRect,
        text,
      };
      this.ctx.onMarkupAdd(markup);
    };

    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        ta.remove();
        this.textarea = null;
      }
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        finish();
      }
    });
    ta.addEventListener('blur', finish);
  }

  /** Open inline editor for an existing TextMarkup */
  editExisting(markup: TextMarkup): void {
    const h = this.ctx.getPageHeightPts();
    const kr = pdfRectToKonva(markup.x, markup.y, markup.width, markup.height, h);
    const node = this.ctx.stageManager.findNode(markup.id);
    if (node) node.visible(false);

    const { stage } = this.ctx.stageManager;
    const style = markup.style;
    const scale = stage.scaleX();
    const stagePos = stage.position();
    const stageBox = stage.container().getBoundingClientRect();

    const screenX = stageBox.left + kr.x * scale + stagePos.x;
    const screenY = stageBox.top + kr.y * scale + stagePos.y;

    const ta = document.createElement('textarea');
    ta.value = markup.text;
    ta.style.cssText = `
      position: fixed;
      left: ${screenX}px;
      top: ${screenY}px;
      width: ${kr.width * scale}px;
      min-height: ${kr.height * scale}px;
      font-size: ${(style.fontSize ?? 12) * scale}px;
      font-family: ${style.fontFamily ?? 'Arial'};
      color: ${style.textColor ?? '#e63946'};
      background: ${hexWithOpacity(style.bgColor ?? '#ffffff', style.bgOpacity ?? 0.8)};
      border: 1.5px dashed ${style.strokeColor ?? '#e63946'};
      border-radius: 2px;
      padding: 4px;
      resize: both;
      outline: none;
      z-index: 9999;
      box-sizing: border-box;
    `;
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    this.textarea = ta;

    const finish = () => {
      const text = ta.value.trim();
      ta.remove();
      this.textarea = null;
      if (node) node.visible(true);
      if (text !== markup.text) {
        this.ctx.onMarkupUpdate(markup.id, { text } as Partial<TextMarkup>);
      }
    };

    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { ta.remove(); this.textarea = null; if (node) node.visible(true); }
      if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); finish(); }
    });
    ta.addEventListener('blur', finish);
  }

  deactivate(): void {
    const { stage } = this.ctx.stageManager;
    stage.off('mousedown.text touchstart.text');
    stage.off('mousemove.text touchmove.text');
    stage.off('mouseup.text touchend.text');
    stage.container().style.cursor = 'default';
    if (this.previewRect) { this.previewRect.destroy(); this.previewRect = null; }
    if (this.textarea) { this.textarea.remove(); this.textarea = null; }
    this.isDrawing = false;
  }
}

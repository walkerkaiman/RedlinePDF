import Konva from 'konva';
import { BaseTool, type ToolContext } from './baseTool.ts';
import { konvaToPdf } from '../geometry/transform.ts';
import { generateId } from '../model/document.ts';
import type { TextMarkup } from '../model/document.ts';
import { hexWithOpacity } from '../canvas/stage.ts';
import { appState } from '../state/appState.ts';

export class TextTool extends BaseTool {
  private editor: HTMLTextAreaElement | null = null;
  private mirror: HTMLSpanElement | null = null;

  constructor(ctx: ToolContext) {
    super('text', ctx);
  }

  activate(): void {
    const { stage } = this.ctx.stageManager;
    stage.container().style.cursor = 'text';

    // Double-clicking an existing text markup opens it for editing
    stage.on('dblclick.text dbltap.text', (e) => {
      let walk: import('konva').default.Node | null = e.target;
      while (walk && walk !== stage) {
        if (walk.hasName('markup')) break;
        walk = walk.getParent?.() ?? null;
      }
      if (!walk || !walk.hasName('markup')) return;
      appState.emit('cmd-text-edit', { id: walk.id() });
      e.cancelBubble = true;
    });

    stage.on('mousedown.text touchstart.text', (e) => {
      if (this.editor) return;
      // Clicking on an existing markup → don't create a new box
      let walk: import('konva').default.Node | null = e.target;
      while (walk && walk !== stage) {
        if (walk.hasName('markup')) return;
        walk = walk.getParent?.() ?? null;
      }
      const pos = this.ctx.stageManager.getLayerPointer();
      if (!pos) return;
      this.openNewEditor(pos.x, pos.y);
    });
  }

  // ── New text box ────────────────────────────────────────────────────────────

  private openNewEditor(kx: number, ky: number): void {
    const { stage } = this.ctx.stageManager;
    const style = this.ctx.getStyle();
    const scale = stage.scaleX();
    const stagePos = stage.position();
    const stageBox = stage.container().getBoundingClientRect();
    const screenX = stageBox.left + kx * scale + stagePos.x;
    const screenY = stageBox.top + ky * scale + stagePos.y;

    const ta = this.createTextarea({
      screenX, screenY, scale,
      fontFamily: style.fontFamily ?? 'Arial',
      fontSize: style.fontSize ?? 12,
      bold: style.bold ?? false,
      italic: style.italic ?? false,
      textColor: style.textColor ?? '#e63946',
      bgColor: hexWithOpacity(style.bgColor ?? '#ffffff', style.bgOpacity ?? 0.8),
      borderColor: style.strokeColor ?? '#e63946',
    });

    const finish = (e?: Event) => {
      if (e) e.preventDefault();
      const text = ta.value.trim();
      // Capture dimensions before removal
      const screenW = ta.offsetWidth;
      const screenH = ta.offsetHeight;
      this.destroyEditor();
      if (!text) return;

      const kw = screenW / scale;
      const kh = screenH / scale;
      const pdfPos = konvaToPdf(kx, ky, this.ctx.getPageHeightPts());
      // Store position only; Konva re-derives size from content on render
      const markup: TextMarkup = {
        id: generateId(),
        type: 'text',
        pageIndex: this.ctx.getPageIndex(),
        style: { ...this.ctx.getStyle() },
        x: pdfPos.x, y: pdfPos.y,
        width: kw, height: kh,
        text,
      };
      this.ctx.onMarkupAdd(markup);
    };

    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { this.destroyEditor(); }
      if (e.key === 'Enter' && e.shiftKey) finish(e);
    });
    ta.addEventListener('blur', finish);
  }

  // ── Edit existing text box ─────────────────────────────────────────────────

  editExisting(markup: TextMarkup): void {
    const { stage } = this.ctx.stageManager;
    const style = markup.style;
    const scale = stage.scaleX();
    const stagePos = stage.position();
    const stageBox = stage.container().getBoundingClientRect();
    const h = this.ctx.getPageHeightPts();

    // Convert PDF position back to screen coords
    // (use the Konva node's position if available for accuracy)
    const node = stage.findOne(`#${markup.id}`);
    const kx = node ? node.x() : 0;
    const ky = node ? node.y() : 0;
    const screenX = stageBox.left + kx * scale + stagePos.x;
    const screenY = stageBox.top + ky * scale + stagePos.y;

    if (node) node.visible(false);

    const ta = this.createTextarea({
      screenX, screenY, scale,
      fontFamily: style.fontFamily ?? 'Arial',
      fontSize: style.fontSize ?? 12,
      bold: style.bold ?? false,
      italic: style.italic ?? false,
      textColor: style.textColor ?? '#e63946',
      bgColor: hexWithOpacity(style.bgColor ?? '#ffffff', style.bgOpacity ?? 0.8),
      borderColor: style.strokeColor ?? '#e63946',
      initialValue: markup.text,
    });

    const finish = (e?: Event) => {
      if (e) e.preventDefault();
      const text = ta.value.trim();
      this.destroyEditor();
      if (node) node.visible(true);
      if (text !== markup.text) {
        const pdfPos = konvaToPdf(kx, ky, h);
        this.ctx.onMarkupUpdate(markup.id, { text, x: pdfPos.x, y: pdfPos.y } as Partial<TextMarkup>);
      }
    };

    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { this.destroyEditor(); if (node) node.visible(true); }
      if (e.key === 'Enter' && e.shiftKey) finish(e);
    });
    ta.addEventListener('blur', finish);

    ta.focus();
    ta.select();
  }

  // ── Shared textarea factory ────────────────────────────────────────────────

  private createTextarea(opts: {
    screenX: number; screenY: number; scale: number;
    fontFamily: string; fontSize: number; bold: boolean; italic: boolean;
    textColor: string; bgColor: string; borderColor: string;
    initialValue?: string;
  }): HTMLTextAreaElement {
    const { screenX, screenY, scale, fontFamily, fontSize, bold, italic,
            textColor, bgColor, borderColor, initialValue } = opts;

    // Mirror span measures the natural text width so we can auto-grow horizontally
    const mirror = document.createElement('span');
    const fSize = `${fontSize * scale}px`;
    const sharedFont = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${fSize} ${fontFamily}`;
    mirror.style.cssText = `
      position: fixed; top: -9999px; left: -9999px;
      visibility: hidden; white-space: pre; pointer-events: none;
      font: ${sharedFont}; padding: 4px; box-sizing: border-box;
      border: 1.5px solid transparent;
    `;
    document.body.appendChild(mirror);
    this.mirror = mirror;

    const ta = document.createElement('textarea');
    ta.value = initialValue ?? '';
    ta.placeholder = 'Type here  •  Shift+Enter to finish';
    ta.style.cssText = `
      position: fixed;
      left: ${screenX}px;
      top: ${screenY}px;
      min-width: 80px;
      width: 80px;
      height: auto;
      min-height: 1.5em;
      overflow: hidden;
      font: ${sharedFont};
      color: ${textColor};
      background: ${bgColor};
      border: 1.5px dashed ${borderColor};
      border-radius: 2px;
      padding: 4px;
      resize: none;
      outline: none;
      z-index: 9999;
      box-sizing: border-box;
      line-height: 1.4;
      white-space: pre;
      overflow-wrap: normal;
    `;
    document.body.appendChild(ta);
    this.editor = ta;

    const autoSize = () => {
      // Width: widest line in the mirror
      const lines = ta.value.split('\n');
      mirror.textContent = lines.reduce((a, b) => a.length > b.length ? a : b, '') + 'W';
      const naturalW = Math.max(mirror.offsetWidth, 80);
      ta.style.width = `${naturalW}px`;
      // Height: let scrollHeight determine it
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
    };

    ta.addEventListener('input', autoSize);
    // Trigger on next frame so DOM is ready
    requestAnimationFrame(() => { autoSize(); ta.focus(); });

    return ta;
  }

  private destroyEditor(): void {
    this.editor?.remove();
    this.editor = null;
    this.mirror?.remove();
    this.mirror = null;
  }

  deactivate(): void {
    const { stage } = this.ctx.stageManager;
    stage.off('dblclick.text dbltap.text');
    stage.off('mousedown.text touchstart.text');
    stage.container().style.cursor = 'default';
    this.destroyEditor();
  }
}

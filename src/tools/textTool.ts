import type { ToolProtocol } from './toolProtocol';
import { toolRunner } from './toolRunner';
import { generateId } from '../model/document.ts';
import { konvaToPdf } from '../geometry/transform.ts';

let editor: HTMLTextAreaElement | null = null;
let mirrorSpan: HTMLSpanElement | null = null;

function hexToRgb(hex: string): {r: number, g: number, b: number} {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : {r: 0, g: 0, b: 0};
}

const textDrawPhase = {
  startDraw() {}, // No shape drawing for text - uses click handler
  midDraw() {},
  endDraw() { return null; },
  
  onClick(e: { x: number, y: number }) {
    const stageManager = toolRunner.getStageManager();
    if (!stageManager?.stage || editor) return;
    
    // Create new text box at click position
    openNewEditor(e.x, e.y);
  },

  activate() {
    const stageManager = toolRunner.getStageManager();
    if (stageManager?.stage) {
      stageManager.stage.container().style.cursor = 'text';
    }
  },

  deactivate() {
    destroyEditor();
    
    const stageManager = toolRunner.getStageManager();
    if (stageManager?.stage) {
      stageManager.stage.container().style.cursor = 'default';
    }
  },
};

function openNewEditor(kx: number, ky: number): void {
  const stageManager = toolRunner.getStageManager();
  if (!stageManager?.stage) return;
  
  const style = toolRunner.getActiveStyle();
  const scale = stageManager.stage.scaleX();
  const pos = stageManager.stage.position();
  const box = stageManager.stage.container().getBoundingClientRect();
  
  editor = createEditor({
    screenX: box.left + kx * scale + pos.x,
    screenY: box.top + ky * scale + pos.y,
    scale,
    fontFamily: style?.fontFamily || 'Arial',
    fontSize: style?.fontSize || 12,
    bold: style?.bold || false,
    italic: style?.italic || false,
    textColor: style?.textColor || '#000000',
    bgColor: style?.bgColor ? `rgba(${hexToRgb(style.bgColor).r},${hexToRgb(style.bgColor).g},${hexToRgb(style.bgColor).b},0.8)` : 'white',
    borderColor: style?.strokeColor || '#666',
  });

  const finish = (e?: Event) => {
    if (!editor) return;
    
    const text = editor.value.trim();
    const screenW = editor.offsetWidth;
    const screenH = editor.offsetHeight;
    
    destroyEditor();
    
    if (!text || !stageManager) return;

    // The model stores markup in PDF space (bottom-left origin, y-up), but kx/ky are
    // Konva layer coords — convert before committing or the text renders at a flipped Y.
    const pdfPos = konvaToPdf(kx, ky, stageManager.pageHeightPts);

    toolRunner.getAppState().mutate('ADD_MARKUP', {
      markup: {
        id: generateId(),
        type: 'text',
        pageIndex: toolRunner.getPageIndex(),
        style,
        x: pdfPos.x,
        y: pdfPos.y,
        width: screenW / scale,
        height: screenH / scale,
        text,
      }
    });
  };

  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') destroyEditor();
    if (e.key === 'Enter' && e.shiftKey) finish(e);
  });
  
  editor.addEventListener('blur', finish);
}

function createEditor(opts: any): HTMLTextAreaElement {
  // Create mirror span for width calculation
  const mirror = document.createElement('span');
  mirror.style.cssText = 'position:fixed;top:-9999px;left:-9999px;visibility:hidden;' +
    `font:${opts.fontSize * opts.scale}px ${opts.fontFamily};white-space:pre;padding:4px;`;
  document.body.appendChild(mirror);
  mirrorSpan = mirror;

  const ta = document.createElement('textarea');
  ta.value = opts.initialValue || '';
  ta.placeholder = 'Type here...';
  ta.style.cssText = `position:fixed;left:${opts.screenX}px;top:${opts.screenY}px;min-width:80px;width:80px;height:auto;font:${opts.fontSize * opts.scale}px ${opts.fontFamily};color:${opts.textColor};background:${opts.bgColor};border:2px dashed ${opts.borderColor};padding:4px;resize:none;outline:none;z-index:9999;`;
  
  document.body.appendChild(ta);

  const autoSize = () => {
    mirror.textContent = ta.value + 'W';
    ta.style.width = `${Math.max(mirror.offsetWidth, 80)}px`;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  };
  
  ta.addEventListener('input', autoSize);
  requestAnimationFrame(() => { autoSize(); ta.focus(); });

  return ta;
}

function destroyEditor() {
  if (editor) {
    editor.remove();
    editor = null;
  }
  if (mirrorSpan) {
    mirrorSpan.remove();
    mirrorSpan = null;
  }
}

export const textTool: ToolProtocol = {
  id: 'text',
  name: 'Text',
  key: 't',
  draw: textDrawPhase,
};
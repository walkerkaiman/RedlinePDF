import './style.css';
import Konva from 'konva';
import { appState } from './state/appState.ts';
import { loadPdf, fitPageScale } from './pdf/renderer.ts';
import { createStage } from './canvas/stage.ts';
import { initToolbar, showCanvas, updateCursorStatus } from './ui/toolbar.ts';
import { initPropertiesPanel } from './ui/properties.ts';
import { showModal, showExportOptionsDialog } from './ui/modal.ts';
import { showWorking, hideWorking, updateWorking } from './ui/working.ts';
import { autosaveProject, clearAutosave, importProjectFile, saveWithFilePicker, openSaveFilePicker, writeFileHandle, triggerDownload, cacheRecentFile, getCachedRecentFile, removeCachedRecentFile } from './storage/projectStore.ts';
import { isTauri, openPdfFileNative, saveFileNative, openProjectFileNative, openRecentPdfNative, openRecentProjectNative, saveSnapshotToDesktop } from './tauri/integration.ts';
import { getRecentPdfs, getRecentProjects, addRecentPdf, addRecentProject, removeRecentPdf, removeRecentProject } from './storage/recentFiles.ts';
import { exportRedlinedPdf } from './export/exportPdf.ts';
import { computeScale } from './measure/scale.ts';
import { formatLinear, formatArea } from './measure/units.ts';
import { konvaToPdf, distance, polygonArea, polygonPerimeter } from './geometry/transform.ts';
import type { Markup, PageData, ProjectData } from './model/document.ts';
import { DEFAULT_PAGE_SCALE, DEFAULT_UNITS, generateId, COUNT_SYMBOLS, COUNT_COLORS } from './model/document';
// Count category/markup/types still needed locally
import type { CountCategory, CountSymbol, CountMarkup, CountLegendMarkup, ImageMarkup } from './model/document';

// Import BaseTool for instanceof checks in undo/redo/select (still used)
import type { BaseTool, ToolContext } from './tools/baseTool';
import { SelectTool } from './tools/selectTool.ts';
import type { ToolType } from './state/appState.ts';
import { toolRunner } from './tools/toolRunner';

// Protocol objects — fully converted so far. Others stay as classes until migrated.
import { lineTool as lineToolProtocol } from './tools/lineTool.ts';
import { penTool } from './tools/penTool.ts';
import { arrowTool } from './tools/arrowTool.ts';
import { ellipseTool } from './tools/ellipseTool.ts';
import { polygonAreaTool } from './tools/polygonAreaTool.ts';
import { boxTool } from './tools/boxTool.ts';
import { textTool } from './tools/textTool.ts';
import { countTool } from './tools/countTool.ts';
import { panTool } from './tools/panTool.ts';
import { scaleSetTool } from './tools/scaleSetTool.ts';
import { measureLinearTool } from './tools/measureLinearTool.ts';
import { measureRectTool } from './tools/measureRectTool.ts';
import { measurePolyTool } from './tools/measurePolyTool.ts';
import { selectTool } from './tools/selectTool.ts';

const toolProtocols: Record<string, any> = {
  'line': lineToolProtocol,
  'pen': penTool,
  'arrow': arrowTool,
  'ellipse': ellipseTool,
  'polygon-area': polygonAreaTool,
  // Migration commit (1455e54) dropped these four from the map — every click on their
  // toolbar buttons resolved to setActiveTool(undefined), i.e. a dead tool with no listeners.
  'box': boxTool,
  'text': textTool,
  'count': countTool,
  'pan': panTool,
  'scale-set': scaleSetTool,
  'measure-linear': measureLinearTool,
  'measure-rect': measureRectTool,
  'measure-poly': measurePolyTool,
  'select': selectTool,
};

// ── App state ─────────────────────────────────────────────────────────────────

let pdfRenderer: Awaited<ReturnType<typeof loadPdf>> | null = null;
let pdfBytes: Uint8Array | null = null;
let stageManager: ReturnType<typeof createStage> | null = null;
let activeTool: BaseTool | null = null;
let project: ProjectData = { version: 1, pdfFileName: '', units: { ...DEFAULT_UNITS }, pages: [] };

// Last path the project was saved to (Tauri only). Allows Ctrl+S to save in-place
// without opening the picker again after the first save.
let lastSavedProjectPath: string | null = null;

// Undo/redo history (snapshot per action)
const undoStack: string[] = [];
const redoStack: string[] = [];

// When a measure tool is requested but scale is not set, store it here and redirect to Set Scale first
let pendingMeasureTool: ToolType | null = null;

const MEASURE_TOOLS: ToolType[] = ['measure-linear', 'measure-rect', 'measure-poly'];


// ── Toast notifications ───────────────────────────────────────────────────────

function showToast(message: string, type: 'info' | 'warn' = 'info', duration = 4500): void {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  // Trigger fade-in on next frame
  requestAnimationFrame(() => toast.classList.add('toast-show'));
  setTimeout(() => {
    toast.classList.remove('toast-show');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, duration);
}

// ── History helpers ───────────────────────────────────────────────────────────

function snapshotMarkups(): void {
  const page = currentPage();
  if (!page) return;
  undoStack.push(JSON.stringify({ markups: page.markups, countCategories: page.countCategories }));
  redoStack.length = 0;
  appState.update({ undoAvailable: undoStack.length > 0, redoAvailable: false });
  scheduleAutosave();
}

function restoreSnapshot(snapshot: string, page: import('./model/document.ts').PageData): void {
  const { markups, countCategories } = JSON.parse(snapshot) as {
    markups: Markup[];
    countCategories: CountCategory[];
  };
  page.markups = markups;
  page.countCategories = countCategories ?? [];
}

function undo(): void {
  const page = currentPage();
  if (!page || undoStack.length === 0) return;
  if (activeTool instanceof SelectTool) (activeTool as SelectTool).clearSelection();
  else appState.setSelection(null);
  redoStack.push(JSON.stringify({ markups: page.markups, countCategories: page.countCategories }));
  restoreSnapshot(undoStack.pop()!, page);
  rebuildMarkupLayer();
  stageManager?.draw();
  appState.update({ undoAvailable: undoStack.length > 0, redoAvailable: redoStack.length > 0 });
  pushCountSummary();
  scheduleAutosave();
}

function redo(): void {
  const page = currentPage();
  if (!page || redoStack.length === 0) return;
  if (activeTool instanceof SelectTool) (activeTool as SelectTool).clearSelection();
  else appState.setSelection(null);
  undoStack.push(JSON.stringify({ markups: page.markups, countCategories: page.countCategories }));
  restoreSnapshot(redoStack.pop()!, page);
  rebuildMarkupLayer();
  stageManager?.draw();
  appState.update({ undoAvailable: undoStack.length > 0, redoAvailable: redoStack.length > 0 });
  pushCountSummary();
  scheduleAutosave();
}

// ── Page helpers ──────────────────────────────────────────────────────────────

function currentPage(): PageData | null {
  return project.pages[appState.state.activePageIndex] ?? null;
}

function ensurePage(index: number): PageData {
  while (project.pages.length <= index) {
    project.pages.push({ index: project.pages.length, scale: { ...DEFAULT_PAGE_SCALE }, markups: [], countCategories: [] });
  }
  const page = project.pages[index];
  page.countCategories ??= [];
  return page;
}

// ── Markup operations ─────────────────────────────────────────────────────────

function addMarkup(markup: Markup): void {
  const page = ensurePage(markup.pageIndex);
  snapshotMarkups();
  page.markups.push(markup);
  stageManager?.addMarkupNode(markup);

  // Auto-switch to select and highlight the new markup so the user can
  // immediately edit its properties without a separate click.
  // setTool must come first so SelectTool.activate() runs (and calls
  // draggable(true) on the new node) before we attach the Transformer.
  appState.setTool('select');
  appState.setSelection(markup.id);
  if (activeTool instanceof SelectTool) {
    (activeTool as SelectTool).refreshTransformerForNode(markup.id);
  }

  // When a textarea blur triggers addMarkup, the same mousedown event that
  // caused the blur continues to fire on the Konva stage, potentially clearing
  // the transformer via rubber-band selection. Re-apply the selection one frame
  // later so the markup is always left in an interactive state.
  const addedId = markup.id;
  requestAnimationFrame(() => {
    if (activeTool instanceof SelectTool) {
      appState.setSelection(addedId);
      (activeTool as SelectTool).refreshTransformerForNode(addedId);
    }
  });

  scheduleAutosave();
}

function removeMarkupById(id: string): void {
  const page = currentPage();
  if (!page) return;
  const idx = page.markups.findIndex(m => m.id === id);
  if (idx === -1) return;
  snapshotMarkups();
  page.markups.splice(idx, 1);
  stageManager?.removeMarkupNode(id);
  appState.setSelection(null);
}

function removeSelectedMarkups(): void {
  const ids = appState.state.selectedMarkupIds;
  if (ids.length === 0) return;
  const page = currentPage();
  if (!page) return;
  snapshotMarkups();
  let needsLegendRefresh = false;
  for (const id of ids) {
    const idx = page.markups.findIndex(m => m.id === id);
    if (idx !== -1) {
      if (page.markups[idx].type === 'count') needsLegendRefresh = true;
      page.markups.splice(idx, 1);
    }
    stageManager?.removeMarkupNode(id);
  }
  appState.setSelection(null);
  if (needsLegendRefresh) {
    refreshLegend(page);
    pushCountSummary();
  }
}

/** Duplicate selected markups (deep-clone with position offset) */
function duplicateSelectedMarkups(): void {
  const ids = appState.state.selectedMarkupIds;
  if (ids.length === 0) return;
  const page = currentPage();
  if (!page) return;

  snapshotMarkups();

  // Deep clone selected markups with new IDs
  const clones = ids.map(id => {
    const m = page.markups.find(m => m.id === id);
    return JSON.parse(JSON.stringify(m)) as Markup | null;
  }).filter(Boolean) as Markup[];

  // Offset position, generate fresh IDs, push to model + canvas
  const newIds: string[] = [];
  for (const clone of clones) {
    clone.id = generateId();
    switch (clone.type) {
      case 'line': case 'arrow':
        (clone as any).x1 += 20; (clone as any).y1 -= 20;
        (clone as any).x2 += 20; (clone as any).y2 -= 20; break;
      case 'ellipse':
        (clone as any).cx += 20; (clone as any).cy -= 20; break;
      case 'box': case 'image': case 'text':
        clone.x += 20; clone.y -= 20; break;
      default: {
        if ('points' in clone && Array.isArray(clone.points)) {
          (clone.points as Array<{x:number;y:number}>).forEach(p => { p.x += 20; p.y -= 20; });
        } else if ('cx' in clone) {
          (clone as any).cx += 20; (clone as any).cy -= 20;
        } else if ('x1' in clone) {
          (clone as any).x1 += 20; (clone as any).y1 -= 20;
          (clone as any).x2 += 20; (clone as any).y2 -= 20;
        } else if ('x' in clone) {
          (clone as any).x += 20; (clone as any).y -= 20;
        }
      }
    }
    page.markups.push(clone);
    stageManager?.addMarkupNode(clone);
    newIds.push(clone.id);
  }

  appState.setSelection(null);
  if (newIds.length === 1) appState.setSelection(newIds[0]);
  else appState.setMultiSelection(newIds);
  if (activeTool instanceof SelectTool) {
    (activeTool as SelectTool).refreshTransformerForNodes(newIds);
  }

  showToast(`Duplicated ${clones.length} element${clones.length > 1 ? 's' : ''}`, 'info');
  scheduleAutosave();
}

/**
 * Returns true if a style property key is applicable to a given markup type.
 * Used when propagating a style change to multiple selected markups so we only
 * update markups that actually use the property.
 */
function styleKeyAppliesTo(key: string, type: import('./model/document.ts').MarkupType): boolean {
  const strokeKeys = ['strokeColor', 'strokeWidth', 'strokeOpacity'];
  const fillKeys = ['fillColor', 'fillOpacity'];
  const textKeys = ['textColor', 'bgColor', 'bgOpacity', 'fontFamily', 'fontSize', 'bold', 'italic'];
  const strokeTypes: import('./model/document.ts').MarkupType[] = ['pen', 'line', 'arrow', 'ellipse', 'box', 'measure-linear', 'measure-rect', 'measure-poly', 'polygon-area'];
  const fillTypes: import('./model/document.ts').MarkupType[] = ['box', 'ellipse', 'polygon-area'];
  const textTypes: import('./model/document.ts').MarkupType[] = ['text'];

  if (strokeKeys.includes(key)) return strokeTypes.includes(type);
  if (fillKeys.includes(key)) return fillTypes.includes(type);
  if (textKeys.includes(key)) return textTypes.includes(type);
  return true; // unknown key — let it through
}

function updateMarkup(id: string, partial: Partial<Markup>): void {
  const page = currentPage();
  if (!page) return;
  const markup = page.markups.find(m => m.id === id);
  if (!markup) return;
  Object.assign(markup, partial);
  stageManager?.updateMarkupNode(markup);
  scheduleAutosave();
}

function rebuildMarkupLayer(): void {
  if (!stageManager) return;
  stageManager.clearMarkups();
  const page = currentPage();
  if (!page) return;
  page.markups.forEach(m => stageManager!.addMarkupNode(m));
  if (activeTool instanceof SelectTool) {
    (activeTool as SelectTool).refreshDraggable();
  }
}

// ── Count helpers ─────────────────────────────────────────────────────────────

function pushCountSummary(): void {
  const page = currentPage();
  const cats = page?.countCategories ?? [];
  const stamps = page?.markups.filter(m => m.type === 'count') as CountMarkup[] ?? [];
  const summary = cats.map(cat => ({
    id: cat.id,
    name: cat.name,
    symbol: cat.symbol,
    color: cat.color,
    count: stamps.filter(s => s.categoryId === cat.id).length,
  }));
  appState.update({ countSummary: summary, countSymbolSize: page?.countSymbolSize ?? 10 });
  appState.emit('count-summary-change', summary);
}

function setCountSymbolSize(size: number): void {
  const page = currentPage();
  if (!page) return;
  page.countSymbolSize = size;
  const stamps = page.markups.filter(m => m.type === 'count') as CountMarkup[];
  stamps.forEach(s => {
    s.size = size;
    stageManager?.updateMarkupNode(s);
  });
  appState.update({ countSymbolSize: size });
  scheduleAutosave();
}

function ensureLegend(page: import('./model/document.ts').PageData): void {
  const hasLegend = page.markups.some(m => m.type === 'count-legend');
  if (hasLegend || page.countCategories.length === 0) return;
  const pw = stageManager?.pageWidthPts ?? 612;
  const ph = stageManager?.pageHeightPts ?? 792;
  const legend: CountLegendMarkup = {
    id: generateId(),
    type: 'count-legend',
    pageIndex: page.index,
    style: {},
    x: pw - 170,
    y: ph - 20,
    title: 'Count Legend',
    rows: [],
  };
  page.markups.push(legend);
  stageManager?.addMarkupNode(legend);
}

function refreshLegend(page: import('./model/document.ts').PageData): void {
  const stamps = page.markups.filter(m => m.type === 'count') as CountMarkup[];
  const legend = page.markups.find(m => m.type === 'count-legend') as CountLegendMarkup | undefined;

  if (page.countCategories.length === 0) {
    if (legend) {
      page.markups.splice(page.markups.indexOf(legend), 1);
      stageManager?.removeMarkupNode(legend.id);
    }
    return;
  }

  if (!legend) {
    ensureLegend(page);
    refreshLegend(page);
    return;
  }

  legend.rows = page.countCategories.map(cat => ({
    label: cat.name,
    symbol: cat.symbol,
    color: cat.color,
    count: stamps.filter(s => s.categoryId === cat.id).length,
  }));

  stageManager?.updateMarkupNode(legend);
}

function addCountStamp(markup: CountMarkup): void {
  const page = ensurePage(markup.pageIndex);
  snapshotMarkups();
  page.markups.push(markup);
  stageManager?.addMarkupNode(markup);
  refreshLegend(page);
  pushCountSummary();
  scheduleAutosave();
}

function addCountCategory(): void {
  const page = currentPage();
  if (!page) return;
  snapshotMarkups();
  const idx = page.countCategories.length;
  const cat: CountCategory = {
    id: generateId(),
    name: `Count ${idx + 1}`,
    symbol: COUNT_SYMBOLS[idx % COUNT_SYMBOLS.length],
    color: COUNT_COLORS[idx % COUNT_COLORS.length],
  };
  page.countCategories.push(cat);
  ensureLegend(page);
  refreshLegend(page);
  appState.setActiveCountCategory(cat.id);
  pushCountSummary();
  scheduleAutosave();
}

function renameCountCategory(id: string, name: string): void {
  const page = currentPage();
  const cat = page?.countCategories.find(c => c.id === id);
  if (!cat) return;
  cat.name = name;
  const stamps = page!.markups.filter(m => m.type === 'count' && (m as CountMarkup).categoryId === id) as CountMarkup[];
  stamps.forEach(s => stageManager?.updateMarkupNode(s));
  refreshLegend(page!);
  pushCountSummary();
  scheduleAutosave();
}

function setCountCategoryColor(id: string, color: string): void {
  const page = currentPage();
  const cat = page?.countCategories.find(c => c.id === id);
  if (!cat) return;
  cat.color = color;
  const stamps = page!.markups.filter(m => m.type === 'count' && (m as CountMarkup).categoryId === id) as CountMarkup[];
  stamps.forEach(s => { s.color = color; s.style.strokeColor = color; stageManager?.updateMarkupNode(s); });
  refreshLegend(page!);
  pushCountSummary();
  scheduleAutosave();
}

function setCountCategorySymbol(id: string, symbol: import('./model/document.ts').CountSymbol): void {
  const page = currentPage();
  const cat = page?.countCategories.find(c => c.id === id);
  if (!cat) return;
  cat.symbol = symbol;
  const stamps = page!.markups.filter(m => m.type === 'count' && (m as CountMarkup).categoryId === id) as CountMarkup[];
  stamps.forEach(s => { s.symbol = symbol; stageManager?.updateMarkupNode(s); });
  refreshLegend(page!);
  pushCountSummary();
  scheduleAutosave();
}

function deleteCountCategory(id: string): void {
  const page = currentPage();
  if (!page) return;
  snapshotMarkups();
  page.countCategories = page.countCategories.filter(c => c.id !== id);
  const toRemove = page.markups.filter(m => m.type === 'count' && (m as CountMarkup).categoryId === id);
  toRemove.forEach(m => { page.markups.splice(page.markups.indexOf(m), 1); stageManager?.removeMarkupNode(m.id); });
  if (appState.state.activeCountCategoryId === id) {
    appState.setActiveCountCategory(page.countCategories[0]?.id ?? null);
  }
  refreshLegend(page);
  pushCountSummary();
  scheduleAutosave();
}

// ── Autosave ──────────────────────────────────────────────────────────────────

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleAutosave(): void {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    if (pdfBytes) autosaveProject(project, pdfBytes).catch(console.error);
  }, 2000);
}

// ── PDF loading ───────────────────────────────────────────────────────────────

async function loadPdfFile(bytes: Uint8Array, fileName: string, filePath: string | null = null): Promise<void> {
  showWorking('Loading PDF…');
  try {
  // Destroy previous
  if (pdfRenderer) { pdfRenderer.destroy(); pdfRenderer = null; }
  stageManager?.stage.destroy();
  stageManager = null;

  // Restore the background image (if one was set before any PDF) so it can be
  // replaced by the PDF background after rendering, but also preserved for
  // re-renders if the user zooms.
  const savedBgImg = pendingBgImage?.img ?? null;

  pdfBytes = bytes;
  pdfRenderer = await loadPdf(bytes);

  const numPages = pdfRenderer.numPages;
  project = {
    version: 1,
    pdfFileName: fileName,
    units: { ...DEFAULT_UNITS },
    pages: Array.from({ length: numPages }, (_, i) => ({
      index: i,
      scale: { ...DEFAULT_PAGE_SCALE },
      markups: [],
      countCategories: [],
    })),
  };

  undoStack.length = 0;
  redoStack.length = 0;
  lastSavedProjectPath = null; // new PDF = unsaved project
  appState.update({
    hasPdf: true,
    totalPages: numPages,
    activePageIndex: 0,
    zoom: 1,
    undoAvailable: false,
    redoAvailable: false,
  });

  // A freshly loaded document must be count-able immediately — the Count tool's onClick
  // bails when no category is selected. Seed one default per project (projects are rebuilt
  // empty on every load; restored projects keep whatever categories they saved).
  addCountCategory();

  // Record in recent files; cache bytes in browser (no OS path available)
  let cacheKey: string | null = null;
  if (!filePath) {
    cacheKey = crypto.randomUUID();
    await cacheRecentFile(cacheKey, bytes);
  }
  addRecentPdf({ name: fileName, path: filePath, openedAt: Date.now(), cacheKey });
  refreshRecentMenus();

  // Show canvas BEFORE renderPage so clientWidth/Height are correct
  showCanvas(true);
  updateWorking('Rendering page…');
  await renderPage(0);
  } finally {
    hideWorking();
  }
}

async function renderPage(pageIndex: number): Promise<void> {
  if (!pdfRenderer) return;

  const scrollContainer = document.getElementById('canvas-scroll-container')!;
  const containerW = scrollContainer.clientWidth || 900;
  const containerH = scrollContainer.clientHeight || 700;
  const { widthPts, heightPts } = await pdfRenderer.getPageSizePts(pageIndex);

  let zoom = appState.state.zoom;
  // First load: fit page to viewport
  if (!stageManager) {
    zoom = fitPageScale(widthPts, heightPts, containerW, containerH);
    appState.update({ zoom });
  }

  // Render PDF at current zoom for hi-res background
  const pageInfo = await pdfRenderer.loadPage(pageIndex, zoom);

  if (!stageManager) {
    // Create stage sized to container viewport (not page)
    stageManager = createStage('konva-container', containerW, containerH, heightPts);
    stageManager.pageWidthPts = widthPts;
    setupStageEvents();
  } else {
    stageManager.pageHeightPts = heightPts;
    stageManager.pageWidthPts = widthPts;
    stageManager.resize(containerW, containerH);
  }

  stageManager.setPdfImage(pageInfo.canvas, widthPts, heightPts);

  // Restore the image-as-background that was set before any PDF was loaded.
  // We overlay it on top of the PDF by re-adding to bgLayer, then move it
  // to bottom so the PDF canvas renders above it (markups are on markupLayer
  // which sits on top of bgLayer, so everything is in correct order).
  if (pendingBgImage) {
    const natW = pendingBgImage.natW;
    const natH = pendingBgImage.natH;
    // Compute dimensions that fit the viewport while preserving aspect ratio
    const vw = stageManager!.stage.width();
    const vh = stageManager!.stage.height();
    const scale = Math.min(vw / natW, vh / natH);
    const fitW = natW * scale;
    const fitH = natH * scale;
    // Center the background image
    const offsetX = (vw - fitW) / 2;
    const offsetY = (vh - fitH) / 2;

    const bgImgNode = new Konva.Image({
      image: pendingBgImage.img,
      x: offsetX, y: offsetY,
      width: fitW, height: fitH,
    });
    stageManager.bgLayer.add(bgImgNode);
    bgImgNode.moveToBottom(); // PDF canvas above background, markups on top of bgLayer
    stageManager.bgLayer.draw();
  }

  stageManager.setZoom(zoom);
  stageManager.clearMarkups();

  const page = currentPage();
  page?.markups.forEach(m => stageManager!.addMarkupNode(m));

  activateCurrentTool();
}

let wheelDebounce: ReturnType<typeof setTimeout> | null = null;

function setupStageEvents(): void {
  if (!stageManager) return;
  const { stage } = stageManager;

  // Mouse wheel: immediate visual zoom + debounced hi-res re-render
  stage.container().addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    const scaleFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const oldScale = stage.scaleX();
    const newScale = Math.max(0.1, Math.min(10, oldScale * scaleFactor));

    // Immediate visual zoom (smooth)
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };
    stage.scale({ x: newScale, y: newScale });
    stage.position({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
    stage.draw();

    // Debounced: update state + re-render PDF at new resolution
    if (wheelDebounce) clearTimeout(wheelDebounce);
    wheelDebounce = setTimeout(async () => {
      appState.update({ zoom: newScale });
      if (!pdfRenderer || !stageManager) return;
      const pageInfo = await pdfRenderer.loadPage(appState.state.activePageIndex, newScale);
      stageManager.updatePdfCanvas(pageInfo.canvas);
    }, 300);
  }, { passive: false });

  // Cursor coordinates in status bar
  stage.on('mousemove', () => {
    const pos = stageManager?.getLayerPointer();
    if (!pos) return;
    const h = stageManager!.pageHeightPts;
    const pdfPos = konvaToPdf(pos.x, pos.y, h);
    updateCursorStatus(pdfPos.x, pdfPos.y);
  });

  // Snapshot the markup state just before a drag/resize starts so undo restores it.
  appState.on('markup-transform-start', () => {
    snapshotMarkups();
  });

  // Markup transform sync (from select tool's transformend / dragend)
  appState.on('markup-transform', (data) => {
    const { id } = data as { id: string };
    const page = currentPage();
    const markup = page?.markups.find(m => m.id === id);
    if (!markup || !stageManager) return;
    // Bake the Konva node's accumulated scale/translation back into the markup's
    // PDF-space coordinates and reset the node to identity scale.  This keeps
    // the model as the source of truth so exports and re-renders are correct.
    stageManager.bakeTransform(markup);
    // Re-attach the transformer so it recalculates its bounding box after the
    // bake resets the node's position/scale (without this, the transformer
    // handles stay in the stale pre-bake position and subsequent drags fail).
    if (activeTool instanceof SelectTool) {
      (activeTool as SelectTool).refreshTransformerForNode(id);
    }
    scheduleAutosave();
  });
}

// ── Tool context ──────────────────────────────────────────────────────────────

function buildToolContext(): ToolContext {
  return {
    stageManager: stageManager!,
    onMarkupAdd: (markup) => addMarkup(markup),
    onMarkupUpdate: (id, partial) => updateMarkup(id, partial as Partial<Markup>),
    onCountAdd: (markup) => addCountStamp(markup),
    getActiveCountCategory: () => {
      const page = currentPage();
      const id = appState.state.activeCountCategoryId;
      return page?.countCategories.find(c => c.id === id) ?? null;
    },
    getCountSymbolSize: () => currentPage()?.countSymbolSize ?? 10,
    getStyle: () => appState.state.activeStyle,
    getPageHeightPts: () => stageManager?.pageHeightPts ?? 792,
    getPageIndex: () => appState.state.activePageIndex,
    getScale: () => currentPage()?.scale ?? DEFAULT_PAGE_SCALE,
    getUnits: () => appState.state.units,
    showModal,
  };
}

// ── Tool switching — uses toolRunner singleton (no BaseTool classes) ───────

/** Test seam for Playwright e2e assertions — read-only views over live state that are NOT reachable via the DOM
 * (Konva renders to raw <canvas> pixels; markup objects and active tool live in module scope). Exposed only as
 * window.__REDLINE_DEBUG so specs can assert pipeline effects deterministically without pixel checks. */
(window as unknown as { __REDLINE_DEBUG?: object })['__REDLINE_DEBUG'] ??= {
  get activeTool(): string | null { return appState.state.activeTool; },
  get markups(): number { const p = currentPage(); return p ? p.markups.length : -1; },
  get markupTypes(): string[] { const p = currentPage(); return p ? (p.markups.map(m => m.type) as string[]) : []; },
  get pageIndex(): number { return appState.state.activePageIndex; },
  get activeCountCategoryId(): string | null { return appState.state.activeCountCategoryId; },
  /** List ids of actual Konva markup nodes on the markup layer (excludes transformer). */
  get renderedNodeIds(): string[] {
    const sm = stageManager;
    if (!sm) return [];
    return sm.markupLayer.getChildren((n: Konva.Node) => {
      const id = n.id();
      return !!id && id !== 'transformer' && id !== 'select-transformer';
    }).map((n: Konva.Node) => n.id());
  },
  get selectedIds(): string[] { return appState.state.selectedMarkupIds; },
  /** Count symbol size (driven by the always-visible Size slider in the count tool panel). */
  get countSymbolSize(): number { return appState.state.countSymbolSize; },
  /** First currently-selected markup (for asserting style commits from the properties panel). */
  get selectedMarkup(): import('./model/document.ts').Markup | null {
    const ids = appState.state.selectedMarkupIds;
    if (!ids.length) return null;
    const p = currentPage();
    return p ? (p.markups.find(m => m.id === ids[0]) ?? null) : null;
  },
  /** Debug: what does markupLayer.getIntersection return at the current pointer? */
  hitAtPointer(): unknown {
    const sm = stageManager;
    if (!sm || !sm.stage) return null;
    const abs = sm.stage.getPointerPosition();
    if (!abs) return { err: 'no-pointer' };
    const hit = sm.markupLayer.getIntersection(abs);
    if (!hit) return { abs, hit: null };
    const walk = (n: Konva.Node): any => ({
      cls: (n as any).className, name: n.name(), id: n.id(),
      parent: n.getParent() ? { cls: (n.getParent() as any).className, name: (n.getParent() as any).name?.(), id: (n.getParent() as any).id?.() } : null,
    });
    return { abs, hit: walk(hit) };
  },
  /** Debug: report the live-drawing preview shapes (interactionLayer) for the active tool. */
  livePreviewStructure(): unknown {
    const sm = stageManager;
    if (!sm || !sm.interactionLayer) return null;
    const layer = sm.interactionLayer as unknown as Konva.Layer;
    return layer.getChildren().map((n: Konva.Node) => ({
      cls: (n as any).className,
      name: n.name(),
      id: n.id(),
      closed: (n as any).closed?.(),
      pointsLen: (n as any).points?.()?.length,
    }));
  },
  /** Debug: report child shapes (class + name) of the first rendered node of `type`. */
  nodeStructure(type: string): unknown {
    const sm = stageManager;
    if (!sm) return null;
    const p = currentPage();
    const id = p?.markups.find(m => m.type === type)?.id;
    if (!id) return null;
    const node = sm.findNode(id);
    if (!node) return null;
    const walk = (n: Konva.Node): any => ({
      cls: (n as any).className,
      name: n.name(),
      id: n.id(),
      closed: (n as any).closed?.(),
      pointsLen: (n as any).points?.()?.length,
      children: (n as any).getChildren?.()?.map(walk) ?? undefined,
    });
    return walk(node);
  },
  /**
   * On-screen bounding boxes of all rendered markup nodes, in real stage/screen pixel
   * coordinates (the stage is scaled/offset to fit the page, so the rect must be run through
   * the stage transform). e2e specs use this to click a markup at its actual rendered
   * position. Returns [] if no markup is rendered.
   */
  get markupScreenRects(): { type: string; x: number; y: number; width: number; height: number }[] {
    const sm = stageManager;
    if (!sm) return [];
    const ids = sm.markupLayer.getChildren((n: Konva.Node) => !!n.id() && n.id() !== 'transformer' && n.id() !== 'select-transformer').map((n: Konva.Node) => n.id());
    const out: { type: string; x: number; y: number; width: number; height: number }[] = [];
    const sx = sm.stage.scaleX(), sy = sm.stage.scaleY(), ox = sm.stage.x(), oy = sm.stage.y();
    const p = currentPage();
    for (const id of ids) {
      const node = sm.findNode(id);
      if (!node) continue;
      const type = p?.markups.find(m => m.id === id)?.type ?? 'unknown';
      const r = node.getClientRect({ relativeTo: sm.stage });
      out.push({ type, x: ox + r.x * sx, y: oy + r.y * sy, width: r.width * sx, height: r.height * sy });
    }
    return out;
  },
  /**
   * Screen-space rects of the select-tool highlight overlays (the blue dashed boxes drawn on
   * interactionLayer). Used by e2e to assert the highlight lands on the markup (Bug B: a
   * highlight offset to the side of the selected element indicates a coordinate-space bug).
   */
  get selectOverlayRects(): { x: number; y: number; width: number; height: number }[] {
    const sm = stageManager;
    if (!sm) return [];
    const sx = sm.stage.scaleX(), sy = sm.stage.scaleY(), ox = sm.stage.x(), oy = sm.stage.y();
    const out: { x: number; y: number; width: number; height: number }[] = [];
    for (const n of sm.interactionLayer.getChildren()) {
      if (n.name && n.name() === 'select-highlight') {
        const r = n.getClientRect({ relativeTo: sm.stage });
        out.push({ x: ox + r.x * sx, y: oy + r.y * sy, width: r.width * sx, height: r.height * sy });
      }
    }
    return out;
  },
};

function activateCurrentTool(): void {
  if (!stageManager) return;

  // Wire the runner to this stage exactly once. Must happen before the first
  // setActiveTool call, otherwise _stageManager is null and no listener binds —
  // pan/draw/text/count all die on click with "no reaction".
  toolRunner.init(stageManager);

  const type = appState.state.activeTool;
  console.log(`[main] Switching to tool: ${type}`);

  // ToolRunner handles event binding internally. Set protocol from appState.
  toolRunner.setActiveTool(toolProtocols[type]);
}

// ADD_MARKUP is dispatched from toolRunner._dispatchAdd() for every committed stroke, and also directly by countTool/textTool on click/commit. Without a registered handler appState.mutate('ADD_MARKUP', …) throws "No handler registered", which toolRunner's try/catch swallows — the visible bug: tools accept input but nothing renders. Registered here (not in appState._init()) because addMarkup()/addCountStamp() are module-scope functions in this file that touch stageManager, undo stacks and count legend/summary side effects; registering from state/appState.ts would be a circular import back into main.ts.
appState.registerMutationHandler('ADD_MARKUP', ({ markup }: { markup: Markup }) => {
  if (markup.type === 'count') addCountStamp(markup); // narrows via type discriminator to CountMarkup
  else addMarkup(markup);
});

// ── Scale helpers ─────────────────────────────────────────────────────────


/**
 * Recompute measurement labels on the current page using current scale + units.
 * Call this whenever scale or units change so labels stay accurate.
 */
function recalculateMeasureLabels(): void {
  const page = currentPage();
  if (!page || !page.scale.calibrated) return;
  const ppi = page.scale.pointsPerUnit;
  const unit = appState.state.units.linearUnit;
  let changed = false;

  for (const m of page.markups) {
    if (m.type === 'measure-linear') {
      const dist = distance({ x: m.x1, y: m.y1 }, { x: m.x2, y: m.y2 });
      const newLabel = formatLinear(dist, ppi, unit);
      if (newLabel !== m.label) { m.label = newLabel; changed = true; }
    } else if (m.type === 'measure-rect') {
      const widthLabel = formatLinear(m.width, ppi, unit);
      const heightLabel = formatLinear(m.height, ppi, unit);
      const areaLabel = formatArea(m.width * m.height, ppi, unit);
      const newLabel = `W: ${widthLabel}\nH: ${heightLabel}\n${areaLabel}`;
      if (newLabel !== m.label) { m.label = newLabel; changed = true; }
    } else if (m.type === 'measure-poly') {
      const area = polygonArea(m.points);
      const perim = polygonPerimeter(m.points);
      const newLabel = `Area: ${formatArea(area, ppi, unit)}\n\nPerim: ${formatLinear(perim, ppi, unit)}`;
      if (newLabel !== m.label) { m.label = newLabel; changed = true; }
    }
  }

  if (changed) {
    rebuildMarkupLayer();
    scheduleAutosave();
  }
}

// ── File action handlers (module-level so keyboard shortcuts can call them) ───

async function handleOpenPdf(): Promise<void> {
  if (isTauri()) {
    const result = await openPdfFileNative();
    if (result) await loadPdfFile(result.bytes, result.name, result.path);
  } else {
    document.getElementById('file-input-pdf')?.click();
  }
}

async function handleOpenProject(): Promise<void> {
  if (isTauri()) {
    const result = await openProjectFileNative();
    if (result) {
      const { project: p, pdfBytes: b } = await importProjectFile(result.file);
      await loadPdfFromProject(p, b, result.file.name, result.path);
    }
  } else {
    document.getElementById('file-input-project')?.click();
  }
}

async function handleSaveProject(): Promise<void> {
  if (!pdfBytes) return;
  const fileName = project.pdfFileName || 'redline';
  const suggestedName = fileName.replace(/\.pdf$/i, '') + '.redline';
  showWorking('Saving project…');
  try {
    if (isTauri()) {
      const { buildRedlinePayload } = await import('./storage/projectStore.ts');
      const payload = buildRedlinePayload(project, pdfBytes);
      const bytes = new TextEncoder().encode(payload);
      if (lastSavedProjectPath) {
        // Quick-save: overwrite the previously saved file without opening a picker
        const { writeFile } = await import('@tauri-apps/plugin-fs');
        await writeFile(lastSavedProjectPath, bytes);
      } else {
        const savedPath = await saveFileNative(bytes, suggestedName, 'redline', 'RedlinePDF Projects');
        if (savedPath) lastSavedProjectPath = savedPath;
      }
    } else {
      const json = (await import('./storage/projectStore.ts')).buildRedlinePayload(project, pdfBytes);
      const blob = new Blob([json], { type: 'application/json' });
      await saveWithFilePicker(blob, suggestedName, 'RedlinePDF Project', {
        'application/json': ['.redline'],
      });
    }
  } finally {
    hideWorking();
  }
}

/** Force "Save As" — opens the picker regardless of lastSavedProjectPath */
async function handleSaveProjectAs(): Promise<void> {
  lastSavedProjectPath = null;
  await handleSaveProject();
}

async function handleSnapshot(): Promise<void> {
  if (!stageManager) return;
  showWorking('Saving snapshot…');
  try {
    // When no PDF is loaded, export the full canvas at background-image resolution.
    // Otherwise capture just the PDF viewport.
    const dataUrl = pdfBytes
      ? stageManager.captureViewportPng()
      : stageManager.captureFullPng();
    // Strip the data URL prefix and decode to bytes
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const base = (project.pdfFileName || 'snapshot').replace(/\.pdf$/i, '');
    if (isTauri()) {
      const saved = await saveSnapshotToDesktop(base, bytes);
      if (saved) {
        const fileName = saved.split(/[\\/]/).pop() ?? saved;
        showToast(`Snapshot saved: ${fileName}`, 'info', 4000);
      }
    } else {
      triggerDownload(new Blob([bytes], { type: 'image/png' }), `${base}_snapshot.png`);
    }
  } finally {
    hideWorking();
  }
}

// ── Drag and drop ─────────────────────────────────────────────────────────────

/** Shared handler for a dropped file path or File object */
async function handleDroppedFile(file: File): Promise<void> {
  showWorking('Loading…');
  try {
    if (file.name.endsWith('.pdf')) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await loadPdfFile(bytes, file.name, null);
    } else if (file.name.endsWith('.redline')) {
      const { project: p, pdfBytes: b } = await importProjectFile(file);
      await loadPdfFromProject(p, b, file.name, null);
    } else if (isImageFile(file)) {
      await handleDroppedImage(file);
    }
  } finally {
    hideWorking();
  }
}

/** Supported image extensions */
const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg',
]);

function isImageFile(file: File): boolean {
  return IMAGE_EXTENSIONS.has('.' + file.name.split('.').pop()!.toLowerCase());
}

/** Convert a browser File to a base64 PNG data URL */
function fileToPngDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Place an image on the canvas:
 * - If no PDF loaded → set it as the background layer (replaces PDF bg)
 * - If PDF loaded → add as a markup node (moveable/resizable like other markups)
 */
async function handleDroppedImage(file: File): Promise<void> {
  const dataUrl = await fileToPngDataUrl(file);

  // Create an Image element to get natural dimensions and prepare the element
  const imgEl = new window.Image();
  imgEl.src = dataUrl;
  await new Promise<void>((resolve, reject) => {
    imgEl.onload = () => resolve();
    imgEl.onerror = reject;
  });

  // Convert natural pixel dimensions to PDF points (assume 72 DPI as baseline)
  const natW = imgEl.naturalWidth;
  const natH = imgEl.naturalHeight;
  const ptsW = (natW / 72) * 72;
  const ptsH = (natH / 72) * 72;

  if (!stageManager) {
    // No stage created yet — user dragged image before opening a PDF.
    try {
      // Reuse the already-loaded imgEl from above to set as background.
      stageManager = createStage('konva-container', 900, 700, natH);
      stageManager.setBackgroundImage(imgEl, natW, natH);
      pendingBgImage = { img: imgEl, natW, natH };
      showCanvas(true);
      const snapBtn = document.getElementById('btn-snapshot') as HTMLButtonElement;
      if (snapBtn) snapBtn.disabled = false;
      setupStageEvents();
    } catch (err) {
      console.error('Error setting image as background:', err);
      showToast('Failed to load image.', 'warn', 4000);
      return;
    }
    showToast('Image set as background — draw on it or load a PDF.', 'info', 5000);
    return;
  }

  const page = currentPage();
  if (!page) return;

  // Get stage viewport dimensions to center the image
  const containerW = stageManager.stage.width();
  const containerH = stageManager.stage.height();
  const zoom = appState.state.zoom;
  const pageW = stageManager.pageWidthPts * zoom;
  const pageH = stageManager.pageHeightPts * zoom;
  const offsetX = (containerW - pageW) / 2 + stageManager.stage.x();
  const offsetY = (containerH - pageH) / 2 + stageManager.stage.y();

  // Center image on the PDF page in Konva layer space
  const posX = offsetX + (pageW - ptsW) / 2;
  const posY = offsetY + (pageH - ptsH) / 2;

  // Convert back to PDF-space bottom-left origin
  const posPdf = konvaToPdf(posX, posY, stageManager.pageHeightPts);

  const markup: ImageMarkup = {
    id: generateId(),
    type: 'image',
    pageIndex: page.index,
    style: {},
    x: posPdf.x - ptsW / 2,
    y: posPdf.y - ptsH / 2,
    width: ptsW,
    height: ptsH,
    dataUrl,
    opacity: 1,
  };

  snapshotMarkups();
  page.markups.push(markup);
  stageManager.addMarkupNode(markup);

  // Auto-switch to select and highlight the new image
  appState.setTool('select');
  appState.setSelection(markup.id);
  if (activeTool instanceof SelectTool) {
    (activeTool as SelectTool).refreshTransformerForNode(markup.id);
  }

  showToast(`Image added: ${file.name}`, 'info');
  scheduleAutosave();
}

/** Temporarily stored image (as HTMLImageElement) when dropped before any PDF is loaded */
let pendingBgImage: { img: HTMLImageElement; natW: number; natH: number } | null = null;

function setupDragDrop(): void {
  const viewport = document.getElementById('canvas-viewport')!;

  // HTML5 drag-and-drop (browser and WebView2 when not intercepted by Tauri)
  viewport.addEventListener('dragover', (e) => { e.preventDefault(); viewport.classList.add('drag-over'); });
  viewport.addEventListener('dragleave', () => viewport.classList.remove('drag-over'));
  viewport.addEventListener('drop', async (e) => {
    e.preventDefault();
    viewport.classList.remove('drag-over');
    const file = e.dataTransfer?.files[0];
    if (!file) return;
    await handleDroppedFile(file);
  });

  // Tauri-native file drop: WebView2 on Windows intercepts OS drag-drop before
  // the HTML5 dataTransfer fires, so we listen to the Tauri event as a fallback.
  if (isTauri()) {
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<{ paths: string[]; position: { x: number; y: number } }>('tauri://drag-drop', async (event) => {
        const path = event.payload.paths[0];
        if (!path) return;
        viewport.classList.remove('drag-over');
        const { readFile, readTextFile } = await import('@tauri-apps/plugin-fs');
        const name = path.split(/[\\/]/).pop() ?? '';
        showWorking('Loading…');
        try {
          if (name.endsWith('.pdf')) {
            const bytes = await readFile(path);
            await loadPdfFile(new Uint8Array(bytes), name, path);
          } else if (name.endsWith('.redline')) {
            const text = await readTextFile(path);
            const blob = new Blob([text], { type: 'application/json' });
            const file = new File([blob], name, { type: 'application/json' });
            const { project: p, pdfBytes: byt } = await importProjectFile(file);
            await loadPdfFromProject(p, byt, name, path);
          } else if (IMAGE_EXTENSIONS.has(name.split('.').pop()!.toLowerCase())) {
            const bytes = await readFile(path);
            const imgFile = new File([bytes], name, { type: 'image/' + name.split('.').pop()!.toLowerCase() });
            await handleDroppedImage(imgFile);
          }
        } finally {
          hideWorking();
        }
      }).catch(console.error);

      // Show drag-over highlight on Tauri drag-enter
      listen('tauri://drag-enter', () => viewport.classList.add('drag-over')).catch(console.error);
      listen('tauri://drag-leave', () => viewport.classList.remove('drag-over')).catch(console.error);
    }).catch(console.error);
  }
}

// ── File input handlers ───────────────────────────────────────────────────────

function setupFileInputs(): void {
  const pdfInput = document.getElementById('file-input-pdf') as HTMLInputElement;
  pdfInput.addEventListener('change', async () => {
    const file = pdfInput.files?.[0];
    if (!file) return;
    try {
      if (isImageFile(file)) {
        showWorking('Loading image…');
        await handleDroppedImage(file);
      } else if (file.name.endsWith('.pdf')) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        await loadPdfFile(bytes, file.name);
      } else {
        showToast(`Unsupported file type: ${file.name}`, 'warn', 4000);
      }
    } catch (err) {
      console.error('Error loading file:', err);
      showToast('Failed to load file.', 'warn', 4000);
    } finally {
      hideWorking();
      pdfInput.value = '';
    }
  });

  const projectInput = document.getElementById('file-input-project') as HTMLInputElement;
  projectInput.addEventListener('change', async () => {
    const file = projectInput.files?.[0];
    if (!file) return;
    const { project: p, pdfBytes: b } = await importProjectFile(file);
    await loadPdfFromProject(p, b, file.name, null);
    projectInput.value = '';
  });

  // Re-wire the open buttons to use Tauri-aware open
  document.getElementById('btn-open-pdf')?.addEventListener('click', () => void handleOpenPdf());
  document.getElementById('drop-open-btn')?.addEventListener('click', () => void handleOpenPdf());
  document.getElementById('btn-open-project')?.addEventListener('click', () => void handleOpenProject());
  document.getElementById('drop-open-project-btn')?.addEventListener('click', () => void handleOpenProject());

  document.getElementById('btn-save-project')?.addEventListener('click', () => void handleSaveProject());
  document.getElementById('btn-save-project-as')?.addEventListener('click', () => void handleSaveProjectAs());
  document.getElementById('btn-snapshot')?.addEventListener('click', () => void handleSnapshot());

  document.getElementById('btn-export-pdf')?.addEventListener('click', async () => {
    if (!pdfBytes) return;

    // Step 1 — Ask user for quality + page range. DOM modal does not consume user activation.
    const totalPages = project.pages.length;
    const currentPage = appState.state.activePageIndex;
    const exportOptions = await showExportOptionsDialog(totalPages, currentPage);
    if (!exportOptions) return; // user cancelled

    const suggestedName = project.pdfFileName.replace(/\.pdf$/i, '') + '_redline.pdf';

    // Show the working overlay now — it will stay visible through the file picker
    // (the OS dialog floats above it) and throughout rendering.
    const pageDesc = exportOptions.pageIndices
      ? `${exportOptions.pageIndices.length} page${exportOptions.pageIndices.length > 1 ? 's' : ''}`
      : `all ${totalPages} page${totalPages > 1 ? 's' : ''}`;
    showWorking('Preparing export…');

    // Step 2 — Open the native file-save picker NOW, while the transient user-
    // activation from the quality-dialog "Export" click is still valid.
    // Rendering (Step 3) can take seconds at high DPI; doing it here avoids
    // the activation window expiring before showSaveFilePicker is called.
    let fileHandle: FileSystemFileHandle | null = null;
    if (!isTauri()) {
      fileHandle = await openSaveFilePicker(suggestedName, 'PDF Files', { 'application/pdf': ['.pdf'] });
      // null + API present → user cancelled the picker
      if (fileHandle === null && 'showSaveFilePicker' in window) { hideWorking(); return; }
    }

    // Step 3 — Render.
    const btn = document.getElementById('btn-export-pdf') as HTMLButtonElement;
    btn.disabled = true;
    updateWorking(`Rendering ${pageDesc} at ${exportOptions.dpi} DPI…`);
    try {
      if (!pdfRenderer) throw new Error('No PDF loaded');
      const outputBytes = await exportRedlinedPdf(
        project, pdfBytes, pdfRenderer, exportOptions.scale, exportOptions.pageIndices,
      );
      updateWorking('Saving file…');
      if (isTauri()) {
        await saveFileNative(outputBytes, suggestedName, 'pdf', 'PDF Files');
      } else if (fileHandle) {
        const blob = new Blob([outputBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
        await writeFileHandle(fileHandle, blob);
      } else {
        // Fallback for browsers without File System Access API.
        const blob = new Blob([outputBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
        triggerDownload(blob, suggestedName);
      }
    } finally {
      btn.disabled = false;
      btn.querySelector('span')!.textContent = 'Export PDF';
      hideWorking();
    }
  });
}

async function loadPdfFromProject(p: ProjectData, b: Uint8Array, projectFileName: string | null = null, projectFilePath: string | null = null): Promise<void> {
  showWorking('Opening project…');
  try {
    project = p;
    // Normalize pages from older project files that predate countCategories
    project.pages.forEach(pg => { pg.countCategories ??= []; });
    pdfBytes = b;
    if (pdfRenderer) { pdfRenderer.destroy(); pdfRenderer = null; }
    stageManager?.stage.destroy();
    stageManager = null;

    pdfRenderer = await loadPdf(b);
    undoStack.length = 0;
    redoStack.length = 0;
    lastSavedProjectPath = projectFilePath; // if opened from recent, path is already known
    appState.update({
      hasPdf: true,
      totalPages: pdfRenderer.numPages,
      activePageIndex: 0,
      zoom: 1,
      units: { ...p.units },
      undoAvailable: false,
      redoAvailable: false,
    });

    // Record in recent files; cache file bytes in browser (no OS path available)
    const displayName = projectFileName ?? p.pdfFileName?.replace(/\.pdf$/i, '.redline') ?? 'project.redline';
    let projCacheKey: string | null = null;
    if (!projectFilePath) {
      projCacheKey = crypto.randomUUID();
      const { buildRedlinePayload } = await import('./storage/projectStore.ts');
      const payload = buildRedlinePayload(p, b);
      await cacheRecentFile(projCacheKey, new TextEncoder().encode(payload));
    }
    addRecentProject({ name: displayName, path: projectFilePath, openedAt: Date.now(), cacheKey: projCacheKey });
    refreshRecentMenus();

    showCanvas(true);
    updateWorking('Rendering page…');
    await renderPage(0);
    pushCountSummary();
    const firstPage = currentPage();
    if (firstPage && firstPage.countCategories.length > 0) refreshLegend(firstPage);
  } finally {
    hideWorking();
  }
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

function setupKeyboardShortcuts(): void {
  window.addEventListener('keydown', (e) => {
    // Don't capture when focus is in an input/textarea
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;

    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && e.key === 'z') { e.preventDefault(); undo(); return; }
    if (ctrl && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); redo(); return; }
    if (ctrl && e.key === 'o') { e.preventDefault(); void handleOpenProject(); return; }
    if (ctrl && e.shiftKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); void handleSnapshot(); return; }
    if (ctrl && e.key === 's') { e.preventDefault(); void handleSaveProject(); return; }
    if (ctrl && e.key === 'e') { e.preventDefault(); document.getElementById('btn-export-pdf')?.click(); return; }
    if (ctrl && e.key === 'd' && appState.state.selectedMarkupIds.length > 0) { e.preventDefault(); duplicateSelectedMarkups(); return; }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      removeSelectedMarkups();
      return;
    }

    // Arrow keys: nudge selected markups, or navigate pages when nothing is selected
    if (!ctrl && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const { activePageIndex, totalPages, selectedMarkupIds } = appState.state;

      if (selectedMarkupIds.length > 0 && stageManager) {
        // Nudge: 1px normally, 10px with Shift (in Konva screen-pixels; bakeTransform converts to PDF pts)
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        snapshotMarkups();
        for (const id of selectedMarkupIds) {
          const node = stageManager.findNode(id);
          if (!node) continue;
          node.x(node.x() + dx);
          node.y(node.y() + dy);
          appState.emit('markup-transform', { id });
        }
        return;
      }

      // No selection → navigate pages
      if (e.key === 'ArrowRight' && activePageIndex < totalPages - 1) {
        e.preventDefault();
        appState.setPage(activePageIndex + 1);
        return;
      }
      if (e.key === 'ArrowLeft' && activePageIndex > 0) {
        e.preventDefault();
        appState.setPage(activePageIndex - 1);
        return;
      }
    }

    // Tool shortcuts
    if (!ctrl) {
      const toolKeys: Record<string, ToolType> = {
        'v': 'select', 'h': 'pan', 'p': 'pen', 'l': 'line', 'a': 'arrow',
        'e': 'ellipse', 'b': 'box', 't': 'text', 'y': 'polygon-area',
        's': 'scale-set', 'm': 'measure-linear', 'c': 'count',
      };
      if (e.shiftKey) {
        if (e.key === 'R') appState.setTool('measure-rect');
        else if (e.key === 'P') appState.setTool('measure-poly');
      } else if (toolKeys[e.key]) {
        appState.setTool(toolKeys[e.key]);
      }
      // Zoom
      if (e.key === '+' || e.key === '=') appState.setZoom(appState.state.zoom * 1.25);
      if (e.key === '-') appState.setZoom(appState.state.zoom / 1.25);
      if (e.key === 'f' || e.key === 'F') appState.emit('cmd-fit-page');
    }
  });
}

// ── State → re-render connections ─────────────────────────────────────────────

function setupStateListeners(): void {
  appState.on('tool-change', (tool) => {
    const newTool = tool as ToolType;

    // If leaving scale-set tool without completing calibration, clear the pending tool
    if (newTool !== 'scale-set' && !MEASURE_TOOLS.includes(newTool)) {
      pendingMeasureTool = null;
    }

    // If switching to a measure tool without calibrated scale, redirect to Set Scale first.
    // DO NOT "fix" this by removing the redirect — it is INTENTIONAL. Measure tools read the
    // page scale (toolRunner.getScale()); without calibration they cannot compute real distances.
    // We stash the intended tool and auto-switch back after calibration (see the 'scale-set' handler).
    if (MEASURE_TOOLS.includes(newTool)) {
      const page = currentPage();
      if (!page || !page.scale.calibrated) {
        pendingMeasureTool = newTool;
        // setTool will re-emit 'tool-change' for 'scale-set'
        appState.setTool('scale-set');
        showToast(
          'Scale not set. Pick two points on a known dimension, enter the distance, then your measure tool will activate.',
          'warn',
          6000
        );
        return;
      }
    }

    activateCurrentTool();
  });

  appState.on('zoom-change', async (zoom) => {
    if (!stageManager) return;
    const zoomVal = zoom as number;
    if (pdfRenderer) {
      const pageIndex = appState.state.activePageIndex;
      const pageInfo = await pdfRenderer.loadPage(pageIndex, zoomVal);
      // Re-render hi-res PDF background and zoom the stage
      stageManager.updatePdfCanvas(pageInfo.canvas);
    }
    stageManager.setZoom(zoomVal);
    rebuildMarkupLayer();
    activateCurrentTool();
  });

  appState.on('page-change', async (pageIndex) => {
    if (!pdfRenderer) return;
    undoStack.length = 0;
    redoStack.length = 0;
    appState.update({ undoAvailable: false, redoAvailable: false });
    await renderPage(pageIndex as number);
    pushCountSummary();
    const pg = currentPage();
    if (pg && pg.countCategories.length > 0) refreshLegend(pg);
  });

  appState.on('units-change', () => {
    recalculateMeasureLabels(); // updates model labels, then rebuilds layer
    if (!currentPage()?.scale.calibrated) rebuildMarkupLayer(); // rebuild even if no labels changed
  });

  appState.on('scale-set', (data) => {
    const { pageIndex, scale } = data as { pageIndex: number; scale: import('./model/document.ts').PageScale };
    ensurePage(pageIndex).scale = scale;
    // Mirror the scale into appState.state.scale so measure tools can read it via
    // toolRunner.getScale() without re-deriving it from the page. This is the single source
    // the measure tools consult; keep them in sync.
    appState.update({ scale: { ...scale } }); // mirror so measure tools can read it
    recalculateMeasureLabels();
    if (!pendingMeasureTool) rebuildMarkupLayer(); // recalculate already rebuilds if changed
    scheduleAutosave();

    // If we redirected from a measure tool, switch to it now
    if (pendingMeasureTool) {
      const tool = pendingMeasureTool;
      pendingMeasureTool = null;
      showToast(`Scale set. ${tool === 'measure-linear' ? 'Linear' : tool === 'measure-rect' ? 'Rectangle Area' : 'Polygon Area'} tool is now active.`, 'info');
      appState.setTool(tool);
    }
  });

  // When a markup (or markups) is selected, resolve types and pre-fill activeStyle.
  appState.on('selection-change', (raw) => {
    const ids = raw as string[];
    if (!ids || ids.length === 0) {
      // Deselect → clear image props too
      appState.update({ selectedImageProps: null });
      return;
    }
    const page = currentPage();
    if (!page) return;
    const markups = ids.map(id => page.markups.find(m => m.id === id)).filter(Boolean) as Markup[];
    if (markups.length === 0) return;
    const types = markups.map(m => m.type);
    appState.setSelectionTypes(types);
    // Pre-fill style from the primary (first) markup so sliders show real values.
    appState.update({ activeStyle: { ...appState.state.activeStyle, ...markups[0].style } });
    // Populate image props if a single image is selected
    if (ids.length === 1 && markups[0].type === 'image') {
      const im = markups[0] as ImageMarkup;
      appState.update({ selectedImageProps: {
        opacity: im.opacity ?? 1,
        strokeColor: im.style.strokeColor ?? '#e63946',
        strokeWidth: im.style.strokeWidth ?? 0,
        strokeOpacity: im.style.strokeOpacity ?? 1,
      }});
    } else {
      appState.update({ selectedImageProps: null });
    }
  });

  // When a style property changes while something is selected, apply it to
  // all selected markups whose type supports that property.
  appState.on('style-change', (raw) => {
    const { key, value } = raw as { key: string; value: unknown };
    const ids = appState.state.selectedMarkupIds;
    if (ids.length === 0) return; // no selection → only the global default was updated
    const page = currentPage();
    if (!page) return;
    let anyUpdated = false;
    for (const id of ids) {
      const markup = page.markups.find(m => m.id === id);
      if (!markup) continue;
      if (!styleKeyAppliesTo(key, markup.type)) continue;
      (markup.style as Record<string, unknown>)[key] = value;
      stageManager?.updateMarkupNode(markup);
      anyUpdated = true;
    }
    if (!anyUpdated) return;
    stageManager?.draw();
    // Re-attach the Transformer to the rebuilt Konva nodes.
    if (activeTool instanceof SelectTool) {
      (activeTool as SelectTool).refreshTransformerForNodes(ids);
    }
    scheduleAutosave();
  });

  // Image property changes — applied directly to the selected image markup.
  appState.on('image-prop-change', (raw) => {
    const { prop, value } = raw as { prop: string; value: unknown };
    const ids = appState.state.selectedMarkupIds;
    if (ids.length !== 1) return;
    const page = currentPage();
    if (!page) return;
    const markup = page.markups.find(m => m.id === ids[0]);
    if (!markup || markup.type !== 'image') return;
    const im = markup as ImageMarkup;
    if (prop === 'opacity') {
      im.opacity = value as number;
    } else if (['strokeColor', 'strokeWidth', 'strokeOpacity'].includes(prop)) {
      (im.style as Record<string, unknown>)[prop] = value;
    }
    stageManager?.updateMarkupNode(markup);
    // Refresh properties panel with updated values
    appState.update({ selectedImageProps: {
      opacity: im.opacity ?? 1,
      strokeColor: im.style.strokeColor ?? '#e63946',
      strokeWidth: im.style.strokeWidth ?? 0,
      strokeOpacity: im.style.strokeOpacity ?? 1,
    }});
    scheduleAutosave();
  });

  appState.on('cmd-undo', () => undo());
  appState.on('cmd-redo', () => redo());
  appState.on('cmd-delete', () => {
    removeSelectedMarkups();
  });

  appState.on('cmd-duplicate', () => duplicateSelectedMarkups());

  appState.on('cmd-count-add-category', () => addCountCategory());
  appState.on('cmd-count-rename', (data) => {
    const { id, name } = data as { id: string; name: string };
    renameCountCategory(id, name);
  });
  appState.on('cmd-count-set-color', (data) => {
    const { id, color } = data as { id: string; color: string };
    setCountCategoryColor(id, color);
  });
  appState.on('cmd-count-set-symbol', (data) => {
    const { id, symbol } = data as { id: string; symbol: import('./model/document.ts').CountSymbol };
    setCountCategorySymbol(id, symbol);
  });
  appState.on('cmd-count-delete', (data) => {
    const { id } = data as { id: string };
    deleteCountCategory(id);
  });
  appState.on('cmd-count-set-active', (data) => {
    const { id } = data as { id: string };
    appState.setActiveCountCategory(id);
  });
  appState.on('cmd-count-set-size', (data) => {
    const { size } = data as { size: number };
    setCountSymbolSize(size);
  });
  appState.on('cmd-text-edit', (data) => {
    const { id } = data as { id: string };
    const page = currentPage();
    const markup = page?.markups.find(m => m.id === id);
    if (!markup || markup.type !== 'text') return;
    if (appState.state.activeTool !== 'text') appState.setTool('text');
    // Text tool handles editing via its click handler; nothing else to invoke.
  });
  appState.on('cmd-fit-page', async () => {
    if (!stageManager) return;
    const container = document.getElementById('canvas-scroll-container')!;
    let widthPts: number, heightPts: number;
    if (pdfRenderer) {
      ({ widthPts, heightPts } = await pdfRenderer.getPageSizePts(appState.state.activePageIndex));
    } else {
      // Image-only mode — use the dimensions stored on stageManager.
      widthPts = stageManager.pageWidthPts;
      heightPts = stageManager.pageHeightPts;
    }
    const newZoom = fitPageScale(widthPts, heightPts, container.clientWidth, container.clientHeight);
    appState.setZoom(newZoom);
  });

  // Handle container resize via ResizeObserver (catches window resize AND
  // layout-driven changes like the properties panel appearing/disappearing)
  let resizeDebounce: ReturnType<typeof setTimeout> | null = null;

  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect;
      if (width === 0 || height === 0) continue;

      if (resizeDebounce) clearTimeout(resizeDebounce);
      resizeDebounce = setTimeout(() => {
        if (!stageManager) return;
        stageManager.resize(Math.floor(width), Math.floor(height));
        stageManager.setZoom(appState.state.zoom);
      }, 60); // 60 ms debounce — smooth during drag resize
    }
  });

  const scrollContainer = document.getElementById('canvas-scroll-container')!;
  resizeObserver.observe(scrollContainer);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

// ── Recent files menus ────────────────────────────────────────────────────────

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min  = Math.floor(diff / 60_000);
  const hr   = Math.floor(diff / 3_600_000);
  const day  = Math.floor(diff / 86_400_000);
  if (min < 1)   return 'just now';
  if (min < 60)  return `${min}m ago`;
  if (hr  < 24)  return `${hr}h ago`;
  if (day < 7)   return `${day}d ago`;
  return new Date(ms).toLocaleDateString();
}

function buildRecentMenu(
  menuEl: HTMLElement,
  entries: import('./storage/recentFiles.ts').RecentEntry[],
  onOpen: (entry: import('./storage/recentFiles.ts').RecentEntry) => void,
  emptyLabel: string,
): void {
  menuEl.innerHTML = '';
  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'tb-recent-empty';
    empty.textContent = emptyLabel;
    menuEl.appendChild(empty);
    return;
  }
  const header = document.createElement('div');
  header.className = 'tb-recent-header';
  header.textContent = 'Recent';
  menuEl.appendChild(header);
  entries.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'tb-recent-item';
    item.setAttribute('role', 'menuitem');
    item.setAttribute('tabindex', '0');
    const name = document.createElement('div');
    name.className = 'tb-recent-item-name';
    name.textContent = entry.name;
    name.title = entry.path ?? entry.name;
    const meta = document.createElement('div');
    meta.className = 'tb-recent-item-meta';
    meta.textContent = entry.path
      ? entry.path + '  ·  ' + formatRelativeTime(entry.openedAt)
      : formatRelativeTime(entry.openedAt);
    item.appendChild(name);
    item.appendChild(meta);
    item.addEventListener('click', () => onOpen(entry));
    item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') onOpen(entry); });
    menuEl.appendChild(item);
  });
}

function refreshRecentMenus(): void {
  const pdfMenu = document.getElementById('recent-pdf-menu');
  const projMenu = document.getElementById('recent-project-menu');
  if (pdfMenu) {
    buildRecentMenu(pdfMenu, getRecentPdfs(), async (entry) => {
      if (isTauri() && entry.path) {
        // Tauri: read from OS path
        const result = await openRecentPdfNative(entry.path);
        if (result) {
          await loadPdfFile(result.bytes, result.name, entry.path);
        } else {
          removeRecentPdf(entry.path, entry.name);
          refreshRecentMenus();
          showToast(`File not found: ${entry.name}`, 'warn', 4000);
        }
      } else if (entry.cacheKey) {
        // Browser: load from IndexedDB cache
        const bytes = await getCachedRecentFile(entry.cacheKey);
        if (bytes) {
          await loadPdfFile(bytes, entry.name, null);
        } else {
          removeRecentPdf(null, entry.name);
          refreshRecentMenus();
          showToast(`Cached file expired: ${entry.name}`, 'warn', 4000);
        }
      } else {
        handleOpenPdf();
      }
    }, 'No recent PDFs');
  }
  if (projMenu) {
    buildRecentMenu(projMenu, getRecentProjects(), async (entry) => {
      if (isTauri() && entry.path) {
        // Tauri: read from OS path
        const file = await openRecentProjectNative(entry.path);
        if (file) {
          const { project: p, pdfBytes: b } = await importProjectFile(file);
          await loadPdfFromProject(p, b, entry.name, entry.path);
        } else {
          removeRecentProject(entry.path, entry.name);
          refreshRecentMenus();
          showToast(`File not found: ${entry.name}`, 'warn', 4000);
        }
      } else if (entry.cacheKey) {
        // Browser: load from IndexedDB cache
        const bytes = await getCachedRecentFile(entry.cacheKey);
        if (bytes) {
          const text = new TextDecoder().decode(bytes);
          const blob = new Blob([text], { type: 'application/json' });
          const file = new File([blob], entry.name, { type: 'application/json' });
          const { project: p, pdfBytes: b } = await importProjectFile(file);
          await loadPdfFromProject(p, b, entry.name, null);
        } else {
          removeRecentProject(null, entry.name);
          refreshRecentMenus();
          showToast(`Cached file expired: ${entry.name}`, 'warn', 4000);
        }
      } else {
        handleOpenProject();
      }
    }, 'No recent projects');
  }
}

function setupRecentMenus(): void {
  refreshRecentMenus();

  // JS-driven hover: use a hide-delay so the cursor can travel from the button
  // to the fixed-position menu without the menu disappearing in between.
  (['wrap-open-pdf', 'wrap-open-project'] as const).forEach(wrapperId => {
    const menuId = wrapperId === 'wrap-open-pdf' ? 'recent-pdf-menu' : 'recent-project-menu';
    const wrap = document.getElementById(wrapperId);
    const menu = document.getElementById(menuId);
    if (!wrap || !menu) return;

    let hideTimer: ReturnType<typeof setTimeout> | null = null;

    const showMenu = () => {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      // Only show if there are items (menu is non-empty)
      if (!menu.firstChild) return;
      const rect = wrap.getBoundingClientRect();
      menu.style.top  = `${rect.bottom + 2}px`;
      menu.style.left = `${rect.left}px`;
      menu.classList.add('tb-recent-visible');
    };

    const scheduleHide = () => {
      hideTimer = setTimeout(() => {
        menu.classList.remove('tb-recent-visible');
        hideTimer = null;
      }, 120);
    };

    wrap.addEventListener('mouseenter', showMenu);
    wrap.addEventListener('mouseleave', scheduleHide);
    menu.addEventListener('mouseenter', () => {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    });
    menu.addEventListener('mouseleave', scheduleHide);
  });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  initToolbar();
  initPropertiesPanel();
  setupDragDrop();
  setupFileInputs();
  setupKeyboardShortcuts();
  setupStateListeners();
  setupRecentMenus();

  // Select tool is default
  appState.setTool('select');

  // Clear autosave on clean exit so the next launch starts fresh.
  // If the app crashes the autosave is preserved and could be used for recovery.
  window.addEventListener('beforeunload', () => {
    clearAutosave().catch(() => { /* best-effort */ });
  });
}

init().catch(console.error);

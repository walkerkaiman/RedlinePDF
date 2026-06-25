import './style.css';
import { appState } from './state/appState.ts';
import { loadPdf, fitPageScale } from './pdf/renderer.ts';
import { createStage } from './canvas/stage.ts';
import { initToolbar, showCanvas, updateCursorStatus } from './ui/toolbar.ts';
import { initPropertiesPanel } from './ui/properties.ts';
import { showModal, showExportOptionsDialog } from './ui/modal.ts';
import { showWorking, hideWorking, updateWorking } from './ui/working.ts';
import { autosaveProject, loadAutosave, importProjectFile, saveWithFilePicker, openSaveFilePicker, writeFileHandle, triggerDownload, cacheRecentFile, getCachedRecentFile, removeCachedRecentFile } from './storage/projectStore.ts';
import { isTauri, openPdfFileNative, saveFileNative, openProjectFileNative, openRecentPdfNative, openRecentProjectNative } from './tauri/integration.ts';
import { getRecentPdfs, getRecentProjects, addRecentPdf, addRecentProject, removeRecentPdf, removeRecentProject } from './storage/recentFiles.ts';
import { exportRedlinedPdf } from './export/exportPdf.ts';
import { computeScale } from './measure/scale.ts';
import { formatLinear, formatArea } from './measure/units.ts';
import { konvaToPdf, distance, polygonArea, polygonPerimeter } from './geometry/transform.ts';
import type { Markup, PageData, ProjectData } from './model/document.ts';
import { DEFAULT_PAGE_SCALE, DEFAULT_UNITS, generateId } from './model/document.ts';

// Import tools
import { SelectTool } from './tools/selectTool.ts';
import { PanTool } from './tools/panTool.ts';
import { PenTool } from './tools/penTool.ts';
import { LineTool } from './tools/lineTool.ts';
import { ArrowTool } from './tools/arrowTool.ts';
import { EllipseTool } from './tools/ellipseTool.ts';
import { BoxTool } from './tools/boxTool.ts';
import { TextTool } from './tools/textTool.ts';
import { ScaleSetTool } from './tools/scaleSetTool.ts';
import { MeasureLinearTool } from './tools/measureLinearTool.ts';
import { MeasureRectTool } from './tools/measureRectTool.ts';
import { MeasurePolyTool } from './tools/measurePolyTool.ts';
import { CountTool } from './tools/countTool.ts';
import type { BaseTool } from './tools/baseTool.ts';
import type { ToolContext } from './tools/baseTool.ts';
import type { ToolType } from './state/appState.ts';
import type { CountCategory, CountMarkup, CountLegendMarkup } from './model/document.ts';
import { COUNT_SYMBOLS, COUNT_COLORS, generateId as _generateId } from './model/document.ts';

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

/**
 * Returns true if a style property key is applicable to a given markup type.
 * Used when propagating a style change to multiple selected markups so we only
 * update markups that actually use the property.
 */
function styleKeyAppliesTo(key: string, type: import('./model/document.ts').MarkupType): boolean {
  const strokeKeys = ['strokeColor', 'strokeWidth', 'strokeOpacity'];
  const fillKeys = ['fillColor', 'fillOpacity'];
  const textKeys = ['textColor', 'bgColor', 'bgOpacity', 'fontFamily', 'fontSize', 'bold', 'italic'];
  const strokeTypes: import('./model/document.ts').MarkupType[] = ['pen', 'line', 'arrow', 'ellipse', 'box', 'measure-linear', 'measure-rect', 'measure-poly'];
  const fillTypes: import('./model/document.ts').MarkupType[] = ['box', 'ellipse'];
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
    id: _generateId(),
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
    id: _generateId(),
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

function createTool(type: ToolType): BaseTool | null {
  if (!stageManager) return null;
  const ctx = buildToolContext();
  switch (type) {
    case 'select': return new SelectTool(ctx);
    case 'pan':    return new PanTool(ctx);
    case 'pen':    return new PenTool(ctx);
    case 'line':   return new LineTool(ctx);
    case 'arrow':  return new ArrowTool(ctx);
    case 'ellipse': return new EllipseTool(ctx);
    case 'box':    return new BoxTool(ctx);
    case 'text':   return new TextTool(ctx);
    case 'scale-set': return new ScaleSetTool(ctx);
    case 'measure-linear': return new MeasureLinearTool(ctx);
    case 'measure-rect':   return new MeasureRectTool(ctx);
    case 'measure-poly':   return new MeasurePolyTool(ctx);
    case 'count':          return new CountTool(ctx);
    default: return null;
  }
}

function activateCurrentTool(): void {
  if (!stageManager) return;
  if (activeTool) { activeTool.deactivate(); activeTool = null; }
  const tool = createTool(appState.state.activeTool);
  if (tool) { tool.activate(); activeTool = tool; }
}

// ── Scale helpers ─────────────────────────────────────────────────────────────


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
    }
  } finally {
    hideWorking();
  }
}

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
    const bytes = new Uint8Array(await file.arrayBuffer());
    await loadPdfFile(bytes, file.name);
    pdfInput.value = '';
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
    if (ctrl && e.key === 's') { e.preventDefault(); void handleSaveProject(); return; }
    if (ctrl && e.key === 'e') { e.preventDefault(); document.getElementById('btn-export-pdf')?.click(); return; }

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
        'e': 'ellipse', 'b': 'box', 't': 'text',
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

    // If switching to a measure tool without calibrated scale, redirect to Set Scale first
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
    if (!pdfRenderer || !stageManager) return;
    const zoomVal = zoom as number;
    const pageIndex = appState.state.activePageIndex;
    const pageInfo = await pdfRenderer.loadPage(pageIndex, zoomVal);
    // Re-render hi-res PDF background and zoom the stage
    stageManager.updatePdfCanvas(pageInfo.canvas);
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
    if (!ids || ids.length === 0) return; // deselect already cleared state
    const page = currentPage();
    if (!page) return;
    const markups = ids.map(id => page.markups.find(m => m.id === id)).filter(Boolean) as import('./model/document.ts').Markup[];
    if (markups.length === 0) return;
    const types = markups.map(m => m.type);
    appState.setSelectionTypes(types);
    // Pre-fill style from the primary (first) markup so sliders show real values.
    appState.update({ activeStyle: { ...appState.state.activeStyle, ...markups[0].style } });
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

  appState.on('cmd-undo', () => undo());
  appState.on('cmd-redo', () => redo());
  appState.on('cmd-delete', () => {
    removeSelectedMarkups();
  });

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
    if (!(activeTool instanceof TextTool)) appState.setTool('text');
    if (activeTool instanceof TextTool) {
      (activeTool as TextTool).editExisting(markup as import('./model/document.ts').TextMarkup);
    }
  });
  appState.on('cmd-fit-page', async () => {
    if (!pdfRenderer || !stageManager) return;
    const container = document.getElementById('canvas-scroll-container')!;
    const { widthPts, heightPts } = await pdfRenderer.getPageSizePts(appState.state.activePageIndex);
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

  // Try to recover last autosaved session
  try {
    const saved = await loadAutosave();
    if (saved && saved.project.pdfFileName) {
      await loadPdfFromProject(saved.project, saved.pdfBytes);
      showToast(`Previous session restored: "${saved.project.pdfFileName}"`, 'info', 5000);
    }
  } catch {
    // No autosave available or corrupt — start fresh (expected on first run)
  }
}

init().catch(console.error);

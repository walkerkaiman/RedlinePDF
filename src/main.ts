import './style.css';
import { appState } from './state/appState.ts';
import { loadPdf, fitWidthScale } from './pdf/renderer.ts';
import { createStage } from './canvas/stage.ts';
import { initToolbar, showCanvas, updateCursorStatus } from './ui/toolbar.ts';
import { initPropertiesPanel } from './ui/properties.ts';
import { showModal, showExportOptionsDialog } from './ui/modal.ts';
import { autosaveProject, loadAutosave, exportProjectFile, importProjectFile, saveWithFilePicker, openSaveFilePicker, writeFileHandle, triggerDownload } from './storage/projectStore.ts';
import { isTauri, openPdfFileNative, saveFileNative, openProjectFileNative } from './tauri/integration.ts';
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
import { RectTool } from './tools/rectTool.ts';
import { EllipseTool } from './tools/ellipseTool.ts';
import { BoxTool } from './tools/boxTool.ts';
import { TextTool } from './tools/textTool.ts';
import { ScaleSetTool } from './tools/scaleSetTool.ts';
import { MeasureLinearTool } from './tools/measureLinearTool.ts';
import { MeasureRectTool } from './tools/measureRectTool.ts';
import { MeasurePolyTool } from './tools/measurePolyTool.ts';
import type { BaseTool } from './tools/baseTool.ts';
import type { ToolContext } from './tools/baseTool.ts';
import type { ToolType } from './state/appState.ts';

// ── App state ─────────────────────────────────────────────────────────────────

let pdfRenderer: Awaited<ReturnType<typeof loadPdf>> | null = null;
let pdfBytes: Uint8Array | null = null;
let stageManager: ReturnType<typeof createStage> | null = null;
let activeTool: BaseTool | null = null;
let project: ProjectData = { version: 1, pdfFileName: '', units: { ...DEFAULT_UNITS }, pages: [] };

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
  undoStack.push(JSON.stringify(page.markups));
  redoStack.length = 0;
  appState.update({ undoAvailable: undoStack.length > 0, redoAvailable: false });
  scheduleAutosave();
}

function undo(): void {
  const page = currentPage();
  if (!page || undoStack.length === 0) return;
  // Clear selection BEFORE destroying nodes, otherwise the Transformer keeps
  // rendering handles that point to the (about-to-be-destroyed) Konva nodes.
  if (activeTool instanceof SelectTool) (activeTool as SelectTool).clearSelection();
  else appState.setSelection(null);
  redoStack.push(JSON.stringify(page.markups));
  page.markups = JSON.parse(undoStack.pop()!);
  rebuildMarkupLayer();
  stageManager?.draw();
  appState.update({ undoAvailable: undoStack.length > 0, redoAvailable: redoStack.length > 0 });
  scheduleAutosave();
}

function redo(): void {
  const page = currentPage();
  if (!page || redoStack.length === 0) return;
  if (activeTool instanceof SelectTool) (activeTool as SelectTool).clearSelection();
  else appState.setSelection(null);
  undoStack.push(JSON.stringify(page.markups));
  page.markups = JSON.parse(redoStack.pop()!);
  rebuildMarkupLayer();
  stageManager?.draw();
  appState.update({ undoAvailable: undoStack.length > 0, redoAvailable: redoStack.length > 0 });
  scheduleAutosave();
}

// ── Page helpers ──────────────────────────────────────────────────────────────

function currentPage(): PageData | null {
  return project.pages[appState.state.activePageIndex] ?? null;
}

function ensurePage(index: number): PageData {
  while (project.pages.length <= index) {
    project.pages.push({ index: project.pages.length, scale: { ...DEFAULT_PAGE_SCALE }, markups: [] });
  }
  return project.pages[index];
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
  for (const id of ids) {
    const idx = page.markups.findIndex(m => m.id === id);
    if (idx !== -1) page.markups.splice(idx, 1);
    stageManager?.removeMarkupNode(id);
  }
  appState.setSelection(null);
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
  const strokeTypes: import('./model/document.ts').MarkupType[] = ['pen', 'line', 'arrow', 'rect', 'ellipse', 'box', 'measure-linear', 'measure-rect', 'measure-poly'];
  const fillTypes: import('./model/document.ts').MarkupType[] = ['box'];
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

async function loadPdfFile(bytes: Uint8Array, fileName: string): Promise<void> {
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
    })),
  };

  undoStack.length = 0;
  redoStack.length = 0;
  appState.update({
    hasPdf: true,
    totalPages: numPages,
    activePageIndex: 0,
    zoom: 1,
    undoAvailable: false,
    redoAvailable: false,
  });

  // Show canvas BEFORE renderPage so clientWidth/Height are correct
  showCanvas(true);
  await renderPage(0);
}

async function renderPage(pageIndex: number): Promise<void> {
  if (!pdfRenderer) return;

  const scrollContainer = document.getElementById('canvas-scroll-container')!;
  const containerW = scrollContainer.clientWidth || 900;
  const containerH = scrollContainer.clientHeight || 700;
  const { widthPts, heightPts } = await pdfRenderer.getPageSizePts(pageIndex);

  let zoom = appState.state.zoom;
  // First load: fit to width
  if (!stageManager) {
    zoom = fitWidthScale(widthPts, containerW);
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
    scheduleAutosave();
  });
}

// ── Tool context ──────────────────────────────────────────────────────────────

function buildToolContext(): ToolContext {
  return {
    stageManager: stageManager!,
    onMarkupAdd: (markup) => addMarkup(markup),
    onMarkupUpdate: (id, partial) => updateMarkup(id, partial as Partial<Markup>),
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
    case 'rect':   return new RectTool(ctx);
    case 'ellipse': return new EllipseTool(ctx);
    case 'box':    return new BoxTool(ctx);
    case 'text':   return new TextTool(ctx);
    case 'scale-set': return new ScaleSetTool(ctx);
    case 'measure-linear': return new MeasureLinearTool(ctx);
    case 'measure-rect':   return new MeasureRectTool(ctx);
    case 'measure-poly':   return new MeasurePolyTool(ctx);
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
      const newLabel = `Area: ${formatArea(area, ppi, unit)}\nPerim: ${formatLinear(perim, ppi, unit)}`;
      if (newLabel !== m.label) { m.label = newLabel; changed = true; }
    }
  }

  if (changed) {
    rebuildMarkupLayer();
    scheduleAutosave();
  }
}

// ── Drag and drop ─────────────────────────────────────────────────────────────

function setupDragDrop(): void {
  const viewport = document.getElementById('canvas-viewport')!;

  viewport.addEventListener('dragover', (e) => { e.preventDefault(); viewport.classList.add('drag-over'); });
  viewport.addEventListener('dragleave', () => viewport.classList.remove('drag-over'));
  viewport.addEventListener('drop', async (e) => {
    e.preventDefault();
    viewport.classList.remove('drag-over');
    const file = e.dataTransfer?.files[0];
    if (!file) return;
    if (file.name.endsWith('.pdf')) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await loadPdfFile(bytes, file.name);
    } else if (file.name.endsWith('.redline')) {
      const { project: p, pdfBytes: b } = await importProjectFile(file);
      await loadPdfFromProject(p, b);
    }
  });
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
    await loadPdfFromProject(p, b);
    projectInput.value = '';
  });

  // Open PDF: use native dialog in Tauri, browser input elsewhere
  async function handleOpenPdf(): Promise<void> {
    if (isTauri()) {
      const result = await openPdfFileNative();
      if (result) await loadPdfFile(result.bytes, result.name);
    } else {
      document.getElementById('file-input-pdf')?.click();
    }
  }

  // Open Project: native dialog in Tauri, browser input elsewhere
  async function handleOpenProject(): Promise<void> {
    if (isTauri()) {
      const file = await openProjectFileNative();
      if (file) {
        const { project: p, pdfBytes: b } = await importProjectFile(file);
        await loadPdfFromProject(p, b);
      }
    } else {
      document.getElementById('file-input-project')?.click();
    }
  }

  // Re-wire the open buttons to use Tauri-aware open
  document.getElementById('btn-open-pdf')?.addEventListener('click', () => void handleOpenPdf());
  document.getElementById('drop-open-btn')?.addEventListener('click', () => void handleOpenPdf());
  document.getElementById('btn-open-project')?.addEventListener('click', () => void handleOpenProject());
  document.getElementById('drop-open-project-btn')?.addEventListener('click', () => void handleOpenProject());

  document.getElementById('btn-save-project')?.addEventListener('click', async () => {
    if (!pdfBytes) return;
    const fileName = project.pdfFileName || 'redline';
    const suggestedName = fileName.replace(/\.pdf$/i, '') + '.redline';
    if (isTauri()) {
      const { buildRedlinePayload } = await import('./storage/projectStore.ts');
      const payload = buildRedlinePayload(project, pdfBytes);
      const bytes = new TextEncoder().encode(payload);
      await saveFileNative(bytes, suggestedName, 'redline', 'RedlinePDF Projects');
    } else {
      const json = (await import('./storage/projectStore.ts')).buildRedlinePayload(project, pdfBytes);
      const blob = new Blob([json], { type: 'application/json' });
      await saveWithFilePicker(blob, suggestedName, 'RedlinePDF Project', {
        'application/json': ['.redline'],
      });
    }
  });

  document.getElementById('btn-export-pdf')?.addEventListener('click', async () => {
    if (!pdfBytes) return;

    // Step 1 — Ask user for quality. DOM modal does not consume user activation.
    const exportOptions = await showExportOptionsDialog();
    if (!exportOptions) return; // user cancelled

    const suggestedName = project.pdfFileName.replace(/\.pdf$/i, '') + '_redline.pdf';

    // Step 2 — Open the native file-save picker NOW, while the transient user-
    // activation from the quality-dialog "Export" click is still valid.
    // Rendering (Step 3) can take seconds at high DPI; doing it here avoids
    // the activation window expiring before showSaveFilePicker is called.
    let fileHandle: FileSystemFileHandle | null = null;
    if (!isTauri()) {
      fileHandle = await openSaveFilePicker(suggestedName, 'PDF Files', { 'application/pdf': ['.pdf'] });
      // null + API present → user cancelled the picker
      if (fileHandle === null && 'showSaveFilePicker' in window) return;
    }

    // Step 3 — Render. Activation is no longer needed from here on.
    const btn = document.getElementById('btn-export-pdf') as HTMLButtonElement;
    btn.disabled = true;
    btn.querySelector('span')!.textContent = `Exporting at ${exportOptions.dpi} DPI…`;
    try {
      if (!pdfRenderer) throw new Error('No PDF loaded');
      const outputBytes = await exportRedlinedPdf(project, pdfBytes, pdfRenderer, exportOptions.scale);
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
    }
  });
}

async function loadPdfFromProject(p: ProjectData, b: Uint8Array): Promise<void> {
  project = p;
  pdfBytes = b;
  if (pdfRenderer) { pdfRenderer.destroy(); pdfRenderer = null; }
  stageManager?.stage.destroy();
  stageManager = null;

  pdfRenderer = await loadPdf(b);
  undoStack.length = 0;
  redoStack.length = 0;
  appState.update({
    hasPdf: true,
    totalPages: pdfRenderer.numPages,
    activePageIndex: 0,
    zoom: 1,
    units: { ...p.units },
    undoAvailable: false,
    redoAvailable: false,
  });

  showCanvas(true);
  await renderPage(0);
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
    if (ctrl && e.key === 'o') { e.preventDefault(); document.getElementById('file-input-pdf')?.click(); return; }
    if (ctrl && e.key === 's') { e.preventDefault(); if (pdfBytes) exportProjectFile(project, pdfBytes, project.pdfFileName || 'redline'); return; }
    if (ctrl && e.key === 'e') { e.preventDefault(); document.getElementById('btn-export-pdf')?.click(); return; }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      removeSelectedMarkups();
      return;
    }

    // Tool shortcuts
    if (!ctrl) {
      const toolKeys: Record<string, ToolType> = {
        'v': 'select', 'h': 'pan', 'p': 'pen', 'l': 'line', 'a': 'arrow',
        'r': 'rect', 'e': 'ellipse', 'b': 'box', 't': 'text',
        's': 'scale-set', 'm': 'measure-linear',
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
      if (e.key === 'f' || e.key === 'F') appState.emit('cmd-fit-width');
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
  appState.on('cmd-fit-width', async () => {
    if (!pdfRenderer || !stageManager) return;
    const container = document.getElementById('canvas-scroll-container')!;
    const { widthPts } = await pdfRenderer.getPageSizePts(appState.state.activePageIndex);
    const newZoom = fitWidthScale(widthPts, container.clientWidth);
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

async function init(): Promise<void> {
  initToolbar();
  initPropertiesPanel();
  setupDragDrop();
  setupFileInputs();
  setupKeyboardShortcuts();
  setupStateListeners();

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

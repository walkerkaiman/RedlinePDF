import { appState, type ToolType } from '../state/appState.ts';

/**
 * Toolbar initialization and update logic.
 * Wires up all toolbar button click handlers and keeps button states in sync.
 */

export function initToolbar(): void {
  // Tool buttons
  document.querySelectorAll<HTMLButtonElement>('.tool-btn').forEach(btn => {
    const tool = btn.dataset.tool as ToolType;
    if (!tool) return;
    btn.addEventListener('click', () => appState.setTool(tool));
  });

  // File operation buttons are wired in main.ts setupFileInputs() to support Tauri native dialogs

  // Undo/redo (dispatched to main app via events)
  document.getElementById('btn-undo')?.addEventListener('click', () => appState.emit('cmd-undo'));
  document.getElementById('btn-redo')?.addEventListener('click', () => appState.emit('cmd-redo'));

  // Delete selected
  document.getElementById('btn-delete')?.addEventListener('click', () => appState.emit('cmd-delete'));

  // Copy selected (dispatches to main.ts)
  document.getElementById('btn-copy')?.addEventListener('click', () => appState.emit('cmd-copy'));

  // Zoom controls
  document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
    appState.setZoom(appState.state.zoom * 1.25);
  });
  document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
    appState.setZoom(appState.state.zoom / 1.25);
  });
  document.getElementById('btn-fit-width')?.addEventListener('click', () => {
    appState.emit('cmd-fit-page');
  });

  // Page navigation
  document.getElementById('btn-prev-page')?.addEventListener('click', () => {
    appState.setPage(appState.state.activePageIndex - 1);
  });
  document.getElementById('btn-next-page')?.addEventListener('click', () => {
    appState.setPage(appState.state.activePageIndex + 1);
  });

  // Units selector
  const unitsSelect = document.getElementById('units-select') as HTMLSelectElement;
  unitsSelect?.addEventListener('change', () => {
    appState.setUnits(unitsSelect.value as import('../model/document.ts').LinearUnit);
  });

  // Sync state → UI
  appState.subscribe((state) => {
    // Highlight active tool button
    document.querySelectorAll<HTMLButtonElement>('.tool-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === state.activeTool);
    });

    // Enable/disable PDF-dependent buttons
    const hasPdf = state.hasPdf;
    const pdfBtns = ['btn-save-project', 'btn-save-project-as', 'btn-snapshot', 'btn-export-pdf', 'btn-zoom-in', 'btn-zoom-out', 'btn-fit-width'];
    pdfBtns.forEach(id => {
      const btn = document.getElementById(id) as HTMLButtonElement;
      if (btn) btn.disabled = !hasPdf;
    });

    // Page nav
    const prevBtn = document.getElementById('btn-prev-page') as HTMLButtonElement;
    const nextBtn = document.getElementById('btn-next-page') as HTMLButtonElement;
    if (prevBtn) prevBtn.disabled = !hasPdf || state.activePageIndex <= 0;
    if (nextBtn) nextBtn.disabled = !hasPdf || state.activePageIndex >= state.totalPages - 1;

    // Undo/redo
    const undoBtn = document.getElementById('btn-undo') as HTMLButtonElement;
    const redoBtn = document.getElementById('btn-redo') as HTMLButtonElement;
    if (undoBtn) undoBtn.disabled = !state.undoAvailable;
    if (redoBtn) redoBtn.disabled = !state.redoAvailable;

    // Delete
    const delBtn = document.getElementById('btn-delete') as HTMLButtonElement;
    if (delBtn) delBtn.disabled = !state.selectedMarkupId;

    // Copy button: enable when markup is selected, disable otherwise
    const copyBtn = document.getElementById('btn-copy') as HTMLButtonElement;
    if (copyBtn) copyBtn.disabled = !state.selectedMarkupId;

    // Page indicator
    const indicator = document.getElementById('page-indicator');
    if (indicator) {
      indicator.textContent = hasPdf ? `${state.activePageIndex + 1} / ${state.totalPages}` : '— / —';
    }

    // Units selector
    if (unitsSelect && unitsSelect.value !== state.units.linearUnit) {
      unitsSelect.value = state.units.linearUnit;
    }

    // Status bar
    updateStatusBar(state);
  });
}

function updateStatusBar(state: ReturnType<typeof appState.state.constructor['prototype']> | typeof appState.state): void {
  const pageSt = document.getElementById('status-page');
  const zoomSt = document.getElementById('status-zoom');
  const unitsSt = document.getElementById('status-units');

  if (pageSt) {
    pageSt.textContent = state.hasPdf
      ? `Page ${state.activePageIndex + 1} of ${state.totalPages}`
      : 'No document';
  }
  if (zoomSt) {
    zoomSt.textContent = `${Math.round(state.zoom * 100)}%`;
  }
  if (unitsSt) {
    const unitMap: Record<string, string> = {
      'ft-in': 'Imperial (ft-in)',
      'ft': 'Imperial (ft)',
      'in': 'Imperial (in)',
      'yd': 'Imperial (yd)',
      'm': 'Metric (m)',
      'cm': 'Metric (cm)',
      'mm': 'Metric (mm)',
    };
    unitsSt.textContent = unitMap[state.units.linearUnit] ?? state.units.linearUnit;
  }
}

/** Show cursor position on the status bar */
export function updateCursorStatus(x: number, y: number): void {
  const cursorSt = document.getElementById('status-cursor');
  if (cursorSt) cursorSt.textContent = `x: ${x.toFixed(1)}  y: ${y.toFixed(1)}`;
}


/** Show/hide drop zone vs canvas */
export function showCanvas(show: boolean): void {
  const dropZone = document.getElementById('drop-zone');
  const canvasScroll = document.getElementById('canvas-scroll-container');
  if (dropZone) dropZone.style.display = show ? 'none' : 'flex';
  if (canvasScroll) canvasScroll.style.display = show ? 'block' : 'none';
}

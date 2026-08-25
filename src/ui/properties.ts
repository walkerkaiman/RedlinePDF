import { appState } from '../state/appState.ts';
import { createColorPicker } from './colorPicker.ts';
import type { MarkupStyle, MarkupType } from '../model/document.ts';
import { COUNT_SYMBOLS } from '../model/document.ts';

/**
 * Properties panel on the right side.
 * Shows context-sensitive controls based on the active tool / selection.
 */

export function initPropertiesPanel(): void {
  const panel = document.getElementById('properties-content')!;

  let lastTool: string | null = null;
  let lastMarkupIds = '';
  let lastMarkupTypes = '';
  let lastCountKey = '';

  appState.subscribe((state) => {
    const idsKey = state.selectedMarkupIds.join(',');
    const typesKey = state.selectedMarkupTypes.join(',');
    // For the count tool: rebuild when category list changes (add/delete) OR active
    // category changes (row highlight). Count values alone (stamps placed) do NOT
    // rebuild — those are handled imperatively by the count-summary-change handler.
    const countKey = state.activeTool === 'count'
      ? `${state.countSummary.map(s => s.id).join(',')}|${state.activeCountCategoryId}`
      : '';
    if (
      state.activeTool === lastTool &&
      idsKey === lastMarkupIds &&
      typesKey === lastMarkupTypes &&
      countKey === lastCountKey
    ) {
      return;
    }
    lastTool = state.activeTool;
    lastMarkupIds = idsKey;
    lastMarkupTypes = typesKey;
    lastCountKey = countKey;
    renderPanel(panel, state);
  });

  // Badge-only update: update count numbers in the panel without rebuilding it.
  appState.on('count-summary-change', () => {
    if (appState.state.activeTool !== 'count') return;
    const summary = appState.state.countSummary;
    summary.forEach(item => {
      const badge = panel.querySelector<HTMLSpanElement>(`[data-count-badge="${item.id}"]`);
      if (badge) badge.textContent = String(item.count);
    });
  });

  // Size-only update: sync the slider value label without rebuilding the panel.
  appState.on('cmd-count-set-size', (data) => {
    if (appState.state.activeTool !== 'count') return;
    const { size } = data as { size: number };
    const sec = panel.querySelector<HTMLElement>('[data-count-size-section]');
    const valueEl = sec?.querySelector<HTMLSpanElement>('.slider-value');
    if (valueEl) valueEl.textContent = `${size} pt`;
  });

  renderPanel(panel, appState.state);
}

function renderPanel(panel: HTMLElement, state: typeof appState.state): void {
  panel.innerHTML = '';

  const { activeTool, activeStyle: style, selectedMarkupIds, selectedMarkupTypes } = state;

  const isSelect = activeTool === 'select';
  const hasSelection = selectedMarkupIds.length > 0;
  const isMulti = selectedMarkupIds.length > 1;

  // ── Nav / utility tools with no selection ────────────────────────────────

  if (activeTool === 'pan') {
    panel.innerHTML = '<p class="prop-hint">Pan mode. Click and drag to navigate.</p>';
    return;
  }

  if (activeTool === 'scale-set') {
    panel.innerHTML = `
      <div class="prop-section">
        <h4 class="prop-title">Set Drawing Scale</h4>
        <ol class="prop-hint-list">
          <li>Click the first point on a known dimension.</li>
          <li>Click the second point.</li>
          <li>Enter the real-world distance in the dialog.</li>
        </ol>
        <p class="prop-hint">Each page can have its own scale.</p>
      </div>`;
    return;
  }

  if (activeTool === 'count' && !hasSelection) {
    renderCountPanel(panel, state);
    return;
  }

  if (isSelect && !hasSelection) {
    panel.innerHTML = '<p class="prop-hint">Click an object to select it, or drag to select multiple.</p>';
    return;
  }

  // ── Resolve effective set of types to display ─────────────────────────────
  // For an active drawing tool, the "type" is just that tool.
  // For a selection, use the types of selected markups.

  const measureToolNames = ['measure-linear', 'measure-rect', 'measure-poly'];
  const countToolNames: MarkupType[] = ['count', 'count-legend'];

  let effectiveTypes: MarkupType[];
  if (isSelect && hasSelection) {
    effectiveTypes = selectedMarkupTypes;
  } else {
    effectiveTypes = [activeTool as MarkupType];
  }

  // ── Measurement tool (drawing mode, no selection) ────────────────────────
  if (!isSelect && measureToolNames.includes(activeTool)) {
    panel.innerHTML = `
      <div class="prop-section">
        <h4 class="prop-title">Measurement</h4>
        <p class="prop-hint" id="measure-scale-status"></p>
      </div>`;
    updateMeasureStatus();
    return;
  }

  // ── Count markup selected ─────────────────────────────────────────────────
  const isCountSelected = isSelect && hasSelection && effectiveTypes.every(t => countToolNames.includes(t));
  if (isCountSelected) {
    const section = document.createElement('div');
    section.className = 'prop-section';
    const typeLabel = effectiveTypes[0] === 'count-legend' ? 'Count Legend' : 'Count Stamp';
    section.innerHTML = `<h4 class="prop-title">${typeLabel}</h4><p class="prop-hint">Move with the Select tool. Delete removes the stamp and updates the legend.</p>`;
    panel.appendChild(section);
    return;
  }

  // ── Multi-select or single-select header ──────────────────────────────────

  if (isSelect && hasSelection) {
    const header = document.createElement('div');
    header.className = 'prop-section';
    if (isMulti) {
      const countLabel = `${selectedMarkupIds.length} elements selected`;
      const typesList = [...new Set(effectiveTypes.map(markupTypeLabel))].join(', ');
      header.innerHTML = `<h4 class="prop-title">${countLabel}</h4><p class="prop-hint">${typesList}</p>`;
    } else {
      header.innerHTML = `<h4 class="prop-title">${markupTypeLabel(effectiveTypes[0])} Properties</h4>`;
    }
    panel.appendChild(header);
  }

  // ── Determine which property sections to show ─────────────────────────────

  const typesSet = new Set(effectiveTypes);

  const strokeTypes: MarkupType[] = ['pen', 'line', 'arrow', 'ellipse', 'box', 'measure-linear', 'measure-rect', 'measure-poly', 'polygon-area'];
  const fillTypes: MarkupType[] = ['box', 'ellipse', 'polygon-area'];
  const textTypes: MarkupType[] = ['text'];
  const measureSelectedTypes: MarkupType[] = ['measure-linear', 'measure-rect', 'measure-poly'];

  const showStroke = strokeTypes.some(t => typesSet.has(t));
  const showFill   = fillTypes.some(t => typesSet.has(t));
  const showText   = textTypes.some(t => typesSet.has(t));
  const showMeasureInfo = measureSelectedTypes.some(t => typesSet.has(t)) && isSelect && hasSelection;

  // Image props (populated by main.ts via appState.selectedImageProps)
  const imageProps = state.selectedImageProps;
  // Label for the stroke/border section:
  // call it "Border" when the selection contains only rect/box types (and no pen/line etc.)
  const borderOnlyTypes = new Set<MarkupType>(['box']);
  const strokeSectionLabel =
    showStroke && [...typesSet].filter(t => strokeTypes.includes(t)).every(t => borderOnlyTypes.has(t))
      ? 'Border'
      : 'Stroke';

  // ── Stroke / Border section ───────────────────────────────────────────────

  if (showStroke) {
    const strokeSection = document.createElement('div');
    strokeSection.className = 'prop-section';
    strokeSection.innerHTML = `<h4 class="prop-title">${strokeSectionLabel}</h4>`;

    strokeSection.appendChild(createColorPicker({
      label: 'Color',
      initialColor: style.strokeColor ?? '#e63946',
      onChange: (c) => appState.setStyleProp('strokeColor', c),
    }));
    strokeSection.appendChild(createSliderRow('Width', style.strokeWidth ?? 2, 0, 20, 1, (v) => {
      appState.setStyleProp('strokeWidth', v);
    }));
    strokeSection.appendChild(createSliderRow('Opacity', (style.strokeOpacity ?? 1) * 100, 0, 100, 5, (v) => {
      appState.setStyleProp('strokeOpacity', v / 100);
    }, '%'));

    panel.appendChild(strokeSection);
  }

  // ── Fill section (box only) ───────────────────────────────────────────────

  if (showFill) {
    const fillSection = document.createElement('div');
    fillSection.className = 'prop-section';
    fillSection.innerHTML = `<h4 class="prop-title">Fill</h4>`;

    fillSection.appendChild(createColorPicker({
      label: 'Color',
      initialColor: style.fillColor ?? '#e63946',
      onChange: (c) => appState.setStyleProp('fillColor', c),
    }));
    fillSection.appendChild(createSliderRow('Opacity', (style.fillOpacity ?? 0.2) * 100, 0, 100, 5, (v) => {
      appState.setStyleProp('fillOpacity', v / 100);
    }, '%'));

    panel.appendChild(fillSection);
  }

  // ── Text section ──────────────────────────────────────────────────────────

  if (showText) {
    const textSection = document.createElement('div');
    textSection.className = 'prop-section';
    textSection.innerHTML = `<h4 class="prop-title">Text</h4>`;

    textSection.appendChild(createSelectRow('Font', style.fontFamily ?? 'Arial',
      [
        { value: 'Arial', label: 'Arial' },
        { value: 'Helvetica', label: 'Helvetica' },
        { value: 'Times New Roman', label: 'Times New Roman' },
        { value: 'Courier New', label: 'Courier New' },
        { value: 'Georgia', label: 'Georgia' },
        { value: 'Verdana', label: 'Verdana' },
      ],
      (v) => appState.setStyleProp('fontFamily', v),
    ));
    textSection.appendChild(createSliderRow('Size', style.fontSize ?? 12, 6, 72, 1, (v) => {
      appState.setStyleProp('fontSize', v);
    }, 'pt'));

    const styleRow = document.createElement('div');
    styleRow.className = 'prop-row';
    styleRow.innerHTML = `
      <label>Style</label>
      <div class="toggle-group">
        <button class="prop-toggle ${style.bold ? 'active' : ''}" id="prop-bold" title="Bold"><b>B</b></button>
        <button class="prop-toggle ${style.italic ? 'active' : ''}" id="prop-italic" title="Italic"><i>I</i></button>
      </div>`;
    textSection.appendChild(styleRow);

    textSection.appendChild(createColorPicker({
      label: 'Text Color',
      initialColor: style.textColor ?? '#e63946',
      onChange: (c) => appState.setStyleProp('textColor', c),
    }));

    panel.appendChild(textSection);

    const bgSection = document.createElement('div');
    bgSection.className = 'prop-section';
    bgSection.innerHTML = `<h4 class="prop-title">Background</h4>`;
    bgSection.appendChild(createColorPicker({
      label: 'Color',
      initialColor: style.bgColor ?? '#ffffff',
      onChange: (c) => appState.setStyleProp('bgColor', c),
    }));
    bgSection.appendChild(createSliderRow('Opacity', (style.bgOpacity ?? 0.8) * 100, 0, 100, 5, (v) => {
      appState.setStyleProp('bgOpacity', v / 100);
    }, '%'));
    panel.appendChild(bgSection);

    setTimeout(() => {
      document.getElementById('prop-bold')?.addEventListener('click', () => {
        appState.setStyleProp('bold', !appState.state.activeStyle.bold);
      });
      document.getElementById('prop-italic')?.addEventListener('click', () => {
        appState.setStyleProp('italic', !appState.state.activeStyle.italic);
      });
    }, 0);
  }

  // ── Measurement info (when a measure markup is selected) ──────────────────

  if (showMeasureInfo) {
    const infoSection = document.createElement('div');
    infoSection.className = 'prop-section';
    infoSection.innerHTML = `<p class="prop-hint" id="measure-scale-status"></p>`;
    panel.appendChild(infoSection);
    updateMeasureStatus();
  }

  // ── Image properties ───────────────────────────────────────────────────────

  if (imageProps) {
    const imgSection = document.createElement('div');
    imgSection.className = 'prop-section';
    imgSection.innerHTML = `<h4 class="prop-title">Image</h4>`;

    imgSection.appendChild(createSliderRow(
      'Opacity', Math.round(imageProps.opacity * 100), 0, 100, 5,
      (v) => appState.emit('image-prop-change', { prop: 'opacity', value: v / 100 }), '%'
    ));
    imgSection.appendChild(createColorPicker({
      label: 'Stroke Color', initialColor: imageProps.strokeColor,
      onChange: (c) => appState.emit('image-prop-change', { prop: 'strokeColor', value: c }),
    }));
    imgSection.appendChild(createSliderRow(
      'Stroke Width', imageProps.strokeWidth, 0, 12, 1,
      (v) => appState.emit('image-prop-change', { prop: 'strokeWidth', value: v })
    ));
    imgSection.appendChild(createSliderRow(
      'Stroke Opacity', Math.round(imageProps.strokeOpacity * 100), 0, 100, 5,
      (v) => appState.emit('image-prop-change', { prop: 'strokeOpacity', value: v / 100 }), '%'
    ));

    panel.appendChild(imgSection);
  }
}

function renderCountPanel(panel: HTMLElement, state: typeof appState.state): void {
  panel.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'prop-section';
  header.innerHTML = `<h4 class="prop-title">Count Items</h4><p class="prop-hint">Select a category then click the drawing to stamp symbols.</p>`;
  panel.appendChild(header);

  const listSection = document.createElement('div');
  listSection.className = 'prop-section count-category-list';

  state.countSummary.forEach(item => {
    const row = document.createElement('div');
    row.className = `count-row${state.activeCountCategoryId === item.id ? ' count-row-active' : ''}`;
    row.dataset.countId = item.id;

    // Clicking the row sets it as active
    row.addEventListener('click', () => {
      appState.emit('cmd-count-set-active', { id: item.id });
    });

    // Symbol select
    const symSelect = document.createElement('select');
    symSelect.className = 'count-symbol-select';
    symSelect.title = 'Symbol shape';
    COUNT_SYMBOLS.forEach(sym => {
      const opt = document.createElement('option');
      opt.value = sym;
      opt.textContent = { circle: '●', square: '■', triangle: '▲', diamond: '◆', cross: '✕' }[sym];
      if (sym === item.symbol) opt.selected = true;
      symSelect.appendChild(opt);
    });
    symSelect.addEventListener('change', (e) => {
      e.stopPropagation();
      appState.emit('cmd-count-set-symbol', { id: item.id, symbol: (e.target as HTMLSelectElement).value });
    });
    row.appendChild(symSelect);

    // Color swatch (reuse createColorPicker but inline-ish: just use a color input)
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'count-color-swatch';
    colorInput.value = item.color;
    colorInput.title = 'Category color';
    colorInput.addEventListener('click', e => e.stopPropagation());
    colorInput.addEventListener('input', (e) => {
      appState.emit('cmd-count-set-color', { id: item.id, color: (e.target as HTMLInputElement).value });
    });
    row.appendChild(colorInput);

    // Name input
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'count-name-input';
    nameInput.value = item.name;
    nameInput.placeholder = 'Category name';
    nameInput.addEventListener('click', e => e.stopPropagation());
    nameInput.addEventListener('change', (e) => {
      appState.emit('cmd-count-rename', { id: item.id, name: (e.target as HTMLInputElement).value.trim() || item.name });
    });
    row.appendChild(nameInput);

    // Count badge
    const badge = document.createElement('span');
    badge.className = 'count-badge';
    badge.dataset.countBadge = item.id;
    badge.textContent = String(item.count);
    row.appendChild(badge);

    // Delete button
    const del = document.createElement('button');
    del.className = 'count-delete-btn';
    del.title = 'Remove category and all its stamps';
    del.textContent = '×';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      appState.emit('cmd-count-delete', { id: item.id });
    });
    row.appendChild(del);

    listSection.appendChild(row);
  });

  panel.appendChild(listSection);

  // "Add New Count" button
  const addBtn = document.createElement('button');
  addBtn.className = 'count-add-btn';
  addBtn.textContent = '+ Add New Count';
  addBtn.addEventListener('click', () => appState.emit('cmd-count-add-category'));
  panel.appendChild(addBtn);

  // Symbol size slider
  const sizeSection = document.createElement('div');
  sizeSection.className = 'prop-section';
  sizeSection.dataset.countSizeSection = '1';
  sizeSection.innerHTML = `<h4 class="prop-title">Symbol Size</h4>`;
  sizeSection.appendChild(createSliderRow('Size', state.countSymbolSize, 4, 32, 1, (v) => {
    appState.emit('cmd-count-set-size', { size: v });
  }, 'pt'));
  panel.appendChild(sizeSection);
}

function markupTypeLabel(type: MarkupType): string {
  const labels: Record<MarkupType, string> = {
    pen: 'Pen',
    line: 'Line',
    arrow: 'Arrow',
    ellipse: 'Ellipse',
    box: 'Box',
    text: 'Text',
    'measure-linear': 'Linear Measurement',
    'measure-rect': 'Rectangle Measurement',
    'measure-poly': 'Polygon Measurement',
    'polygon-area': 'Polygon Area',
    'count': 'Count Stamp',
    'count-legend': 'Count Legend',
    'image': 'Image',
  };
  return labels[type] ?? type;
}

function updateMeasureStatus(): void {
  const el = document.getElementById('measure-scale-status');
  if (!el) return;
  const page = appState.state.activePageIndex;
  el.textContent = `Page ${page + 1} scale: ${appState.state.hasPdf ? 'use Set Scale tool to calibrate' : 'no document'}`;
}

function createSliderRow(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (v: number) => void,
  unit = ''
): HTMLElement {
  const isPercent = unit === '%';
  const row = document.createElement('div');
  row.className = 'prop-row';
  const id = `prop-slider-${label.toLowerCase().replace(/\s/g, '-')}-${Math.random().toString(36).slice(2, 5)}`;
  row.innerHTML = `
    <label for="${id}">${label}</label>
    <div class="slider-group">
      <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}" />
      <span class="slider-value" title="Double-click to type a value">${value}${unit}</span>
    </div>`;
  const rangeInput = row.querySelector<HTMLInputElement>('input[type="range"]')!;
  const display = row.querySelector<HTMLSpanElement>('.slider-value')!;

  const applyLabel = (raw: number) => {
    // Cheap, synchronous label + thumb update — safe to run on every drag frame.
    const clamped = isPercent
      ? Math.max(0, Math.min(100, raw))
      : Math.max(min, raw);
    display.textContent = `${clamped}${unit}`;
    rangeInput.value = String(Math.min(clamped, max));
  };

  const applyValue = (raw: number) => {
    // Full commit: clamps, updates label, AND pushes the value into appState
    // (triggers re-render + undo snapshot — only do this on `change`, i.e. release).
    const clamped = isPercent
      ? Math.max(0, Math.min(100, raw))
      : Math.max(min, raw);
    display.textContent = `${clamped}${unit}`;
    rangeInput.value = String(Math.min(clamped, max));
    onChange(clamped);
  };

  // Smooth drag: update the label live on every frame, but only COMMIT (re-render +
  // undo-snapshot) when the user releases the thumb / commits via keyboard (`change`).
  rangeInput.addEventListener('input', () => applyLabel(parseFloat(rangeInput.value)));
  rangeInput.addEventListener('change', () => applyValue(parseFloat(rangeInput.value)));

  // ── Double-click to type a value manually ───────────────────────────────
  display.addEventListener('dblclick', () => {
    const currentNum = parseFloat(display.textContent ?? '0') || 0;

    const numInput = document.createElement('input');
    numInput.type = 'number';
    numInput.className = 'slider-value-input';
    numInput.value = String(currentNum);
    numInput.step = String(step);
    numInput.min = String(min);
    if (isPercent) numInput.max = '100';
    display.replaceWith(numInput);
    numInput.focus();
    numInput.select();

    const commit = () => {
      const parsed = parseFloat(numInput.value);
      const safe = isNaN(parsed) ? currentNum : parsed;
      // Rebuild the display span and put it back.
      display.textContent = `${isPercent ? Math.max(0, Math.min(100, safe)) : Math.max(min, safe)}${unit}`;
      numInput.replaceWith(display);
      applyValue(safe);
    };

    numInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { numInput.replaceWith(display); }
    });
    numInput.addEventListener('blur', commit);
  });

  return row;
}

function createSelectRow(
  label: string,
  value: string,
  options: Array<{ value: string; label: string }>,
  onChange: (v: string) => void
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'prop-row';
  const id = `prop-select-${Math.random().toString(36).slice(2, 5)}`;
  const optionsHtml = options.map(o => `<option value="${o.value}"${o.value === value ? ' selected' : ''}>${o.label}</option>`).join('');
  row.innerHTML = `<label for="${id}">${label}</label><select id="${id}">${optionsHtml}</select>`;
  row.querySelector('select')!.addEventListener('change', (e) => {
    onChange((e.target as HTMLSelectElement).value);
  });
  return row;
}

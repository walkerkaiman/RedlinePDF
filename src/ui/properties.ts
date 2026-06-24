import { appState } from '../state/appState.ts';
import { createColorPicker } from './colorPicker.ts';
import type { MarkupStyle, MarkupType } from '../model/document.ts';

/**
 * Properties panel on the right side.
 * Shows context-sensitive controls based on the active tool / selection.
 */

export function initPropertiesPanel(): void {
  const panel = document.getElementById('properties-content')!;

  // Track structural context so we only rebuild the panel when the tool or
  // selected markup(s) actually change — NOT on every style-prop update.
  // Without this guard, dragging a slider triggers setStyleProp → state change
  // → panel rebuild → slider element destroyed mid-drag → drag snaps to click.
  let lastTool: string | null = null;
  let lastMarkupIds = '';
  let lastMarkupTypes = '';

  appState.subscribe((state) => {
    const idsKey = state.selectedMarkupIds.join(',');
    const typesKey = state.selectedMarkupTypes.join(',');
    if (
      state.activeTool === lastTool &&
      idsKey === lastMarkupIds &&
      typesKey === lastMarkupTypes
    ) {
      return; // style-only change — the panel DOM is still correct
    }
    lastTool = state.activeTool;
    lastMarkupIds = idsKey;
    lastMarkupTypes = typesKey;
    renderPanel(panel, state);
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

  if (isSelect && !hasSelection) {
    panel.innerHTML = '<p class="prop-hint">Click an object to select it, or drag to select multiple.</p>';
    return;
  }

  // ── Resolve effective set of types to display ─────────────────────────────
  // For an active drawing tool, the "type" is just that tool.
  // For a selection, use the types of selected markups.

  const measureToolNames = ['measure-linear', 'measure-rect', 'measure-poly'];

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

  const strokeTypes: MarkupType[] = ['pen', 'line', 'arrow', 'rect', 'ellipse', 'box', 'measure-linear', 'measure-rect', 'measure-poly'];
  const fillTypes: MarkupType[] = ['box'];
  const textTypes: MarkupType[] = ['text'];
  const measureSelectedTypes: MarkupType[] = ['measure-linear', 'measure-rect', 'measure-poly'];

  const showStroke = strokeTypes.some(t => typesSet.has(t));
  const showFill   = fillTypes.some(t => typesSet.has(t));
  const showText   = textTypes.some(t => typesSet.has(t));
  const showMeasureInfo = measureSelectedTypes.some(t => typesSet.has(t)) && isSelect && hasSelection;

  // Label for the stroke/border section:
  // call it "Border" when the selection contains only rect/box types (and no pen/line etc.)
  const borderOnlyTypes = new Set<MarkupType>(['rect', 'box']);
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
}

function markupTypeLabel(type: MarkupType): string {
  const labels: Record<MarkupType, string> = {
    pen: 'Pen',
    line: 'Line',
    arrow: 'Arrow',
    rect: 'Rectangle',
    ellipse: 'Ellipse',
    box: 'Box',
    text: 'Text',
    'measure-linear': 'Linear Measurement',
    'measure-rect': 'Rectangle Measurement',
    'measure-poly': 'Polygon Measurement',
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
  const row = document.createElement('div');
  row.className = 'prop-row';
  const id = `prop-slider-${label.toLowerCase().replace(/\s/g, '-')}-${Math.random().toString(36).slice(2, 5)}`;
  row.innerHTML = `
    <label for="${id}">${label}</label>
    <div class="slider-group">
      <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}" />
      <span class="slider-value">${value}${unit}</span>
    </div>`;
  const input = row.querySelector<HTMLInputElement>('input[type="range"]')!;
  const display = row.querySelector<HTMLSpanElement>('.slider-value')!;
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    display.textContent = `${v}${unit}`;
    onChange(v);
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

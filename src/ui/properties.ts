import { appState } from '../state/appState.ts';
import { createColorPicker } from './colorPicker.ts';
import type { MarkupStyle, MarkupType } from '../model/document.ts';

/**
 * Properties panel on the right side.
 * Shows context-sensitive controls based on the active tool.
 */

export function initPropertiesPanel(): void {
  const panel = document.getElementById('properties-content')!;

  appState.subscribe((state) => {
    renderPanel(panel, state.activeTool, state.activeStyle, state.selectedMarkupId, state.selectedMarkupType);
  });

  renderPanel(panel, appState.state.activeTool, appState.state.activeStyle, appState.state.selectedMarkupId, appState.state.selectedMarkupType);
}

function renderPanel(
  panel: HTMLElement,
  tool: string,
  style: MarkupStyle,
  selectedMarkupId: string | null,
  selectedMarkupType: MarkupType | null,
): void {
  panel.innerHTML = '';

  const strokeTools: string[] = ['pen', 'line', 'arrow', 'rect', 'ellipse'];
  const fillTools: string[] = ['box'];
  const textTools: string[] = ['text'];
  const measureTools: string[] = ['measure-linear', 'measure-rect', 'measure-poly'];

  // When a markup is selected in select mode, treat the panel as if
  // the active "tool" were the type of the selected markup.
  const effectiveTool =
    tool === 'select' && selectedMarkupId && selectedMarkupType
      ? selectedMarkupType
      : tool;

  // ── Nav / utility tools ───────────────────────────────────────────────────

  if (effectiveTool === 'select') {
    panel.innerHTML = '<p class="prop-hint">Click an object to select it and edit its properties.</p>';
    return;
  }

  if (effectiveTool === 'pan') {
    panel.innerHTML = '<p class="prop-hint">Pan mode. Click and drag to navigate.</p>';
    return;
  }

  if (effectiveTool === 'scale-set') {
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

  if (measureTools.includes(effectiveTool)) {
    panel.innerHTML = `
      <div class="prop-section">
        <h4 class="prop-title">Measurement</h4>
        <p class="prop-hint" id="measure-scale-status"></p>
      </div>`;
    updateMeasureStatus();
    return;
  }

  // ── Drawing / markup tools ────────────────────────────────────────────────

  // Header when showing a selected object's properties
  if (tool === 'select' && selectedMarkupId) {
    const header = document.createElement('div');
    header.className = 'prop-section';
    header.innerHTML = `<h4 class="prop-title">${markupTypeLabel(selectedMarkupType!)} Properties</h4>`;
    panel.appendChild(header);
  }

  if ([...strokeTools, ...fillTools].includes(effectiveTool)) {
    const strokeSection = document.createElement('div');
    strokeSection.className = 'prop-section';
    strokeSection.innerHTML = `<h4 class="prop-title">Stroke</h4>`;

    strokeSection.appendChild(createColorPicker({
      label: 'Color',
      initialColor: style.strokeColor ?? '#e63946',
      onChange: (c) => appState.setStyleProp('strokeColor', c),
    }));

    strokeSection.appendChild(createSliderRow('Width', style.strokeWidth ?? 2, 1, 20, 1, (v) => {
      appState.setStyleProp('strokeWidth', v);
    }));

    strokeSection.appendChild(createSliderRow('Opacity', (style.strokeOpacity ?? 1) * 100, 0, 100, 5, (v) => {
      appState.setStyleProp('strokeOpacity', v / 100);
    }, '%'));

    panel.appendChild(strokeSection);
  }

  if (fillTools.includes(effectiveTool)) {
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

    const borderSection = document.createElement('div');
    borderSection.className = 'prop-section';
    borderSection.innerHTML = `<h4 class="prop-title">Border</h4>`;
    borderSection.appendChild(createColorPicker({
      label: 'Color',
      initialColor: style.strokeColor ?? '#e63946',
      onChange: (c) => appState.setStyleProp('strokeColor', c),
    }));
    borderSection.appendChild(createSliderRow('Width', style.strokeWidth ?? 2, 0, 20, 1, (v) => {
      appState.setStyleProp('strokeWidth', v);
    }));
    panel.appendChild(borderSection);
  }

  if (textTools.includes(effectiveTool)) {
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

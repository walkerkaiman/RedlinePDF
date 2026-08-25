import Konva from 'konva';
import type { ToolProtocol } from './toolProtocol';
import { toolRunner } from './toolRunner';
import { konvaToPdf, distance } from '../geometry/transform.ts';
import { computeScale } from '../measure/scale.ts';
import { appState } from '../state/appState.ts';
import { showModal } from '../ui/modal.ts';
import type { LinearUnit } from '../model/document.ts';

/**
 * Set Scale tool — CLICK-ONLY, two-point calibration.
 * Click 1 drops a dot + starts a rubber-band line; click 2 finalizes and opens the calibration
 * modal (set the real-world distance + unit). On confirm it emits `scale-set`, which main.ts
 * handles: the scale is stored per-page and mirrored into appState.state.scale so the measure
 * tools can read it. If a measure tool was pending, main.ts auto-switches back to it.
 * Module state (`phase`, `point1`, preview nodes) is reset in clearPreview().
 */
// Click-state lives in module scope (ToolProtocol objects are stateless by design).
type ScalePhase = 'idle' | 'awaiting-second-point';
let phase: ScalePhase = 'idle';
let point1: { x: number; y: number } | null = null;
let dot1: Konva.Circle | null = null;
let dot2: Konva.Circle | null = null;
let previewLine: Konva.Line | null = null;

function clearPreview(): void {
  const sm = toolRunner.getStageManager();
  previewLine?.destroy(); previewLine = null;
  dot1?.destroy(); dot1 = null;
  dot2?.destroy(); dot2 = null;
  point1 = null;
  phase = 'idle';
  sm?.interactionLayer?.draw();
}

async function openCalibration(distancePts: number): Promise<void> {
  const units = appState.state.units;
  const unitOptions = [
    { value: 'ft', label: "Feet (ft)" },
    { value: 'in', label: 'Inches (in)' },
    { value: 'ft-in', label: 'Feet (decimal, e.g. 10.5 = 10\'-6")' },
    { value: 'yd', label: 'Yards (yd)' },
    { value: 'm', label: 'Meters (m)' },
    { value: 'cm', label: 'Centimeters (cm)' },
    { value: 'mm', label: 'Millimeters (mm)' },
  ];
  const currentUnit = units.linearUnit === 'ft-in' ? 'ft' : units.linearUnit;
  const optionsHtml = unitOptions
    .map(o => `<option value="${o.value}"${o.value === currentUnit ? ' selected' : ''}>${o.label}</option>`)
    .join('');

  const body = `
    <p>Click two points on a known dimension, then enter the real-world length below.</p>
    <div class="form-row">
      <label>Known distance:</label>
      <input type="number" id="scale-value" min="0.001" step="any" value="" placeholder="e.g. 10" style="width:100px;margin-right:8px;" />
      <select id="scale-unit">${optionsHtml}</select>
    </div>
    <p class="modal-hint">Tip: pick two points on a dimension line you know (e.g. a 10-foot wall).</p>
  `;

  const result = await showModal('Set Drawing Scale', body, 'Apply Scale');
  if (!result) return;

  const valEl = document.getElementById('scale-value') as HTMLInputElement;
  const unitEl = document.getElementById('scale-unit') as HTMLSelectElement;
  const value = parseFloat(valEl?.value ?? '');
  const unit = (unitEl?.value ?? 'ft') as LinearUnit;
  if (isNaN(value) || value <= 0) return;

  const scale = computeScale(distancePts, value, unit);
  if (scale.calibrated) {
    appState.emit('scale-set', { pageIndex: toolRunner.getPageIndex(), scale });
  }
}

export const scaleSetTool: ToolProtocol = {
  id: 'scale-set',
  name: 'Set Scale',
  key: 's',

  onClick(e: { x: number; y: number }) {
    const sm = toolRunner.getStageManager();
    if (!sm?.interactionLayer) return;
    const layer = sm.interactionLayer as unknown as Konva.Layer;

    if (phase === 'idle' || !point1) {
      phase = 'awaiting-second-point';
      point1 = { ...e };
      dot1 = new Konva.Circle({ x: e.x, y: e.y, radius: 5, fill: '#ff9900', stroke: '#fff', strokeWidth: 1 });
      previewLine = new Konva.Line({ points: [e.x, e.y, e.x, e.y], stroke: '#ff9900', strokeWidth: 2, dash: [6, 4] });
      layer.add(dot1 as unknown as Konva.Shape, previewLine as unknown as Konva.Shape);
      layer.draw();
      return;
    }

    // Second click — finalize and open calibration.
    dot2 = new Konva.Circle({ x: e.x, y: e.y, radius: 5, fill: '#ff9900', stroke: '#fff', strokeWidth: 1 });
    layer.add(dot2 as unknown as Konva.Shape);
    if (previewLine) previewLine.points([point1.x, point1.y, e.x, e.y]);
    layer.draw();

    const h = toolRunner.getPageHeightPts();
    const pdfP1 = konvaToPdf(point1.x, point1.y, h);
    const pdfP2 = konvaToPdf(e.x, e.y, h);
    const distPts = distance(pdfP1, pdfP2);

    void openCalibration(distPts).then(() => clearPreview());
  },

  deactivate() {
    const sm = toolRunner.getStageManager();
    if (sm?.stage) sm.stage.container().style.cursor = 'default';
    clearPreview();
  },
};

import type { LinearUnit, MarkupStyle, MarkupType, UnitsSettings } from '../model/document.ts';
import { DEFAULT_FILL_STYLE, DEFAULT_STROKE_STYLE, DEFAULT_TEXT_STYLE, DEFAULT_UNITS } from '../model/document.ts';

export type ToolType =
  | 'select' | 'pan'
  | 'pen' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'box' | 'text'
  | 'scale-set' | 'measure-linear' | 'measure-rect' | 'measure-poly';

export interface AppStateData {
  activeTool: ToolType;
  activePageIndex: number;
  totalPages: number;
  zoom: number;
  units: UnitsSettings;
  activeStyle: MarkupStyle;
  /** Primary selected ID (single-select only; null when 0 or 2+ selected) */
  selectedMarkupId: string | null;
  /** Type of the primary selected markup (null when 0 or 2+ selected) */
  selectedMarkupType: MarkupType | null;
  /** All currently selected markup IDs (single or multi) */
  selectedMarkupIds: string[];
  /** Types of all currently selected markups (parallel to selectedMarkupIds) */
  selectedMarkupTypes: MarkupType[];
  hasPdf: boolean;
  undoAvailable: boolean;
  redoAvailable: boolean;
}

type StateListener = (state: Readonly<AppStateData>) => void;
type EventListener = (data: unknown) => void;

class AppStateManager {
  private _state: AppStateData = {
    activeTool: 'select',
    activePageIndex: 0,
    totalPages: 0,
    zoom: 1.0,
    units: { ...DEFAULT_UNITS },
    activeStyle: {
      ...DEFAULT_STROKE_STYLE,
      ...DEFAULT_FILL_STYLE,
      ...DEFAULT_TEXT_STYLE,
    },
    selectedMarkupId: null,
    selectedMarkupType: null,
    selectedMarkupIds: [],
    selectedMarkupTypes: [],
    hasPdf: false,
    undoAvailable: false,
    redoAvailable: false,
  };

  private listeners: StateListener[] = [];
  private eventListeners: Map<string, EventListener[]> = new Map();

  get state(): Readonly<AppStateData> {
    return this._state;
  }

  update(partial: Partial<AppStateData>): void {
    this._state = { ...this._state, ...partial };
    this.notify();
  }

  subscribe(fn: StateListener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn);
    };
  }

  on(event: string, fn: EventListener): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(fn);
    return () => {
      const arr = this.eventListeners.get(event) ?? [];
      this.eventListeners.set(event, arr.filter(l => l !== fn));
    };
  }

  emit(event: string, data?: unknown): void {
    const arr = this.eventListeners.get(event) ?? [];
    arr.forEach(fn => fn(data));
  }

  private notify(): void {
    this.listeners.forEach(fn => fn(this._state));
  }

  setTool(tool: ToolType): void {
    this.update({ activeTool: tool, selectedMarkupId: null, selectedMarkupType: null, selectedMarkupIds: [], selectedMarkupTypes: [] });
    this.emit('tool-change', tool);
  }

  setUnits(linearUnit: LinearUnit): void {
    this.update({ units: { linearUnit } });
    this.emit('units-change', { linearUnit });
  }

  setZoom(zoom: number): void {
    const clamped = Math.max(0.1, Math.min(10, zoom));
    this.update({ zoom: clamped });
    this.emit('zoom-change', clamped);
  }

  setPage(index: number): void {
    if (index < 0 || index >= this._state.totalPages) return;
    this.update({ activePageIndex: index, selectedMarkupId: null, selectedMarkupType: null, selectedMarkupIds: [], selectedMarkupTypes: [] });
    this.emit('page-change', index);
  }

  setSelection(id: string | null): void {
    if (!id) {
      this.update({ selectedMarkupId: null, selectedMarkupType: null, selectedMarkupIds: [], selectedMarkupTypes: [] });
    } else {
      this.update({ selectedMarkupId: id, selectedMarkupIds: [id] });
    }
    this.emit('selection-change', id ? [id] : []);
  }

  /** Select multiple markups at once. main.ts will populate selectedMarkupTypes. */
  setMultiSelection(ids: string[]): void {
    if (ids.length === 0) {
      this.setSelection(null);
      return;
    }
    if (ids.length === 1) {
      this.setSelection(ids[0]);
      return;
    }
    this.update({ selectedMarkupId: null, selectedMarkupType: null, selectedMarkupIds: ids });
    this.emit('selection-change', ids);
  }

  /** Called by main.ts after resolving the types of all selected markups */
  setSelectionTypes(types: MarkupType[]): void {
    this.update({
      selectedMarkupTypes: types,
      selectedMarkupType: types.length === 1 ? types[0] : null,
    });
  }

  /** Called by main.ts after looking up the selected markup in the project */
  setSelectionType(type: MarkupType | null): void {
    this.update({ selectedMarkupType: type, selectedMarkupTypes: type ? [type] : [] });
  }

  setStyleProp<K extends keyof MarkupStyle>(key: K, value: MarkupStyle[K]): void {
    const newStyle = { ...this._state.activeStyle, [key]: value };
    this.update({ activeStyle: newStyle });
    this.emit('style-change', { key, value });
  }
}

export const appState = new AppStateManager();

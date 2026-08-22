import type { CountSymbol, LinearUnit, Markup, MarkupStyle, MarkupType, UnitsSettings } from '../model/document.ts';
import type { MutationKind } from './mutationTypes.ts';
import { DEFAULT_FILL_STYLE, DEFAULT_STROKE_STYLE, DEFAULT_TEXT_STYLE, DEFAULT_UNITS } from '../model/document.ts';

export type ToolType =
  | 'select' | 'pan'
  | 'pen' | 'line' | 'arrow' | 'ellipse' | 'box' | 'text'
  | 'scale-set' | 'measure-linear' | 'measure-rect' | 'measure-poly' | 'polygon-area'
  | 'count';

export interface CountSummaryItem {
  id: string;
  name: string;
  symbol: CountSymbol;
  color: string;
  count: number;
}

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
  activeCountCategoryId: string | null;
  countSummary: CountSummaryItem[];
  countSymbolSize: number;
  /** Props of the currently selected image markup (populated by main.ts) */
  selectedImageProps: { opacity: number; strokeColor: string; strokeWidth: number; strokeOpacity: number } | null;
}

type StateListener = (state: Readonly<AppStateData>) => void;
type EventListener = (data: unknown) => void;

/**
 * DiffResult — minimal change descriptor returned by _computeDiff().
 * Kept inline in appState.ts because it's a pipeline implementation detail.
 * Post-hooks use this to skip redundant work when no real change occurred.
 */
interface DiffResult {
  type: 'add' | 'styleUpdate' | 'remove' | 'reposition';
  markupId?: string;
  removedIds?: string[];
  changedKeys?: Array<keyof MarkupStyle>;
  ids?: string[];
  dx?: number;
  dy?: number;
}

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
    activeCountCategoryId: null,
    countSummary: [],
    countSymbolSize: 10,
    selectedImageProps: null,
  };

  private listeners: StateListener[] = [];
  private eventListeners: Map<string, EventListener[]> = new Map();

  // Mutation pipeline — single entry point for ALL mutations with hooks.
  private _mutationHandlers = new Map<MutationKind, (payload: any) => void>();
  private _preHooks: Array<(kind: MutationKind, payload: any) => unknown> = [];
  private _postHooks: Array<(diff: DiffResult | null) => void> = [];

  /** Register an external middleware handler for a specific mutation kind. */
  registerMutationHandler(kind: MutationKind, handler: (payload: any) => void): void {
    this._mutationHandlers.set(kind, handler);
  }

  /** Run a pre-hook before each mutation; collects any non-undefined return as the undo snapshot. */
  addPreHook(hook: (kind: MutationKind, payload: any) => unknown): void {
    this._preHooks.push(hook);
  }

  /** Run a post-hook with the computed diff after each mutation (e.g., canvas sync). */
  addPostHook(hook: (diff: DiffResult | null) => void): void {
    this._postHooks.push(hook);
  }

  constructor() {
    this._init(); // Wire default mutation handlers for TOGGLE_TOOL, CHANGE_PAGE, SET_SELECTION, LOAD_PROJECT_DATA.
  }

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

  private _init(): void {
    // Default mutation handler for TOGGLE_TOOL — updates activeTool in state and emits legacy event
    this.registerMutationHandler('TOGGLE_TOOL', (payload) => {
      const tool = payload.tool as ToolType;
      this.update({ 
        activeTool: tool,
        selectedMarkupId: null,
        selectedMarkupType: null, 
        selectedMarkupIds: [],
        selectedMarkupTypes: [] 
      });
      // Emit legacy event for backward compat with existing listeners
      this.emit('tool-change', tool);
    });

    // Default mutation handler for CHANGE_PAGE — same as setPage() but via mutate pipeline
    this.registerMutationHandler('CHANGE_PAGE', (payload) => {
      const index = payload.index as number;
      if (index >= 0 && index < this._state.totalPages) {
        this.update({ 
          activePageIndex: index,
          selectedMarkupId: null, selectedMarkupType: null,
          selectedMarkupIds: [], selectedMarkupTypes: []
        });
        this.emit('page-change', index);
      } else if (index < 0 || index >= this._state.totalPages) {
        console.warn(`[appState] CHANGE_PAGE ignored — index ${index} out of bounds (totalPages=${this._state.totalPages})`);
      }
    });

    // Default handler for SET_SELECTION — same as setSelection but via mutate pipeline
    this.registerMutationHandler('SET_SELECTION', (payload) => {
      const ids = payload.ids;
      if (!ids || (Array.isArray(ids) && ids.length === 0)) {
        this.update({ selectedMarkupId: null, selectedMarkupType: null, selectedMarkupIds: [], selectedMarkupTypes: [] });
        this.emit('selection-change', []);
      } else if (typeof ids === 'string') {
        this.update({ selectedMarkupId: ids, selectedMarkupIds: [ids] });
        this.emit('selection-change', [ids]);
      } else {
        // Array of IDs — single select only for now; multi-select via setMultiSelection() stays legacy path
        const id = ids[0];
        if (id) {
          this.update({ selectedMarkupId: id, selectedMarkupIds: ids });
          this.emit('selection-change', [id]);
        } else {
          this.setSelection(null);
        }
      }
    });

    // Default handler for LOAD_PROJECT_DATA — bypasses hooks intentionally (no undo capture during data load)
    this.registerMutationHandler('LOAD_PROJECT_DATA', () => {
      // Payload is ignored here; loading logic happens elsewhere, this is just to prevent hook execution
    });
  }

  mutate(kind: MutationKind, payload: any): void {
    // Phase 1: pre-hooks (undo snapshots) — capture state before applying changes.
    for (const hook of this._preHooks) hook(kind, payload);

    // Phase 2: apply mutation via registered handler.
    const handler = this._mutationHandlers.get(kind);
    if (!handler) throw new Error(`[appState.mutate] No handler registered for kind: ${kind}`);
    handler(payload);

    // Phase 3: compute diff (minimal change set for canvas sync).
    const diff = this._computeDiff(kind, payload);

    // Phase 4: post-hooks with computed diff.
    for (const hook of this._postHooks) hook(diff);

    // Emit generic mutation-executed event for any listeners tracking all state changes.
    const eventName = `${kind.replace(/_/g, '-').toLowerCase()}-executed`;
    this.emit(eventName, { kind, payload });
  }

  // Diff computation — compares state before/after mutation to find minimal change set.
  // This is what prevents redundant canvas re-renders during rapid events like style slider drags.
  private _computeDiff(kind: MutationKind, payload: any): DiffResult | null {
    switch (kind) {
      case 'ADD_MARKUP':
        return { type: 'add', markupId: payload.markup.id };

      case 'UPDATE_STYLE':
        // Compare old vs new style to find only changed keys — avoid N redundant Konva updates during slider drags
        const markup = this._getCurrentMarkup(payload.id);
        if (!markup) return null;

        const changedKeys: Array<keyof MarkupStyle> = [];
        for (const [key, newVal] of Object.entries(payload.partialStyle)) {
          if ((markup as any)[key] !== newVal) {
            changedKeys.push(key as keyof MarkupStyle);
          }
        }

        return changedKeys.length > 0 
          ? { type: 'styleUpdate', markupId: payload.id, changedKeys }
          : null; // No actual change — skip canvas update entirely

      case 'REMOVE_MARKUPS':
        return { type: 'remove', removedIds: payload.ids };

      case 'REPOSITION':
        return { type: 'reposition', ids: payload.ids, dx: payload.dx, dy: payload.dy };

      // For state-only mutations (tool/page/selection), diff is irrelevant for canvas sync — skip
      default:
        return null;
    }
  }

  // Helper to look up current markup by ID in the project pages (used during diff computation)
  private _getCurrentMarkup(id: string): Markup | undefined {
    // TODO Phase 4 — once main.ts passes project reference or appState stores project ref, implement properly.
    // For now return undefined — diffs for style updates will be computed externally via a different mechanism
    return undefined;
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

  setActiveCountCategory(id: string | null): void {
    this.update({ activeCountCategoryId: id });
    this.emit('count-summary-change', this._state.countSummary);
  }
}

export const appState = new AppStateManager();

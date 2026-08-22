/** Central event framework — single listener per phase for all tools. */
import Konva from 'konva';
import type { ToolProtocol } from './toolProtocol';
import type { MarkupStyle } from '../model/document';
import type { KonvaStageManager } from '../canvas/stage';
import { appState } from '../state/appState';

/** Context passed to each draw/interaction phase — tools get everything they need. */
export interface DrawContext {
  readonly x: number;
  readonly y: number;
  /** Active style (read once per event). */
  readonly style: MarkupStyle;
  dispatchAdd(markup: Partial<any>): void;
}

/**
 * Singleton that wires all tool events through ToolProtocol objects.
 * One listener per phase replaces ~12 × 3 listeners = 36 → 3 total.
 */
export class ToolRunner {
  private static _instance: ToolRunner | null = null;
  
  /** Currently active protocol — events dispatched to it on mousedown/touchstart. */
  private _activeProtocol: ToolProtocol | null = null;

  /** Per-tool preview shape state managed during drag (owned by the framework). */
  private _previewShape: Konva.Shape | Konva.Group | null = null;

  // Stored handler references for proper unbinding later.
  private _mousemoveHandler?: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  private _mouseupHandler?: () => void;

  constructor() {}

  static getInstance(): ToolRunner {
    if (!ToolRunner._instance) ToolRunner._instance = new ToolRunner();
    return ToolRunner._instance;
  }

  /** Activate a tool protocol — binds listeners to the stage once it exists. */
  setActiveTool(protocol: ToolProtocol | null): void {
    // First, deactivate any active tool (unbinds its listeners).
    if (this._activeProtocol) this.deactivate();

    this._activeProtocol = protocol;
    if (!protocol) return;

    // Stage not created yet (no page loaded) — init() re-binds once it exists.
    if (!this._stageManager?.stage) return;

    const stage = this._stageManager.stage;
    
    // Bind mousedown — start the tool or onClick handler.
    stage.on('mousedown', (e: Konva.KonvaEventObject<MouseEvent>) => {
      this.handleMouseDown(e);
    });

    console.log(`[ToolRunner] Bound mousedown for ${protocol.id}.`);
  }

  /** Set up the runner with required dependencies from main.ts. */
  init(stageManager: KonvaStageManager): void {
    if (this._stageManager) return; // Already initialized
    this._stageManager = stageManager;
    console.log('[ToolRunner] Initialized — stage manager bound.');
    // If a tool was requested before the first page loaded, bind it now.
    if (this._activeProtocol) {
      const p = this._activeProtocol;
      this._activeProtocol = null;
      this.setActiveTool(p);
    }
  }

  /** Get the currently active style for tools that draw shapes. */
  getActiveStyle(): MarkupStyle | null {
    return appState.state.activeStyle;
  }

  /** Expose current preview shape for use by protocol endDraw/midDraw. */
  getCurrentShape() {
    return this._previewShape as Konva.Shape | Konva.Group | null;
  }

  /** Accessors to shared appState and stageManager so protocols don't need direct imports. */
  getAppState() { return appState; }
  getStageManager() { return this._stageManager; }
  
  getPageHeightPts(): number {
    return this._stageManager?.pageHeightPts ?? 792; // default A4 height in points
  }

  getPageIndex(): number {
    return appState.state.activePageIndex;
  }

  /** Resolve the pointer position in stage space for a Konva mouse event. */
  private _eventPos(e: Konva.KonvaEventObject<MouseEvent>): { x: number; y: number } | null {
    const sm = this._stageManager;
    if (!sm?.stage) return null;
    // Stage-space coordinates — same source main.ts's status bar uses (markupLayer-relative).
    const pos = sm.markupLayer.getRelativePointerPosition();
    if (!pos) return null;
    return { x: pos.x, y: pos.y };
  }

  /** Internal helper to run the onDragStart / onClick handler. */
  private handleMouseDown(e: Konva.KonvaEventObject<MouseEvent>): void {
    const protocol = this._activeProtocol;
    if (!protocol) return;

    const pos = this._eventPos(e);
    if (!pos) return;

    console.log(`[ToolRunner] ${protocol.id} mousedown at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)})`);
    if (protocol.draw) {
      // Shape-drawing tool — call its startDraw.
      const result = protocol.draw.startDraw(pos);

      // Store the preview shape on the interaction layer. Some tools add their own
      // preview to a layer inside startDraw; Konva's add() re-parents, so this is idempotent.
      if (result) {
        this._previewShape = result;
        const sm = this._stageManager;
        if (sm?.interactionLayer && !(result as Konva.Node).getStage()) {
          (result as unknown as Konva.Node).listening(false); // preview must not swallow the drag events
          sm.interactionLayer.add(result as unknown as Konva.Shape);
        }
        sm?.interactionLayer?.draw();

        console.log(`[ToolRunner] ${protocol.id} draw started, shape created.`);
      }
    } else if (protocol.onClick) {
      // Click-only tool — execute immediately.
      protocol.onClick(pos);
    }

    // After mousedown, bind mousemove and mouseup for this tool's duration.
    const stage = this._stageManager?.stage;
    if (!stage) return;
    
    // Store handler references so we can unbind them later in deactivate() or handleMouseUp()
    this._mousemoveHandler = (e: Konva.KonvaEventObject<MouseEvent>) => {
      this.handleMouseMove(e);
    };
    this._mouseupHandler = () => {
      this.handleMouseUp();
    };

    // Bind mousemove and mouseup with the stored handler references.
    stage.on('mousemove', this._mousemoveHandler);
    stage.on('mouseup', this._mouseupHandler);

    console.log(`[ToolRunner] Bound mousemove + mouseup for ${protocol.id}.`);
  }

  /** Internal helper to run the onDragMove handler (during drag). */
  private handleMouseMove(e: Konva.KonvaEventObject<MouseEvent>): void {
    const protocol = this._activeProtocol;
    if (!protocol?.draw) return;

    const pos = this._eventPos(e);
    if (!pos) return;

    console.log(`[ToolRunner] ${protocol.id} midDraw at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)})`);
    protocol.draw.midDraw?.(pos);
  }

  /** Internal helper to run the onDragEnd handler (on mouseup). */
  private handleMouseUp(e?: Konva.KonvaEventObject<MouseEvent>): void {
    const protocol = this._activeProtocol;
    if (!protocol?.draw || !protocol.draw.endDraw) return;

    console.log(`[ToolRunner] ${protocol.id} endDraw — finalizing markup.`);

    // Call the tool's endDraw to get the finalized Markup object (no extra args per DrawPhase signature).
    const result = protocol.draw.endDraw();
    
    if (result && result.id) {
      console.log(`[ToolRunner] Adding markup: ${result.type} id=${result.id}`);
      
      // Dispatch ADD_MARKUP mutation through pipeline (triggers undo tracking + canvas sync).
      this._dispatchAdd(result as any);
    } else {
      console.log(`[ToolRunner] endDraw returned null — destroying preview shape.`);
      
      // No markup created — destroy the preview shape.
      if (this._previewShape) {
        const stage = this._stageManager?.stage;
        if (stage) {
          stage.batchDraw();
        }
        this._previewShape = null;
      }
    }

    // Unbind mousemove + mouseup listeners.
    this.unbindDragListeners();
  }

  /** Dispatch ADD_MARKUP mutation through the pipeline. */
  private _dispatchAdd(markup: any): void {
    if (!markup) return;

    try {
      appState.mutate('ADD_MARKUP', { markup, pageIndex: this.getPageIndex() });
    } catch (err) {
      console.error('[ToolRunner] Failed to dispatch ADD_MARKUP:', err);
    }
  }

  /** Unbind mousemove + mouseup listeners after drag ends or on tool deactivation. */
  private unbindDragListeners(): void {
    const stage = this._stageManager?.stage;
    if (!stage) return;
    // Explicitly off() the exact handlers we bound — Konva v10's .off('type') without a callback removes all, but keeping refs is safer for future partial rebinds.
    if (this._mousemoveHandler) stage.off('mousemove', this._mousemoveHandler);
    if (this._mouseupHandler)   stage.off('mouseup',   this._mouseupHandler);
    this._mousemoveHandler = undefined;
    this._mouseupHandler = undefined;
  }

  /** Deactivate the current tool — removes listeners and preview shapes. */
  deactivate(): void {
    const protocol = this._activeProtocol;

    if (protocol) {
      console.log(`[ToolRunner] Deactivated tool: ${protocol.id}.`);
    } else {
      console.log('[ToolRunner] No active tool to deactivate.');
    }

    // Clear the preview shape (shape.destroy() removes itself from the stage).
    if (this._previewShape) {
      this._previewShape.destroy();
      this._previewShape = null;
      this._stageManager?.stage?.batchDraw();
    }

    // Unbind any lingering drag listeners so they don't keep firing with stale protocol refs.
    this.unbindDragListeners();

    // Unbind mousedown listener — Konva's namespaced events ('mousedown.pen', etc.) are stored
    // under their own key, so off('mousedown') here only removes this runner's handler.
    const stage = this._stageManager?.stage;
    if (stage) {
      stage.off('mousedown');
    }

    this._activeProtocol = null;
  }

  /** Get the currently active protocol. */
  getActive(): ToolProtocol | null {
    return this._activeProtocol;
  }

  private _stageManager: KonvaStageManager | null = null;
  private _ctx: DrawContext | null = null;
}

// Singleton instance for use in main.ts and other files.
export const toolRunner = ToolRunner.getInstance();


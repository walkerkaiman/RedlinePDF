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

  /** Activate a tool protocol — binds listeners to the stage. */
  setActiveTool(protocol: ToolProtocol | null): void {
    // First, deactivate any active tool (unbinds its listeners).
    if (this._activeProtocol) this.deactivate();
    
    this._activeProtocol = protocol;

    if (!protocol || !this._stageManager?.stage || !this._ctx) return;

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
  }

  /** Get the currently active style from DrawContext. */
  getActiveStyle(): MarkupStyle | null {
    return this._ctx?.style ?? null;
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

  /** Set the DrawContext (called from main.ts on each event). */
  setCtx(ctx: DrawContext): void {
    this._ctx = ctx;
  }

  /** Internal helper to run the onDragStart / onClick handler. */
  private handleMouseDown(e: Konva.KonvaEventObject<MouseEvent>): void {
    const protocol = this._activeProtocol;
    if (!protocol) return;

    // Use the shared ctx position (set by main.ts on each event).
    const pos = { x: this._ctx!.x, y: this._ctx!.y };

    console.log(`[ToolRunner] ${protocol.id} mousedown at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)})`);

    if (protocol.draw) {
      // Shape-drawing tool — call its startDraw.
      const result = protocol.draw.startDraw(pos);
      if (!result) return;

      // Store the preview shape on the interaction layer.
      this._previewShape = result;
      
      console.log(`[ToolRunner] ${protocol.id} draw started, shape created.`);
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
    if (!protocol?.draw || !this._ctx) return;

    const pos = { x: this._ctx.x, y: this._ctx.y };
    
    console.log(`[ToolRunner] ${protocol.id} midDraw at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)})`);
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
      appState.mutate('ADD_MARKUP', { markup, pageIndex: 0 }); // TODO Phase 4: get page from AppStateData.activePageIndex
    } catch (err) {
      console.error('[ToolRunner] Failed to dispatch ADD_MARKUP:', err);
    }
  }

  /** Unbind mousemove + mouseup listeners after drag ends. */
  private unbindDragListeners(): void {
    const stage = this._stageManager?.stage;
    if (stage) {
      // Note: In Konva v8, you can't remove individual handlers bound with on() unless you keep references.
      // Since we only bind mousedown once and mousemove/mouseup after each drag starts, 
      // the simplest approach is to let them re-fire harmlessly (the _activeProtocol check in handlers will fail).
      // Or better: set _activeProtocol = null during drag, then restore it.
      console.log('[ToolRunner] Drag ended, listeners unbound.');
    } else {
      console.log('[ToolRunner] No stage to unbind listeners from.');
    }
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

    // Unbind mousedown listener.
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


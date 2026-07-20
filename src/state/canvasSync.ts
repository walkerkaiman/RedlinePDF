import { appState } from './appState';
import type { Markup, MarkupStyle } from '../model/document';
import type { KonvaStageManager } from '../canvas/stage';

/**
 * Minimal diff descriptor — structurally compatible with appState's internal
 * DiffResult so the post-hook callback types align via structural typing.
 * Kept local because appState.ts declares it inline (not exported).
 */
export interface DiffResult {
  type: 'add' | 'styleUpdate' | 'remove' | 'reposition';
  markupId?: string;
  removedIds?: string[];
  changedKeys?: Array<keyof MarkupStyle>;
  ids?: string[];
  dx?: number;
  dy?: number;
}

/** Local reference to the StageManager, set once at bootstrap. */
let currentStage: KonvaStageManager | null = null;

// ── Diff router ───────────────────────────────────────────────────────────────
// Receives every computed diff from appState._postHooks and dispatches to the
// appropriate stage method. Only fires canvas updates when a real change occurred,
// preventing N redundant Konva re-renders during rapid events like style slider drags.

/** Route a single diff to the correct StageManager operation. Returns true if canvas was updated. */
function handleDiff(diff: DiffResult | null): boolean {
  if (!currentStage || !diff) return false;

  switch (diff.type) {
    case 'add': {
      const markupId = diff.markupId as string;
      if (!markupId) return false;

      // Find the markup in current page and add to Konva layer.
      const markup = getCurrentPageMarkups().find(m => m.id === markupId);
      if (markup) {
        currentStage.addMarkupNode(markup);
        return true;
      }
      break;
    }

    case 'styleUpdate': {
      // Only update when there are actual changed keys — this is the key to
      // avoiding redundant Konva calls during rapid slider drags. When the diff
      // reports zero changedKeys, _computeDiff() returns null and we skip entirely.
      const changedKeys = diff.changedKeys ?? [];
      if (changedKeys.length === 0) return false;

      const markupId = diff.markupId as string;
      if (!markupId) return false;

      const markup = getCurrentPageMarkups().find(m => m.id === markupId);
      if (markup && markup.style) {
        // updateMarkupNode rebuilds the Konva node from scratch but preserves
        // transform state — it's the only available path for now. With changedKeys
        // filtering at the diff layer, we avoid calling it when nothing actually
        // differs in the model.
        currentStage.updateMarkupNode(markup);
        return true;
      }
      break;
    }

    case 'remove': {
      const removedIds = diff.removedIds ?? [];
      if (removedIds.length === 0) return false;

      for (const id of removedIds) {
        currentStage.removeMarkupNode(id);
      }
      return true;
    }

    case 'reposition': {
      const ids = diff.ids ?? [];
      const dx = diff.dx ?? 0;
      const dy = diff.dy ?? 0;

      if (ids.length === 0) return false;

      // For now, rebuild each repositioned markup via updateMarkupNode so that the
      // position in the model is reflected on the Konva node. In Phase 4 we'll add
      // a proper batchReposition method for zero-rebuild performance.
      const markups = getCurrentPageMarkups();
      let updatedAny = false;
      for (const id of ids) {
        const markup = markups.find(m => m.id === id);
        if (markup) {
          currentStage.updateMarkupNode(markup);
          updatedAny = true;
        }
      }
      return updatedAny;
    }

    default:
      console.warn('[CanvasSync] Unhandled diff type:', diff.type);
  }

  return false; // No canvas update performed
}

// ── Page data access ──────────────────────────────────────────────────────────
// Currently stubbed — Phase 4 will wire the project reference through appState.
// Returns empty array, so canvas sync is a no-op until pages exist in AppStateData.

function getCurrentPageMarkups(): Markup[] {
  // TODO Phase 4: When main.ts passes project reference to appState (e.g., via
  // storeProjectRef(project)), access pages via:
  //   const idx = appState.state.activePageIndex;
  //   return project.pages[idx].markups;
  return [];
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Register this module as a post-hook middleware on appState.
 * Call once during bootstrap after createStage() returns so the hook is live
 * before any user interactions can fire mutations that need diff-based sync.
 */
export function setupCanvasSync(stage: KonvaStageManager): void {
  currentStage = stage;
  console.log('[CanvasSync] Subscribing to appState post-hooks...');

  // Add our diff router as a post-hook — fires after every mutation pipeline run,
  // only dispatching when _computeDiff() found an actual change (diff !== null).
  appState.addPostHook((diff) => {
    if (!diff || !currentStage) return;

    const updated = handleDiff(diff);
    if (updated) {
      console.log(`[CanvasSync] Canvas updated for: ${diff.type}`);
    }
  });

  // Also register UNDO/REDO/REBUILD_MARKUP_LAYER handlers so future mutate() calls
  // through appState dispatch to canvas sync. Current undo/redo in main.ts use their
  // own snapshot approach — these are forward-compatible hooks for when the mutation
  // pipeline fully owns those operations (Phase 4).
  registerMutationHandlers();

  console.log('[CanvasSync] Post-hook registered — canvas sync now reacts to all mutations via diff-based routing');
}

/**
 * Register mutation handlers on appState for canvas-sync-related operations.
 * These fire when code calls appState.mutate('UNDO', ...) etc., which is the
 * intended path once Phase 4 moves undo/redo through the mutation pipeline.
 */
function registerMutationHandlers(): void {
  appState.registerMutationHandler('UNDO', () => {
    console.log('[CanvasSync] UNDO dispatched — rebuilding markup layer');
    if (currentStage) currentStage.clearMarkups();
  });

  appState.registerMutationHandler('REDO', () => {
    console.log('[CanvasSync] REDO dispatched — rebuilding markup layer');
    if (currentStage) currentStage.clearMarkups();
  });

  appState.registerMutationHandler('REBUILD_MARKUP_LAYER', () => {
    console.log('[CanvasSync] REBUILD dispatched — clearing and re-adding all markups');
    if (currentStage) currentStage.clearMarkups();
  });

  console.log('[CanvasSync] Mutation handlers registered for UNDO/REDO/REBUILD_MARKUP_LAYER');
}

export default { setupCanvasSync, registerMutationHandlers };

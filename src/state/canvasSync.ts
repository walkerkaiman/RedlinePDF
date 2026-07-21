import { appState } from './appState';
import type { Markup, MarkupStyle } from '../model/document';
import type { KonvaStageManager } from '../canvas/stage';

/**
 * Minimal diff descriptor — structurally compatible with appState's internal DiffResult
 * so the post-hook callback types align via structural typing.
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

let currentStage: KonvaStageManager | null = null;

// ── Diff router ───────────────────────────────────────────────────────────────

function handleDiff(diff: DiffResult | null): boolean {
  if (!currentStage || !diff) return false;

  switch (diff.type) {
    case 'add': {
      const markupId = diff.markupId as string;
      if (!markupId) return false;

      // Get the new markup from current page and add to Konva layer.
      const markups = getCurrentPageMarkups();
      const markup = markups.find(m => m.id === markupId);
      if (markup) {
        currentStage.addMarkupNode(markup);
        return true;
      }
      break;
    }

    case 'styleUpdate': {
      // Only update when there are actual changed keys — this avoids redundant Konva calls.
      const changedKeys = diff.changedKeys ?? [];
      if (changedKeys.length === 0) return false;

      const markupId = diff.markupId as string;
      if (!markupId) return false;

      // Look up the markup with updated style in current page markups.
      const allMarkups = getCurrentPageMarkups();
      const markupIndex = allMarkups.findIndex(m => m.id === markupId);
      
      if (markupIndex >= 0) {
        // The markup was already updated by appState handler, so read from the array.
        const currentMarkup = allMarkups[markupIndex];
        
        // Only update changed style keys on the Konva node to minimize re-renders.
        // updateMarkupNode rebuilds the whole node but preserves transform state.
        currentStage.updateMarkupNode(currentMarkup);
        return true;
      }
      
      // If markup not found in page array, try finding it directly via findNode.
      const node = currentStage.findNode(markupId);
      if (node) {
        // Rebuild the Konva node from scratch with updated style.
        // This is necessary when we have the ID but can't access the page data yet.
        currentStage.updateMarkupNode(node as any);
        return true;
      }
      
      break;
    }

    case 'remove': {
      const removedIds = diff.removedIds ?? [];
      if (removedIds.length === 0) return false;

      // Remove each markup node from Konva layer.
      for (const id of removedIds) {
        currentStage.removeMarkupNode(id);
      }
      return true;
    }

    case 'reposition': {
      const ids = diff.ids ?? [];
      if (ids.length === 0) return false;

      // Reposition each markup node in the Konva layer.
      const markups = getCurrentPageMarkups();
      let updatedAny = false;
      
      for (const id of ids) {
        const markup = markups.find(m => m.id === id);
        if (markup) {
          // updateMarkupNode rebuilds the node with new coordinates.
          currentStage.updateMarkupNode(markup);
          updatedAny = true;
        }
      }
      
      return updatedAny;
    }

    default:
      console.warn('[CanvasSync] Unhandled diff type:', (diff as any).type);
  }

  return false; // No canvas update performed
}

// ── Page data access ──────────────────────────────────────────────────────────

/** Get the current page's markup array from appState.project.pages */
function getCurrentPageMarkups(): Markup[] {
  try {
    const pageIndex = appState.state.activePageIndex;
    
    // Phase 4: Access project pages via appState.project.pages[pageIndex].markups.
    // For now, return empty array so canvas sync is a no-op until pages are wired up.
    return [];
  } catch (e) {
    console.warn('[CanvasSync] getCurrentPageMarkups failed:', e);
    return [];
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Register this module as a post-hook middleware on appState. */
export function setupCanvasSync(stage: KonvaStageManager): void {
  currentStage = stage;
  
  // Subscribe to post-hooks so canvas updates fire after mutations run.
  appState.addPostHook((diff) => handleDiff(diff));
  
  console.log('[CanvasSync] Registered as post-hook middleware');
}

export default setupCanvasSync;

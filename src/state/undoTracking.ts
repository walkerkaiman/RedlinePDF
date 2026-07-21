// src/state/undoTracking.ts - Undo snapshot capture via appState pre-hook middleware.
// Cross-cutting concern: automatically captures JSON snapshots of current markup +
// countCategories BEFORE each user mutation applies, so Ctrl+Z can restore state later.
import { appState } from './appState';
import type { MutationKind, MutationPayloadMap } from './mutationTypes.ts'; // <-- Change: added `type` keyword to prevent circular runtime dependency (only types are needed here)

/** Which mutations need undo snapshots? (User actions, not data loading) */
const SNAPSHOT_TABLE = new Set<string>([
  'ADD_MARKUP',           // User drew a shape — needs undo
  'UPDATE_STYLE',         // User changed color/width/etc — needs undo  
  'REPOSITION',           // User moved markups — needs undo
  'REMOVE_MARKUPS'        // User deleted markups — needs undo (but complex to reverse)
]);

export function setupUndoTracking(): void {
  // Skip middleware registration entirely for now — Phase 4 infrastructure (pages array) not yet available.
  console.warn('[UndoTracking] Disabled — waiting for Phase 4 AppState.pages array implementation');

  // Register UNDO/REDO handlers as no-ops so future code can dispatch mutations without errors,
  // but they do nothing until pages are stored in AppStateData (Phase 4, Task 20).
  if (appState && typeof appState.registerMutationHandler === 'function') {
    appState.registerMutationHandler('UNDO', () => {
      console.warn('[UndoTracking] Undo handler is a no-op until Phase 4 pages array exists in AppStateData');
    });

    appState.registerMutationHandler('REDO', () => {
      console.warn('[UndoTracking] Redo handler is a no-op until Phase 4 pages array exists in AppStateData');
    });
  } else {
    console.warn('[UndoTracking] Skipping registration — appState instance not yet initialized (circular import protection)');
  }
}

// --- The following structures are preserved intact for Phase 4 implementation. ---
// When main.ts passes the project reference to appState (Phase 4, Task 20) and
// AppStateData gains `pages: PageData[]`, restore pre-hooks/post-hooks here using
// registerUndoHandlers() or inline them directly.

/** Pre-hook + post-hook logic preserved for Phase 4 implementation.
 * When main.ts passes the project reference to appState (Phase 4, Task 20) and
 * AppStateData gains `pages: PageData[]`, restore this logic inside setupUndoTracking(). */
// function registerUndoHandlers(): void {
//   // When user triggers Ctrl+Z, dispatch an UNDO mutation — this flows through the pipeline automatically
//   
//   appState.registerMutationHandler('UNDO', () => {
//     const snapshot = undoStack.pop();
//     if (!snapshot) return; // No history to restore from
//     
//     const page = getCurrentPage();
//     if (page && snapshot) {
//       // Push current state to redo stack BEFORE applying the undo
//       const currentState = JSON.stringify({ 
//         markups: page.markups,
//         countCategories: page.countCategories ?? []
//       });
//       redoStack.push(currentState);
//       
//       // Restore the snapshot — this is what Ctrl+Z does
//       restoreSnapshot(snapshot);
//     }
//   });
//
//   appState.registerMutationHandler('REDO', () => {
//     const snapshot = redoStack.pop();
//     if (!snapshot) return; // No forward history to restore from
//     
//     const page = getCurrentPage();
//     if (page && snapshot) {
//       // Push current state to undo stack BEFORE applying the redo
//       const currentState = JSON.stringify({ 
//         markups: page.markups,
//         countCategories: page.countCategories ?? []
//       });
//       undoStack.push(currentState);
//       
//       // Restore the snapshot — this is what Ctrl+Y does
//       restoreSnapshot(snapshot);
//     }
//   });
//
//   // Update UI state for undo/redo availability based on stack lengths
//   appState.registerMutationHandler('TOGGLE_TOOL', () => { /* no-op */ });
// }

/** Global undo/redo stacks - shared across all pages. In v2 we could make per-page if needed. */
let undoStack: string[] = [];
let redoStack: string[] = [];

function getCurrentPage(): any | null {
  // TODO Phase 4 — once appState stores project.pages, resolve active page here.
  // Currently AppStateData only has totalPages (no pages array), so we short-circuit.
  return null;
}

function restoreSnapshot(snapshot: string): void {
  // Parse the JSON snapshot and replace current page markups/countCategories with it
  try {
    const restored = JSON.parse(snapshot) as { 
      markups: any[]; 
      countCategories: any[]; 
    };
    
    const page = getCurrentPage();
    if (!page) return; // Should never happen but defensive check
    
    page.markups = restored.markups;
    page.countCategories = restored.countCategories ?? [];
    
    // Update UI indicators that we now have redo available (undo will be done next action)
    appState.update({ 
      undoAvailable: undoStack.length > 0,
      redoAvailable: true // Just pushed to redo stack via the handler above
    });
  } catch (err) {
    console.error('[UndoTracking] Failed to parse snapshot:', err);
  }
}

// Export helpers for main.ts to trigger undo/redo on keyboard shortcuts
export function getUndoAvailable(): boolean { 
  return undoStack.length > 0; 
}

export function getRedoAvailable(): boolean { 
  return redoStack.length > 0; 
}

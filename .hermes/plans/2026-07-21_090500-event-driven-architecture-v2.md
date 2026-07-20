# Event-Driven Architecture Migration v2

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace imperative stageManager calls and scattered event handling with a single mutation pipeline through appState, shared tool protocols, and diff-based canvas sync — eliminating ~50% of boilerplate across main.ts and all 12 tool files while making undo/redo truly reliable.

**Architecture:** Enhance `appState` into a middleware pipeline (`mutate(kind, payload)`) that runs pre-hooks (undo snapshots), applies changes, then post-hooks (canvas sync via diffs). Tools declare draw phases declaratively; framework handles event wiring and coordinate conversion. No separate Command abstraction — mutations are internal functions calling mutate() with semantic payloads.

**Tech Stack:** Vite + TypeScript, Konva.js, pdfjs-dist, pdf-lib, idb (IndexedDB), Tauri 2.x — no new dependencies.

---

## Phase 1: Git Setup & Baseline Tests

### Task 1: Create feature branch
**Objective:** Isolate changes from main for safe development and easy review.

```bash
cd "/home/kaiman/Documents/Software Repos/RedlinePDF"
git fetch origin
git checkout -b refactor/event-driven-arch-v2 origin/main
git push -u origin refactor/event-driven-arch-v2
```

**Verification:** `git status` shows clean working tree on new branch.

---

### Task 2: Add Vitest + minimal test infra
**Objective:** Enable TDD during refactoring to catch regressions early.

```bash
cd "/home/kaiman/Documents/Software Repos/RedlinePDF"
npm install -D vitest @testing-library/dom jsdom
npx vitest --init  # Select Vitest when prompted
```

Run `npx vitest --run` — should show 0 tests, no errors. This is the baseline before any refactoring.

---

## Phase 2: appState as Mutation Pipeline

### Task 3: Define mutation kinds + payload types
**Objective:** Establish clear contract for all mutations without a Command type layer.

**Files:**
- Create: `src/state/mutationTypes.ts`

```typescript
// src/state/mutationTypes.ts - All possible mutation operations

export type MutationKind = 
  | 'ADD_MARKUP'
  | 'UPDATE_STYLE'
  | 'REPOSITION'
  | 'REMOVE_MARKUPS'
  | 'DUPLICATE_MARKUPS'
  | 'TOGGLE_SELECT'
  | 'SET_SELECTION'
  | 'TOGGLE_TOOL'
  | 'CHANGE_PAGE'
  | 'LOAD_PROJECT_DATA';

// Payload types for each mutation kind
export interface AddMarkupPayload { markup: Markup; pageIndex?: number }
export interface UpdateStylePayload { id: string; partial: Partial<Markup['style']> }
export interface RepositionPayload { 
  ids: string[]; 
  dx: number; dy: number;
  snapToGrid?: boolean 
}
// ... other payload interfaces

export type MutationPayload = AddMarkupPayload | UpdateStylePayload | /*...*/;
```

**Step 4:** Import into `appState.ts` and use throughout. No separate file needed if this stays small — inline is fine for now.

---

### Task 4: Enhance appState with mutate() entry point + hooks
**Objective:** Single mutation entry point that runs pre-hooks (undo snapshots), applies change, then post-hooks (canvas sync trigger).

**Files:**
- Modify: `src/state/appState.ts` (add pipeline methods)

```typescript
export class AppState {
  private mutationHandlers = new Map<MutationKind, (payload: any) => void>();
  private preHooks: Array<(kind: MutationKind, payload: any) => any> = []; // returns snapshot if needed
  private postHooks: Array<(kind: MutationKind, payload: any) => void> = [];

  // Core mutation entry point - single place all changes flow through
  mutate(kind: MutationKind, payload: any): void {
    // Pre-hooks (undo tracking runs first)
    const snapshot = this.runPreHooks(kind, payload);
    
    // Apply the mutation
    const handler = this.mutationHandlers.get(kind);
    if (!handler) throw new Error(`No handler for ${kind}`);
    handler(payload);
    
    // Compute diff for canvas sync (no redundant updates)
    const diff = computeDiff(this.state, kind, payload);
    
    // Post-hooks trigger only when something actually changed
    this.runPostHooks(kind, diff);
  }

  // Register mutation handler (called once at init)
  registerHandler(kind: MutationKind, handler: (payload: any) => void): void {
    this.mutationHandlers.set(kind, handler);
  }

  // Add hook for cross-cutting concerns (undo, autosave scheduling, etc.)
  addPreHook(hook: (kind: MutationKind, payload: any) => any): void {
    this.preHooks.push(hook);
  }

  addPostHook(hook: (kind: MutationKind, diff: any) => void): void {
    this.postHooks.push(hook);
  }

  // Internal helpers
  private runPreHooks(kind: MutationKind, payload: any): any {
    for (const hook of this.preHooks) {
      const result = hook(kind, payload);
      if (result !== undefined) return result; // First snapshot wins
    }
  }

  private runPostHooks(kind: MutationKind, diff: any): void {
    // Emit event with diff so canvas sync can apply minimally
    this.emit(`${kind.toLowerCase()}-executed`, { kind, payload, diff });
    
    for (const hook of this.postHooks) {
      hook(kind, diff);
    }
  }

  // Existing public API stays the same but now routes through mutate():
  setTool(tool: ToolType): void {
    this.mutate('TOGGLE_TOOL', tool);
  }
  
  setSelection(id: string | string[] | null): void {
    this.mutate('SET_SELECTION', id);
  }
}
```

**Step 5:** Refactor existing `setTool`, `setSelection`, etc. to call `mutate()` instead of direct state updates. This is the critical change — all mutations now flow through one entry point with hooks running automatically.

---

### Task 5: Add undo tracking as a pre-hook
**Objective:** Snapshot captures happen automatically before any mutation, no imperative calls in main.ts.

**Files:**
- Create: `src/state/undoTracking.ts`

```typescript
// src/state/undoTracking.ts - Undo snapshot capture via appState pre-hook

import { appState } from './appState';
import type { MutationKind } from './mutationTypes';

export function setupUndoTracking() {
  // Define which mutations need undo snapshots (user actions, not data loading)
  const SNAPSHOT_TABLE = new Set<MutationKind>([
    'ADD_MARKUP',
    'UPDATE_STYLE', 
    'REPOSITION',
    'REMOVE_MARKUPS',
    'DUPLICATE_MARKUPS'
    // Note: TOGGLE_SELECT and SET_SELECTION don't need undo (visual only)
  ]);

  // Pre-hook: capture snapshot before mutation if needed
  appState.addPreHook((kind, payload) => {
    if (!SNAPSHOT_TABLE.has(kind)) return undefined;
    
    const page = getActivePage();
    if (!page) return undefined;
    
    // Deep clone the relevant state for reversal
    const snapshot = JSON.parse(JSON.stringify({ 
      markups: page.markups,
      countCategories: page.countCategories ?? []
    }));
    
    return { snapshot, kind };
  });

  // Post-hook: push snapshot to undo stack after mutation completes
  appState.addPostHook((kind) => {
    if (!SNAPSHOT_TABLE.has(kind)) return;
    const activePage = getActivePage();
    if (activePage && currentPageMarkups().length > 0) {
      undoStack.push(JSON.stringify(currentPageSnapshot()));
      redoStack.length = 0; // Clear forward history on new action
    }
  });

  // Expose undo/redo as user-facing actions that dispatch mutations
  appState.registerHandler('UNDO', () => {
    const snapshot = undoStack.pop();
    if (!snapshot) return;
    
    // Snapshot current state for redo, then restore
    const currentState = JSON.stringify(currentPageSnapshot());
    redoStack.push(currentState);
    
    restoreSnapshot(snapshot);
  });

  appState.registerHandler('REDO', () => {
    const snapshot = redoStack.pop();
    if (!snapshot) return;
    
    const currentState = JSON.stringify(currentPageSnapshot());
    undoStack.push(currentState);
    
    restoreSnapshot(snapshot);
  });
}
```

**Step 6:** Wire into appState init. The hook pattern means undo tracking is now a cross-cutting concern that runs automatically before any mutation — no imperative calls scattered across main.ts.

---

### Task 6: Add canvas sync as a post-hook with diff-based updates
**Objective:** Canvas only re-renders what actually changed, avoiding redundant Konva operations on rapid events (e.g., slider drags).

**Files:**
- Create: `src/state/canvasSync.ts`

```typescript
// src/state/canvasSync.ts - Reactive canvas sync via diff-based post-hook

import { appState } from './appState';
import type { StageManager } from '../canvas/stage';
import type { Markup, CountMarkup, CountLegendMarkup } from '../model/document';

export function setupCanvasSync(stageManager: StageManager) {
  // Post-hook: update canvas only on actual changes (computed diffs)
  appState.addPostHook((kind, diff) => {
    if (!diff || !stageManager) return;
    
    switch (kind) {
      case 'ADD_MARKUP':
        stageManager.addMarkupNode(diff.newMarkups[0]); // Only the new one
        break;
        
      case 'UPDATE_STYLE':
        if (diff.styleChanged) {
          const markup = getMarkupById(diff.id);
          if (markup && diff.changedKeys.length > 0) {
            stageManager.updateStyle(markup, diff.changedKeys); // Minimal update
          }
        }
        break;
        
      case 'REMOVE_MARKUPS':
        diff.removedIds.forEach(id => stageManager.removeMarkupNode(id));
        break;
        
      case 'REPOSITION':
        if (diff.repositioned) {
          // Single batch update instead of per-element calls
          stageManager.batchReposition(diff.ids, diff.dx, diff.dy);
        }
        break;
    }
  });

  // Handle "LOAD_PROJECT_DATA" specially — no events emitted to avoid flood
  appState.registerHandler('LOAD_PROJECT_DATA', (projectData) => {
    project.pages = projectData.pages;
    // Canvas will rebuild via explicit trigger after load completes
  });
}
```

**Step 7:** The `computeDiff` function in step 4 needs to be implemented. It compares old vs new state and returns only what changed:

```typescript
// In appState.ts, add helper
function computeDiff(oldState: any, kind: MutationKind, payload: any): Diff | null {
  switch (kind) {
    case 'ADD_MARKUP': 
      return { type: 'add', newMarkups: [payload.markup] };
      
    case 'UPDATE_STYLE':
      const markup = findMarkupById(payload.id);
      if (!markup || !payload.partial) return null;
      
      // Compute only changed style keys (avoid redundant Konva updates on slider drag)
      const changedKeys = Object.keys(payload.partial).filter(
        key => JSON.stringify(markup.style[key]) !== JSON.stringify(payload.partial[key])
      );
      
      if (changedKeys.length === 0) return null; // No actual change
        
      return { type: 'styleUpdate', id: payload.id, changedKeys };
    
    case 'REMOVE_MARKUPS':
      return { 
        type: 'remove', 
        removedIds: payload.ids 
      };
      
    case 'REPOSITION':
      return { 
        type: 'reposition', 
        ids: payload.ids, 
        dx: payload.dx, 
        dy: payload.dy 
      };
      
    default:
      return null; // No diff needed for TOGGLE_TOOL, SET_SELECTION, etc.
  }
}
```

**Step 8:** Register the canvas sync setup in `main.ts` after stage is created:
```typescript
// In main.ts bootstrap, after createStage() returns:
setupCanvasSync(stageManager);
```

---

## Phase 3: Tool Protocol Abstraction

### Task 9: Define shared tool protocol interface
**Objective:** Tools declare *what* they do (draw phases), framework handles event wiring, coordinate conversion, and undo capture. Eliminates ~120 lines of duplicated mousedown/mousemove/up handlers across all tools.

**Files:**
- Create: `src/tools/toolProtocol.ts`

```typescript
// src/tools/toolProtocol.ts - Declarative tool definition interface

import type { Markup } from '../model/document';
import type { KonvaStage, KonvaLayer } from 'konva/lib/Stage';

export interface DrawPhase {
  start(event: any): void;      // Called on mousedown (start new shape)
  mid(event: any): void;        // Called continuously during drag
  end(): void;                  // Called on mouseup (finalize shape)
}

export interface ToolProtocol {
  id: string;
  name: string;
  key?: string;                 // Keyboard shortcut
  
  // Draw phases — tool declares what it does, framework handles events
  draw?: DrawPhase | null;      // For drawing tools (pen, line, arrow, etc.)
  
  // Selection/interaction handlers for non-drawing tools (pan, select)
  onClick?(event: any): void;
  onDragStart?(event: any): void;
  onDragMove?(event: any): void;
  onDragEnd?(event: any): void;
}

// Framework that wires tool protocols to Konva events
export class ToolRunner {
  private activeTool: ToolProtocol | null = null;
  private stage: KonvaStage;
  
  constructor(stage: KonvaStage) {
    this.stage = stage;
    
    // Bind framework event handlers once - tools don't need to wire these
    stage.on('mousedown', (e) => this.handleMouseDown(e));
    stage.on('mousemove', (e) => this.handleMouseMove(e));
    stage.on('mouseup', () => this.handleMouseUp());
  }

  setActiveTool(tool: ToolProtocol | null): void {
    this.activeTool = tool;
  }

  private handleMouseDown(e: any): void {
    if (!this.activeTool) return;
    
    // Convert screen coords to PDF user-space (1 point = 1/72 inch, bottom-left origin)
    const pdfCoords = convertToPdfCoords(stage.getPointerPosition());
    
    if (this.activeTool.draw?.start) {
      this.activeTool.draw.start({ ...e, position: pdfCoords });
    } else if (this.activeTool.onClick) {
      this.activeTool.onClick(e);
    } else if (this.activeTool.onDragStart) {
      this.activeTool.onDragStart(e);
    }
  }

  // ... handleMouseMove, handleMouseUp similarly delegate to tool.draw.mid or .end
  
  private handleMouseUp(): void {
    if (!this.activeTool?.draw?.end) return;
    
    const finalShape = getCurrentDrawnShape(); // Captured by framework during drag
    
    // Dispatch mutation through appState (undo tracking + canvas sync hooks run automatically)
    appState.mutate('ADD_MARKUP', { markup: finalizeShape(finalShape) });
  }

  private handleMouseMove(e: any): void {
    if (!this.activeTool?.draw?.mid) return;
    
    // Real-time feedback during drag (no undo yet - only on finalize)
    const pdfCoords = convertToPdfCoords(stage.getPointerPosition());
    this.activeTool.draw.mid({ ...e, position: pdfCoords });
  }
}

// Coordinate conversion helper (already exists in geometry/transform.ts but moved here for clarity)
function convertToPdfCoords(screenPoint: {x: number; y: number}): {x: number; y: number} {
  // Apply Y-flip and scale calibration - same logic as current tools, just centralized
  const pageWidth = getCurrentPageWidth();
  const scaleFactor = getScaleFactor();
  
  return {
    x: screenPoint.x / scaleFactor,
    y: (pageHeightPts - screenPoint.y) / scaleFactor // Y-flip from top-left to bottom-left
  };
}

// Shape finalization converts the live Konva shape into a Markup record ready for persistence
function finalizeShape(liveShape: any): Markup {
  switch (liveShape.type) {
    case 'pen': return createPenMarkupFromPath(liveShape.points);
    case 'line': return createLineMarkupFromCoords(liveShape.x1, liveShape.y1, liveShape.x2, liveShape.y2);
    // ... other type conversions
  }
}
```

**Step 10:** This is a significant refactor. The `ToolRunner` class becomes the single point where all tool events are handled — tools just implement their draw phases and let the framework manage event binding, coordinate conversion, and mutation dispatch via appState.

---

### Task 11: Refactor existing tools to use protocol
**Objective:** Convert one representative tool (e.g., `penTool.ts`) from imperative event handling to declarative protocol implementation. This proves the pattern works before doing all 12 tools.

**Files:**
- Modify: `src/tools/penTool.ts` (simplified version)

Before (imperative, ~80 lines):
```typescript
export class PenTool implements BaseTool {
  isActive = true;
  
  activate(stage: KonvaStage, layer: KonvaLayer): void {
    this.stage = stage;
    this.layer = layer;
    
    // Wire up events manually - same boilerplate repeated in every tool
    stage.on('mousedown', () => this.startDraw());
    stage.on('mousemove', (e) => this.midDraw(e));
    stage.on('mouseup', () => this.endDraw());
  }
  
  startDraw(): void { /* ... */ }
  midDraw(event: any): void {/* ... lots of duplicate coordinate math */}
  endDraw(): void {/* ... calls addMarkup imperatively */}
}
```

After (declarative, ~30 lines):
```typescript
export const penTool: ToolProtocol = {
  id: 'pen',
  name: 'Freehand Pen',
  key: 'p',
  
  draw: {
    start(event) {
      // Create new live shape for drag feedback
      currentPenPath = createLivePenPath();
      layer.add(currentPenPath);
    },
    
    mid(event) {
      // Update path points as user drags (real-time preview only)
      currentPenPath.points([...currentPenPath.points(), event.position]);
    },
    
    end() {
      // Finalize and dispatch mutation — undo tracking + canvas sync run via hooks
      const markup = finalizeShape(currentPenPath);
      appState.mutate('ADD_MARKUP', { markup });
      
      layer.remove(currentPenPath); // Remove live preview shape
      currentPenPath = null;
    }
  }
};

// No activate() method needed - framework handles event binding via ToolRunner
```

**Step 12:** Register the refactored tool in `main.ts` initialization:
```typescript
import { penTool, lineTool, arrowTool /* ... */ } from './tools/penTool'; // etc.

// After createStage():
const toolRunner = new ToolRunner(stage);
toolRunner.setActiveTool(penTool); // Or whatever the default is
```

**Verification:** Test drawing a freehand path works identically to before, but with ~60% less code in penTool.ts.

---

### Task 12: Refactor remaining tools (line, arrow, ellipse, box)
**Objective:** Convert next batch of tools using same protocol pattern. These are simpler than pen (no freehand path tracking).

**Files:**
- Modify: `src/tools/lineTool.ts`, `arrowTool.ts`, `ellipseTool.ts`, `boxTool.ts`

Same transformation as Task 11 — declare draw phases, remove manual event binding and coordinate math. Each should shrink from ~60 lines to ~25.

**Step 13:** Run Vitest after each tool conversion to verify no regressions in behavior (test markup creation, coordinates, style application).

---

### Task 13: Refactor complex tools (measureLinear, measureRect, scaleSet)
**Objective:** These tools have more state and multi-step workflows. Protocol still applies but with extra setup/teardown phases.

**Files:**
- Modify: `src/tools/measureLinearTool.ts`, etc.

These may need additional lifecycle hooks beyond start/mid/end:
```typescript
export const measureLinearTool: ToolProtocol = {
  id: 'measure-linear',
  name: 'Linear Measure',
  
  setup() { /* Initialize state, show hint text */ },
  start(event) {/* Click first point */,
  mid(event) {/* Show live measurement line */},
  end(event) {/* Finalize, dispatch mutation with measured distance */}
};
```

**Step 14:** Test scale calibration still works correctly. This is the most critical tool — if users can't calibrate measurements, the app is unusable for construction plans.

---

### Task 14: Refactor interaction tools (pan, select)
**Objective:** These don't have draw phases but use drag handlers. Protocol extension handles them via `onDragStart/Move/End`.

**Files:**
- Modify: `src/tools/selectTool.ts`, `panTool.ts`

```typescript
export const selectTool: ToolProtocol = {
  id: 'select',
  name: 'Select',
  key: 'v',
  
  onClick(event) { 
    // Dispatch toggle selection through mutation pipeline
    appState.mutate('TOGGLE_SELECT', event.targetId);
  },
  
  onDragStart(event) { /* Start rubber-band selection */},
  onDragMove(event) { /* Update rubber-band bounds */,
  onDragEnd() { /* Finalize multi-select via SET_SELECTION mutation */}
};
```

**Step 15:** Verify multi-select (rubber band + Shift+click) works. Select tool is the most frequently used — any regression here breaks the UX.

---

## Phase 4: Distinguish Data Loading vs User Actions

### Task 16: Add LOAD_PROJECT_DATA mutation with suppressed hooks
**Objective:** Prevent undo flood and canvas sync spam when loading from IndexedDB or .redline files.

**Files:**
- Modify: `src/state/undoTracking.ts` (already has this in step 5 — just verify it's wired correctly)
- Modify: `src/state/canvasSync.ts` (handle LOAD_PROJECT_DATA specially — no events emitted)

```typescript
// In canvasSync post-hook, skip all sync operations for data loading:
case 'LOAD_PROJECT_DATA':
  // Don't emit individual add-markup events - just rebuild once after load completes
  return; 
```

**Step 17:** After project loads successfully in `main.ts`, trigger explicit canvas rebuild:
```typescript
appState.mutate('REBUILD_MARKUP_LAYER', null); // Triggers full sync without flood
```

This ensures no events fire during bulk import, then a single clean update happens when the page renders.

---

### Task 18: Add auto-load from IndexedDB on startup (if autosave exists)
**Objective:** If user left app open with unsaved changes, restore seamlessly without triggering undo history or visual updates until fully loaded.

**Files:**
- Modify: `src/storage/projectStore.ts` to export a `getLastAutosave()` function
- Modify: `main.ts` bootstrap to check for pending autosave before showing empty state

```typescript
// In main.ts after appState.init():
const autosaved = await getLastAutosave();
if (autosaved && confirm('Restore last session?')) {
  // Load without triggering hooks by calling internal handler directly:
  appState.loadProject(autosaved); // New method that bypasses mutate() for restore
} else {
  // Normal flow - empty state with "Open PDF" prompt
}
```

**Step 19:** Test that loading autosave doesn't flood undo stack or fire individual add-markup events. The canvas should update once when load completes, not N times during import.

---

## Phase 5: Refactor main.ts to Remove Imperative Calls

### Task 20: Replace imperative mutation calls in main.ts
**Objective:** Strip all direct stageManager.addMarkupNode/removeMarkupNode/updateStyle calls from main.ts — they're now handled by canvasSync hooks via the mutation pipeline.

**Files:**
- Modify: `src/main.ts` (~lines 148-462, replace addMarkup, removeSelectedMarkups, duplicateSelectedMarkups, updateMarkup, count-related functions)

Before (imperative):
```typescript
function addMarkup(markup: Markup): void {
  snapshotMarkups(); // Imperative undo capture - now handled by pre-hook
  page.markups.push(markup); // Direct state mutation - now routed through mutate()
  stageManager?.addMarkupNode(markup); // Direct canvas update - now via post-hook diff
}
```

After (declarative):
```typescript
function addMarkup(markup: Markup): void {
  appState.mutate('ADD_MARKUP', { markup });
  
  // UI feedback (switch to select, highlight) happens after mutation completes via event listener
  // No imperative stageManager calls needed - canvas sync hook handles rendering
}
```

**Step 21:** Similarly for:
- `removeSelectedMarkups()` → `appState.mutate('REMOVE_MARKUPS', { ids })`
- `duplicateSelectedMarkups()` → extract clone logic to helper, dispatch `ADD_MARKUP` N times (or create batch mutation)
- `updateMarkup()` → `appState.mutate('UPDATE_STYLE', { id, partialStyle })`

**Step 22:** Remove all imperative calls from undo/redo functions. The pre/post hooks now handle snapshot capture and canvas sync automatically — just dispatch the UNDO/REDO mutations.

---

### Task 23: Clean up event handlers that are no longer needed
**Objective:** Some event listeners in main.ts were there to trigger stageManager updates manually. Now those go through hooks, so clean up.

**Files:**
- Modify: `src/main.ts` (search for `stageManager?.addMarkupNode`, `removeMarkupNode`, etc. — remove any remaining direct calls)

```bash
grep -n "stageManager\." "/home/kaiman/Documents/Software Repos/RedlinePDF/src/main.ts"
```

If only a few remain, they should be documented with comment explaining why imperative access is necessary (e.g., performance-critical drag feedback that bypasses state for real-time responsiveness).

**Step 24:** Verify the app still works end-to-end by loading a PDF, drawing shapes, measuring, exporting — all functionality should work identically but with cleaner architecture.

---

## Phase 6: Testing & Validation

### Task 25: Write tests for mutation pipeline
**Objective:** Ensure mutations flow through hooks correctly without breaking existing behavior.

**Files:**
- Create: `tests/state/mutationPipeline.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { appState } from '../../src/state/appState';

describe('Mutation Pipeline', () => {
  it('should route mutations through mutate() entry point and emit events', () => {
    let eventEmitted = false;
    
    const unsubscribe = appState.on('toggle-tool-executed', (e) => {
      eventEmitted = true;
    });
    
    appState.setTool('pen'); // Calls mutate internally
    
    expect(appState.state.activeTool).toBe('pen');
    expect(eventEmitted).toBe(true);
    
    unsubscribe();
  });

  it('should run pre-hooks (undo tracking) before mutation', () => {
    let preHookRan = false;
    appState.addPreHook((kind) => { 
      if (kind === 'ADD_MARKUP') preHookRan = true;
      return undefined; // No snapshot for this test
    });
    
    appState.mutate('ADD_MARKUP', { markup: createTestMarkup() });
    
    expect(preHookRan).toBe(true);
  });

  it('should compute diff and skip empty updates on style slider drag', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}); // Suppress expected warnings
    
    let postHookCalled = false;
    appState.addPostHook((kind) => { 
      if (kind === 'UPDATE_STYLE') postHookRan = true;
    });
    
    // Mutate style with same value (no actual change) — should skip post-hook
    const existingMarkup = getTestMarkup();
    const originalStyleValue = existingMarkup.style.strokeWidth;
    
    appState.mutate('UPDATE_STYLE', { 
      id: 'test-id', 
      partial: { strokeWidth: originalStyleValue } // Same value, no diff
    });
    
    expect(postHookCalled).toBe(false); // Diff was null, post-hook skipped
    
    consoleSpy.mockRestore();
  });

  it('should emit event only when diff is non-null (actual change occurred)', () => {
    let eventsEmitted = 0;
    
    const unsubscribe = appState.on('update-style-executed', () => {
      eventsEmitted++;
    });
    
    // First mutation with actual style change — should emit
    appState.mutate('UPDATE_STYLE', { 
      id: 'test-id', 
      partial: { strokeWidth: 5 } 
    });
    expect(eventsEmitted).toBe(1);
    
    // Second mutation with same value (no diff computed) — should NOT emit
    appState.mutate('UPDATE_STYLE', { 
      id: 'test-id', 
      partial: { strokeWidth: 5 } // Same as current state after first mutation
    });
    expect(eventsEmitted).toBe(1); // Still 1, no new event
    
    unsubscribe();
  });

  it('should NOT trigger undo snapshots for non-user-action mutations (LOAD_PROJECT_DATA)', () => {
    let snapshotCaptured = false;
    
    appState.addPreHook((kind) => {
      if (kind === 'ADD_MARKUP') {
        // This would normally capture a snapshot, but LOAD_PROJECT_DATA bypasses mutate()
        snapshotCaptured = true;
      }
    });
    
    // Direct internal call for data loading — pre-hooks don't run
    appState.loadProject({...}); 
    
    expect(snapshotCaptured).toBe(false);
  });
});
```

**Step 26:** Run tests with `npx vitest --run` — all should pass. Fix any failures until green.

---

### Task 27: Write integration test for markup lifecycle via mutation pipeline
**Objective:** Verify add → update → remove flow works end-to-end through hooks, not imperative calls.

```typescript
import { describe, it, expect } from 'vitest';
// Mock stageManager to avoid Konva dependency in tests (see step 16 of v1 plan)
vi.mock('../../src/canvas/stage', () => ({ createStage: vi.fn() }));

describe('Markup Lifecycle via Mutation Pipeline', () => {
  it('should add markup and trigger canvas sync post-hook with minimal diff', () => {
    let addedMarkup: Markup | null = null;
    
    const unsubscribe = appState.on('add-markup-executed', (e) => {
      expect(e.diff.type).toBe('add');
      expect(e.diff.newMarkups[0]).toBeDefined();
      addedMarkup = e.diff.newMarkups[0];
    });
    
    appState.mutate('ADD_MARKUP', { markup: createTestPenMarkup() });
    
    unsubscribe();
    expect(addedMarkup?.type).toBe('pen');
  });

  it('should remove multiple markups in single mutation and emit batched event', () => {
    let removedIds: string[] = [];
    
    const unsubscribe = appState.on('remove-markups-executed', (e) => {
      removedIds = e.diff.removedIds;
    });
    
    appState.mutate('REMOVE_MARKUPS', { ids: ['id1', 'id2', 'id3'] });
    
    unsubscribe();
    expect(removedIds).toEqual(['id1', 'id2', 'id3']);
  });

  it('should reposition markups in batch (not per-element calls)', () => {
    let repositioned: any = null;
    
    const unsubscribe = appState.on('reposition-executed', (e) => {
      repositioned = e.diff;
    });
    
    // Single mutation moves multiple items at once — diff captures batch operation
    appState.mutate('REPOSITION', { ids: ['a','b','c'], dx: 10, dy: -5 });
    
    unsubscribe();
    expect(repositioned.ids).toHaveLength(3);
    expect(repositioned.dx).toBe(10);
    // This proves canvas sync can apply batch update instead of 3 separate calls
  });

  it('should suppress undo tracking for data-loading mutations', () => {
    let snapshotCaptured = false;
    
    appState.addPreHook((kind) => {
      if (kind === 'LOAD_PROJECT_DATA') snapshotCaptured = true; // Should not fire
    });
    
    // LOAD_PROJECT_DATA bypasses mutate() entirely — pre-hooks never run
    appState.loadProject({...}); 
    
    expect(snapshotCaptured).toBe(false);
  });

  it('should emit UNDO/REDO mutations that reverse state correctly', () => {
    // Setup with existing markups on current page...
    
    const initialCount = getCurrentPageMarkups().length;
    appState.mutate('ADD_MARKUP', { markup: createTestPenMarkup() });
    
    expect(getCurrentPageMarkups().length).toBe(initialCount + 1);
    
    // Undo should pop snapshot and restore to initial state via mutation
    appState.mutate('UNDO');
    expect(getCurrentPageMarkups().length).toBe(initialCount);
  });
});
```

**Step 28:** Run tests — all should pass. Fix failures until green before proceeding.

---

## Phase 7: Export Pipeline & Single-Pass Render (Bonus)

### Task 29: Refactor export to use single-pass render target
**Objective:** Replace fragile coordinate mapping between pdfjs render and Konva overlay with a unified canvas that gets both backgrounds + markups, then exports once. This eliminates the most common bug source (scale calibration mismatches).

**Files:**
- Modify: `src/export/exportPdf.ts`

```typescript
// In exportPdf.ts, replace composite approach:
export async function exportRedlinedPdf(project: ProjectData) {
  const pdfDoc = await createEmptyPdfFromTemplate(project); // Create new PDF
  
  for (let i = 0; i < project.pages.length; i++) {
    const page = project.pages[i];
    
    // Single-pass approach: render both PDF background + markups to one canvas
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = pageWidth * dpiScale;
    exportCanvas.height = pageHeight * dpiScale;
    
    const ctx = exportCanvas.getContext('2d')!;
    
    // Step 1: Render PDF background (pdfjs) to canvas at export DPI
    await renderPdfPageToCanvas(pdfBytes, i, exportCanvas);
    
    // Step 2: Apply markup overlays directly via Konva's toDataURL (no coordinate mapping needed!)
    const markupCanvas = stageManager.getMarkupLayer(i).toCanvas(); // Konva handles this natively
    
    // Composite both onto single canvas at same DPI — no user-space conversion needed!
    ctx.drawImage(markupCanvas, 0, 0);
    
    // Step 3: Embed composite image into new PDF page
    await addImageToPdfPage(pdfDoc, exportCanvas.toDataURL(), pageWidth, pageHeight);
  }
  
  return pdfDoc;
}

// Key improvement: Konva's toCanvas() returns an exact pixel representation of the markup layer. 
// We embed that directly into the PDF at the same DPI as the background — no coordinate math needed!
```

**Step 30:** This is a bigger change with higher risk — test export quality carefully across multiple PDFs and scale calibrations before deploying in production builds.

---

### Task 30: Add delta-based autosave for large projects (bonus)
**Objective:** Replace full-page JSON.stringify snapshots with delta tracking for IndexedDB saves. Only serializes what changed, reducing save time from O(N) to O(Δ).

**Files:**
- Modify: `src/storage/projectStore.ts` (add delta detection) and `src/state/undoTracking.ts` (capture deltas instead of full state)

```typescript
// In undoTracking pre-hook, capture diff instead of clone:
appState.addPreHook((kind, payload) => {
  if (!SNAPSHOT_TABLE.has(kind)) return undefined;
  
  const page = getActivePage();
  if (!page) return undefined;
  
  // Capture delta (what changed) not full state
  switch (kind) {
    case 'ADD_MARKUP':
      return { type: 'delta', action: 'add', markupId: payload.markup.id };
      
    case 'UPDATE_STYLE':
      const prevStyle = JSON.parse(JSON.stringify(getMarkupById(payload.id).style));
      return { 
        type: 'delta', 
        action: 'update-style', 
        id: payload.id, 
        previousStyle: prevStyle 
      };
    
    // ... other cases
    
    default:
      return undefined;
  }
});

// On autosave trigger (post-hook), apply deltas to get new state without full clone:
appState.addPostHook((kind) => {
  if (!SNAPSHOT_TABLE.has(kind)) return;
  
  const latestSnapshot = undoStack[undoStack.length - 1]; // Get last delta
  
  // Apply only the delta, not full page re-serialization
  applyDelta(latestSnapshot); // O(1) instead of O(N) for large pages
  
  autosaveProject(project, pdfBytes).catch(console.error);
});
```

**Step 31:** Test that autosave still produces valid .redline files and restores correctly. This is an optimization — don't sacrifice correctness for speed.

---

## Phase 8: Documentation & Cleanup

### Task 32: Update README architecture section
**Objective:** Document new event-driven + tool protocol architecture clearly.

**Files:**
- Modify: `README.md` (~lines 128-143)

```markdown
## Architecture Notes (v0.2.0+)

### Mutation Pipeline
All markup changes flow through a single entry point:

```typescript
appState.mutate('ADD_MARKUP', { markup }); // or UPDATE_STYLE, REMOVE_MARKUPS, etc.
```

The pipeline runs:
1. **Pre-hooks** — undo snapshot capture (before mutation)
2. **Mutation handler** — applies change to data model
3. **Diff computation** — compares old vs new state
4. **Post-hooks** — canvas sync trigger (only if diff is non-null, i.e., actual change occurred)

This means:
- Canvas updates are minimal and batched (no redundant Konva calls on slider drags)
- Undo tracking works automatically for all user mutations
- Data loading bypasses hooks to prevent event flood during restore
```

### Tool Protocol
Tools declare draw phases declaratively; framework handles event wiring, coordinate conversion, and mutation dispatch:

```typescript
const penTool = {
  id: 'pen', name: 'Freehand Pen', key: 'p',
  draw: { start(event) { /* create live shape */ }, mid(e){ /* update preview */ }, end(){ appState.mutate('ADD_MARKUP', {...}) } }
};
```

No imperative stageManager calls in tool files — framework manages all event binding and state synchronization.

---

### Task 33: Create architecture migration guide in docs/
**Objective:** Help future developers understand the v2 architectural decisions (why no Command type, why diff-based sync, etc.).

**Files:**
- Create: `docs/EVENT-DRIVEN-ARCH-V2.md`

Content should cover:
- Why we chose mutation pipeline over separate Command layer (simpler, less ceremony)
- How diff computation prevents redundant canvas updates on rapid events (style sliders, drag feedback)
- Tool protocol benefits (~60% code reduction across tools via declarative draw phases)
- Data loading vs user action distinction — when to bypass hooks and why
- Common debugging scenarios (e.g., "my markup isn't showing up" → check if mutation emitted diff correctly)

---

### Task 34: Final TypeScript compilation + full test suite pass
**Objective:** Ensure no regressions across entire codebase.

```bash
cd "/home/kaiman/Documents/Software Repos/RedlinePDF"
npx tsc --noEmit
npx vitest --run
```

Fix all type errors and failing tests until clean green. Then do a full app build to verify no runtime issues:

```bash
npm run build  # Vite production build
# Or for desktop: npx tauri dev (or build, depending on target)
```

---

### Task 35: Create migration checklist & verification document
**Objective:** Help reviewers/testers validate the migration didn't break anything.

**Files:**
- Create: `docs/MIGRATION-CHECKLIST.md`

```markdown
## Pre-Migration Baseline (record this)
- [ ] Load sample PDF with 5+ pages
- [ ] Draw all tool types (pen, line, arrow, ellipse, box, text)
- [ ] Set scale calibration on page 1 and 3 separately
- [ ] Add count categories and stamps across multiple pages
- [ ] Test undo/redo for each tool type — verify correct reversal
- [ ] Export PDF at 96 / 150 / 300 DPI — verify markups align with background
- [ ] Save project as .redline, close app, reopen — verify complete restore

## Post-Migration Verification (repeat above after changes)
Compare outputs. Any deviation is a regression:
- Markups render at same positions (pixel-perfect match in export)
- Scale calibration still works on multi-page documents
- Undo history length unchanged (~50 per page max)
- Autosave triggers correctly (no flood on project load)
- Tool responsiveness identical or improved (drag feedback should feel smoother due to batched updates)

## Known Improvements Post-Migration
- Canvas sync only re-renders when actual style changes occur (no redundant Konva calls during slider drag)
- Export pipeline uses single-pass render target — markups always align with PDF background regardless of zoom/scale
- Tool code reduced ~60% via protocol abstraction — easier to add new tools in future
```

---

## Risk & Tradeoffs Summary

### Risks:
1. **Diff computation overhead:** Computing diffs before mutations might slow down rapid events (drag). Mitigate: diff is lightweight JSON comparison, only skip post-hook when diff is null — actual state changes still happen synchronously.
2. **Tool protocol refactoring scope:** 12 tool files to convert. Mitigate: refactor incrementally (pen → line/arrow/ellipse/box batch → measure tools → select/pan), test after each batch.
3. **Export single-pass render risk:** Higher chance of alignment bugs if coordinate math is wrong. Mitigate: add visual regression tests comparing export output before/after change on sample PDFs.

### Tradeoffs:
- **Simpler vs. more powerful:** Mutation pipeline + hooks is simpler than Command abstraction but loses some flexibility for future features (e.g., remote sync across instances). If that becomes a requirement later, can add thin Command layer on top without removing current architecture.
- **Diff-based canvas sync vs debounce:** Diff computation handles rapid events cleanly without needing manual debouncing logic — but adds slight complexity to the pipeline. Worth it: prevents subtle bugs where slider drags cause N redundant Konva updates instead of 1.

### Open Questions:
1. Should export pipeline's single-pass render use `toCanvas()` from Konva directly, or re-render markups via pdfjs for better fidelity? (Answer: toCanvas() is faster and exact; only use pdfjs if transparency/opacity rendering differs between layers)
2. How to handle the "deep clone with offset" logic currently in main.ts — move to separate utility module with tests? (Yes, extract `duplicateSelectedMarkups` helper to `src/state/markupUtils.ts`)

---

## Verification Checklist

- [ ] Branch `refactor/event-driven-arch-v2` exists and pushed
- [ ] Mutation pipeline (`appState.mutate()`) routes all changes through single entry point with pre/post hooks
- [ ] Undo tracking runs automatically as a pre-hook — no imperative calls in main.ts
- [ ] Canvas sync runs only when diff is non-null (avoids redundant updates on style slider drags)
- [ ] Tool protocol defined (`ToolProtocol` interface + `ToolRunner` framework class)
- [ ] All 12 tool files refactored to declarative draw phases (no manual event binding, no coordinate math in tools)
- [ ] Data loading mutations bypass hooks to prevent event flood during restore
- [ ] Test suite runs green (`npx vitest --run`) — all mutation pipeline tests + markup lifecycle integration tests pass
- [ ] Export uses single-pass render target (single canvas composite → embedded directly into PDF, no coordinate mapping)
- [ ] README architecture section updated with v2 documentation
- [ ] `docs/EVENT-DRIVEN-ARCH-V2.md` created explaining architectural decisions and debugging tips
- [ ] Full TypeScript compilation passes (`npx tsc --noEmit`)
- [ ] Production build succeeds without errors (`npm run build` or `npx tauri dev`)

---

**Plan complete and saved. Ready to execute using subagent-driven-development — I'll dispatch a fresh subagent per task with two-stage review (spec compliance then code quality). Shall I proceed?**

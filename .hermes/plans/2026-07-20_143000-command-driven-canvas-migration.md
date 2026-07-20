# Command-Driven Canvas Architecture Migration

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace imperative main.ts mutation patterns with a single command/event pipeline where data changes flow through state → event bus → canvas sync, eliminating direct stageManager calls and enabling safer testing/debugging as features compound.

**Architecture:** Introduce an immutable `Command` interface that wraps mutations (addMarkup, updateMarkup, removeMarkup), route all changes through `appState.dispatch(command)`, and let the canvas layer subscribe to state changes reactively via existing event bus. This removes ~60% of imperative stageManager calls from main.ts.

**Tech Stack:** Vite + TypeScript, Konva.js, pdfjs-dist, pdf-lib, idb (IndexedDB), Tauri 2.x — no new dependencies required.

---

## Phase 1: Git Setup & Baseline

### Task 1: Create feature branch
**Objective:** Isolate changes from main for safe development and easy review.

**Step 1: Fetch latest and create branch**

```bash
cd "/home/kaiman/Documents/Software Repos/RedlinePDF"
git fetch origin
git checkout -b refactor/command-driven-canvas origin/main
git push -u origin refactor/command-driven-canvas
```

**Verification:** Confirm you're on the new branch with `git status`. Ensure clean working tree.

---

### Task 2: Establish test infrastructure (if not exists)
**Objective:** Set up basic test runner to prevent regression during migration.

**Step 1: Check if tests exist, create minimal setup if needed**

```bash
cd "/home/kaiman/Documents/Software Repos/RedlinePDF"
find . -name "*.test.*" -o -name "*.spec.*" | head -5
```

If no test infrastructure exists, add Vitest (Vite's native test runner):

```bash
npm install -D vitest @testing-library/dom jsdom
npx vitest --init  # Select Vitest when prompted
```

**Verification:** Run `npx vitest --run` — should show 0 tests, no errors.

---

## Phase 2: Define Command Interface & State Dispatch

### Task 3: Create command types in model/document.ts
**Objective:** Define a discriminated union of commands that can represent all mutations.

**Files:**
- Modify: `src/model/document.ts` (add new types)

```typescript
// Add to src/model/document.ts, after existing MarkupType definitions

export type Command =
  | { kind: 'ADD_MARKUP'; markup: Markup }
  | { kind: 'UPDATE_MARKUP'; id: string; partial: Partial<Markup> }
  | { kind: 'REMOVE_MARKUPS'; ids: string[] }
  | { kind: 'DUPLICATE_MARKUPS'; ids: string[] }
  | { kind: 'SET_TOOL'; tool: ToolType }
  | { kind: 'SET_SELECTION'; id: string | string[] | null }
  | { kind: 'UPDATE_STYLE'; id: string; partialStyle: Partial<Markup['style']> }
  | { kind: 'NUDGE_SELECTION'; dx: number; dy: number }
  | { kind: 'REBUILD_MARKUP_LAYER' }
  | { kind: 'ADD_COUNT_CATEGORY' }
  | { kind: 'DELETE_COUNT_CATEGORY'; id: string }
  | { kind: 'RENAME_COUNT_CATEGORY'; id: string; name: string }
  | { kind: 'SET_ACTIVE_PAGE'; index: number };

export type CommandKind = Command['kind'];
```

**Step 2:** Export these from document.ts, verify TypeScript compiles with `npx tsc --noEmit`.

---

### Task 4: Add dispatch method to appState
**Objective:** Route commands through state layer and emit events for canvas sync.

**Files:**
- Modify: `src/state/appState.ts` (add dispatch + handler)

```typescript
// In appState class, add:

private commandHandlers = new Map<CommandKind, (cmd: Command) => void>();

registerHandler(kind: CommandKind, handler: (cmd: Command) => void): void {
  this.commandHandlers.set(kind, handler);
}

dispatch(command: Command): void {
  const handler = this.commandHandlers.get(command.kind);
  if (!handler) {
    console.warn(`No handler for command: ${command.kind}`);
    return;
  }
  
  // Snapshot before mutating (for undo/redo)
  snapshotMarkups();
  
  // Execute handler
  handler(command);
  
  // Emit event after mutation
  this.emit(`${command.kind.toLowerCase()}-executed`, command);
}

// Initialize default handlers in constructor or init method:
init(): void {
  this.registerHandler('SET_TOOL', (cmd) => this.update({ activeTool: cmd.tool }));
  this.registerHandler('REBUILD_MARKUP_LAYER', () => {
    // Handled by canvas subscription
  });
}
```

**Step 3:** Create `src/state/commandHandlers.ts` with the actual mutation logic registered in appState's init. This keeps main.ts clean and separates concerns.

---

## Phase 3: Canvas Sync Layer (Reactive)

### Task 5: Create canvasSync module
**Objective:** New module that subscribes to state events and updates Konva layer reactively.

**Files:**
- Create: `src/state/canvasSync.ts`

```typescript
// src/state/canvasSync.ts - Reactive bridge between state changes and Konva

import { appState } from './appState';
import type { StageManager } from '../canvas/stage';
import type { Markup, CountMarkup, CountLegendMarkup } from '../model/document';

export function createCanvasSync(stageManager: StageManager): () => void {
  const unsubscribers: (() => void)[] = [];
  
  // Subscribe to state changes and update canvas reactively
  const unsubscribeAddMarkup = appState.on('markup-added', (cmd) => {
    if ('markup' in cmd) stageManager.addMarkupNode(cmd.markup);
  });
  unsubscribers.push(unsubscribeAddMarkup);
  
  const unsubscribeUpdateStyle = appState.on('style-updated', (cmd) => {
    if ('id' in cmd && 'partialStyle' in cmd) {
      // Find current markup and update
      stageManager.updateMarkupNode(cmd.id, cmd.partialStyle);
    }
  });
  unsubscribers.push(unsubscribeUpdateStyle);
  
  const unsubscribeRemove = appState.on('markups-removed', (cmd) => {
    if ('ids' in cmd) cmd.ids.forEach(id => stageManager.removeMarkupNode(id));
  });
  unsubscribers.push(unsubscribeRemove);
  
  // Rebuild whole layer when page changes or explicit rebuild requested
  const unsubscribeRebuild = appState.on('markup-layer-rebuilt', () => {
    stageManager.clearMarkups();
    // Re-add all markups from current page (fetched via state)
  });
  unsubscribers.push(unsubscribeRebuild);
  
  return () => unsubscribers.forEach(u => u());
}
```

**Step 6:** Register this in `main.ts` bootstrap: call `createCanvasSync(stageManager)` after stage is created, store the cleanup function.

---

## Phase 4: Refactor main.ts (Replace Imperative Calls)

### Task 7: Replace addMarkup with command dispatch
**Objective:** Remove direct stageManager.addMarkupNode() calls in favor of state commands.

**Files:**
- Modify: `src/main.ts` (~lines 148-265, replace `addMarkup`, `removeSelectedMarkups`, `duplicateSelectedMarkups`)

Before (imperative):
```typescript
function addMarkup(markup: Markup): void {
  snapshotMarkups();
  page.markups.push(markup);
  stageManager?.addMarkupNode(markup);
  // ... more imperative code
}
```

After (command-driven):
```typescript
function addMarkup(markup: Markup): void {
  appState.dispatch({ kind: 'ADD_MARKUP', markup });
}
```

**Step 8:** Update `updateMarkup` function similarly. Remove direct stageManager calls, dispatch command instead. The canvasSync module handles the visual update reactively.

---

### Task 9: Refactor removeSelectedMarkups and duplicate logic
**Objective:** Consolidate multi-markup operations through commands.

**Files:**
- Modify: `src/main.ts` (~lines 190-266)

```typescript
function removeSelectedMarkups(): void {
  const ids = appState.state.selectedMarkupIds;
  if (ids.length === 0) return;
  appState.dispatch({ kind: 'REMOVE_MARKUPS', ids });
}

function duplicateSelectedMarkups(): void {
  const ids = appState.state.selectedMarkupIds;
  if (ids.length === 0) return;
  
  // Deep clone logic stays here temporarily, then dispatch result
  const clones = deepCloneMarkups(ids);  // Extract to helper in separate file
  clones.forEach(clone => appState.dispatch({ kind: 'ADD_MARKUP', markup: clone }));
}
```

**Step 10:** Extract `deepCloneMarkups` into `src/state/markupUtils.ts` with tests. This isolates the complex position-offset logic from UI flow.

---

### Task 10: Refactor count tool mutations
**Objective:** Move count category/stamp management through commands too.

**Files:**
- Modify: `src/main.ts` (~lines 395-462, replace count-related functions)

```typescript
function addCountCategory(): void {
  appState.dispatch({ kind: 'ADD_COUNT_CATEGORY' });
}

function deleteCountCategory(id: string): void {
  // Also needs to remove stamps - extend REMOVE_MARKUPS or create new command
  const stamps = getStampsByCategory(categoryId);
  appState.dispatch({ kind: 'REMOVE_MARKUPS', ids: stamps.map(s => s.id) });
  appState.dispatch({ kind: 'DELETE_COUNT_CATEGORY', id });
}

function addCountStamp(markup: CountMarkup): void {
  appState.dispatch({ kind: 'ADD_MARKUP', markup });
}
```

**Step 11:** Register handlers in `commandHandlers.ts` for count operations. These will trigger legend refresh via the event bus (`count-category-changed`, `markup-added`).

---

### Task 11: Update style changes to use commands
**Objective:** Slider updates that modify markup styles now go through dispatch instead of direct stageManager.updateMarkupNode().

**Files:**
- Modify: `src/ui/properties.ts` and related event handlers in main.ts

Before:
```typescript
function onStyleChange(markupId, partialStyle) {
  updateMarkup(markupId, partialStyle);
}
```

After:
```typescript
function onStyleChange(markupId, partialStyle) {
  appState.dispatch({ kind: 'UPDATE_STYLE', id: markupId, partialStyle });
}
```

**Step 12:** Ensure `canvasSync.ts` listens for style updates and only calls stageManager when a real visual change is needed (debounce rapid slider moves).

---

## Phase 5: Undo/Redo Enhancement

### Task 13: Snapshot command history instead of full page state
**Objective:** More granular undo that captures commands rather than full JSON snapshots.

**Files:**
- Modify: `src/main.ts` (undoStack logic) and create `src/state/historyStore.ts`

```typescript
// src/state/historyStore.ts - Manages undo/redo via command sequence

export class HistoryStore {
  private history: Command[] = [];
  private index = -1;
  
  record(command: Command): void {
    // Clear forward history when new action happens
    this.history = this.history.slice(0, this.index + 1);
    
    // Deep clone to snapshot (avoid reference mutation)
    this.history.push(JSON.parse(JSON.stringify(command)));
    this.index++;
    
    // Cap at 50 commands per page (reasonable for construction plans)
    if (this.history.length > 50) {
      this.history.shift();
      this.index--;
    }
  }
  
  undo(): Command | null {
    if (this.index < 0) return null;
    const command = this.history[this.index--];
    // Return the inverse operation to reverse it
    return createInverse(command);
  }
  
  redo(): Command | null {
    if (this.index >= this.history.length - 1) return null;
    this.index++;
    return this.history[this.index];
  }
  
  getAvailable(): boolean {
    return this.index >= 0;
  }
}

function createInverse(command: Command): Command | null {
  switch (command.kind) {
    case 'ADD_MARKUP':
      return { kind: 'REMOVE_MARKUPS', ids: [command.markup.id] };
    case 'UPDATE_MARKUP':
      // Store original state before mutation - simplified version
      return { 
        kind: 'UPDATE_MARKUP', 
        id: command.id, 
        partial: getOriginalState(command.id) 
      };
    case 'REMOVE_MARKUPS':
      // Would need to restore the removed markups from history snapshot
      return null;  // Complex - keep simple for now
    default:
      return null;
  }
}
```

**Step 14:** Integrate into appState.dispatch() — call `historyStore.record(command)` after successful execution. Wire up Ctrl+Z/Ctrl+Y handlers to dispatch inverse commands.

---

## Phase 6: Testing & Validation

### Task 15: Write tests for command system
**Objective:** Ensure mutations flow correctly through the new pipeline without breaking existing behavior.

**Files:**
- Create: `tests/state/commandSystem.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { appState } from '../../src/state/appState';
import type { Command } from '../../src/model/document';

describe('Command System', () => {
  it('should dispatch SET_TOOL and update activeTool in state', () => {
    const initialState = { ...appState.state };
    
    appState.dispatch({ kind: 'SET_TOOL', tool: 'pen' });
    
    expect(appState.state.activeTool).toBe('pen');
  });

  it('should emit event on command execution for canvas sync', () => {
    let eventEmitted = false;
    
    const unsubscribe = appState.on('set-tool-executed', (cmd) => {
      eventEmitted = true;
    });
    
    appState.dispatch({ kind: 'SET_TOOL', tool: 'line' });
    unsubscribe();  // Cleanup
    
    expect(eventEmitted).toBe(true);
  });

  it('should register handler before dispatching', () => {
    let handlerCalled = false;
    
    appState.registerHandler('CUSTOM_TEST_CMD', (cmd) => {
      handlerCalled = true;
    });
    
    // Need to add CUSTOM_TEST_CMD to Command type first - this test validates the registration system
    expect(appState.commandHandlers.has('CUSTOM_TEST_CMD')).toBe(true);
  });

  it('should handle missing handler gracefully', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    
    appState.dispatch({ kind: 'UNREGISTERED_COMMAND' as Command['kind'] });
    
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No handler'));
  });
});
```

**Step 16:** Run tests with `npx vitest --run` — all should pass.

---

### Task 17: Integration test for markup lifecycle
**Objective:** Verify add → update → remove flow through command system works end-to-end.

**Files:**
- Create: `tests/integration/markupLifecycle.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
// Mock stageManager to avoid Konva dependency in tests
vi.mock('../../src/canvas/stage', () => ({
  createStage: vi.fn()
}));

describe('Markup Lifecycle via Commands', () => {
  it('should add markup through dispatch and emit event for canvas sync', async () => {
    // Setup mocks...
    
    const unsubscribe = appState.on('markup-added-executed', (cmd) => {
      expect(cmd.kind).toBe('ADD_MARKUP');
      expect(cmd.markup.type).toBe('pen');
    });
    
    const testMarkup = createTestPenMarkup();
    appState.dispatch({ kind: 'ADD_MARKUP', markup: testMarkup });
    
    unsubscribe();
  });

  it('should remove multiple markups in single dispatch', () => {
    // Setup with existing markups...
    
    let removedIds: string[] = [];
    const unsubscribe = appState.on('markups-removed-executed', (cmd) => {
      removedIds = cmd.ids;
    });
    
    appState.dispatch({ 
      kind: 'REMOVE_MARKUPS', 
      ids: ['id1', 'id2', 'id3'] 
    });
    
    unsubscribe();
    expect(removedIds).toEqual(['id1', 'id2', 'id3']);
  });

  it('should update style and emit style-updated event', () => {
    // Setup...
    
    let updatedStyle: any = null;
    const unsubscribe = appState.on('style-updated-executed', (cmd) => {
      updatedStyle = cmd.partialStyle;
    });
    
    appState.dispatch({ 
      kind: 'UPDATE_STYLE', 
      id: 'markupId123', 
      partialStyle: { strokeWidth: 3, strokeColor: '#ff0000' } 
    });
    
    unsubscribe();
    expect(updatedStyle.strokeWidth).toBe(3);
  });
});
```

**Step 18:** Run tests — verify they pass. Fix any failures until all green.

---

## Phase 7: Final Refinement & Documentation

### Task 19: Update README architecture section
**Objective:** Document the new command-driven architecture for future developers.

**Files:**
- Modify: `README.md` (~lines 128-143, replace "Architecture Notes" section)

```markdown
## Architecture Notes (v0.2.0+)

### Command-Driven Mutation Pattern
All markup mutations flow through a central command system:

1. UI triggers action (e.g., user draws line)
2. Action dispatches `Command` to `appState.dispatch()`
3. Handler executes mutation on data model
4. Event bus emits change notification (e.g., `markup-added-executed`)
5. Canvas sync layer subscribes and updates Konva reactively

This separation means:
- Data state and visual rendering are decoupled
- Undo/redo can replay command history
- Testing is straightforward (mock event bus, verify commands)
- New tools just register handlers — no imperative canvas manipulation needed
```

---

### Task 20: Final review & cleanup
**Objective:** Verify all imperative stageManager calls have been replaced or justified.

**Step 1: Audit remaining direct canvas access in main.ts**

```bash
grep -n "stageManager\." "/home/kaiman/Documents/Software Repos/RedlinePDF/src/main.ts" | grep -v "// " | grep -v "if (!stageManager)"
```

If any direct calls remain, they should be documented with comment explaining why imperative access is necessary (e.g., performance-critical paths that bypass state for real-time drag feedback).

**Step 2: Run full TypeScript compilation check**

```bash
cd "/home/kaiman/Documents/Software Repos/RedlinePDF"
npx tsc --noEmit
```

Fix any type errors until clean.

---

### Task 21: Create migration guide in docs/ folder
**Objective:** Help future developers understand the architectural shift if they need to extend or debug.

**Files:**
- Create: `docs/CANVAS-ARCHITECTURE.md`

Content should cover:
- Why command-driven architecture (motivations)
- How commands flow (diagram with state → event bus → canvas sync)
- Registering a new command type (step-by-step example)
- When to use imperative stageManager calls vs. commands
- Common pitfalls and debugging tips

---

## Risk & Tradeoffs Summary

### Risks:
1. **Performance regression:** Command dispatch adds indirection before canvas updates. Mitigate with debouncing in canvasSync for rapid events (style sliders).
2. **Complexity overhead:** More abstraction layers mean harder initial setup. Mitigate with thorough documentation and tests.
3. **Existing tools need migration:** All 12 tool files currently call stageManager directly or rely on main.ts imperative patterns. Each needs review during phase 4-5.

### Tradeoffs:
- **Simpler vs. more robust:** Command system is more code upfront but pays dividends as features compound (multi-page undo, sync across instances, etc.).
- **Imperative for drag feedback:** Real-time drag operations still need direct stageManager calls during mousedown/mousemove phases; commands only fire on mouseup/finalize. This hybrid approach preserves performance where needed.

### Open Questions:
1. Should history store track per-page command sequences or global? (Answer: Per-page, since different pages have different markups)
2. How to handle the "deep clone with offset" logic currently in main.ts — move to separate utility module with tests? (Yes, see Task 9)

---

## Verification Checklist

- [ ] Branch `refactor/command-driven-canvas` exists and pushed
- [ ] Command types defined in `src/model/document.ts` compile cleanly
- [ ] `appState.dispatch()` routes commands through registered handlers
- [ ] `canvasSync.ts` subscribes to state events and updates Konva reactively
- [ ] All direct stageManager calls removed from main.ts (except drag feedback paths)
- [ ] Test suite runs green with `npx vitest --run`
- [ ] Markup lifecycle tests pass (add → update → remove)
- [ ] Undo/redo works correctly via command history replay
- [ ] README architecture section updated
- [ ] Documentation in `docs/CANVAS-ARCHITECTURE.md` created
- [ ] Full TypeScript compilation passes with no errors

---

**Plan complete and saved. Ready to execute using subagent-driven-development — I'll dispatch a fresh subagent per task with two-stage review (spec compliance then code quality). Shall I proceed?**

/**
 * Declarative tool protocol — each tool declares what it does; ToolRunner wires it.
 *
 * DESIGN CONTRACT (read before writing/modifying a tool):
 *  - A tool is a singleton object. It is stateless: carry per-gesture state in
 *    module-level `let` variables (see any *Tool.ts), never on the object.
 *  - Dispatch is mutually exclusive on the canvas:
 *      • `draw`    present  → drag tool: startDraw → midDraw* → endDraw → commit Markup
 *      • `onClick` present  → click tool: onClick fires immediately on mousedown
 *      • BOTH present → draw wins; NEITHER → tool does nothing on canvas
 *  - A click-only tool MUST NOT define `draw`. A no-op `draw` phase silently swallows
 *    the click (endDraw never commits) — that is the classic "tool won't respond" bug.
 *  - `startDraw(e)` returns the preview Konva.Shape (or null). `midDraw(e)` updates it.
 *    `endDraw()` takes NO args (read positions from your module closure) and returns the
 *    Markup to commit, or null to discard.
 *  - `onDblClick` / `onKey` are for multi-click tools (polygons, scale-set close).
 *  - `deactivate()` must destroy any preview nodes so a half-finished gesture can't ghost.
 */
import type Konva from 'konva';
import type { ToolType } from '../state/appState.ts';

export interface DrawPhase {
  startDraw(e: { x: number; y: number }): void | Konva.Shape | null;
  midDraw?(e: { x: number; y: number }): void;
  endDraw?(): import('../model/document').Markup | null;
}

export type DrawEvent = { x: number; y: number };

export interface ToolProtocol {
  id: ToolType;
  name: string;
  key?: string;

  /** Drag tools define this. Click-only tools (text, count, scale-set, measure-poly) must omit it. */
  draw?: DrawPhase & {
    // Optional position tracking for multi-point shapes (ellipse, box)
    startPos?: { x: number; y: number } | null;
  };
  /** Click tools define this. Fires on mousedown (no drag). */
  onClick?(e: { x: number; y: number }): void;
  onDblClick?(e: { x: number; y: number }): void;
  onKey?(e: KeyboardEvent): void;
  onDragStart?(e: { x: number; y: number }): void;
  onDragMove?(e: { x: number; y: number }): void;
  onDragEnd?(): void;

  /** Optional cleanup when deactivating — called by ToolRunner. ALWAYS clear preview nodes here. */
  deactivate?(): void;
}

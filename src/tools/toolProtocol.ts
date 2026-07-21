/** Declarative tool protocol — each tool declares what it does, framework handles wiring. */
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

  draw?: DrawPhase & { 
    // Optional position tracking for multi-point shapes (ellipse, box)
    startPos?: { x: number; y: number } | null;
  };
  onClick?(e: { x: number; y: number }): void;
  onDragStart?(e: { x: number; y: number }): void;
  onDragMove?(e: { x: number; y: number }): void;
  onDragEnd?(): void;
  
  /** Optional cleanup when deactivating — called by ToolRunner */
  deactivate?(): void;
}

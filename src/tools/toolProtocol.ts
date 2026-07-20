/** Declarative tool protocol — each tool declares what it does, framework handles wiring. */

import type Konva from 'konva';
import type { ToolType } from '../state/appState.ts';

export interface DrawPhase {
  startDraw(e: { x: number; y: number }): void | Konva.Shape;
  midDraw?(e: { x: number; y: number }): void;
  endDraw?(): import('../model/document').Markup | null;
}

export interface ToolProtocol {
  id: ToolType;
  name: string;
  key?: string;

  draw?: DrawPhase;
  onClick?(e: { x: number; y: number }): void;
  onDragStart?(e: { x: number; y: number }): void;
  onDragMove?(e: { x: number; y: number }): void;
  onDragEnd?(): void;
}

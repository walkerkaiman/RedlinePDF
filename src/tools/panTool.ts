import type { ToolProtocol } from './toolProtocol';
import { toolRunner } from './toolRunner';

// Closure state — survives between startDraw/midDraw/endDraw ticks.
let _dragStartPos: { x: number; y: number } | null = null;

const panDraw: import('./toolProtocol').DrawPhase = {
  startDraw(e: any) {
    const stageManager = toolRunner.getStageManager();
    if (!stageManager?.stage) return null;

    _dragStartPos = { x: e.x, y: e.y };
    stageManager.stage.container().style.cursor = 'grabbing';
    return null; // pan creates no shape — state lives in closure above
  },

  midDraw(e: any) {
    const stageManager = toolRunner.getStageManager();
    if (!stageManager?.stage || !_dragStartPos) return null;

    const dx = e.x - _dragStartPos.x;
    const dy = e.y - _dragStartPos.y;

    const oldPos = stageManager.stage.position();
    stageManager.stage.position({ x: oldPos.x + dx, y: oldPos.y + dy });

    return null; // no shape to update
  },

  endDraw() {
    const stageManager = toolRunner.getStageManager();
    if (!stageManager?.stage) return null;

    _dragStartPos = null;
    stageManager.stage.container().style.cursor = 'default';
    return null; // no markup — pan is a transient interaction
  },
};

export const panTool: ToolProtocol = {
  id: 'pan',
  name: 'Pan/Hand',
  key: 'h',
  draw: panDraw,
};

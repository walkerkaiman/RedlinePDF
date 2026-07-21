import type { ToolProtocol } from './toolProtocol';
import { toolRunner } from './toolRunner';

let isDragging = false;
let startPos: { x: number; y: number } | null = null;

const panDrawPhase = {
  startDraw() {},
  midDraw() {},
  endDraw(): null { return null; },
  
  onClick(e: any) {
    const stageManager = toolRunner.getStageManager();
    if (!stageManager?.stage) return;
    
    isDragging = true;
    startPos = { x: e.x, y: e.y };
    stageManager.stage.container().style.cursor = 'grabbing';
  },
  
  onDragMove(e: any) {
    if (!isDragging || !startPos) return;
    
    const dx = e.x - startPos.x;
    const dy = e.y - startPos.y;
    const stageManager = toolRunner.getStageManager();
    
    if (stageManager?.stage) {
      const oldPos = stageManager.stage.position();
      stageManager.stage.position({ x: oldPos.x + dx, y: oldPos.y + dy });
    }
  },
  
  onDragEnd() {
    isDragging = false;
    startPos = null;
    
    const stageManager = toolRunner.getStageManager();
    if (stageManager?.stage) {
      stageManager.stage.container().style.cursor = 'default';
      stageManager.stage.batchDraw();
    }
  },
};

export const panTool: ToolProtocol = {
  id: 'pan',
  name: 'Pan/Hand',
  key: 'h',
  draw: panDrawPhase,
};

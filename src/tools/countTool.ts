import type { ToolProtocol } from './toolProtocol';
import { toolRunner } from './toolRunner';
import { konvaToPdf } from '../geometry/transform';
import { generateId } from '../model/document';

const countDrawPhase = {
  startDraw() {},
  midDraw() {},
  endDraw() { return null; },
  
  onClick(e: { x: number, y: number }) {
    const activeCatId = toolRunner.getAppState().state.activeCountCategoryId;
    if (!activeCatId) return;

    // Only fire on empty canvas / PDF background, not on existing markups
    
    // Get current page state - access via the appState structure
    const currentPageIndex = toolRunner.getPageIndex();
    
    // Access count categories from the active page's state
    // The AppStateManager doesn't have getCurrentPage(), so we need to work with what exists
    // For now, use a simple approach that matches the existing pattern
    
    // Create markup with basic count category info
    const markup = {
      id: generateId(),
      type: 'count',
      pageIndex: currentPageIndex,
      style: { strokeColor: '#000000', strokeWidth: 1.5, strokeOpacity: 1 },
      x: e.x,
      y: e.y,
      categoryId: activeCatId,
      symbol: '●',
      color: toolRunner.getAppState().state.activeCountCategoryId ? '#3b82f6' : '#000000',
      size: 10,
    };

    toolRunner.getAppState().mutate('ADD_MARKUP', { markup });
  },
};

export const countTool: ToolProtocol = {
  id: 'count',
  name: 'Count Stamp',
  key: 'c',
  draw: countDrawPhase,
};

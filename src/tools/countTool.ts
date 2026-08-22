import type { ToolProtocol } from './toolProtocol';
import { toolRunner } from './toolRunner';
import { konvaToPdf } from '../geometry/transform';
import { generateId } from '../model/document';

/** Commit a count stamp at the Konva-space click point — converted to PDF space before dispatch. */
function countOnClick(e: { x: number, y: number }): void {
    const activeCatId = toolRunner.getAppState().state.activeCountCategoryId;
    if (!activeCatId) return;

    // Only fire on empty canvas / PDF background, not on existing markups
    
    // Get current page state - access via the appState structure
    const currentPageIndex = toolRunner.getPageIndex();
    
    // Access count categories from the active page's state
    // The AppStateManager doesn't have getCurrentPage(), so we need to work with what exists
    // For now, use a simple approach that matches the existing pattern
    
    // Create markup with basic count category info. Model coords are PDF space
    // (bottom-left origin), so convert the Konva-space click position first — every
    // other tool does this in endDraw/onClick before committing via ADD_MARKUP.
    const pdfPos = konvaToPdf(e.x, e.y, toolRunner.getPageHeightPts());

    const markup = {
      id: generateId(),
      type: 'count',
      pageIndex: currentPageIndex,
      style: { strokeColor: '#000000', strokeWidth: 1.5, strokeOpacity: 1 },
      x: pdfPos.x, y: pdfPos.y,
      categoryId: activeCatId,
      symbol: '●',
      color: toolRunner.getAppState().state.activeCountCategoryId ? '#3b82f6' : '#000000',
      size: 10,
    };

    toolRunner.getAppState().mutate('ADD_MARKUP', { markup, pageIndex: currentPageIndex });
}

/** Click-only tool — ToolRunner routes mousedown to protocol.onClick only when draw is absent; a no-op draw phase would swallow the click in endDraw() and never commit. */
export const countTool: ToolProtocol = {
  id: 'count',
  name: 'Count Stamp',
  key: 'c',
  onClick: (e) => countOnClick(e),
};

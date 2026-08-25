import type { ToolProtocol } from './toolProtocol';
import { toolRunner } from './toolRunner';
import { konvaToPdf } from '../geometry/transform';
import { generateId } from '../model/document';

/** Commit a count stamp at the Konva-space click point — converted to PDF space before dispatch. */
function countOnClick(e: { x: number, y: number }): void {
    // If no category is active (user deleted the last one, or a project loaded with none),
    // seed a default so the click still stamps instead of silently no-op'ing.
    if (!toolRunner.getAppState().state.activeCountCategoryId) {
      toolRunner.getAppState().emit('cmd-count-add-category');
    }

    const activeCatId = toolRunner.getAppState().state.activeCountCategoryId;
    if (!activeCatId) return;

    // Get current page state - access via the appState structure
    const currentPageIndex = toolRunner.getPageIndex();

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
      color: '#3b82f6',
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

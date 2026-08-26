/**
 * Count tool — CLICK-ONLY by design (NO `draw` phase; a draw phase would swallow the click).
 * On click it seeds a default category if none is active (so the tool doesn't silently no-op),
 * then stamps a count markup at the Konva-space point converted to PDF space before dispatch.
 */
import type { ToolProtocol } from './toolProtocol';
import { toolRunner } from './toolRunner';
import { konvaToPdf } from '../geometry/transform';
import { generateId } from '../model/document';
import type { CountSymbol } from '../model/document';

/** Commit a count stamp at the Konva-space click point — converted to PDF space before dispatch. */
function countOnClick(e: { x: number, y: number }): void {
    // If no category is active (user deleted the last one, or a project loaded with none),
    // seed a default so the click still stamps instead of silently no-op'ing.
    if (!toolRunner.getAppState().state.activeCountCategoryId) {
      toolRunner.getAppState().emit('cmd-count-add-category');
    }

    const activeCatId = toolRunner.getAppState().state.activeCountCategoryId;
    if (!activeCatId) return;

    // Seed a valid keyword symbol so createCountSymbolShape always renders a
    // visible shape (a stray Unicode bullet like '●' would fall through the
    // shape switch and produce an empty, invisible group). The category's own
    // symbol/color is applied separately when the category is created/changed.
    const symbol: CountSymbol = 'circle';
    const color = '#3b82f6';

    const currentPageIndex = toolRunner.getPageIndex();

    // Create markup with basic count category info. Model coords are PDF space
    // (bottom-left origin), so convert the Konva-space click position first — every
    // other tool does this in endDraw/onClick before committing via ADD_MARKUP.
    const pdfPos = konvaToPdf(e.x, e.y, toolRunner.getPageHeightPts());

    const markup = {
      id: generateId(),
      type: 'count',
      pageIndex: currentPageIndex,
      style: { strokeColor: color, strokeWidth: 1.5, strokeOpacity: 1 },
      x: pdfPos.x, y: pdfPos.y,
      categoryId: activeCatId,
      symbol,
      color,
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

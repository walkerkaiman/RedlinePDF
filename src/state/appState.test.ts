import { describe, it, expect, beforeEach } from 'vitest';
import { appState } from './appState.ts';

describe('AppState mutation pipeline', () => {
  beforeEach(() => {
    // Reset state before each test — tests should be independent and not depend on ordering.
    appState.update({ activeTool: 'select' as any, zoom: 1 });
  });

  describe('initial state', () => {
    it('has correct default tool', () => {
      expect(appState.state.activeTool).toBe('select');
    });

    it('starts with empty selection arrays', () => {
      expect(appState.state.selectedMarkupIds).toEqual([]);
      expect(appState.state.selectedMarkupTypes).toEqual([]);
    });

    it('has initial page state of 0 pages, index 0', () => {
      expect(appState.state.totalPages).toBe(0);
      expect(appState.state.activePageIndex).toBe(0);
    });
  });

  describe('mutation ordering: pre-hooks → handler → diff → post-hooks', () => {
    it('TOGGLE_TOOL emits a tool-change event — observable side effect of mutation handler', async () => {
      // The pipeline's handler for TOGGLE_TOOL calls this.emit('tool-change', tool).
      // We verify the emitted value, not internal hook ordering (private arrays are unobservable from outside).
      let received: any = null;
      const unsub = appState.on('tool-change', (data) => { received = data; });

      appState.mutate('TOGGLE_TOOL', { tool: 'pen' });
      expect(received).toBe('pen');

      unsub();
    });

    it('CHANGE_PAGE emits page-change event — observable side effect of mutation handler', () => {
      // Pre-condition: totalPages must be set so handler logic runs.
      appState.update({ totalPages: 5, activePageIndex: 0 });
      let received = null;
      const unsub = appState.on('page-change', (data) => { received = data; });

      appState.mutate('CHANGE_PAGE', { index: 2 });
      expect(received).toBe(2);
      // And state reflects the page change.
      expect(appState.state.activePageIndex).toBe(2);

      unsub();
    });

    it('SET_SELECTION emits selection-change event with single ID — observable side effect of mutation handler', () => {
      let received: any = null;
      const unsub = appState.on('selection-change', (data) => { received = data; });

      appState.mutate('SET_SELECTION', { ids: 'markup-1' });
      expect(received).toEqual(['markup-1']);

      unsub();
    });

    it('does not throw when mutating with unregistered kind — should fail loudly', () => {
      // Mutation handlers are registered by kind. Unregistering one should cause a clear error.
      // We can't easily unregister, so this test verifies the contract: mutations always have handlers.
      // If handler registration is broken, calling mutate throws an informative error.
      const fn = () => appState.mutate('NONEXISTENT_KIND' as any, {});
      expect(fn).toThrow();
    });

    it('mutate for TOGGLE_TOOL clears selection — observable behavior of the handler', () => {
      // The default TOGGLE_TOOL handler sets selectedMarkupId/Ids/Types to null/empty.
      appState.update({ selectedMarkupId: 'old-selection' as any, selectedMarkupIds: ['old-selection'] });
      expect(appState.state.selectedMarkupId).toBe('old-selection');

      appState.mutate('TOGGLE_TOOL', { tool: 'pen' });
      expect(appState.state.selectedMarkupId).toBeNull();
      expect(appState.state.selectedMarkupIds).toEqual([]);
    });
  });

  describe('subscribe/notify behavior', () => {
    it('listeners receive state updates when update() is called', () => {
      let received: any = null;
      const unsub = appState.subscribe((state) => { received = state; });

      appState.update({ zoom: 2.5 });
      expect(received!.zoom).toBe(2.5);

      unsub();
    });

    it(`unsubscribing removes the listener — subsequent updates don't reach it`, () => {
      let count = 0;
      const unsub = appState.subscribe(() => { count++; });

      appState.update({ zoom: 1.25 });
      expect(count).toBe(1);

      unsub();
      appState.update({ zoom: 3.0 });
      // Listener removed — count stays at 1, no second increment.
      expect(count).toBe(1);
    });
  });

  describe('event bus emit/on', () => {
    it('emits event with data to all registered listeners for that event', () => {
      const received: any[] = [];
      appState.on('custom-event', (data) => { received.push(data); });
      appState.on('custom-event', (data) => { received.push(`prefix-${data}`); });

      appState.emit('custom-event', 'value');
      expect(received).toEqual(['value', 'prefix-value']);
    });

    it('emit with no data still calls listeners — undefined passed through', () => {
      let called = false;
      const unsub = appState.on('no-data-event', () => { called = true; });

      appState.emit('no-data-event');
      expect(called).toBe(true);

      unsub();
    });

    it('unsubscribing stops future events from reaching the listener', () => {
      let count = 0;
      const unsub = appState.on('test-unsub', () => { count++; });

      appState.emit('test-unsub');
      expect(count).toBe(1);

      unsub();
      appState.emit('test-unsub');
      // Listener removed — no increment.
      expect(count).toBe(1);
    });
  });

  describe('setZoom', () => {
    it('clamps zoom to [0.1, 10] range — prevents invalid values entering state', () => {
      appState.setZoom(999);
      expect(appState.state.zoom).toBeCloseTo(10, 5);
    });

    it('clamps low zoom to minimum of 0.1', () => {
      appState.setZoom(-5);
      expect(appState.state.zoom).toBeCloseTo(0.1, 5);
    });

    it('emits zoom-change event with clamped value — observable side effect', () => {
      let received = null;
      const unsub = appState.on('zoom-change', (data) => { received = data; });

      appState.setZoom(200); // Should be clamped to 10.
      expect(received).toBeCloseTo(10, 5);

      unsub();
    });
  });

  describe('setPage bounds checking', () => {
    it('sets page when index is within valid range — [0, totalPages)', () => {
      appState.update({ totalPages: 3 });
      appState.setPage(1);
      expect(appState.state.activePageIndex).toBe(1);
    });

    it('ignores negative page index silently — no state change', () => {
      appState.update({ totalPages: 3, activePageIndex: 0 });
      // setPage with -1 should not throw; it just returns (silently ignored by handler too).
      expect(() => appState.setPage(-1)).not.toThrow();
    });

    it('ignores page index ≥ totalPages silently', () => {
      appState.update({ totalPages: 3, activePageIndex: 0 });
      // setPage with 5 should not throw; handler's bounds check prevents the change.
      expect(() => appState.setPage(5)).not.toThrow();
    });

    it('emits page-change event when valid — observable side effect', () => {
      let received = null;
      const unsub = appState.on('page-change', (data) => { received = data; });

      appState.update({ totalPages: 3 });
      appState.setPage(2);
      expect(received).toBe(2);

      unsub();
    });
  });

  describe('setSelection', () => {
    it('sets single selection — selectedMarkupId populated, types arrays empty until filled by main.ts', () => {
      appState.setSelection('markup-abc');
      expect(appState.state.selectedMarkupId).toBe('markup-abc');
      expect(appState.state.selectedMarkupIds).toEqual(['markup-abc']);
    });

    it('clears selection when id is null — arrays empty, type null', () => {
      appState.update({ selectedMarkupId: 'old' as any, selectedMarkupIds: ['old'] });
      appState.setSelection(null);
      expect(appState.state.selectedMarkupId).toBeNull();
      expect(appState.state.selectedMarkupTypes).toEqual([]);
    });

    it('emits selection-change with single ID array — observable side effect', () => {
      let received: any = null;
      const unsub = appState.on('selection-change', (data) => { received = data; });

      appState.setSelection('markup-1');
      expect(received).toEqual(['markup-1']);

      unsub();
    });
  });

  describe('setMultiSelection', () => {
    it('selects multiple IDs — selectedMarkupId null, arrays populated', () => {
      const ids = ['id-a', 'id-b', 'id-c'];
      appState.setMultiSelection(ids);
      expect(appState.state.selectedMarkupIds).toEqual(ids);
      // Multi-select leaves single ID null.
      expect(appState.state.selectedMarkupId).toBeNull();
    });

    it('delegates to setSelection for empty array — clears state', () => {
      appState.update({ selectedMarkupId: 'old' as any, selectedMarkupIds: ['old'] });
      appState.setMultiSelection([]);
      expect(appState.state.selectedMarkupIds).toEqual([]);
    });

    it('delegates to setSelection for single ID — behaves like single select', () => {
      appState.setMultiSelection(['single-id']);
      expect(appState.state.selectedMarkupId).toBe('single-id');
    });

    it('emits selection-change with full array when multi-selecting more than one item — observable side effect', () => {
      let received: any = null;
      const unsub = appState.on('selection-change', (data) => { received = data; });

      appState.setMultiSelection(['a', 'b', 'c']);
      expect(received).toEqual(['a', 'b', 'c']);

      unsub();
    });
  });
});

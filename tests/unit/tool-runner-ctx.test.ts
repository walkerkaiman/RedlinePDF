import { describe, it, expect } from 'vitest';

// Regression guard: mousedown without an active protocol / initialized stage must be a
// no-op — never crash. The original implementation (commit history) read an uninitialized
// `_ctx` here and threw; the rewritten runner resolves positions via _eventPos() with full
// null guards, so handleMouseDown on a bare instance must survive silently.
describe('ToolRunner Position Safety', () => {
  it('handleMouseDown without stage initialization is a safe no-op (no crash)', async () => {
    const { ToolRunner } = await import('../../src/tools/toolRunner');

    const runner = new ToolRunner();

    let crashed = false;
    try {
      // Simulate mousedown with the runner never initialized — _stageManager is null.
      const fakeEvent = {
        evt: {},
        clientX: 150,
        clientY: 250,
      } as any;

      (runner as any).handleMouseDown(fakeEvent);
    } catch {
      crashed = true;
    } finally {
      // Invariant: must never throw regardless of init state.
      expect(crashed).toBe(false);
    }
  });
});


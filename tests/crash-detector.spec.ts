/** CRASH DETECTOR TEST - FAILS IF appState init throws TDZ error */

import { expect, test } from 'vitest';
import Konva from 'konva';

test('appState initializes without throwing', async () => {
  const errors: string[] = [];
  
  // Capture all console.error calls during module load
  const originalError = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  
  try {
    // Import appState — if TDZ occurs, this WILL throw
    await import('../src/state/appState');
    
    expect(errors).toEqual([]);
    
    const mod = (await import('../src/state/appState')) as any;
    expect(mod.appState).toBeDefined();
    console.error = originalError; // restore before returning
  } catch (err: any) {
    console.error = originalError; // restore in case of throw
    
    if (err.message.includes('Cannot access') || 
        err.stack?.includes('appState')) {
      // Re-throw with context to fail this test clearly
      throw new Error(`TDZ detected during appState init: ${err.message}`);
    }
    
    expect(err).not.toBeTruthy();
  }
});

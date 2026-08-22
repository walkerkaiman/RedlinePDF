
// Minimal TDZ test - imports everything in init order to surface crashes immediately
import './src/state/appState.ts';
console.log('✅ appState loaded successfully');

try {
  await import('./src/tools/toolRunner.ts');
  console.log('✅ toolRunner loaded successfully');
  
  // Try loading undoTracking next
  const ut = await import('./src/state/undoTracking.ts');
  console.log('✅ undoTracking loaded successfully');
} catch (err: any) {
  console.error('❌ MODULE LOAD FAILURE:', err.message);
  console.error('Stack:', err.stack?.split('\n').slice(0, 10).join('\n'));
  // Don't continue if something crashed
  throw new Error('TDZ or init error detected');
}

// If we got here, no TDZ error - try actually running the app
import { toolRunner } from './src/tools/toolRunner.ts';
console.log('✅ ToolRunner singleton created:', !!toolRunner);

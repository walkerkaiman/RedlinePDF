import { defineConfig } from 'vitest/config';

// Unit tests only — Playwright e2e (*.spec.ts) must NOT be collected here or bare
// `npx vitest` chokes parsing them with a SyntaxError. Keep the two harnesses split:
//   npx vitest run        → src/**/*.test.ts + tests/unit/**  (jsdom, unit)
//   npx playwright test   → tests/*.spec.ts                   (real Chromium e2e)
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.spec.ts'],
  },
});

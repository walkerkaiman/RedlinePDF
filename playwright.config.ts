import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Playwright collects BOTH *.spec.* and *.test.* by default; the unit tests import @vitest/runner, whose describe() crashes outside a vitest worker. Scope to e2e specs only (mirrors what vitest.config.ts excludes in reverse).
  testMatch: /.*\.spec\.[jt]s$/,

  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: true,
    timeout: 60000,
  },

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 8000,
    navigationTimeout: 15000,
    recordVideo: {
      dir: './test-results/videos',
      size: { width: 1280, height: 720 }
    },
  },

  reporter: [['list'], ['html']],
  
  maxRetries: process.env.CI ? 1 : 0,
});
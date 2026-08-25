import { defineConfig } from '@playwright/test';
// Throwaway preview-bundle config for shipped-dist verification (main config uses npm run dev).
export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.[jt]s$/,
  webServer: { command: 'npx vite preview --port 4173 --strictPort', port: 4173, reuseExistingServer: true, timeout: 60000 },
  use: { baseURL: 'http://localhost:4173', screenshot: 'only-on-failure', actionTimeout: 8000, navigationTimeout: 20000 },
});

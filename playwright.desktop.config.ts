import { defineConfig, devices } from '@playwright/test';

// End-to-end config that exercises the COMPILED production frontend (dist/),
// i.e. the bundle that ships inside the .deb and runs on the desktop under
// WebKitGTK. This catches dev-vs-prod and Chromium-vs-WebKit differences that
// the default (dev-server + chromium) config cannot — which is exactly why the
// polygon-area selection bug passed headless tests but failed on the desktop.
export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.[jt]s$/,
  fullyParallel: false,

  // Serve the built frontend (npm run build -> dist/) instead of the dev server.
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: true,
    timeout: 60000,
  },

  projects: [
    {
      name: 'webkit-desktop',
      use: {
        ...devices['Desktop WebKit'],
        baseURL: 'http://localhost:4173',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        actionTimeout: 8000,
        navigationTimeout: 15000,
      },
    },
  ],

  reporter: [['list']],
});


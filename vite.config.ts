import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    exclude: ['pdfjs-dist'],
  },
  build: {
    target: 'esnext',
    sourcemap: true,
    rollupOptions: {
      // Tauri plugin packages are provided by the Tauri runtime; exclude from browser bundle
      external: (id) =>
        id.startsWith('@tauri-apps/plugin-dialog') ||
        id.startsWith('@tauri-apps/plugin-fs'),
    },
  },
  worker: {
    format: 'es',
  },
});

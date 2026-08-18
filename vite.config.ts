import { defineConfig } from 'vite';
import { readFileSync } from 'fs';
import path from 'path';

// Read app version from Tauri config
const tauriConf = JSON.parse(readFileSync(path.resolve(__dirname, 'src-tauri/tauri.conf.json'), 'utf-8'));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(tauriConf.version),
  },
  optimizeDeps: {
    exclude: ['pdfjs-dist'],
  },
  build: {
    target: 'esnext',
    sourcemap: true,
  },
  worker: {
    format: 'es',
  },
});

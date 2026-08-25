import { defineConfig } from 'vite';

export default defineConfig({
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

import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022', rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), renderer: resolve(import.meta.dirname, 'renderer.html') } } },
});

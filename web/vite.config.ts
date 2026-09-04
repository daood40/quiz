import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/** Stamps the service-worker cache name with the build id so every deploy invalidates the old shell. */
function stampServiceWorker(): Plugin {
  return {
    name: 'stamp-sw',
    closeBundle() {
      const file = join(__dirname, 'dist', 'sw.js');
      try {
        writeFileSync(file, readFileSync(file, 'utf8').replace('__BUILD__', Date.now().toString(36)));
      } catch { /* sw.js absent (SSR / partial build) */ }
    },
  };
}

export default defineConfig({
  // VITE_BASE is set by the GitHub Pages workflow (e.g. /quiz-app/)
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), stampServiceWorker()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});

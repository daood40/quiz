import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // VITE_BASE is set by the GitHub Pages workflow (e.g. /quiz-app/)
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
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

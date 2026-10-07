import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the Vite dev server (5173) proxies API/media calls to the
// Express server (4000), so the browser always talks to a single origin.
const backend = process.env.VITE_BACKEND_URL || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/media': { target: backend, changeOrigin: true },
      '/sitemap.xml': { target: backend, changeOrigin: true },
      '/robots.txt': { target: backend, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});

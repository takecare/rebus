import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  resolve: {
    alias: { '@rebus/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) },
  },
  plugins: [react()],
  server: {
    // 0.0.0.0 so a phone on the same Wi-Fi can play against a laptop. SPEC 7.3.
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true, ws: true },
    },
  },
  build: { target: 'es2020', sourcemap: true },
});

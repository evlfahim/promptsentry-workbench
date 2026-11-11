import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// The UI only imports types from @sentry-prompt/core; all data access goes
// through the local API server (server/index.ts), proxied under /api.
const apiTarget = `http://127.0.0.1:${process.env.PROMPTSENTRY_PORT || 3001}`;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@sentry-prompt/core': resolve(__dirname, '../core/src/index.ts'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': apiTarget,
    },
  },
  preview: {
    proxy: {
      '/api': apiTarget,
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});

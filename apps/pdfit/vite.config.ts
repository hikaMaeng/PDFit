import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [react()],
  server: {
    port: 15211,
    proxy: {
      '/api': {
        target: 'http://localhost:15201',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    manifest: true,
    rollupOptions: {
      input: {
        service: path.resolve(__dirname, 'index.html'),
        viewer: path.resolve(__dirname, 'viewer/index.html'),
      },
    },
  },
  optimizeDeps: {
    include: ['pdfjs-dist'],
  },
  worker: {
    format: 'es',
  },
});

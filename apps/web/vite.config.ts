import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/dav': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/agents': {
        target: 'ws://localhost:8787',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    // 生产构建默认不产出 sourcemap，避免源码经 CDN 公开；
    // 需要排查线上问题时可用 VITE_SOURCEMAP=true 单独构建。
    sourcemap: process.env.VITE_SOURCEMAP === 'true',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/src/services/')) return 'services';
          return undefined;
        },
      },
    },
  },
});

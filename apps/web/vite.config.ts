import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const apiHttp = process.env.VITE_API_HTTP ?? 'http://127.0.0.1:8080';
const apiWs = process.env.VITE_API_WS ?? 'ws://127.0.0.1:8080';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiHttp, changeOrigin: true },
      '/ws': { target: apiWs, ws: true, changeOrigin: true },
    },
  },
});

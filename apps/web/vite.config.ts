import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: { __BUILD__: JSON.stringify(process.env.BUILD_ID ?? 'dev'), __SIM_ARRIVAL_ENABLED__: process.env.SIM_ARRIVAL_UI_ENABLED==='1',
    __SIM_ASSETS_CDN_ENABLED__: process.env.SIM_ASSETS_CDN_ENABLED==='1',
    __SIM_ASSETS_CDN_ORIGIN__: JSON.stringify(process.env.SIM_ASSETS_CDN_ORIGIN ?? 'https://assets.eden.art') },
  server: { port: 5173, proxy: { '/v1': 'http://127.0.0.1:4500', '/skill.md': 'http://127.0.0.1:4500', '/cards.md': 'http://127.0.0.1:4500', '/mcp': 'http://127.0.0.1:4500', '/healthz': 'http://127.0.0.1:4500', '/ws': { target: 'ws://127.0.0.1:4500', ws: true } } },
  build: { chunkSizeWarningLimit: 4000 },
});

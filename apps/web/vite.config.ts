import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: { __BUILD__: JSON.stringify(process.env.BUILD_ID ?? 'dev') },
  server: { port: 5173, proxy: { '/v1': 'http://127.0.0.1:4500', '/skill.md': 'http://127.0.0.1:4500', '/cards.md': 'http://127.0.0.1:4500', '/mcp': 'http://127.0.0.1:4500', '/healthz': 'http://127.0.0.1:4500', '/ws': { target: 'ws://127.0.0.1:4500', ws: true } } },
  build: { chunkSizeWarningLimit: 4000 },
});

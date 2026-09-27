import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const simulation = `http://127.0.0.1:${process.env.MARS_SIMULATION_PORT || 8797}`;
export default defineConfig({
  plugins: [react()],
  publicDir:
    process.env.CLOUDFLARE_RELEASE === '1' ? '.cloudflare/public' : 'public',
  build: { outDir: 'dist/client', sourcemap: false },
  server: {
    host: '127.0.0.1',
    strictPort: true,
    proxy: {
      '/api/simulation': { target: simulation },
      '/mcp': { target: simulation },
    },
  },
  preview: { host: '127.0.0.1', strictPort: true },
});

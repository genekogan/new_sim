import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { entryPrefetchScript } from './src/snapshot-prefetch.ts';

// Lane L3h: a new world's /v1/world/snapshot GET leaves from index.html's head, before any chunk downloads
// (src/snapshot-prefetch.ts); WorldEntityLayer.start takes that response. The workbench page has no world.
function snapshotPrefetch(): Plugin {
  let base = '';
  return {
    name: 'sim-snapshot-prefetch',
    configResolved(c) { base = c.base.replace(/\/+$/, ''); },
    // after <title>: the charset meta stays first, and the script runs before the stylesheet links (a classic script
    // after one would wait for it) and the module script Vite adds to the head
    transformIndexHtml(html, ctx) {
      if (!/(^|\/)index\.html$/.test(ctx.path)) return;
      if (!html.includes('</title>')) throw Error('index.html: no </title> to place the snapshot prefetch after');
      return html.replace('</title>', `</title>\n    <script>${entryPrefetchScript(base)}</script>`);
    },
  };
}

export default defineConfig({
  plugins: [snapshotPrefetch(), react()],
  define: { __BUILD__: JSON.stringify(process.env.BUILD_ID ?? 'dev'), __SIM_ARRIVAL_ENABLED__: process.env.SIM_ARRIVAL_UI_ENABLED==='1',
    __SIM_ASSETS_CDN_ENABLED__: process.env.SIM_ASSETS_CDN_ENABLED==='1',
    __SIM_ASSETS_CDN_ORIGIN__: JSON.stringify(process.env.SIM_ASSETS_CDN_ORIGIN ?? 'https://assets.eden.art') },
  server: { port: 5173, proxy: { '/v1': 'http://127.0.0.1:4500', '/skill.md': 'http://127.0.0.1:4500', '/cards.md': 'http://127.0.0.1:4500', '/mcp': 'http://127.0.0.1:4500', '/healthz': 'http://127.0.0.1:4500', '/ws': { target: 'ws://127.0.0.1:4500', ws: true } } },
  // W1: standalone world-free studio, served by /god/workbench.
  build: { chunkSizeWarningLimit: 4000, rollupOptions: { input: { main: 'index.html', workbench: 'workbench.html' } } },
});

import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { entryPrefetchScript } from './src/snapshot-prefetch.ts';
import { anonymousHello } from '../../packages/client/src/hello.ts';
import { PWA_MANIFEST, pwaHeadTags, pwaManifest, type PwaIcons } from './src/pwa-manifest.ts';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Lane L3h: a new world's /v1/world/snapshot GET leaves from index.html's head, before any chunk downloads
// (src/snapshot-prefetch.ts); WorldEntityLayer.start takes that response. The workbench page has no world.
// Lane W1: the same script GETs /v1/config and opens the world's socket with the anonymous hello useSim's Connection sends
// (packages/client/src/hello.ts, one definition); the Connection adopts that socket.
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
      return html.replace('</title>', `</title>\n    <script>${entryPrefetchScript(base, undefined, anonymousHello(true))}</script>`);
    },
  };
}

// Lane P4: the installable-app manifest and icons (src/pwa-manifest.ts). Build only, index.html only (the workbench page is
// not an app). Icons (pwa/icon.svg rendered to pwa/icon-<size>.png) are hashed files in assets/; the manifest is
// dist/manifest.webmanifest, linked relative to the page and served beside every page (world servers and the launcher).
function pwa(): Plugin {
  let base = '/';
  const icons = new Map<string, Buffer>();
  const hashed = (name: string, data: Buffer) => { const file = `${name}-${createHash('sha256').update(data).digest('hex').slice(0, 10)}.png`; icons.set(file, data); return file; };
  let names: PwaIcons;
  return {
    name: 'sim-pwa',
    apply: 'build',
    configResolved(c) {
      base = c.base;
      const png = (n: number) => hashed(`sim-icon-${n}`, readFileSync(fileURLToPath(new URL(`./pwa/icon-${n}.png`, import.meta.url))));
      names = { icon180: png(180), icon192: png(192), icon512: png(512) };
    },
    generateBundle() {
      for (const [file, source] of icons) this.emitFile({ type: 'asset', fileName: `assets/${file}`, source });
      this.emitFile({ type: 'asset', fileName: PWA_MANIFEST, source: JSON.stringify(pwaManifest(base, names), null, 1) + '\n' });
    },
    transformIndexHtml(html, ctx) {
      if (!/(^|\/)index\.html$/.test(ctx.path)) return;
      if (!html.includes('</title>')) throw Error('index.html: no </title> to place the app manifest after');
      return html.replace('</title>', `</title>\n    ${pwaHeadTags(base, names)}`);
    },
  };
}

export default defineConfig({
  plugins: [snapshotPrefetch(), pwa(), react()],
  define: { __BUILD__: JSON.stringify(process.env.BUILD_ID ?? 'dev'), __SIM_ARRIVAL_ENABLED__: process.env.SIM_ARRIVAL_UI_ENABLED==='1',
    __SIM_ASSETS_CDN_ENABLED__: process.env.SIM_ASSETS_CDN_ENABLED==='1',
    __SIM_ASSETS_CDN_ORIGIN__: JSON.stringify(process.env.SIM_ASSETS_CDN_ORIGIN ?? 'https://assets.eden.art') },
  server: { port: 5173, proxy: { '/v1': 'http://127.0.0.1:4500', '/skill.md': 'http://127.0.0.1:4500', '/cards.md': 'http://127.0.0.1:4500', '/mcp': 'http://127.0.0.1:4500', '/healthz': 'http://127.0.0.1:4500', '/ws': { target: 'ws://127.0.0.1:4500', ws: true } } },
  // W1: standalone world-free studio, served by /god/workbench.
  build: { chunkSizeWarningLimit: 4000, rollupOptions: { input: { main: 'index.html', workbench: 'workbench.html' } } },
});

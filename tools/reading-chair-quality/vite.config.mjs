import { defineConfig } from '../../apps/web/node_modules/vite/dist/node/index.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../..', import.meta.url));
export default defineConfig({ root, publicDir: process.env.READING_CHAIR_ASSET_ROOT ?? root + '/mars/viewer/public',
  server: { host: '127.0.0.1', port: 7846, strictPort: true, fs: { allow: [root, ...(process.env.READING_CHAIR_ASSET_ROOT ? [process.env.READING_CHAIR_ASSET_ROOT] : [])] } },
  plugins: [{ name: 'pinned-reading-baseline', enforce: 'pre', load(id) {
    if (id.endsWith('/activity-poses.ts?readingbaseline')) {
      if (!process.env.READING_CHAIR_BASELINE_SOURCE) throw Error('explicit retained baseline source required');
      return readFileSync(process.env.READING_CHAIR_BASELINE_SOURCE, 'utf8');
    }
    if (id.endsWith('/humans.ts?readingbaseline')) return readFileSync(id.split('?')[0], 'utf8').replace("from './activity-poses.ts'", "from './activity-poses.ts?readingbaseline'");
  } }],
});

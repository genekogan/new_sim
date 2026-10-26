// Tiny HTTP child for the launcher's transport regression: no engine or database.
import { createServer } from 'node:http';
import { join } from 'node:path';
import { Hono } from 'hono';
import { getRequestListener } from '@hono/node-server';
import { AssetStore, mountAssetRoutes } from './assets.ts';
import { WireCache } from './asset-wire.ts';
import { ApiError } from '../souls.ts';
import { stripWorldRequestPath } from '../world-request-path.ts';

const dir = process.env.ASSET_VIEW_FIXTURE_DIR!;
const worldPath = process.env.WORLD_PATH!;
if (!dir || !worldPath) throw new Error('asset-view fixture requires its owned directory and world path');
const app = new Hono();
const store = new AssetStore({ dir, coreIndex: join(dir, 'core.json'), renditionIndex: join(dir, 'renditions.json') });
const god = { model: {}, opts: { worldId: 'asset-view-http-fixture' } } as unknown as Parameters<typeof mountAssetRoutes>[1]['god'];
mountAssetRoutes(app, { store, wire: new WireCache(null), god, requireGod: () => { throw new ApiError(401, 'unauthorized', 'fixture'); } });
app.get('/healthz', c => c.json({ ok: true }));
app.onError((e, c) => e instanceof ApiError ? c.json({ code: e.code }, e.status as 404) : c.json({ error: String(e) }, 500));
const listener = getRequestListener(app.fetch);
const server = createServer((req, res) => {
  req.url = stripWorldRequestPath(req.url, worldPath);
  void listener(req, res);
});
server.listen(Number(process.env.PORT), '127.0.0.1');
process.once('SIGTERM', () => { server.close(); server.closeAllConnections(); });

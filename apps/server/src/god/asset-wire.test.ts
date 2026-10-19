// W3b: /assets/<sha> sends a core mesh's rendition under the source sha, brotli once compressed.
//   node --test apps/server/src/god/asset-wire.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { Hono } from 'hono';
import { Db } from '../db.ts';
import { GodMode } from './god.ts';
import { AssetStore, REPO_ROOT, mountAssetRoutes } from './assets.ts';
import { WireCache, acceptsBrotli, readRenditions } from './asset-wire.ts';

const DOG = 'worlds/core-assets/packs/dog-pack.glb';
const coreSha = (path: string) => { const idx = JSON.parse(readFileSync(join(REPO_ROOT, 'worlds/core-assets/index.json'), 'utf8')).assets as Record<string, { path: string }>; return Object.entries(idx).find(([, m]) => m.path === path)![0]; };

test('acceptsBrotli reads the token list', () => {
  assert.equal(acceptsBrotli('gzip, deflate, br, zstd'), true); assert.equal(acceptsBrotli('br;q=1'), true);
  assert.equal(acceptsBrotli('gzip'), false); assert.equal(acceptsBrotli(undefined), false); assert.equal(acceptsBrotli('brotli'), false);
});

test('WireCache: plain until compressed, then brotli from memory and from disk after a restart', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'wire-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'a.json'); writeFileSync(file, JSON.stringify({ rows: Array.from({ length: 2000 }, (_, i) => ({ i, name: `row ${i % 7}` })) }));
  const w = new WireCache(join(dir, 'wire'));
  assert.equal(w.brotli('a.json', file), null, 'first ask queues');
  await w.idle(); const br = w.brotli('a.json', file)!;
  assert.deepEqual(brotliDecompressSync(br), readFileSync(file));
  assert.ok(existsSync(join(dir, 'wire', 'a.json.br')));
  assert.deepEqual(new WireCache(join(dir, 'wire')).brotli('a.json', file), br, 'a restarted server reads the disk copy');
  const rnd = join(dir, 'r.bin'); writeFileSync(rnd, Buffer.from(Array.from({ length: 50000 }, () => Math.floor(Math.random() * 256))));
  assert.equal(w.brotli('r.bin', rnd), null); await w.idle(); assert.equal(w.brotli('r.bin', rnd), null, 'incompressible stays plain, not re-queued'); await w.idle();
});

test('readRenditions keeps well-formed rows whose file exists', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ren-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const a = 'a'.repeat(64), b = 'b'.repeat(64), idx = join(dir, 'renditions.json');
  writeFileSync(join(dir, 'x.glb'), 'x');
  writeFileSync(idx, JSON.stringify({ schema: 'core-renditions/1', renditions: { [a]: { sha: b, path: 'x.glb', bytes: 1 }, [b]: { sha: a, path: 'missing.glb', bytes: 1 }, bad: { sha: a, path: 'x.glb', bytes: 1 }, [a.replace(/a/g, 'c')]: { sha: b, path: '../x.glb', bytes: 1 } } }));
  const r = readRenditions(idx, dir); assert.deepEqual([...r.keys()], [a]); assert.equal(r.get(a)!.file, join(dir, 'x.glb'));
});

test('GET /assets/<core sha>.glb: the rendition under the source sha, own ETag, brotli once ready; god route keeps the source', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'wire-route-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const src = coreSha(DOG), ren = { sha: 'e'.repeat(64), path: 'ren.glb', bytes: 0 };
  const renFile = join(dir, 'ren.glb'); writeFileSync(renFile, Buffer.concat([readFileSync(join(REPO_ROOT, DOG)), Buffer.from(' '.repeat(4096))]));
  // the index resolves paths under the repo; a temp-dir rendition is installed as the parsed map directly
  const store = new AssetStore({ dir, renditionIndex: join(dir, 'none.json') });
  (store as unknown as { renditions: Map<string, unknown> }).renditions = new Map([[src, { ...ren, file: renFile }]]);
  const db = new Db(':memory:'); t.after(() => db.close());
  const god = new GodMode(db, { worldId: 'wire-1', ownerId: null, tick: () => 1, emit: () => {}, assetDir: dir } as never);
  const wire = new WireCache(join(dir, 'wire')); const app = new Hono();
  mountAssetRoutes(app, { god, store, requireGod: () => {}, wire });
  const get = (h: Record<string, string> = {}) => app.request(`/assets/${src}.glb`, { headers: h });
  let r = await get({ 'accept-encoding': 'br' });
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-encoding'), null, 'plain until compressed');
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), readFileSync(renFile), 'the rendition bytes');
  const etag = r.headers.get('etag')!; assert.equal(etag, `"${src}-r${'e'.repeat(16)}"`); assert.equal(r.headers.get('vary'), 'accept-encoding');
  assert.equal((await get({ 'if-none-match': etag })).status, 304);
  assert.equal((await get({ 'if-none-match': `"${src}"` })).status, 200, 'a cached source copy is replaced');
  await wire.idle(); r = await get({ 'accept-encoding': 'gzip, br' });
  assert.equal(r.headers.get('content-encoding'), 'br'); assert.deepEqual(brotliDecompressSync(Buffer.from(await r.arrayBuffer())), readFileSync(renFile));
  r = await get({ 'accept-encoding': 'gzip' }); assert.equal(r.headers.get('content-encoding'), null);
  const other = coreSha('worlds/core-assets/packs/cow-pack.glb');
  r = await app.request(`/assets/${other}.glb`); assert.equal(r.status, 200); assert.equal(r.headers.get('etag'), `"${other}"`, 'no rendition: as before');
});

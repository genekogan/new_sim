import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { Hono } from 'hono';
import { AssetStore, REPO_ROOT, mountAssetRoutes } from './assets.ts';
import { WireCache } from './asset-wire.ts';
import { ApiError } from '../souls.ts';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
function glb(representation: string): Buffer {
  const json = JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }], extras: { representation, padding: 'x'.repeat(2000) } });
  const data = Buffer.from(json.padEnd(Math.ceil(Buffer.byteLength(json) / 4) * 4, ' '));
  const out = Buffer.alloc(20 + data.length);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(data.length, 12); out.writeUInt32LE(0x4e4f534a, 16); data.copy(out, 20);
  return out;
}
function fixture(t: TestContext) {
  const parent = join(REPO_ROOT, '.e2e'); mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, 'asset-view-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const original = glb('source'), first = glb('rendition-one'), second = glb('rendition-two'), uploaded = glb('upload-only');
  const source = sha(original), upload = sha(uploaded), index = join(dir, 'core.json'), renditions = join(dir, 'renditions.json');
  const files = [original, first, second, uploaded].map(b => { const file = join(dir, `${sha(b)}.glb`); writeFileSync(file, b); return file; });
  const meta = (bytes: Buffer, path?: string) => ({ sha: sha(bytes), ext: 'glb', kind: 'mesh', bytes: bytes.length, tris: 0, textures: 0, texPx: 0, box: [1, 1, 1], ...(path ? { path } : {}) });
  writeFileSync(index, JSON.stringify({ assets: { [source]: meta(original, relative(REPO_ROOT, files[0])) } }));
  writeFileSync(join(dir, `${upload}.meta.json`), JSON.stringify(meta(uploaded)));
  const map = (bytes?: Buffer) => writeFileSync(renditions, JSON.stringify({ schema: 'core-renditions/1', renditions: bytes ? { [source]: { sha: sha(bytes), bytes: bytes.length, path: relative(REPO_ROOT, join(dir, `${sha(bytes)}.glb`)) } } : {} }));
  const open = () => {
    const store = new AssetStore({ dir, coreIndex: index, renditionIndex: renditions }), wire = new WireCache(null);
    const app = new Hono();
    const god = { model: {}, opts: { worldId: 'owned-asset-view-test' } } as unknown as Parameters<typeof mountAssetRoutes>[1]['god'];
    mountAssetRoutes(app, { store, wire, god, requireGod: () => { throw new ApiError(401, 'unauthorized', 'test'); } });
    app.onError((e, c) => e instanceof ApiError ? c.json({ code: e.code }, e.status as 404) : c.json({ error: String(e) }, 500));
    return { app, store, wire };
  };
  map();
  return { dir, original, first, second, uploaded, source, upload, map, open, files };
}

test('view aliases validate before the first rendition and across two release mappings; unchanged validators reuse the body', async t => {
  const f = fixture(t); let app = f.open().app, tag = '';
  for (const bytes of [f.original, f.first, f.second]) {
    f.map(bytes === f.original ? undefined : bytes); app = f.open().app; // the store loads the map once per server process
    for (const prefix of ['/asset-view/', '/assets/']) {
      const response = await app.request(`${prefix}${f.source}.glb`, { headers: { 'if-none-match': tag } });
      assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'public, no-cache');
      assert.equal(response.headers.get('vary'), 'accept-encoding');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    }
    const response = await app.request(`/asset-view/${f.source}.glb`); const next = response.headers.get('etag')!;
    assert.notEqual(next, tag); tag = next;
    for (const validator of [tag, `W/${tag}`]) {
      const unchanged = await app.request(`/asset-view/${f.source}.glb`, { headers: { 'if-none-match': validator } });
      assert.equal(unchanged.status, 304); assert.equal(unchanged.headers.get('etag'), tag);
      assert.equal(unchanged.headers.get('access-control-allow-origin'), '*');
      assert.equal(unchanged.headers.get('cache-control'), 'public, no-cache'); assert.equal((await unchanged.arrayBuffer()).byteLength, 0);
    }
  }
});

test('view responses preserve exact plain/Brotli bytes and validators; true uploaded hash objects remain immutable', async t => {
  const f = fixture(t); f.map(f.first); const { app, wire, store } = f.open();
  assert.equal(store.isCore(f.source), true); assert.equal(store.isCore(f.upload), false);
  const plain = await app.request(`/asset-view/${f.source}.glb`); await wire.idle();
  const br = await app.request(`/asset-view/${f.source}.glb`, { headers: { 'accept-encoding': 'br' } });
  assert.equal(br.headers.get('content-encoding'), 'br'); assert.equal(br.headers.get('vary'), 'accept-encoding');
  assert.equal(br.headers.get('etag'), plain.headers.get('etag')); assert.deepEqual(brotliDecompressSync(Buffer.from(await br.arrayBuffer())), f.first);
  for (const prefix of ['/assets/', '/asset-view/']) {
    const response = await app.request(`${prefix}${f.upload}.glb`);
    assert.equal(response.headers.get('cache-control'), prefix === '/assets/' ? 'public, max-age=31536000, immutable' : 'public, no-cache');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), f.uploaded);
  }
});

test('missing/removed or wrong-format files cannot become cached304s; view routes do not expose APIs or other formats', async t => {
  const f = fixture(t); f.map(f.first); const { app } = f.open();
  const response = await app.request(`/asset-view/${f.source}.glb`); const tag = response.headers.get('etag')!;
  unlinkSync(f.files[1]);
  for (const prefix of ['/assets/', '/asset-view/']) {
    const gone = await app.request(`${prefix}${f.source}.glb`, { headers: { 'if-none-match': tag } });
    assert.equal(gone.status, 404); assert.equal(gone.headers.get('cache-control'), 'no-store');
    const unknown = 'f'.repeat(64), missing = await app.request(`${prefix}${unknown}.glb`, { headers: { 'if-none-match': `"${unknown}"` } });
    assert.equal(missing.status, 404); assert.equal(missing.headers.get('cache-control'), 'no-store');
  }
  for (const path of [`/asset-view/${f.source}.png`, '/asset-view/v1/god/assets', `/assets/${f.upload}.png`]) {
    const r = await app.request(path); assert.equal(r.status, 404); assert.doesNotMatch(r.headers.get('cache-control') ?? '', /immutable/);
  }
  assert.equal((await app.request('/v1/god/assets')).status, 401);
});

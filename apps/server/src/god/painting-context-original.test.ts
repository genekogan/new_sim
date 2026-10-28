// Narrow in-process originals proof. No server listener, browser, render job or model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode } from './god.ts';
import { mountContextViews } from './context-views.ts';
import { contextTargets } from './context-view-scene.ts';
import { checkArtOriginals, contextOriginal, readArtOriginal } from './context-original-art.ts';
import { createPaintingService } from '../art/painting-completion.ts';
import { rasterizePainting } from '../art/painting.ts';
import { moderationFor } from '../moderation/store.ts';
import { ART_LIMITS } from '../art/validate.ts';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const picture = { title: 'Original', background: '#123456', shapes: [] };
const basePath = '/w/painting-context';
test('only exact configured same-world art image references become originals', () => {
  const hash = 'a'.repeat(64), path = `${basePath}/art/${hash}.png`;
  assert.equal(contextOriginal(path), undefined, 'art support is explicitly configured');
  for (const ext of ['png', 'jpg', 'webp', 'gif']) assert.deepEqual(contextOriginal(`${basePath}/art/${hash}.${ext}`, basePath), { sha: hash, ext, storage: 'art' });
  for (const bad of [
    `/w/other/art/${hash}.png`, `${basePath}-other/art/${hash}.png`, `/art/${hash}.png`,
    `https://example.test${path}`, `//example.test${path}`, `${path}?x=1`, `${path}#x`, `${path}\n`, `${path}\r\n${path}`,
    `${basePath}/art/../${hash}.png`, `${basePath}/art/%2e%2e/${hash}.png`, `${basePath}/art/%61${hash.slice(1)}.png`,
    `${basePath}/art/${hash.toUpperCase()}.png`, `${basePath}/art/${hash}.mp4`, `${basePath}/art/${hash}.webm`, `${basePath}/art/${hash}.jpeg`,
  ]) assert.equal(contextOriginal(bad, basePath), undefined, bad);
  assert.deepEqual(contextOriginal(`/assets/${hash}.png`, basePath), { sha: hash, ext: 'png' }, 'legacy asset shape unchanged');
  assert.deepEqual(contextOriginal(`/art/${hash}.gif`, ''), { sha: hash, ext: 'gif', storage: 'art' }, 'explicit root world');
  for (const bad of ['/w/a/', '//w/a', '/w/../a', '/w/%61', '/w/a?x', '/w/a#x', '/w/a\n']) assert.throws(() => checkArtOriginals({ dir: tmpdir(), basePath: bad }));
  assert.throws(() => checkArtOriginals({ dir: 'relative', basePath }));
});

test('art originals read only regular bounded files whose exact bytes match image format and hash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'painting-original-file-')), config = { dir, basePath };
  const bytes = rasterizePainting(picture, { worldId: 'one', receiptId: 'r_one' }), hash = sha(bytes), original = { sha: hash, ext: 'png', storage: 'art' as const };
  try {
    writeFileSync(join(dir, `${hash}.png`), bytes);
    assert.deepEqual(Buffer.from(readArtOriginal(config, original)!.bytes), bytes, 'publication metadata remains byte-identical');
    assert.equal(readArtOriginal(config, { ...original, sha: 'b'.repeat(64) }), null, 'missing file');
    writeFileSync(join(dir, `${'b'.repeat(64)}.png`), bytes);
    assert.equal(readArtOriginal(config, { ...original, sha: 'b'.repeat(64) }), null, 'incorrect content address');
    const bad = Buffer.from('this is not an image'), badHash = sha(bad); writeFileSync(join(dir, `${badHash}.png`), bad);
    assert.equal(readArtOriginal(config, { ...original, sha: badHash }), null, 'invalid image despite matching hash');
    writeFileSync(join(dir, `${hash}.jpg`), bytes); assert.equal(readArtOriginal(config, { ...original, ext: 'jpg' }), null, 'extension differs from actual format');
    mkdirSync(join(dir, `${'c'.repeat(64)}.png`)); assert.equal(readArtOriginal(config, { ...original, sha: 'c'.repeat(64) }), null, 'directory');
    symlinkSync(join(dir, `${hash}.png`), join(dir, `${'d'.repeat(64)}.png`)); assert.equal(readArtOriginal(config, { ...original, sha: 'd'.repeat(64) }), null, 'symlink is never followed');
    writeFileSync(join(dir, `${'e'.repeat(64)}.png`), Buffer.alloc(ART_LIMITS.imageBytes + 1)); assert.equal(readArtOriginal(config, { ...original, sha: 'e'.repeat(64) }), null, 'oversized file');
    assert.equal(readArtOriginal(config, { ...original, ext: '../png' }), null);
    assert.equal(readArtOriginal(config, { ...original, sha: '../x' }), null);
    assert.equal(readArtOriginal(config, { ...original, sha: hash + '\n' }), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('real painting originals repaint, reauthorize and moderate without render jobs; assets stay unchanged', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'painting-original-route-')), artDir = join(dir, 'art'), db = new Db(':memory:');
  const god = new GodMode(db, { worldId: 'painting-original-test', ownerId: 'dev:owner', tick: () => 1, emit() {}, assetDir: dir });
  assert.equal(god.act({ ops: [{ op: 'place', def: 'core/easel@2', name: 'canvas', p: [0, 0] }] }).accepted, true);
  const target = god.model.get('canvas')!.id, app = new Hono(); let renders = 0, secret = false, knows = false;
  app.onError((error, c) => error instanceof ApiError ? c.json({ code: error.code }, error.status as 400) : c.json({ error: String(error) }, 500));
  const edge = { beforeMap() {}, places: { byId: new Map([['secret', { id: 'secret', ref: 'canvas', level: 0, parent: 'world', polygon: [[-2, -2], [2, -2], [2, 2], [-2, 2]] }]]), containing: () => [] }, knowledge: { knows: (soul: string | null) => !secret || !!soul && knows } };
  const views = mountContextViews(app, { god, edge: edge as never, artOriginals: { dir: artDir, basePath }, contextReady: () => true, waitForContext: async () => {}, levelAt: () => 0, worldUrl: 'http://127.0.0.1:5980', soul: c => c.req.header('authorization') ?? null, limit() {}, renderer: async () => { renders++; return { png: new Uint8Array([1]) }; } });
  const painting = createPaintingService({ model: () => god.model, dir: artDir, basePath, worldId: god.opts.worldId, commit: (ops, note, done, durable) => god.engineAct(ops, note, done, durable) });
  const actor = { soulId: 's_ana', entityId: 'h_ana', name: 'Ana', owner: 'dev:ana' };
  const metadata = async (ref = target) => (await (await app.request('/v1/world/context?ref=' + encodeURIComponent(ref))).json()).targets[0];
  const paint = (receipt: string, background: string) => { const intent = painting.prepare(actor, target, { ...picture, background }); assert.ok(!('ok' in intent)); assert.equal(painting.complete(actor, receipt, intent, () => {}).ok, true); return god.model.get(target)!.state!.media as string; };
  try {
    const firstMedia = paint('r_one', '#123456'), first = await metadata();
    assert.equal(first.original.source, 'original-image'); assert.equal(first.original.version, firstMedia.split('/').at(-1)!.slice(0, 64));
    assert.equal(first.original.storage, undefined, 'storage discriminator never reaches public metadata');
    assert.equal(first.storage, undefined);
    assert.equal(contextTargets(god.model).find(t => t.ref === target)!.original, undefined, 'unconfigured target callers remain legacy');
    const response = await app.request(first.original.url); assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/png'); assert.equal(response.headers.get('cache-control'), 'no-store');
    const firstBytes = Buffer.from(await response.arrayBuffer()); assert.equal(sha(firstBytes), first.original.version);
    const nextMedia = paint('r_two', '#abcdef'), second = await metadata(); assert.notEqual(nextMedia, firstMedia);
    assert.equal((await app.request(first.original.url)).status, 404, 'previous original URL rechecks current canvas version');
    const secondResponse = await app.request(second.original.url); assert.equal(secondResponse.status, 200); assert.equal(sha(Buffer.from(await secondResponse.arrayBuffer())), second.original.version);
    secret = true;
    assert.equal((await app.request(second.original.url)).status, 404, 'anonymous unknown secret');
    assert.equal((await app.request(second.original.url, { headers: { authorization: 'soul' } })).status, 404, 'Soul without knowledge');
    knows = true; assert.equal((await app.request(second.original.url, { headers: { authorization: 'soul' } })).status, 200, 'known secret');
    knows = false; assert.equal((await app.request(second.original.url, { headers: { authorization: 'soul' } })).status, 404, 'knowledge rechecked per request'); secret = false;
    const asset = god.assets.put(rasterizePainting(picture));
    assert.equal(god.act({ ops: [{ op: 'place', def: 'core/picture-frame@1', name: 'asset-frame', p: [6, 0], state: { media: `/assets/${asset.sha}.png` } }] }).accepted, true);
    const legacy = await metadata(god.model.get('asset-frame')!.id); assert.equal(legacy.original.sha, asset.sha); assert.equal(legacy.original.ext, 'png'); assert.equal(legacy.original.storage, undefined);
    assert.equal((await app.request(legacy.original.url)).status, 200, 'existing asset originals unchanged');
    for (const media of [`/w/foreign/art/${second.original.sha}.png`, `${basePath}/art/${second.original.sha}.png?x`, `${basePath}/art/${second.original.sha}.mp4`]) {
      assert.equal(god.act({ ops: [{ op: 'set', id: target, state: { media } }] }).accepted, true);
      assert.equal((await metadata()).original, undefined); assert.equal((await app.request(second.original.url)).status, 404);
    }
    for (const [hash, bytes] of [['b'.repeat(64), null], ['c'.repeat(64), Buffer.from('invalid')], ['d'.repeat(64), firstBytes]] as const) {
      if (bytes) writeFileSync(join(artDir, `${hash}.png`), bytes);
      assert.equal(god.act({ ops: [{ op: 'set', id: target, state: { media: `${basePath}/art/${hash}.png` } }] }).accepted, true);
      const missing = await metadata(); assert.equal((await app.request(missing.original.url)).status, 404, 'missing/invalid/mismatched file refused');
    }
    assert.equal(god.act({ ops: [{ op: 'set', id: target, state: { media: nextMedia } }] }).accepted, true);
    moderationFor(db.db, god.opts.worldId).append({ sha: second.original.sha, action: 'hide', role: 'creator', actor: 'test' });
    assert.equal((await app.request(second.original.url)).status, 404, 'moderation rechecked');
    assert.equal(renders, 0, 'metadata/original retrieval never starts architectural rendering'); assert.equal(views.cache.peek(target), null);
  } finally { await views.close(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});

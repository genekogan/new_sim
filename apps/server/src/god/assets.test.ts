// L5: asset store, GLB measurement, footprints, catalog search, asset routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono, type Context } from 'hono';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode } from './god.ts';
import { mountGodRoutes } from './routes.ts';
import { AssetStore, REPO_ROOT, footprintToBaked, measureGlb, mountAssetRoutes, searchDefs } from './assets.ts';

const repo = (p: string) => new Uint8Array(readFileSync(join(REPO_ROOT, p)));
const DOG = 'worlds/core-assets/packs/dog-pack.glb';
const TOWER_FP = 'worlds/littlemartians/buildings/ceramic-tower.footprint.json';

function fixture() {
  const db = new Db(':memory:');
  const dir = mkdtempSync(join(tmpdir(), 'l5-assets-'));
  const god = new GodMode(db, { worldId: 'assets-1', ownerId: null, tick: () => 1, emit: () => {}, assetDir: dir } as never);
  const app = new Hono();
  const requireGod = (c: Context) => { if (!god.godFromToken(c.req.header('authorization')?.replace(/^Bearer\s+/i, ''))) throw new ApiError(401, 'unauthorized', 'god token'); };
  // once the lead applies the L5 patch, GodMode owns the store and mountGodRoutes mounts these routes itself
  const owned = (god as unknown as { assets?: AssetStore }).assets;
  const store = owned ?? mountAssetRoutes(app, { god, requireGod, dir });
  mountGodRoutes(app, {
    god, worldName: 'Assets',
    requireUser: async () => ({ id: 'dev:gene', role: 'user', email: null, wallet: null, created_at: 0, last_seen: 0, invited_by: null }) as never,
    soulFromBearer: () => null, baseOf: () => 'http://localhost:4999/w/assets', limitIp: () => {},
  });
  if (owned) assert.equal(store, owned);
  app.onError((err, c) => err instanceof ApiError ? c.json({ ok: false, code: err.code, message: err.message }, err.status as 400) : c.json({ ok: false, code: 'internal', message: String(err) }, 500));
  const token = god.mintFor({ id: 'dev:gene', role: 'user' }, 'test');
  const req = async (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const r = await app.request(path, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.json ? { 'content-type': 'application/json' } : {}), ...(init.headers as Record<string, string> ?? {}) }, body: init.json ? JSON.stringify(init.json) : init.body });
    const buf = new Uint8Array(await r.arrayBuffer()); let data: unknown = null; try { data = JSON.parse(new TextDecoder().decode(buf)); } catch { /* binary */ }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: r.status, data: data as any, headers: r.headers, bytes: buf };
  };
  return { db, god, app, store, dir, token, req };
}

test('measure: a split pack animal (skinned, clips) and a Draco+WebP scan measure without decoders', () => {
  const dog = measureGlb(repo(DOG));
  assert.equal(dog.tris, 602);
  assert.deepEqual(dog.animations.sort(), ['Idle', 'Walk']);
  assert.ok(dog.box[1] > 0.5 && dog.box[1] < 0.8, `dog height ${dog.box[1]}`);
  assert.ok(dog.box[2] > dog.box[0], 'dog faces +z (longer along z than x)');
  const kin = measureGlb(repo('worlds/littlemartians/characters/kin/chebel.glb'));
  assert.equal(kin.tris, 29324);                     // matches the floater manifest
  assert.equal(kin.textures, 4); assert.equal(kin.texPx, 2048);
  assert.ok(kin.extensions.includes('KHR_draco_mesh_compression'));
  const tower = measureGlb(repo('worlds/littlemartians/buildings/ceramic-tower.glb'));
  assert.deepEqual(tower.box.map((v) => Math.round(v * 10) / 10), [19, 38.3, 19]);
  assert.throws(() => measureGlb(new TextEncoder().encode('not a model at all, sorry')), /not a GLB/);
});

test('footprint: lm-building-footprint/1 → rooms, room slots, wall colliders, openings, float links', () => {
  const b = footprintToBaked(JSON.parse(readFileSync(join(REPO_ROOT, TOWER_FP), 'utf8')));
  assert.equal(b.rooms!.length, 4);
  assert.deepEqual(b.slots.map((s) => s.id), ['tower-l0', 'tower-l1', 'tower-l2', 'tower-l3']);
  assert.ok(b.slots.every((s) => s.kind === 'room' && (s.polygon?.length ?? 0) <= 64));
  assert.equal(b.openings!.filter((o) => o.kind === 'door' && o.level === 0).length, 12);
  assert.equal(b.links!.length, 3);
  assert.ok(b.links!.every((l) => l.kind === 'float'));
  assert.ok(b.colliders.length > 300);
  assert.ok(b.surfaces!.some((s) => s.tag?.includes('terrace')));
  // scaled by k: every length doubles
  const b2 = footprintToBaked(JSON.parse(readFileSync(join(REPO_ROOT, TOWER_FP), 'utf8')), 2);
  assert.equal(b2.box[1], b.box[1] * 2);
});

test('store: content-addressed, measured, budgets refused at ingest, shared across worlds by sidecar', () => {
  const dir = mkdtempSync(join(tmpdir(), 'l5-store-'));
  const db = new Db(':memory:');
  const a = new AssetStore({ dir, db, worldId: 'w1', coreIndex: null });
  const m = a.put(repo(DOG), { name: 'my-dog', license: 'CC0 1.0', source: 'test' });
  assert.match(m.sha, /^[0-9a-f]{64}$/);
  assert.ok(existsSync(join(dir, `${m.sha}.glb`)) && existsSync(join(dir, `${m.sha}.meta.json`)));
  assert.equal(a.lookup(m.sha)?.tris, 602);
  assert.equal(a.listWorld()[0].name, 'my-dog');
  // over budget: refused with the measured facts
  assert.throws(() => a.put(repo(DOG), { budget: { tris: 100, bytes: 3e6, texPx: 2048 } }), (e: ApiError) => e.code === 'asset.budget' && e.status === 413);
  assert.throws(() => a.put(repo('worlds/littlemartians/characters/kin/chebel.glb'), { budget: { tris: 80000, bytes: 3e6, texPx: 1024 } }), /2048 px texture/);
  assert.throws(() => a.put(new TextEncoder().encode('GIF89a nope')), (e: ApiError) => e.code === 'asset.type');
  // another world on the same box sees it without a row of its own
  const b = new AssetStore({ dir, worldId: 'w2', coreIndex: null });
  assert.equal(b.info(m.sha)?.name, 'my-dog');
  // footprint linked to a GLB: the lookup carries the footprint physics
  const t = a.put(repo('worlds/littlemartians/buildings/ceramic-tower.glb'), { name: 'tower', footprint: repo(TOWER_FP) });
  assert.ok(t.footprint);
  assert.equal((a.lookup(t.sha) as { baked?: { rooms?: unknown[] } }).baked?.rooms?.length, 4);
});

test('core assets: every core mesh def resolves to a file and a measured lookup', () => {
  const f = fixture();
  const meshDefs = [...new Set(f.god.model.defs.values())].filter((d) => d.make.kind === 'mesh');
  assert.ok(meshDefs.length >= 80, `${meshDefs.length} core mesh defs`);
  for (const d of meshDefs) {
    const sha = (d.make as { asset: string }).asset;
    assert.ok(f.store.file(sha, 'glb'), `${d.ref}: file for ${sha.slice(0, 10)}`);
    assert.ok(f.store.lookup(sha), `${d.ref}: lookup`);
  }
  const tower = f.god.model.def('core/ceramic-tower@1')!;
  assert.equal(tower.slots.filter((s) => s.kind === 'room').length, 4);
});

test('routes: upload a GLB, define it, place it, fetch it immutable; refuse junk and strangers', async () => {
  const f = fixture();
  const glb = repo(DOG);
  const form = new FormData();
  form.set('file', new Blob([glb], { type: 'model/gltf-binary' }), 'dog.glb');
  form.set('name', 'Rex'); form.set('height', '0.7'); form.set('tags', 'dog, pet'); form.set('license', 'CC0 1.0'); form.set('define', '1');
  const up = await f.req('/v1/god/assets', { method: 'POST', body: form });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  assert.equal(up.data.asset.tris, 602);
  assert.equal(up.data.def.name, 'rex');
  assert.ok(Math.abs(up.data.def.size.box[1] - 0.7) < 1e-6);
  assert.equal(up.data.defined.accepted, true, JSON.stringify(up.data.defined));
  assert.match(up.data.report, /602 tris/);
  const placed = f.god.act({ ops: [{ op: 'place', def: 'rex@1', p: [3, 4], name: 'rex' }] });
  assert.equal(placed.accepted, true, JSON.stringify(placed));
  // the file: immutable, ETag = sha, 304 on revalidation
  const get = await f.req(up.data.asset.url);
  assert.equal(get.status, 200);
  assert.equal(get.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(get.bytes.byteLength, glb.byteLength);
  assert.equal((await f.req(up.data.asset.url, { headers: { 'if-none-match': `"${up.data.asset.sha}"` } })).status, 304);
  // core assets are served the same way
  const tower = f.god.model.def('core/ceramic-tower@1')!;
  assert.equal((await f.req(`/assets/${(tower.make as { asset: string }).asset}.glb`)).status, 200);
  // raw body upload with query params; junk refused; no token refused
  const raw = await f.req('/v1/god/assets?name=tower2', { method: 'POST', body: repo('worlds/littlemartians/buildings/minaret-temple.glb'), headers: { 'content-type': 'model/gltf-binary' } });
  assert.equal(raw.status, 200); assert.equal(raw.data.asset.tris, 17928);
  assert.equal((await f.req('/v1/god/assets', { method: 'POST', body: new TextEncoder().encode('hello'), headers: { 'content-type': 'application/octet-stream' } })).status, 415);
  const anon = await f.app.request('/v1/god/assets', { method: 'POST', body: glb });
  assert.equal(anon.status, 401);
});

test('catalog: ranked search with synonyms; def detail with an example op; thumbnails round-trip', async () => {
  const f = fixture();
  const first = async (q: string) => (await f.req(`/v1/god/defs?q=${encodeURIComponent(q)}`)).data.defs[0]?.publicRef as string | undefined;
  // L4's kit creatures (rounded, animated) rank ahead of the pack meshes
  assert.equal(await first('dog'), 'core/dog@1');
  assert.equal(await first('pup'), 'core/dog@1');
  assert.equal(await first('kitty'), 'core/cat@1');
  assert.equal(await first('lighthouse'), 'core/lighthouse@1');  // L2's enterable lighthouse ranks ahead of the LM tower mesh
  assert.equal(await first('ceramic tower'), 'core/ceramic-tower@1');
  assert.match((await first('boat'))!, /row(ing-)?boat/);
  assert.match((await first('cows'))!, /cow/);
  assert.match((await first('birch trees'))!, /birch/);
  const hen = await first('hen'); if (hen) assert.match(hen, /chicken/); // L4's chicken (kit/2) answers once it lands
  const none = await f.req('/v1/god/defs?q=xylophone-zeppelin');
  assert.equal(none.data.count, 0); assert.match(none.data.hint, /define it/);
  const detail = await f.req('/v1/god/defs/core/ceramic-tower@1');
  assert.equal(detail.status, 200);
  assert.equal(detail.data.example.ops[0].op, 'place');
  assert.equal(detail.data.slots.length, 4);
  assert.equal(detail.data.asset.tris, 25148);
  // the example op is valid as written
  assert.equal(f.god.act({ ops: [{ ...detail.data.example.ops[0], p: [0, 0] }] }).accepted, true);
  // thumbs
  assert.equal((await f.req('/v1/god/defs/core/ceramic-tower@1/thumb.png')).status, 404);
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000050001a5f645400000000049454e44ae426082', 'hex');
  assert.equal((await f.req('/v1/god/defs/core/ceramic-tower@1/thumb.png', { method: 'POST', body: png })).status, 200);
  const thumb = await f.app.request('/v1/god/defs/core/ceramic-tower@1/thumb.png');
  assert.equal(thumb.status, 200); assert.equal(thumb.headers.get('content-type'), 'image/png');
});

test('search ranking: exact names beat tags beat descriptions; plural and synonym forms', () => {
  const defs = [
    { name: 'core-duck', ref: 'core-duck@1', tags: ['animal', 'bird', 'water'], description: 'A duck that floats.', make: { kind: 'gen' } },
    { name: 'core-bird-pack', ref: 'core-bird-pack@1', tags: ['animal', 'bird'], description: 'A small bird.', make: { kind: 'mesh' } },
    { name: 'core-pond', ref: 'core-pond@1', tags: ['water'], description: 'A pond for ducks.', make: { kind: 'gen' } },
    { name: 'core-dog', ref: 'core-dog@1', tags: ['animal', 'pet'], description: 'A dog.', make: { kind: 'gen' } },
    { name: 'core-dog-pack', ref: 'core-dog-pack@1', tags: ['animal', 'pet', 'dog'], description: 'A dog (mesh).', make: { kind: 'mesh' } },
    { name: 'core-rowboat-pack', ref: 'core-rowboat-pack@1', tags: ['boat', 'rowing-boat'], description: 'A rowing boat.', make: { kind: 'mesh' } },
  ];
  const top = (q: string) => searchDefs(defs, q).map((h) => h.def.name);
  assert.deepEqual(top('duck').slice(0, 2), ['core-duck', 'core-pond']);
  assert.equal(top('ducks')[0], 'core-duck');
  assert.equal(top('mallard')[0], 'core-duck');
  assert.equal(top('pup')[0], 'core-dog');          // kit creature before the pack mesh
  assert.equal(top('dog')[1], 'core-dog-pack');
  assert.equal(top('boat')[0], 'core-rowboat-pack');
  assert.equal(top('water bird')[0], 'core-duck');   // every word must match when something matches all
});

test('footprint physics in the compiler: the Ceramic Tower has rooms, doors and float shafts; a bench goes in its second room', (t) => {
  const f = fixture();
  const tower = f.god.model.def('core/ceramic-tower@1')!;
  if (!(tower.make as { footprint?: string }).footprint) { t.skip('waiting for the L1 schema patch (make.footprint)'); return; }
  const placed = f.god.act({ ops: [{ op: 'place', def: 'core/ceramic-tower@1', p: [40, 0], name: 'tower', tmp: '$t' }, { op: 'place', def: 'core/bench@1', in: { parent: '$t', slot: 'tower-l1' }, p: [2, 0], name: 'bench' }] });
  assert.equal(placed.accepted, true, JSON.stringify(placed));
  const e = f.god.model.get('tower')!;
  const baked = f.god.model.bake(tower, e.params ?? {}, e.seed ?? 0);
  assert.equal(baked.rooms?.length, 4);
  assert.equal(baked.links?.filter((l) => l.kind === 'float').length, 3);
  assert.ok((baked.openings?.length ?? 0) >= 28);
  assert.ok(baked.colliders.length > 300, 'wall segments, not one solid block');
  const bench = f.god.model.worldPose(f.god.model.get('tower/bench')!);
  assert.ok(Math.abs(bench.y - 9) < 0.6, `bench on the second floor (y ${bench.y})`);
  // something solid in the ground hall's open middle is fine (no solid block); inside a wall is refused
  assert.equal(f.god.act({ ops: [{ op: 'place', def: 'core/box@1', p: [40, 0] }] }).accepted, true);
});

// Offline: node --test --test-concurrency=1 apps/web/src/WorldBuildSites.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { registerHooks } from 'node:module';
import { WorldModel, type Entity, type OBB } from '@sim/world-compiler';
import { WorldBuildSites, parseBuildFeed, SITE_REFINEMENT, type PublicSite, type SiteDelta, type SiteModel } from './WorldBuildSites.ts';

const SERVER_NOW = 1_800_000_000_000;
function site(overrides: Partial<PublicSite> = {}): PublicSite {
  return { id: 'church', title: 'Black stone church', rev: 1, status: 'active', lastAt: SERVER_NOW, pauseAfterMs: 600_000, closed: true,
    step: { n: 2, label: 'shell', of: 6 }, site: { at: [103, 19], size: [26, 14], yaw: -Math.PI / 2 }, roots: [], claims: [],
    massing: [{ name: 'nave', at: [0, 0], size: [24, 12], h: 9, roof: 'gable' }, { name: 'tower-a', at: [-10, -4], size: [4, 4], h: 20, roof: 'pyramid' }, { name: 'tower-b', at: [-10, 4], size: [4, 4], h: 20, roof: 'pyramid' }], ...overrides };
}
function entity(id: string, parent = 'world', p: [number, number] = [103, 19]): Entity { return { id, def: 'fixture@1', in: { parent }, p, by: 'god', born: 0, v: 1 }; }
function fakeModel(): SiteModel & { boxes: Map<string, OBB[]> } {
  const entities = new Map<string, Entity>(), boxes = new Map<string, OBB[]>();
  return { entities, boxes, subtree(id) { const ids = [id]; for (let i = 0; i < ids.length; i++) for (const e of entities.values()) if (e.in.parent === ids[i]) ids.push(e.id); return ids; }, worldPose(e) { return { x: e.p?.[0] ?? 0, y: 0, z: e.p?.at(-1) ?? 0, yaw: 0, s: 1 }; }, footprintsOf(id) { return boxes.get(id) ?? []; } };
}
function harness(style = 'ring,label', more: { fetchBuilds?: () => Promise<unknown>; groundAt?: (x: number, z: number) => number | null } = {}) {
  const model = fakeModel(); let mono = 1000, canvases = 0, paints = 0;
  const canvas = () => {
    canvases++;
    const context = { font: '', fillStyle: '', textBaseline: '', measureText: (s: string) => ({ width: s.length * 14 }), beginPath() {}, roundRect() {}, fill() {}, fillText() { paints++; } };
    return { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
  };
  const sites = new WorldBuildSites({ model: () => model, groundAt: () => 0, now: () => mono, createCanvas: canvas, search: `?sites=${style}`, ...more });
  return { sites, model, advance(ms: number) { mono += ms; sites.update(mono); }, now: () => mono, get canvases() { return canvases; }, get paints() { return paints; } };
}
function delta(rev: number, overrides: Partial<SiteDelta> = {}): SiteDelta { return { id: 'church', rev, status: 'active', lastAt: SERVER_NOW, ...overrides }; }
function edge(d: SiteDelta, now = SERVER_NOW) { return { type: 'edge', kind: 'world-build', rev: d.rev, now, event: 'alive', delta: d }; }
function start(b = site()) { return { type: 'edge', kind: 'world-build', rev: b.rev, now: SERVER_NOW, event: 'started', site: b }; }
function diff(d: SiteDelta[], upserts: Entity[] = [], removes: string[] = []) { return { type: 'edge', kind: 'world-diff', seq: 1, now: SERVER_NOW, builds: d, diff: { upserts, removes, defs: [], tiles: [] } }; }
function group(h: ReturnType<typeof harness>) { return h.sites.group.children[0] as THREE.Group; }
function marker(h: ReturnType<typeof harness>) { return group(h).children[0] as THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>; }
function faces(h: ReturnType<typeof harness>) { return group(h).children[1] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>; }

test('one adapter handles start/resume, deltas, multi-build diffs, snapshot/API rev, and the singular brief alias', () => {
  assert.equal(parseBuildFeed(start())?.records[0].id, 'church');
  assert.equal(parseBuildFeed(edge(delta(2)))?.records[0].rev, 2);
  assert.equal(parseBuildFeed(diff([delta(2), delta(3, { id: 'annex' })]))?.records.length, 2);
  assert.equal(parseBuildFeed({ builds: [site()], buildsRev: 17, now: SERVER_NOW })?.rev, 17);
  assert.equal(parseBuildFeed({ builds: [site()], rev: 17, now: SERVER_NOW })?.reset, true);
  assert.equal(parseBuildFeed({ kind: 'world-diff', build: site(), at: SERVER_NOW })?.now, SERVER_NOW);
  assert.equal(parseBuildFeed({ ...start(), rev: 2 }), null);
  assert.equal(parseBuildFeed({ builds: [delta(2)], rev: 2 }), null);
  assert.equal(parseBuildFeed({ builds: [], buildsRev: NaN }), null);
  assert.equal(parseBuildFeed({ kind: 'something-else' }), null);
});

test('apply/reset are idempotent by world rev and snapshot buildsRev suppresses old edge-buffer messages', () => {
  const h = harness(); h.sites.apply(start());
  const root = group(h), geometry = marker(h).geometry;
  h.sites.apply(start()); h.sites.reset([site({ title: 'stale' })], 1, SERVER_NOW);
  assert.equal(h.sites.stats.applied, 1); assert.equal(group(h), root); assert.equal(marker(h).geometry, geometry); assert.equal(h.paints, 1);
  h.sites.reset([site({ rev: 10, step: { n: 3, of: 6, label: 'roof' } })], 10, SERVER_NOW);
  h.sites.apply(edge(delta(2))); h.sites.apply(start());
  assert.equal(h.sites.maxRev, 10); assert.match(h.sites.inspect().sites[0].text, /roof 3\/6/);
  h.sites.reset([], 9, SERVER_NOW); assert.equal(h.sites.group.children.length, 1);
  h.sites.dispose();
});

test('a missed start (10) followed by 11 coalesces exactly one refetch and replays deltas newer than the fetched snapshot', async () => {
  let resolve!: (v: unknown) => void, calls = 0;
  const h = harness('ring,label', { fetchBuilds: () => { calls++; return new Promise(r => { resolve = r; }); } });
  h.sites.reset([], 9, SERVER_NOW);
  for (let i = 0; i < 5; i++) h.sites.apply(edge(delta(11, { step: { n: 3, label: 'roof', of: 6 } })));
  await Promise.resolve(); assert.equal(calls, 1); assert.equal(h.sites.stats.refetches, 1);
  const request = h.sites.resync(); resolve({ now: SERVER_NOW, rev: 10, builds: [site({ rev: 10 })] }); await request;
  assert.equal(h.sites.maxRev, 11); assert.match(h.sites.inspect().sites[0].text, /roof 3\/6/);
  h.sites.apply(edge(delta(11))); assert.equal(calls, 1); h.sites.dispose();
});

test('the seq poll repairs a lost last message; failed refetches back off, disposal prevents late resurrection', async () => {
  let calls = 0;
  const h = harness('ring', { fetchBuilds: async () => { calls++; if (calls === 1) throw Error('offline fixture'); return { rev: 4, now: SERVER_NOW, builds: [site({ rev: 4 })] }; } });
  h.sites.reset([], 0, SERVER_NOW); h.sites.checkRevision(4); await h.sites.resync();
  for (let i = 0; i < 10; i++) h.sites.checkRevision(4);
  await Promise.resolve(); assert.equal(calls, 1);
  h.advance(20_001); h.sites.checkRevision(4); await h.sites.resync(); assert.equal(h.sites.maxRev, 4);
  h.sites.checkRevision(3); assert.equal(calls, 2); h.sites.dispose();
  let finish!: (v: unknown) => void;
  const late = harness('ring', { fetchBuilds: () => new Promise(r => { finish = r; }) });
  late.sites.checkRevision(5); await Promise.resolve(); const p = late.sites.resync(); late.sites.dispose();
  finish({ rev: 5, now: SERVER_NOW, builds: [site({ rev: 5 })] }); await p; assert.equal(late.sites.group.children.length, 0);
});

test('gap recovery recounts buffered roots against installed geometry and preserves the original deadline', async () => {
  let resolve!: (v: unknown) => void;
  const h = harness('ring', { fetchBuilds: () => new Promise(r => { resolve = r; }) });
  const e = entity('e_root'); h.model.entities.set(e.id, e); h.model.boxes.set(e.id, [{ c: [103, 19], half: [1, 1], yaw: 0, y0: 0, y1: 1 }]);
  h.sites.reset([], 9, SERVER_NOW);
  h.sites.apply(diff([delta(11, { rootsAdded: [e.id] })], [e]));
  await Promise.resolve(); const request = h.sites.resync(); h.advance(30_000);
  h.sites.apply(diff([delta(11, { rootsAdded: [e.id] })], [e])); // repeated edge buffer must not reset receipt time
  resolve({ builds: [site({ rev: 10 })], rev: 10, now: SERVER_NOW + 30_000 }); await request;
  assert.deepEqual(h.sites.inspect().sites[0].parts, [1, 0, 0]);
  h.advance(569_999); assert.equal(h.sites.inspect().sites[0].paused, false);
  h.advance(1); assert.equal(h.sites.inspect().sites[0].paused, true);
  h.sites.dispose();
});

for (const skew of [-600_000, 600_000]) test(`pause and alive deadline use server now with ${skew / 60_000} min wall-clock skew`, () => {
  const realDateNow = Date.now; Date.now = () => SERVER_NOW + skew;
  const h = harness();
  try {
    h.sites.apply(start()); const color = marker(h).geometry.getAttribute('color').getX(0);
    h.advance(599_999); assert.equal(h.sites.inspect().sites[0].paused, false);
    h.sites.apply(edge(delta(2, { lastAt: SERVER_NOW + 599_999 }), SERVER_NOW + 599_999));
    h.advance(599_999); assert.equal(h.sites.inspect().sites[0].paused, false);
    h.advance(1); assert.equal(h.sites.inspect().sites[0].paused, true); assert.match(h.sites.inspect().sites[0].text, /paused 0 min/);
    assert.notEqual(marker(h).geometry.getAttribute('color').getX(0), color);
    h.advance(12 * 60_000); assert.match(h.sites.inspect().sites[0].text, /paused 12 min/);
    h.sites.apply(edge(delta(3, { status: 'paused', closed: false }), SERVER_NOW + 2_000_000)); assert.match(h.sites.inspect().sites[0].text, /paused · open/);
  } finally { h.sites.dispose(); Date.now = realDateNow; }
});

test('one canvas and texture per site; ordinary frames and alive/claim updates do not repaint unchanged text', () => {
  const h = harness(); h.sites.apply(start());
  const sprite = group(h).children.find(o => o instanceof THREE.Sprite) as THREE.Sprite, texture = sprite.material.map;
  for (let i = 0; i < 1000; i++) h.advance(16);
  h.sites.apply(edge(delta(2))); h.sites.apply(edge(delta(3, { claim: { part: 'tower', status: 'held' } })));
  assert.equal(h.canvases, 1); assert.equal(h.paints, 1); assert.equal(sprite.material.map, texture);
  h.advance(180_000); assert.match(h.sites.inspect().sites[0].text, /quiet 3 min/); assert.equal(h.paints, 2);
  h.sites.apply(edge(delta(4, { step: { n: 3, of: 6, label: 'roof' } })));
  assert.equal(h.paints, 3); assert.equal(h.canvases, 1); assert.equal(sprite.material.map, texture);
  h.sites.dispose();
});

test('explicit pause greys immediately and alive restores amber without editing any entity', () => {
  const h = harness(); h.sites.apply(start());
  const amber = marker(h).geometry.getAttribute('color').getX(0);
  h.sites.apply(edge(delta(2, { status: 'paused' }))); assert.notEqual(marker(h).geometry.getAttribute('color').getX(0), amber);
  h.sites.apply(edge(delta(3, { lastAt: SERVER_NOW + 1 }), SERVER_NOW + 1)); assert.equal(marker(h).geometry.getAttribute('color').getX(0), amber);
  h.sites.dispose();
});

test('held removals use PRE-batch ancestry/roots, and post-batch added members receive refinement', () => {
  const h = harness();
  const root = entity('e_root'), child = entity('e_child', root.id), deep = entity('e_deep', child.id), outside = entity('e_outside');
  for (const e of [root, child, deep, outside]) h.model.entities.set(e.id, e);
  h.sites.apply(start(site({ roots: [root.id] })));
  const d = diff([delta(2, { rootsRemoved: [root.id], rootsAdded: ['e_new'] })], [entity('e_new')], [root.id, child.id, deep.id, outside.id]);
  assert.deepEqual(h.sites.heldRemovals(d, h.model), new Set([root.id, child.id, deep.id]));
  assert.equal(h.sites.heldRemovals(diff([], [], [child.id]), h.model).size, 0);
  h.sites.apply(d);
  for (const id of d.diff.removes) h.model.entities.delete(id);
  for (const e of d.diff.upserts) h.model.entities.set(e.id, e);
  assert.equal(h.sites.memberOf(d.diff.upserts[0], h.model)?.id, 'church');
  assert.deepEqual(h.sites.refinement(d.diff.upserts[0], h.model), { scale: 0.9, seconds: 1.2, removalDelaySeconds: 1.5 });
  assert.equal(h.sites.memberOf(child, h.model), null);
  h.sites.apply(edge(delta(3, { status: 'paused' }))); assert.equal(h.sites.refinement(d.diff.upserts[0], h.model), null);
  h.sites.dispose();
});

test('massing is merged at start/snapshot (gable and pyramid caps); per-mass alpha fades as parts arrive and returns on removal', () => {
  const h = harness(); h.model.entities.set('e_root', entity('e_root'));
  h.sites.reset([site({ roots: ['e_root'] })], 1, SERVER_NOW);
  const mesh = faces(h), geometry = mesh.geometry, colors = geometry.getAttribute('color');
  assert.equal(mesh.material.depthWrite, false); assert.equal(colors.itemSize, 4); assert.ok(Math.abs(colors.getW(0) - 0.35) < 1e-6);
  geometry.computeBoundingBox(); assert.ok(Math.abs(geometry.boundingBox!.max.y - 22.08) < 1e-4);
  assert.equal(h.sites.inspect().sites[0].draws, 3);
  for (let i = 1; i <= 6; i++) {
    const e = entity(`e_part${i}`, 'e_root'); h.model.entities.set(e.id, e); h.model.boxes.set(e.id, [{ c: [103, 19], half: [0.5, 0.5], yaw: 0, y0: 0, y1: 1 }]);
    const d = diff([delta(i + 1)], [e]); h.sites.apply(d); h.sites.refitDiff(d);
    assert.ok(Math.abs(colors.getW(0) - 0.35 * (1 - i / 6)) < 1e-6);
    assert.equal(faces(h).geometry, geometry);
  }
  assert.equal(mesh.visible, true, 'towers still have ghost faces');
  assert.deepEqual(h.sites.inspect().sites[0].parts, [6, 0, 0]);
  assert.ok(marker(h).geometry.getAttribute('position').count > 64, 'massing edges persist after nave faces reach zero');
  const removed = 'e_part6'; h.model.entities.delete(removed); h.model.boxes.delete(removed);
  const d = diff([delta(8)], [], [removed]); h.sites.apply(d); h.sites.refitDiff(d); assert.ok(colors.getW(0) > 0);
  h.sites.dispose();
});

test('part centres respect the site and individual mass yaws; site-only alive messages do not recount geometry', () => {
  const h = harness(); const root = entity('e_root'); h.model.entities.set(root.id, root);
  h.model.boxes.set(root.id, [{ c: [103, 23], half: [0.2, 0.2], yaw: 0, y0: 0, y1: 1 }]);
  h.sites.apply(start(site({ roots: [root.id], massing: [{ at: [4, 0], size: [2, 6], yaw: Math.PI / 2, h: 3 }] })));
  assert.deepEqual(h.sites.inspect().sites[0].parts, [1]);
  h.model.boxes.set(root.id, [{ c: [120, 23], half: [0.2, 0.2], yaw: 0, y0: 0, y1: 1 }]);
  h.sites.apply(edge(delta(2))); assert.deepEqual(h.sites.inspect().sites[0].parts, [1]);
  const d = diff([delta(3)], [root]); h.sites.apply(d); h.sites.refitDiff(d); assert.deepEqual(h.sites.inspect().sites[0].parts, [0]);
  h.sites.dispose();
});

test('outline without massing uses footprint OBBs under empty prefab roots and instanced children', () => {
  const h = harness('outline'); const root = entity('e_prefab'), child = entity('e_instance', root.id);
  h.model.entities.set(root.id, root); h.model.entities.set(child.id, child);
  h.model.boxes.set(child.id, [{ c: [103, 19], half: [4, 2], yaw: Math.PI / 4, y0: 3, y1: 12 }]);
  h.sites.apply(start(site({ roots: [root.id], massing: [] })));
  assert.equal(marker(h).geometry.getAttribute('position').count, 24); marker(h).geometry.computeBoundingBox();
  assert.equal(marker(h).geometry.boundingBox!.min.y, 3); assert.equal(marker(h).geometry.boundingBox!.max.y, 12);
  assert.equal(h.sites.inspect().sites[0].draws, 1);
  h.sites.dispose();
});

test('marker is 32 terrain-draped segments, with no depth writes; all overlays carry buildSite hover identity', () => {
  const groundAt = (x: number, z: number) => x * 0.1 + z * 0.02;
  const h = harness('ring,label,sheen,wheel', { groundAt }); h.sites.apply(start(site({ massing: [] })));
  const pos = marker(h).geometry.getAttribute('position'); assert.equal(pos.count, 64); assert.equal(marker(h).material.depthTest, false); assert.equal(marker(h).renderOrder, 997);
  for (let i = 0; i < pos.count; i++) assert.ok(Math.abs(pos.getY(i) - groundAt(pos.getX(i), pos.getZ(i)) - 0.09) < 2e-6);
  group(h).traverse(o => { assert.equal(o.userData.buildSite, 'church'); assert.equal(o.userData.entity, 'build-site:church'); if ('material' in o) assert.equal((o as THREE.Mesh).material instanceof Array ? false : ((o as THREE.Mesh).material as THREE.Material).depthWrite, false); });
  const target = h.sites.hoverTarget('build-site:church'); assert.equal(target?.name, 'Under construction: Black stone church'); assert.equal(target?.detail, 'shell 2/6');
  assert.equal(h.sites.hoverTarget('other'), null); h.sites.dispose();
});

test('terrain refresh moves ghosts/marker/label together without a new canvas; wheel includes n/of stroke digits', () => {
  let height = 0;
  const h = harness('ring,label,wheel', { groundAt: () => height }); h.sites.apply(start());
  const old = faces(h).geometry; let freed = 0; old.addEventListener('dispose', () => freed++);
  const sprite = group(h).children.find(o => o instanceof THREE.Sprite) as THREE.Sprite;
  const wheel = group(h).children.find(o => o instanceof THREE.LineSegments && o !== marker(h)) as THREE.LineSegments;
  assert.ok(wheel.geometry.getAttribute('position').count > 128 + 12, 'step digits share the wheel draw');
  height = 7; h.sites.refreshAll(true); faces(h).geometry.computeBoundingBox();
  assert.equal(freed, 1); assert.ok(Math.abs(faces(h).geometry.boundingBox!.min.y - 7.08) < 1e-5); assert.equal(sprite.position.y, 9.5);
  assert.equal(h.canvases, 1); assert.equal(h.paints, 1); h.sites.dispose();
});

test('one runtime switch: default <=3 draws; outline adds zero, sheen/wheel add one each; off is zero', () => {
  const h = harness(); h.sites.apply(start()); assert.equal(h.sites.inspect().sites[0].draws, 3);
  h.sites.siteStyle('ring,label,outline'); assert.equal(h.sites.inspect().sites[0].draws, 3);
  h.sites.siteStyle('ring,label,sheen,wheel'); assert.equal(h.sites.inspect().sites[0].draws, 5);
  const sheen = group(h).children.find(o => o instanceof THREE.Mesh && o.material instanceof THREE.ShaderMaterial) as THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial>;
  const wheel = group(h).children.find(o => o instanceof THREE.LineSegments && o !== marker(h)) as THREE.LineSegments;
  const geometry = wheel.geometry; h.advance(16); assert.equal(wheel.geometry, geometry); assert.equal(sheen.material.uniforms.uTime.value, h.now() / 1000);
  h.sites.apply(edge(delta(2, { status: 'paused' }))); assert.equal(sheen.material.uniforms.uActive.value, 0);
  h.sites.siteStyle('off'); assert.equal(h.sites.group.visible, false); assert.equal(h.sites.inspect().sites[0].draws, 0); assert.equal(h.sites.hoverTarget('build-site:church'), null);
  h.sites.siteStyle('ring,label'); assert.equal(h.sites.group.visible, true); assert.equal(h.canvases, 1); assert.equal(h.sites.inspect().sites[0].draws, 3);
  h.sites.dispose();
});

test('a client-side pause cannot revive a wheel candidate disabled at runtime', () => {
  const h = harness('ring,label,wheel'); h.sites.apply(start()); h.sites.siteStyle('ring,label');
  h.advance(600_000); assert.equal(h.sites.inspect().sites[0].paused, true); assert.equal(h.sites.inspect().sites[0].draws, 3);
  h.sites.dispose();
});

test('done/abandon/reset dispose each site-owned geometry/material/texture once; shared sheen survives one site', () => {
  const h = harness('ring,label,sheen,wheel'); h.sites.apply(start());
  h.sites.apply(start(site({ id: 'annex', rev: 2 })));
  const first = group(h), disposals = new Map<object, number>();
  first.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry && !(o instanceof THREE.Sprite)) { disposals.set(mesh.geometry, 0); mesh.geometry.addEventListener('dispose', () => disposals.set(mesh.geometry, disposals.get(mesh.geometry)! + 1)); }
    const material = mesh.material as THREE.Material | undefined;
    if (material && !(material instanceof THREE.ShaderMaterial)) { disposals.set(material, 0); material.addEventListener('dispose', () => disposals.set(material, disposals.get(material)! + 1)); }
    if (o instanceof THREE.Sprite) { const texture = o.material.map!; disposals.set(texture, 0); texture.addEventListener('dispose', () => disposals.set(texture, disposals.get(texture)! + 1)); }
  });
  const shared = (first.children.find(o => o instanceof THREE.Mesh && o.material instanceof THREE.ShaderMaterial) as THREE.Mesh).material as THREE.Material;
  let sharedDisposed = 0; shared.addEventListener('dispose', () => sharedDisposed++);
  h.sites.apply(edge(delta(3, { status: 'done' }))); for (const count of disposals.values()) assert.equal(count, 1);
  assert.equal(sharedDisposed, 0); assert.equal(h.sites.group.children.length, 1);
  h.sites.apply(edge(delta(4, { id: 'annex', status: 'abandoned' }))); assert.equal(h.sites.group.children.length, 0);
  h.sites.dispose(); h.sites.dispose(); assert.equal(sharedDisposed, 1);
  const reset = harness(); reset.sites.apply(start()); reset.sites.reset([], 2, SERVER_NOW); assert.equal(reset.sites.group.children.length, 0); reset.sites.dispose();
});

// Import the real entity layer without Vite's eager mesh-discovery glob. Register a tiny
// local mesh below; no browser, server, remote assets or network are involved in this test.
async function entityLayerFixture() {
  (globalThis as { location?: unknown }).location ??= new URL('http://offline.invalid/w/fixture');
  const index = new URL('./gen-mesh/index.ts', import.meta.url).href;
  const hooks = registerHooks({ load(url, context, next) { return url === index ? { format: 'module', shortCircuit: true, source: "export { meshFor } from './registry.ts';" } : next(url, context); } });
  try { return await import('./WorldEntityLayer.ts'); } finally { hooks.deregister(); }
}

test('real applyDiff holds pre-batch removals 1.5s and gives every upsert (including a child) the 1.2s refinement profile', async () => {
  const { WorldEntityLayer } = await entityLayerFixture();
  const { registerMesh } = await import('./gen-mesh/registry.ts');
  registerMesh({ gen: 'tag:site-test', build: () => new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()) });
  const layer = new WorldEntityLayer(p => p); layer.sites.siteStyle('ring');
  const model = new WorldModel({ constants: { ground: 'land' }, seed: 'offline-build-sites' });
  model.defineDef({ schema: 'def/1', name: 'fixture', tags: ['site-test'], make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', size: [1, 1, 1], at: [0, 0.5, 0] }] } }, layer: 'decor', size: { box: [1, 1, 1] } }, 'god', 0);
  const root = entity('e_root'), old = entity('e_old', root.id, [0, 0]); model.insert(root); model.insert(old);
  const internals = layer as unknown as { model: WorldModel; seq: number; now: number; draw(e: Entity, ease: boolean): void; drawn: Map<string, { from: { p: THREE.Vector3; s: number }; to: { p: THREE.Vector3 }; t0: number; dur: number; obj: THREE.Object3D }> };
  internals.model = model; internals.seq = 0; internals.now = 1000; layer.active = true;
  layer.sites.apply(start(site({ roots: [root.id], massing: [] })));
  internals.draw(root, false); internals.draw(old, false);
  const newer = entity('e_new', root.id, [1, 0]);
  const d = diff([delta(2)], [root, newer], [old.id]); layer.applyEdge([d]);
  const removed = internals.drawn.get(old.id)!, added = internals.drawn.get(newer.id)!;
  assert.equal(removed.t0, 2500); assert.equal(removed.dur, 0.6);
  assert.equal(added.dur, SITE_REFINEMENT.seconds); assert.equal(added.from.s, 0.9); assert.deepEqual(added.from.p.toArray(), added.to.p.toArray());
  assert.equal(internals.drawn.get(root.id)!.dur, 1.2);
  layer.update(0, 2000); assert.equal(removed.obj.scale.x, 1); assert.equal(removed.obj.position.y, 0);
  layer.update(0, 3100); assert.equal(internals.drawn.has(old.id), false); assert.equal(added.obj.scale.x, 1);
  layer.dispose();
});

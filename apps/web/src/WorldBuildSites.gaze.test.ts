// Offline: node --test --test-concurrency=1 apps/web/src/WorldBuildSites.gaze.test.ts
// CE8 passive attention marker: one reticle sprite per site with a fresh look, outside the rev sequence.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldBuildSites, parseBuildFeed, GAZE, gazeSize, type PublicSite, type Attention, type SiteModel } from './WorldBuildSites.ts';

const SERVER_NOW = 1_800_000_000_000;
function site(overrides: Partial<PublicSite> = {}): PublicSite {
  return { id: 'church', title: 'Black stone church', rev: 1, status: 'active', lastAt: SERVER_NOW, pauseAfterMs: 600_000, closed: true,
    step: { n: 2, label: 'shell', of: 6 }, site: { at: [103, 19], size: [26, 14], yaw: 0 }, roots: [], claims: [],
    massing: [{ name: 'nave', at: [0, 0], size: [24, 12], h: 9, roof: 'gable' }], ...overrides };
}
function model(): SiteModel { return { entities: new Map(), subtree: id => [id], worldPose: () => ({ x: 0, y: 0, z: 0, yaw: 0, s: 1 }), footprintsOf: () => [] }; }
function canvas() {
  const noop = () => {};
  const context = { font: '', fillStyle: '', strokeStyle: '', lineWidth: 0, lineCap: '', textBaseline: '', measureText: (s: string) => ({ width: s.length * 14 }), beginPath: noop, roundRect: noop, fill: noop, fillText: noop, arc: noop, moveTo: noop, lineTo: noop, stroke: noop };
  return { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
}
function harness(more: { reducedMotion?: () => boolean; style?: string } = {}) {
  let mono = 1000;
  const sites = new WorldBuildSites({ model, groundAt: () => 0, now: () => mono, createCanvas: canvas, search: `?sites=${more.style ?? 'ring,label'}`, reducedMotion: more.reducedMotion, fetchBuilds: async () => { throw Error('no fetch in this test'); } });
  return { sites, advance(ms: number) { mono += ms; sites.update(mono); }, now: () => mono };
}
const start = (b = site()) => ({ type: 'edge', kind: 'world-build', rev: b.rev, now: SERVER_NOW, event: 'started', site: b });
const look = (attention: Attention, rev = 1, now = SERVER_NOW) => ({ type: 'edge', kind: 'world-build', event: 'attention', rev, now, delta: { id: 'church', rev, status: 'active', lastAt: SERVER_NOW, attention } });
const gazeOf = (h: ReturnType<typeof harness>) => h.sites.inspect().sites[0]?.gaze;
const sprite = (h: ReturnType<typeof harness>) => (h.sites.group.children[0] as THREE.Group).children.find(o => o.name === 'build-gaze') as THREE.Sprite | undefined;

test('CE8 feed: attention events are a separate feed; malformed hints are ignored', () => {
  const a: Attention = { at: [100, 2, 20], eye: [120, 14, 40], t: SERVER_NOW };
  assert.deepEqual(parseBuildFeed(look(a)), { reset: false, records: [look(a).delta], rev: 1, now: SERVER_NOW, attention: true });
  assert.deepEqual(parseBuildFeed(start(site({ attention: a })))?.records[0], site({ attention: a }));
  for (const bad of [{ at: [1, 2], t: 1 }, { at: [1, 2, 3] }, { at: [1, 2, 3], eye: [1, 2], t: 1 }, { at: [1, NaN, 3], t: 1 }, { at: '1,2,3', t: 1 }]) assert.equal(parseBuildFeed(look(bad as never)), null, JSON.stringify(bad));
  assert.equal(parseBuildFeed({ ...look(a), delta: { id: 'church', rev: 1, status: 'active', lastAt: 0 } }), null, 'an attention event must carry a hint');
});

test('CE8: a hint shows one reticle at its point without touching the rev sequence; replays and older hints are ignored', () => {
  const h = harness(); h.sites.apply(start());
  const before = h.sites.inspect().sites[0].draws, applied = h.sites.stats.applied;
  const message = look({ at: [100, 2, 20], t: SERVER_NOW });
  h.sites.apply(message);
  assert.deepEqual(gazeOf(h)?.at, [100, 2.05, 20]); assert.equal(gazeOf(h)?.opacity, GAZE.alpha);
  assert.equal(h.sites.maxRev, 1); assert.equal(h.sites.stats.applied, applied); assert.equal(h.sites.stats.refetches, 0, 'never a resync');
  assert.equal(h.sites.inspect().sites[0].draws, before + 1, 'exactly one more draw: the sprite');
  h.sites.apply(message); h.sites.apply(look({ at: [0, 0, 0], t: SERVER_NOW - 1 }));
  assert.deepEqual(gazeOf(h)?.at, [100, 2.05, 20], 'a replayed or older look never moves it');
  h.advance(2000); h.sites.apply(look({ at: [110, 0, 25], t: SERVER_NOW + 2000 }, 1, SERVER_NOW + 2000));
  assert.deepEqual(gazeOf(h)?.at, [110, 0.05, 25]);
  assert.equal((h.sites.group.children[0] as THREE.Group).children.filter(o => o instanceof THREE.Sprite && o.name === 'build-gaze').length, 1, 'one sprite per site, reused');
  // Rev deltas still flow normally afterwards.
  h.sites.apply({ type: 'edge', kind: 'world-build', rev: 2, now: SERVER_NOW + 2000, event: 'step', delta: { id: 'church', rev: 2, status: 'active', lastAt: SERVER_NOW + 2000, step: { n: 3, label: 'roof', of: 6 } } });
  assert.equal(h.sites.maxRev, 2); assert.ok(gazeOf(h), 'a step delta keeps the reticle');
  h.sites.dispose();
});

for (const skew of [-90_000, 0, 90_000]) test(`CE8: the reticle fades out 20 s after the god looked (client clock skew ${skew / 1000} s)`, () => {
  const original = Date.now; Date.now = () => SERVER_NOW + skew;
  const h = harness();
  try {
    h.sites.apply(start());
    h.sites.apply(look({ at: [100, 0, 20], t: SERVER_NOW - 5000 }));  // the hint was already 5 s old when it arrived
    assert.equal(gazeOf(h)?.opacity, GAZE.alpha);
    h.advance(GAZE.ttlMs - GAZE.fadeMs - 5000); assert.equal(gazeOf(h)?.opacity, GAZE.alpha);
    h.advance(GAZE.fadeMs / 2); assert.ok(Math.abs(gazeOf(h)!.opacity - GAZE.alpha / 2) < 1e-9);
    const draws = h.sites.inspect().sites[0].draws;
    h.advance(GAZE.fadeMs / 2); assert.equal(gazeOf(h), null); assert.equal(sprite(h)!.visible, false);
    assert.equal(h.sites.inspect().sites[0].draws, draws - 1, 'no draw once faded');
    // A stale hint (e.g. a late snapshot) never appears.
    h.sites.apply(look({ at: [1, 0, 1], t: SERVER_NOW + 5000 }, 1, SERVER_NOW + 5000 + GAZE.ttlMs + 1)); assert.equal(gazeOf(h), null);
  } finally { h.sites.dispose(); Date.now = original; }
});

test('CE8: reduced motion keeps the reticle still; otherwise it breathes gently', () => {
  const size = (reduced: boolean) => {
    const h = harness({ reducedMotion: () => reduced }); h.sites.apply(start()); h.sites.apply(look({ at: [100, 0, 20], t: SERVER_NOW }));
    const s = sprite(h)!, camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000); camera.position.set(100, 10, 60); camera.lookAt(100, 0, 20); camera.updateMatrixWorld(); s.updateMatrixWorld();
    const renderer = { getSize: (v: THREE.Vector2) => v.set(812, 812) } as unknown as THREE.WebGLRenderer, sizes: number[] = [];
    for (let i = 0; i < 4; i++) { h.advance(500); s.onBeforeRender(renderer, new THREE.Scene(), camera, s.geometry, s.material, null as never); sizes.push(s.scale.x); }
    h.sites.dispose(); return sizes;
  };
  const still = size(true), moving = size(false);
  assert.ok(still.every(v => v === still[0]), `still: ${still}`); assert.ok(still[0] >= GAZE.worldSize);
  assert.ok(new Set(moving.map(v => v.toFixed(6))).size > 1, `moving: ${moving}`); assert.ok(moving.every(v => Math.abs(v / still[0] - 1) <= GAZE.pulse + 1e-9));
});

test('CE8: a close look is a small mark; a wide look rings what it framed (clamped); where/free hints are small', () => {
  assert.equal(gazeSize({ at: [0, 0, 0] }), GAZE.worldSize);
  assert.equal(gazeSize({ at: [0, 0, 0], eye: [1, 1, 1] }), GAZE.worldSize, 'never smaller than the base mark');
  const wide = gazeSize({ at: [-66, 0, 3], eye: [-43.7, 17.3, 25.3] }); // S1's 36 m look at the whole site
  assert.ok(Math.abs(wide - 2 * Math.tan(Math.PI / 8) * 36) < 0.1, String(wide));
  assert.equal(gazeSize({ at: [0, 0, 0], eye: [0, 400, 0] }), GAZE.maxSize);
  const h = harness(); h.sites.apply(start());
  h.sites.apply(look({ at: [-66, 0, 3], eye: [-43.7, 17.3, 25.3], t: SERVER_NOW }));
  assert.equal(gazeOf(h)?.size, wide); assert.equal(sprite(h)!.scale.x, wide);
  h.sites.apply(look({ at: [100, 0, 20], t: SERVER_NOW + 1 }));
  assert.equal(gazeOf(h)?.size, GAZE.worldSize, 'a later where/free hint shrinks it again');
  h.sites.dispose();
});

test('CE8: snapshots restore a fresh look; closing the site or style off removes it', () => {
  const h = harness();
  h.sites.reset([site({ rev: 4, attention: { at: [104, 0, 18], t: SERVER_NOW - 1000 } })], 4, SERVER_NOW);
  assert.deepEqual(gazeOf(h)?.at, [104, 0.05, 18]);
  h.sites.siteStyle('off'); assert.equal(h.sites.group.visible, false);
  h.sites.siteStyle('ring,label'); assert.ok(gazeOf(h));
  const material = sprite(h)!.material; let disposed = false; material.addEventListener('dispose', () => { disposed = true; });
  h.sites.apply({ type: 'edge', kind: 'world-build', rev: 5, now: SERVER_NOW, event: 'done', delta: { id: 'church', rev: 5, status: 'done', lastAt: SERVER_NOW } });
  assert.equal(h.sites.inspect().sites.length, 0); assert.equal(disposed, true);
  // A hint for a site the viewer does not know is ignored (the next snapshot carries it).
  h.sites.apply(look({ at: [1, 0, 1], t: SERVER_NOW + 1 }, 5)); assert.equal(h.sites.inspect().sites.length, 0);
  h.sites.dispose();
});

test('CE8 contract: the real server attention event and public site drive the real viewer reticle', async () => {
  const { Db } = await import('../../server/src/db.ts');
  const { GodMode } = await import('../../server/src/god/god.ts');
  let now = SERVER_NOW; const messages: unknown[] = [];
  const god = new GodMode(new Db(':memory:'), { worldId: 'gaze-contract', ownerId: 'owner', tick: () => 0, now: () => now, schedule: () => {}, emit: (m: unknown) => messages.push(m) });
  try {
    const identity = god.godIdentity(god.mintFor({ id: 'owner', role: 'user' }, 'lead'))!;
    const started = god.builds.start({ id: 'church', title: 'Stone church', steps: ['shell'], site: { at: [0, 0], size: [40, 40] } }, identity);
    assert.equal(started.ok, true);
    const h = harness(); for (const m of messages) h.sites.apply(m);
    now += 10; assert.equal(god.builds.attend('church', { at: [3, 0, -4], eye: [20, 12, 18] }, identity).ok, true);
    h.sites.apply(messages.at(-1));
    assert.deepEqual(gazeOf(h)?.at, [3, 0.05, -4]); assert.ok(gazeOf(h)!.size > GAZE.worldSize);
    // A viewer that joins later gets the same look from the public snapshot.
    const late = harness(); const list = god.builds.publicList(now); late.sites.reset(list.builds as PublicSite[], list.rev, list.now);
    assert.deepEqual(gazeOf(late)?.at, [3, 0.05, -4]);
    h.sites.dispose(); late.sites.dispose();
  } finally { god.db.close(); }
});

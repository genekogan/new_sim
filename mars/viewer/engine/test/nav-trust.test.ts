// Nav trust (load lane L4): while only nav-pure code runs, a sync takes the last scan's "no static change" without
// walking the entities; any close voids it. The scan stays the oracle (setNavTrustCheck).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Spatial } from '../spatial/service.ts';
import { navTrustClose, navTrustOpen, setNavTrustCheck } from '../spatial/nav-trust.ts';
import { emptyWorld, human, addAll, component } from '../world/factory.ts';
import type { SpatialScene } from '../spatial/types.ts';

const open = (half: number): SpatialScene => ({
  bounds: [-half, -half, half, half],
  levels: [{ id: 0, y: 0, label: 'ground' }],
  surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [half, half], yaw: 0 } }],
  obstacles: [],
  links: [],
});

test('nav trust: an open interval reuses one scan, a close voids it, and the oracle catches a static change it skipped', () => {
  const sp = new Spatial(open(20));
  const w = addAll(emptyWorld('open', open(20)), human('p', 0, 0), component('wall', 'test-wall', [5, 0, 0], 0, { phase: 'stored' }));
  try {
    navTrustClose(); sp.sync(w);
    navTrustOpen();
    assert.equal(sp.sync(w), false, 'first sync in the interval scans: nothing changed');
    const scans = sp.stats.scans;
    w.entities.p.pose.p = [1, 0, 1];   // a body moves: still trusted (bodies are not static)
    assert.equal(sp.sync(w), false);
    assert.equal(sp.stats.scans, scans, 'no scan while trusted');
    assert.equal(sp.stats.trusted, 1);
    navTrustClose();
    w.entities.wall.pose.p = [6, 0, 0];   // a static change after a close is seen by the next sync
    navTrustOpen();
    assert.equal(sp.sync(w), true);
    assert.equal(sp.stats.scans, scans + 1);
    // a "nav-pure" step that changes a static entity: the oracle scan throws
    setNavTrustCheck(true);
    w.entities.wall.pose.p = [7, 0, 0];
    assert.throws(() => sp.sync(w), /nav-trust/);
  } finally { setNavTrustCheck(false); navTrustClose(); }
  // closed: every sync scans
  const before = sp.stats.scans;
  sp.sync(w); sp.sync(w);
  assert.equal(sp.stats.scans, before + 2);
});

test('nav trust: another entity table is never trusted from this one', () => {
  const sp = new Spatial(open(20));
  const a = addAll(emptyWorld('open', open(20)), human('p', 0, 0), component('wall', 'test-wall', [5, 0, 0], 0, { phase: 'stored' }));
  const b = addAll(emptyWorld('open', open(20)), human('p', 0, 0), component('wall', 'test-wall', [9, 0, 0], 0, { phase: 'stored' }));
  try {
    navTrustOpen(); sp.sync(a);
    assert.equal(sp.sync(b), true, 'b differs from a: a real scan');
  } finally { navTrustClose(); }
});

test('nav trust (L4 audit): a seated body and a walker share one scan a tick; the pass reuses it', async () => {
  const { Runtime } = await import('../runtime/runtime.ts');
  const { DEFAULT_INVARIANTS } = await import('../runtime/invariants.ts');
  const { provingGround } = await import('../scenes/proving-ground.ts');
  const { FIXTURE } = await import('../world/factory.ts');
  const { walkTo } = await import('../locomotion/walk.ts');
  const { SOCIAL_ACTIONS } = await import('../social/actions.ts');
  const { poseV1 } = await import('../social/pose.ts');
  const base = provingGround();
  const bench = { id: 'bench', def: 'bench-6ft', kind: 'fixture' as const, pose: { p: [0, 0, -8] as [number, number, number], yaw: Math.PI / 2 }, provenance: FIXTURE };
  const w = addAll(emptyWorld('proving-ground', base), human('sitter', 0, -6), human('walker', -6, -6), human('poser', 4, -4), bench);
  const reg = new Map<string, import('../actions/types.ts').ActionDef>([[walkTo.verb, walkTo], ...[...SOCIAL_ACTIONS, poseV1].map((a) => [a.verb, a] as [string, import('../actions/types.ts').ActionDef])]);
  const sp = new Spatial(base);
  const rt = new Runtime(w, reg, { spatial: sp }, DEFAULT_INVARIANTS);
  setNavTrustCheck(true);   // every trusted sync scans anyway and throws on a static change the trust skipped
  try {
    const sit = rt.submit('sit', { actor: 'sitter', fixture: 'bench' }).id;
    for (let i = 0; i < 200 && rt.records.get(sit)!.phase !== 'occupied'; i++) rt.step();
    assert.equal(rt.records.get(sit)!.phase, 'occupied');
    rt.submit('pose_v1', { actor: 'poser', activity: 'wave', seconds: 30 });
    rt.submit('walk_to', { actor: 'walker', x: 6, z: 6 });
    rt.step();
    const scans = sp.stats.scans, trusted = sp.stats.trusted;
    for (let i = 0; i < 20; i++) rt.step();
    assert.equal(sp.stats.scans - scans, 20, 'one scan a tick (the first sync after the tick opens)');
    assert.ok(sp.stats.trusted - trusted >= 20, 'the pass (and later syncs) take the scan');
    assert.deepEqual(rt.violations, []);
  } finally { setNavTrustCheck(false); navTrustClose(); }
});

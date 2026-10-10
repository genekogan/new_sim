// Souls on the ground (lane L8, spec <eden4>/31 B1): an entity world's terrain in the Mars engine.
// Route up a knoll (y follows the slope), refuse a cliff, wade the pond edge, swim the lake, and
// snapshot/restore agree; a world without the fact behaves as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marsFactory, GREEN_FIELD_WORLD } from './engine.ts';
import { groundFact, groundField } from './ground-bridge.ts';
import { emptyGround, type Ground } from '../../ground/src/index.ts';
import type { Engine } from '@sim/engine-contract';

const factory = await marsFactory(GREEN_FIELD_WORLD);
const pondArea: [number, number][] = [[-30, -10], [-20, -10], [-20, 0], [-30, 0]];
const lakeArea: [number, number][] = [[-90, -40], [-50, -40], [-50, 0], [-90, 0]];
function terrain(): Ground {
  const g = emptyGround(1000);
  g.landforms.push({ id: 'knoll', kind: 'bump', c: [30, 0], r: 25, h: 5, peak: 1 });
  g.landforms.push({ id: 'mesa', kind: 'plateau', area: [[-10, 40], [10, 40], [10, 60], [-10, 60]], h: 8, edge: 1 });
  g.landforms.push({ id: 'pond', kind: 'carve', area: pondArea, bed: -0.2, edge: 1 });
  g.landforms.push({ id: 'lake', kind: 'carve', area: lakeArea, bed: -3, edge: 6 });
  g.waters.push({ id: 'pond', area: pondArea, level: 0 }, { id: 'lake', area: lakeArea, level: 0 });
  return g;
}
const fact = groundFact(terrain(), 4);
const field = groundField(fact.recipeHash);

function world(seed = 'ground'): Engine & { installGroundV1(f: unknown): { installed: boolean; settled: string[] } } {
  const e = factory.create(factory.genesis(seed)) as never as Engine & { installGroundV1(f: unknown): { installed: boolean; settled: string[] } };
  e.installGroundV1(fact);
  e.spawnHuman({ id: 'h_ada', label: 'Ada', soul: 's_ada' });
  return e;
}
type Body = { pose: { p: [number, number, number] }; human: { activity: string } };
const body = (e: Engine, id = 'h_ada') => e.world.entities[id] as unknown as Body;
/** Run a program to its end; returns the program's last event and every distinct activity seen, with the y track. */
function run(e: Engine, steps: { verb: string; params: Record<string, unknown> }[], maxTicks = 20 * 240) {
  const adm = e.perform({ actor: 'h_ada', label: 'test', steps });
  if (!adm.ok) return { adm, end: { kind: 'failed', ...adm.diagnostic }, acts: new Set<string>(), ys: [] };
  const acts = new Set<string>(), ys: { x: number; z: number; y: number }[] = [];
  let end: { kind: string; code?: string; message?: string } | undefined;
  for (let i = 0; i < maxTicks && !end; i++) {
    const out = e.step();
    const b = body(e); acts.add(b.human.activity); ys.push({ x: b.pose.p[0], z: b.pose.p[2], y: b.pose.p[1] });
    end = out.programs.find((p) => p.id === adm.id && (p.kind === 'completed' || p.kind === 'failed' || p.kind === 'cancelled'));
  }
  return { adm, end, acts, ys };
}

test('a Soul is born standing on the ground and walks up the knoll; its y follows the slope', () => {
  const e = world();
  const b = body(e);
  assert.equal(b.pose.p[1], field.height(b.pose.p[0], b.pose.p[2]), 'born on the tiles');
  const r = run(e, [{ verb: 'walk_to', params: { to: [30, 0] } }]);
  assert.equal(r.end?.kind, 'completed', JSON.stringify(r.end));
  const top = body(e).pose.p;
  assert.ok(Math.hypot(top[0] - 30, top[2]) < 0.5, `at the top: ${top}`);
  assert.ok(top[1] > 4.9, `y at the top ${top[1]}`);
  // every sample of the climb stands on the tiles
  for (const s of r.ys) assert.ok(Math.abs(s.y - field.height(s.x, s.z)) < 1e-9, `y off the ground at ${s.x},${s.z}`);
  const rising = r.ys.filter((s, i) => i > 0 && s.y > r.ys[i - 1].y).length;
  assert.ok(rising > 50, 'climbs gradually');
  assert.deepEqual(e.runtime.violations, []);
});

test('a cliff is refused with a precise code; deep water refuses walking; the edge of the world is refused', () => {
  const e = world();
  const cliff = e.canPerform({ actor: 'h_ada', label: 'mesa', steps: [{ verb: 'walk_to', params: { to: [0, 50] } }] }) ?? run(e, [{ verb: 'walk_to', params: { to: [0, 50] } }]).end;
  assert.match(String((cliff as { code?: string })?.code), /ground\.cliff/, JSON.stringify(cliff));
  const lake = run(e, [{ verb: 'walk_to', params: { to: [-70, -20] } }]).end;
  assert.equal(lake?.code, 'ground.deep-water', JSON.stringify(lake));
  const far = run(e, [{ verb: 'walk_to', params: { to: [499, 0] } }]).end;
  assert.ok(far?.kind === 'failed' && /^ground\./.test(far.code ?? ''), JSON.stringify(far));
});

test('wading the pond edge: the walker crosses shallow water, standing on the bed, activity wade', () => {
  const e = world();
  const r = run(e, [{ verb: 'walk_to', params: { to: [-25, -5] } }]);
  assert.equal(r.end?.kind, 'completed', JSON.stringify(r.end));
  assert.ok(r.acts.has('wade'), [...r.acts].join(','));
  const p = body(e).pose.p;
  assert.ok(p[1] < -0.1, `on the pond bed: ${p[1]}`);
  assert.deepEqual(e.runtime.violations, []);
});

test('swimming the lake: swim_to crosses deep water at the swimmer root, then walking out swims to the shore first', () => {
  const e = world();
  // the lake is 50 m off: swimming from here is refused (dry ground between), so walk to its shore first
  assert.equal(run(e, [{ verb: 'mars:swim_to', params: { x: -70, z: -20 } }]).end?.code, 'swim.not-connected');
  assert.equal(run(e, [{ verb: 'walk_to', params: { to: [-49, -20] } }]).end?.kind, 'completed');
  const r = run(e, [{ verb: 'mars:swim_to', params: { x: -70, z: -20 } }], 20 * 400);
  assert.equal(r.end?.kind, 'completed', JSON.stringify(r.end));
  assert.ok(r.acts.has('swim'), [...r.acts].join(','));
  const b = body(e);
  assert.equal(b.human.activity, 'tread');
  assert.ok(Math.abs(b.pose.p[1] - -1.2) < 1e-9, `root 1.2 m under the surface: ${b.pose.p[1]}`);
  // walking somewhere from the water: swim to the shore, then walk
  const out = run(e, [{ verb: 'walk_to', params: { to: [0, -5] } }], 20 * 400);
  assert.equal(out.end?.kind, 'completed', JSON.stringify(out.end));
  assert.ok(out.acts.has('swim') && out.acts.has('walk'), [...out.acts].join(','));
  assert.deepEqual(e.runtime.violations, []);
  // a dry destination is not a swim
  const dry = run(e, [{ verb: 'mars:swim_to', params: { x: 30, z: 0 } }]).end;
  assert.equal(dry?.code, 'swim.not-water', JSON.stringify(dry));
});

test('snapshot mid-climb restores on the same ground and continues identically', () => {
  const a = world('snap');
  a.perform({ actor: 'h_ada', label: 'climb', steps: [{ verb: 'walk_to', params: { to: [30, 0] } }] });
  for (let i = 0; i < 100; i++) a.step();
  const snap = a.snapshot();
  const b = factory.restore(snap);
  for (let i = 0; i < 200; i++) { a.step(); b.step(); }
  assert.deepEqual(body(b).pose.p, body(a).pose.p);
  assert.equal(b.stateHash(), a.stateHash());
  assert.ok(body(b).pose.p[1] > 0.5);
});

test('reinstalling a changed ground lifts standing bodies onto it; same recipe is a no-op', () => {
  const e = world('lift');
  const before = body(e).pose.p[1];
  assert.equal(e.installGroundV1(fact).installed, false);
  const g = terrain(); const p = body(e).pose.p;
  g.landforms.push({ id: 'raise', kind: 'bump', c: [p[0], p[2]], r: 10, h: 2, peak: 1 });
  const r = e.installGroundV1(groundFact(g, 5));
  assert.equal(r.installed, true);
  assert.deepEqual(r.settled, ['h_ada']);
  assert.ok(body(e).pose.p[1] > before + 1.9);
});

test('a world without the ground fact keeps flat level-0 behaviour (no ground mode)', () => {
  const e = factory.create(factory.genesis('flat'));
  e.spawnHuman({ id: 'h_ada', label: 'Ada', soul: 's_ada' });
  assert.equal((e.world as { groundV1?: unknown }).groundV1, undefined);
  const r = run(e, [{ verb: 'walk_to', params: { to: [10, 0] } }]);
  assert.equal(r.end?.kind, 'completed');
  assert.ok(r.ys.every((s) => s.y === 0));
  assert.ok(!e.describeVerbs().some((v) => v.verb === 'mars:swim_to'));
});

test('tiled ground Spatial: a large solid is routed round (coarse + fine agree), a floor slab raises the standing height, tiles are cached', async () => {
  const { Spatial } = await import('../../../mars/viewer/engine/spatial/service.ts');
  const { GREEN_FIELD_SCENE, greenFieldWorld } = await import('../../../mars/viewer/engine/scenarios/greenfield.ts');
  const { HUMAN_PROFILE } = await import('../../../mars/viewer/engine/spatial/types.ts');
  const wall = { id: 'big-block', obb: { c: [0, 0] as [number, number], half: [12, 3] as [number, number], yaw: 0 }, y0: -1, y1: 4, kind: 'solid' as const };
  const slab = { id: 'deck', level: 0, y: 0.3, obb: { c: [20, 20] as [number, number], half: [3, 3] as [number, number], yaw: 0 } };
  const sp = new Spatial({ ...GREEN_FIELD_SCENE, obstacles: [wall], surfaces: [...GREEN_FIELD_SCENE.surfaces, slab] }, { source: { scene: GREEN_FIELD_SCENE, id: 'green-field' } });
  const w = greenFieldWorld('tiles') as never;
  sp.setGround(field, w, [[0, 0]]);
  const r = sp.route(w, HUMAN_PROFILE, { level: 0, p: [0, -8] }, { level: 0, p: [0, 8] });
  assert.ok(r.ok, JSON.stringify(!r.ok && r.diagnostic));
  assert.ok(r.ok && r.route.length > 24, 'goes round the 24 m block');
  assert.equal(sp.ground!.coarseSolid(0, 0), true);
  assert.ok(Math.abs(sp.ground!.standY(20, 20) - 0.3) < 1e-9, 'on the deck');
  assert.equal(sp.ground!.standY(30, 30), field.height(30, 30), 'off the deck: the ground');
  const builds = sp.ground!.stats.fineBuilds;
  sp.route(w, HUMAN_PROFILE, { level: 0, p: [0, -8] }, { level: 0, p: [5, 9] });
  assert.equal(sp.ground!.stats.fineBuilds, builds, 'no tile rebuilt for a second route');
});

test('two Souls on the knoll flank: a walker passes one standing in its way on the slope without overlap', () => {
  const e = world('pass');
  e.spawnHuman({ id: 'h_bob', label: 'Bob', soul: 's_bob' });
  const bob = e.perform({ actor: 'h_bob', label: 'stand', steps: [{ verb: 'walk_to', params: { to: [20, 0.2] } }] });
  for (let i = 0; i < 20 * 40; i++) { const o = e.step(); if (o.programs.some((p) => p.id === bob.id && p.kind !== 'step')) break; }
  const b = body(e, 'h_bob').pose.p;
  assert.ok(Math.hypot(b[0] - 20, b[2] - 0.2) < 0.6 && b[1] > 1, `Bob stands on the flank: ${b}`);
  const r = run(e, [{ verb: 'walk_to', params: { to: [30, 0] } }]);
  assert.equal(r.end?.kind, 'completed', JSON.stringify(r.end));
  assert.deepEqual(e.runtime.violations, []);
});

test('an L3 cliff (core/cliff): its face cannot be climbed, so the Soul walks round its end and up the back slope (hierarchical hops)', () => {
  const g = terrain();
  g.landforms.push({ id: 'escarpment', kind: 'cliff', path: [[40, -20], [40, 20]], h: 6, side: -1, face: 1, w: 20, back: 40, steps: 1 } as never);
  const e = factory.create(factory.genesis('cliff')) as never as Engine & { installGroundV1(f: unknown): unknown };
  const f2 = groundFact(g, 9); e.installGroundV1(f2);
  e.spawnHuman({ id: 'h_ada', label: 'Ada', soul: 's_ada' });
  const fld = groundField(f2.recipeHash);
  assert.equal(fld.medium(40, 0), 3, 'the face is steep');
  assert.ok(fld.height(50, 0) > 5.9, 'the top is up');
  const r = run(e, [{ verb: 'walk_to', params: { to: [50, 0] } }], 20 * 600);
  assert.equal(r.end?.kind, 'completed', JSON.stringify(r.end));
  const p = body(e).pose.p;
  assert.ok(Math.hypot(p[0] - 50, p[2]) < 0.6 && p[1] > 5.9, `on top: ${p}`);
  let walked = 0; for (let i = 1; i < r.ys.length; i++) walked += Math.hypot(r.ys[i].x - r.ys[i - 1].x, r.ys[i].z - r.ys[i - 1].z);
  assert.ok(walked > 100, `went round (walked ${walked.toFixed(0)} m for a 50 m crow-fly)`);
  assert.ok(r.ys.every((s) => fld.medium(s.x, s.z) !== 3), 'never set foot on the face');
  assert.deepEqual(e.runtime.violations, []);
});

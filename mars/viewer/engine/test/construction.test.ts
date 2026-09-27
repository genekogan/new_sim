// Supported rack bay (spec §28 "Raise tall frame", premature release) —
// raise two 12 ft uprights, hold them, seat beams, release only when stable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { emptyWorld, human, addAll, component } from '../world/factory.ts';
import { walkTo } from '../locomotion/walk.ts';
import { CONSTRUCTION_ACTIONS, uprightsSupported } from '../construction/index.ts';
import { groupStability } from '../construction/rules.ts';
import { def } from '../world/catalog.ts';
import type { ActionDef } from '../actions/types.ts';
import type { Obstacle, SpatialScene } from '../spatial/types.ts';

const L9 = def('beam-9ft').size[0];
const D12 = def('upright-12ft').size[0];
const LYING = Math.PI / 2;
/** A lying frame rests on its face: origin (base centre) raised by half the column thickness (canonicalLying). */
const REST_Y = def('upright-12ft').size[2] / 2;

function openGround(extra: Obstacle[] = []): SpatialScene {
  return {
    bounds: [-15, -15, 15, 15],
    levels: [{ id: 0, y: 0, label: 'ground' }],
    surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [15, 15], yaw: 0 } }],
    obstacles: extra,
    links: [],
  };
}

function setup(extra: Obstacle[] = []) {
  const base = openGround(extra);
  const w = addAll(
    emptyWorld('open-ground', base),
    // A lies toward −z (yaw π), B lies toward +z (yaw 0); bases L9 apart so the bay is between them
    component('A', 'upright-12ft', [0, 0, 0], Math.PI, { phase: 'staged', pose: { p: [0, REST_Y, 0], yaw: Math.PI, pitch: LYING } }),
    component('B', 'upright-12ft', [0, 0, L9], 0, { phase: 'staged', pose: { p: [0, REST_Y, L9], yaw: 0, pitch: LYING } }),
    ...['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((id, i) => human(id, -6 + i * 1.2, -6)),
  );
  const reg = new Map<string, ActionDef>([['walk_to', walkTo], ...CONSTRUCTION_ACTIONS.map((a) => [a.verb, a] as [string, ActionDef])]);
  return new Runtime(w, reg, { spatial: new Spatial(base) }, [...DEFAULT_INVARIANTS, uprightsSupported]);
}

function run(rt: Runtime, verb: string, params: unknown) {
  const r = rt.submit(verb, params);
  if (r.status === 'failed') return r;
  rt.runUntilIdle(20 * 120, [r.id]);
  return r;
}

function stageBeams(rt: Runtime) {
  // beams lie on the ground under their seats, along the bay (beam local x → world +z ⇒ yaw π/2)
  const x = D12 / 2;
  rt.world.entities.b1 = component('b1', 'beam-9ft', [-x, 0, L9 / 2], Math.PI / 2, { phase: 'staged' });
  rt.world.entities.b2 = component('b2', 'beam-9ft', [x, 0, L9 / 2], Math.PI / 2, { phase: 'staged' });
  rt.world.entities.b3 = component('b3', 'beam-9ft', [-x + 0.25, 0, L9 / 2], Math.PI / 2, { phase: 'staged' });
  rt.world.entities.b4 = component('b4', 'beam-9ft', [x - 0.25, 0, L9 / 2], Math.PI / 2, { phase: 'staged' });
}

test('supported bay: raise, hold, premature release refused, beams, stable release', () => {
  const rt = setup();
  const rA = run(rt, 'raise_upright', { crew: ['p1', 'p2'], item: 'A' });
  assert.equal(rA.status, 'completed', rA.diagnostic?.message);
  const A = rt.world.entities.A;
  assert.equal(A.pose.pitch, 0);
  assert.deepEqual(A.support, { kind: 'held', by: ['p1', 'p2'] });
  assert.equal(rt.world.entities.p1.human!.activity, 'support');
  assert.ok(rA.history.some((h) => h.phase === 'raise'));

  // holders cannot wander off; premature release refused with the missing connections named
  assert.equal(rt.submit('walk_to', { actor: 'p1', x: 5, z: 5 }).diagnostic?.code, 'actor.holding');
  const early = rt.submit('release_support', { item: 'A' });
  assert.equal(early.diagnostic?.code, 'support.release-premature');
  assert.match(early.diagnostic!.message, /not joined by beams/);

  assert.equal(run(rt, 'raise_upright', { crew: ['p3', 'p4'], item: 'B' }).status, 'completed');
  stageBeams(rt);
  // lower level on both columns
  // A has yaw π so its local "l" column is world +x; B's is world −x; planBeam matches columns across the flip
  for (const [beam, col] of [['b1', 'r'], ['b2', 'l']] as const) {
    const r = run(rt, 'connect_beam', { crew: ['p5', 'p6'], beam, a: 'A', b: 'B', column: col, height: 0.5 });
    assert.equal(r.status, "completed", `${r.status} ${r.phase} ${r.diagnostic?.message} ${JSON.stringify([...rt.records.values()].filter((x) => x.parent === r.id).map((x) => [x.status, x.phase, x.diagnostic?.message]))}`);
  }
  const mid = rt.submit('release_support', { item: 'A' });
  assert.equal(mid.diagnostic?.code, 'support.release-premature', 'one beam level is not enough for 12 ft frames');
  assert.match(mid.diagnostic!.message, /≥2 heights/);
  for (const [beam, col] of [['b3', 'r'], ['b4', 'l']] as const) {
    const r = run(rt, 'connect_beam', { crew: ['p5', 'p6'], beam, a: 'A', b: 'B', column: col, height: 1.8 });
    assert.equal(r.status, "completed", `${r.status} ${r.phase} ${r.diagnostic?.message} ${JSON.stringify([...rt.records.values()].filter((x) => x.parent === r.id).map((x) => [x.status, x.phase, x.diagnostic?.message]))}`);
  }
  assert.ok(groupStability(rt.world, A).stable);
  assert.equal(run(rt, 'release_support', { item: 'A' }).status, 'completed');
  assert.equal(run(rt, 'release_support', { item: 'B' }).status, 'completed');
  assert.equal(rt.world.entities.A.phase, 'installed');
  assert.equal(rt.world.entities.p1.human!.grip, undefined);
  assert.equal(run(rt, 'walk_to', { actor: 'p1', x: 5, z: -5 }).status, 'completed', 'released holders are free again');
  assert.deepEqual(rt.violations.map((v) => v.message), []);
});

test('raising arc blocked by an overhead obstacle is rejected and names it', () => {
  const roof: Obstacle = { id: 'shade', obb: { c: [0, -2], half: [2, 1], yaw: 0 }, y0: 2.4, y1: 2.6, kind: 'solid', label: 'shade structure' };
  const rt = setup([roof]);
  const r = rt.submit('raise_upright', { crew: ['p1', 'p2'], item: 'A' });
  assert.equal(r.diagnostic?.code, 'raise.arc-blocked');
  assert.match(r.diagnostic!.message, /shade structure/);
});

test('crew too small for a 19 ft upright; misaligned bay; unreachable seat height', () => {
  const rt = setup();
  rt.world.entities.T = component('T', 'upright-19ft', [8, 0, 8], 0, { phase: 'staged', pose: { p: [8, def('upright-19ft').size[2] / 2, 8], yaw: 0, pitch: LYING } });
  const t = rt.submit('raise_upright', { crew: ['p1', 'p2'], item: 'T' });
  assert.equal(t.diagnostic?.code, 'raise.crew-too-small');
  assert.match(t.diagnostic!.message, /at least 3/);
  run(rt, 'raise_upright', { crew: ['p1', 'p2'], item: 'A' });
  rt.world.entities.B.pose.p = [0.3, 0, L9]; // shifted sideways
  rt.world.entities.B.pose.pitch = 0;
  rt.world.entities.B.support = { kind: 'held', by: ['p3', 'p4'] };
  stageBeams(rt);
  assert.equal(rt.submit('connect_beam', { crew: ['p5', 'p6'], beam: 'b1', a: 'A', b: 'B', column: 'r', height: 0.5 }).diagnostic?.code, 'beam.misaligned');
  rt.world.entities.B.pose.p = [0, 0, L9];
  assert.equal(rt.submit('connect_beam', { crew: ['p5', 'p6'], beam: 'b1', a: 'A', b: 'B', column: 'r', height: 3.0 }).diagnostic?.code, 'reach.too-high');
});

test('cancel mid-raise is refused (would leave the frame unsupported)', () => {
  const rt = setup();
  const r = rt.submit('raise_upright', { crew: ['p1', 'p2'], item: 'A' });
  while (r.phase !== 'raise' && rt.isActive(r.id)) rt.step();
  for (let i = 0; i < 20; i++) rt.step();
  const c = rt.cancel(r.id);
  assert.equal(c.diagnostic?.code, 'raise.cancel-unsafe');
  assert.ok(rt.isActive(r.id));
  rt.runUntilIdle(2000, [r.id]);
  assert.equal(r.status, 'completed');
  assert.deepEqual(rt.violations, []);
});

// Regressions for the independent engine review (docs/engineering/REVIEW.md,
// findings C1–C3, H1, H2). Each test is derived from the review's proof script
// and asserts both that the physically impossible outcome no longer happens
// and that the correct diagnostic / behaviour occurs instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { Spatial } from '../spatial/service.ts';
import { emptyWorld, human, addAll, component } from '../world/factory.ts';
import { createRegistry, ENGINE_INVARIANTS } from '../api/registry.ts';
import type { SpatialScene } from '../spatial/types.ts';
import type { Entity } from '../world/types.ts';

const open = (half: number, obstacles: SpatialScene['obstacles'] = []): SpatialScene => ({
  bounds: [-half, -half, half, half],
  levels: [{ id: 0, y: 0, label: 'ground' }],
  surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [half, half], yaw: 0 } }],
  obstacles,
  links: [],
});
function engine(base: SpatialScene, ...es: Entity[]) {
  const w = addAll(emptyWorld('open', base), ...es);
  return new Runtime(w, createRegistry(), { spatial: new Spatial(base) }, ENGINE_INVARIANTS);
}
const codes = (rt: Runtime) => [...new Set(rt.violations.map((v) => v.code))];

test('C1: a mid-carry replan never flips the formation (no carrier teleports); teleports are an invariant violation', () => {
  const rt = engine(open(20), component('b', 'beam-12ft', [0, 0, 0], 0, { phase: 'staged' }), human('p1', -1, 2), human('p2', 1, -2));
  const rec = rt.submit('carry', { crew: ['p1', 'p2'], item: 'b', to: { x: 12, z: 0, yaw: 0 } });
  assert.equal(rec.status, 'executing');
  let n = 0;
  while (rt.isActive(rec.id) && !(rec.phase === 'move' && rt.world.entities.b.pose.p[0] > 1.0) && n++ < 4000) rt.step();
  const bx = rt.world.entities.b.pose.p[0];
  // construction elsewhere: a U of test-wall blocks ahead, open behind the crew
  let k = 0;
  const wall = (x: number, z: number) => {
    const id = `w${k++}`;
    rt.world.entities[id] = { ...component(id, 'test-wall', [x, 0, z], 0, { phase: 'stored' }), kind: 'fixture' };
  };
  for (let z = -4; z <= 4; z++) wall(bx + 4.5, z);
  for (let x = Math.floor(bx - 3); x <= bx + 4; x++) { wall(x, -4); wall(x, 4); }
  const pos = () => ['p1', 'p2'].map((id) => rt.world.entities[id].pose.p);
  let prev = pos(), worst = 0, replanned = false;
  for (let t = 0; t < 2400 && rt.isActive(rec.id); t++) {
    rt.step();
    if (rec.phase === 'replan') replanned = true;
    const cur = pos();
    worst = Math.max(worst, ...cur.map((p, i) => Math.hypot(p[0] - prev[i][0], p[2] - prev[i][2])));
    prev = cur;
  }
  assert.ok(replanned, 'construction forced a replan');
  assert.ok(worst < 0.2, `max carrier displacement per tick ${worst.toFixed(2)} m`);
  assert.equal(rec.status, 'completed');
  assert.deepEqual(codes(rt), []);

  // the generic invariant: a hand-made teleport is recorded as motion.teleport
  const rt2 = engine(open(10), human('p1', 0, 0));
  rt2.step();
  rt2.world.entities.p1.pose.p = [3, 0, 0];
  rt2.step();
  assert.deepEqual(codes(rt2), ['motion.teleport']);
  assert.match(rt2.violations[0].message, /p1 moved 3\.00 m in one tick/);
});

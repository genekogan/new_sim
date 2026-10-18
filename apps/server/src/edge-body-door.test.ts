// Lane N1 (2026-10-17): a Soul's birth look must never make it too wide for a standard door. Before the collider
// cap a seeded look could give radius 0.29-0.32 (about 1 in 40 births >= 0.29), and the planner (conservative raster +
// PLAN_MARGIN 0.06) refused it the Mars shower bays' 0.84 m doors: intermittent route.unreachable in the party,
// souls-r2 and mars-two e2es, decided by the random entity id. The widest look now collides as today's body.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { fixture, factory } from '../test/native-owner-fixture.ts';
import { GodMode } from './god/god.ts';
import { installEngineBridge } from './god/engine-bridge.ts';
import { HUMANOID_DIM_RANGES, humanoidProfile } from '../../../mars/viewer/engine/bodies/humanoid.ts';

type Route = { ok: boolean; route?: { length: number }; diagnostic?: { code: string; message: string } };
type Spatial = { route: (w: unknown, p: unknown, a: unknown, b: unknown, o: unknown) => Route };

test('the widest humanoid look routes into a Mars shower bay through its 0.84 m door', { timeout: 60000 }, async t => {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); f.db.close(); });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  installEngineBridge({ host: f.host, god, log: () => {} });
  const settle = async (n = 1) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  await settle(3);
  // the showers at their mars-two pose (worlds/templates/mars-two.json p [4.49, 0, -44.175], r -1.571) moved 30 m north
  // (whole raster cells) into the 60 m green field: bay 1's door gap is world x 2.85-3.69 at z -11.7
  const placed = god.act({ ops: [{ op: 'place', def: 'core/mars-showers@2', name: 'showers', p: [4.49, 0, -14.175], r: -1.571 }] });
  assert.equal(placed.accepted, true, JSON.stringify(placed));
  await settle(3);
  const rt = (f.host.engine as unknown as { rt: { world: unknown; services: { spatial: Spatial } } }).rt;
  const route = (profile: unknown) => rt.services.spatial.route(rt.world, profile, { level: 0, p: [3.27, -8.5] }, { level: 0, p: [3.27, -12.73] }, {});
  const hi = (k: keyof typeof HUMANOID_DIM_RANGES) => HUMANOID_DIM_RANGES[k][1];
  const widest = humanoidProfile({ family: 'humanoid', model: 'humanoid2-widest', params: { height: hi('height'), build: hi('build'), shoulders: hi('shoulders'), chest: hi('chest'), hips: hi('hips'), weight: hi('weight') } } as never);
  // measured here and on a fresh mars-two: the door's best raster clearance is 0.35 m, so bodies up to 0.289 pass and
  // 0.29 (planned at 0.35) is refused; the old cap 0.32 never passed
  const res = route(widest);
  assert.equal(res.ok, true, `widest look (radius ${widest.radius}): ${JSON.stringify(res.diagnostic)}`);
  assert.ok(widest.radius <= 0.28, `the widest look collides as today's body (${widest.radius})`);
});

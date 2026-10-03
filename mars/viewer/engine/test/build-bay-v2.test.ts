// Flagship reference sequence v2 (engine/scenarios/build-bay-v2.ts): v1's build plus a forklift-delivered
// sheet, a single-carrier stairs carry onto the finished deck, and a campfire ending that settles.
// bind → rehearse (isolated fork) → execute → the official run reproduces the rehearsal; canonical untouched.
// Also on a fork of Mars 2026 (staging-east), like campus-flagship.test.ts. v1 and its pins are untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashOf } from '../core/hash.ts';
import { WorldHistory } from '../history/store.ts';
import { Spatial } from '../spatial/service.ts';
import { Runtime } from '../runtime/runtime.ts';
import { SequenceRunner } from '../sequence/runner.ts';
import { emptyWorld } from '../world/factory.ts';
import { bindTemplate } from '../sequence/bind.ts';
import { rehearse, execute, type RehearsalResult } from '../rehearsal/rehearse.ts';
import { replayFinalState } from '../take/replay.ts';
import { readCampus2026File } from '../campus/node.ts';
import { cropScene } from '../campus/load.ts';
import { CAMPUS_ID, loadCampus2026 } from '../campus/world.ts';
import { def } from '../world/catalog.ts';
import { place } from '../scenarios/build-bay.ts';
import { buildBayV2Entities, buildBayV2Regions, buildBayV2Template, buildBayV2Bindings, buildBayV2Registry, BUILD_BAY_V2_INVARIANTS, BUILD_BAY_V2_CONTRIBUTORS, WANDER_S, type Site } from '../scenarios/build-bay-v2.ts';
import type { SpatialScene } from '../spatial/types.ts';
import type { StepSpec } from '../sequence/types.ts';
import type { WorldState } from '../world/types.ts';

const site: Site = { origin: [0, 0], yaw: 0 };
const ground = (): SpatialScene => ({
  bounds: [-20, -15, 15, 15],
  levels: [{ id: 0, y: 0, label: 'ground' }],
  surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [-2.5, 0], half: [17.5, 15], yaw: 0 } }],
  obstacles: [],
  links: [],
});
const cfgFor = (scene: () => SpatialScene, baseId?: string) => ({
  registry: buildBayV2Registry(),
  invariants: BUILD_BAY_V2_INVARIANTS,
  services: () => ({ spatial: new Spatial(scene(), { contributors: BUILD_BAY_V2_CONTRIBUTORS, ...(baseId ? { baseId } : {}) }) }),
});
function stage(w: WorldState, s: Site) {
  for (const e of buildBayV2Entities(s)) w.entities[e.id] = e;
  for (const r of buildBayV2Regions(s)) w.regions[r.id] = r;
  return w;
}
const HUMANS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'visitor', 'g1', 'g2', 'g3', 'w1', 'w2'];
const RING = ['p3', 'p4', 'p5', 'p6', 'visitor', 'g1', 'g2', 'g3'];

/** Everything the brief asks of a v2 run, from the report + take alone. */
function checkRun(reh: RehearsalResult) {
  const bad = reh.report.steps.filter((s) => s.status !== 'completed');
  assert.equal(reh.report.status, 'completed', JSON.stringify(bad.slice(0, 2)).slice(0, 800));
  assert.deepEqual(reh.report.violations, []);
  assert.ok(reh.report.settled, reh.report.unsettled.join('; '));
  const final = replayFinalState(reh.take);
  const E = final.entities;
  const deckY = E.s1.pose.p[1] + def('plywood-4x6').size[1]; // top of the installed sheets
  // (a) s2 rode the forks, then was installed
  const ev = reh.take.events.filter((e) => e.type === 'action') as { t: number; id: string; status: string; phase?: string }[];
  const phases = (id: string) => new Set(ev.filter((e) => e.id === `step:${id}`).map((e) => e.phase));
  for (const ph of ['ride', 'lower', 'creep', 'raise']) assert.ok(phases('fk_pick').has(ph), `fk_pick phase ${ph}`);
  for (const ph of ['ride', 'square', 'lower', 'back-off']) assert.ok(phases('fk_deliver').has(ph), `fk_deliver phase ${ph}`);
  const s2Support = reh.take.changes.filter((c) => c[1] === 's2' && c[2] === 'support').map((c) => (c[3] as { kind: string; vehicle?: string }));
  assert.ok(s2Support.some((s) => s.kind === 'forks' && s.vehicle === 'fk'), 's2 was on the forks of fk');
  assert.equal(E.s2.phase, 'installed');
  assert.equal(E.fk.support?.kind, 'ground', 'forklift parked (dismounted)');
  // (b) the spare tread lies on the deck (level-4 floor, on s2 / s1), carried up the stair by p1
  assert.equal(E.t11.phase, 'staged');
  assert.ok(Math.abs(E.t11.pose.p[1] - deckY) < 0.01, `t11 at y ${E.t11.pose.p[1]} (deck ${deckY})`);
  assert.equal(reh.report.steps.find((s) => s.id === 'carry_spare')!.status, 'completed');
  // (c) all 8 fire places held at once ('gathered' = every live member occupied), two sat, then all released
  const fire = reh.report.steps.find((s) => s.id === 'fire')!;
  assert.deepEqual([...(fire.outputs!.seated as string[])].sort(), [...RING].sort());
  assert.deepEqual(fire.outputs!.unseated, []);
  assert.ok(phases('fire').has('gathered'), 'the fire circle was complete');
  const sat = new Set(reh.take.changes.filter((c) => c[2] === 'activity' && c[3] === 'sit').map((c) => c[1]));
  assert.deepEqual([...sat].sort(), ['p1', 'p2']);
  const warmed = new Set(reh.take.changes.filter((c) => c[2] === 'activity' && c[3] === 'warm').map((c) => c[1]));
  assert.deepEqual([...warmed].sort(), [...RING].sort());
  const gathered = ev.find((e) => e.id === 'step:fire' && e.phase === 'gathered')!;
  const wander = reh.report.steps.find((s) => s.id === 'wander')!;
  assert.ok((wander.outputs!.walks as number) >= 2, `wanderers walked ${wander.outputs!.walks}×`);
  for (const h of HUMANS) {
    assert.equal(E[h].human!.activity, 'idle', `${h} ends idle`);
    assert.equal(E[h].human!.task, undefined, `${h} ends with no task`);
  }
  return { final, gatheredT: gathered.t, wanderEnd: wander.endedTick! - reh.take.startTick };
}

test('flagship v2: forklift sheet, stairs carry, campfire ending — rehearse, execute, canonical untouched', () => {
  const h = new WorldHistory('mars-rules/flagship-v2-test');
  h.publishCanonical('canon', 'Open ground (canonical fixture)', stage(emptyWorld('open-ground', ground()), site), 'flagship v2 fixture');
  h.fork('canon', 'ws', 'build workspace');
  const tpl = buildBayV2Template(site);
  const plan = bindTemplate(tpl, buildBayV2Bindings, { history: h, baseline: 'ws', registry: buildBayV2Registry() });
  const t0 = performance.now();
  const reh = rehearse(h, 'ws', plan, cfgFor(ground));
  const ms = performance.now() - t0;
  const { final, gatheredT, wanderEnd } = checkRun(reh);
  console.log(`flagship v2 rehearsal: ${tpl.steps.length} steps, ${(reh.take.ticks / 20).toFixed(1)} s simulated, ${ms.toFixed(0)} ms compute; fire circle complete at ${(gatheredT / 20).toFixed(1)} s, stands from ${(wanderEnd / 20).toFixed(1)} s (wander ${WANDER_S} s)`);
  assert.equal(h.head('ws').id, h.head('canon').id, 'rehearsal did not touch the workspace');
  const ex = execute(h, 'ws', plan, cfgFor(ground));
  assert.ok(ex.ok, JSON.stringify(ex).slice(0, 400));
  assert.equal(hashOf(replayFinalState(ex.take)), hashOf(final), 'official run reproduces the rehearsal exactly');
  assert.notEqual(h.head('ws').id, h.head('canon').id);
  const canon = h.read('canon').entities;
  assert.equal(canon.A.phase, 'stored', 'canonical state untouched');
  assert.equal(canon.s2.phase, 'stored');
  assert.equal(canon.t11.phase, 'stored');
});

test('flagship v2 layout: the forklift cannot stage s2 on the half-built deck (so it stages it beside the bay)', () => {
  // run v1's build up to "s1 installed, s2 on the forks", then ask for the deck placement the brief wanted
  const tpl = buildBayV2Template(site);
  const by = new Map(tpl.steps.map((s) => [s.id, s]));
  const need = new Set<string>();
  const add = (id: string) => { if (need.has(id)) return; need.add(id); for (const d of by.get(id)!.after ?? []) add(d); };
  add('fk_pick'); add('deck_s1');
  const h = new WorldHistory('mars-rules/flagship-v2-test');
  h.publishCanonical('canon', 'open ground', stage(emptyWorld('open-ground', ground()), site), 'fixture');
  const plan = bindTemplate({ ...tpl, steps: tpl.steps.filter((s) => need.has(s.id)) }, buildBayV2Bindings, { history: h, baseline: 'canon', registry: buildBayV2Registry() });
  const cfg = cfgFor(ground);
  const w = h.read('canon');
  const rt = new Runtime(w, cfg.registry, cfg.services(), cfg.invariants);
  const res = new SequenceRunner(rt, plan.steps as StepSpec[]).run();
  assert.equal(res.status, 'completed');
  assert.equal(rt.world.entities.s2.support?.kind, 'forks');
  // s1's footprint is the only level-4 surface; a sheet goes on long side first (fork reach 1.4 m < 1.83 m)
  const on = place(site, 0, 0.15 + def('plywood-4x6').size[2] / 2, 0);
  const a = rt.submit('forklift_deliver', { operator: 'p6', to: { x: on.x, z: on.z, yaw: on.yaw, level: 4 } });
  assert.equal(a.status, 'failed');
  assert.equal(a.diagnostic?.code, 'forklift.no-approach', a.diagnostic?.message);
  console.log(`  deck staging refused: ${a.diagnostic!.message.slice(0, 260)}`);
});

test('flagship v2 on Mars 2026: fork canonical, build at staging-east, canonical untouched', () => {
  const file = readCampus2026File();
  const { base, world } = loadCampus2026(file, { flagshipInventory: false });
  const st = world.regions['staging-east'];
  const xs = st.polygon.map((p) => p[0]), zs = st.polygon.map((p) => p[1]);
  const s: Site = { origin: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2], yaw: 0, groundY: base.meta.groundY };
  const local = cropScene(base, [s.origin[0] - 40, s.origin[1] - 40, s.origin[0] + 40, s.origin[1] + 40]);
  const h = new WorldHistory('mars-rules/flagship-v2-campus-test');
  h.publishCanonical(CAMPUS_ID, 'Mars 2026 (canonical)', world, 'test');
  h.fork(CAMPUS_ID, 'build', 'flagship v2 build (hypothetical)');
  h.commit('build', stage(h.read('build'), s), { kind: 'design-edit', note: 'flagship v2 piles, crew, forklift, campfire at staging-east (hypothetical)' });
  const cfg = cfgFor(() => local, file.contentHash);
  const plan = bindTemplate(buildBayV2Template(s), buildBayV2Bindings, { history: h, baseline: 'build', registry: buildBayV2Registry() });
  const t0 = performance.now();
  const reh = rehearse(h, 'build', plan, cfg);
  const ms = performance.now() - t0;
  const { final } = checkRun(reh);
  console.log(`campus flagship v2: ${plan.steps.length} steps, ${(reh.take.ticks / 20).toFixed(1)} s simulated, ${ms.toFixed(0)} ms compute, take ${JSON.stringify(reh.take).length} bytes`);
  const ex = execute(h, 'build', plan, cfg);
  assert.ok(ex.ok, JSON.stringify(ex).slice(0, 300));
  assert.equal(hashOf(replayFinalState(ex.take)), hashOf(final));
  assert.equal(h.read(CAMPUS_ID).entities.fk, undefined, 'canonical 2026 has no v2 inventory');
  assert.equal(h.log(CAMPUS_ID).length, 1);
});

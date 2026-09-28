// Flagship reference sequence v3 (engine/scenarios/build-bay-v3.ts): v2's build with the deck handed up —
// seven joists and sheet s1 handed up by the ground crew to people standing on the rack beams, sheet s2
// taken off the forklift's forks by two standing on s1 — then v2's stair, spare tread and campfire ending.
// bind → rehearse (isolated fork) → execute → the official run reproduces the rehearsal; canonical untouched.
// Open ground only (the campus variant is not part of v3). v1 / v2 and their pins are untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashOf } from '../core/hash.ts';
import { WorldHistory } from '../history/store.ts';
import { Spatial } from '../spatial/service.ts';
import { emptyWorld } from '../world/factory.ts';
import { bindTemplate } from '../sequence/bind.ts';
import { rehearse, execute } from '../rehearsal/rehearse.ts';
import { replayFinalState } from '../take/replay.ts';
import { def } from '../world/catalog.ts';
import { supportProblems } from '../construction/deck.ts';
import { deckSurfaces } from '../construction/contributor.ts';
import { buildBayV3Entities, buildBayV3Regions, buildBayV3Template, buildBayV3Bindings, buildBayV3Registry, BUILD_BAY_V3_INVARIANTS, BUILD_BAY_V3_CONTRIBUTORS, V3_JOISTS, type Site } from '../scenarios/build-bay-v3.ts';
import type { SpatialScene } from '../spatial/types.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';
import { clearanceAt } from '../spatial/grid.ts';
import { component } from '../world/factory.ts';
import { spatialOf } from '../construction/access.ts';
import { STEP_OFF_SEARCH } from '../construction/framemove.ts';
import { dist2 } from '../core/math.ts';
import { bay, run } from './frame-fixtures.ts';
import type { WorldState } from '../world/types.ts';

const site: Site = { origin: [0, 0], yaw: 0 };
const ground = (): SpatialScene => ({
  bounds: [-20, -15, 15, 15],
  levels: [{ id: 0, y: 0, label: 'ground' }],
  surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [-2.5, 0], half: [17.5, 15], yaw: 0 } }],
  obstacles: [],
  links: [],
});
const cfg = {
  registry: buildBayV3Registry(),
  invariants: BUILD_BAY_V3_INVARIANTS,
  services: () => ({ spatial: new Spatial(ground(), { contributors: BUILD_BAY_V3_CONTRIBUTORS }) }),
};
function stage(w: WorldState) {
  for (const e of buildBayV3Entities(site)) w.entities[e.id] = e;
  for (const r of buildBayV3Regions(site)) w.regions[r.id] = r;
  return w;
}
const HUMANS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'visitor', 'g1', 'g2', 'g3', 'w1', 'w2'];
/** Pinned: final-state hash and length of the v3 rehearsal (open ground). Re-pinned (was 17288 ticks,
 *  584685f1…fd588): splined turns + immediate block reaction, 2026-09-28; re-pinned (was 16191 ticks, e121377d…24b9):
 *  kneel rule at the edge (W8 patch), 2026-09-28; re-pinned (was 16248 ticks, 0870c583…946a): body model
 *  unification, 2026-09-28 (PLANNING_BUDGET.md); re-pinned (was 16219 ticks, 339cf310…ad1e): body model = measured
 *  rig, 2026-09-28 (PLANNING_BUDGET.md); re-pinned (was 16237 ticks, 5f32379d…0c73): walker fallback + hypot + encounters on the smoothed path, 2026-09-28
 *  (PLANNING_BUDGET.md); re-pinned (was 16230 ticks, 66800edc…f8d5): no walker jumps: snaps walked, teleport 0.15 m, overspeed invariant, 2026-09-28 (PLANNING_BUDGET.md); re-pinned (was 16401 ticks,
 *  a2f782ad…6e38): v3 step-off spot searched (origin-independent) + the spare tread laid clear of the s1/s2 corner,
 *  2026-09-29 (W27, PLANNING_BUDGET.md); 0 violations, same outcome. */
const PIN = { ticks: 16374, hash: '39a0fb3f4d24d07786be3059ab806cd39de138a35ef3f9d02e291229b087c2ba' };

test('flagship v3: deck handed up (joists + s1 by hand to two on the beams, s2 off the forklift), 0 violations, rehearse = execute, pinned', () => {
  const h = new WorldHistory('mars-rules/flagship-v3-test');
  h.publishCanonical('canon', 'Open ground (canonical fixture)', stage(emptyWorld('open-ground', ground())), 'flagship v3 fixture');
  h.fork('canon', 'ws', 'build workspace');
  const tpl = buildBayV3Template(site);
  const plan = bindTemplate(tpl, buildBayV3Bindings, { history: h, baseline: 'ws', registry: buildBayV3Registry() });
  const t0 = performance.now();
  const reh = rehearse(h, 'ws', plan, cfg);
  const ms = performance.now() - t0;
  const bad = reh.report.steps.filter((s) => s.status !== 'completed');
  assert.equal(reh.report.status, 'completed', JSON.stringify(bad.slice(0, 2)).slice(0, 800));
  assert.deepEqual(reh.report.violations, []);
  assert.ok(reh.report.settled, reh.report.unsettled.join('; '));
  const final = replayFinalState(reh.take);
  const E = final.entities;
  // the deck: 7 joists and 2 sheets installed with complete support chains; one walkable deck at 1.99 m
  for (const [j] of V3_JOISTS) assert.equal(E[j].phase, 'installed', j);
  for (const s of ['s1', 's2']) {
    assert.equal(E[s].phase, 'installed', s);
    assert.deepEqual(supportProblems(final, E[s]), [], s);
  }
  assert.equal(deckSurfaces(final).length, 2);
  assert.ok(Math.abs(E.s1.pose.p[1] + def('plywood-4x6').size[1] - 1.99) < 0.01);
  // hand-up evidence in the take: grips per role, activities per phase
  const changes = reh.take.changes;
  const slots = (id: string) => new Set(changes.filter((c) => c[1] === id && c[2] === 'grip' && c[3]).map((c) => `${(c[3] as { entity: string }).entity}|${(c[3] as { slot: string }).slot.replace(/:.*$/, '')}`));
  const acts = (id: string) => new Set(changes.filter((c) => c[1] === id && c[2] === 'activity').map((c) => c[3] as string));
  for (const [k, [j]] of V3_JOISTS.entries()) {
    assert.ok(slots(`p${(k % 2) + 1}`).has(`${j}|handup-give-0`), `${j} given by p${(k % 2) + 1}`);
    assert.ok(slots('p5').has(`${j}|handup-take-0`), `${j} received by p5`);
  }
  for (const g of ['p3', 'p4']) assert.ok([...slots(g)].some((s) => s.startsWith('s1|handup-give')), `${g} gave s1`);
  for (const r of ['p5', 'p6']) for (const s of ['s1', 's2']) assert.ok([...slots(r)].some((x) => x.startsWith(`${s}|handup-take`)), `${r} received ${s}`);
  for (const a of ['crouch', 'lift', 'walk-load', 'reach_up']) assert.ok(acts('p3').has(a), `p3 ${a}`);
  for (const a of ['climb-up', 'beam-walk', 'reach_down', 'take', 'stand_with_load', 'lay', 'set_down', 'fasten', 'step-off']) assert.ok(acts('p5').has(a) || acts('p6').has(a), `receivers ${a}`);
  const s2Support = changes.filter((c) => c[1] === 's2' && c[2] === 'support').map((c) => c[3] as { kind: string; vehicle?: string; by?: string[] });
  assert.ok(s2Support.some((s) => s.kind === 'forks' && s.vehicle === 'fk'), 's2 rode the forks');
  assert.ok(s2Support.some((s) => s.kind === 'held' && [...(s.by ?? [])].sort().join() === 'p5,p6'), 's2 taken off the forks by p5 and p6');
  const onBeam = new Set(changes.filter((c) => c[2] === 'level' && c[3] === 4).map((c) => c[1]));
  assert.ok(onBeam.has('p5') && onBeam.has('p6'), 'both receivers got up onto the structure');
  // v2's ending
  assert.equal(E.t11.phase, 'staged');
  assert.equal(E.fk.support?.kind, 'ground', 'forklift parked (dismounted)');
  for (const x of HUMANS) {
    assert.equal(E[x].human!.activity, 'idle', `${x} ends idle`);
    assert.equal(E[x].human!.task, undefined, `${x} ends with no task`);
    assert.equal(E[x].human!.on, undefined, `${x} ends off the structure`);
  }
  const hash = hashOf(final);
  console.log(`flagship v3 rehearsal: ${tpl.steps.length} steps, ${reh.take.ticks} ticks = ${(reh.take.ticks / 20).toFixed(1)} s simulated, ${ms.toFixed(0)} ms compute, final ${hash}`);
  assert.equal(reh.take.ticks, PIN.ticks, 'pinned length');
  assert.equal(hash, PIN.hash, 'pinned final state');
  assert.equal(h.head('ws').id, h.head('canon').id, 'rehearsal did not touch the workspace');
  const ex = execute(h, 'ws', plan, cfg);
  assert.ok(ex.ok, JSON.stringify(ex).slice(0, 400));
  assert.equal(hashOf(replayFinalState(ex.take)), hash, 'official run reproduces the rehearsal exactly');
  const canon = h.read('canon').entities;
  assert.equal(canon.s1.phase, 'stored', 'canonical state untouched');
  assert.equal(canon.j7.phase, 'stored');
});

// Origin independence (W27): the grid's clearance is a cell-centre value on the global 0.1 m lattice, so the same site-local
// spot reads differently wherever the site sits on it. At these open-ground origins v3 used to fail: (28, −9, ground −0.16)
// is staging-east's site, where crew[4]'s step-off target on s2 reads 0.25 m < 0.28 m (`beam.no-room`; beam_walk now
// lands on the nearest spot with room, framemove.ts stepOffSpot); (0.07, 0.03) put the spare tread's end load disc
// within its radius of the s1/s2 corner (`carry_spare` refused; the tread now lies on s2's axis, V3_LAYOUT.spareDeck).
test('flagship v3 is origin-independent: completes with 0 violations at open-ground origins that used to fail (step-off target reading 0.25 m; spare tread at the s1/s2 corner)', () => {
  for (const [ox, oz, gy] of [[28, -9, -0.16], [0.07, 0.03, 0]] as const) {
    const at: Site = { origin: [ox, oz], yaw: 0, groundY: gy };
    const g = (): SpatialScene => ({ bounds: [ox - 20, oz - 15, ox + 15, oz + 15], levels: [{ id: 0, y: gy, label: 'ground' }], surfaces: [{ id: 'ground', level: 0, y: gy, obb: { c: [ox - 2.5, oz], half: [17.5, 15], yaw: 0 } }], obstacles: [], links: [] });
    const h = new WorldHistory('mars-rules/flagship-v3-origin');
    const w = emptyWorld('open-ground', g());
    for (const e of buildBayV3Entities(at)) w.entities[e.id] = e;
    for (const r of buildBayV3Regions(at)) w.regions[r.id] = r;
    h.publishCanonical('canon', 'Open ground', w, 'v3 origin fixture');
    h.fork('canon', 'ws', 'build workspace');
    const registry = buildBayV3Registry();
    const plan = bindTemplate(buildBayV3Template(at), buildBayV3Bindings, { history: h, baseline: 'ws', registry });
    const reh = rehearse(h, 'ws', plan, { registry, invariants: BUILD_BAY_V3_INVARIANTS, services: () => ({ spatial: new Spatial(g(), { contributors: BUILD_BAY_V3_CONTRIBUTORS }) }) });
    const bad = reh.report.steps.filter((x) => x.status !== 'completed');
    assert.equal(reh.report.status, 'completed', `origin (${ox}, ${oz}): ${JSON.stringify(bad.slice(0, 2)).slice(0, 600)}`);
    assert.deepEqual(reh.report.violations, [], `origin (${ox}, ${oz})`);
    const E = reh.finalState.entities;
    for (const s of ['s1', 's2']) assert.equal(E[s].phase, 'installed', `${s} at (${ox}, ${oz})`);
    assert.equal(E.t11.phase, 'staged');
    assert.equal(E.t11.support?.kind, 'ground');
    assert.ok(E.t11.pose.p[1] > gy + 1.9, 't11 lies on the deck');
    console.log(`flagship v3 at origin (${ox}, ${oz}, ground ${gy}): ${reh.take.ticks} ticks, 0 violations`);
  }
});

test('beam_walk step-off: a deck target whose cell reads < 0.28 m lands on the nearest spot with room within 0.15 m; a target truly at the edge is still refused (beam.no-room)', () => {
  const setup = () => {
    const { rt, E, top } = bay({ seat: 1.8, joists: [0.25, 0.71, 1.17, 1.6] });
    const s = component('s1', 'plywood-4x6', [0, top + def('2x4-6ft').size[1], 0.71], 0, { phase: 'installed' }); // deck z 0.1–1.32
    s.support = { kind: 'resting-on', on: 'j1' };
    s.connections = ['j1', 'j2', 'j3'].map((j) => ({ socket: 'bears-on', to: j, toSocket: 'deck' }));
    rt.world.entities.s1 = s;
    run(rt, 'climb_frame', { actor: 'p1', link: 'climb:B:r@1.83', dir: 'up' });
    run(rt, 'beam_walk', { actor: 'p1', x: 0.61, z: 1.8 });
    const sp = spatialOf(rt);
    sp.sync(rt.world);
    return { rt, E, g: sp.level(4)! };
  };
  {
    // 0.28 m from the deck's north edge: its cell reads 0.25 m at this origin
    const { rt, E, g } = setup();
    assert.ok(clearanceAt(g, [0.3, 1.04]) < HUMAN_PROFILE.radius);
    run(rt, 'beam_walk', { actor: 'p1', x: 0.3, z: 1.04 });
    const at: [number, number] = [E.p1.pose.p[0], E.p1.pose.p[2]];
    assert.equal(E.p1.human!.level, 4);
    assert.equal(E.p1.human!.on, undefined);
    assert.ok(dist2(at, [0.3, 1.04]) <= STEP_OFF_SEARCH + 1e-9, `landed ${at}`);
    assert.ok(clearanceAt(g, at) >= HUMAN_PROFILE.radius);
    assert.deepEqual(rt.violations, []);
  }
  {
    // 0.12 m from the edge: no spot with room within 0.15 m — refused, naming the deck
    const { rt } = setup();
    const r = rt.submit('beam_walk', { actor: 'p1', x: 0.3, z: 1.2 });
    assert.equal(r.diagnostic?.code, 'beam.no-room');
    assert.match(r.diagnostic!.message, /no room to stand at \(0\.30, 1\.20\) on deck .*no spot with room within 0\.15 m/);
  }
});

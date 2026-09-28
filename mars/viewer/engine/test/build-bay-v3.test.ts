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
/** Pinned: final-state hash and length of the v3 rehearsal (open ground). */
const PIN = { ticks: 17288, hash: '584685f13886b4c2683a015e6a96c9eeb4f0a324e45142a3d7aef8edd37fd588' };

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

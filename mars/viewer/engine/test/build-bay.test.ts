// Flagship reference sequence end to end: bind → rehearse (isolated fork) →
// execute on the workspace → take → replay; canonical stays untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashOf } from '../core/hash.ts';
import { WorldHistory } from '../history/store.ts';
import { Spatial } from '../spatial/service.ts';
import { emptyWorld, addAll } from '../world/factory.ts';
import { bindTemplate } from '../sequence/bind.ts';
import { rehearse, execute } from '../rehearsal/rehearse.ts';
import { replayFinalState } from '../take/replay.ts';
import { buildBayEntities, buildBayTemplate, buildBayBindings, buildBayRegistry, BUILD_BAY_INVARIANTS, BUILD_BAY_CONTRIBUTORS, type Site } from '../scenarios/build-bay.ts';
import type { SpatialScene } from '../spatial/types.ts';

const RULES = 'mars-rules/flagship-test';
const site: Site = { origin: [0, 0], yaw: 0 };
const ground = (): SpatialScene => ({
  bounds: [-20, -15, 15, 15],
  levels: [{ id: 0, y: 0, label: 'ground' }],
  surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [-2.5, 0], half: [17.5, 15], yaw: 0 } }],
  obstacles: [],
  links: [],
});
const config = () => ({
  registry: buildBayRegistry(),
  invariants: BUILD_BAY_INVARIANTS,
  services: () => ({ spatial: new Spatial(ground(), { contributors: BUILD_BAY_CONTRIBUTORS }) }),
});

function history() {
  const h = new WorldHistory(RULES);
  h.publishCanonical('canon', 'Open ground (canonical fixture)', addAll(emptyWorld('open-ground', ground()), ...buildBayEntities(site)), 'flagship fixture');
  h.fork('canon', 'ws', 'build workspace');
  return h;
}

test('flagship: rehearse the full build from material piles, then execute it', () => {
  const h = history();
  const tpl = buildBayTemplate(site);
  const plan = bindTemplate(tpl, buildBayBindings, { history: h, baseline: 'ws', registry: buildBayRegistry() });
  const t0 = performance.now();
  const reh = rehearse(h, 'ws', plan, config());
  const ms = performance.now() - t0;
  const bad = reh.report.steps.filter((s: { status: string }) => s.status !== 'completed');
  assert.equal(reh.report.status, 'completed', JSON.stringify(bad.slice(0, 3)));
  assert.deepEqual(reh.report.violations, []);
  const final = replayFinalState(reh.take);
  assert.equal(final.entities.A.phase, 'installed');
  assert.equal(final.entities.s2.phase, 'installed');
  assert.equal(final.entities.visitor.human!.level, 4, 'visitor ends up on the new deck');
  console.log(`flagship rehearsal: ${tpl.steps.length} steps, ${(reh.take.ticks / 20).toFixed(1)} s simulated, ${ms.toFixed(0)} ms compute`);
  // rehearsal did not touch the workspace
  assert.equal(h.head('ws').id, h.head('canon').id);
  const ex = execute(h, 'ws', plan, config());
  assert.ok(ex.ok, JSON.stringify(ex).slice(0, 400));
  assert.equal(hashOf(replayFinalState(ex.take)), hashOf(final), 'official run reproduces the rehearsal exactly');
  assert.notEqual(h.head('ws').id, h.head('canon').id);
  assert.equal(h.read('canon').entities.A.phase, 'stored', 'canonical state untouched');
});

// The flagship build on the real 2026 campus: a fork of canonical Mars 2026,
// build site inside the verified `staging-east` clearing east of Chiba.
// Hypothetical (spec §4): it demonstrates the engine, not a documented build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashOf } from '../core/hash.ts';
import { WorldHistory } from '../history/store.ts';
import { Spatial } from '../spatial/service.ts';
import { bindTemplate } from '../sequence/bind.ts';
import { rehearse, execute } from '../rehearsal/rehearse.ts';
import { replayFinalState } from '../take/replay.ts';
import { readCampus2026File } from '../campus/node.ts';
import { cropScene } from '../campus/load.ts';
import { CAMPUS_ID, loadCampus2026 } from '../campus/world.ts';
import { buildBayEntities, buildBayTemplate, buildBayBindings, buildBayRegistry, BUILD_BAY_INVARIANTS, BUILD_BAY_CONTRIBUTORS, type Site } from '../scenarios/build-bay.ts';

const RULES = 'mars-rules/flagship-campus-test';

test('flagship on Mars 2026: fork canonical, build a rack bay at staging-east, canonical untouched', () => {
  const file = readCampus2026File();
  const { base, world } = loadCampus2026(file, { flagshipInventory: false });
  const st = world.regions['staging-east'];
  assert.ok(st, 'staging-east region present');
  const xs = st.polygon.map((p) => p[0]), zs = st.polygon.map((p) => p[1]);
  const site: Site = { origin: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2], yaw: 0, groundY: base.meta.groundY };
  const local = cropScene(base, [site.origin[0] - 40, site.origin[1] - 40, site.origin[0] + 40, site.origin[1] + 40]);

  const h = new WorldHistory(RULES);
  h.publishCanonical(CAMPUS_ID, 'Mars 2026 (canonical)', world, 'test');
  h.fork(CAMPUS_ID, 'build', 'flagship build (hypothetical)');
  const w = h.read('build');
  for (const e of buildBayEntities(site)) w.entities[e.id] = e;
  h.commit('build', w, { kind: 'design-edit', note: 'flagship piles + crew at staging-east (hypothetical)' });

  const cfg = { registry: buildBayRegistry(), invariants: BUILD_BAY_INVARIANTS, services: () => ({ spatial: new Spatial(local, { contributors: BUILD_BAY_CONTRIBUTORS, baseId: file.contentHash }) }) };
  const plan = bindTemplate(buildBayTemplate(site), buildBayBindings, { history: h, baseline: 'build', registry: buildBayRegistry() });
  const t0 = performance.now();
  const reh = rehearse(h, 'build', plan, cfg);
  const ms = performance.now() - t0;
  const bad = reh.report.steps.filter((s: { status: string }) => s.status !== 'completed');
  assert.equal(reh.report.status, 'completed', JSON.stringify(bad.slice(0, 2)).slice(0, 600));
  assert.deepEqual(reh.report.violations, []);
  const final = replayFinalState(reh.take);
  assert.equal(final.entities.visitor.human!.level > 0, true, 'visitor on the new deck');
  console.log(`campus flagship: ${plan.steps.length} steps, ${(reh.take.ticks / 20).toFixed(1)} s simulated, ${ms.toFixed(0)} ms compute, take ${JSON.stringify(reh.take).length} bytes`);
  const ex = execute(h, 'build', plan, cfg);
  assert.ok(ex.ok, JSON.stringify(ex).slice(0, 300));
  assert.equal(hashOf(replayFinalState(ex.take)), hashOf(final));
  assert.equal(h.read(CAMPUS_ID).entities.A, undefined, 'canonical 2026 has no flagship parts');
  assert.equal(h.log(CAMPUS_ID).length, 1);
});

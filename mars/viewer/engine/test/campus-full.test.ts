// The campus flagship on the FULL, uncropped 2026 scene (all 7.6k obstacles, whole-campus bounds
// and grids) instead of the ±40 m cropScene around staging-east that campus-flagship.test.ts uses.
// Same fork, piles, crew, template and rules. Hypothetical build (spec §4).
//
// History: on 2026-09-27 the full run ended physically identical to the cropped run but NOT
// bit-identical (36 more ticks): route vertices snapped to cell centres were computed from the grid
// origin (x0 + (i + 0.5)·cell, with x0 −12 cropped vs −162 full), so the same cell's centre differed
// in the last ulps (17.05 vs 17.05000000000001) and those ulps later flipped tick-level decisions.
// Since 2026-09-28 every grid sits on one global lattice (spatial/grid.ts: cell (i, j) is lattice
// cell (ox + i, oz + j), centre (k + 0.5)·cell), so the crop no longer changes any coordinate and
// the full run is bit-identical to the cropped one (same final-state hash, same tick count).
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
import type { CampusScene } from '../campus/types.ts';
import { CAMPUS_ID, loadCampus2026 } from '../campus/world.ts';
import { buildBayEntities, buildBayTemplate, buildBayBindings, buildBayRegistry, BUILD_BAY_INVARIANTS, BUILD_BAY_CONTRIBUTORS, type Site } from '../scenarios/build-bay.ts';

const RULES = 'mars-rules/flagship-campus-test';
/** campus-flagship (staging-east crop) final state; also pinned in grid-incremental.test.ts. */
const CROPPED_HASH = '42dec8e8f37152e61463e97fe1ef10c4dee4b6d38bb523d24b24c5144a5dde61';

function setup() {
  const file = readCampus2026File();
  const { base, world } = loadCampus2026(file, { flagshipInventory: false });
  const st = world.regions['staging-east'];
  assert.ok(st, 'staging-east region present');
  const xs = st.polygon.map((p) => p[0]), zs = st.polygon.map((p) => p[1]);
  const site: Site = { origin: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2], yaw: 0, groundY: base.meta.groundY };
  const h = new WorldHistory(RULES);
  h.publishCanonical(CAMPUS_ID, 'Mars 2026 (canonical)', world, 'test');
  h.fork(CAMPUS_ID, 'build', 'flagship build (hypothetical)');
  const w = h.read('build');
  for (const e of buildBayEntities(site)) w.entities[e.id] = e;
  h.commit('build', w, { kind: 'design-edit', note: 'flagship piles + crew at staging-east (hypothetical)' });
  return { file, base, site, h };
}

function flagship(scene: (base: CampusScene, site: Site) => CampusScene) {
  const { file, base, site, h } = setup();
  const s = scene(base, site);
  const cfg = { registry: buildBayRegistry(), invariants: BUILD_BAY_INVARIANTS, services: () => ({ spatial: new Spatial(s, { contributors: BUILD_BAY_CONTRIBUTORS, baseId: file.contentHash }) }) };
  const plan = bindTemplate(buildBayTemplate(site), buildBayBindings, { history: h, baseline: 'build', registry: buildBayRegistry() });
  const t0 = performance.now();
  const reh = rehearse(h, 'build', plan, cfg);
  const ms = performance.now() - t0;
  return { h, cfg, plan, reh, ms, scene: s };
}

let memo: { crop: ReturnType<typeof flagship>; full: ReturnType<typeof flagship> } | null = null;
function both() {
  if (memo) return memo;
  const crop = flagship((base, site) => cropScene(base, [site.origin[0] - 40, site.origin[1] - 40, site.origin[0] + 40, site.origin[1] + 40]));
  const full = flagship((base) => base);
  console.log(`campus full: ${full.scene.obstacles.length} obstacles, bounds ${full.scene.bounds.join(',')}; crop: ${crop.scene.obstacles.length} obstacles, bounds ${crop.scene.bounds.join(',')}`);
  console.log(`campus full: ${full.plan.steps.length} steps, ${(full.reh.take.ticks / 20).toFixed(1)} s simulated, ${full.ms.toFixed(0)} ms compute, final ${full.reh.take.finalStateHash}`);
  console.log(`campus crop: ${crop.plan.steps.length} steps, ${(crop.reh.take.ticks / 20).toFixed(1)} s simulated, ${crop.ms.toFixed(0)} ms compute, final ${crop.reh.take.finalStateHash}`);
  return (memo = { crop, full });
}

test('flagship on the full uncropped Mars 2026 campus: completes, 0 violations, ends identical to the cropped run', () => {
  const { crop, full } = both();
  assert.equal(crop.reh.report.status, 'completed');
  assert.equal(crop.reh.take.finalStateHash, CROPPED_HASH, 'cropped campus flagship hash unchanged');
  const bad = full.reh.report.steps.filter((s: { status: string }) => s.status !== 'completed');
  assert.equal(full.reh.report.status, 'completed', JSON.stringify(bad.slice(0, 2)).slice(0, 600));
  assert.deepEqual(full.reh.report.violations, []);
  const final = replayFinalState(full.reh.take);
  assert.equal(final.entities.visitor.human!.level > 0, true, 'visitor on the new deck');

  // same world (entity by entity, for a readable failure before the hash test below)
  const ref = replayFinalState(crop.reh.take);
  assert.deepEqual(Object.keys(final.entities), Object.keys(ref.entities));
  let maxHuman = 0;
  for (const [id, e] of Object.entries(final.entities)) {
    const r = ref.entities[id];
    if (e.kind !== 'human') { assert.deepEqual(e, r, `component ${id} identical`); continue; }
    maxHuman = Math.max(maxHuman, Math.hypot(e.pose.p[0] - r.pose.p[0], e.pose.p[1] - r.pose.p[1], e.pose.p[2] - r.pose.p[2]), Math.abs(e.pose.yaw - r.pose.yaw));
    assert.deepEqual({ ...e, pose: null }, { ...r, pose: null }, `${id}: same discrete state`);
  }
  assert.equal(maxHuman, 0, `people end exactly where the cropped run's do (max ${maxHuman})`);
  assert.equal(full.reh.take.ticks, crop.reh.take.ticks, 'same duration as the cropped run');

  const ex = execute(full.h, 'build', full.plan, full.cfg);
  assert.ok(ex.ok, JSON.stringify(ex).slice(0, 300));
  assert.equal(hashOf(replayFinalState(ex.take)), hashOf(final));
  assert.equal(full.h.read(CAMPUS_ID).entities.A, undefined, 'canonical 2026 has no flagship parts');
  assert.equal(full.h.log(CAMPUS_ID).length, 1);
});

test('flagship full campus: final-state hash === the cropped run (bit-identical: grids share one lattice)', () => {
  const { crop, full } = both();
  assert.equal(full.reh.take.finalStateHash, crop.reh.take.finalStateHash);
});

// Year build, checkpoint 1 (W38): all four rack houses of Mars 2022 — chiba, east-house, kitchen, west-house — through the
// same generator A+B (campus/sequence.ts, sequence-b.ts), the same rules and a crew of six, each in a fork of the protected
// `mars-2022` checkpoint (scenarios/year-build.ts yearBuildHouseSetup). HYPOTHETICAL order / piles / crew; the acceptance
// target is the checkpoint's own geometry (phase A) and the material rules' stated placements (phase B), within 1 cm / 1°.
// Default suite: the one-template check, the per-house plans (counts by kind, unplaced with reasons, the yard clear of the
// neighbouring houses' work zones), and each new house's first bay + first ground-floor deck strip, pinned. The whole
// house A+B of each runs with YEAR_BUILD_FULL=1 (~10–20 min each). East-house keeps its own pinned tests
// (year-build.test.ts, year-build-b.test.ts) on the v1 yard; here it is report-only under the per-house setup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCampusFile } from '../campus/history-node.ts';
import { otherWorkZones, buildingFootprint } from '../campus/bom.ts';
import { yearBuildHouseSetup, yearBuildSetup, compareToCanonical, compareB, HOUSES_2022, type YearBuildSetup } from '../scenarios/year-build.ts';
import { rehearse } from '../rehearsal/rehearse.ts';
import { obbOverlap, rot2 } from '../core/math.ts';
import { def } from '../world/catalog.ts';

const kinds = (xs: { kind: string }[]) => xs.reduce<Record<string, number>>((m, x) => ((m[x.kind] = (m[x.kind] ?? 0) + 1), m), {});
const FILE = loadCampusFile(2022);

/** Expected A+B plans (yearBuildHouseSetup): steps, sequenced and unplaced Kit components by kind. */
const PLANS: Record<string, { steps: number; far: number; sequenced: Record<string, number>; unplaced: Record<string, number> }> = {
  chiba: { steps: 1462, far: 45, sequenced: { beam: 54, 'feature:deck-sheet': 27, 'feature:solar': 6, 'feature:stair-part': 16, 'feature:wall': 2, upright: 12 }, unplaced: { 'feature:fixture': 16, 'feature:solar': 14, 'feature:stair-part': 5, 'feature:wall': 5 } },
  'east-house': { steps: 1552, far: 0, sequenced: { beam: 54, 'feature:deck-sheet': 27, 'feature:solar': 6, 'feature:stair-part': 16, 'feature:wall': 4, upright: 12 }, unplaced: { 'feature:solar': 14, 'feature:stair-part': 5 } },
  kitchen: { steps: 1325, far: 45, sequenced: { beam: 54, 'feature:deck-sheet': 21, 'feature:stair-part': 16, 'feature:wall': 3, upright: 12 }, unplaced: { 'feature:door': 1, 'feature:fixture': 79, 'feature:roof': 10, 'feature:stair-part': 5, 'feature:wall': 1 } },
  'west-house': { steps: 1480, far: 45, sequenced: { beam: 54, 'feature:deck-sheet': 27, 'feature:solar': 6, 'feature:stair-part': 16, 'feature:wall': 3, upright: 12 }, unplaced: { 'feature:fixture': 5, 'feature:solar': 14, 'feature:stair-part': 5, 'feature:wall': 1 } },
};

/** Every pile's box and the cutting station clear of the other rack houses' work zones. */
function yardHits(s: YearBuildSetup): string[] {
  const zones = otherWorkZones(s.graph, s.build.assembly);
  const hits: string[] = [];
  for (const p of s.build.yard.piles) {
    const d = def(p.def);
    for (const z of zones) if (obbOverlap({ c: [p.x, p.z], half: [d.size[0] / 2, d.size[2] / 2], yaw: p.yaw }, z.zone)) hits.push(`${p.id} in ${z.assembly}'s work zone`);
  }
  const st = s.build.yard.station;
  if (st) { const d = def('cutting-station').size; for (const z of zones) if (obbOverlap({ c: [st.x, st.z], half: [d[0] / 2, d[2] / 2], yaw: st.yaw }, z.zone)) hits.push(`cutting station in ${z.assembly}'s work zone`); }
  return hits;
}

test('year build 2022: the four rack houses are one template (12 frames of 16 ft × 3 ft in 4 lines × 3 rows, 54 beams of 12 ft at 0.22 / 2.48 / 4.757 m) — phase B split rules apply unchanged', () => {
  const s = yearBuildSetup(2022, 'east-house', FILE);
  const g = s.graph;
  const fp0 = buildingFootprint(g.nodes.filter((n) => n.assembly === 'east-house'));
  for (const h of HOUSES_2022) {
    const nodes = g.nodes.filter((n) => n.assembly === h);
    const ups = nodes.filter((n) => n.kind === 'upright'), beams = nodes.filter((n) => n.kind === 'beam');
    assert.deepEqual(kinds(ups.map((u) => ({ kind: u.def! }))), { 'upright-16ft-kit': 12 }, h);
    assert.deepEqual(kinds(beams.map((u) => ({ kind: u.def! }))), { 'beam-12ft': 54 }, h);
    assert.deepEqual([...new Set(beams.map((b) => b.seat!.toFixed(3)))].sort(), ['0.220', '2.480', '4.757'], h);
    const fp = buildingFootprint(nodes);
    assert.ok(Math.abs(fp.half[0] - fp0.half[0]) < 1e-3 && Math.abs(fp.half[1] - fp0.half[1]) < 1e-3, `${h} footprint ${fp.half}`);
    // 4 frame lines × 3 rows along the frames' normal / across axis
    const n = rot2([0, 1], ups[0].box.yaw);
    const lines = new Set(ups.map((u) => Math.round((u.box.c[0] * n[0] + u.box.c[2] * n[1]) / 0.2)));
    const rows = new Set(ups.map((u) => Math.round((u.box.c[0] * n[1] - u.box.c[2] * n[0]) / 0.2)));
    assert.equal(lines.size, 4, h);
    assert.equal(rows.size, 3, h);
  }
});

test('year build 2022, all four houses A+B: plans through the same rules — counts by kind, unplaced with reasons, the yard clear of the neighbours\' work zones, deterministic; report-only table', () => {
  const table: string[] = [];
  for (const h of HOUSES_2022) {
    const s = yearBuildHouseSetup(2022, h, FILE);
    const b = s.build;
    const e = PLANS[h];
    assert.equal(b.template.steps.length, e.steps, h);
    assert.equal(b.phaseAStepCount, h === 'kitchen' ? 555 : 552, h); // kitchen: built from its far end, three holders walk out first
    assert.deepEqual(kinds(b.sequenced), e.sequenced, h);
    assert.deepEqual(kinds(b.unplaced), e.unplaced, h);
    for (const u of b.unplaced) assert.ok(u.reason.length > 20, `${u.node}: ${u.reason}`);
    assert.deepEqual(b.yard.refused, [], h);
    assert.deepEqual(yardHits(s), [], h);
    // the staging-end rule: beams whose aisle's line-0 end faces a neighbouring house are staged at the far end
    assert.equal(s.plan.steps.filter((x) => /far \(line 3\) end/.test(String(x.label))).length, e.far, h);
    table.push(`| ${h} | ${b.template.steps.length} | ${JSON.stringify(kinds(b.sequenced))} | ${JSON.stringify(kinds(b.unplaced))} | (${b.yard.station!.x}, ${b.yard.station!.z}) | ${e.far} |`);
  }
  // chiba's odd walls: two screens + bezels (no material rule) and a 2.30 m plywood wall the Kit draws over its 2.23 m one
  const c = yearBuildHouseSetup(2022, 'chiba', FILE).build.unplaced.filter((u) => u.kind === 'feature:wall');
  assert.equal(c.filter((u) => /"screen( bezel)?" has no material rule/.test(u.reason)).length, 4);
  assert.equal(c.filter((u) => /wall height 2\.300 m/.test(u.reason)).length, 1);
  // deterministic: same plan hash from a fresh setup
  assert.equal(yearBuildHouseSetup(2022, 'kitchen', FILE).plan.planHash, yearBuildHouseSetup(2022, 'kitchen', FILE).plan.planHash);
  // east-house's pinned A+B (year-build-b.test.ts) keeps the v1 yard: two of its piles lie in a neighbour's work zone
  const v1 = yearBuildSetup(2022, 'east-house', FILE, { phaseB: {} });
  assert.deepEqual(yardHits(v1), ["pile-2x4-16ft-1 in kitchen's work zone", "pile-panel-rail-1 in chiba's work zone"]);
  console.log(`[year-build 2022 houses, report only]\n| house | steps | sequenced | unplaced | station | beams staged at the far end |\n${table.join('\n')}`);
});

/** Rehearse a house setup: 0 violations, settled, every sequenced part at its canonical pose / target (1 cm / 1°). */
function runHouse(h: string, tranche: boolean) {
  const s = yearBuildHouseSetup(2022, h, FILE, { tranche });
  const t0 = performance.now();
  const reh = rehearse(s.history, s.workspace, s.plan, s.cfg);
  const ms = performance.now() - t0;
  const bad = reh.report.steps.filter((x) => x.status !== 'completed');
  assert.equal(reh.report.status, 'completed', JSON.stringify(bad.slice(0, 2)).slice(0, 800));
  assert.deepEqual(reh.report.violations, [], JSON.stringify(reh.report.violations.slice(0, 2)));
  assert.ok(reh.report.settled, reh.report.unsettled.join('; '));
  const cmpA = compareToCanonical(reh.finalState, s.build), cmpB = compareB(reh.finalState, s.build);
  const off = [...cmpA, ...cmpB].filter((c) => !c.ok);
  assert.deepEqual(off, [], JSON.stringify(off.slice(0, 3)));
  const E = reh.finalState.entities;
  for (const id of s.build.bindings.crew) {
    assert.equal(E[id].human!.on, undefined, `${id} on the ground`);
    assert.equal(E[id].human!.grip, undefined, `${id} holds nothing`);
  }
  const maxA = Math.max(...cmpA.map((c) => c.dist)), maxB = Math.max(0, ...cmpB.map((c) => c.dist));
  console.log(`[year-build A+B 2022 ${h}${tranche ? ', bay 1 + first ground-floor strip' : ''}] ${reh.report.steps.length} steps, ${reh.report.metrics.ticks} ticks (${(reh.report.metrics.duration / 60).toFixed(1)} min simulated), 0 violations; phase A ${cmpA.length} (max ${(maxA * 1000).toFixed(2)} mm), phase B ${cmpB.length} ${JSON.stringify(kinds(cmpB.map((c) => ({ kind: c.role }))))} (max ${(maxB * 1000).toFixed(2)} mm); unplaced ${JSON.stringify(kinds(s.build.unplaced))}; ${(ms / 1000).toFixed(1)} s wall; hash ${reh.report.finalStateHash}`);
  return { s, reh, cmpA, cmpB };
}

/** Pinned default-suite tranches: first bay (6 frames + 18 beams) + the first ground-floor deck strip (3 pieces). */
/** First pins 2026-09-28 (W38). */
const PIN_TRANCHE: Record<string, { ticks: number; hash: string }> = {
  chiba: { ticks: 60997, hash: '940e9f64fa5c4758baa1772b955e4299623e5a8c2d00b51b84c9fa2ad95cbecd' },
  kitchen: { ticks: 55293, hash: '4862adfcb6b14bec685758fce5b732cb831a47c9b9a65a6167a5f6b3ead28f7e' },
  'west-house': { ticks: 54322, hash: 'b4c422105d2d818dbe49643f75978544c80e15b2994612e99a675ed0b3e345f7' },
};
/** Pinned whole-house A+B runs (YEAR_BUILD_FULL=1). */
const PIN_FULL: Record<string, { ticks: number; hash: string }> = {
  chiba: { ticks: 0, hash: '' },
  kitchen: { ticks: 0, hash: '' },
  'west-house': { ticks: 0, hash: '' },
};

for (const h of ['chiba', 'kitchen', 'west-house']) {
  test(`year build 2022 ${h}, first bay + first ground-floor deck strip: 0 violations, 24 skeleton parts at the canonical pose, 3 deck pieces at target, pinned`, () => {
    const { s, reh, cmpA, cmpB } = runHouse(h, true);
    assert.equal(cmpA.length, 24);
    assert.equal(cmpB.length, 3);
    const verbs = kinds(s.plan.steps.slice(s.build.phaseAStepCount).map((x) => ({ kind: x.verb })));
    assert.equal(verbs.cut, 3);
    assert.equal(verbs.stack_offcut, 3);
    assert.equal(verbs.pass_up, 3);
    assert.equal(reh.report.metrics.ticks, PIN_TRANCHE[h].ticks);
    assert.equal(reh.report.finalStateHash, PIN_TRANCHE[h].hash);
  });
  test(`year build 2022 ${h} A+B (skeleton, decks, stair, walls, solar) from the piles: 0 violations, every sequenced part at its target, pinned (YEAR_BUILD_FULL=1)`, { skip: process.env.YEAR_BUILD_FULL !== '1' }, () => {
    const { reh, cmpA } = runHouse(h, false);
    assert.equal(cmpA.length, 66);
    if (PIN_FULL[h].ticks) {
      assert.equal(reh.report.metrics.ticks, PIN_FULL[h].ticks);
      assert.equal(reh.report.finalStateHash, PIN_FULL[h].hash);
    }
  });
}

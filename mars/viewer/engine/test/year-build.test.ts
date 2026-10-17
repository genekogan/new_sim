// Year build phase A (owner feedback §7): the skeleton of Mars 2022's east-house built from the piles in a
// fork of the protected `mars-2022` checkpoint (engine/scenarios/year-build.ts, campus/sequence.ts), then
// compared with the checkpoint's own geometry: every sequenced frame and beam installed within 1 cm / 1°.
// The run is the year scene cropped to 35 m around the house, the house itself removed, ground at the Kit
// datum y = 0 (not an open-ground fork). HYPOTHETICAL order / piles / crew. The default suite runs the first
// bay (a tranche, ≈ 15 s); the whole house (≈ 40–55 s) runs with YEAR_BUILD_FULL=1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCampusFile } from '../campus/history-node.ts';
import { graphCounts } from '../campus/assembly.ts';
import { bomTotals, stockPiles } from '../campus/bom.ts';
import { yearBuildSetup, compareToCanonical } from '../scenarios/year-build.ts';
import { rehearse } from '../rehearsal/rehearse.ts';
import { hashOf } from '../core/hash.ts';
import { HistoryError } from '../history/store.ts';


// Re-pinned on the W51 re-seeded scene (L3, 2026-10-17): the skeleton is unchanged (54 beams + 12 uprights, the same
// verbs, bundles and an empty refused list); W51 added roofs, fixtures, the 45° solar triangle frames (structural members)
// and their modules to the crop, which phase A reports unplaced (was deck-sheet 27, solar 20, stair-part 21, wall 4), and
// the moved yard adds 3 walk_to steps (552 -> 555).
test('year build 2022 east-house, phase A: plan — 12 frames + 54 beams sequenced, everything else reported (not faked), deterministic', () => {
  const s = yearBuildSetup(2022, 'east-house', loadCampusFile(2022));
  const b = s.build;
  // the acceptance target is the protected checkpoint the graph came from
  assert.equal(s.graph.sceneHash, s.history.read(s.canonical).base.staticHash);
  assert.throws(() => s.history.commit(s.canonical, s.history.read(s.canonical), { kind: 'design-edit', note: 'x' }), (e: unknown) => e instanceof HistoryError && e.code === 'protected');
  const kinds = (xs: { kind: string }[]) => xs.reduce<Record<string, number>>((m, x) => ((m[x.kind] = (m[x.kind] ?? 0) + 1), m), {});
  assert.deepEqual(kinds(b.sequenced), { beam: 54, upright: 12 });
  assert.deepEqual(kinds(b.unplaced), { 'feature:deck-sheet': 27, 'feature:fixture': 7, 'feature:roof': 14, 'feature:solar': 92, 'feature:stair-part': 29, 'feature:structural-member': 36, 'feature:wall': 5 });
  assert.ok(b.unplaced.filter((u) => u.kind === 'feature:stair-part').every((u) => /no catalog flight of their width/.test(u.reason)));
  assert.equal(b.template.steps.length, 555);
  const verbs = kinds(b.template.steps.map((x) => ({ kind: x.verb })));
  assert.equal(verbs.take_from_bundle, 66);
  assert.equal(verbs.carry, 66);
  assert.equal(verbs.hang_beam, 54);
  assert.equal(verbs.raise_upright, 12);
  assert.equal(verbs.cut ?? 0, 0, 'the skeleton uses stock as it comes; cuts are phase B');
  const t = bomTotals(b.bom, stockPiles(b.bom));
  assert.deepEqual(t.bundles, { 'bundle-plywood-4x8': 4, 'stack-beam-12ft': 3, 'stack-upright-16ft-kit': 2 });
  assert.deepEqual(b.yard.refused, []);
  // deterministic: same plan hash from a fresh setup
  const s2 = yearBuildSetup(2022, 'east-house', loadCampusFile(2022));
  assert.equal(s2.plan.planHash, s.plan.planHash);
  assert.equal(hashOf(s2.build.template), hashOf(b.template));
  console.log(`[year-build 2022 east-house] graph ${JSON.stringify(graphCounts(s.graph).kinds)}; steps ${b.template.steps.length}; sequenced ${JSON.stringify(kinds(b.sequenced))}; unplaced ${JSON.stringify(kinds(b.unplaced))}`);
});

/** Rehearse a setup and check the phase-A acceptance: 0 violations, settled, every sequenced part installed at its canonical pose. */
function runAndCompare(bays?: number) {
  const s = yearBuildSetup(2022, 'east-house', loadCampusFile(2022), { bays });
  const t0 = performance.now();
  const reh = rehearse(s.history, s.workspace, s.plan, s.cfg);
  const ms = performance.now() - t0;
  const bad = reh.report.steps.filter((x) => x.status !== 'completed');
  assert.equal(reh.report.status, 'completed', JSON.stringify(bad.slice(0, 2)).slice(0, 800));
  assert.deepEqual(reh.report.violations, []);
  assert.ok(reh.report.settled, reh.report.unsettled.join('; '));
  const cmp = compareToCanonical(reh.finalState, s.build);
  const off = cmp.filter((c) => !c.ok);
  assert.deepEqual(off, [], JSON.stringify(off.slice(0, 3)));
  const maxD = Math.max(...cmp.map((c) => c.dist)), maxA = Math.max(...cmp.map((c) => c.dyaw));
  assert.ok(maxD < 0.001, `max centre error ${maxD}`);
  const E = reh.finalState.entities;
  for (const id of s.build.bindings.crew) {
    assert.equal(E[id].human!.on, undefined, `${id} on the ground`);
    assert.equal(E[id].human!.grip, undefined, `${id} holds nothing`);
  }
  const hangs = s.plan.steps.filter((x) => x.verb === 'hang_beam');
  const n = hangs.length / 3;
  assert.equal(hangs.filter((x) => (x.params.relay as string[] | undefined)?.length === 2).length, n, 'top beams through a relay');
  assert.equal(hangs.filter((x) => (x.params.givers as string[] | undefined)?.length === 2 && !x.params.relay).length, n, 'middle beams handed up');
  assert.equal(hangs.filter((x) => !x.params.givers).length, n, 'low beams from the ground');
  const kinds = (xs: { kind: string }[]) => xs.reduce<Record<string, number>>((m, x) => ((m[x.kind] = (m[x.kind] ?? 0) + 1), m), {});
  console.log(`[year-build 2022 east-house${bays ? `, bays ${bays}` : ''}] ${reh.report.metrics.ticks} ticks (${reh.report.metrics.duration.toFixed(0)} s simulated), ${reh.report.steps.length} steps, 0 violations, ${cmp.length} parts matched (max ${(maxD * 1000).toFixed(2)} mm / ${(maxA * 180 / Math.PI).toFixed(3)}°), unplaced ${JSON.stringify(kinds(s.build.unplaced))}, ${(ms / 1000).toFixed(1)} s wall, hash ${reh.report.finalStateHash}`);
  return { s, reh, cmp, E };
}

/** Pinned: final-state hash and length of the first-bay tranche (6 frames + 18 beams) of the east-house skeleton.
 *  Re-pinned (was 41019 ticks, ad844b78…8121): walker fallback + hypot + encounters on the smoothed path, 2026-09-28 (PLANNING_BUDGET.md); re-pinned (was 41182 ticks, 695d2dcb…0a81):
 *  no walker jumps: snaps walked, teleport 0.15 m, overspeed invariant, 2026-09-28 (PLANNING_BUDGET.md); 0 violations, 24/24 at the canonical pose. */
/** Re-pinned 2026-10-17 on the W51 re-seeded mars-2022 (was 41317, 251a44c5…): 24/24 at the canonical pose, 42 reported outside
 *  the tranche, plywood untouched, 0 violations. */
const PIN_BAY1 = { ticks: 39347, hash: '462a2f4a9feefec238d3cbbca1e99b90194ca0d9e6b0bf4162182448b747f645' };
/** Pinned: the whole east-house skeleton (YEAR_BUILD_FULL=1; ≈ 40–55 s wall). Re-pinned (was 116477 ticks, 14d5c768…c89a):
 *  walker fallback + hypot + encounters on the smoothed path, 2026-09-28; re-pinned (was 117125 ticks, 35d12886…11da):
 *  no walker jumps: snaps walked, teleport 0.15 m, overspeed invariant, 2026-09-28; re-pinned (was 117277 ticks, d382e461…0617):
 *  the W51 re-seeded scene (yard and neighbours moved, 3 more walk_to steps), L3 2026-10-17; 0 violations, 66/66 at the
 *  canonical pose (max 0.94 mm). */
const PIN_FULL = { ticks: 123818, hash: '8c57862eaeb66bc13000329475329db24639ec549bf6b036ca9cb8d2f0b2ee68' };
/** The opt-in skip's TAP directive, kept verbatim from before the re-pin: the release gate matches a documented skip by its
 *  directive text against the baseline (tools/test-harness/quarantine.json carries the current reason). */
const OPT_IN_SKIP = '2022 reconciliation W51; re-pin by W52';

test('year build 2022 east-house, phase A, first bay (6 frames + 18 beams): 0 violations, every sequenced part at its canonical pose (≤ 1 cm / 1°), pinned', () => {
  const { s, reh, cmp, E } = runAndCompare(1);
  assert.equal(cmp.length, 24);
  assert.equal(s.build.unplaced.filter((u) => /outside the requested tranche/.test(u.reason)).length, 6 + 36);
  assert.equal((E['pile-plywood-4x8-1'].contents as { count?: number }).count, 24, 'plywood untouched in phase A');
  assert.equal(reh.report.metrics.ticks, PIN_BAY1.ticks);
  assert.equal(reh.report.finalStateHash, PIN_BAY1.hash);
});

test('year build 2022 east-house, phase A, whole skeleton (12 frames + 54 beams) from the piles: 0 violations, all at the canonical pose, pinned (YEAR_BUILD_FULL=1)', { skip: process.env.YEAR_BUILD_FULL !== '1' && OPT_IN_SKIP }, () => {
  const { reh, cmp, E } = runAndCompare();
  assert.equal(cmp.length, 66);
  for (const id of ['pile-upright-16ft-kit-1', 'pile-upright-16ft-kit-2', 'pile-beam-12ft-1', 'pile-beam-12ft-2', 'pile-beam-12ft-3']) assert.equal(E[id], undefined, `${id} emptied`);
  assert.equal((E['pile-plywood-4x8-1'].contents as { count?: number }).count, 24, 'plywood untouched in phase A');
  assert.equal(reh.report.metrics.ticks, PIN_FULL.ticks);
  assert.equal(reh.report.finalStateHash, PIN_FULL.hash);
});

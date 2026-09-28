// Year build phase B (owner feedback §7, §9; W13): after the skeleton, the floors, the Kit stair, the plywood walls and
// the solar array of Mars 2022's east-house, from the piles, in the Mars order, in a fork of the protected `mars-2022`
// checkpoint (campus/parts-b.ts material rules, campus/sequence-b.ts generator, scenarios/year-build.ts). HYPOTHETICAL
// order / piles / crew; the acceptance target is the checkpoint's own geometry through the material rules' stated
// placements (every sequenced part installed within 1 cm / 1° of its target; the Kit-drawing offsets reported).
// Default suite: the plan (material rules, BOM, yard, unplaced reasons, determinism), the new verbs' refusals, the
// report-only plans of the other three 2022 houses. The whole house A+B runs with YEAR_BUILD_FULL=1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCampusFile } from '../campus/history-node.ts';
import { bomTotals, stockPiles } from '../campus/bom.ts';
import { yearBuildSetup, compareToCanonical, compareB, kitOffsets } from '../scenarios/year-build.ts';
import { rehearse } from '../rehearsal/rehearse.ts';
import { hashOf } from '../core/hash.ts';
import { publishCampusYear } from '../campus/history.ts';
import { assemblyGraph } from '../campus/assembly.ts';
import { buildingFootprint } from '../campus/bom.ts';
import { yearBuildPlan, yearBuildScene } from '../campus/sequence.ts';
import { WorldHistory } from '../history/store.ts';
import { kitStringerGeometry } from '../world/catalog-phase-b.ts';
import { Runtime } from '../runtime/runtime.ts';
import { humanHumanSeparation, humanStaticClearance } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { emptyWorld, human, component } from '../world/factory.ts';
import { walkTo } from '../locomotion/walk.ts';
import { setPartVerb } from '../construction/setpart.ts';
import { openGround } from './frame-fixtures.ts';
import { isBarrier, sectionBounds } from '../take/chapters.ts';
import type { ActionDef } from '../actions/types.ts';
const W51_TODO = '2022 reconciliation W51; re-pin by W52'; // mars-2022 re-seeded (RECONCILIATION_2022 §a–§f): neighbours, stairs, solar and trailers moved in every crop

const kinds = (xs: { kind: string }[]) => xs.reduce<Record<string, number>>((m, x) => ((m[x.kind] = (m[x.kind] ?? 0) + 1), m), {});

test('year build 2022 east-house A+B: plan — material rules, bill of materials, yard, what is left unplaced and why, deterministic; the skeleton steps unchanged', { todo: W51_TODO }, () => {
  const s = yearBuildSetup(2022, 'east-house', loadCampusFile(2022), { phaseB: {} });
  const b = s.build;
  const pb = b.partsB!;
  const roles = kinds(pb.parts.map((p) => ({ kind: p.role })));
  // 27 Kit deck strips (15 ft) → 6 + 6 + 3 ft pieces jointed on the beams, 25 wall panels, the Kit stair's lumber, 10 rails + 10 panels
  assert.deepEqual(roles, { 'deck-piece': 81, handrail: 2, panel: 10, 'panel-rail': 20, post: 6, stringer: 6, 'tread-board': 16, 'wall-panel': 25 });
  assert.equal(pb.parts.filter((p) => /n$/.test(p.def)).length, 55, '54 deck pieces on frame lines + the top tread\'s back board are notched');
  assert.ok(Math.abs(kitStringerGeometry().L - 4.0590) < 1e-3);
  // unplaced, each with its reason: two rail posts the Kit draws inside the end frame, three risers (a 6.5 cm sliver;
  // two in slots between treads no verb can reach), and the solar panels install_panel cannot stand a crew for
  // (panels over a frame line would sit on the column tops standing above the roof deck; end panels: a station off the
  // deck; then every other one: tilted neighbours) — 3 of the 10 modules are mounted
  assert.deepEqual(kinds(b.unplaced), { 'feature:solar': 14, 'feature:stair-part': 5 });
  for (const u of b.unplaced) assert.ok(u.reason.length > 20, `${u.node}: ${u.reason}`);
  assert.ok(b.unplaced.filter((u) => u.kind === 'feature:solar').every((u) => /install_panel/.test(u.reason)));
  // sequenced: the skeleton and every other phase-B Kit feature
  assert.deepEqual(kinds(b.sequenced), { beam: 54, 'feature:deck-sheet': 27, 'feature:solar': 6, 'feature:stair-part': 16, 'feature:wall': 4, upright: 12 });
  // the phase-A part of the template is the phase-A plan itself (same yard, same steps)
  const a = yearBuildSetup(2022, 'east-house', loadCampusFile(2022));
  assert.equal(hashOf(b.template.steps.slice(0, b.phaseAStepCount)), hashOf(a.build.template.steps));
  // stock: 106 sheets (81 deck pieces + 25 wall panels) in the phase-A plywood bundles + 2 more, lumber, rails, panels on their own pallet
  const t = bomTotals(b.bom, stockPiles(b.bom));
  assert.equal(t.items['B:plywood-4x8'], 106);
  assert.equal(t.items['B:solar-panel-107x163'], 10);
  assert.ok(b.yard.piles.some((p) => p.def === 'stack-solar-panel-107x163'), 'solar panels are their own pile (§9)');
  assert.deepEqual(b.yard.refused, []);
  assert.ok(b.yard.extra?.some((x) => x.id === 'scrap-pile'));
  // deterministic
  const s2 = yearBuildSetup(2022, 'east-house', loadCampusFile(2022), { phaseB: {} });
  assert.equal(s2.plan.planHash, s.plan.planHash);
  console.log(`[year-build B 2022 east-house] steps ${b.template.steps.length} (A ${b.phaseAStepCount}); verbs B ${JSON.stringify(kinds(b.template.steps.slice(b.phaseAStepCount).map((x) => ({ kind: x.verb }))))}; sequenced ${JSON.stringify(kinds(b.sequenced))}; unplaced ${JSON.stringify(kinds(b.unplaced))}`);
});

test('year build 2022, report only: the other three rack houses plan through the same rules (counts, reasons)', { todo: W51_TODO }, () => {
  const h = new WorldHistory('x');
  const { base } = publishCampusYear(h, 2022, loadCampusFile(2022));
  const g = assemblyGraph(2022, base);
  const out: Record<string, { steps: number; sequenced: Record<string, number>; unplaced: Record<string, number> }> = {};
  for (const a of ['chiba', 'kitchen', 'west-house']) {
    const fp = buildingFootprint(g.nodes.filter((n) => n.assembly === a));
    const b = yearBuildPlan(g, yearBuildScene(base, a, fp.c, 35), a, { phaseB: {} });
    out[a] = { steps: b.template.steps.length, sequenced: kinds(b.sequenced), unplaced: kinds(b.unplaced) };
    assert.ok(b.template.steps.length <= 2000);
    for (const u of b.unplaced) assert.ok(u.reason.length > 10);
    assert.equal(out[a].sequenced.upright, 12);
    assert.equal(out[a].sequenced.beam, 54);
  }
  console.log(`[year-build B 2022 report-only] ${JSON.stringify(out)}`);
});

// W27: the A+B run's walls section had m2, lifting a wall panel in (install_wall's tip-up / walk-in), pass 0.48 m from an
// idle m6 — the set-part engine checked the lift crew's feet against the static grid only. Now the crew holds the part
// and waits for anyone its feet would come within 2r + 0.08 m of (as the carry verb does); an idle person makes way.
test('set-part lift crews never walk through a bystander: the crew holds the part (setpart.path-occupied) and an idle person in the way is asked to step aside; 0 violations', () => {
  const verb = setPartVerb('install_test', 'test sheet', () => ({ kind: 'resting-on', supports: ['ground'] }), (d) => d === 'plywood-4x8', 'test-only set-part verb');
  const lift = [{ actor: 'a', grip: [0, 0.01, -0.55] as [number, number, number], stand: [0, 0, -0.4] as [number, number, number] }, { actor: 'b', grip: [0, 0.01, 0.55] as [number, number, number], stand: [0, 0, 0.4] as [number, number, number] }];
  const runWith = (c: [number, number]) => {
    const w = emptyWorld('open', openGround());
    const sh = component('sh', 'plywood-4x8', [0, 0, 0], 0, { phase: 'staged' });
    sh.support = { kind: 'ground' };
    w.entities.sh = sh;
    w.entities.a = human('a', 0, -1.3);
    w.entities.b = human('b', 0, 1.3);
    w.entities.c = human('c', c[0], c[1]); // idle, on b's way (b walks along z ≈ 0.96 from x 0 to 3)
    const rt = new Runtime(w, new Map<string, ActionDef>([[walkTo.verb, walkTo as ActionDef], [verb.verb, verb as ActionDef]]), { spatial: new Spatial(openGround()) }, [humanHumanSeparation, humanStaticClearance]);
    const r = rt.submit('install_test', { part: 'sh', to: { x: 3, y: 0, z: 0, yaw: 0 }, from: { x: 0, y: 0.75, z: 0 }, lift, fasten: ['a'] });
    const waits = new Set<string>();
    for (let t = 0; t < 20 * 120 && rt.isActive(r.id); t++) { rt.step(); if (r.status === 'blocked') waits.add(r.diagnostic!.code); }
    return { rt, r, waits };
  };
  const inWay = runWith([1.5, 1.0]);
  assert.equal(inWay.r.status, 'completed');
  assert.deepEqual(inWay.rt.violations, [], JSON.stringify(inWay.rt.violations.slice(0, 2)));
  assert.deepEqual([...inWay.waits], ['setpart.path-occupied']);
  assert.ok([...inWay.rt.records.keys()].some((k) => k.startsWith('c:make-way:')), 'c was asked to make way');
  assert.equal(inWay.rt.world.entities.sh.phase, 'installed');
  assert.ok(Math.abs(inWay.rt.world.entities.sh.pose.p[0] - 3) < 1e-9);
  // nobody near the way: no wait, nobody moved
  const clear = runWith([5, 5]);
  assert.equal(clear.r.status, 'completed');
  assert.deepEqual(clear.rt.violations, []);
  assert.deepEqual([...clear.waits], []);
  assert.deepEqual(clear.rt.world.entities.c.pose.p, [5, 0, 5]);
});

/** Pinned: the first-bay tranche + its first ground-floor deck strip (default suite). */
const PIN_BAY1_DECK = { ticks: 53604, hash: '94db263edb961cb21d491445e7d9401be0f3a7609a287680ed1052a6b67d73cb' };

test('year build 2022 east-house, first bay + its first ground-floor deck strip (3 pieces cut from 4x8s, notched, offcuts stacked, pushed in over the edge beams, screwed): 0 violations, at target, pinned', { todo: W51_TODO }, () => {
  const firstStrip = (p: { kind: string; meta: Record<string, number | string> }) => p.kind === 'deck' && Number(p.meta.level) < 1 && Number(p.meta.strip) < -9.5;
  const s = yearBuildSetup(2022, 'east-house', loadCampusFile(2022), { bays: 1, phaseB: { sections: ['D0'], only: firstStrip } });
  assert.equal(s.build.partsB!.parts.length, 3);
  const t0 = performance.now();
  const reh = rehearse(s.history, s.workspace, s.plan, s.cfg);
  const ms = performance.now() - t0;
  const bad = reh.report.steps.filter((x) => x.status !== 'completed');
  assert.equal(reh.report.status, 'completed', JSON.stringify(bad.slice(0, 2)).slice(0, 800));
  assert.deepEqual(reh.report.violations, []);
  assert.ok(reh.report.settled, reh.report.unsettled.join('; '));
  assert.deepEqual(compareToCanonical(reh.finalState, s.build).filter((c) => !c.ok), []);
  const cmp = compareB(reh.finalState, s.build);
  assert.equal(cmp.length, 3);
  assert.deepEqual(cmp.filter((c) => !c.ok), []);
  const verbs = kinds(s.plan.steps.slice(s.build.phaseAStepCount).map((x) => ({ kind: x.verb })));
  assert.equal(verbs.cut, 3);
  assert.equal(verbs.stack_offcut, 3);
  assert.equal(verbs.pass_up, 3);
  console.log(`[year-build B 2022 east-house, bay 1 + first deck strip] ${reh.report.steps.length} steps, ${reh.report.metrics.ticks} ticks (${reh.report.metrics.duration.toFixed(0)} s simulated), 0 violations, ${(ms / 1000).toFixed(1)} s wall, hash ${reh.report.finalStateHash}`);
  if (PIN_BAY1_DECK.ticks) {
    assert.equal(reh.report.metrics.ticks, PIN_BAY1_DECK.ticks);
    assert.equal(reh.report.finalStateHash, PIN_BAY1_DECK.hash);
  }
});

/** Pinned: the whole east-house A+B (YEAR_BUILD_FULL=1). First pin 2026-09-29 (W27): green once set-part lift crews wait for
 *  bystanders (s1417-install-wall holds its panel 17 ticks while an idle m6 steps aside); 8.3 h simulated. */
const PIN_FULL_AB = { ticks: 600599, hash: 'ddb634d6e73d99e679421ceecaaec20a0936643d25dc33845082dd6a4ecdf30a' };

test('year build 2022 east-house A+B (skeleton, decks, stair, walls, solar) from the piles: 0 violations, every sequenced part at its target, Kit offsets reported, pinned (YEAR_BUILD_FULL=1)', { todo: W51_TODO, skip: process.env.YEAR_BUILD_FULL !== '1' }, () => {
  const s = yearBuildSetup(2022, 'east-house', loadCampusFile(2022), { phaseB: {} });
  const t0 = performance.now();
  const reh = rehearse(s.history, s.workspace, s.plan, s.cfg);
  const ms = performance.now() - t0;
  const bad = reh.report.steps.filter((x) => x.status !== 'completed');
  assert.equal(reh.report.status, 'completed', JSON.stringify(bad.slice(0, 2)).slice(0, 800));
  assert.deepEqual(reh.report.violations, []);
  assert.ok(reh.report.settled, reh.report.unsettled.join('; '));
  const cmpA = compareToCanonical(reh.finalState, s.build);
  assert.deepEqual(cmpA.filter((c) => !c.ok), []);
  const cmpB = compareB(reh.finalState, s.build);
  const off = cmpB.filter((c) => !c.ok);
  assert.deepEqual(off, [], JSON.stringify(off.slice(0, 3)));
  const byKind = kinds(cmpB.map((c) => ({ kind: c.role })));
  const ko = kitOffsets(reh.finalState, s.build);
  const worst = (k: string) => Math.max(...ko.filter((x) => x.kind === k && x.installed).map((x) => Math.sqrt(x.dc[0] * x.dc[0] + x.dc[1] * x.dc[1] + x.dc[2] * x.dc[2])));
  console.log(`[year-build A+B 2022 east-house] ${reh.report.steps.length} steps, ${reh.report.metrics.ticks} ticks (${(reh.report.metrics.duration / 60).toFixed(0)} min simulated), 0 violations; phase A parts ${cmpA.length}; phase B parts at target ${cmpB.length} ${JSON.stringify(byKind)} (max ${(Math.max(...cmpB.map((c) => c.dist)) * 1000).toFixed(2)} mm); Kit offsets (max centre) deck ${worst('deck').toFixed(3)} m, wall ${worst('wall').toFixed(3)} m, stair ${worst('stair').toFixed(3)} m, solar ${worst('solar').toFixed(3)} m; unplaced ${JSON.stringify(kinds(s.build.unplaced))}; ${(ms / 1000).toFixed(0)} s wall; hash ${reh.report.finalStateHash}`);
  if (PIN_FULL_AB.ticks) {
    assert.equal(reh.report.metrics.ticks, PIN_FULL_AB.ticks);
    assert.equal(reh.report.finalStateHash, PIN_FULL_AB.hash);
  }
});

// W31: the A+B take ships as chapters, one per section (engine/take/chapters.ts, deploy/record-campus-take.mjs
// `year-build-2022-ab-chapters`), cut where sequence-b's section gates put a barrier. The plan side of that contract:
// the section starts, and that each is a barrier (every later step depends on every earlier one), END folded into P.
test('year build 2022 east-house A+B: section boundaries — A, D0, D1, D2, S, W, P(+END) start at fixed plan steps and each is a barrier (the chapter takes are cut there)', { todo: W51_TODO }, () => {
  const s = yearBuildSetup(2022, 'east-house', loadCampusFile(2022), { phaseB: {} });
  const b = sectionBounds(s.build, ['END']);
  assert.deepEqual(b.map((x) => `${x.id}@${x.at}`), ['A@0', 'D0@552', 'D1@743', 'D2@954', 'S@1167', 'W@1341', 'P@1499']);
  assert.equal(s.build.phaseAStepCount, 552);
  assert.equal(s.plan.steps.length, 1552);
  for (const x of [...b, ...s.build.sectionStarts!.map((y) => ({ id: y.section, at: y.at }))]) assert.ok(isBarrier(s.plan.steps, x.at), `${x.id} at ${x.at}`);
  assert.ok(!isBarrier(s.plan.steps, 557) && !isBarrier(s.plan.steps, 800), 'steps inside D0 / D1 that are not barriers');
});

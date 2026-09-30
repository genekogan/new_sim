// Bill of materials, piles, take_from_bundle and cut (owner feedback §7 phase A; campus/bom.ts,
// construction/bundle.ts, construction/cut.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashOf } from '../core/hash.ts';
import { obbOverlap } from '../core/math.ts';
import { loadCampusYear, type CampusYearFile } from '../campus/history.ts';
import { loadCampusFile } from '../campus/history-node.ts';
import { assemblyGraph } from '../campus/assembly.ts';
import { billOfMaterials, bomTotals, placePiles, stockPiles } from '../campus/bom.ts';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { CARRY_INVARIANTS } from '../carry/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { walkTo } from '../locomotion/walk.ts';
import { carry } from '../carry/actions.ts';
import { takeFromBundle, bundleCount, bundleEntity } from '../construction/bundle.ts';
import { cutStock, cutPlan } from '../construction/cut.ts';
import { addAll, component, emptyWorld, human } from '../world/factory.ts';
import { def } from '../world/catalog.ts';
import type { ActionDef } from '../actions/types.ts';
import type { SpatialScene } from '../spatial/types.ts';
import type { Provenance } from '../world/types.ts';
const W51_TODO = '2022 reconciliation W51; re-pin by W52'; // mars-2022 re-seeded (RECONCILIATION_2022 §a–§f): neighbours, stairs, solar and trailers moved in every crop

const HYPO: Provenance = { origin: 'design-edit', confidence: 'hypothetical', note: 'test yard' };

test('bill of materials + piles, 2022 east-house: exact skeleton counts, bundles like the photos, one yard clear of everything', { todo: W51_TODO }, () => {
  const { base } = loadCampusYear(2022, loadCampusFile(2022) as CampusYearFile);
  const g = assemblyGraph(2022, base);
  const bom = billOfMaterials(g, ['east-house']);
  const piles = stockPiles(bom);
  const t = bomTotals(bom, piles);
  assert.deepEqual(t.items, { 'A:beam-12ft': 54, 'A:upright-16ft-kit': 12, 'B:plywood-4x8': 79, 'B:solar-panel-1.59x1.07': 10 });
  assert.deepEqual(t.bundles, { 'bundle-plywood-4x8': 4, 'stack-beam-12ft': 3, 'stack-upright-16ft-kit': 2 });
  assert.deepEqual(t.unresolved, { 'stair-part': 21 });
  assert.equal(t.cuts, 52);
  assert.ok(bom.cuts.some((c) => c.for === 'deck strips' && c.count === 27 && c.to === 'plywood 2.134x1.219'), 'a 15 ft deck strip = one full sheet + one cut to 7 ft');
  assert.ok(bom.lines.some((l) => l.item.startsWith('solar-panel') && /pending W8/.test(l.note ?? '')), 'solar is its own pile, def pending');
  assert.equal(piles.filter((p) => p.piece === 'beam-12ft').map((p) => p.count).join(), '20,20,14');
  const obstacles = base.obstacles.filter((o) => o.assembly !== 'east-house');
  const yard = placePiles(piles, g.nodes.filter((n) => n.assembly === 'east-house'), obstacles, 0);
  assert.deepEqual(yard.refused, []);
  assert.ok(yard.station);
  assert.equal(hashOf(placePiles(piles, g.nodes.filter((n) => n.assembly === 'east-house'), obstacles, 0)), hashOf(yard), 'deterministic');
  for (const p of yard.piles) {
    const d = def(p.def);
    const obb = { c: [p.x, p.z] as [number, number], half: [d.size[0] / 2, d.size[2] / 2] as [number, number], yaw: p.yaw };
    assert.ok(!obbOverlap(obb, yard.workZone), `${p.id} outside the work zone`);
    const hit = obstacles.find((o) => o.y1 > 0.22 && o.y0 < 1.8 && obbOverlap(o.obb, obb, 1.0));
    assert.equal(hit, undefined, `${p.id} ≥ 1 m from ${hit?.id}`);
    for (const q of yard.piles) if (q !== p) assert.ok(!obbOverlap(obb, { c: [q.x, q.z], half: [def(q.def).size[0] / 2, def(q.def).size[2] / 2], yaw: q.yaw }, 1.9), `${p.id} / ${q.id} aisle`);
  }
  // no room → refused and reported, never stacked on top of something
  const tight = placePiles(piles, g.nodes.filter((n) => n.assembly === 'east-house'), obstacles, 0, { radius: 2 });
  assert.ok(tight.refused.length > 0);
  assert.match(tight.refused[0].reason, /no free .* plot within 2 m/);
});

const ground = (): SpatialScene => ({ bounds: [-20, -20, 20, 20], levels: [{ id: 0, y: 0, label: 'ground' }], surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [20, 20], yaw: 0 } }], obstacles: [], links: [] });
const registry = () => new Map<string, ActionDef>([['walk_to', walkTo], ['carry', carry], ['take_from_bundle', takeFromBundle], ['cut', cutStock]]);
function yardRt() {
  const w = addAll(emptyWorld('open-ground', ground()),
    bundleEntity('beams', 'stack-beam-12ft', 0, 0, 0, 2, 0, HYPO),
    bundleEntity('ply', 'bundle-plywood-4x8', 0, -6, 0, 24, 0, HYPO),
    bundleEntity('studs', 'bundle-2x4-16ft', 0, 6, 0, 48, 0, HYPO),
    { id: 'saw', def: 'cutting-station', kind: 'fixture', pose: { p: [8, 0, 0], yaw: 0 }, provenance: HYPO },
    human('p1', -3, -3), human('p2', -2, -3), human('p3', -1, -3));
  return new Runtime(w, registry(), { spatial: new Spatial(ground()) }, [...DEFAULT_INVARIANTS, ...CARRY_INVARIANTS]);
}
const done = (rt: Runtime, id: string) => { rt.runUntilIdle(20 * 300, [id]); return rt.records.get(id)!; };

test('take_from_bundle: pieces come off the stack one at a time onto the take-out spot, the stack empties and goes; refusals name the problem', () => {
  const rt = yardRt();
  const spot = { x: 0, z: 1.4, yaw: 0 }; // beside the 12 ft beam stack (0.51 m deep)
  assert.equal(rt.submit('take_from_bundle', { crew: ['p1'], bundle: 'beams', piece: 'b1', to: spot }).diagnostic?.code, 'crew.size', 'a 12 ft beam needs two');
  assert.equal(rt.submit('take_from_bundle', { crew: ['p1', 'p2'], bundle: 'beams', piece: 'b1', to: { x: 0, z: 5, yaw: 0 } }).diagnostic?.code, 'bundle.too-far');
  assert.equal(rt.submit('take_from_bundle', { crew: ['p1', 'p2'], bundle: 'ply', piece: 'saw', to: { x: 0, z: -4.5, yaw: 0 } }).diagnostic?.code, 'bundle.piece-exists');
  const a = rt.submit('take_from_bundle', { crew: ['p1', 'p2'], bundle: 'beams', piece: 'b1', to: spot });
  assert.equal(done(rt, a.id).status, 'completed', JSON.stringify(a.diagnostic));
  const b1 = rt.world.entities.b1;
  assert.equal(b1.def, 'beam-12ft');
  assert.equal(b1.phase, 'stored');
  assert.equal(b1.support?.kind, 'ground');
  assert.equal(b1.provenance.origin, HYPO.origin);
  assert.equal(b1.provenance.confidence, HYPO.confidence);
  assert.equal(b1.provenance.note, 'taken from beams; test yard');
  assert.equal(b1.label, `${def('beam-12ft').label} (from beams)`, 'stock origin remains inspectable');
  assert.equal(bundleCount(rt.world.entities.beams), 1);
  assert.deepEqual(Object.keys(rt.world.entities), Object.keys(rt.world.entities).slice().sort(), 'canonical entity order after adding');
  // the spot is taken until b1 is carried away
  const occ = rt.submit('take_from_bundle', { crew: ['p1', 'p2'], bundle: 'beams', piece: 'b2', to: spot });
  assert.equal(occ.diagnostic?.code, 'bundle.spot-occupied');
  assert.match(occ.diagnostic!.message, /occupied by b1/);
  const c = rt.submit('carry', { crew: ['p1', 'p2'], item: 'b1', to: { x: -8, z: 3, yaw: 0 } });
  assert.equal(done(rt, c.id).status, 'completed', JSON.stringify(rt.records.get(c.id)!.diagnostic));
  const a2 = rt.submit('take_from_bundle', { crew: ['p2', 'p3'], bundle: 'beams', piece: 'b2', to: spot });
  assert.equal(done(rt, a2.id).status, 'completed');
  assert.equal(rt.world.entities.beams, undefined, 'the emptied stack (its dunnage) is gone');
  assert.equal(rt.submit('take_from_bundle', { crew: ['p1', 'p2'], bundle: 'beams', piece: 'b3', to: spot }).diagnostic?.code, 'bundle.unknown');
  assert.deepEqual(rt.violations, []);
});

test('cut: 4x8 → 4x6 + a 4x2 offcut stored at the station, 16 ft 2x4 → two 8 ft; insufficient / wrong family / busy / not there are refused', () => {
  // pure plans
  assert.deepEqual(Object.keys(cutPlan('2x4-16ft', ['2x4-8ft', '2x4-8ft'])).sort(), ['cuts', 'offcut', 'ok', 'rest', 'waste']);
  const ins = cutPlan('2x4-16ft', ['2x4-8ft', '2x4-8ft', '2x4-4ft']);
  assert.ok(!ins.ok && ins.code === 'cut.insufficient');
  assert.match((ins as { message: string }).message, /\(4\.877 m\) cannot yield 8 ft 2x4 \+ 8 ft 2x4 \+ 4 ft 2x4 \(6\.096 m \+ 2 kerfs = 6\.102 m\)/);
  const wrong = cutPlan('2x4-16ft', ['plywood-4x6']);
  assert.ok(!wrong.ok && wrong.code === 'cut.wrong-stock');
  const rt = yardRt();
  // a sheet off the plywood bundle, carried to the station
  const t = rt.submit('take_from_bundle', { crew: ['p1', 'p2'], bundle: 'ply', piece: 'sh1', to: { x: 0, z: -3.95, yaw: 0 } });
  assert.equal(done(rt, t.id).status, 'completed');
  const far = rt.submit('cut', { actor: 'p3', station: 'saw', stock: 'sh1', cuts: [{ piece: 'p46', def: 'plywood-4x6' }] });
  assert.equal(far.diagnostic?.code, 'cut.stock-not-at-station');
  const c = rt.submit('carry', { crew: ['p1', 'p2'], item: 'sh1', to: { x: 8, z: -2.2, yaw: 0 } });
  assert.equal(done(rt, c.id).status, 'completed', JSON.stringify(rt.records.get(c.id)!.diagnostic));
  assert.equal(rt.submit('cut', { actor: 'p3', station: 'saw', stock: 'sh1', cuts: [{ piece: 'x', def: 'plywood-4x6' }, { piece: 'y', def: 'plywood-4x4' }] }).diagnostic?.code, 'cut.insufficient');
  const k = rt.submit('cut', { actor: 'p3', station: 'saw', stock: 'sh1', cuts: [{ piece: 'p46', def: 'plywood-4x6' }], offcut: 'off1' });
  // a second cut at the same station while it is busy
  const busy = rt.submit('cut', { actor: 'p1', station: 'saw', stock: 'sh1', cuts: [{ piece: 'q', def: 'plywood-4x6' }] });
  assert.equal(busy.diagnostic?.code, 'reservation.conflict');
  assert.equal(done(rt, k.id).status, 'completed', JSON.stringify(rt.records.get(k.id)!.diagnostic));
  const E = rt.world.entities;
  assert.equal(E.sh1, undefined, 'the stock is consumed');
  assert.equal(E.p46.def, 'plywood-4x6');
  assert.equal(E.off1.def, 'plywood-4x2');
  assert.equal(E.off1.phase, 'stored');
  const saw = E.saw.pose.p;
  assert.ok(Math.abs(E.off1.pose.p[0] - saw[0]) < 0.01 && E.off1.pose.p[2] > saw[2], 'offcut lies in the station out-feed');
  // outputs still in the out-feed → the station is occupied
  const t2 = rt.submit('take_from_bundle', { crew: ['p1', 'p2'], bundle: 'studs', piece: 'st1', to: { x: 0, z: 6.9, yaw: 0 } });
  assert.equal(done(rt, t2.id).status, 'completed');
  const c2 = rt.submit('carry', { crew: ['p1'], item: 'st1', to: { x: 8, z: -2, yaw: 0 } });
  assert.equal(done(rt, c2.id).status, 'completed', JSON.stringify(rt.records.get(c2.id)!.diagnostic));
  const occ = rt.submit('cut', { actor: 'p3', station: 'saw', stock: 'st1', cuts: [{ piece: 's8a', def: '2x4-8ft' }, { piece: 's8b', def: '2x4-8ft' }] });
  assert.equal(occ.diagnostic?.code, 'cut.station-occupied');
  assert.match(occ.diagnostic!.message, /occupied by p46/);
  const mv = rt.submit('carry', { crew: ['p1', 'p2'], item: 'p46', to: { x: 12, z: 5, yaw: 0 } });
  assert.equal(done(rt, mv.id).status, 'completed', JSON.stringify(rt.records.get(mv.id)!.diagnostic));
  const mv2 = rt.submit('carry', { crew: ['p1'], item: 'off1', to: { x: 12, z: 8, yaw: 0 } });
  assert.equal(done(rt, mv2.id).status, 'completed', JSON.stringify(rt.records.get(mv2.id)!.diagnostic));
  const k2 = rt.submit('cut', { actor: 'p3', station: 'saw', stock: 'st1', cuts: [{ piece: 's8a', def: '2x4-8ft' }, { piece: 's8b', def: '2x4-8ft' }] });
  assert.equal(done(rt, k2.id).status, 'completed', JSON.stringify(rt.records.get(k2.id)!.diagnostic));
  assert.equal(rt.world.entities.st1, undefined);
  assert.equal(rt.world.entities.s8a.def, '2x4-8ft');
  assert.equal(rt.world.entities.s8b.def, '2x4-8ft');
  assert.equal(Object.keys(rt.world.entities).filter((id) => id.startsWith('st1')).length, 0, 'no offcut from 16 → 8 + 8');
  assert.deepEqual(rt.violations, []);
});

void component;

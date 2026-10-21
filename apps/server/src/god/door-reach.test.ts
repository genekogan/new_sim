// RT (2026-10-20): every building a god places is enterable through its front door at any yaw, on any slope.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { coreRef } from '@sim/world-compiler';
import { fixture, factory } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';
import { GroundHost } from './ground-host.ts';
import { runQuery } from './query.ts';
import structures from '../../../../packages/world-compiler/src/core-kit/structures.json' with { type: 'json' };
import vocabW3 from '../../../../packages/world-compiler/src/core-kit/vocab-w3.json' with { type: 'json' };

/* eslint-disable @typescript-eslint/no-explicit-any */
type Vec2 = [number, number];
function world(t: TestContext) {
  const w = fixture(':memory:', factory, { durableClockV1: true });
  w.brain.quiesce();
  const god = new GodMode(w.db, { worldId: w.host.worldId, ownerId: 'owner', tick: () => w.host.engine.world.tick, emit() {} });
  new GroundHost(w.db, w.host, god);
  const edge = new EdgeLedger(w.host, w.db), bridge = installEngineBridge({ host: w.host, god, edge, log() {}, worldClock: false, worldLore: false });
  t.after(() => { w.brain.quiesce(); w.host.stop(); edge.comms?.close(); w.db.close(); });
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { w.host.tickOnce(); await setImmediate(); w.host.drainInputs(); } };
  const act = (ops: any[]) => { const r = god.act({ ops }) as any; assert.equal(r.accepted, true, JSON.stringify(r)); return r; };
  const E = w.host.engine as any;
  return { ...w, god, bridge, settle, act, E };
}

const COTTAGE = { w: 8, d: 6, floors: 1, floorHeight: 2.8, style: 'cottage', roof: 'gable', roofPitch: 32, material: 'plaster', front: 's', porch: 0, balcony: false, windows: 0.6, wallThickness: 0.22 };

test('bench-hamlet: the cottage on the knoll is enterable from the arrival point', { timeout: 300_000 }, async (t) => {
  const w = world(t); await w.settle(2);
  w.act([
    { op: 'place', def: coreRef('knoll'), name: 'knoll', p: [40, 10], params: { height: 4, radius: 22, peak: 1, edge: 8 } },
  ]);
  await w.settle(2);
  for (const [label, r, onKnoll] of [['yaw0-flat', 0, false], ['yaw-1.07-flat', -1.0685826404927201, false], ['yaw0-knoll', 0, true], ['yaw-1.07-knoll', -1.0685826404927201, true]] as const) {
    const p: Vec2 = onKnoll ? [44, 10] : [-30, -30];
    w.act([{ op: 'place', def: coreRef('cottage'), name: 'cottage', p, r, params: COTTAGE }]);
    await w.settle(4);
    const e = w.god.model.get('cottage')!;
    const start: Vec2 = onKnoll ? [0, 3.5] : [-30, -20];
    const out: string[] = [label, `y=${e.p?.[1]?.toFixed(3)}`];
    for (const room of ['cottage', 'cottage/living', 'cottage/bedroom', 'cottage/kitchen']) {
      const th = w.bridge.nav.thing(room);
      const goal = th ? w.bridge.nav.goal(th, start) : null;
      const r2 = goal ? w.E.reachV1({ p: start, level: 0 }, goal) : null;
      out.push(`${room}:${goal ? (r2.ok ? 'ok' : r2.code) : 'no-goal'}`);
    }
    console.log(out.join(' '));
    assert.deepEqual(out.slice(2).filter((x) => !x.endsWith(':ok')), [], out.join(' '));
    w.act([{ op: 'remove', id: 'cottage' }]);
    await w.settle(2);
  }
});

test('bench-hamlet: an old pad/1 cottage pad is re-cut at boot and the cottage becomes enterable', { timeout: 300_000 }, async (t) => {
  const w = fixture(':memory:', factory, { durableClockV1: true });
  w.brain.quiesce();
  t.after(() => { w.brain.quiesce(); w.host.stop(); w.db.close(); });
  const opts = { worldId: w.host.worldId, ownerId: 'owner', tick: () => w.host.engine.world.tick, emit() {} };
  const first = new GodMode(w.db, opts);
  const r = first.act({ ops: [
    { op: 'place', def: coreRef('knoll'), name: 'knoll', p: [40, 10], params: { height: 4, radius: 22, peak: 1, edge: 8 } },
    { op: 'place', def: coreRef('cottage'), name: 'cottage', p: [44, 10], r: -1.0685826404927201, params: COTTAGE },
  ] }) as any;
  assert.equal(r.accepted, true, JSON.stringify(r));
  const id = first.model.get('cottage')!.id;
  // what a world built before pad/2 stored: the same flat at the same level, a 1.5 m blend, no grade, no landings
  const row = w.db.db.prepare('SELECT body FROM world_meta_v1 WHERE world_id=?').get(w.host.worldId) as { body: string };
  const meta = JSON.parse(row.body);
  const pad = meta.ground.landforms.find((l: any) => l.id === `${id}:pad`);
  assert.ok(pad?.grade, 'a new placement gets a graded pad');
  delete pad.grade; delete pad.aprons; pad.edge = 1.5;
  w.db.db.prepare('UPDATE world_meta_v1 SET body=? WHERE world_id=?').run(JSON.stringify(meta), w.host.worldId);
  const god = new GodMode(w.db, opts);
  assert.deepEqual(god.regraded, [id]);
  const after = god.model.ground().landforms.find((l) => l.id === `${id}:pad`) as any;
  assert.equal(after.grade, 0.45); assert.ok(after.aprons?.length >= 1);
  assert.equal(after.level, pad.level);
  assert.deepEqual(god.model.get('cottage')!.p, first.model.get('cottage')!.p, 'the cottage stays where it stood');
  assert.deepEqual(new GodMode(w.db, opts).regraded, [], 'a graded pad is left alone at the next boot');
  new GroundHost(w.db, w.host, god);
  const edge = new EdgeLedger(w.host, w.db), bridge = installEngineBridge({ host: w.host, god, edge, log() {}, worldClock: false, worldLore: false });
  t.after(() => edge.comms?.close());
  for (let i = 0; i < 6; i++) { w.host.tickOnce(); await setImmediate(); w.host.drainInputs(); }
  const start: Vec2 = [0, 3.5];
  for (const room of ['cottage', 'cottage/living', 'cottage/bedroom']) {
    const th = bridge.nav.thing(room), goal = th ? bridge.nav.goal(th, start) : null;
    const reach = goal ? (w.host.engine as any).reachV1({ p: start, level: 0 }, goal) : null;
    assert.equal(reach?.ok, true, `${room}: ${goal ? reach?.code : 'no goal'}`);
  }
});

/** Every building/1 type in the catalogue (structures.json + vocab-w3.json: 40 types). */
const BUILDING_TYPES = [...structures, ...vocabW3].filter((d: any) => d?.make?.gen === 'building/1').map((d: any) => coreRef(String(d.name).replace(/^core-/, '')));
const YAWS = Array.from({ length: 48 }, (_, i) => i * 7.5);
/**
 * Door sweep: each building placed on flat ground and on two slopes of a knoll (h 12, r 60: ~0.24 at 40 m, ~0.34 at 25 m
 * out), and a Soul 5 m outside reaches the building's goal inside through its front door. The gate runs a fixed subset
 * (every type once per terrain, at a yaw that differs by type and terrain: 120 placements); the full sweep (40 types x 48
 * yaws x 3 terrains = 5,760, ~20 min) is `RT_SWEEP=full node --test --test-name-pattern="door sweep" src/god/door-reach.test.ts`
 * (RT_TYPES=a,b / RT_STEP / RT_DISTS narrow it; RT_ROOMS=1 also lists unreachable rooms, reported but not asserted).
 */
test('door sweep: every catalogue building is enterable through its front door at any yaw and slope', { timeout: 3_600_000 }, async (t) => {
  const w = world(t); await w.settle(2);
  const KNOLL: Vec2 = [0, 0];
  w.act([{ op: 'place', def: coreRef('knoll'), name: 'hill', p: KNOLL, params: { height: 12, radius: 60, peak: 1, edge: 8 } }]);
  await w.settle(2);
  const full = process.env.RT_SWEEP === 'full' || !!process.env.RT_TYPES;
  const defs: string[] = process.env.RT_TYPES ? process.env.RT_TYPES.split(',').map((x) => x.includes('@') ? x : coreRef(x)) : BUILDING_TYPES;
  assert.equal(BUILDING_TYPES.length, 40, 'the catalogue has 40 building/1 types');
  const yaws = process.env.RT_STEP ? Array.from({ length: Math.ceil(360 / Number(process.env.RT_STEP)) }, (_, i) => i * Number(process.env.RT_STEP)) : YAWS;
  const dists = (process.env.RT_DISTS ?? '200,40,25').split(',').map(Number);
  const cases: [string, number, number][] = [];
  defs.forEach((def, i) => dists.forEach((dist, j) => { if (full) for (const deg of yaws) cases.push([def, dist, deg]); else cases.push([def, dist, YAWS[(i * 7 + j * 17 + 3) % YAWS.length]]); }));
  const fails: string[] = [], refused: string[] = [], roomFails: string[] = []; let n = 0;
  const table = new Map<string, { n: number; fail: number; refused: number }>();
  const row = (dist: number) => { const k = dist >= 100 ? 'flat' : `knoll d${dist}`; if (!table.has(k)) table.set(k, { n: 0, fail: 0, refused: 0 }); return table.get(k)!; };
  for (const [def, dist, deg] of cases) {
    const at: Vec2 = [KNOLL[0] + dist, KNOLL[1]];
    const slope = w.god.model.terrain.slope(at[0], at[1]);
    const r: any = w.god.act({ ops: [{ op: 'place', def, name: 'b', p: at, r: deg * Math.PI / 180 }] });
    if (!r.accepted) { refused.push(`${def} d${dist} ${deg}: refused ${r.failures?.[0]?.code ?? JSON.stringify(r).slice(0, 120)}`); row(dist).refused++; continue; }
    await w.settle(3);
    const e = w.god.model.get('b')!, box = w.god.model.bake(w.god.model.resolvedDef(e.def)!, e.params ?? {}, e.seed ?? 0, e.shape).box;
    const start: Vec2 = [at[0] + Math.hypot(box[0], box[2]) / 2 + 5, at[1]];
    const th = w.bridge.nav.thing('b'), goal = th ? w.bridge.nav.goal(th, start) : null;
    const reach = goal ? w.E.reachV1({ p: start, level: 0 }, goal) : null;
    n++; row(dist).n++;
    if (!reach?.ok) { fails.push(`${def} d${dist} s${slope.toFixed(2)} ${deg}: ${goal ? reach.code : 'no-goal'}`); row(dist).fail++; }
    else if (process.env.RT_ROOMS) {
      const rooms = (w.god.model.bake(w.god.model.resolvedDef(e.def)!, e.params ?? {}, e.seed ?? 0, e.shape) as any).rooms ?? [];
      const bad: string[] = [];
      for (const rm of rooms) { const t2 = w.bridge.nav.thing(`b/${rm.id}`), g2 = t2 ? w.bridge.nav.goal(t2, start) : null; const r2 = g2 ? w.E.reachV1({ p: start, level: 0 }, g2) : null; if (!r2?.ok) bad.push(`${rm.id}:${g2 ? r2.code : 'no-goal'}`); }
      if (bad.length) roomFails.push(`${def} d${dist} s${slope.toFixed(2)} ${deg}: ${bad.length}/${rooms.length} rooms ${bad.join(' ')}`);
    }
    w.act([{ op: 'remove', id: 'b' }]);
    await w.settle(1);
  }
  console.log(`door sweep (${full ? 'full' : 'gate subset'}): ${n} placements, ${fails.length} front-door failures, ${refused.length} refused placements`);
  for (const [k, v] of table) console.log(`  ${k}: ${v.n} placed, ${v.fail} failed, ${v.refused} refused`);
  for (const f of [...fails, ...refused]) console.log('  ' + f);
  if (process.env.RT_ROOMS) { console.log(`rooms: ${roomFails.length} placements with an unreachable room`); for (const f of roomFails) console.log('  ' + f); }
  assert.deepEqual(fails, [], 'every placed building is enterable through its front door');
  assert.ok(n >= cases.length * 0.9, `most placements are accepted (${n}/${cases.length})`);
});

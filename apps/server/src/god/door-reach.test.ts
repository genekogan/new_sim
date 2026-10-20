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

/** Every building/1 type in the catalogue, at yaws 0–360° in 7.5° steps, on flat ground and on the flank of a knoll. */
test('door sweep: every catalogue building is enterable through its front door at any yaw and slope', { timeout: 3_600_000 }, async (t) => {
  const w = world(t); await w.settle(2);
  const KNOLL: Vec2 = [0, 0];
  w.act([{ op: 'place', def: coreRef('knoll'), name: 'hill', p: KNOLL, params: { height: 12, radius: 60, peak: 1, edge: 8 } }]);
  await w.settle(2);
  const defs: string[] = (process.env.RT_TYPES ?? '').split(',').filter(Boolean);
  const steps = Number(process.env.RT_STEP ?? 7.5);
  const dists = (process.env.RT_DISTS ?? '200,40,25').split(',').map(Number);
  const fails: string[] = [], roomFails: string[] = []; let n = 0;
  for (const def of defs) for (const dist of dists) for (let deg = 0; deg < 360; deg += steps) {
    const at: Vec2 = [KNOLL[0] + dist, KNOLL[1]];
    const slope = w.god.model.terrain.slope(at[0], at[1]);
    const r: any = w.god.act({ ops: [{ op: 'place', def, name: 'b', p: at, r: deg * Math.PI / 180 }] });
    if (!r.accepted) { fails.push(`${def} d${dist} ${deg}: refused ${r.failures?.[0]?.code ?? JSON.stringify(r).slice(0, 120)}`); continue; }
    await w.settle(3);
    const e = w.god.model.get('b')!, box = w.god.model.bake(w.god.model.resolvedDef(e.def)!, e.params ?? {}, e.seed ?? 0, e.shape).box;
    const start: Vec2 = [at[0] + Math.hypot(box[0], box[2]) / 2 + 5, at[1]];
    const th = w.bridge.nav.thing('b'), goal = th ? w.bridge.nav.goal(th, start) : null;
    const reach = goal ? w.E.reachV1({ p: start, level: 0 }, goal) : null;
    n++;
    if (!reach?.ok) fails.push(`${def} d${dist} s${slope.toFixed(2)} ${deg}: ${goal ? reach.code : 'no-goal'}`);
    else if (process.env.RT_ROOMS) {
      const rooms = (w.god.model.bake(w.god.model.resolvedDef(e.def)!, e.params ?? {}, e.seed ?? 0, e.shape) as any).rooms ?? [];
      const bad: string[] = [];
      for (const rm of rooms) { const t2 = w.bridge.nav.thing(`b/${rm.id}`), g2 = t2 ? w.bridge.nav.goal(t2, start) : null; const r2 = g2 ? w.E.reachV1({ p: start, level: 0 }, g2) : null; if (!r2?.ok) bad.push(`${rm.id}:${g2 ? r2.code : 'no-goal'}`); }
      if (bad.length) roomFails.push(`${def} d${dist} s${slope.toFixed(2)} ${deg}: ${bad.length}/${rooms.length} rooms ${bad.join(' ')}`);
    }
    w.act([{ op: 'remove', id: 'b' }]);
    await w.settle(1);
  }
  console.log(`sweep: ${n} placements, ${fails.length} failures`);
  for (const f of fails) console.log('  ' + f);
  console.log(`rooms: ${roomFails.length} placements with an unreachable room`);
  for (const f of roomFails) console.log('  ' + f);
});

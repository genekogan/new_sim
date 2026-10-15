// `describe` and a resident must agree about stairs. Story run S1 (a lighthouse): `describe` said every floor of a 4 and
// a 5 floor lighthouse was "reachable from outside", and the verify-use probe could not reach floor 3 (9.1 m up) or above.
// Causes: the generator fenced the flight into floor 3 in with six rails (building-layout.ts), and the bridge handed the
// planner a helix flight as a straight chord whose "stand 0.7 m back" points lay in walls and rails (engine-bridge.ts
// helixEnds). Here the engine's route planner, the physical probe and `describe` are asked about the same buildings.
import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {buildingPhysics} from '@sim/generators';
import {coreRef} from '@sim/world-compiler';
import {fixture, factory} from '../../test/native-owner-fixture.ts';
import {EdgeLedger} from '../edge/ledger/ledger.ts';
import {GodMode} from './god.ts';
import {installEngineBridge, helixEnds} from './engine-bridge.ts';
import {VerifyUse} from './verify-use.ts';
import {runQuery, type WalkReport} from './query.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
function world(t: TestContext) {
  const w = fixture(':memory:', factory, {durableClockV1: true});
  w.brain.quiesce();
  const god = new GodMode(w.db, {worldId: w.host.worldId, ownerId: 'owner', tick: () => w.host.engine.world.tick, emit() {}});
  const edge = new EdgeLedger(w.host, w.db), bridge = installEngineBridge({host: w.host, god, edge, log() {}, worldClock: false, worldLore: false});
  const verify = new VerifyUse(w.host, w.souls, god, edge);
  t.after(() => {w.brain.quiesce(); w.host.stop(); edge.comms?.close(); w.db.close();});
  const settle = async (n = 4) => {for (let i = 0; i < n; i++) {w.host.tickOnce(); await setImmediate(); w.host.drainInputs();}};
  /** Tick the host while the probe walks (the same bounded drive as verify-use.test.ts). */
  const drive = async <T>(work: Promise<T>, ms = 60_000): Promise<T> => {
    let done = false; void work.then(() => {done = true;}, () => {done = true;});
    const deadline = performance.now() + ms;
    while (!done && performance.now() < deadline) {for (let i = 0; i < 4; i++) w.host.tickOnce(); await new Promise(r => setTimeout(r, 1));}
    assert.ok(done, 'bounded probe walk'); return work;
  };
  const describe = (ref: string) => (runQuery(god.model, {describe: ref}) as any).describe;
  return {...w, god, bridge, verify, settle, drive, describe};
}

/** Where a chair fits in the top room: inside the stair well's disc, clear of the lamp and of the rails. */
const TOP: Record<string, {room: string; at: [number, number, number]}> = {'core/lighthouse@1': {room: 'lantern', at: [1.0, 0, -0.2]}, 'core/tower@1': {room: 'top', at: [0.6, 0, -0.5]}};

const designSaysReachable = (d: any, rooms: number) => d.notes.includes(`reachable from outside: all ${rooms} rooms`);
const walkable = (walk: WalkReport | undefined, rooms: number) => walk?.state === 'ok' && walk.rooms.length === rooms && walk.rooms.every(r => r.in === true && r.out === true);

for (const [def, floors] of [['core/lighthouse@1', 3], ['core/lighthouse@1', 4], ['core/lighthouse@1', 5], ['core/tower@1', 3]] as const) {
  test(`${def} with ${floors} floors: describe, the planner and a resident walking up to the top floor agree`, {timeout: 120_000}, async t => {
    const w = world(t); await w.settle(2);
    const top = TOP[def];
    const r = w.god.act({ops: [
      {op: 'place', tmp: '$b', def, name: 'tower', p: [8, 0], params: {floors}},
      {op: 'place', def: coreRef('chair'), name: 'chair', in: {parent: '$b', slot: top.room}, p: top.at},
    ]}) as any;
    assert.equal(r.accepted, true, JSON.stringify(r));
    await w.settle();
    const d = w.describe('tower');
    // the design graph (what S1 read) and the engine's own route check
    assert.ok(designSaysReachable(d, floors), d.notes.join(' | '));
    assert.ok(walkable(d.walk, floors), JSON.stringify(d.walk));
    assert.equal(d.rooms.length, floors);
    // every room of every floor, both ways, from the stand outside the door
    for (const room of d.rooms) {
      const up = runQuery(w.god.model, {reach: {from: d.walk.from, to: `tower:${room.id}`}}).reach as any;
      const down = runQuery(w.god.model, {reach: {from: `tower:${room.id}`, to: d.walk.from}}).reach as any;
      assert.equal(up.reachable, true, `in to ${room.id} (floor ${room.floor}): ${JSON.stringify(up)}`);
      assert.equal(down.reachable, true, `out of ${room.id} (floor ${room.floor}): ${JSON.stringify(down)}`);
    }
    // an independent resident: the probe walks the whole way from outside (explicit `from` is the full physical walk) and sits
    const got = await w.drive(w.verify.run({target: 'tower', seat: 'tower/chair', from: d.walk.from, timeoutMs: 90_000})) as any;
    assert.equal(got.ok, true, JSON.stringify(got.uses));
    assert.deepEqual(got.uses.map((u: any) => [u.use, u.ok]), [['enter', true], ['sit', true]]);
    assert.ok(got.uses.find((u: any) => u.use === 'sit').distanceToSlot <= 0.6);
  });
}

test('taller towers, turned and off the grid: every room of 2 to 6 floors walks in and out (describe agrees)', {timeout: 120_000}, async t => {
  const w = world(t); await w.settle(2);
  const towers: {name: string; def: string; floors: number; yaw: number; at: [number, number]}[] = [];
  let k = 0;
  for (const def of ['core/lighthouse@1', 'core/tower@1']) for (const [floors, yaw] of [[6, 0.7], [6, 2.2], [5, 4.0], [4, 5.5], [3, 1.3], [2, 0]] as const) {
    towers.push({name: `t${k}`, def, floors, yaw, at: [-21 + 14.3 * (k % 4) + 0.137 * k, -21 + 14.3 * Math.floor(k / 4) + 0.291 * k]}); k++;
  }
  const r = w.god.act({ops: towers.map(x => ({op: 'place', def: x.def, name: x.name, p: x.at, r: x.yaw, params: {floors: x.floors}}))}) as any;
  assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 300));
  await w.settle();
  for (const x of towers) {
    const d = w.describe(x.name);
    assert.ok(designSaysReachable(d, x.floors), `${x.name}: ${d.notes.join(' | ')}`);
    assert.ok(walkable(d.walk, x.floors), `${x.name} (${x.def}, ${x.floors} floors, yaw ${x.yaw}): ${JSON.stringify(d.walk)}`);
  }
});

test('describe reports what the engine says when the design graph is wrong, and "pending" while the engine is behind the model', {timeout: 60_000}, async t => {
  const w = world(t); await w.settle(2);
  assert.equal((w.god.act({ops: [{op: 'place', def: 'core/lighthouse@1', name: 'tower', p: [8, 0], params: {floors: 4}}]}) as any).accepted, true);
  // the edit is in the model; the engine has not taken it in yet
  assert.equal(w.describe('tower').walk.state, 'pending');
  await w.settle();
  assert.equal(w.describe('tower').walk.state, 'ok');
  // a wall across the only door (a legacy world can have one; new construction is refused): the graph still says "all 4 rooms",
  // the planner and the probe cannot get in, and describe says so
  const wall = {id: 'e_legacywall', def: coreRef('wall'), name: 'blocker', in: {parent: 'world'}, p: [8, 0, 3.6] as [number, number, number], params: {w: 6, h: 3, d: 1}, by: 'legacy-fixture', born: 0, v: 1};
  (w.god.model as any).insert(wall); (w.god.model as any).index(wall.id, (w.god.model as any).footprint(wall)); w.bridge.reconcile();
  await w.settle();
  const d = w.describe('tower');
  assert.ok(designSaysReachable(d, 4), 'the design graph does not see the wall');
  assert.equal(d.walk.state, 'failed');
  assert.ok(d.walk.rooms.every((r: any) => r.in !== true), JSON.stringify(d.walk.rooms));
  const got = await w.drive(w.verify.run({target: 'tower', uses: ['enter'], from: d.walk.from, timeoutMs: 5000})) as any;
  assert.equal(got.ok, false, 'a resident cannot get in either');
});

test('a helix flight is bridged with its landings off the first tread and a standing place further in; straight flights are untouched', () => {
  const lighthouse = buildingPhysics({style: 'tower', w: 6, d: 6, floors: 4, floorHeight: 3, roof: 'dome'}, {round: true, lantern: true});
  for (const l of lighthouse.links!) {
    const h = helixEnds(l.path)!;
    assert.ok(h, `${l.id} is a helix`);
    const centreDist = (p: [number, number]) => Math.hypot(p[0], p[1]);
    // landings move towards the axis of the well, the standing places further still, on the same radial line
    assert.ok(centreDist(h.foot) < centreDist(l.path[0]) - 0.15 && centreDist(h.head) < centreDist(l.path[l.path.length - 1]) - 0.15);
    assert.ok(centreDist(h.stepFrom) < centreDist(h.foot) - 0.6 && centreDist(h.stepTo) < centreDist(h.head) - 0.6);
  }
  const cottage = buildingPhysics({style: 'cottage', w: 8, d: 6, floors: 2});
  assert.equal(cottage.links!.length, 1);
  assert.equal(helixEnds(cottage.links![0].path), null, 'a straight flight keeps the planner\'s own approach points');
});

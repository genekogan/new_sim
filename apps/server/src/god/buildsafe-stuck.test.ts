// BUILDSAFE (lane BS3, 2026-10-21): Souls never stuck. (b) The coarse ground search runs through enterable buildings (only
// big solids are coarse-solid), so a walk's intermediate hop could end inside a closed room no fine route reaches and the
// whole walk failed route.unreachable (eden-2026: jetty -> cliff-village chapel stopped at old-town-north-arcade-1). The
// planner now retries waypoints along the same coarse path (spatial/tiled.ts hopRetries), paged and unpaged ground.
import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {fixture, factory} from '../../test/native-owner-fixture.ts';
import {EdgeLedger} from '../edge/ledger/ledger.ts';
import {GodMode} from './god.ts';
import {installEngineBridge} from './engine-bridge.ts';
import {GroundHost} from './ground-host.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Vec2 = [number, number];
function world(t: TestContext, paged: boolean) {
  const was = process.env.NAV_PAGED;
  process.env.NAV_PAGED = paged ? '1' : '0';
  const w = fixture(':memory:', factory, {durableClockV1: true});
  w.brain.quiesce();
  const god = new GodMode(w.db, {worldId: w.host.worldId, ownerId: 'owner', tick: () => w.host.engine.world.tick, emit() {}});
  new GroundHost(w.db, w.host, god);
  const edge = new EdgeLedger(w.host, w.db), bridge = installEngineBridge({host: w.host, god, edge, log() {}, worldClock: false, worldLore: false});
  t.after(() => {w.brain.quiesce(); w.host.stop(); edge.comms?.close(); w.db.close(); if (was === undefined) delete process.env.NAV_PAGED; else process.env.NAV_PAGED = was;});
  const settle = async (n = 4) => {for (let i = 0; i < n; i++) {w.host.tickOnce(); await setImmediate(); w.host.drainInputs();}};
  const act = (ops: any[]) => {const r = god.act({ops}) as any; assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 600)); return r;};
  return {...w, god, bridge, edge, settle, act, E: w.host.engine as any};
}
const box = (name: string, x: number, z: number) => ({schema: 'def/1', name, version: 1, layer: 'solid', size: {box: [x, 3, z]}, make: {kind: 'gen', gen: 'kit/2', args: {shapes: [{kind: 'box', at: [0, 1.5, 0], size: [x, 3, z]}]}}});
/** A closed room (four 1 m walls, inner side `s`, no door) round c: thin solids the coarse search walks straight through. */
function ring(c: Vec2, s: number, tag: string) {
  const h = s / 2 + 0.5;
  return [{op: 'define', def: box(`${tag}long`, s + 2, 1)}, {op: 'define', def: box(`${tag}short`, s - 0.1, 1)},
    {op: 'place', def: `${tag}short@1`, name: `${tag}n`, p: [c[0], c[1] + h]}, {op: 'place', def: `${tag}short@1`, name: `${tag}s`, p: [c[0], c[1] - h]},
    {op: 'place', def: `${tag}long@1`, name: `${tag}e`, p: [c[0] + h, c[1]], r: Math.PI / 2}, {op: 'place', def: `${tag}long@1`, name: `${tag}w`, p: [c[0] - h, c[1]], r: Math.PI / 2}];
}
export {world, ring, box};

for (const paged of [true, false]) {
  test(`a closed room on the coarse path's hop waypoint is walked round, not a dead end (${paged ? 'paged' : 'unpaged'} ground)`, {timeout: 300_000}, async t => {
    const w = world(t, paged); await w.settle(2);
    assert.equal(w.E.world.groundV1?.nav === 'paged/1', paged, 'the ground navigates as asked');
    const A: Vec2 = [0.5, 20.5], B: Vec2 = [110.5, 20.5];
    assert.equal(w.E.reachV1({p: A}, {p: B}).ok, true, 'open lawn before');
    // the first hop ends 48 coarse cells along the straight line: (48.5, 20.5), the middle of this room
    w.act(ring([48.5, 20.5], 7, 'r')); await w.settle(3);
    assert.equal(w.E.reachV1({p: A}, {p: [48.5, 20.5]}).ok, false, 'the room is closed');
    const r = w.E.reachV1({p: A}, {p: B});
    assert.equal(r.ok, true, `${A} -> ${B} round the room: ${JSON.stringify(r).slice(0, 300)}`);
    // and back the other way (the hop from the east end lands in the room too when the distance matches)
    assert.equal(w.E.reachV1({p: [97, 20.5]}, {p: [0.5, 20.5]}).ok, true, 'west round the room');
  });
}

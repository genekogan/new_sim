// arrival-search/1 (lane ARR, 2026-10-20): a god who builds over the arrival point is told where new Souls will arrive
// (bench-hamlet's giant telescope on (0,0) refused every approved Soul before lane PB). The note names a place, never a
// command; it is said once per change and not for edits elsewhere.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { fixture, invite, accept, factory } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
function world(t: TestContext) {
  const w = fixture(':memory:', factory, { durableClockV1: true }); w.brain.quiesce();
  const god = new GodMode(w.db, { worldId: w.host.worldId, ownerId: 'owner', tick: () => w.host.engine.world.tick, now: () => 1_000_000, emit() {} });
  const edge = new EdgeLedger(w.host, w.db); installEngineBridge({ host: w.host, god, edge, log() {}, worldClock: false, worldLore: false });
  const token = god.mintFor({ id: 'owner', role: 'user' }, 'builder'); god.godIdentity(token);
  t.after(() => { w.brain.quiesce(); w.host.stop(); edge.comms?.close(); w.db.close(); });
  const settle = async (n = 3) => { for (let i = 0; i < n; i++) { w.host.tickOnce(); await setImmediate(); w.host.drainInputs(); } };
  return { ...w, god, settle };  // callers settle once first: the bridge reconciles on the first tick, as in a running world
}
const slab = { schema: 'def/1', name: 'slab', version: 1, layer: 'solid', size: { box: [30, 3, 30] }, make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, 1.5, 0], size: [30, 3, 30] }] } } };
const NOTE = /^Arrival point is blocked; new Souls will arrive nearby at (-?\d+\.\d), (-?\d+\.\d)\.$/;

test('building over the arrival point tells the god where new Souls will arrive, and a new Soul arrives there', async t => {
  const w = world(t); await w.settle(1);
  const r: any = w.god.act({ ops: [{ op: 'define', def: slab }, { op: 'place', def: 'slab@1', name: 'slab', p: [0, 0] }] });
  assert.equal(r.accepted, true, JSON.stringify(r.failures));
  const notes = r.warnings.filter((x: string) => x.startsWith('Arrival point'));
  assert.equal(notes.length, 1, JSON.stringify(r.warnings)); const m = notes[0].match(NOTE); assert.ok(m, notes[0]);
  assert.doesNotMatch(notes[0], /god|command|--|`/i, 'a place, no command');
  const at: [number, number] = [Number(m![1]), Number(m![2])];
  assert.ok(Math.max(Math.abs(at[0]), Math.abs(at[1])) >= 15, `outside the 30 m slab: ${at}`);
  // an edit far away says nothing; an edit near it while the note stands and nothing changed says nothing again
  const far: any = w.god.act({ ops: [{ op: 'place', def: 'slab@1', name: 'far', p: [-200, -200] }] });
  assert.equal(far.warnings.some((x: string) => x.startsWith('Arrival point')), false);
  await invite(w, 'ana'); const row: any = await accept(w.host, w.souls.create('dev:ana', { name: 'Ana', description: 'curious' })); await w.settle();
  const body = w.host.engine.world.entities[row.entity_id]!;
  assert.ok(Math.hypot(body.pose.p[0] - at[0], body.pose.p[2] - at[1]) < 0.1, `born where the note said: ${body.pose.p} vs ${at}`);
  assert.equal(w.db.events(w.host.worldId).find(e => e.kind === 'birth' && e.payload.soulId === row.id)?.payload.near?.first, true);
  // clearing the arrival point clears the note silently; building over it again says it again
  const gone: any = w.god.act({ ops: [{ op: 'remove', id: 'slab' }] });
  assert.equal(gone.accepted, true); assert.equal(gone.warnings.some((x: string) => x.startsWith('Arrival point')), false);
  const again: any = w.god.act({ ops: [{ op: 'place', def: 'slab@1', name: 'slab2', p: [0, 0] }] });
  assert.equal(again.warnings.filter((x: string) => NOTE.test(x)).length, 1);
});

test('an edit that leaves the arrival point clear adds no note', async t => {
  const w = world(t); await w.settle(1);
  const r: any = w.god.act({ ops: [{ op: 'define', def: slab }, { op: 'place', def: 'slab@1', name: 'slab', p: [40, 0] }] });
  assert.equal(r.accepted, true); assert.equal(r.warnings.some((x: string) => x.startsWith('Arrival point')), false);
});

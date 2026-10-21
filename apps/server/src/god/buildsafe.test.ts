// buildsafe/1 (lane BS2, 2026-10-21): a god edit that would leave something with no walk to it is repaired inside the
// same batch (journaled with it, undone with it) and never refused: a piece nudged out of a doorway, a gate opened in a
// wall built round a bench; what cannot be repaired is one line to the god naming what, why and an op that fixes it.
// Real host, god compiler and engine bridge; walks are asked of the engine (reach), not of the repair's own raster.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { coreRef } from '@sim/world-compiler';
import { fixture, factory } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';
import { runQuery } from './query.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
async function world(t: any) {
  const f = fixture(':memory:', factory, { durableClockV1: true }); f.brain.quiesce();
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  installEngineBridge({ host: f.host, god, edge, log: () => {}, worldClock: false, worldLore: false });
  const settle = async (n = 3) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  t.after(() => { f.brain.quiesce(); f.host.stop(); edge.comms?.close(); f.db.close(); });
  await settle(2);
  return { ...f, god, settle };
}
const ok = (r: any) => { assert.equal(r.accepted, true, JSON.stringify(r.failures ?? r).slice(0, 600)); return r; };
const reach = (w: any, from: [number, number], to: string) => runQuery(w.god.model, { reach: { from, to } }).reach as any;
const show = (r: any) => { if (process.env.BS_SHOW) console.log(JSON.stringify(r.warnings, null, 1)); return r; };
const kept = (r: any) => show(r).warnings.filter((x: string) => x.startsWith('Kept a way open (buildsafe/1)'));
const journal = (w: any) => w.god.store.journal?.() ?? [];

test('walled garden with no gate round a bench: the wall gets a gate in the same batch; the bench is walked to', { timeout: 120000 }, async (t) => {
  const w = await world(t);
  const r = ok(w.god.act({ ops: [
    { op: 'place', def: coreRef('garden-wall'), name: 'garden-wall', shape: { path: [[-4, -4], [4, -4], [4, 4], [-4, 4], [-4, -4]] } },
    { op: 'place', def: coreRef('bench'), name: 'garden-bench', p: [0, 0] },
  ] }, 'a walled garden'));
  assert.equal(kept(r).length, 1, JSON.stringify(r.warnings));
  assert.match(kept(r)[0], /garden-wall has a 1 m gate .* so garden-bench can be walked to/);
  const gates = w.god.model.get('garden-wall')!.params?.gates as any[];
  assert.equal(gates?.length, 1, 'the gate is on the wall');
  await w.settle();
  const q = reach(w, [0, -10], 'garden-bench');
  assert.equal(q.reachable, true, JSON.stringify(q).slice(0, 300));
  // undone with the batch: wall, gate and bench go together
  ok(w.god.undo()); assert.equal(w.god.model.get('garden-wall'), undefined);
});

test('a crate dropped in a cottage doorway (outside and in): nudged clear; the rooms are walked to', { timeout: 120000 }, async (t) => {
  const w = await world(t);
  ok(w.god.act({ ops: [{ op: 'place', def: coreRef('cottage'), name: 'home', p: [0, 0] }, { op: 'place', def: coreRef('bench'), name: 'bed-bench', in: { parent: '$h', slot: 'bedroom' }, p: [-0.6, 0, 0], r: Math.PI / 2 }].map((o, i) => (i === 0 ? { ...o, tmp: '$h' } : o)) }));
  await w.settle();
  assert.equal(reach(w, [1.2, 8], 'home/bed-bench').reachable, true, 'reachable before');
  // a crate on the front step (outside, 0.4 m from the door) and one just inside the bedroom door
  const r = ok(w.god.act({ ops: [
    { op: 'place', def: coreRef('crate'), name: 'step-crate', p: [1.175, 3.25] },
    { op: 'place', def: coreRef('crate'), name: 'door-crate', in: { parent: w.god.model.get('home')!.id, slot: 'bedroom' }, p: [0.72, 0, -0.025] },
  ] }, 'two crates'));
  assert.ok(kept(r).length >= 1, JSON.stringify(r.warnings));
  assert.equal(r.warnings.some((x: string) => /No walk reaches/.test(x)), false, JSON.stringify(r.warnings));
  await w.settle();
  const q = reach(w, [1.2, 8], 'home/bed-bench');
  assert.equal(q.reachable, true, JSON.stringify(q).slice(0, 300));
  assert.ok(w.god.model.get('step-crate') && w.god.model.get('home/door-crate'), 'both crates stand (nothing dropped)');
});

test('a wall ring of plain blocks round a bench: never refused; one actionable line (what, why, op)', { timeout: 120000 }, async (t) => {
  const w = await world(t);
  const box = (name: string, x: number, z: number) => ({ schema: 'def/1', name, version: 1, layer: 'solid', size: { box: [x, 2, z] }, make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, 1, 0], size: [x, 2, z] }] } } });
  const r = ok(w.god.act({ ops: [
    { op: 'define', def: box('blk-long', 9, 1) }, { op: 'define', def: box('blk-short', 6.9, 1) },
    { op: 'place', def: 'blk-short@1', name: 'wn', p: [0, 4] }, { op: 'place', def: 'blk-short@1', name: 'ws', p: [0, -4] },
    { op: 'place', def: 'blk-long@1', name: 'we', p: [4, 0], r: Math.PI / 2 }, { op: 'place', def: 'blk-long@1', name: 'ww', p: [-4, 0], r: Math.PI / 2 },
    { op: 'place', def: coreRef('bench'), name: 'shut-bench', p: [0, 0] },
  ] }));
  const lines = show(r).warnings.filter((x: string) => /shut-bench/.test(x));
  assert.equal(lines.length, 1, JSON.stringify(r.warnings));
  assert.match(lines[0], /^No walk reaches shut-bench after this edit \(buildsafe\/1\): .*; fix: /);
  const fix = /fix: (\{.*?\})[.]$/.exec(lines[0]);
  if (fix) { // a tested op: sending it opens the way
    const op = JSON.parse(fix[1]); ok(w.god.act({ ops: [op] })); await w.settle();
    assert.equal(reach(w, [0, -12], 'shut-bench').reachable, true, 'the suggested op opens the way');
  }
});

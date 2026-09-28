// Resumable mid-action checkpoints (spec §22; runtime/snapshot.ts). A paused runtime's snapshot,
// restored into a fresh runtime, must step tick-for-tick identically to the original: same world
// hash, same event stream. Covers the resumable subset (walk_to incl. stairs, social verbs,
// sequences), forks from a history pause checkpoint, and the loud refusal for carry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime, type RuntimeEvent } from '../runtime/runtime.ts';
import { SnapshotError, type RuntimeSnapshot } from '../runtime/snapshot.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import { emptyWorld, human, addAll, component, FIXTURE } from '../world/factory.ts';
import { walkTo } from '../locomotion/walk.ts';
import { SOCIAL_ACTIONS } from '../social/actions.ts';
import { carry } from '../carry/actions.ts';
import { WorldHistory } from '../history/store.ts';
import { SequenceRunner } from '../sequence/runner.ts';
import type { StepSpec } from '../sequence/types.ts';
import type { ActionDef, ActionRecord } from '../actions/types.ts';
import type { Entity } from '../world/types.ts';

const BASE = provingGround();
const REG = new Map<string, ActionDef>([[walkTo.verb, walkTo], [carry.verb, carry], ...SOCIAL_ACTIONS.map((a) => [a.verb, a] as [string, ActionDef])]);
const LAWN: [number, number][] = [[-10, -10], [-2, -10], [-2, -2], [-10, -2]];

function setup(...es: Entity[]) {
  const w = addAll(emptyWorld('proving-ground', BASE), ...es);
  w.regions.lawn = { id: 'lawn', label: 'lawn', kind: 'place', polygon: LAWN, provenance: FIXTURE };
  return new Runtime(w, REG, { spatial: new Spatial(BASE) }, DEFAULT_INVARIANTS);
}
/** Restore through a JSON round trip (what a Durable Object / history blob does), with the runtime's own Spatial. */
const resume = (snap: RuntimeSnapshot) => Runtime.restore(JSON.parse(JSON.stringify(snap)), REG, { spatial: new Spatial(BASE) }, DEFAULT_INVARIANTS);
const steps = (rt: Runtime, n: number) => {
  for (let i = 0; i < n; i++) rt.step();
};
const evs = (e: RuntimeEvent[]) => JSON.stringify(e);
const size = (label: string, snap: RuntimeSnapshot) => {
  const n = JSON.stringify(snap).length;
  console.log(`# snapshot size (${label}, tick ${snap.tick}): ${n} bytes JSON`);
  return n;
};

/** A walk up stair A, plus an idle second person the forks will direct differently. */
function stairScene() {
  const rt = setup(human('p1', 3.5, 12.5), human('p2', 6, 4));
  const a = rt.submit('walk_to', { actor: 'p1', x: 10, z: 10, level: 1 });
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  return { rt, a };
}
function toClimbTick40(rt: Runtime, a: ActionRecord) {
  let n = 0;
  while (a.phase !== 'climb' && n++ < 20 * 60) rt.step();
  assert.equal(a.phase, 'climb');
  steps(rt, 40);
  assert.equal(a.phase, 'climb', 'still mid-flight 40 ticks into the climb');
}

test('pause mid stair climb: restore continues identically; two forks diverge deterministically; the paused original matches an unpaused run', () => {
  // unpaused reference
  const ref = stairScene();
  assert.ok(ref.rt.runUntilIdle(20 * 120));
  // paused original
  const { rt, a } = stairScene();
  toClimbTick40(rt, a);
  const y = rt.world.entities.p1.pose.p[1];
  assert.ok(y > 0.05 && rt.world.entities.p1.human!.activity.startsWith('climb'), `between levels (y ${y.toFixed(2)})`);
  const snap = rt.snapshot();
  assert.equal(snap.stateHash, rt.stateHash());
  assert.deepEqual(snap.dropped, []);
  size('walk_to mid-climb', snap);

  // history: commit a pause checkpoint, fork it twice
  const h = new WorldHistory('mars-rules/test-1');
  h.publishCanonical('pg', 'proving ground', setup(human('p1', 3.5, 12.5), human('p2', 6, 4)).world, 'test base');
  h.fork('pg', 'take', 'take');
  const cp = h.commit('take', snap, { kind: 'pause', note: 'p1 mid-flight on stair A' });
  assert.ok(cp.resume && h.resumable('take'));
  assert.equal(cp.stateHash, snap.stateHash);
  h.fork('take', 'fa', 'fork A');
  h.fork('take', 'fb', 'fork B');
  assert.ok(h.resumable('fa') && h.resumable('fb'));
  const readBack = h.read('fa', { resume: true });
  assert.ok(readBack.snapshot);
  assert.equal(readBack.snapshot.stateHash, snap.stateHash);
  assert.equal(h.read('pg', { resume: true }).snapshot, null, 'a canonical checkpoint is not resumable mid-action');
  // the history (with its snapshot blob) survives persistence
  const h2 = WorldHistory.fromJSON(JSON.parse(JSON.stringify(h.toJSON())));
  assert.equal(h2.read('fb', { resume: true }).snapshot!.stateHash, snap.stateHash);

  // original continues: identical to the unpaused reference (snapshot() is behaviour-neutral)
  const cursor = rt.events.length;
  assert.ok(rt.runUntilIdle(20 * 120));
  assert.equal(a.status, 'completed');
  assert.equal(rt.stateHash(), ref.rt.stateHash());
  assert.equal(evs(rt.events), evs(ref.rt.events));

  // a restore with no new commands reproduces the original's continuation exactly
  const plain = resume(readBack.snapshot);
  assert.equal(plain.stateHash(), snap.stateHash);
  assert.ok(plain.runUntilIdle(20 * 120));
  assert.equal(plain.tick, rt.tick);
  assert.equal(plain.stateHash(), rt.stateHash());
  assert.equal(evs(plain.events), evs(rt.events.slice(cursor)));
  assert.deepEqual(plain.violations, rt.violations);

  // fork A: p2 strolls on the ground; fork B: p2 follows p1 up the same stair. Each twice → deterministic.
  const runFork = (ws: string, cmd: Record<string, unknown>) => {
    const f = resume(h2.read(ws, { resume: true }).snapshot!);
    const r = f.submit('walk_to', cmd);
    assert.equal(r.status, 'executing', r.diagnostic?.message);
    assert.ok(f.runUntilIdle(20 * 180));
    assert.equal(f.records.get(a.id)!.status, 'completed', 'the paused climb finishes in the fork');
    assert.equal(r.status, 'completed', `${ws}: ${r.diagnostic?.message ?? ''}`);
    assert.deepEqual(f.violations, []);
    return { hash: f.stateHash(), events: evs(f.events), tick: f.tick, id: r.id };
  };
  const A1 = runFork('fa', { actor: 'p2', x: 8, z: 2 }), A2 = runFork('fa', { actor: 'p2', x: 8, z: 2 });
  const B1 = runFork('fb', { actor: 'p2', x: 11, z: 10, level: 1 }), B2 = runFork('fb', { actor: 'p2', x: 11, z: 10, level: 1 });
  assert.deepEqual(A1, A2);
  assert.deepEqual(B1, B2);
  assert.notEqual(A1.hash, B1.hash);
  assert.equal(A1.id, `a${Number(a.id.slice(1)) + 1}`, 'the id counter resumes where the original left off');
});

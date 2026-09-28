// Resumable mid-action checkpoints (spec §22; runtime/snapshot.ts). A paused runtime's snapshot,
// restored into a fresh runtime, must step tick-for-tick identically to the original: same world
// hash, same event stream. Covers the resumable subset (walk_to incl. stairs, social verbs,
// sequences), forks from a history pause checkpoint, and the loud refusal for carry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
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
import type { SocialRegion } from '../social/slots.ts';

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

/** Step original and restored copy `n` ticks together, asserting identical hashes every tick. */
function lockstep(rt: Runtime, copy: Runtime, n: number, cursor: number) {
  for (let i = 0; i < n; i++) {
    rt.step();
    copy.step();
    assert.equal(copy.stateHash(), rt.stateHash(), `diverged at tick ${rt.tick}`);
  }
  assert.equal(evs(copy.events), evs(rt.events.slice(cursor)));
}

test('converse circle paused mid-formation resumes identically (children walk_to records stay aliased to the parent exec)', () => {
  const ids = ['c1', 'c2', 'c3', 'c4'];
  const rt = setup(human('c1', -2, 3), human('c2', 2, 3), human('c3', -2, 7), human('c4', 2.5, 7.5), human('f1', 6, 0, { yaw: 0 }));
  const c = rt.submit('converse', { actors: ids });
  const f = rt.submit('face', { actor: 'f1', target: { point: [6, -4] } });
  assert.equal(c.status, 'executing', c.diagnostic?.message);
  assert.equal(f.status, 'executing', f.diagnostic?.message);
  steps(rt, 25);
  assert.equal(c.phase, 'gathering', 'still forming the circle');
  const snap = rt.snapshot();
  size('converse gathering + face', snap);
  const copy = resume(snap);
  const kid = [...copy.records.values()].find((r) => r.parent === c.id && r.verb === 'walk_to')!;
  assert.ok(kid, 'the circle has child walks');
  const cursor = rt.events.length;
  let n = 0;
  while ((c.phase as string) !== 'talking' && n++ < 20 * 30) {
    rt.step();
    copy.step();
  }
  assert.equal(c.phase, 'talking');
  assert.equal(copy.records.get(c.id)!.phase, 'talking');
  lockstep(rt, copy, 60, cursor);
  // the same director command in both: cancel the circle → people idle where they stand, identically
  rt.cancel(c.id);
  copy.cancel(c.id);
  lockstep(rt, copy, 5, cursor);
  assert.equal(copy.records.get(c.id)!.status, 'cancelled');
  assert.deepEqual(copy.violations, rt.violations);
  for (const a of ids) assert.equal(copy.world.entities[a].human!.activity, 'idle');
});

test('gather paused mid-approach resumes identically; stand and sit issued after the resume behave the same in both', () => {
  const chair = { id: 'chair', def: 'camp-chair', kind: 'fixture' as const, pose: { p: [0, 0, -5] as [number, number, number], yaw: 0 }, provenance: FIXTURE };
  const rt = setup(chair, human('a1', -6, -12), human('a2', -5, -12), human('a3', -4, -12), human('s1', -2, -5));
  (rt.world.regions.lawn as SocialRegion).layout = { focus: [-6, 0] };
  const g = rt.submit('gather', { actors: ['a1', 'a2', 'a3'], region: 'lawn' });
  const s = rt.submit('sit', { actor: 's1', fixture: 'chair' });
  assert.equal(g.status, 'executing', g.diagnostic?.message);
  assert.equal(s.status, 'executing', s.diagnostic?.message);
  steps(rt, 30);
  assert.equal(g.phase, 'gathering');
  const copy = resume(rt.snapshot());
  const cursor = rt.events.length;
  lockstep(rt, copy, 20 * 25, cursor);
  assert.equal(g.phase, 'gathered');
  for (const r of [rt, copy]) {
    const st = r.submit('stand', { actor: 'a2' });
    assert.equal(st.status, 'executing', st.diagnostic?.message);
    const st2 = r.submit('stand', { actor: 's1' });
    assert.equal(st2.status, 'executing', st2.diagnostic?.message);
  }
  lockstep(rt, copy, 40, cursor);
  assert.deepEqual(copy.violations, rt.violations);
});

test('a sequence paused between steps (s1 done, s2 waiting on its cue, s3 chained on s2) resumes to the same result as an unpaused run', () => {
  const seq: StepSpec[] = [
    { id: 's1', verb: 'walk_to', params: { actor: 'p1', x: 6, z: 2 } },
    { id: 's2', verb: 'walk_to', params: { actor: 'p1', x: 10, z: 10, level: 1 }, after: ['s1'], at: 12 },
    { id: 's3', verb: 'walk_to', params: { actor: 'p2', x: 2, z: 2 }, when: { step: 's2', event: 'started' } },
  ];
  const scene = () => setup(human('p1', 3.5, 5), human('p2', 6, 8));
  const ref = new SequenceRunner(scene(), seq).run();
  assert.equal(ref.status, 'completed', JSON.stringify(ref.diagnostics));

  const rt = scene();
  const run = new SequenceRunner(rt, seq);
  run.advance();
  let n = 0;
  while (run.reports[0].status !== 'completed' && n++ < 20 * 60) run.tick();
  assert.equal(run.reports[0].status, 'completed');
  assert.equal(run.reports[1].status, 'pending', 'paused between steps: s2 waits for its cue');
  assert.equal(run.reports[2].status, 'pending');
  const snap = rt.snapshot();
  const state = JSON.parse(JSON.stringify(run.serialize()));
  size('sequence between steps', snap);
  const run2 = SequenceRunner.restore(resume(snap), state);
  const a = run.run(), b = run2.run();
  assert.equal(a.status, 'completed');
  assert.equal(JSON.stringify(b), JSON.stringify(a), 'restored runner reports the same result (JSON: undefined-valued keys are absent after the round trip)');
  assert.equal(a.finalStateHash, ref.finalStateHash);
  assert.equal(JSON.stringify(a.steps), JSON.stringify(ref.steps));
});

test('a snapshot during a carry is refused naming the action; allowDrop refuses too while the load is held', () => {
  const rt = setup(component('b1', 'beam-12ft', [4, 0, 4], 0), human('p1', 2, 6.5), human('p2', 6, 1.5), human('w', 8, -2));
  const before = rt.world.entities.b1.phase;
  const c = rt.submit('carry', { crew: ['p1', 'p2'], item: 'b1', to: { x: 8, z: 10, yaw: Math.PI / 2 } });
  assert.equal(c.status, 'executing', c.diagnostic?.message);
  const w = rt.submit('walk_to', { actor: 'w', x: 12, z: -2 });
  // during the gather (crew walking to their grips; nothing lifted yet)
  steps(rt, 5);
  assert.throws(() => rt.snapshot(), (e: unknown) => {
    assert.ok(e instanceof SnapshotError);
    assert.equal(e.code, 'snapshot.non-resumable');
    assert.match(e.message, new RegExp(`action ${c.id} \\(carry\\) is not resumable: carry drives in-process walk sub-execs`));
    assert.deepEqual(e.subjects, [c.id]);
    return true;
  });
  // allowDrop before the lift: the carry is left out and finished as cancelled on restore (item back in place)
  const dropped = rt.snapshot({ allowDrop: true });
  assert.deepEqual(dropped.dropped.map((d) => [d.id, d.verb]), [[c.id, 'carry']]);
  const copy = resume(dropped);
  assert.equal(copy.records.get(c.id)!.status, 'cancelled');
  assert.equal(copy.records.get(c.id)!.diagnostic?.code, 'snapshot.dropped');
  assert.equal(copy.world.entities.b1.phase, before, 'the untouched beam keeps its prior phase');
  for (const p of ['p1', 'p2']) assert.equal(copy.world.entities[p].human!.task, undefined);
  assert.ok(copy.isActive(w.id), 'the resumable walk survives');
  assert.ok(copy.runUntilIdle(20 * 60));
  assert.deepEqual(copy.violations, []);
  // once the crew holds the beam, dropping would leave it unsupported: refused even with allowDrop
  let n = 0;
  while (!rt.world.entities.p1.human!.grip && n++ < 20 * 60) rt.step();
  assert.ok(rt.world.entities.p1.human!.grip, 'crew gripping');
  assert.throws(() => rt.snapshot({ allowDrop: true }), (e: unknown) => e instanceof SnapshotError && e.code === 'snapshot.drop-unsafe' && e.message.includes(c.id));
});

test('an exec holding a closure is refused naming the path; a def may opt in with resumable: true', () => {
  const closureVerb: ActionDef<unknown, unknown, { left: number; test: (q: number) => boolean }> = {
    verb: 'closure_test', description: 'test', schema: z.strictObject({}), resumable: true,
    reservations: () => [], plan: () => ({ ok: true, program: null }),
    start: () => ({ left: 3, test: (q: number) => q > 0 }),
    step: (_rt, ex) => (--ex.left > 0 ? { status: 'running' } : { status: 'completed' }),
    cancel: () => ({ ok: true }),
  };
  const rt = new Runtime(addAll(emptyWorld('proving-ground', BASE)), new Map([[closureVerb.verb, closureVerb]]), {});
  const a = rt.submit('closure_test', {});
  rt.step();
  assert.throws(() => rt.snapshot(), (e: unknown) => e instanceof SnapshotError && e.message.includes(`action ${a.id} (closure_test) exec.exec.test is a function`));
});

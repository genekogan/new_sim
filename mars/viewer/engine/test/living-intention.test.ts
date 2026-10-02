import test from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { createRegistry, servicesFor, ENGINE_INVARIANTS } from '../api/registry.ts';
import { classroomScene } from '../scenarios/classroom.ts';
import { workBreakWorld, WORK_BREAK_BINDING } from '../scenarios/work-break.ts';
import { readLivingIntention } from '../activities/living-intention.ts';
import type { LivingIntentionParams } from '../activities/living-intention.ts';
import { readWorkstation } from '../objects/workstation.ts';

function runtime() { const world = workBreakWorld(); return new Runtime(world, createRegistry(), servicesFor({ classroom: classroomScene() })(world), ENGINE_INVARIANTS); }
function until(rt: Runtime, ready: () => boolean, max = 5000) { for (let i = 0; i < max && !ready(); i++) rt.step(); assert.ok(ready(), JSON.stringify([...rt.records.values()].map(r => [r.id, r.verb, r.status, r.diagnostic]))); assert.deepEqual(rt.violations, []); }
const work = { verb: 'work_at' as const, params: { ...WORK_BREAK_BINDING.work } };
const purpose: LivingIntentionParams = { actor: 'worker', objectives: [
  { purpose: 'notes', label: 'Initial notes block', alternatives: [work], sliceSeconds: 2 },
  { purpose: 'break', label: 'Walk to break', alternatives: [{ verb: 'walk_to', params: { actor: 'worker', x: 8, z: 8 } }] },
  { purpose: 'notes', label: 'Finish the same notes', alternatives: [work] },
] };
test('independent intention digresses then finishes the same conserved notes', () => {
  const rt = runtime(), a = rt.submit('living_intention', purpose);
  until(rt, () => readLivingIntention(rt, a.id)?.index === 1);
  const partial = readWorkstation(rt, 'workstation'); assert.ok(!('code' in partial)); assert.equal(partial.status, 'unfinished'); assert.ok(partial.elapsed >= 2 && partial.elapsed < 3);
  until(rt, () => !rt.isActive(a.id)); assert.equal(rt.records.get(a.id)?.status, 'completed');
  const final = readWorkstation(rt, 'workstation'); assert.ok(!('code' in final)); assert.equal(final.task, 'Sketch notes'); assert.equal(final.elapsed, 30);
  assert.deepEqual(rt.holder('actor:worker'), []); assert.deepEqual(rt.holder('routine:worker'), []);
});
test('resource alternatives bind an available object; missing preferred equipment waits only when no permitted alternative fits', () => {
  const rt = runtime();
  const a = rt.submit('living_intention', { actor: 'worker', objectives: [{ purpose: 'notes', label: 'Write notes', alternatives: [{ verb: 'work_at', params: { ...work.params, station: 'missing' } }, work] }] });
  until(rt, () => !rt.isActive(a.id)); assert.equal(rt.records.get(a.id)?.status, 'completed');
  assert.equal(readLivingIntention(rt, a.id)?.binding, undefined);
  const b = rt.submit('living_intention', { actor: 'worker', objectives: [{ purpose: 'bad', label: 'Missing workstation', alternatives: [{ verb: 'work_at', params: { ...work.params, station: 'missing' } }] }] });
  until(rt, () => readLivingIntention(rt, b.id)?.mode === 'waiting'); assert.ok(readLivingIntention(rt, b.id)?.diagnostic);
  const count = rt.records.size; for (let i = 0; i < 100; i++) rt.step(); assert.equal(rt.records.size, count, 'waiting does not spam failed child records');
  rt.cancel(b.id); until(rt, () => !rt.isActive(b.id)); assert.deepEqual(rt.holder('routine:worker'), []);
});
test('director takes precedence, another person continues, explicit Resume retains the original purpose', () => {
  const rt = runtime(), a = rt.submit('living_intention', purpose);
  const visitor = rt.submit('living_intention', { actor: 'visitor', objectives: [{ purpose: 'visit', label: 'Visitor walk', afterSeconds: 1, alternatives: [{ verb: 'walk_to', params: { actor: 'visitor', x: -7, z: -4 } }] }] });
  until(rt, () => { const w = readWorkstation(rt, 'workstation'); return !('code' in w) && w.elapsed >= 1; });
  const directive = rt.submit('walk_to', { actor: 'worker', x: 10, z: 10 });
  until(rt, () => !rt.isActive(directive.id) && readLivingIntention(rt, a.id)?.mode === 'paused');
  assert.equal(rt.records.get(directive.id)?.status, 'completed');
  until(rt, () => !rt.isActive(visitor.id)); assert.equal(rt.records.get(visitor.id)?.status, 'completed');
  assert.equal(readLivingIntention(rt, a.id)?.purpose, 'notes');
  const resumed = rt.submit('living_intention_control', { intention: a.id, intent: 'resume' }); assert.notEqual(resumed.status, 'failed');
  until(rt, () => !rt.isActive(a.id)); const final = readWorkstation(rt, 'workstation'); assert.ok(!('code' in final)); assert.equal(final.elapsed, 30);
});
test('invalid participants and unsupported or foreign actor bindings fail admission without claims', () => {
  const rt = runtime();
  for (const p of [{ ...purpose, actor: 'missing' }, { ...purpose, objectives: [{ purpose: 'foreign', label: 'Wrong person', alternatives: [{ verb: 'walk_to', params: { actor: 'visitor', x: 0, z: 0 } }] }] }, { ...purpose, objectives: [{ purpose: 'unsupported', label: 'No teleport', alternatives: [{ verb: 'teleport', params: { actor: 'worker' } }] }] }]) {
    const r = rt.submit('living_intention', p); assert.equal(r.status, 'failed'); assert.ok(r.diagnostic); assert.deepEqual(rt.holder('routine:worker'), []);
  }
});
test('same decisions reproduce independent intentions exactly and readouts are detached', () => {
  function run() { const rt = runtime(), a = rt.submit('living_intention', purpose); const view = readLivingIntention(rt, a.id)!; view.completed.push('forged'); assert.deepEqual(readLivingIntention(rt, a.id)!.completed, []); until(rt, () => !rt.isActive(a.id)); return { world: rt.world, events: rt.events }; }
  assert.deepEqual(run(), run());
});

test('pausing a work slice retains its initial budget and returns without repeating it', () => {
  const rt = runtime(), a = rt.submit('living_intention', purpose);
  until(rt, () => { const w = readWorkstation(rt, 'workstation'); return !('code' in w) && w.elapsed >= 1; });
  rt.submit('living_intention_control', { intention: a.id, intent: 'pause' });
  until(rt, () => readLivingIntention(rt, a.id)?.mode === 'paused');
  const stopped = readWorkstation(rt, 'workstation'); assert.ok(!('code' in stopped)); assert.ok(stopped.elapsed >= 1 && stopped.elapsed < 2);
  rt.submit('living_intention_control', { intention: a.id, intent: 'resume' });
  until(rt, () => readLivingIntention(rt, a.id)?.index === 1);
  const slice = readWorkstation(rt, 'workstation'); assert.ok(!('code' in slice)); assert.ok(slice.elapsed >= 2 && slice.elapsed < 2.2);
  rt.cancel(a.id); until(rt, () => !rt.isActive(a.id)); assert.deepEqual(rt.holder('actor:worker'), []);
});
test('a busy foreign workstation keeps its owner and uncommitted people can wait without losing their purposes', () => {
  const rt = runtime(); const foreign = rt.submit('work_at', { ...WORK_BREAK_BINDING.work, actor: 'visitor', task: 'Visitor notes' });
  assert.notEqual(foreign.status, 'failed');
  const a = rt.submit('living_intention', { actor: 'worker', objectives: [{ purpose: 'notes', label: 'Write own notes', alternatives: [work] }] });
  until(rt, () => readLivingIntention(rt, a.id)?.mode === 'waiting'); assert.equal(rt.isActive(foreign.id), true);
  assert.ok(readLivingIntention(rt, a.id)?.diagnostic); rt.cancel(a.id); until(rt, () => !rt.isActive(a.id));
  until(rt, () => !rt.isActive(foreign.id)); const state = readWorkstation(rt, 'workstation'); assert.ok(!('code' in state)); assert.equal(state.user, 'visitor');assert.equal(state.task, 'Visitor notes');assert.equal(state.elapsed,30);
});

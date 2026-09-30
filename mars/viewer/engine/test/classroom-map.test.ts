import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { createRegistry, ENGINE_INVARIANTS, servicesFor } from '../api/registry.ts';
import { classroomScene, classroomParams, classroomWorld } from '../scenarios/classroom.ts';
import { readClassroom } from '../activities/index.ts';
import { displayReadout } from '../objects/classroom.ts';

for (const count of [4, 8] as const) test(`playable classroom real catalog/display cycle (${count} guests)`, () => {
  const w = classroomWorld(count);
  const rt = new Runtime(w, createRegistry(), servicesFor({ classroom: classroomScene() })(w), ENGINE_INVARIANTS);
  const a = rt.submit('classroom_session', { ...classroomParams(count), talkSeconds: 0.5, questionSeconds: 0.3, conversationSeconds: 0.4 });
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  rt.submit('classroom_control', { session: a.id, intent: { kind: 'question', actor: 'guest1' } });
  let showing = false, question = false;
  for (let i = 0; i < 6000 && rt.isActive(a.id); i++) {
    rt.step(); const d = displayReadout(rt, 'screen');
    assert.ok(!('code' in d)); showing ||= d.mode === 'on';
    question ||= readClassroom(rt, a.id)?.attentionTarget?.actor === 'guest1';
  }
  assert.equal(a.status, 'completed', JSON.stringify(a.diagnostic));
  assert.ok(showing); assert.ok(question);
  assert.deepEqual(rt.violations, []);
  assert.deepEqual([...rt.records.values()].filter((r) => r.status === 'failed'), [], 'no failed ambient nudges hidden behind parent completion');
  assert.deepEqual(rt.holder('display:screen'), []);
  const d = displayReadout(rt, 'screen'); assert.ok(!('code' in d)); assert.equal(d.mode, 'off');
  for (const actor of ['host', 'presenter1', 'presenter2', ...classroomParams(count).audience]) assert.deepEqual(rt.holder(`actor:${actor}`), []);
});
test('common registry display adapter preserves ordinary idle snapshot/restore', () => {
  const w = classroomWorld();
  const services = servicesFor({ classroom: classroomScene() });
  const rt = new Runtime(w, createRegistry(), services(w), ENGINE_INVARIANTS);
  const snap = rt.snapshot();
  const restored = Runtime.restore(snap, createRegistry(), services(w), ENGINE_INVARIANTS);
  assert.equal(restored.stateHash(), rt.stateHash());
  const r = restored.submit('display_control', { display: 'screen', mode: 'on', content: 'After restore' });
  restored.step(); assert.equal(r.status, 'completed');
});
for (const missing of [true, false]) test(`real display ${missing ? 'missing' : 'unavailable'} refuses without movement`, () => {
  const w = classroomWorld();
  if (missing) delete w.entities.screen; else w.entities.screen.equipment!.config.available = false;
  const rt = new Runtime(w, createRegistry(), servicesFor({ classroom: classroomScene() })(w), ENGINE_INVARIANTS);
  const before = rt.stateHash();
  const a = rt.submit('classroom_session', classroomParams());
  assert.equal(a.status, 'failed'); assert.equal(a.diagnostic?.code, missing ? 'object.unknown' : 'display.unavailable');
  assert.equal(rt.stateHash(), before); assert.deepEqual(rt.holder('display:screen'), []);
});
test('active classroom snapshot refuses without changing physical commitments', () => {
  const w = classroomWorld(); const rt = new Runtime(w, createRegistry(), servicesFor({ classroom: classroomScene() })(w), ENGINE_INVARIANTS);
  const a = rt.submit('classroom_session', classroomParams()); const before = rt.stateHash();
  assert.throws(() => rt.snapshot(), (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === 'snapshot.non-resumable');
  assert.equal(rt.stateHash(), before); assert.ok(rt.holder('display:screen').includes(a.id));
  rt.cancel(a.id); for (let i = 0; i < 1000 && rt.isActive(a.id); i++) rt.step();
  assert.equal(a.status, 'cancelled'); assert.deepEqual(rt.holder('display:screen'), []); assert.deepEqual(rt.violations, []);
});

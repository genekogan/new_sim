import { test, after } from 'node:test';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Runtime, ActionAdmissionError } from '../runtime/runtime.ts';
import { Spatial } from '../spatial/service.ts';
import { emptyWorld, addAll, human, FIXTURE } from '../world/factory.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import { SOCIAL_ACTIONS } from '../social/actions.ts';
import { walkTo, makeWay } from '../locomotion/walk.ts';

const captures: unknown[] = [];
function setup() {
  const scene = provingGround();
  return new Runtime(addAll(emptyWorld('action-ids', scene), human('p1', -6, -6)), new Map([['walk_to', walkTo]]), { spatial: new Spatial(scene) });
}
test('duplicate explicit action ids refuse atomically for live and terminal records', () => {
  for (const terminal of [false, true]) {
    const rt = setup();
    const original = rt.submit('walk_to', { actor: 'p1', x: -4, z: -6 }, { id: 'original' });
    if (terminal) assert.ok(rt.runUntilIdle(500));
    const world = structuredClone(rt.world), events = structuredClone(rt.events), snapshot = rt.snapshot();
    const record = structuredClone(original), owners = rt.holder('actor:p1');
    assert.throws(() => rt.submit('walk_to', { actor: 'p1', x: 5, z: 5 }, { id: 'original' }),
      (e: unknown) => e instanceof ActionAdmissionError && e.diagnostic.code === 'action.duplicate-id');
    assert.equal(rt.records.get('original'), original);
    assert.deepEqual(original, record); assert.deepEqual(rt.world, world); assert.deepEqual(rt.events, events);
    assert.deepEqual(rt.holder('actor:p1'), owners); assert.deepEqual(rt.snapshot(), snapshot);
    captures.push({ terminal, duplicate: 'original', diagnostic: new ActionAdmissionError('original').diagnostic, originalStatus: original.status, holders: owners, snapshotUnchanged: true, eventsUnchanged: true });
  }
});
test('automatic ids skip explicit generated-name records before and after snapshot restore', () => {
  const rt = setup();
  const original = rt.submit('unknown', {}, { id: 'a1' });
  assert.equal(original.status, 'failed');
  rt.submit('unknown', {}, { id: 'a2' });
  const restored = Runtime.restore(rt.snapshot(), rt.registry, { spatial: new Spatial(provingGround()) });
  for (const r of [rt, restored]) {
    assert.equal(r.submit('unknown', {}).id, 'a3');
    assert.equal(r.submit('unknown', {}).id, 'a4');
    assert.equal(r.records.get('a1')?.verb, 'unknown');
    assert.equal(r.records.size, 4);
  }
  assert.equal(rt.stateHash(), restored.stateHash());
});

after(() => { if (process.env.ACTION_ID_CAPTURE) writeFileSync(process.env.ACTION_ID_CAPTURE, JSON.stringify(captures, null, 2) + '\n'); });

test('same-tick failed make-way requests coalesce without overwriting the failed record', () => {
  const rt = setup();
  // The nudge cannot plan an unknown walk verb, so it leaves the person idle for a second requester.
  rt.registry.delete('walk_to');
  (rt.services.spatial as Spatial).sync(rt.world);
  makeWay(rt, 'p1', [-6.1, -6]);
  const id = 'p1:make-way:0', original = rt.records.get(id);
  assert.equal(original?.status, 'failed');
  const events = structuredClone(rt.events);
  assert.doesNotThrow(() => makeWay(rt, 'p1', [-6.2, -6]));
  assert.equal(rt.records.get(id), original);
  assert.deepEqual(rt.events, events);
  captures.push({ case: 'repeated refused nudge', id, diagnostic: original?.diagnostic, eventsUnchanged: true });
});

test('a colliding voluntary-return id refuses without interrupting a completed directive tick', () => {
  const rt = setup();
  for (const def of SOCIAL_ACTIONS) rt.registry.set(def.verb, def);
  rt.world.entities.chair = { id: 'chair', kind: 'fixture', def: 'camp-chair', pose: { p: [-5, 0, -6], yaw: 0 }, provenance: FIXTURE };
  const seat = rt.submit('sit', { actor: 'p1', fixture: 'chair' });
  for (let i = 0; i < 600 && seat.phase !== 'occupied'; i++) rt.step();
  assert.equal(seat.phase, 'occupied');
  const directive = rt.submit('walk_to', { actor: 'p1', x: -8, z: -6 });
  const id = `${seat.id}:resume:${directive.id}`;
  const existing = rt.submit('unknown', {}, { id });
  const before = structuredClone(existing);
  assert.doesNotThrow(() => assert.ok(rt.runUntilIdle(600)));
  assert.equal(directive.status, 'completed');
  assert.equal(rt.records.get(id), existing); assert.deepEqual(existing, before);
  const refusal = rt.events.find((e) => e.type === 'mark' && e.name === 'social.resume-refused');
  assert.ok(refusal && refusal.type === 'mark');
  assert.equal((refusal.data as { diagnostic: { code: string } }).diagnostic.code, 'action.duplicate-id');
  assert.equal(rt.services.socialReturns, undefined);
  captures.push({ case: 'return id collision', id, directive: directive.status, refusal, originalUnchanged: true });
});

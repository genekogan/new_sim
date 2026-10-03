import { test } from 'node:test';
import assert from 'node:assert/strict';
import { progressiveSupported } from '../construction/contributor.ts';
import type { Runtime } from '../runtime/runtime.ts';
import { bay } from './frame-fixtures.ts';

test('successful support proofs invalidate on same-tick in-place structural edits and entity replacement', () => {
  const edits = [
    (rt: Runtime) => { rt.world.entities.b4.phase = 'staged'; },
    (rt: Runtime) => { rt.world.entities.B.pose.pitch = 0.2; },
    (rt: Runtime) => { rt.world.entities.B.pose.roll = 0.2; },
    (rt: Runtime) => { rt.world.entities.j1.connections![0].to = 'missing'; },
    (rt: Runtime) => { rt.world.entities.j1.connections!.splice(0, 1); },
    (rt: Runtime) => { rt.world.entities.j1.connections![0].socket = 'unrelated'; },
    (rt: Runtime) => { rt.world.entities.b4.connections![1].to = 'A'; },
    (rt: Runtime) => { delete rt.world.entities.b4; },
    (rt: Runtime) => { rt.world.entities.b4 = { ...rt.world.entities.b4, def: 'human' }; },
    (rt: Runtime) => { rt.world.entities.B.support = { kind: 'none' }; },
  ];
  for (const [index, edit] of edits.entries()) {
    const { rt } = bay({ seat: 1.8, joists: [1, 2] });
    assert.deepEqual(progressiveSupported(rt), []);
    assert.deepEqual(progressiveSupported(rt), [], 'unchanged world');
    edit(rt);
    const fresh = { world: structuredClone(rt.world) } as Runtime;
    const expected = progressiveSupported(fresh); // New world object has no previous memo.
    assert.ok(expected.length, `fixture edit ${index} must actually break the support chain`);
    assert.deepEqual(progressiveSupported(rt), expected);
    rt.world.entities.j1.pose.p[0] += 2;
    assert.deepEqual(progressiveSupported(rt), progressiveSupported({ world: structuredClone(rt.world) } as Runtime), 'failed diagnostics and their locations are never reused');
  }
});

test('support proofs observe in-place holder counts, new parts and a repaired chain', () => {
  const { rt } = bay({ seat: 1.8, joists: [1, 2] });
  rt.world.entities.A.support = { kind: 'held', by: ['u1'] };
  rt.world.entities.B.support = { kind: 'held', by: ['u2'] };
  assert.deepEqual(progressiveSupported(rt), []);
  const support = rt.world.entities.B.support;
  support.by.splice(0, 1);
  assert.ok(progressiveSupported(rt).length, 'holder removed without replacing the support object');
  support.by.push('u2');
  assert.deepEqual(progressiveSupported(rt), []);
  const part = structuredClone(rt.world.entities.j1);
  part.id = 'new-joist'; part.connections = [];
  rt.world.entities[part.id] = part;
  assert.ok(progressiveSupported(rt).some(d => d.subjects?.includes(part.id)));
  delete rt.world.entities[part.id];
  assert.deepEqual(progressiveSupported(rt), []);
  assert.deepEqual(progressiveSupported(rt), []);
});

test('an exception while checking edited inputs cannot retain the earlier successful proof', () => {
  const { rt } = bay({ seat: 1.8, joists: [1, 2] });
  assert.deepEqual(progressiveSupported(rt), []);
  rt.world.entities.j1.connections![0].to = 'missing';
  rt.world.entities.invalid = { ...rt.world.entities.j1, id: 'invalid', def: 'missing-definition' };
  assert.throws(() => progressiveSupported(rt));
  delete rt.world.entities.invalid;
  assert.ok(progressiveSupported(rt).length, 'edited support must be checked again after the unrelated error');
});

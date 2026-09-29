import { test } from 'node:test';
import assert from 'node:assert/strict';
import { climbFaceResource, climbLinks } from '../construction/frame.ts';
import { hashOf } from '../core/hash.ts';
import { bay } from './frame-fixtures.ts';

const high = 'climb:A:l@1.83';
const low = 'climb:A:l@0.46';
const otherColumn = 'climb:A:r@1.83';

function setup() {
  const { rt } = bay({ seat: 1.8 });
  const link = climbLinks(rt.world).find((l) => l.id === high)!;
  const resource = climbFaceResource(rt.world, link)!;
  const submit = (actor: string, id: string) => rt.submit('climb_frame', { actor, link: id, dir: 'up' });
  return { rt, link, resource, submit };
}

test('climb reservations (LM-022): different seats on one column face are exclusive before approach; another column remains available', () => {
  const { rt, resource, submit } = setup();
  const first = submit('p1', high);
  assert.equal(first.status, 'executing', first.diagnostic?.message);
  assert.deepEqual(rt.holder(resource), [first.id]);
  const secondBefore = hashOf(rt.world.entities.p2);
  const second = submit('p2', low);
  assert.equal(second.status, 'failed');
  assert.equal(second.diagnostic?.code, 'reservation.conflict');
  assert.equal(second.diagnostic.details?.resource, resource);
  assert.equal(second.diagnostic.details?.holder, first.id);
  assert.ok(second.diagnostic.message.includes(first.id));
  assert.ok(second.diagnostic.message.includes(resource));
  assert.equal(hashOf(rt.world.entities.p2), secondBefore);
  assert.deepEqual(rt.holder('actor:p2'), [], 'failed admission must not capture the second actor');
  assert.deepEqual(rt.holder(resource), [first.id]);
  const independent = submit('p3', otherColumn);
  assert.equal(independent.status, 'executing', independent.diagnostic?.message);
  assert.deepEqual(rt.violations, []);
  console.log(JSON.stringify({ resource, holder: first.id, refusedLink: low, refused: second.diagnostic, independentLink: otherColumn, independentStatus: independent.status, secondActorUnchanged: true }));
});

test('climb reservations (LM-022): safe cancellation and completed climb release the shared face', () => {
  const { rt, resource, submit } = setup();
  const first = submit('p1', high);
  assert.equal(rt.cancel(first.id).status, 'cancelled');
  assert.deepEqual(rt.holder(resource), []);
  const replacement = submit('p2', high);
  assert.equal(replacement.status, 'executing', replacement.diagnostic?.message);
  for (let i = 0; i < 20 * 60 && rt.world.entities.p2.human?.activity !== 'climb-up'; i++) rt.step();
  assert.equal(rt.world.entities.p2.human?.activity, 'climb-up');
  const unsafe = rt.cancel(replacement.id);
  assert.equal(unsafe.diagnostic?.code, 'climb.cancel-unsafe');
  assert.deepEqual(rt.holder(resource), [replacement.id], 'unsafe cancellation must not release the face');
  assert.ok(rt.runUntilIdle(20 * 120, [replacement.id]));
  assert.equal(replacement.status, 'completed', replacement.diagnostic?.message);
  assert.deepEqual(rt.holder(resource), []);
  assert.deepEqual(rt.violations, [], JSON.stringify(rt.violations));
  const lower = submit('p1', low);
  assert.equal(lower.status, 'executing', lower.diagnostic?.message);
  assert.deepEqual(rt.holder(resource), [lower.id]);
  rt.cancel(lower.id);
  const down = rt.submit('climb_frame', { actor: 'p2', link: high, dir: 'down' });
  assert.equal(down.status, 'executing', down.diagnostic?.message);
  const conflictingUp = submit('p1', low);
  assert.equal(conflictingUp.diagnostic?.code, 'reservation.conflict', 'up and down share the same physical lane');
  assert.deepEqual(rt.holder(resource), [down.id]);
});

test('climb reservations (LM-022): missing links claim nothing; opposite physical faces have distinct keys', () => {
  const { rt, link, resource, submit } = setup();
  const missing = submit('p1', 'climb:A:l@99.00');
  assert.equal(missing.diagnostic?.code, 'climb.no-link');
  assert.deepEqual(rt.holder('actor:p1'), []);
  assert.deepEqual(rt.holder(resource), []);
  assert.equal(climbFaceResource(rt.world, { ...link, kind: 'beam' }), undefined);
  assert.equal(climbFaceResource(rt.world, { ...link, members: ['missing'] }), undefined);
  const lowLink = climbLinks(rt.world).find((l) => l.id === low)!;
  assert.equal(climbFaceResource(rt.world, lowLink), resource, 'seat height is not lane identity');
  // Reflect entry about the upright origin (A is at the origin in this fixture):
  // the same column approached on the opposite physical face uses its own lane.
  const opposite = { ...link, from: { ...link.from, p: [link.from.p[0], -link.from.p[1]] as [number, number] } };
  assert.notEqual(climbFaceResource(rt.world, opposite), resource);
});

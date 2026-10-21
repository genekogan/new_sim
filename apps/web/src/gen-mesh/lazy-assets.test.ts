import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DeferredLoadQueue, deferLoad, planEager, plannedArrivalEye } from './lazy-assets.ts';

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; };

test('nearest visible assets start first; duplicate copies share a slot until all attach', async () => {
  const queue = new DeferredLoadQueue(2), started: string[] = [];
  const near1 = deferred(), near2 = deferred(), mid = deferred(), far = deferred();
  queue.add('far', { priority: () => [0, 100], start: () => { started.push('far'); return far.promise; } });
  queue.add('near', { priority: () => [0, 10], start: () => { started.push('near1'); return near1.promise; } });
  queue.add('near', { priority: () => [0, 20], start: () => { started.push('near2'); return near2.promise; } });
  queue.add('mid', { priority: () => [0, 50], start: () => { started.push('mid'); return mid.promise; } });
  queue.pump(); await turn();
  assert.deepEqual(started, ['near1', 'near2', 'mid']); assert.deepEqual(queue.stats(), { pending: 1, active: 2 });
  near1.resolve(); await turn(); assert.equal(started.includes('far'), false);
  near2.resolve(); await turn(); assert.equal(started.at(-1), 'far');
  mid.resolve(); far.resolve(); await turn(); assert.deepEqual(queue.stats(), { pending: 0, active: 0 });
});

test('priority updates apply when a slot frees; foreground takes precedence over a nearer object behind', async () => {
  const queue = new DeferredLoadQueue(1), first = deferred(), started: string[] = [];
  let foregroundDistance = 100;
  queue.add('first', { priority: () => [0, 1], start: () => { started.push('first'); return first.promise; } });
  queue.add('behind', { priority: () => [1, 5], start: () => { started.push('behind'); } });
  queue.add('other-foreground', { priority: () => [0, 50], start: () => { started.push('other-foreground'); } });
  queue.add('foreground', { priority: () => [0, foregroundDistance], start: () => { started.push('foreground'); } });
  queue.pump(); await turn(); foregroundDistance = 2; first.resolve(); await turn();
  assert.deepEqual(started, ['first', 'foreground', 'other-foreground', 'behind']); assert.deepEqual(queue.stats(), { pending: 0, active: 0 });
});

test('a blocked arrival, removed item, rejection and synchronous throw cannot strand or overfill slots', async () => {
  const queue = new DeferredLoadQueue(1), started: string[] = []; let ready = false;
  const remove = queue.add('removed', { priority: () => [0, 0], start: () => { started.push('removed'); } }); remove();
  queue.add('throws', { priority: () => ready ? [0, 1] : null, start: () => { started.push('throws'); throw new Error('failed'); } });
  queue.add('rejects', { priority: () => ready ? [0, 2] : null, start: () => { started.push('rejects'); return Promise.reject(new Error('failed')); } });
  queue.add('last', { priority: () => ready ? [0, 3] : null, start: () => { started.push('last'); } });
  queue.pump(); await turn(); assert.deepEqual(started, []);
  ready = true; queue.pump(); await turn();
  assert.deepEqual(started, ['throws', 'rejects', 'last']); assert.deepEqual(queue.stats(), { pending: 0, active: 0 });
});

test('removing an entity cancels its deferred request even when its hook remains its child', async () => {
  const parent = new THREE.Group(), camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000), callbacks: (() => void)[] = [];
  camera.updateMatrixWorld(true); const active = [deferred(), deferred()], started: number[] = [];
  const owners = [0, 1, 2].map((i) => {
    const owner = new THREE.Group(); owner.position.z = -10 - i; parent.add(owner);
    const hook = deferLoad(`removal-${i}`, () => { started.push(i); return active[i]?.promise; }, (fn) => {
      const hook = new THREE.Object3D(); callbacks.push(() => fn(camera)); return hook;
    }, owner);
    owner.add(hook); return owner;
  });
  parent.updateMatrixWorld(true); callbacks.forEach((fn) => fn()); owners[2].removeFromParent(); await turn();
  assert.deepEqual(started, [0, 1]); active.forEach((p) => p.resolve()); await turn(); assert.deepEqual(started, [0, 1]);
  owners.forEach((owner) => owner.removeFromParent());
});

test('a hidden interior whose hook never draws still loads through the background path', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  planEager({ entities: [] }, () => undefined, () => null);
  const parent = new THREE.Group(), owner = new THREE.Group(); owner.visible = false; owner.position.set(1, 0, -15); parent.add(owner);
  let started = false;
  owner.add(deferLoad('hidden-interior', () => { started = true; }, () => new THREE.Object3D(), owner));
  await turn(); assert.equal(started, false);
  t.mock.timers.tick(6000); await turn(); assert.equal(started, true);
  owner.removeFromParent();
});

test('a remount releases stuck slots and old completions cannot release a new job for the same SHA', async () => {
  const queue = new DeferredLoadQueue(1), old = deferred(), current = deferred(), started: string[] = [];
  queue.add('same-sha', { priority: () => [0, 1], start: () => { started.push('old'); return old.promise; } });
  queue.pump(); await turn(); queue.reset();
  queue.add('same-sha', { priority: () => [0, 1], start: () => { started.push('new'); return current.promise; } });
  queue.add('next', { priority: () => [0, 2], start: () => { started.push('next'); } });
  queue.pump(); await turn(); assert.deepEqual(started, ['old', 'new']);
  old.resolve(); await turn(); assert.deepEqual(started, ['old', 'new']); assert.deepEqual(queue.stats(), { pending: 1, active: 1 });
  current.resolve(); await turn(); assert.deepEqual(started, ['old', 'new', 'next']); assert.deepEqual(queue.stats(), { pending: 0, active: 0 });
});

test('an arrival plan records the eye a two-model def chooses its first model from (centre when no eye is given)', async (t) => {
  t.after(() => planEager({ entities: [] }, () => undefined, () => null));
  planEager({ entities: [] }, () => undefined, () => null, [3, 4], [10, -2]);
  assert.deepEqual(plannedArrivalEye(), [10, -2]);
  planEager({ entities: [] }, () => undefined, () => null, [3, 4]);
  assert.deepEqual(plannedArrivalEye(), [3, 4]);
});

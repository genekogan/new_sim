import test from 'node:test';
import assert from 'node:assert/strict';
import { watchApproval } from './approval-status.ts';

test('a reopened ready approval is read immediately and stops polling', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let reads = 0; const seen: string[] = [];
  const stop = watchApproval(async () => { reads++; return { status: 'ready' }; }, a => seen.push(a.status), assert.fail, 5);
  await Promise.resolve(); t.mock.timers.tick(30); stop();
  assert.deepEqual(seen, ['ready']); assert.equal(reads, 1);
});
test('a handed-off request follows pending and creating to ready, then stops', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const states = ['pending', 'creating', 'ready'], seen: string[] = [];
  const stop = watchApproval(async () => ({ status: states.shift()! }), a => seen.push(a.status), assert.fail, 5);
  await Promise.resolve(); t.mock.timers.tick(5); await Promise.resolve(); t.mock.timers.tick(5); await Promise.resolve(); t.mock.timers.tick(30); stop(); assert.deepEqual(seen, ['pending', 'creating', 'ready']);
});
for (const status of ['refused', 'cancelled', 'expired']) test(`${status} is terminal, never paired`, async (t) => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let reads = 0; const seen: string[] = [];
  const stop = watchApproval(async () => { reads++; return { status }; }, a => seen.push(a.status), assert.fail, 5);
  await Promise.resolve(); t.mock.timers.tick(25); stop(); assert.deepEqual(seen, [status]); assert.equal(reads, 1);
});
test('a temporary read failure is reported, then recovers without fabricating readiness', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let reads = 0; const seen: string[] = [];
  const stop = watchApproval(async () => { if (++reads === 1) throw new Error('offline'); return { status: 'ready' }; }, a => seen.push(a.status), e => seen.push(e.message), 5);
  await Promise.resolve(); t.mock.timers.tick(5); await Promise.resolve(); t.mock.timers.tick(30); stop(); assert.deepEqual(seen, ['offline', 'ready']); assert.equal(reads, 2);
});
test('unmount or account change suppresses late responses and further reads', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let finish!: (a: {status: string}) => void; const seen: string[] = [];
  const stop = watchApproval(() => new Promise<{status: string}>(r => { finish = r; }), a => seen.push(a.status), e => seen.push(e.message), 5);
  stop(); finish({status: 'ready'}); await Promise.resolve(); t.mock.timers.tick(25); assert.deepEqual(seen, []);
});

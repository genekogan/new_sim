// G9 (lane Z1): a viewer whose world closes its socket with 1001 "server restarting" (a release handover) tries again
// within 150 ms; any other close, or a second close before a welcome, keeps the exponential backoff (>= 250 ms first).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Connection } from '@sim/client';

type Fake = { send(s: string): void; close(): void; readyState: number; onopen: any; onmessage: any; onclose: any; onerror: any };
function rig(t: import('node:test').TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const made: Fake[] = [];
  const c = new Connection('ws://world.invalid/ws', async () => null, {}, () => { const ws: Fake = { send() {}, close() {}, readyState: 0, onopen: null, onmessage: null, onclose: null, onerror: null }; made.push(ws); return ws; });
  c.connect();
  t.after(() => c.close());
  return { made, c };
}

test('a 1001 close (server restarting) reconnects within 150 ms', (t) => {
  const { made } = rig(t);
  made[0].onclose({ code: 1001 });
  t.mock.timers.tick(149);
  assert.equal(made.length, 2, 'a second socket is opened within 150 ms');
});

test('another close, or a second 1001 before a welcome, waits the backoff', (t) => {
  const { made } = rig(t);
  made[0].onclose({ code: 1006 });
  t.mock.timers.tick(200);
  assert.equal(made.length, 1, 'an abnormal close waits at least 250 ms');
  t.mock.timers.tick(600);
  assert.equal(made.length, 2);
  made[1].onclose({ code: 1001 });
  t.mock.timers.tick(400);
  assert.equal(made.length, 2, 'not welcomed since: no fast retry, the backoff grows (>= 500 ms)');
});

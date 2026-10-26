import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {windowCheck, startWindowListener} from './window-fixture.mjs';
import {clientListen} from '../../edge-skill/client-inbox.mjs';

test('canonical A4/B1/C1 names survive card name details and retain the resident evidence', () => {
  const names = ['A4 the card appears top right in the same page, no navigation', 'B1 the card appears top right (dpr 2, dark)', 'C1 the card on a phone: at the top, on top, 44 px targets'];
  const rows = names.map((name, i) => windowCheck(name, true, {name: ['Ana', 'Bea', 'Cy'][i], box: [1, 2, 3, 4]}));
  for (const [i, name] of names.entries()) {
    assert.equal(rows.find(r => r.name === name)?.ok, true);
    assert.equal(rows[i].detail.name, ['Ana', 'Bea', 'Cy'][i]);
    assert.deepEqual(rows[i].box, [1, 2, 3, 4]);
  }
  const legacy = {name: names[0], ok: true, ...{name: 'Ana'}};
  assert.equal([legacy].some(r => r.name === names[0]), false, 'negative control reproduces missing canonical assertion');
});

test('details cannot override assertion truth in either direction or mutate the input', () => {
  const d = {name: 'resident', ok: true, detail: 'original detail field'};
  const failed = windowCheck('assertion', false, d);
  assert.equal(failed.name, 'assertion'); assert.equal(failed.ok, false);
  assert.deepEqual(failed.detail, d); assert.notEqual(failed.detail, d);
  assert.deepEqual(d, {name: 'resident', ok: true, detail: 'original detail field'});
  const passed = windowCheck('assertion', true, {ok: false});
  assert.equal(passed.ok, true); assert.equal(passed.detail.ok, false);
});

function childFixture() {
  const child = new EventEmitter(); child.pid = 43210;
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  const calls = [], kills = [];
  child.kill = signal => {kills.push(signal); queueMicrotask(() => child.emit('close', null, signal)); return true;};
  return {child, calls, kills, spawn(exe, args, options) {calls.push({exe, args, options}); return child;}};
}

test('fixture uses one normal bounded CLI listen in its own folder and awaits owned termination', async () => {
  const f = childFixture(), listener = startWindowListener('/fixture/eden-agent.mjs', '/fixture/ana', f.spawn);
  assert.deepEqual(f.calls, [{exe: process.execPath, args: ['/fixture/eden-agent.mjs', 'listen', '--once', '--timeout', '55'], options: {cwd: '/fixture/ana', stdio: ['ignore', 'pipe', 'pipe']}}]);
  assert.equal(listener.running(), true);
  const pollCalls = [];
  const answer = await clientListen(f.calls[0].args.slice(2), {call: async (path, options) => {pollCalls.push({path, options}); return {status: 200, data: {inbox: {connected: true}, backlog: []}};}});
  assert.deepEqual(pollCalls, [{path: '/v1/edge/inbox/listen?timeoutMs=55000', options: {timeoutMs: 65000}}]);
  assert.equal(answer.inbox.connected, true);
  f.child.stdout.emit('data', Buffer.from('whole stdout\n')); f.child.stderr.emit('data', Buffer.from('whole stderr\n'));
  const first = listener.stop(), second = listener.stop(); assert.equal(first, second);
  const result = await first;
  assert.equal(listener.running(), false); assert.deepEqual(f.kills, ['SIGTERM']);
  assert.equal(result.stdout, 'whole stdout\n'); assert.equal(result.stderr, 'whole stderr\n');
  assert.equal(result.stopReason, 'fixture-finished'); assert.equal(result.signal, 'SIGTERM'); assert.ok(result.endedAt);
});

test('fixture records early CLI failure instead of treating presence grace as an active listener', async () => {
  const f = childFixture(), listener = startWindowListener('/fixture/eden-agent.mjs', '/fixture/ana', f.spawn);
  f.child.emit('error', Error('cannot start')); f.child.emit('close', -2, null);
  assert.equal(listener.running(), false);
  const result = await listener.stop(); assert.match(result.error, /cannot start/); assert.equal(result.code, -2);
  assert.deepEqual(f.kills, []);
});

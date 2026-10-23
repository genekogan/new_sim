// Lane P3: an unwatched world runs its clock at a slower wall pace with no change in what happens per tick.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { marsFactory } from '@sim/engine-mars';
import { Attention, passiveRequest, unwatchedPace } from './attention.ts';
import { Db } from './db.ts';
import { WorldHost } from './world.ts';

test('pace: a quarter-pace world steps fewer ticks per wall second, and the same state at every common tick', async (t) => {
  const factory = await marsFactory();
  const run = (pace: number) => {
    const db = new Db(':memory:'), host = new WorldHost(db, factory, 'pace', 1e9, 'pace'); host.boot(); host.drainInputs();
    const hashes = new Map<number, string>();
    host.listeners.push({ afterTick: (tick) => { hashes.set(tick, host.engine.stateHash()); } });
    host.setPace(pace); host.start();
    t.after(() => { host.stop(); db.close(); });
    return { host, hashes, from: host.engine.world.tick };
  };
  const slow = run(0.25), full = run(1);
  await new Promise((r) => setTimeout(r, 2_000));
  slow.host.stop(); full.host.stop();
  const ns = slow.hashes.size, nf = full.hashes.size;
  assert.ok(nf >= 25, `full pace stepped ${nf} ticks in 2 s`);
  assert.ok(ns >= 3 && ns <= nf / 2.5, `quarter pace stepped ${ns} ticks vs ${nf}`);
  let common = 0;
  for (const [tick, h] of slow.hashes) if (full.hashes.has(tick)) { assert.equal(h, full.hashes.get(tick), `tick ${tick}`); common++; }
  assert.equal(common, ns, 'every slow tick has its full-pace twin');
  // back to full pace: the next ticks follow at 20 a second again
  slow.host.setPace(1); slow.host.start();
  const t0 = slow.host.engine.world.tick; await new Promise((r) => setTimeout(r, 1_000)); slow.host.stop();
  assert.ok(slow.host.engine.world.tick - t0 >= 12, `full pace again: ${slow.host.engine.world.tick - t0} ticks in 1 s`);
});

test('pace: setPace ignores values outside (0, 1]', () => {
  const h = Object.assign(Object.create(WorldHost.prototype), { pace: 1, timer: null, paused: false, last: 0, carry: 0, clockRate: 1 }) as WorldHost;
  h.setPace(0); h.setPace(-1); h.setPace(2); h.setPace(Number.NaN);
  assert.equal(h.pace, 1);
  h.setPace(0.25); assert.equal(h.pace, 0.25);
});

test('attention: unwatched only with no socket, nothing in flight and nothing for the grace time', () => {
  let now = 0; const seen: boolean[] = [];
  const a = new Attention((w) => seen.push(w), 30_000, () => now);
  now = 10_000; assert.equal(a.check(), true);
  now = 31_000; assert.equal(a.check(), false); assert.deepEqual(seen, [false]);
  a.touch(); assert.deepEqual(seen, [false, true]);
  a.inflight = 1; now = 100_000; assert.equal(a.check(), true);
  a.inflight = 0; a.open = 1; assert.equal(a.check(), true);
  a.open = 0; assert.equal(a.check(), false);
});

test('attention: passive reads (health, the homepage numbers without a token) do not count', () => {
  assert.equal(passiveRequest({ url: '/w/eden-2026/healthz', headers: {} }), true);
  assert.equal(passiveRequest({ url: '/v1/god/status?x=1', headers: {} }), true);
  assert.equal(passiveRequest({ url: '/v1/world/souls', headers: {} }), true);
  assert.equal(passiveRequest({ url: '/v1/god/status', headers: { authorization: 'Bearer g' } }), false);
  assert.equal(passiveRequest({ url: '/v1/config', headers: {} }), false);
  assert.equal(unwatchedPace({}), 0.25); assert.equal(unwatchedPace({ SIM_UNWATCHED_PACE: '0.1' }), 0.1); assert.equal(unwatchedPace({ SIM_UNWATCHED_PACE: '7' }), 0.25);
});

test('attention: a server counts websockets and requests', async (t) => {
  const server = createServer((_req, res) => { setTimeout(() => res.end('ok'), 50); });
  let changes = 0; const a = new Attention(() => { changes++; }, 0).watch(server, 60_000);
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => { a.stop(); server.close(); });
  const port = (server.address() as { port: number }).port;
  assert.equal(a.check(), false);
  const r = fetch(`http://127.0.0.1:${port}/v1/config`); await new Promise((x) => setTimeout(x, 20));
  assert.equal(a.inflight, 1); assert.equal(a.watched, true);
  await (await r).text(); await new Promise((x) => setTimeout(x, 20));
  assert.equal(a.inflight, 0);
  await (await fetch(`http://127.0.0.1:${port}/healthz`)).text();
  assert.equal(a.inflight, 0, 'health checks are not attention');
  assert.ok(changes >= 2);
});

test('attention: the Eyes render worker (user agent EdenEyes/1) is not a watcher', async (t) => {
  const server = createServer((_req, res) => { setTimeout(() => res.end('ok'), 50); });
  const a = new Attention(() => {}, 0).watch(server, 60_000);
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => { a.stop(); server.close(); });
  const port = (server.address() as { port: number }).port;
  assert.equal(a.check(), false);
  const ua = 'Mozilla/5.0 HeadlessChrome/140 EdenEyes/1';
  const r = fetch(`http://127.0.0.1:${port}/v1/config`, { headers: { 'user-agent': ua } }); await new Promise((x) => setTimeout(x, 20));
  assert.equal(a.inflight, 0); assert.equal(a.watched, false);
  await (await r).text();
  const { EventEmitter } = await import('node:events');
  server.emit('upgrade', { url: '/ws', headers: { 'user-agent': ua } }, new EventEmitter(), Buffer.alloc(0));
  assert.equal(a.open, 0); assert.equal(a.check(), false);
  const sock = new EventEmitter();
  server.emit('upgrade', { url: '/ws', headers: { 'user-agent': 'Mozilla/5.0' } }, sock, Buffer.alloc(0));
  assert.equal(a.open, 1); sock.emit('close'); assert.equal(a.open, 0);
});

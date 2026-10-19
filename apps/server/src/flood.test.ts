// P2 runaway-agent protection: overall token buckets per god token and per visitor address.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { FLOOD_LIMITS, RefusalLog, TokenBuckets, floodGuard } from './flood.ts';

test('a token bucket allows its burst, then one request per refill step, and says how long to wait', () => {
  let now = 0; const b = new TokenBuckets(10, 5, () => now);
  for (let i = 0; i < 5; i++) assert.equal(b.take('k'), 0);
  assert.equal(b.take('k'), 100);
  now += 100; assert.equal(b.take('k'), 0); assert.ok(b.take('k') > 0);
  assert.equal(b.take('other'), 0, 'keys are independent');
  now += 10_000; b.prune(); assert.equal(b.size, 0, 'full buckets are forgotten');
});

test('Gene\'s fastest observed build pace (157 requests a minute, 34 in 10 s, 6 in a second) is never refused', () => {
  let now = 0; const b = new TokenBuckets(FLOOD_LIMITS.godTokenPerS, FLOOD_LIMITS.godTokenBurst, () => now);
  // 10 minutes at the peak minute's rate, with every 10 s window holding a 6-in-a-second spike
  for (let s = 0; s < 600; s++) { const n = s % 10 === 0 ? 6 : (157 - 60) / 54; for (let i = 0; i < Math.round(n); i++) assert.equal(b.take('gene'), 0, `refused at ${s} s`); now += 1000; }
});

const app = (limits: Partial<Record<keyof typeof FLOOD_LIMITS, number>>, lines: string[]) => {
  let now = 1000; const a = new Hono();
  a.use('*', floodGuard({ godPool: (t) => (t === 'god_helper' ? 'lead' : t === 'god_lead' ? 'lead' : t), limits, now: () => now, log: new RefusalLog((l) => lines.push(l), 60_000, () => now) }));
  a.all('*', (c) => c.json({ ok: true }));
  return { a, tick: (ms: number) => { now += ms; } };
};

test('a runaway god token gets a polite 429 with Retry-After and a sentence; helpers share their lead\'s bucket; refusals are logged once then counted', async () => {
  const lines: string[] = [], { a, tick } = app({ godTokenPerS: 2, godTokenBurst: 3 }, lines);
  const act = (t: string) => a.request('/v1/god/act', { method: 'POST', headers: { authorization: `Bearer ${t}` }, body: '{}' });
  for (let i = 0; i < 2; i++) assert.equal((await act('god_lead')).status, 200);
  assert.equal((await act('god_helper')).status, 200);
  const r = await act('god_helper'); assert.equal(r.status, 429);
  assert.equal(r.headers.get('retry-after'), '1');
  const body = await r.json() as { code: string; message: string; retryAfterMs: number; retry_after: number };
  assert.equal(body.code, 'rate-limited'); assert.equal(body.message, 'slow down: more than 120 requests a minute from this god token; try again in 1 s'); assert.equal(body.retryAfterMs, 500);
  assert.equal((await act('god_other')).status, 200, 'another token is unaffected');
  for (let i = 0; i < 20; i++) await act('god_lead');
  assert.equal(lines.length, 1); assert.match(lines[0], /^\[limit\] refused god-token [0-9a-f]{8}: POST \/v1\/god\/act/);
  tick(60_000); await act('god_lead'); await act('god_lead'); await act('god_lead'); await act('god_lead');
  assert.equal(lines.length, 2); assert.match(lines[1], /refused god-token [0-9a-f]{8}: 2[01] more in the last 60 s/);
  tick(500); assert.equal((await act('god_lead')).status, 200, 'the bucket refills');
});

test('visitor addresses: writes and reads have separate buckets; no x-forwarded-for (this machine) is not address-limited; pages and static files pass', async () => {
  const lines: string[] = [], { a } = app({ ipWritesPerS: 1, ipWritesBurst: 2, ipReadsPerS: 1, ipReadsBurst: 3 }, lines);
  const from = (ip: string, method = 'POST', path = '/v1/souls/x/command') => a.request(path, { method, headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` }, ...(method === 'POST' ? { body: '{}' } : {}) });
  assert.equal((await from('1.2.3.4')).status, 200); assert.equal((await from('1.2.3.4')).status, 200);
  const r = await from('1.2.3.4'); assert.equal(r.status, 429); assert.match((await r.json() as { message: string }).message, /^slow down: more than 60 changes a minute from your address; try again in 1 s$/);
  assert.equal((await from('5.6.7.8')).status, 200, 'another address is unaffected');
  for (let i = 0; i < 3; i++) assert.equal((await from('1.2.3.4', 'GET', '/v1/world/seq')).status, 200, 'reads have their own bucket');
  assert.equal((await from('1.2.3.4', 'GET', '/v1/world/seq')).status, 429);
  assert.equal((await from('1.2.3.4', 'GET', '/assets/x.js')).status, 200, 'not an API route');
  for (let i = 0; i < 10; i++) assert.equal((await a.request('/v1/world/seq')).status, 200, 'no x-forwarded-for');
  assert.ok(lines.every((l) => !l.includes('1.2.3.4')), 'addresses are logged as short hashes');
});

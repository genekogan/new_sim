// P2: the launcher refuses a flood before contacting its world; pages, static files and this machine pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { launcherFlood, LAUNCHER_FLOOD } from './flood.mjs';

const req = (method, headers = {}) => ({ method, headers });

test('a flooding god token or address gets a 429 with Retry-After and a sentence; others, pages and local requests pass', () => {
  let now = 0; const lines = [];
  const check = launcherFlood({ limits: { godTokenPerS: 2, godTokenBurst: 2, ipPerS: 1, ipBurst: 3 }, now: () => now, log: (l) => lines.push(l) });
  const god = req('POST', { authorization: 'Bearer god_abc', 'x-forwarded-for': '9.9.9.9' });
  assert.equal(check(god, '/v1/god/act', true, 'a'), null); assert.equal(check(god, '/v1/god/act', true, 'a'), null);
  const r = check(god, '/v1/god/act', true, 'a');
  assert.equal(r.status, 429); assert.equal(r.headers['retry-after'], '1');
  assert.equal(r.body.message, 'slow down: more than 120 requests a minute from this god token; try again in 1 s');
  assert.equal(check(req('POST', { authorization: 'Bearer god_other', 'x-forwarded-for': '8.8.8.8' }), '/v1/god/act', true, 'a'), null);
  const visitor = req('GET', { 'x-forwarded-for': '1.1.1.1, 10.0.0.2' });
  for (let i = 0; i < 3; i++) assert.equal(check(visitor, '/v1/world/seq', true, 'b'), null);
  assert.equal(check(visitor, '/v1/world/seq', true, 'b').status, 429);
  assert.equal(check(visitor, '/', true, 'b'), null, 'the page is never counted');
  assert.equal(check(visitor, '/assets/app.js', true, 'b'), null, 'static files are never counted');
  for (let i = 0; i < 10; i++) assert.equal(check(req('GET', { 'x-forwarded-for': '1.1.1.1' }), '/v1/world/seq', false, 'b'), null, 'not behind a proxy: x-forwarded-for is not trusted');
  now += 1000; assert.equal(check(visitor, '/v1/world/seq', true, 'b'), null, 'refills');
  assert.equal(lines.length, 2); assert.ok(lines.every((l) => /^refused (god-token|address) [0-9a-f]{8}: /.test(l) && !l.includes('1.1.1.1') && !l.includes('god_abc')));
});

test('the launcher ceiling sits above the worlds\' own limits', () => {
  assert.ok(LAUNCHER_FLOOD.godTokenPerS >= 3 * 10 && LAUNCHER_FLOOD.ipPerS > 40 + 20);
});

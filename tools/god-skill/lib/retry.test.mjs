import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fetchWithRetry } from './retry.mjs';

test('429 retry honours milliseconds, seconds, numeric/date headers and preserves request bytes', async () => {
  const cases = [
    [{ retryAfterMs: 15 }, {}, 15], [{ retry_after: 2 }, {}, 2000], [{}, { 'retry-after': '3' }, 3000],
    [{}, { 'retry-after': 'Thu, 01 Jan 1970 00:00:05 GMT' }, 4000],
    [{ retryAfterMs: 200 }, { 'retry-after': '1' }, 1000], [{}, {}, 250],
  ];
  for (const [body, headers, delay] of cases) {
    const waits = [], calls = [], options = { method: 'POST', body: '{"clientRef":"fixed","ops":[]}' };
    const result = await fetchWithRetry('http://127.0.0.1:5368/v1/god/dryrun', options, {
      now: () => 1000, random: () => 0, sleep: async ms => waits.push(ms), fetch: async (url, opts) => { calls.push(opts); return calls.length === 1 ? Response.json(body, { status: 429, headers }) : Response.json({ accepted: true }); },
    });
    assert.equal(result.status, 200); assert.deepEqual(waits, [delay]); assert.equal(calls[0], options); assert.equal(calls[1], options);
  }
});

test('429/503 retries stop after four waits or a 60-second wait budget; other refusals are single requests', async () => {
  for (const status of [429, 503]) for (const [delay, expectedCalls, expectedWaits] of [[0, 5, 4], [30_000, 3, 2], [60_001, 1, 0]]) {
    let calls = 0; const waits = [];
    const response = await fetchWithRetry('http://127.0.0.1:5368', {}, { random: () => 0, sleep: async ms => waits.push(ms), fetch: async () => { calls++; return Response.json({ retryAfterMs: delay }, { status }); } });
    assert.equal(response.status, status); assert.equal(calls, expectedCalls); assert.equal(waits.length, expectedWaits); assert.ok(waits.reduce((a, b) => a + b, 0) <= 60_000);
  }
  let once = 0; assert.equal((await fetchWithRetry('http://127.0.0.1:5368', {}, { fetch: async () => { once++; return Response.json({ code: 'look.unavailable' }, { status: 503 }); } })).status, 503); assert.equal(once, 1, 'a 503 with no retry hint is not temporary');
  for (const status of [400, 401, 404, 500]) {
    let calls = 0; assert.equal((await fetchWithRetry('http://127.0.0.1:5368', {}, { fetch: async () => { calls++; return new Response('', { status }); } })).status, status); assert.equal(calls, 1);
  }
  for (const status of [502, 504]) {
    let calls = 0; assert.equal((await fetchWithRetry('http://127.0.0.1:5368', { method: 'POST', body: 'x' }, { fetch: async () => { calls++; return new Response('', { status }); } })).status, status); assert.equal(calls, 1, `a ${status} POST is not resent`);
    calls = 0; const waits = [];
    assert.equal((await fetchWithRetry('http://127.0.0.1:5368', {}, { sleep: async ms => waits.push(ms), fetch: async () => (++calls < 3 ? new Response('', { status }) : Response.json({ ok: true })) })).status, 200); assert.equal(calls, 3);
  }
});

test('waits back off exponentially with jitter, honour the server with up to 20% jitter, and never form a tight loop', async () => {
  for (const r of [0, 0.5, 0.999]) {
    const waits = [];
    await fetchWithRetry('http://127.0.0.1:5368', {}, { random: () => r, sleep: async ms => waits.push(ms), fetch: async () => new Response('', { status: 502 }) });
    assert.equal(waits.length, 4);
    waits.forEach((w, n) => { const cap = 500 * 2 ** n; assert.ok(w >= cap / 2 && w <= cap, `wait ${n} = ${w}`); });
    const hinted = [];
    await fetchWithRetry('http://127.0.0.1:5368', {}, { random: () => r, sleep: async ms => hinted.push(ms), fetch: async () => Response.json({}, { status: 429, headers: { 'retry-after': '2' } }) });
    assert.ok(hinted.every(w => w >= 2000 && w <= 2400), String(hinted));
  }
});

test('a lost connection is retried for reads and for a refused connection, never for a write that may have been sent', async () => {
  const lost = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
  const refused = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  let calls = 0; const sleep = async () => {};
  assert.equal((await fetchWithRetry('http://127.0.0.1:5368', {}, { sleep, fetch: async () => { if (++calls < 3) throw lost(); return Response.json({ ok: true }); } })).status, 200); assert.equal(calls, 3);
  calls = 0; await assert.rejects(fetchWithRetry('http://127.0.0.1:5368', { method: 'POST', body: 'x' }, { sleep, fetch: async () => { calls++; throw lost(); } }), /fetch failed/); assert.equal(calls, 1);
  calls = 0; assert.equal((await fetchWithRetry('http://127.0.0.1:5368', { method: 'POST', body: 'x' }, { sleep, fetch: async () => { if (++calls < 2) throw refused(); return Response.json({ ok: true }); } })).status, 200); assert.equal(calls, 2);
  calls = 0; await assert.rejects(fetchWithRetry('http://127.0.0.1:5368', {}, { sleep, fetch: async () => { calls++; throw lost(); } }), /fetch failed/); assert.equal(calls, 5, 'gives up after four retries');
  calls = 0; await assert.rejects(fetchWithRetry('http://127.0.0.1:5368', {}, { sleep, fetch: async () => { calls++; throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); } }), /timeout/); assert.equal(calls, 1, 'a timeout is the caller\'s');
});

test('each 429 retry gets its own per-attempt timeout, so a retry outlives the first attempt\'s signal', async t => {
  // 600 ms per attempt: the first answers 429 after 250 ms, the retry starts ~350 ms and answers after 400 ms more.
  // One signal shared across attempts would abort at 600 ms; a fresh one per attempt lets the 200 arrive.
  let hits = 0;
  const server = createServer((req, res) => {
    const first = ++hits === 1;
    setTimeout(() => { res.writeHead(first ? 429 : 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(first ? { retryAfterMs: 100 } : { accepted: true })); }, first ? 250 : 400);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetchWithRetry(`http://127.0.0.1:${server.address().port}/v1/god/act`, { method: 'POST', body: '{"ops":[]}', timeoutMs: 600 });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { accepted: true }); assert.equal(hits, 2);
});

test('per-attempt signals are fresh and a wait that cannot end before the deadline returns the 429', async () => {
  const signals = [], waits = []; let clock = 1000;
  const runtime = { now: () => clock, random: () => 0, sleep: async ms => { waits.push(ms); clock += ms; }, fetch: async (url, opts) => { signals.push(opts.signal); return signals.length === 1 ? Response.json({ retryAfterMs: 100 }, { status: 429 }) : Response.json({ ok: true }); } };
  const ok = await fetchWithRetry('http://127.0.0.1:5368', { method: 'POST', body: 'x', timeoutMs: 1000 }, runtime);
  assert.equal(ok.status, 200); assert.equal(signals.length, 2); assert.notEqual(signals[0], signals[1]); assert.ok(signals.every(s => s instanceof AbortSignal && !s.aborted));
  let calls = 0; clock = 1000;
  const refused = await fetchWithRetry('http://127.0.0.1:5368', { timeoutMs: 500 }, { now: () => clock, sleep: async ms => waits.push(ms), fetch: async () => { calls++; clock += 450; return Response.json({ retryAfterMs: 60 }, { status: 429 }); } });
  assert.equal(refused.status, 429); assert.equal(calls, 1); assert.deepEqual(waits, [100]);
});

test('the caller\'s deadline caps attempts and waits, and its signal cancels an attempt or a 429 wait (one look deadline)', async () => {
  let clock = 1000; const signals = [], waits = [];
  const refused = await fetchWithRetry('http://127.0.0.1:5368', { timeoutMs: 10_000, deadlineAt: 1500 }, { now: () => clock, sleep: async ms => waits.push(ms), fetch: async (url, opts) => { signals.push(opts.signal); return Response.json({ retryAfterMs: 600 }, { status: 429 }); } });
  assert.equal(refused.status, 429); assert.equal(signals.length, 1); assert.deepEqual(waits, []); assert.ok(signals[0] instanceof AbortSignal);
  const abort = new AbortController(); let calls = 0;
  const waiting = fetchWithRetry('http://127.0.0.1:5368', { signal: abort.signal }, { fetch: async (url, opts) => { calls++; assert.ok(opts.signal); return Response.json({ retryAfterMs: 5_000 }, { status: 429 }); } });
  setTimeout(() => abort.abort(Object.assign(Error('look.timeout: exceeded'), { code: 'look.timeout' })), 20);
  await assert.rejects(waiting, { code: 'look.timeout' }); assert.equal(calls, 1);
  const linked = new AbortController(); let seen;
  const pending = fetchWithRetry('http://127.0.0.1:5368', { timeoutMs: 60_000, signal: linked.signal }, { fetch: (url, opts) => new Promise((_, reject) => { seen = opts.signal; seen.addEventListener('abort', () => reject(seen.reason)); }) });
  linked.abort(Error('cancelled')); await assert.rejects(pending, /cancelled/); assert.ok(seen.aborted);
});

test('a wait of 5 s or more is said once on stderr before it starts; shorter waits stay silent', async () => {
  for (const [hint, expected] of [[48_000, [[48_000, 429]]], [2_000, []]]) {
    const said = []; let calls = 0;
    const r = await fetchWithRetry('http://127.0.0.1:5368', { method: 'POST' }, { random: () => 0, sleep: async () => {}, onWait: (ms, status) => said.push([ms, status]),
      fetch: async () => (++calls === 1 ? Response.json({ retryAfterMs: hint }, { status: 429 }) : Response.json({ ok: true })) });
    assert.equal(r.status, 200); assert.deepEqual(said, expected);
  }
});

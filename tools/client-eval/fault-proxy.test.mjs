import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startFaultProxy } from './fault-proxy.mjs';

test('failed SSE leaves long-poll available, and cleanup closes stalled connections', async () => {
  const upstream = http.createServer((req, res) => {
    if (req.url === '/v1/edge/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end('event: hello\ndata: {}\n\nevent: receipt.terminal\ndata: {"id":"real-fixture"}\n\n'); }
    else { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ event: 'receipt.terminal', authorizationReceived: req.headers.authorization === 'Bearer fixture-only' })); }
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const seen = [];
  const proxy = await startFaultProxy({ target: `http://127.0.0.1:${upstream.address().port}`, onObservation: x => seen.push(x) });
  try {
    proxy.setFault('no-hello');
    const signal = AbortSignal.timeout(300);
    const stream = await fetch(`${proxy.origin}/v1/edge/events`, { signal });
    assert.equal(stream.status, 200);
    await assert.rejects(stream.text(), /abort|timeout/i);
    const wait = await fetch(`${proxy.origin}/v1/edge/wait?timeout=1`, { headers: { authorization: 'Bearer fixture-only' } });
    assert.deepEqual(await wait.json(), { event: 'receipt.terminal', authorizationReceived: true });
    assert.equal(seen.length, 1);
    assert.equal(JSON.stringify(seen).includes('fixture-only'), false);
    proxy.setFault('none');
    assert.match(await (await fetch(`${proxy.origin}/v1/edge/events`)).text(), /receipt.terminal/);
    proxy.setFault('stall-after-hello');
    assert.equal(await (await fetch(`${proxy.origin}/v1/edge/events`)).text(), 'event: hello\ndata: {}\n\n');
  } finally {
    await proxy.close();
    await new Promise(resolve => upstream.close(resolve));
  }
});

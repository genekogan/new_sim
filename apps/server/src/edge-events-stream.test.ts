// EVENTS-v1: push stream (SSE + WebSocket) resumable by cursor without loss or duplicates, server-side filters, the
// envelope, the digest's size, world.notice, idempotency keys, approach / follow.stop / world.leave, and the schema.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {WebSocket} from 'ws';
import {eventsFixture, readSSE} from './edge/events/testing.ts';
import {relativeBearing, toEnvelope, mediaOf} from './edge/events/envelope.ts';
import {EDGE_CONTRACT} from './edge/contract.ts';
import {HEARTBEAT_MS} from './edge/events/index.ts';
import {mountBodyRoutes} from './edge/body/routes.ts';

const MIN = 60_000;

test('mounted SSE drains speech appended while an earlier send is backpressured', async () => {
  const f = eventsFixture(['Roger', 'Bill'], {events: {heartbeatMs: HEARTBEAT_MS}});
  const ac = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let deadline: ReturnType<typeof setTimeout> | null = null;
  try {
    f.at('Roger', 0, 0); f.at('Bill', 1, 0);
    const since = f.runtime.streams.headCursor(f.id('Roger'));
    await f.post('Bill', '/v1/edge/say', {text: 'first buffered speech'});
    let pageRead!: () => void;
    const reading = new Promise<void>(resolve => { pageRead = resolve; });
    const read = f.runtime.streams.read.bind(f.runtime.streams);
    f.runtime.streams.read = (id, after, limit) => {
      const page = read(id, after, limit);
      if (id === f.id('Roger') && page.events.some(e => e.text === 'first buffered speech')) pageRead();
      return page;
    };
    const response = await f.app.request(`/v1/edge/events?cursor=${since}&pad=0`, {headers: {authorization: `Bearer ${f.id('Roger')}`}, signal: ac.signal});
    assert.equal(response.status, 200);
    reader = response.body!.getReader();
    await reading;
    await new Promise<void>(resolve => setImmediate(resolve));
    // The unread hello occupies Hono's response buffer. The first speech send
    // cannot drain until this reader resumes; append through the mounted API.
    await f.post('Bill', '/v1/edge/say', {text: 'second arrived during send'});
    const speech: {id: string; text: string}[] = [], decoder = new TextDecoder();
    let buffered = '';
    const drain = (async () => {
      while (speech.length < 2) {
        const chunk = await reader!.read();
        assert.equal(chunk.done, false, 'the stream remains open through both speeches');
        buffered += decoder.decode(chunk.value, {stream: true});
        let end: number;
        while ((end = buffered.indexOf('\n\n')) >= 0) {
          const block = buffered.slice(0, end); buffered = buffered.slice(end + 2);
          if (!/^event: speech\./m.test(block)) continue;
          const data = JSON.parse(block.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n'));
          speech.push({id: data.id, text: data.data.text});
        }
      }
    })();
    await Promise.race([drain, new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(Error('stored speech waited for the 15-second heartbeat instead of draining immediately')), 3000); })]);
    assert.deepEqual(speech.map(e => e.text), ['first buffered speech', 'second arrived during send']);
    assert.equal(new Set(speech.map(e => e.id)).size, 2, 'each cursor arrives once');
  } finally { if (deadline) clearTimeout(deadline); ac.abort(); await reader?.cancel().catch(() => {}); f.destroy(); }
});

test('envelope: kinds, salience, about, where (distance and bearing relative to my heading), one-line text', async () => {
  const f = eventsFixture(['Roger', 'Bill', 'Carol']);
  try {
    f.at('Roger', 0, 0, undefined, null, 0);              // facing +x
    f.at('Bill', 2, 2); f.at('Carol', -5, 0);
    await f.post('Bill', '/v1/edge/say', {text: 'Roger, how was your day?'});
    await f.post('Carol', '/v1/edge/say', {text: 'the weather is lovely'});
    await f.post('Bill', '/v1/edge/say', {text: 'I told roger about it'});
    const env = await f.envelopes('Roger');
    const [toMe, ambient, mention] = env.filter(e => e.raw === 'speech');
    assert.equal(toMe!.kind, 'speech.to-me'); assert.equal(toMe!.salience, 3);
    assert.deepEqual(toMe!.about, {soulId: f.id('Bill'), name: 'Bill'});
    assert.equal(toMe!.where!.dist, 2.8); assert.equal(toMe!.where!.bearing, 'front-right');     // +x ahead, +z to the right
    assert.match(toMe!.text, /^Bill \(3 m, front-right\): "Roger, how was your day\?"$/);
    assert.equal(toMe!.untrusted, true); assert.equal(toMe!.data!.text, 'Roger, how was your day?');
    assert.equal(ambient!.kind, 'speech.ambient'); assert.equal(ambient!.salience, 1); assert.equal(ambient!.where!.bearing, 'behind');
    assert.equal(mention!.kind, 'mention'); assert.equal(mention!.salience, 3);
    assert.ok(env.every(e => e.id.startsWith('c_') && typeof e.tick === 'number' && 'clock' in e));
    // bearings: the engine's yaw faces (cos, sin); its right is (−sin, cos)
    assert.equal(relativeBearing(0, 1, 0), 'ahead'); assert.equal(relativeBearing(0, 0, 1), 'right'); assert.equal(relativeBearing(0, 0, -1), 'left');
    assert.equal(relativeBearing(Math.PI / 2, 0, 1), 'ahead'); assert.equal(relativeBearing(Math.PI / 2, 1, 0), 'left'); assert.equal(relativeBearing(0, -1, 0.1), 'behind');
    // receipts: terminal mine = 3, replaced = 1, plan-driven = 1; blocked codes are their own kind
    const r = (phase: string, code: string | null = null, plan = false) => toEnvelope({id: 'c_9', kind: 'receipt', tick: 1, at: 1, receipt: {id: 'r_1', capability: 'walk:pond', phase, code, reason: 'x'}, ...(plan ? {plan: {id: 'pl_x', step: 0}} : {})}, {soulId: 's', name: 'S'});
    assert.deepEqual([r('completed').kind, r('completed').salience], ['receipt.terminal', 3]);
    assert.deepEqual([r('replaced').salience, r('completed', null, true).salience, r('started').salience, r('waiting').salience], [1, 1, 1, 0]);
    assert.deepEqual([r('failed', 'route.blocked').kind, r('failed', 'route.blocked').salience], ['blocked', 3]);
    const attention = toEnvelope({id:'c_a', kind:'receipt', tick:1, at:1, receipt:{phase:'completed', capability:'look:left', channel:'attention', chosen:{direction:'left'}}}, {soulId:'s',name:'S'});
    assert.equal(attention.salience, 0); assert.deepEqual((attention.data!.receipt as any).chosen, {direction:'left'});
    const arrive = toEnvelope({id:'c_b',kind:'arrive',tick:1,at:1,placePath:['Garden','Eden'],plan:{id:'pl_x',step:0},endedAt:{posture:'standing'}}, {soulId:'s',name:'S'});
    assert.equal(arrive.kind, 'arrive'); assert.equal(arrive.salience, 1); assert.equal(arrive.text, 'You arrived at Garden.');
    const blocked = toEnvelope({id:'c_c',kind:'receipt',tick:1,at:1,receipt:{phase:'failed',code:'seat.taken',alternatives:[{capability:'sit:seat-2'}]}}, {soulId:'s',name:'S'});
    assert.equal(blocked.kind, 'blocked'); assert.deepEqual((blocked.data!.receipt as any).alternatives,[{capability:'sit:seat-2'}]);
    // media from shared slides
    assert.deepEqual(mediaOf('Slide 2 ![the pond at dawn](https://example.org/pond.jpg) and https://example.org/b.png'), [{type: 'image', url: 'https://example.org/pond.jpg', alt: 'the pond at dawn'}, {type: 'image', url: 'https://example.org/b.png', alt: 'picture'}]);
  } finally { f.destroy(); }
});

test('SSE: resumable by cursor (Last-Event-ID) without loss or duplicates; kinds and salience filters; heartbeat cursor', async () => {
  const f = eventsFixture(['Roger', 'Bill', 'Carol']);
  try {
    f.at('Roger', 0, 0); f.at('Bill', 1, 0); f.at('Carol', 3, 0);
    const head = f.runtime.streams.headCursor(f.id('Roger'));
    const sent: string[] = [];
    const burst = async (n: number, tag: string) => { for (let i = 0; i < n; i++) { const t = `${tag} ${i}`; sent.push(t); await f.post('Bill', '/v1/edge/say', {text: t}); } };
    await burst(5, 'a');
    const got: string[] = [];
    let last = head;
    for (const round of ['b', 'c', 'd']) {
      const ac = new AbortController();
      const res = await f.app.request(`/v1/edge/events?pad=0`, {headers: {authorization: `Bearer ${f.id('Roger')}`, 'last-event-id': last}, signal: ac.signal});
      assert.equal(res.status, 200); assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
      const pending = burst(4, round);              // events arrive while connected; we hang up after reading only two new ones
      const want = got.length + 2;
      const msgs = await readSSE(res, m => got.length + m.filter(x => x.event.startsWith('speech')).length >= want, 3000);
      ac.abort(); await pending;
      const hello = msgs.find(m => m.event === 'hello'); assert.equal(hello?.data.contract, EDGE_CONTRACT); assert.equal(hello?.data.cursor, last);
      for (const m of msgs.filter(x => x.event.startsWith('speech'))) { got.push(m.data.data.text); last = m.id!; assert.equal(m.data.id, m.id); }
      await burst(2, round + '-offline');           // events while disconnected
    }
    // drain the rest
    const res = await f.app.request(`/v1/edge/events?cursor=${last}&pad=0`, {headers: {authorization: `Bearer ${f.id('Roger')}`}});
    const tail = await readSSE(res, m => got.length + m.filter(x => x.event.startsWith('speech')).length >= sent.length, 3000);
    for (const m of tail.filter(x => x.event.startsWith('speech'))) got.push(m.data.data.text);
    assert.deepEqual(got, sent, 'every event exactly once, in order');
    // filters: only salience ≥ 3 (speech addressed to Roger), and a kinds filter by prefix; filtered events still advance the cursor
    const before = f.runtime.streams.headCursor(f.id('Roger'));
    await f.post('Bill', '/v1/edge/say', {text: 'Roger, look!'});
    await f.post('Bill', '/v1/edge/say', {text: 'nice weather'});
    const hi = await readSSE(await f.app.request(`/v1/edge/events?cursor=${before}&minSalience=3&pad=0`, {headers: {authorization: `Bearer ${f.id('Roger')}`}}), m => m.some(x => x.event === 'cursor'), 2000);
    assert.deepEqual(hi.filter(m => m.event.startsWith('speech')).map(m => m.data.text), ['Bill (1 m, ahead): "Roger, look!"']);
    const cursorMsg = hi.find(m => m.event === 'cursor'); assert.ok(cursorMsg, 'a heartbeat carries the scanned cursor');
    const alt = await readSSE(await f.app.request(`/v1/edge/events?cursor=${before}&salience>=2&kinds=mention,speech.*&pad=0`, {headers: {authorization: `Bearer ${f.id('Roger')}`}}), m => m.some(x => x.event === 'cursor'), 2000);
    assert.deepEqual(alt.filter(m => m.event.startsWith('speech')).map(m => m.event), ['speech.to-me']);
    // raw format: the wait vocabulary
    const raw = await readSSE(await f.app.request(`/v1/edge/events?cursor=${before}&format=raw&pad=0`, {headers: {authorization: `Bearer ${f.id('Roger')}`}}), m => m.filter(x => x.event === 'speech').length >= 2, 2000);
    assert.equal(raw.filter(x => x.event === 'speech')[1]!.data.text, 'nice weather');
    // bad cursor / no token
    assert.equal((await f.get('Roger', '/v1/edge/events?cursor=bogus')).status, 400);
    assert.equal((await f.app.request('/v1/edge/events')).status, 401);
  } finally { f.destroy(); }
});

test('WebSocket: auth by first message, resume by cursor, live filter change, per-Soul connection cap', async () => {
  const f = eventsFixture(['Roger', 'Bill', 'Carol']);
  try {
    f.at('Roger', 0, 0); f.at('Bill', 1, 0); f.at('Carol', 3, 0);
    const host = await f.listen();
    const open = (q: string, headers?: Record<string, string>) => new Promise<{ws: WebSocket; msgs: any[]}>((res, rej) => {
      const ws = new WebSocket(`ws://${host}/v1/edge/events/ws${q}`, headers ? {headers} : undefined), msgs: any[] = [];
      ws.on('message', d => msgs.push(JSON.parse(String(d)))); ws.on('open', () => res({ws, msgs})); ws.on('error', rej);
    });
    const until = async (p: () => boolean, ms = 3000) => { const t = Date.now(); while (!p() && Date.now() - t < ms) await new Promise(r => setTimeout(r, 20)); assert.ok(p(), 'condition in time'); };
    const start = f.runtime.streams.headCursor(f.id('Roger'));
    await f.post('Bill', '/v1/edge/say', {text: 'one'});
    const a = await open(`?cursor=${start}`); a.ws.send(JSON.stringify({type: 'auth', token: f.id('Roger')}));
    await until(() => a.msgs.some(m => m.type === 'event'));
    assert.equal(a.msgs[0].type, 'hello');
    assert.equal(a.msgs.find(m => m.type === 'event').event.data.text, 'one');
    const lastId = a.msgs.filter(m => m.type === 'event').at(-1).id;
    a.ws.send(JSON.stringify({type: 'filter', minSalience: 3}));
    await new Promise(r => setTimeout(r, 50));
    await f.post('Bill', '/v1/edge/say', {text: 'two'}); await f.post('Bill', '/v1/edge/say', {text: 'Roger, three'});
    await until(() => a.msgs.some(m => m.type === 'event' && m.event.data.text === 'Roger, three'));
    assert.ok(!a.msgs.some(m => m.type === 'event' && m.event.data.text === 'two'), 'filtered live');
    a.ws.close();
    // resume after the first event with the header auth: two and three, nothing twice
    const b = await open(`?cursor=${lastId}`, {authorization: `Bearer ${f.id('Roger')}`});
    await until(() => b.msgs.filter(m => m.type === 'event').length >= 2);
    assert.deepEqual(b.msgs.filter(m => m.type === 'event').map(m => m.event.data.text), ['two', 'Roger, three']);
    // cap: three streams per Soul; a fourth closes the oldest with a reason
    const c = await open('', {authorization: `Bearer ${f.id('Roger')}`}), d = await open('', {authorization: `Bearer ${f.id('Roger')}`});
    await until(() => f.events.connections(f.id('Roger')) === 3);
    const e = await open('', {authorization: `Bearer ${f.id('Roger')}`});
    await until(() => b.msgs.some(m => m.type === 'bye'));
    assert.match(b.msgs.find(m => m.type === 'bye').reason, /more than 3/);
    await until(() => f.events.connections(f.id('Roger')) === 3);
    // a bad token is refused with an error message and close code 4401
    const bad = await open('', {authorization: 'Bearer nobody'});
    await until(() => bad.msgs.some(m => m.type === 'error'));
    assert.equal(bad.msgs[0].error.code, 'unauthorized');
    for (const x of [c, d, e, bad]) x.ws.close();
  } finally { f.destroy(); }
});

test('digest since a cursor: counts and the salient items in a few hundred tokens, not the raw backlog', async () => {
  const f = eventsFixture(['Roger', 'Bill', 'Carol']);
  try {
    f.at('Roger', 0, 0); f.at('Bill', 1, 0); f.at('Carol', 2, 0);
    const since = f.runtime.streams.headCursor(f.id('Roger'));
    for (let i = 0; i < 120; i++) await f.post(i % 3 ? 'Carol' : 'Bill', '/v1/edge/say', {text: i % 10 === 0 ? `Roger, question ${i}: what do you think about the long weather today and the fire?` : `ambient chatter number ${i} about nothing in particular, at some length`});
    const cv = await f.post('Bill', '/v1/edge/converse', {op: 'start', with: [f.id('Roger')], text: 'Got a minute?'});
    assert.equal(cv.body.accepted, true, JSON.stringify(cv.body));
    f.events.notice({text: 'Restart at 14:00 for an upgrade.', level: 'maintenance'});
    const {status, body} = await f.get('Roger', `/v1/edge/events/digest?since=${since}`);
    assert.equal(status, 200);
    const size = JSON.stringify(body).length;
    assert.ok(size <= 2400, `digest is small: ${size} chars`);
    assert.equal(body.counts.total, 122); assert.equal(body.counts.byKind['speech.to-me'], 12); assert.equal(body.counts.byKind['speech.ambient'], 108);
    assert.equal(body.toMe.length, 3); assert.match(body.toMe[2], /question 110/);
    assert.deepEqual(body.conversations.map((c: any) => c.with), [['Bill']]);
    assert.deepEqual(body.notices, ['Restart at 14:00 for an upgrade.']);
    assert.match(body.text, /122 events/);
    assert.equal(body.cursor, f.runtime.streams.headCursor(f.id('Roger')));
    assert.equal((await f.get('Roger', '/v1/edge/events/digest?since=nope')).status, 400);
  } finally { f.destroy(); }
});

test('world.notice: steward-only POST (503 when no token is configured), delivered to every live Soul', async () => {
  const off = eventsFixture(['Roger']);
  try { assert.equal((await off.app.request('/v1/edge/steward/notice', {method: 'POST', body: '{"text":"x"}', headers: {'content-type': 'application/json'}})).status, 503); } finally { off.destroy(); }
  const f = eventsFixture(['Roger', 'Bill'], {comms: {stewardToken: 'steward-secret-123456'}});
  try {
    const post = (auth: string, body: unknown) => f.app.request('/v1/edge/steward/notice', {method: 'POST', headers: {authorization: `Bearer ${auth}`, 'content-type': 'application/json'}, body: JSON.stringify(body)});
    assert.equal((await post('wrong', {text: 'x'})).status, 401);
    assert.equal((await post('steward-secret-123456', {})).status, 400);
    const ok = await post('steward-secret-123456', {text: 'The world restarts in 2 minutes; plans carry on.', level: 'restart'});
    assert.equal(ok.status, 200); assert.equal((await ok.json() as any).notice.delivered, 2);
    for (const n of ['Roger', 'Bill']) {
      const e = (await f.envelopes(n)).find(x => x.kind === 'world.notice')!;
      assert.equal(e.salience, 3); assert.equal(e.text, 'The world restarts in 2 minutes; plans carry on.'); assert.equal(e.untrusted, false);
    }
  } finally { f.destroy(); }
});

test('idempotency keys: a retried say/converse/plan returns the original result and acts once; a reused key with another body is refused', async () => {
  const f = eventsFixture(['Roger', 'Bill']);
  try {
    f.at('Roger', 0, 0); f.at('Bill', 1, 0);
    const send = (path: string, body: unknown, key?: string) => f.app.request(path, {method: 'POST', headers: {authorization: `Bearer ${f.id('Roger')}`, 'content-type': 'application/json', ...(key ? {'idempotency-key': key} : {})}, body: JSON.stringify(body)});
    const a = await send('/v1/edge/say', {text: 'hello once'}, 'k-1'), b = await send('/v1/edge/say', {text: 'hello once'}, 'k-1');
    assert.equal(a.status, 200); assert.equal(b.headers.get('idempotent-replay'), 'true');
    assert.deepEqual(await b.json(), await a.json());
    assert.equal((await f.envelopes('Bill')).filter(e => e.raw === 'speech').length, 1, 'heard once');
    assert.equal((await send('/v1/edge/say', {text: 'something else'}, 'k-1')).status, 409);
    // body field form
    const c1 = await send('/v1/edge/converse', {op: 'start', with: [f.id('Bill')], idempotencyKey: 'conv-7'}), c2 = await send('/v1/edge/converse', {op: 'start', with: [f.id('Bill')], idempotencyKey: 'conv-7'});
    assert.equal((await c1.json() as any).conversation?.id ?? 'x', (await c2.json() as any).conversation?.id ?? 'x');
    assert.equal((await f.envelopes('Bill')).filter(e => e.kind === 'conversation.invite').length, 1, 'invited once');
    const p1 = await send('/v1/edge/plan', {steps: [{do: 'sit down', for: '5m'}]}, 'plan-1'), p2 = await send('/v1/edge/plan', {steps: [{do: 'sit down', for: '5m'}]}, 'plan-1');
    assert.equal((await p1.json() as any).plan.id, (await p2.json() as any).plan.id);
    assert.equal(f.actor.acts.length, 1, 'one act');
    assert.equal((await send('/v1/edge/say', {text: 'x'}, 'bad key with spaces')).status, 400);
  } finally { f.destroy(); }
});

test('new kinds: approach (once, hysteresis), follow.stop to the followed Soul, world.leave / world.join to Souls who met', async () => {
  const f = eventsFixture(['Roger', 'Bill', 'Carol']);
  try {
    f.at('Roger', 0, 0); f.at('Bill', 10, 0); f.at('Carol', 50, 0);
    f.events.sweep(20);
    f.at('Bill', 2, 0); f.events.sweep(40); f.events.sweep(60);
    f.at('Bill', 5, 0); f.events.sweep(80); f.at('Bill', 1, 0); f.events.sweep(100);   // within 6 m: still close, no repeat
    const ap = (await f.envelopes('Roger')).filter(e => e.kind === 'approach');
    assert.equal(ap.length, 1); assert.equal(ap[0]!.salience, 2); assert.equal(ap[0]!.about!.name, 'Bill');
    assert.equal((await f.envelopes('Bill')).filter(e => e.kind === 'approach').length, 1);
    // follow.stop
    f.ledger.receipt({id: 'r_f', soulId: f.id('Carol'), capability: 'follow:' + f.id('Roger'), phase: 'started'});
    f.ledger.receipt({id: 'r_f', soulId: f.id('Carol'), capability: 'follow:' + f.id('Roger'), phase: 'replaced'});
    const fs = (await f.envelopes('Roger')).filter(e => e.kind === 'follow.stop');
    assert.equal(fs.length, 1); assert.match(fs[0]!.text, /Carol stopped walking with you/);
    // met → world.leave on fading out, world.join on return
    await f.post('Bill', '/v1/edge/say', {text: 'hi Roger'});
    f.runtime.sweep();
    f.clock.now += 20 * MIN; await f.post('Roger', '/v1/edge/say', {text: 'still here'});
    f.clock.now += 45 * MIN; f.runtime.sweep();                 // Bill: 65 min abandoned → gone; Roger met him
    const leave = (await f.envelopes('Roger')).filter(e => e.kind === 'world.leave');
    assert.equal(leave.length, 1); assert.equal(leave[0]!.about!.name, 'Bill');
    assert.equal((await f.envelopes('Carol')).filter(e => e.kind === 'world.leave' && e.about?.name === 'Bill').length, 0, 'Carol never met Bill');
    await f.post('Bill', '/v1/edge/say', {text: 'back'});
    assert.equal((await f.envelopes('Roger')).filter(e => e.kind === 'world.join').length, 1);
  } finally { f.destroy(); }
});

test('schema: machine-readable verbs, plan grammar, event kinds and limits (public)', async () => {
  const f = eventsFixture(['Roger']);
  try {
    mountBodyRoutes(f.app,{...f.deps,souls:{cfg:{worldPath:'/w/eden'}}} as never);
    const res = await f.app.request('/v1/edge/schema'), body = await res.json() as any;
    assert.equal(res.status, 200); assert.equal(body.contract, EDGE_CONTRACT); assert.equal(body.schema, 'eden-edge-schema/1');
    assert.equal(body.events.kinds['speech.to-me'].salience, 3); assert.equal(body.events.kinds['plan.step.failed'].salience, 3);
    assert.ok(body.act.verbs.includes('sit')); assert.ok(body.plan.step.until); assert.equal(body.limits.eventStreamsPerSoul, 3);
    assert.ok(body.endpoints.some((e: any) => e.path === '/v1/edge/events' && e.produces === 'text/event-stream'));
    assert.equal(body.body.contract,'body/1');
    assert.equal(Object.keys(body.act.verbOutcomes).length,body.act.verbs.length);
    assert.ok(Buffer.byteLength(JSON.stringify(body), 'utf8') < 16_000, 'small enough to fetch once per session');
  } finally { f.destroy(); }
});

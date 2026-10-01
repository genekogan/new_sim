// End-to-end sync: a real server process, real WebSocket clients, fake brain.
// Asserts that replicas agree with the server's view hash, survive a dropped
// socket by resuming from the ring buffer, and that the agent API steers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { Connection } from '@sim/client';

const PORT = 4600 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
let proc: ChildProcess;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const client = (token: string | null = null) => { const c = new Connection(`ws://127.0.0.1:${PORT}/ws`, async () => token, {}, (u) => new WebSocket(u) as any); c.connect(); return c; };
const api = async (path: string, token: string, body?: unknown, method?: string) => {
  const r = await fetch(BASE + path, { method: method ?? (body ? 'POST' : 'GET'), headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t as any }; }
};

before(async () => {
  proc = spawn(process.execPath, [new URL('./main.ts', import.meta.url).pathname], {
    env: { PATH: process.env.PATH, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: mkdtempSync(join(tmpdir(), 'sim-sync-')), BRAIN_MODE: 'fake', DEV_AUTH: '1', PUBLIC_URL: BASE, WEB_DIR: '/nonexistent', INVITE_REQUIRED: '1' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`${BASE}/healthz`)).ok) return; } catch { /* not up yet */ } await sleep(200); }
  throw new Error('server did not start');
});
after(() => { proc?.kill('SIGTERM'); });

test('two clients joining at different times agree with the server', async () => {
  const a = client(); await sleep(3000);
  const b = client(); await sleep(12000);
  for (const c of [a, b]) {
    assert.equal(c.stats.state, 'open');
    assert.ok(c.stats.heartbeats >= 2, `heartbeats ${c.stats.heartbeats}`);
    assert.equal(c.stats.lastCheck, 'ok');
    assert.equal(c.stats.resyncs, 0);
    assert.equal(c.stats.snapshots, 1);
  }
  assert.equal(a.replica.viewHash(a.stats.lastHeartbeatTick), b.replica.viewHash(a.stats.lastHeartbeatTick));
  assert.ok(Object.values(a.replica.entities).filter((e) => e.kind === 'human').length >= 6);
  a.close(); b.close();
});

test('a dropped socket resumes from the ring buffer without a new snapshot and converges', async () => {
  const c = client(); await sleep(6000);
  assert.equal(c.stats.lastCheck, 'ok');
  c.dropForTest(); await sleep(7000);
  assert.equal(c.stats.state, 'open');
  assert.equal(c.stats.reconnects, 1);
  assert.equal(c.stats.snapshots, 1, 'resumed from the ring, no second snapshot');
  await sleep(5500);
  assert.equal(c.stats.lastCheck, 'ok');
  assert.equal(c.stats.resyncs, 0);
  c.close();
});

test('a corrupted replica detects the mismatch and resyncs', async () => {
  const c = client(); await sleep(6000);
  const id = Object.keys(c.replica.entities).find((k) => c.replica.entities[k].kind === 'human')!;
  c.replica.entities[id].human!.activity = 'corrupted';
  c.replica.paths.delete(id);
  await sleep(11000);
  assert.ok(c.stats.resyncs >= 1, 'asked for a resync');
  assert.ok(c.stats.snapshots >= 2);
  assert.equal(c.stats.lastCheck, 'ok');
  c.close();
});

test('invite gate: a new user cannot create a Soul until they redeem a code', async () => {
  const blocked = await api('/v1/souls', 'dev:alice', { name: 'Testa', description: 'a test soul who likes benches' });
  assert.equal(blocked.status, 403); assert.equal(blocked.body.code, 'invite-required');
  assert.equal((await api('/v1/me', 'dev:alice')).body.me.invited, false);
  assert.equal((await api('/v1/admin', 'dev:alice', { action: 'invite', uses: 2 })).status, 403);
  const inv = await api('/v1/admin', 'dev:admin', { action: 'invite', uses: 2, note: 'test' });
  assert.equal(inv.status, 200);
  assert.equal((await api('/v1/invite', 'dev:alice', { code: 'nope' })).status, 404);
  assert.equal((await api('/v1/invite', 'dev:alice', { code: inv.body.code })).status, 200);
  assert.equal((await api('/v1/invite', 'dev:bob', { code: inv.body.code })).status, 200);
  assert.equal((await api('/v1/invite', 'dev:carol', { code: inv.body.code })).status, 404, 'code is used up');
  assert.equal((await api('/v1/me', 'dev:alice')).body.me.invited, true);
});

test('create a Soul, steer it from the page, pair an agent both ways, steer by REST and MCP', async () => {
  const user = 'dev:alice';
  const made = await api('/v1/souls', user, { name: 'Testa', description: 'a test soul who likes benches' });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const id = made.body.soul.id;
  assert.equal((await api('/v1/souls', 'dev:bob', { name: 'testa', description: 'imposter' })).status, 409);
  assert.equal((await api(`/v1/souls/${id}`, 'dev:bob')).status, 403);
  assert.deepEqual((await api('/v1/me', user)).body.me.souls, [id]);
  await sleep(500);
  // structured intent from the page, with a private note
  const set = await api(`/v1/souls/${id}/intent`, user, { intent: { goal: 'go', target: 'the kiosk', note: 'secret plan' } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.intent.target, 'kiosk');

  // --- pairing, owner-initiated: a short code in a one-line prompt
  const pair = await api(`/v1/souls/${id}/pair`, user, {});
  assert.match(pair.body.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.ok(pair.body.prompt.includes('/skill.md') && pair.body.prompt.includes(pair.body.code));
  const skill = await (await fetch(`${BASE}/skill.md`)).text();
  assert.ok(skill.startsWith('---\nname: sim') && skill.includes('/v1/agent/pair'));
  const post = (path: string, b: unknown) => fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, body: await r.json() as any }));
  const ex = await post('/v1/agent/pair', { code: pair.body.code.toLowerCase().replace('-', ''), agent: 'test agent' });
  assert.equal(ex.status, 200, JSON.stringify(ex.body));
  const token = ex.body.token as string;
  assert.equal(ex.body.soul.name, 'Testa');
  assert.equal((await post('/v1/agent/pair', { code: pair.body.code })).status, 404, 'a code works once');

  // --- the agent API
  assert.equal((await api('/v1/agent/me', token)).body.paired_as, 'test agent');
  const seen = await api('/v1/agent/perceive', token);
  assert.equal(seen.status, 200);
  assert.ok(seen.body.nearby.length > 0 && seen.body.could_do_now.length > 0 && seen.body.soul.intent.note === 'secret plan');
  const waitP = api('/v1/agent/wait?seconds=20', token);
  const steer = await api('/v1/agent/intent', token, { intent: { goal: 'rest' } });
  assert.equal(steer.status, 200); assert.ok(steer.body.accepted_at_tick > 0);
  const waited = await waitP;
  assert.notEqual(waited.body.reason, 'timeout');
  assert.equal((await api('/v1/agent/intent', token, { intent: { goal: 'fly' } })).status, 400);
  assert.equal((await api('/v1/agent/intent', token, { intent: { goal: 'go', target: 'atlantis' } })).status, 400);

  // --- MCP with the same token: header form and URL form
  const mcp = async (method: string, params: unknown, url = `${BASE}/mcp`, auth = true) => (await fetch(url, { method: 'POST', headers: { ...(auth ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json() as Promise<any>;
  assert.equal((await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } })).result.serverInfo.name, 'sim');
  assert.deepEqual((await mcp('tools/list', {})).result.tools.map((t: any) => t.name).sort(), ['soul_command', 'soul_deck', 'soul_log', 'soul_perceive', 'soul_propose_cards', 'soul_set_intent', 'soul_status', 'soul_wait', 'world_query']);
  const call = await mcp('tools/call', { name: 'soul_set_intent', arguments: { goal: 'attend', target: 'campfire' } }, `${BASE}/mcp/${token}`, false);
  assert.equal(JSON.parse(call.result.content[0].text).ok, true);
  assert.equal((await fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);

  // --- the owner's dashboard
  const dash = await api(`/v1/souls/${id}`, user);
  assert.equal(dash.body.agent.attached, true); assert.equal(dash.body.agent.label, 'test agent'); assert.ok(dash.body.agent.last_used > 0);
  await sleep(2500);
  const tl = await api(`/v1/souls/${id}/timeline`, user);
  assert.ok(tl.body.events.some((e: any) => e.kind === 'birth'));
  assert.ok(tl.body.events.some((e: any) => e.kind === 'intent' && e.text.includes('secret plan')), 'the owner sees their own note');
  assert.ok(tl.body.events.some((e: any) => e.kind === 'intent' && e.text.includes('your agent')));
  assert.ok(tl.body.events.some((e: any) => e.kind === 'decision' && e.why));

  // --- privacy: nobody else sees the note or the model calls about this Soul
  const log = await (await fetch(`${BASE}/v1/log?limit=1000`)).json() as any;
  assert.ok(log.events.some((e: any) => e.kind === 'intent' && e.payload.soulId === id && e.payload.source === 'mcp'));
  assert.ok(!JSON.stringify(log).includes('secret plan'), 'notes are not in the public log');
  assert.ok(!JSON.stringify(await (await fetch(`${BASE}/v1/world`)).json()).includes('secret plan'));
  const mine = await api('/v1/brain?limit=200', user), bobs = await api('/v1/brain?limit=200', 'dev:bob'), all = await api('/v1/brain?limit=200', 'dev:admin');
  assert.ok(mine.body.calls.length > 0 && mine.body.calls.every((c: any) => c.soulId === id));
  assert.equal(bobs.body.calls.length, 0);
  assert.ok(all.body.calls.length > mine.body.calls.length);
  assert.equal((await api('/v1/spend', user)).status, 403);
  const spy = client('dev:bob'); const got: any[] = []; spy.handlers.onBrain = (c) => got.push(...c);
  await sleep(4000);
  assert.equal(got.length, 0, 'another user receives no model calls over the socket');
  spy.close();

  // --- pairing, agent-initiated: the agent asks, the owner approves, the agent polls
  const start = await post('/v1/agent/pair/start', { agent: 'second agent' });
  assert.ok(start.body.approve_url.includes('#pair/'));
  assert.equal((await (await fetch(`${BASE}/v1/agent/pair/poll?poll_token=${start.body.poll_token}`)).json() as any).status, 'pending');
  assert.equal((await api(`/v1/pair/${start.body.user_code}`, user)).body.agent, 'second agent');
  assert.equal((await api('/v1/pair/approve', 'dev:bob', { code: start.body.user_code, soulId: id })).status, 403, 'only the owner can approve for a Soul');
  assert.equal((await api('/v1/pair/approve', user, { code: start.body.user_code, soulId: id })).status, 200);
  const polled = await (await fetch(`${BASE}/v1/agent/pair/poll?poll_token=${start.body.poll_token}`)).json() as any;
  assert.equal(polled.status, 'approved');
  assert.equal((await api('/v1/agent/status', token)).status, 401, 'the old token was replaced');
  assert.equal((await api('/v1/agent/status', polled.token)).body.name, 'Testa');

  // --- revoke and retire
  await api(`/v1/souls/${id}/revoke`, user, {});
  assert.equal((await api('/v1/agent/status', polled.token)).status, 401);
  assert.equal((await api(`/v1/souls/${id}`, user, undefined, 'DELETE')).status, 200);
  await sleep(1000);
  assert.ok(!((await (await fetch(`${BASE}/v1/world`)).json()) as any).souls.some((s: any) => s.name === 'Testa'));
});

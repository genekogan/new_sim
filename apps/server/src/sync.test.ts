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
    env: { PATH: process.env.PATH, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: mkdtempSync(join(tmpdir(), 'sim-sync-')), BRAIN_MODE: 'fake', DEV_AUTH: '1', PUBLIC_URL: BASE, WEB_DIR: '/nonexistent' },
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

test('signed-in user creates a soul, commands it, and an agent steers it with a claimed token', async () => {
  const user = 'dev:alice';
  const made = await api('/v1/souls', user, { name: 'Testa', description: 'a test soul who likes benches' });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const id = made.body.soul.id;
  const dup = await api('/v1/souls', 'dev:bob', { name: 'testa', description: 'imposter' });
  assert.equal(dup.status, 409);
  assert.equal((await api(`/v1/souls/${id}`, 'dev:bob')).status, 403);
  const me = await api('/v1/me', user);
  assert.deepEqual(me.body.me.souls, [id]);
  // direct structured intent from the web
  const set = await api(`/v1/souls/${id}/intent`, user, { intent: { goal: 'go', target: 'the kiosk' } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.intent.target, 'kiosk');
  // claim flow → agent token
  const claim = await api(`/v1/souls/${id}/claim`, user, {});
  const page = await (await fetch(claim.body.url)).text();
  const token = page.match(/TOKEN: (sim_\S+)/)![1];
  assert.equal((await fetch(claim.body.url)).status, 404, 'claim link is one-time');
  const status = await api('/v1/agent/status', token);
  assert.equal(status.body.name, 'Testa');
  const steer = await api('/v1/agent/intent', token, { intent: { goal: 'rest' } });
  assert.equal(steer.status, 200);
  assert.ok(steer.body.accepted_at_tick > 0);
  assert.equal((await api('/v1/agent/intent', token, { intent: { goal: 'fly' } })).status, 400);
  assert.equal((await api('/v1/agent/intent', token, { intent: { goal: 'go', target: 'atlantis' } })).status, 400);
  // MCP with the same token
  const mcp = async (method: string, params: unknown) => (await fetch(`${BASE}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json() as Promise<any>;
  const init = await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  assert.equal(init.result.serverInfo.name, 'sim');
  const tools = await mcp('tools/list', {});
  assert.deepEqual(tools.result.tools.map((t: any) => t.name).sort(), ['soul_log', 'soul_set_intent', 'soul_status', 'world_query']);
  const call = await mcp('tools/call', { name: 'soul_set_intent', arguments: { goal: 'attend', target: 'campfire' } });
  assert.equal(JSON.parse(call.result.content[0].text).ok, true);
  assert.equal((await fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
  // revoke
  await api(`/v1/souls/${id}/revoke`, user, {});
  assert.equal((await api('/v1/agent/status', token)).status, 401);
  // the intent shows up in the public log, and the soul acts on it
  await sleep(3000);
  const log = await (await fetch(`${BASE}/v1/log?limit=1000`)).json() as any;
  assert.ok(log.events.some((e: any) => e.kind === 'intent' && e.payload.soulId === id && e.payload.source === 'mcp'));
  assert.ok(log.events.some((e: any) => e.kind === 'decision' && e.payload.soulId === id));
  // retire
  assert.equal((await api(`/v1/souls/${id}`, user, undefined, 'DELETE')).status, 200);
  await sleep(1000);
  const world = await (await fetch(`${BASE}/v1/world`)).json() as any;
  assert.ok(!world.souls.some((s: any) => s.name === 'Testa'));
});

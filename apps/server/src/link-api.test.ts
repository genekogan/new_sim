// LINK tranche, API lane (team/TRANCHE-LINK-20261024.md, COMMON-LINK §2): approving a new Soul places its body inside the
// approve request (`ready`, never an owner-visible `creating`); the owner `link` state; the agent's public `now` line.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { AccountIdentity } from './accounts/store.ts';
import { fixture as worldFixture } from '../test/native-owner-fixture.ts';
import { buildApp } from './http.ts';
import type { Hub } from './hub.ts';
import { marsFactory, GREEN_FIELD_WORLD } from '@sim/engine-mars';

const input = (key: string, extra: Record<string, unknown> = {}) => ({ agentLabel: 'eden-agent 1.9.17', name: 'Qwyjibo', idempotencyKey: 'link-request-key-' + key, pollSecret: randomBytes(32).toString('base64url'), ...extra });

export async function linkWorld(t: TestContext) {
  const f = worldFixture(':memory:', await marsFactory({ ...GREEN_FIELD_WORLD, safeCrewRemoval: true })); f.brain.quiesce(); f.souls.enableLifecycle(); t.after(() => { f.host.stop(); f.db.close(); });
  f.souls.cfg.accountAuthRequired = true; f.souls.cfg.inviteRequired = false;
  const ids = new Map<string, AccountIdentity>();
  for (const name of ['gene', 'other']) { const id = 'did:privy:' + name; f.db.upsertUser({ id, email: null, wallet: null, role: 'user' }); ids.set(name, { id, issuer: 'privy.io/test-app', subject: id, verifiedAt: Date.now(), expiresAt: Date.now() + 600_000 }); }
  f.auth.accountFromToken = async token => { const identity = ids.get(token ?? ''); return identity ? { identity, user: f.db.user(identity.id)! } : null; };
  const original = f.auth.userFromToken.bind(f.auth); f.auth.userFromToken = async token => ids.has(token ?? '') ? f.db.user(ids.get(token!)!.id)! : original(token);
  const app = buildApp({ cfg: f.souls.cfg, db: f.db, host: f.host, souls: f.souls, brain: f.brain, auth: f.auth, hub: { clients: new Map(), refreshMe() {} } as unknown as Hub });
  const call = async (path: string, body?: unknown, token?: string, method?: string) => { const r = await app.request(path, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: { host: '127.0.0.1:4956', ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: r.status, data: await r.json().catch(() => null) as any }; };
  /** create + approve a Soul for gene; returns its id, the agent poll secret and approval id */
  const born = async (key: string, name = 'Qwyjibo') => {
    const code = (await call('/v1/account/window-code', {}, 'gene')).data.code;
    const req = input(key, { name, for: code });
    const start = await call('/v1/agent/approval/start', req);
    const approvalId = start.data.approval.id as string;
    const approved = await call(`/v1/account/approvals/${approvalId}/approve`, {}, 'gene');
    return { approvalId, req, approved };
  };
  const token = async (approvalId: string, pollSecret: string) => (await call('/v1/agent/approval/poll', { approvalId, pollSecret })).data.token as string;
  return { f, app, call, born, token, ids };
}

test('approve places the body standing at the arrival point inside the request and answers ready', async t => {
  const w = await linkWorld(t);
  const { approved, req } = await w.born('birth-0001');
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  assert.equal(approved.data.approval.status, 'ready', 'the owner never sees creating');
  const soulId = approved.data.approval.soulId as string;
  assert.match(soulId, /^s_/);
  const mind = w.f.host.minds.get(soulId);
  assert.ok(mind, 'the Soul has a mind in the world in the same response');
  assert.ok(w.f.host.engine.world.entities[mind!.entityId], 'and a body');
  assert.equal(w.f.souls.controlReady(w.f.db.soul(soulId)!), true);
  assert.match(await w.token(approved.data.approval.id, req.pollSecret), /^sim_s_/, 'the first poll hands over the token');
});

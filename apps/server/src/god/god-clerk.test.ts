// God mode under Clerk (production sign-in): owner claim, god-token mint and
// pairing approval run through the verified Clerk account; every dev token is
// refused. Synthetic issuer + JWKS (test/clerk-fixture.ts); no network, no keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono, type Context } from 'hono';
import { Auth } from '../auth.ts';
import { config } from '../config.ts';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode } from './god.ts';
import { mountGodRoutes } from './routes.ts';
import { clerkKeys, clerkSettings, stubJwks } from '../../test/clerk-fixture.ts';

async function clerkWorld(t: { after: (fn: () => void) => void }, registryPath: string, worldId = 'hello-1') {
  const db = new Db(':memory:');
  const auth = new Auth({ ...config, ...clerkSettings(registryPath), worldId, worldEngine: true /* a new world: main's legacy dev projection stays on old worlds only */ }, db);
  await auth.init();
  const god = new GodMode(db, { worldId, ownerId: null, tick: () => 1, emit: () => {} });
  const app = new Hono();
  mountGodRoutes(app, {
    god, worldName: 'Hello',
    requireUser: async (c: Context) => { const u = await auth.userFromToken(c.req.header('authorization')?.replace(/^Bearer\s+/i, '')); if (!u) throw new ApiError(401, 'unauthorized', 'sign in first'); return u; },
    soulFromBearer: () => null, baseOf: () => 'https://sim.example.test/w/hello', limitIp: () => {},
  });
  app.onError((err, c) => err instanceof ApiError ? c.json({ ok: false, code: err.code, message: err.message }, err.status as 400) : c.json({ ok: false, code: 'internal', message: String(err) }, 500));
  const req = async (path: string, init: { body?: unknown; token?: string } = {}) => {
    const r = await app.request(path, { method: init.body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) }, body: init.body ? JSON.stringify(init.body) : undefined });
    const text = await r.text(); let data: any; try { data = JSON.parse(text); } catch { data = text; } // eslint-disable-line @typescript-eslint/no-explicit-any
    return { status: r.status, data };
  };
  t.after(() => { auth.close(); db.close(); });
  return { db, auth, god, req };
}

test('production (Clerk) refuses every dev token: claim, mint, pairing approval, status', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'god-clerk-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { jwk } = await clerkKeys(); t.after(stubJwks(jwk));
  const w = await clerkWorld(t, join(dir, 'accounts.sqlite'));
  // even a legacy agent-local identity that already has a row, and even if a caller flips devAuth on
  const legacy = 'dev:agent-' + 'a'.repeat(24);
  w.db.upsertUser({ id: legacy, email: null, wallet: null, role: 'admin' });
  w.auth.legacyOwnerAllowed = () => true; w.auth.devAuth = true;
  const start = await w.req('/v1/god/pair/start', { body: { agent: 'intruder' } });
  for (const token of ['dev:admin', 'dev:gene', legacy]) {
    assert.equal((await w.req('/v1/god/claim', { body: {}, token })).status, 401, token);
    assert.equal((await w.req('/v1/god/mint', { body: { label: 'x' }, token })).status, 401, token);
    assert.equal((await w.req('/v1/god/pair/approve', { body: { code: start.data.user_code }, token })).status, 401, token);
    assert.equal((await w.req('/v1/god/status', { token })).data.you, 'anonymous', token);
    assert.equal(await w.auth.userFromToken(token), null, token);
  }
  assert.equal(w.god.owner, null);
  assert.equal(w.god.store.tokens().length, 0);
  // and a Clerk world never boots with DEV_AUTH=1 in its environment
  const before = process.env.DEV_AUTH; process.env.DEV_AUTH = '1';
  try { assert.throws(() => new Auth({ ...config, ...clerkSettings(join(dir, 'b.sqlite')), worldEngine: true }, w.db), /DEV_AUTH=1 with AUTH_PROVIDER=clerk/); }
  finally { if (before === undefined) delete process.env.DEV_AUTH; else process.env.DEV_AUTH = before; }
});

test('Clerk: the signed-in creator claims, mints a god token and approves pairing; another account cannot', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'god-clerk-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { jwk, sign } = await clerkKeys(); t.after(stubJwks(jwk));
  const w = await clerkWorld(t, join(dir, 'accounts.sqlite'));
  const alice = await sign('user_alice'), bob = await sign('user_bob');
  // forged, foreign-issuer, wrong-origin and expired tokens are nobody
  const forged = alice.split('.'); forged[2] = (forged[2][0] === 'a' ? 'b' : 'a') + forged[2].slice(1);
  for (const token of [forged.join('.'), await sign('user_alice', {}, 'https://other.example.test'), await sign('user_alice', { azp: 'https://evil.example.test' }), await sign('user_alice', { exp: 1 })])
    assert.equal((await w.req('/v1/god/claim', { body: {}, token })).status, 401);

  assert.equal((await w.req('/v1/god/status', { token: alice })).data.you, 'claimant');
  const claim = await w.req('/v1/god/claim', { body: {}, token: alice });
  assert.equal(claim.status, 200);
  assert.match(w.god.owner ?? '', /^acct_/);
  assert.equal(claim.data.owner, w.god.owner);
  assert.equal((await w.req('/v1/god/claim', { body: {}, token: alice })).status, 200, 'idempotent for the owner');
  assert.equal((await w.req('/v1/god/status', { token: alice })).data.you, 'owner');
  const mint = await w.req('/v1/god/mint', { body: { label: 'browser' }, token: alice });
  assert.equal(mint.status, 200); assert.ok(String(mint.data.token).startsWith('god_hello-1_'));
  assert.equal((await w.req('/v1/god/status', { token: mint.data.token })).data.you, 'god');

  assert.equal((await w.req('/v1/god/status', { token: bob })).data.you, 'visitor');
  assert.equal((await w.req('/v1/god/claim', { body: {}, token: bob })).status, 403);
  assert.equal((await w.req('/v1/god/mint', { body: {}, token: bob })).status, 403);
  assert.equal((await w.req('/v1/god/welcome', { token: bob })).status, 403);

  const start = await w.req('/v1/god/pair/start', { body: { agent: 'claude code' } });
  assert.equal((await w.req('/v1/god/pair/approve', { body: { code: start.data.user_code }, token: bob })).status, 403);
  assert.equal((await w.req('/v1/god/pair/approve', { body: { code: start.data.user_code }, token: alice })).status, 200);
  const poll = await w.req('/v1/god/pair/poll', { body: { poll_token: start.data.poll_token } });
  assert.equal(poll.data.status, 'approved'); assert.ok(String(poll.data.token).startsWith('god_hello-1_'));
});

test('Clerk: one account is the same owner in every world that shares the registry (launcher children)', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'god-clerk-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { jwk, sign } = await clerkKeys(); t.after(stubJwks(jwk));
  const registry = join(dir, 'accounts.sqlite');
  const a = await clerkWorld(t, registry, 'alpha-1'), b = await clerkWorld(t, registry, 'beta-1');
  const alice = await sign('user_alice');
  assert.equal((await a.req('/v1/god/claim', { body: {}, token: alice })).status, 200);
  assert.equal((await b.req('/v1/god/claim', { body: {}, token: alice })).status, 200);
  assert.equal(a.god.owner, b.god.owner);
  assert.equal((await b.req('/v1/god/claim', { body: {}, token: await sign('user_bob') })).status, 403);
});

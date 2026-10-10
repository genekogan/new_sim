// node --test tools/world-launcher/launcher-auth.test.mjs
// The launcher in Clerk mode with real Sim world processes (fake minds, $0) on lane P1's ports: proxy :5219,
// children 5210–5218. A synthetic Clerk issuer: the children get it from a test env file by path, plus a
// test-only preload that serves its JWKS (no network, no provider keys).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLauncher } from './launcher.mjs';
import { clerkKeys, ISSUER, PUBLISHABLE_KEY } from '../../apps/server/test/clerk-fixture.ts';

const PORT = 5219, RANGE = [5210, 5218], ORIGIN = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), 'launcher-auth-test-'));
const templatesDir = join(dir, 'templates'); mkdirSync(templatesDir);
const preload = new URL('../../apps/server/test/clerk-jwks-preload.mjs', import.meta.url).pathname;
let L, sign;
const api = (p, o = {}) => fetch(`${ORIGIN}${p}`, o);
const bearer = (t) => (t ? { authorization: `Bearer ${t}` } : {});
const create = (name, token) => api('/__sim/worlds', { method: 'POST', headers: { 'content-type': 'application/json', ...bearer(token) }, body: JSON.stringify({ name, template: 'empty' }) });
const getJson = async (p, token) => (await api(p, { headers: bearer(token) })).json();

before(async () => {
  const keys = await clerkKeys(ORIGIN); sign = keys.sign;
  writeFileSync(join(dir, 'jwks.json'), JSON.stringify({ keys: [keys.jwk] }));
  const envFile = join(dir, 'clerk.env');
  writeFileSync(envFile, [`CLERK_PUBLISHABLE_KEY=${PUBLISHABLE_KEY}`, `CLERK_ISSUER_URL=${ISSUER}`, `CLERK_AUTHORIZED_PARTIES=${ORIGIN}`,
    `SIM_TEST_JWKS_FILE=${join(dir, 'jwks.json')}`, `NODE_OPTIONS=--import=${preload}`, 'DEV_AUTH=1', 'WORLD_PATH=/w/eden', ''].join('\n'));
  L = await openLauncher({ port: PORT, range: RANGE, dataDir: join(dir, 'data'), templatesDir, authEnvFile: envFile, publicOrigin: ORIGIN, eager: 0, log: () => {} });
});
after(async () => { await L?.close(); rmSync(dir, { recursive: true, force: true }); });

test('Clerk launcher: homepage gets only the public Clerk settings; creating needs a sign-in', async () => {
  const list = await getJson('/__sim/worlds.json');
  assert.deepEqual(list.auth, { provider: 'clerk', clerkPublishableKey: PUBLISHABLE_KEY, clerkIssuer: ISSUER, authenticationOrigin: ORIGIN });
  assert.equal(JSON.stringify(list).includes('jwks'), false);
  assert.equal((await create('Nobody World')).status, 401);
  assert.equal((await getJson('/__sim/worlds.json')).worlds.length, 0);
});

test('Clerk launcher: a dev token cannot make a world (refused by the new world, which is then removed)', async () => {
  const r = await create('Dev World', 'dev:gene');
  assert.equal(r.status, 401); assert.match((await r.json()).message, /could not make you its god/);
  assert.equal((await getJson('/__sim/worlds.json')).worlds.length, 0);
  assert.deepEqual(readdirSync(join(dir, 'data', 'worlds')).filter((d) => d.startsWith('dev-world')), []);
});

test('Clerk launcher: the signed-in creator is the god at birth; others are visitors; dev tokens are nobody', { timeout: 240_000 }, async () => {
  const alice = await sign('user_alice'), bob = await sign('user_bob');
  const r = await create('Alice Hollow', alice);
  assert.equal(r.status, 201); const made = await r.json();
  assert.equal(made.claimed, true); assert.equal(made.url, `/w/${made.slug}/?new=1`);
  const base = `/w/${made.slug}`;
  const cfg = await getJson(`${base}/v1/config`);
  assert.equal(cfg.authProvider, 'clerk'); assert.equal(cfg.devAuth, false); assert.equal(cfg.authenticationOrigin, ORIGIN, 'children use the public origin, not their own port');
  assert.equal(cfg.worldKey, made.slug, 'WORLD_PATH from the env file does not leak into a child');
  assert.equal((await getJson(`${base}/v1/god/status`, alice)).you, 'owner', 'the Authorization header passes through the proxy');
  assert.equal((await getJson(`${base}/v1/god/status`, bob)).you, 'visitor');
  for (const t of ['dev:gene', 'dev:admin', 'dev:agent-' + 'a'.repeat(24)]) {
    assert.equal((await getJson(`${base}/v1/god/status`, t)).you, 'anonymous', t);
    assert.equal((await api(`${base}/v1/god/mint`, { method: 'POST', headers: { 'content-type': 'application/json', ...bearer(t) }, body: '{}' })).status, 401, t);
  }
  const mint = await (await api(`${base}/v1/god/mint`, { method: 'POST', headers: { 'content-type': 'application/json', ...bearer(alice) }, body: '{"label":"browser"}' })).json();
  assert.ok(mint.token.startsWith(`god_${made.slug}-1_`));
  assert.equal((await api(`${base}/v1/god/mint`, { method: 'POST', headers: { 'content-type': 'application/json', ...bearer(bob) }, body: '{}' })).status, 403);
  // as live: a Soul is made only through its agent's account approval (lane P2's join.mjs proves that path), never directly
  const session = await getJson(`${base}/v1/account/session`, alice);
  assert.match(session.accountId, /^acct_/);
  const soul = await (await api(`${base}/v1/souls`, { method: 'POST', headers: { 'content-type': 'application/json', ...bearer(bob) }, body: JSON.stringify({ name: 'Bea', description: 'a visitor' }) })).json();
  assert.equal(soul.code, 'approval-required', JSON.stringify(soul));
  assert.equal((await getJson(`/w/${made.slug}/v1/config`)).accountApproval?.contract, 'account-soul-approval/1');

  // with a world awake, a bad creator token is refused before anything boots
  const t0 = Date.now(); assert.equal((await create('Dev Again', 'dev:gene')).status, 401); assert.ok(Date.now() - t0 < 5000);
  // one account everywhere: the shared registry gives alice the same id in her second world
  const r2 = await create('Alice Two', await sign('user_alice'));
  assert.equal(r2.status, 201); const two = await r2.json();
  assert.equal((await getJson(`/w/${two.slug}/v1/account/session`, await sign('user_alice'))).accountId, session.accountId);
  assert.equal((await getJson(`/w/${two.slug}/v1/god/status`, await sign('user_alice'))).you, 'owner');
  const list = await getJson('/__sim/worlds.json');
  assert.deepEqual(list.worlds.map((w) => w.url).sort(), [`/w/${made.slug}/`, `/w/${two.slug}/`].sort());
});

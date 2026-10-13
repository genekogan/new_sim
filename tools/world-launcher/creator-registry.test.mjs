import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openLauncher } from './launcher.mjs';
import { verifiedCreator } from './creator-auth.mjs';
import { clerkKeys, ISSUER, PUBLISHABLE_KEY } from '../../apps/server/test/clerk-fixture.ts';
import { WorldModel } from '../../packages/world-compiler/src/index.ts';
import { Registry, makeItem, writeCore, loadContract } from '../../packages/catalog/src/index.ts';

test('first signed-in creator owns restricted registry genesis before claim; invalid creators allocate nothing', { timeout: 240000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'creator-registry-')), origin = 'http://127.0.0.1:6179';
  const dataDir = join(dir, 'data'), templatesDir = join(dir, 'templates'); mkdirSync(dataDir); mkdirSync(templatesDir);
  const keys = await clerkKeys(origin), forged = await clerkKeys(origin);
  writeFileSync(join(dir, 'jwks.json'), JSON.stringify({ keys: [keys.jwk] }));
  const preload = new URL('../../apps/server/test/clerk-jwks-preload.mjs', import.meta.url).pathname, envFile = join(dir, 'auth.env');
  writeFileSync(envFile, [`CLERK_PUBLISHABLE_KEY=${PUBLISHABLE_KEY}`, `CLERK_ISSUER_URL=${ISSUER}`, `CLERK_AUTHORIZED_PARTIES=${origin}`,
    `SIM_TEST_JWKS_FILE=${join(dir, 'jwks.json')}`, `NODE_OPTIONS=--import=${preload}`, 'DEV_AUTH=1'].join('\n'));
  const auth = { envFile, registryPath: join(dataDir, 'accounts.sqlite') }, token = await keys.sign('user_gene');
  const accountId = await verifiedCreator(`Bearer ${token}`, auth, origin, resolve('.'));
  assert.match(accountId, /^acct_/);
  const w = new WorldModel({ constants: { ground: 'land', extent: 100 }, seed: 'restricted-fixture' });
  const def = w.defineDef({ schema: 'def/1', name: 'core-private-fixture', version: 1, form: 'point', make: { kind: 'none' },
    size: { box: [1, 1, 1] }, anchor: 'base', layer: 'decor' }, 'core', 0);
  const row = await makeItem(def, { at: new Date().toISOString(), run: 'fixture', author: 'test', contract: loadContract() });
  row.item.licence = { spdx: 'third-party-restricted', redistribute: false, source: 'synthetic fixture' };
  const registry = new Registry(join(dir, 'catalog')); writeCore(registry, [{ def, ...row }], 'fixture');
  writeFileSync(join(templatesDir, 'private.json'), JSON.stringify({ schema: 'genesis/1', name: 'Private fixture', batches: [{ ops: [{ op: 'place', def: 'eden/private-fixture@1', name: 'private-object', p: [0, 0, 0] }] }] }));
  const envNames = ['CATALOG_REGISTRY_DIR', 'CATALOG_GENE_OWNER_ID', 'CATALOG_CHANNEL'], saved = envNames.map((name) => process.env[name]);
  process.env.CATALOG_REGISTRY_DIR = registry.root; process.env.CATALOG_GENE_OWNER_ID = accountId; process.env.CATALOG_CHANNEL = 'stable';
  let launcher;
  const create = (name, value, extra = {}) => fetch(origin + '/__sim/worlds', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${value}` }, body: JSON.stringify({ name, template: 'private', ...extra }) });
  try {
    launcher = await openLauncher({ port: 6179, range: [6170, 6178], dataDir, templatesDir, authEnvFile: envFile, publicOrigin: origin, eager: 0, log: () => {} });
    for (const bad of ['dev:gene', await keys.sign('user_gene', { exp: Math.floor(Date.now() / 1000) - 10 }), await forged.sign('user_gene'), 'forged.jwt.value']) {
      assert.equal((await create('Invalid Creator', bad, { owner: accountId, bornOwner: accountId })).status, 401);
      assert.equal(launcher.registry.worlds.length, 0);
      assert.deepEqual(existsSync(join(dataDir, 'worlds')) ? readdirSync(join(dataDir, 'worlds')) : [], []);
    }
    const foreign = await create('Foreign Creator', await keys.sign('user_foreign'), { owner: accountId, bornOwner: accountId });
    assert.equal(foreign.status, 500, 'foreign owner cannot bootstrap restricted template');
    assert.equal(launcher.registry.worlds.length, 0); assert.deepEqual(readdirSync(join(dataDir, 'worlds')), []);
    const response = await create('Gene Private', await keys.sign('user_gene'));
    const made = await response.json(); assert.equal(response.status, 201, JSON.stringify(made)); assert.equal(made.claimed, true);
    const get = async (path) => (await fetch(origin + `/w/${made.slug}` + path, { headers: { authorization: `Bearer ${await keys.sign('user_gene')}` } })).json();
    assert.equal((await get('/v1/account/session')).accountId, accountId);
    assert.equal((await get('/v1/god/status')).you, 'owner');
    const snapshot = await get('/v1/world/snapshot'); assert.ok(snapshot.entities.some((e) => e.name === 'private-object'));
    const mint = await (await fetch(origin + `/w/${made.slug}/v1/god/mint`, { method: 'POST',
      headers: { authorization: `Bearer ${await keys.sign('user_gene')}`, 'content-type': 'application/json' }, body: '{}' })).json();
    const godSnapshot = await (await fetch(origin + `/w/${made.slug}/v1/god/snapshot`, { headers: { authorization: `Bearer ${mint.token}` } })).json();
    assert.equal(godSnapshot.owner, accountId);
  } finally {
    await launcher?.close(); envNames.forEach((name, i) => saved[i] === undefined ? delete process.env[name] : process.env[name] = saved[i]);
    rmSync(dir, { recursive: true, force: true });
  }
});

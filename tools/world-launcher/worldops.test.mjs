// node --test tools/world-launcher/worldops.test.mjs — world housekeeping (lane WORLDOPS ports: proxy 6060, children 6061–6069).
// Stand-in worlds (fake-world.mjs) write their owner into sim.db the way GodMode does on first boot (WORLD_OWNER_ID).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLauncher } from './launcher.mjs';
import { defaultCommand } from './children.mjs';

const PORT = 6060, RANGE = [6061, 6069];
const dir = mkdtempSync(join(tmpdir(), 'launcher-worldops-test-'));
const templatesDir = join(dir, 'templates'); mkdirSync(templatesDir);
writeFileSync(join(templatesDir, 'plain.json'), JSON.stringify({ schema: 'genesis/1', name: 'Plain', description: 'x', batches: [] }));
const webDir = join(dir, 'web'); mkdirSync(webDir); writeFileSync(join(webDir, 'index.html'), '<!doctype html>');
const born = join(dir, 'born.mjs');
writeFileSync(born, `import { DatabaseSync } from 'node:sqlite'; import { join } from 'node:path';
const db = new DatabaseSync(join(process.env.DATA_DIR, 'sim.db')); db.exec('CREATE TABLE IF NOT EXISTS world_meta_v1 (world_id TEXT PRIMARY KEY, body TEXT)');
db.exec('CREATE TABLE IF NOT EXISTS god_tokens_v1 (world_id TEXT NOT NULL, token_hash TEXT NOT NULL, label TEXT, created_at INTEGER NOT NULL, last_used INTEGER, PRIMARY KEY (world_id, token_hash))');
if (!db.prepare('SELECT 1 FROM world_meta_v1 WHERE world_id=?').get(process.env.WORLD_KEY + '-1')) db.prepare('INSERT INTO world_meta_v1 VALUES (?, ?)').run(process.env.WORLD_KEY + '-1', JSON.stringify({ owner: process.env.WORLD_OWNER_ID || null }));
db.close(); await import(${JSON.stringify(new URL('./fake-world.mjs', import.meta.url).pathname)});`);
const command = (w, port) => { const c = defaultCommand(w, port, { publicOrigin: `http://127.0.0.1:${PORT}` }); return { cmd: process.execPath, args: [born], env: { ...c.env, DATA_DIR: w.dataDir } }; };
let L;
before(async () => { L = await openLauncher({ port: PORT, range: RANGE, dataDir: join(dir, 'data'), webDir, templatesDir, command, eager: 0, log: () => {} }); });
after(async () => { await L?.close(); });
const api = (p, o = {}) => fetch(`http://127.0.0.1:${PORT}${p}`, o);
const post = (p, body, headers = {}) => api(p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const list = async () => (await (await api('/__sim/worlds.json')).json()).worlds;

test('same-name worlds are told apart by slug; a unique name carries no tag', async () => {
  for (const name of ['Mars', 'mars', 'Garden']) assert.equal((await post('/__sim/worlds', { name, template: 'plain' })).status, 201);
  const w = await list();
  const tags = Object.fromEntries(w.map((x) => [x.slug, x.nameTag]));
  assert.deepEqual(tags, { 'my-mars': 'my-mars', 'my-mars-2': 'my-mars-2', garden: null });
  assert.ok(w.every((x) => x.claimable === true), 'claimable by default');
});
test('site admin marks a godless world not claimable: claim, mint and pair-approve are refused; the card stops inviting claims', async () => {
  let r = await post('/__sim/op/set-claimable', { slug: 'garden', claimable: false }, { 'x-forwarded-for': '1.2.3.4' });
  assert.equal(r.status, 403, 'not through the reverse proxy');
  r = await post('/__sim/op/set-claimable', { slug: 'garden', claimable: 'no' }); assert.equal(r.status, 400);
  r = await post('/__sim/op/set-claimable', { slug: 'nope', claimable: false }); assert.equal(r.status, 404);
  r = await post('/__sim/op/set-claimable', { slug: 'garden', claimable: false }); assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, slug: 'garden', claimable: false, hasGod: false });
  for (const p of ['/v1/god/claim', '/v1/god/mint', '/v1/god/pair/approve']) {
    r = await post(`/w/garden${p}`, {}, { authorization: 'Bearer dev:someone' });
    assert.equal(r.status, 403, p); assert.equal((await r.json()).code, 'not-claimable');
  }
  assert.equal((await api('/w/garden/v1/god/status')).status, 200, 'visitors still see the world');
  const card = (await list()).find((x) => x.slug === 'garden'); assert.equal(card.claimable, false);
  assert.equal((await (await api('/__sim/worlds/garden')).json()).world.claimable, false, 'the world page learns it too');
  // other worlds are untouched, and the flag can be lifted
  assert.equal((await post('/w/my-mars/v1/god/claim', {}, { authorization: 'Bearer dev:someone' })).status, 200);
  assert.equal((await post('/__sim/op/set-claimable', { slug: 'garden', claimable: true })).status, 200);
  assert.equal((await post('/w/garden/v1/god/claim', {}, { authorization: 'Bearer dev:someone' })).status, 200);
});
test('a world that already has a god keeps minting tokens for its owner even when marked not claimable', async () => {
  let r = await post('/__sim/op/create-world', { name: 'Owned', template: 'plain', owner: 'dev:gene' }); assert.equal(r.status, 201);
  assert.equal((await post('/__sim/op/set-claimable', { slug: 'owned', claimable: false })).status, 200);
  r = await post('/w/owned/v1/god/mint', {}, { authorization: 'Bearer dev:gene' }); assert.equal(r.status, 200);
});

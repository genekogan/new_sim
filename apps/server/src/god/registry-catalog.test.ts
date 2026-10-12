import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { coreLibrary, hashOf } from '@sim/world-compiler';
import { Registry, RegistryCatalog, makeItem, writeCore, loadContract, lineOf } from '@sim/catalog';
import { Db } from '../db.ts';
import { GodMode } from './god.ts';
import { mountGodRoutes } from './routes.ts';

const dir = mkdtempSync(join(tmpdir(), 'god-registry-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));
const registry = new Registry(join(dir, 'registry'));
const items = await Promise.all(['core-bench@1', 'core-chair@1', 'core-sofa@1', 'core-stool@1', 'core-box@1'].map(async (ref) => {
  const def = coreLibrary().get(ref)!, { item, up } = await makeItem(def, { at: '2026-10-12T12:00:00.000Z', run: 'test', author: 'test', contract: loadContract() });
  return { def, item, up };
}));
writeCore(registry, items, 'test');

function fixture() {
  const db = new Db(':memory:'), catalog = new RegistryCatalog(registry, { hot: 0 });
  const god = new GodMode(db, { worldId: 'registry-world', ownerId: 'owner', tick: () => 0, emit: () => {}, library: catalog, assetDir: join(dir, 'assets') });
  const app = new Hono();
  mountGodRoutes(app, { god, worldName: 'Registry world', requireUser: async () => ({ id: 'owner', role: 'user' }) as never,
    soulFromBearer: () => null, baseOf: () => 'http://localhost:6101/w/registry-world', limitIp: () => {} });
  const token = god.mintFor({ id: 'owner', role: 'user' }, 'test');
  const get = (path: string) => app.request(path, { headers: { authorization: `Bearer ${token}` } });
  return { db, god, catalog, app, token, get };
}

test('registry pages, taxonomy, T0 and compact find preserve cold defs; first use stores the exact def hash', async () => {
  const { db, god, catalog, get } = fixture();
  try {
    const before = catalog.stats(), cold = catalog.list().find((h) => !catalog.all().some((d) => d.hash === h.entry.def1Hash))!;
    assert.ok(cold);
    for (const url of ['/v1/god/catalog?format=json', '/v1/god/catalog/taxonomy', '/v1/god/catalog/t0', `/v1/god/defs?q=${encodeURIComponent(cold.item.text.title)}&compact=1`]) {
      const response = await get(url); assert.equal(response.status, 200, await response.clone().text());
    }
    assert.deepEqual(catalog.stats(), before); assert.equal(god.model.defs.size, 0);
    const placed = god.act({ ops: [{ op: 'place', def: cold.row.ref, name: 'seat', p: [0, 0, 0] }] });
    assert.ok(placed.accepted, JSON.stringify(placed));
    assert.equal(god.model.def(god.model.get('seat')!.def)!.hash, cold.entry.def1Hash);
    assert.equal(new Set(god.model.defs.values()).size, 1);
    assert.equal(db.db.prepare('SELECT COUNT(*) n FROM world_defs_v1').get()!.n, 1);
  } finally { db.close(); }
});

test('world-specific defs stay searchable; unknown queries are logged outside the pipeline', async () => {
  const { db, god, catalog, get } = fixture();
  try {
    const def = { ...items[4].up.def2, schema: 'def/1', name: 'personal-block' };
    // Copy the engine input, not def/2 metadata, for this existing world-local define route.
    const raw = registry.def1(items[4].item.def1Hash!) as Record<string, unknown>;
    assert.ok(god.act({ ops: [{ op: 'define', def: { ...raw, name: def.name, description: 'personal souvenir block', synonyms: ['souvenir'], category: 'object.decor' } }] }).accepted);
    const find = await (await get('/v1/god/defs?q=personal&compact=1')).json();
    assert.ok(find.defs.some((r: { ref: string }) => r.ref === 'personal-block@1'));
    const count = (await (await get('/v1/god/catalog?format=json')).json()).count;
    assert.equal(count, catalog.list().length + 1);
    const ledgerBefore = registry.ledger().length;
    const response = await (await get('/v1/god/defs?q=qzxqzxqzx&compact=1')).json(); assert.equal(response.count, 0);
    assert.equal(db.db.prepare('SELECT COUNT(*) n FROM god_find_misses_v1').get()!.n, 1);
    assert.equal(registry.ledger().length, ledgerBefore, 'server does not write into the pipeline');
  } finally { db.close(); }
});

test('text publication invalidates ETags while reloads preserve placed snapshots and existing hashes', async () => {
  const { db, god, catalog, get } = fixture();
  try {
    assert.ok(god.act({ ops: [{ op: 'place', def: 'eden/bench@1', name: 'b', p: [0, 0, 0] }] }).accepted);
    const snapshot = JSON.stringify(god.publicSnapshot()), rows = db.db.prepare('SELECT COUNT(*) n FROM world_edits_v1').get()!.n;
    const response = await get('/v1/god/catalog?format=json'), etag = response.headers.get('etag');
    const entry = registry.resolve('eden/bench@1')!, item = registry.item(entry.id, entry.major, entry.rev, entry.itemHash)!;
    const next = { ...item, text: { ...item.text, synonyms: [...item.text.synonyms, 'celestial seating'] } };
    registry.putItem(next); registry.publish('stable', [{ ...entry, itemHash: hashOf(next), line: lineOf(next) }], 'words');
    assert.notEqual((await get('/v1/god/catalog?format=json')).headers.get('etag'), etag);
    const find = await (await get('/v1/god/defs?q=celestial&compact=1')).json(); assert.equal(find.defs[0].ref, 'eden/bench@1');
    const loaded = new GodMode(db, { ...god.opts, library: catalog });
    assert.equal(JSON.stringify(loaded.publicSnapshot()), snapshot);
    assert.equal(db.db.prepare('SELECT COUNT(*) n FROM world_edits_v1').get()!.n, rows);
  } finally { db.close(); }
});

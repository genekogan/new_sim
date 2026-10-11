// VOCAB-MECH: taxonomy, facets, manifest, recommend, immutable thumbs (catalog.ts + assets.ts search).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono, type Context } from 'hono';
import { vocab } from '@sim/world-compiler';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode } from './god.ts';
import { mountGodRoutes } from './routes.ts';

function fixture() {
  const db = new Db(':memory:');
  const dir = mkdtempSync(join(tmpdir(), 'vocab-'));
  const god = new GodMode(db, { worldId: 'vocab-1', ownerId: null, tick: () => 1, emit: () => {}, assetDir: dir } as never);
  const app = new Hono();
  mountGodRoutes(app, {
    god, worldName: 'Vocab',
    requireUser: async () => ({ id: 'dev:gene', role: 'user', email: null, wallet: null, created_at: 0, last_seen: 0, invited_by: null }) as never,
    soulFromBearer: () => null, baseOf: () => 'http://localhost:4999/w/vocab', limitIp: () => {},
  });
  app.onError((err, c) => err instanceof ApiError ? c.json({ ok: false, code: err.code, message: err.message }, err.status as 400) : c.json({ ok: false, code: 'internal', message: String(err) }, 500));
  const token = god.mintFor({ id: 'dev:gene', role: 'user' }, 'test');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const get = async (path: string, headers: Record<string, string> = {}): Promise<{ status: number; data: any; text: string; headers: Headers }> => {
    const r = await app.request(path, { headers: { authorization: `Bearer ${token}`, ...headers } }); const text = await r.text(); let data = null; try { data = JSON.parse(text); } catch { /* text */ } return { status: r.status, data, text, headers: r.headers };
  };
  return { god, get };
}
void (null as unknown as Context);

test('taxonomy covers Gene\'s list and every core def has a known category', () => {
  for (const top of ['terrain', 'water', 'vegetation', 'building.residential', 'building.commercial', 'building.civic', 'building.industrial', 'building.agricultural', 'public', 'transport', 'utility', 'component', 'furniture', 'object', 'vehicle', 'living', 'layer.weather', 'layer.wear', 'layer.construction', 'layer.ownership', 'layer.landuse', 'layer.schedule', 'layer.economy']) assert.ok(vocab.CATEGORIES.has(top), top);
  const { god } = fixture();
  for (const d of new Set(god.model.defs.values())) assert.ok(vocab.CATEGORIES.has(vocab.categoryOf(d as never)), d.name);
});

test('faceted search: category subtree, has=slot:sit, actuators; synonyms and category words', async () => {
  const { get } = fixture();
  const seats = await get('/v1/god/defs?has=slot:sit&compact=1&limit=500');
  assert.equal(seats.status, 200); assert.ok(seats.data.count >= 5);
  for (const r of seats.data.defs) assert.match(r.ifc, /sit/);
  const furn = await get('/v1/god/defs?category=furniture&compact=1&limit=500');
  assert.ok(furn.data.defs.every((r: { cat: string }) => r.cat.startsWith('furniture')));
  const lamp = await get('/v1/god/defs?q=streetlight');
  assert.equal(lamp.data.defs[0].name, 'core-lamp-post');
  // a word that names a category finds what is in it ("bodega" → building.commercial → the shop)
  const bodega = await get('/v1/god/defs?q=bodega');
  assert.equal(bodega.data.defs[0]?.name, 'core-shop', JSON.stringify(bodega.data.defs.slice(0, 3).map((d: { name: string; why: string[] }) => [d.name, d.why])));
});

test('catalog manifest: one line per def, paged, ETag 304; taxonomy lists empty categories; recommend', async () => {
  const { get, god } = fixture();
  const n = new Set(god.model.defs.values()).size;
  const lines = await get('/v1/god/catalog?format=lines&per=100');
  assert.equal(lines.status, 200);
  const body = lines.text.trim().split('\n');
  assert.match(body[0], new RegExp(`catalog ${n} defs, page 1/${Math.ceil(n / 100)}`));
  assert.equal(body.length, 101);
  assert.ok(body.slice(1).every((l) => /^\S+@\d+ \[[a-z.-]+\] /.test(l)), body[1]);
  const again = await get('/v1/god/catalog?format=lines&per=100', { 'if-none-match': lines.headers.get('etag')! });
  assert.equal(again.status, 304);
  const tax = await get('/v1/god/catalog/taxonomy');
  const empty = tax.data.categories.filter((c: { count: number }) => !c.count).map((c: { id: string }) => c.id);
  assert.ok(empty.includes('layer.sound'));
  const rec = await get('/v1/god/recommend?intent=' + encodeURIComponent('a corner shop with a bench outside and a street lamp'));
  const fors = rec.data.needs.map((x: { for: string }) => x.for);
  assert.ok(fors.includes('corner shop'), JSON.stringify(rec.data.needs));
  assert.equal(rec.data.needs.find((x: { for: string }) => x.for === 'corner shop').picks[0].ref, 'core/shop@1');
  assert.ok(rec.data.example.ops.length >= 3);
});

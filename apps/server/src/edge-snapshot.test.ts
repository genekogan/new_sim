// Lane O2: the keyed snapshot is the only snapshot a shared cache may keep, and only while its key is current.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Hono, type Context } from 'hono';
import { Db } from './db.ts';
import { ApiError } from './souls.ts';
import { GodMode } from './god/god.ts';
import { mountGodRoutes } from './god/routes.ts';
import { mountModeration } from './moderation/routes.ts';
import { EDGE_SNAPSHOT_CACHE, SNAPSHOT_KEY_HEADER, mountEdgeSnapshot, safeKey, snapshotKey, withSnapshotKey } from './edge-snapshot.ts';

/** The http.ts wiring in miniature: moderation first, then the edge snapshot, then the god routes. */
function world(t: { after(f: () => void): void }) {
  const dir = mkdtempSync(join(tmpdir(), 'edge-snapshot-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = new Db(':memory:');
  const god = new GodMode(db, { worldId: 'edge-1', ownerId: 'dev:owner', tick: () => 1, emit: () => {}, assetDir: dir } as never);
  const app = new Hono();
  const bearer = (c: Context) => c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  const requireUser = async () => { throw new ApiError(401, 'unauthorized', 'sign in'); };
  const moderation = mountModeration(app, { db: db.db, worldId: 'edge-1', bearer, requireUser, god, siteLog: join(dir, 'site.jsonl') });
  const key = () => snapshotKey({ editSeq: god.model.editSeq, buildsRev: god.store.buildsRev(), moderation: moderation.version() });
  mountEdgeSnapshot(app, key);
  mountGodRoutes(app, { god, worldName: 'Edge', requireUser, soulFromBearer: () => null, baseOf: () => 'http://localhost:6510/w/edge', limitIp: () => {} });
  return { god, app, key };
}

test('a keyed snapshot is shared-cacheable only while its key is current; everything else stays no-store', async (t) => {
  const w = world(t);
  assert.equal(w.god.act({ ops: [{ op: 'place', def: 'core/box@1', p: [3, 4], name: 'crate' }] }).accepted, true);
  const k0 = w.key();
  assert.match(k0, /^\d+\.\d+\.\d+\.\d+$/);

  const plain = await w.app.request('/v1/world/snapshot');
  assert.equal(plain.status, 200); assert.equal(plain.headers.get('cache-control'), 'no-store', 'the plain URL (resync, God UI) is never cached');
  assert.equal(plain.headers.get(SNAPSHOT_KEY_HEADER), k0);

  const keyed = await w.app.request(`/v1/world/snapshot?v=${k0}`, { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(keyed.status, 200); assert.equal(keyed.headers.get('cache-control'), EDGE_SNAPSHOT_CACHE);
  assert.equal(keyed.headers.get('content-encoding'), 'gzip', 'compression still applies');
  const body = JSON.parse(gunzipSync(Buffer.from(await keyed.arrayBuffer())).toString('utf8'));
  assert.equal(body.seq, w.god.model.editSeq); assert.deepEqual(body.entities.map((e: { name: string }) => e.name), ['crate']);

  for (const v of ['', 'nonsense', '0.0.0.0', `${k0}.1`]) {
    const r = await w.app.request(`/v1/world/snapshot?v=${encodeURIComponent(v)}`);
    assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store', `v=${v} is not the current key`);
  }

  // an edit moves the key: the old key now answers the current world, uncached
  assert.equal(w.god.act({ ops: [{ op: 'place', def: 'core/box@1', p: [9, 9], name: 'barrel' }] }).accepted, true);
  const k1 = w.key(); assert.notEqual(k1, k0);
  const stale = await w.app.request(`/v1/world/snapshot?v=${k0}`);
  assert.equal(stale.headers.get('cache-control'), 'no-store'); assert.equal(stale.headers.get(SNAPSHOT_KEY_HEADER), k1);
  assert.equal((await stale.json()).entities.length, 2);
  assert.equal((await w.app.request(`/v1/world/snapshot?v=${k1}`)).headers.get('cache-control'), EDGE_SNAPSHOT_CACHE);
});

test('the key changes when the edit seq, the builds revision or the moderation version does, and is URL/script safe', () => {
  const base = { editSeq: 7, buildsRev: 2, moderation: '3.0' };
  assert.equal(snapshotKey(base), '7.2.3.0');
  assert.notEqual(snapshotKey({ ...base, editSeq: 8 }), snapshotKey(base));
  assert.notEqual(snapshotKey({ ...base, buildsRev: 3 }), snapshotKey(base));
  assert.notEqual(snapshotKey({ ...base, moderation: '3.1' }), snapshotKey(base));
  assert.throws(() => snapshotKey({ ...base, moderation: '"</script>' }));
  assert.equal(safeKey(() => { throw new Error('db closed'); }), null);
  assert.equal(safeKey(null), null);
});

test('the page HTML carries the key first thing in <head>; no key leaves it untouched', () => {
  const html = '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <title>Sim</title>\n    <script>prefetch()</script>\n  </head><body></body></html>';
  const out = withSnapshotKey(html, '12.0.0.0');
  assert.ok(out.includes('<head><script>window.__simSnapshotKey="12.0.0.0"</script>\n    <meta charset'));
  assert.ok(out.indexOf('__simSnapshotKey') < out.indexOf('prefetch()'), 'set before the prefetch script runs');
  assert.equal(withSnapshotKey(html, null), html);
  assert.equal(withSnapshotKey('<p>no head</p>', '1.0.0.0'), '<p>no head</p>');
});

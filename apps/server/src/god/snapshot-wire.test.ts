import test from 'node:test';
import assert from 'node:assert/strict';
import { brotliDecompressSync } from 'node:zlib';
import { Hono } from 'hono';
import { SnapshotParts, mountSnapshotParts, splitSnapshot } from './snapshot-wire.ts';

const snap = () => ({ contract: 'world/1', seq: 7, tick: 5, now: 1000, defs: [{ name: 'core-barrel', version: 1, params: { wood: { default: '#8c5f3a' } } }], entities: [{ id: 'e_1', def: 'core-barrel@1', p: [1, 0, 2], params: { wood: '#8c5f3a', iron: '#000' } }, { id: 'e_2', def: 'core-barrel@1' }], ground: { kind: 'flat', h: 0 } });

test('split: defs and ground become refs, default params go, everything else stays', () => {
  const s = splitSnapshot(snap()), b = s.body as { entities: { params?: unknown }[] } & Record<string, unknown>;
  assert.ok(!('defs' in b) && !('ground' in b)); assert.equal(b.tick, 5); assert.equal(b.now, 1000); assert.equal(b.paramsDefaulted, true);
  assert.deepEqual(b.entities[0].params, { iron: '#000' }); assert.equal(b.entities[1].params, undefined);
  assert.equal(b.defsRef, s.refs.defs); assert.match(s.refs.ground, /^[0-9a-f]{32}$/);
  assert.equal(splitSnapshot(snap()).refs.defs, s.refs.defs, 'content-addressed: same defs, same ref');
});

test('parts route: immutable, brotli, unknown 404, parts cut under an older moderation version retired', async () => {
  const parts = new SnapshotParts(), app = new Hono(); mountSnapshotParts(app, parts);
  parts.cut(snap(), 'm1'); const { defs, ground } = parts.current!;
  const r = await app.request(`/v1/world/part/${defs}`, { headers: { 'accept-encoding': 'gzip, br' } });
  assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'public, max-age=31536000, immutable'); assert.equal(r.headers.get('content-encoding'), 'br');
  assert.deepEqual(JSON.parse(brotliDecompressSync(Buffer.from(await r.arrayBuffer())).toString()), snap().defs);
  assert.deepEqual(await (await app.request(`/v1/world/part/${ground}`)).json(), snap().ground);
  assert.equal((await app.request('/v1/world/part/' + '0'.repeat(32))).status, 404);
  assert.equal((await app.request('/v1/world/part/nope')).status, 404);
  const other = { ...snap(), ground: { kind: 'hills' } }; parts.cut(other, 'm2');
  assert.equal((await app.request(`/v1/world/part/${ground}`)).status, 404, 'a part only the old moderation version cut is gone');
  assert.equal((await app.request(`/v1/world/part/${defs}`)).status, 200, 'the same defs re-cut under m2 are served');
});

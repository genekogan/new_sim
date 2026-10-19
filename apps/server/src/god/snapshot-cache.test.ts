// Lane W1: the precompressed snapshot cache (snapshot-cache.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { SnapshotCache, acceptsEncoding } from './snapshot-cache.ts';

const world = (n: number) => ({ contract: 'world/1', seq: n, entities: Array.from({ length: 200 }, (_, i) => ({ id: 'e' + i, def: 'core/bench@1', p: [i, 0, n] })), hidden: 'x' });

test('one build per key; br, gzip and identity bodies all decode to the same filtered JSON; Age grows', async () => {
  let builds = 0, key = 'a', t = 1_000_000;
  const cache = new SnapshotCache({ build: () => { builds++; return world(builds); }, key: () => key, now: () => t,
    filter: (s) => { const { hidden: _h, ...rest } = s as ReturnType<typeof world>; return rest; }, upgradeAfterMs: 0 });
  const b = await cache.respond('gzip, deflate, br, zstd'), g = await cache.respond('gzip'), plain = await cache.respond(undefined);
  assert.equal(builds, 1);
  assert.equal(b.encoding, 'br'); assert.equal(g.encoding, 'gzip'); assert.equal(plain.encoding, null);
  const want = JSON.stringify((({ hidden: _h, ...rest }) => rest)(world(1)));
  assert.equal(brotliDecompressSync(b.body).toString(), want);
  assert.equal(gunzipSync(g.body).toString(), want);
  assert.equal(plain.body.toString(), want);
  assert.equal(b.ageSeconds, 0);
  t += 2500; assert.equal((await cache.respond('br')).ageSeconds, 2);
  key = 'b'; const next = await cache.respond('br');
  assert.equal(builds, 2); assert.equal(next.ageSeconds, 0); assert.match(brotliDecompressSync(next.body).toString(), /"seq":2/);
  t += 61_000; await cache.respond('br'); assert.equal(builds, 3, 'at most a minute old');
});

test('the q11 copy replaces q9 later, for the same entry only', async () => {
  const cache = new SnapshotCache({ build: () => world(1), key: () => 'k', upgradeAfterMs: 0 });
  const first = await cache.respond('br');
  for (let i = 0; i < 100; i++) { await new Promise((r) => setTimeout(r, 10)); if ((await cache.respond('br')).body !== first.body) break; }
  const later = await cache.respond('br');
  assert.notEqual(later.body, first.body); assert.ok(later.body.length <= first.body.length);
  assert.equal(brotliDecompressSync(later.body).toString(), JSON.stringify(world(1)));
});

test('acceptsEncoding: names, q=0, wildcard', () => {
  assert.equal(acceptsEncoding('gzip, deflate, br', 'br'), true);
  assert.equal(acceptsEncoding('br;q=0, gzip', 'br'), false);
  assert.equal(acceptsEncoding('*', 'br'), true);
  assert.equal(acceptsEncoding('*;q=0.5, br;q=0', 'br'), false);
  assert.equal(acceptsEncoding(undefined, 'gzip'), false);
  assert.equal(acceptsEncoding('identity', 'gzip'), false);
});

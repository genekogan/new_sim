import test from 'node:test';
import assert from 'node:assert/strict';
import {BACKDROP_BLOBS,MARS_CAMPUS_URL,prefetchBackdrop,takeBackdrop} from './backdrop-prefetch.ts';

test('the Mars campus URL has a content-addressed blob', () => {
  assert.match(BACKDROP_BLOBS[MARS_CAMPUS_URL]!, /^\/blobs\/assets\/([0-9a-f]{2})\/\1[0-9a-f]{62}\.glb$/);
});
test('prefetched bytes are fetched once and handed over once', async () => {
  let calls = 0; const f = (async () => { calls++; return new Response(new Uint8Array([1, 2, 3])); }) as typeof fetch;
  prefetchBackdrop('/a.glb', f); prefetchBackdrop('/a.glb', f);
  assert.equal(calls, 1);
  const p = takeBackdrop('/a.glb'); assert.ok(p); assert.equal((await p!).byteLength, 3);
  assert.equal(takeBackdrop('/a.glb'), null);
});
test('a failed prefetch rejects for its taker (who then falls back) and never throws unhandled', async () => {
  prefetchBackdrop('/b.glb', (async () => new Response(null, { status: 404 })) as typeof fetch);
  await assert.rejects(takeBackdrop('/b.glb')!, /backdrop 404/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import { serveDownload } from './downloads.mjs';
const raw = Buffer.from('glTF'.repeat(100)),
  br = brotliCompressSync(raw);
function fixture(missing = false) {
  return {
    head: async (key) =>
      missing && key === 'br'
        ? null
        : { size: key === 'br' ? br.length : raw.length, httpEtag: `"${key}"` },
    get: async (key, options) => ({
      body: new Blob([
        options?.range
          ? raw.subarray(
              options.range.offset,
              options.range.offset + options.range.length,
            )
          : key === 'br'
            ? br
            : raw,
      ]).stream(),
    }),
  };
}
const asset = { key: 'raw', type: 'model/gltf-binary', br: { key: 'br' } };
const request = (headers = {}, method = 'GET', missing = false) =>
  serveDownload(
    new Request('https://example.test/model', { headers, method }),
    fixture(missing),
    asset,
  );
test('Brotli negotiation returns exact original bytes after decoding and variant-specific validators', async () => {
  const r = await request({ 'Accept-Encoding': 'gzip, br' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Content-Encoding'), 'br');
  assert.equal(r.headers.get('Content-Type'), 'model/gltf-binary');
  assert.equal(r.headers.get('Content-Length'), String(br.length));
  assert.equal(r.headers.get('ETag'), '"br"');
  assert.match(r.headers.get('Vary'), /Accept-Encoding/);
  assert.deepEqual(
    brotliDecompressSync(Buffer.from(await r.arrayBuffer())),
    raw,
  );
  assert.equal(
    (await request({ 'Accept-Encoding': 'br', 'If-None-Match': '"raw"' }))
      .status,
    200,
  );
  assert.equal(
    (await request({ 'Accept-Encoding': 'br', 'If-None-Match': 'W/"br"' }))
      .status,
    304,
  );
  const h = await request({ 'Accept-Encoding': 'br' }, 'HEAD');
  assert.equal(h.headers.get('Content-Encoding'), 'br');
  assert.equal((await h.arrayBuffer()).byteLength, 0);
});
test('ranges, excluded encodings, older clients and missing compressed objects safely use identity', async () => {
  for (const headers of [
    {},
    { 'Accept-Encoding': 'gzip' },
    { 'Accept-Encoding': 'br;q=0' },
    { 'Accept-Encoding': 'br;q=0, *;q=1' },
  ]) {
    const r = await request(headers);
    assert.equal(r.headers.get('Content-Encoding'), null);
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), raw);
  }
  const r = await request({ 'Accept-Encoding': 'br', Range: 'bytes=0-3' });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('Content-Encoding'), null);
  assert.equal(await r.text(), 'glTF');
  assert.equal(r.headers.get('Content-Range'), 'bytes 0-3/400');
  const fallback = await request({ 'Accept-Encoding': 'br' }, 'GET', true);
  assert.equal(fallback.headers.get('Content-Encoding'), null);
  assert.deepEqual(Buffer.from(await fallback.arrayBuffer()), raw);
});

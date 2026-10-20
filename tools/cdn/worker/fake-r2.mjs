// fake-r2.mjs — a strict in-memory stand-in for a Workers R2 bucket binding, shared by god-uploads.test.mjs and the
// verify-worker.mjs self-test (lane CDN4, 2026-10-20).
//
// It follows the R2 Workers API reference (developers.cloudflare.com/r2/api/workers/workers-api-reference/) rather than
// accepting whatever the Worker passes:
//   - put options: only onlyIf, httpMetadata, customMetadata, md5, sha1, sha256, sha384, sha512, storageClass, ssecKey;
//     "Only a single hashing algorithm can be specified at once"; a hash that does not match the body rejects;
//   - httpMetadata: only contentType, contentLanguage, contentDisposition, contentEncoding, cacheControl, cacheExpiry;
//   - customMetadata: string values only, at most 2,048 bytes of keys plus values (R2's metadata limit);
//   - a put is a write to the bucket's region, not instant: it lands `latencyMs` after the call (default 40 ms), so a
//     Worker that answers before its put resolves (a put left in waitUntil) is seen as "not stored yet" by the next
//     head/get, as the live HEAD after the 2026-10-20 deploy saw;
//   - `failPuts` makes every put reject (a binding or service error), so a swallowed failure is visible in tests.
import { createHash } from 'node:crypto';

const PUT_OPTIONS = new Set(['onlyIf', 'httpMetadata', 'customMetadata', 'md5', 'sha1', 'sha256', 'sha384', 'sha512', 'storageClass', 'ssecKey']);
const HASHES = { md5: 'md5', sha1: 'sha1', sha256: 'sha256', sha384: 'sha384', sha512: 'sha512' };
const HTTP_METADATA = new Set(['contentType', 'contentLanguage', 'contentDisposition', 'contentEncoding', 'cacheControl', 'cacheExpiry']);
const MAX_CUSTOM_METADATA = 2048;
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function bytesOf(value) {
  if (value === null) return new Uint8Array(0);
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  if (value instanceof Blob || value instanceof ReadableStream) return new Uint8Array(await new Response(value).arrayBuffer());
  throw new TypeError('R2 put: value must be a ReadableStream, ArrayBuffer, ArrayBufferView, string, Blob or null');
}

export class FakeR2 {
  constructor({ latencyMs = 40, failPuts = false } = {}) {
    this.objects = new Map(); this.puts = []; this.gets = 0; this.latencyMs = latencyMs; this.failPuts = failPuts;
  }
  #object(key, o) {
    return { key, size: o.bytes.byteLength, etag: o.etag, httpEtag: `"${o.etag}"`, uploaded: o.uploaded, httpMetadata: { ...o.httpMetadata }, customMetadata: { ...o.customMetadata } };
  }
  async head(key) { const o = this.objects.get(key); return o ? this.#object(key, o) : null; }
  async get(key) {
    this.gets++; const o = this.objects.get(key); if (!o) return null;
    const bytes = o.bytes.slice();
    return { ...this.#object(key, o), body: new Response(bytes).body, arrayBuffer: async () => bytes.slice().buffer };
  }
  async put(key, value, options = {}) {
    if (typeof key !== 'string' || !key) throw new TypeError('R2 put: key must be a non-empty string');
    for (const k of Object.keys(options)) if (!PUT_OPTIONS.has(k)) throw new TypeError(`R2 put: unknown option ${k}`);
    const hashes = Object.keys(options).filter((k) => k in HASHES);
    if (hashes.length > 1) throw new TypeError('R2 put: only a single hashing algorithm can be specified at once');
    const http = options.httpMetadata ?? {};
    for (const k of Object.keys(http)) if (!HTTP_METADATA.has(k)) throw new TypeError(`R2 put: unknown httpMetadata field ${k}`);
    const custom = options.customMetadata ?? {};
    let size = 0;
    for (const [k, v] of Object.entries(custom)) {
      if (typeof v !== 'string') throw new TypeError(`R2 put: customMetadata.${k} must be a string`);
      size += Buffer.byteLength(k) + Buffer.byteLength(v);
    }
    if (size > MAX_CUSTOM_METADATA) throw new TypeError(`R2 put: customMetadata is ${size} bytes (limit ${MAX_CUSTOM_METADATA})`);
    const bytes = await bytesOf(value);
    for (const h of hashes) {
      const want = options[h], got = createHash(HASHES[h]).update(bytes).digest('hex');
      const wantHex = typeof want === 'string' ? want.toLowerCase() : Buffer.from(want).toString('hex');
      if (wantHex !== got) throw new Error(`R2 put: ${h} mismatch`);
    }
    this.puts.push({ key, opts: options });
    await sleep(this.latencyMs);
    if (this.failPuts) throw new Error('R2 put: internal error (fake failPuts)');
    const etag = createHash('md5').update(bytes).digest('hex');
    this.objects.set(key, { bytes, etag, uploaded: new Date(), httpMetadata: { ...http }, customMetadata: { ...custom } });
    return this.#object(key, this.objects.get(key));
  }
}

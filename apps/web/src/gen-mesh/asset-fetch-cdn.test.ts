// CDN2 (2026-10-20): GLBs downloaded in the worker take the CDN when the manifest lists them (3.50 shipped with the worker
// bypassing the page's CDN transport, so every core GLB came from the origin). Two halves: the page posts the CDN route
// with the job, and the worker's own code (SRC, run here against fake fetches) verifies length + SHA-256 and falls back.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const posted: Record<string, unknown>[] = [];
class RecordingWorker {
  onmessage: ((ev: { data: unknown }) => void) | null = null; onerror: (() => void) | null = null;
  postMessage(m: { id: number }) {
    posted.push(m as Record<string, unknown>);
    setTimeout(() => this.onmessage?.({ data: { id: m.id, loaded: 1, buffer: new Uint8Array([9]).buffer, cdn: !!(m as { cdn?: unknown }).cdn } }), 1);
  }
}
(globalThis as unknown as { Worker: unknown }).Worker = RecordingWorker;

const bytes = new TextEncoder().encode('a core mesh');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const listed = `${'c'.repeat(64)}`;   // a hash alias whose origin route sends a rendition (`of`)
const manifest = { version: 1 as const, assets: {
  [`/assets/${sha256}.glb`]: { key: `assets/${sha256.slice(0, 2)}/${sha256}.glb`, sha256, bytes: bytes.length, licence: 'CC0-1.0' },
  [`/worlds/assets/${sha256}.glb`]: { key: `assets/${sha256.slice(0, 2)}/${sha256}.glb`, sha256, bytes: bytes.length, licence: 'CC0-1.0' },
  [`/assets/${listed}.glb`]: { key: `assets/${sha256.slice(0, 2)}/${sha256}.glb`, sha256, bytes: bytes.length, licence: 'served-public', of: listed },
} };

test('the page posts each listed GLB with its CDN route; unlisted ones go to the origin only', async () => {
  const { setCdnRouteForTest, readCdnManifest } = await import('../cdn-assets.ts');
  const { fetchInWorker } = await import('./asset-fetch.ts');
  setCdnRouteForTest(readCdnManifest(manifest));
  const key = `https://assets.eden.art/assets/${sha256.slice(0, 2)}/${sha256}.glb`;
  await fetchInWorker(`/worlds/w/some-world/assets/${sha256}.glb`);
  await fetchInWorker(`/w/eden/assets/${listed}.glb`);
  await fetchInWorker(`/w/eden/assets/${'d'.repeat(64)}.glb`);
  assert.deepEqual(posted.map((m) => m.cdn), [{ url: key, sha256, bytes: bytes.length }, { url: key, sha256, bytes: bytes.length }, undefined]);
  assert.match(String(posted[0].url), /\/worlds\/w\/some-world\/assets\//, 'the original URL stays the fallback');
  setCdnRouteForTest(null);
  await fetchInWorker(`/w/eden/assets/${sha256}.glb`);
  assert.equal(posted.at(-1)!.cdn, undefined, 'no manifest (switch off or failed): origin');
});

/** Run the worker's source with a fake `self` and `fetch`; returns what it posts for one job and which URLs it fetched. */
async function runWorker(cdnBody: Uint8Array | null, status = 200) {
  const { SRC } = await import('./asset-fetch.ts');
  const out: Record<string, unknown>[] = [], fetched: string[] = [];
  const origin = new Uint8Array([7, 7, 7]);
  const body = (b: Uint8Array) => new ReadableStream({ start(c) { c.enqueue(b.slice(0, 4)); c.enqueue(b.slice(4)); c.close(); } });
  const fetch = async (url: string) => {
    fetched.push(url);
    if (url.startsWith('https://assets.eden.art/')) return cdnBody ? new Response(body(cdnBody), { status }) : Promise.reject(new TypeError('CORS'));
    return new Response(body(origin), { status: 200, headers: { 'content-length': '3' } });
  };
  const self: { onmessage?: (ev: { data: unknown }) => Promise<void>; postMessage: (m: Record<string, unknown>) => void } = { postMessage: (m) => out.push(m) };
  new Function('self', 'fetch', SRC)(self, fetch);
  await self.onmessage!({ data: { id: 1, url: 'https://sim.eden.art/w/eden/assets/x.glb', cdn: { url: 'https://assets.eden.art/assets/aa/x.glb', sha256, bytes: bytes.length }, images: false } });
  const last = out.at(-1)!;
  return { fetched, cdn: last.cdn === true, bytes: last.buffer ? [...new Uint8Array(last.buffer as ArrayBuffer)] : null };
}

test('worker: verified CDN bytes are delivered without touching the origin; anything else falls back to the origin', async () => {
  const ok = await runWorker(bytes);
  assert.deepEqual(ok, { fetched: ['https://assets.eden.art/assets/aa/x.glb'], cdn: true, bytes: [...bytes] });
  const wrong = new Uint8Array(bytes); wrong[0] ^= 1;
  for (const [why, r] of [['hash', await runWorker(wrong)], ['http', await runWorker(bytes, 404)], ['network', await runWorker(null)],
    ['oversize', await runWorker(new Uint8Array([...bytes, 1]))], ['short', await runWorker(bytes.slice(1))]] as const) {
    assert.deepEqual(r, { fetched: ['https://assets.eden.art/assets/aa/x.glb', 'https://sim.eden.art/w/eden/assets/x.glb'], cdn: false, bytes: [7, 7, 7] }, why);
  }
});

test('CDN4: the asset worker gets the Worker route for a sized god upload on its own /worlds page', async () => {
  const { setCdnRouteForTest, readCdnManifest, noteUploadSizes, clearUploadSizesForTest } = await import('../cdn-assets.ts');
  const { fetchInWorker } = await import('./asset-fetch.ts');
  const up = 'a'.repeat(64), loc = globalThis.location;
  (globalThis as { location: unknown }).location = new URL('https://sim.eden.art/worlds/w/bench-hamlet/');
  try {
    setCdnRouteForTest(readCdnManifest(manifest));
    noteUploadSizes({ [up]: 4096 });
    await fetchInWorker(`/worlds/w/bench-hamlet/assets/${up}.glb`);
    assert.deepEqual(posted.at(-1)!.cdn, { url: `https://assets.eden.art/w/bench-hamlet/assets/${up}.glb`, sha256: up, bytes: 4096 });
    assert.equal(posted.at(-1)!.url, `https://sim.eden.art/worlds/w/bench-hamlet/assets/${up}.glb`, 'the original URL stays the fallback');
    await fetchInWorker(`/worlds/w/bench-hamlet/assets/${'b'.repeat(64)}.glb`);
    assert.equal(posted.at(-1)!.cdn, undefined, 'an upload the snapshot did not size: origin');
  } finally { clearUploadSizesForTest(); setCdnRouteForTest(null); (globalThis as { location: unknown }).location = loc; }
});

/** PF2: the worker's source against fetches scripted per URL (each call takes the next behaviour), under mock timers. */
type Step = 'never' | 'ok' | 'stall-body' | Uint8Array;
async function runScripted(t: TestContext, script: Record<string, Step[]>, withCdn = true) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { SRC } = await import('./asset-fetch.ts');
  const out: Record<string, unknown>[] = [], fetched: string[] = [], aborted: string[] = [];
  const origin = new Uint8Array([7, 7, 7]);
  const fetch = (url: string, init: { signal?: AbortSignal } = {}) => {
    fetched.push(url); init.signal?.addEventListener('abort', () => aborted.push(url));
    const step = script[url]?.shift() ?? 'ok';
    if (step === 'never') return new Promise<never>((_, rej) => init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
    if (step === 'stall-body') return Promise.resolve(new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); init.signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError'))); } }), { status: 200 }));
    const b = step === 'ok' ? (url.startsWith('https://assets.eden.art/') ? bytes : origin) : step;
    return Promise.resolve(new Response(new ReadableStream({ start(c) { c.enqueue(b); c.close(); } }), { status: 200 }));
  };
  const self: { onmessage?: (ev: { data: unknown }) => Promise<void>; postMessage: (m: Record<string, unknown>) => void } = { postMessage: (m) => out.push(m) };
  new Function('self', 'fetch', SRC)(self, fetch);
  let done = false;
  void self.onmessage!({ data: { id: 1, url: 'https://sim.eden.art/w/eden/assets/x.glb', ...(withCdn ? { cdn: { url: 'https://assets.eden.art/assets/aa/x.glb', sha256, bytes: bytes.length } } : {}), images: false } }).then(() => { done = true; });
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
  const at = async (ms: number) => { t.mock.timers.tick(ms); await settle(); };
  await settle();
  const result = () => { const last = out.at(-1)!; return { done, fetched: [...fetched], aborted: [...aborted], cdn: last?.cdn === true, error: last?.error, bytes: last?.buffer ? [...new Uint8Array(last.buffer as ArrayBuffer)] : null }; };
  return { at, result };
}
const CDN = 'https://assets.eden.art/assets/aa/x.glb', ORIGIN = 'https://sim.eden.art/w/eden/assets/x.glb';

test('PF2: a CDN request with no answer in 4 s is asked for at the origin beside it; the first answer wins, the other is cancelled', async (t) => {
  const w = await runScripted(t, { [CDN]: ['never'] });
  await w.at(3999); assert.deepEqual(w.result().fetched, [CDN], 'waits for the CDN first');
  await w.at(1);
  assert.deepEqual(w.result(), { done: true, fetched: [CDN, ORIGIN], aborted: [CDN], cdn: false, error: undefined, bytes: [7, 7, 7] });
});

test('PF2: an original request with no answer in 4 s is asked for again beside it (no CDN route)', async (t) => {
  const w = await runScripted(t, { [ORIGIN]: ['never'] }, false);
  await w.at(3999); assert.equal(w.result().done, false);
  await w.at(1);
  assert.deepEqual(w.result(), { done: true, fetched: [ORIGIN, ORIGIN], aborted: [ORIGIN], cdn: false, error: undefined, bytes: [7, 7, 7] });
});

test('PF2: an original body that stalls for 12 s is asked for once more; a second stall is an error, not a hang', async (t) => {
  const once = await runScripted(t, { [ORIGIN]: ['stall-body'] }, false);
  await once.at(11_999); assert.equal(once.result().done, false);
  await once.at(1);
  assert.deepEqual(once.result(), { done: true, fetched: [ORIGIN, ORIGIN], aborted: [ORIGIN], cdn: false, error: undefined, bytes: [7, 7, 7] });
  t.mock.timers.reset();
  const twice = await runScripted(t, { [ORIGIN]: ['stall-body', 'stall-body'] }, false);
  await twice.at(12_000); await twice.at(12_000);
  const r = twice.result(); assert.equal(r.done, true); assert.match(String(r.error), /stalled/); assert.equal(r.fetched.length, 2);
});

// Phone arrival (lane d3): GLB bytes are downloaded in a worker. three's FileLoader pumps every response body through a
// main-thread ReadableStream, and the browser only buffers a little of each response, so while the page's main thread
// is in a long task (a phone builds the terrain and every thing's holder for ~2 s at arrival) the downloads stall and the
// arrival card waits for them afterwards. A worker drains them meanwhile; the main thread only parses the finished
// ArrayBuffer (GLTFLoader.parseAsync, same decoders). The byte bar (asset-bytes.ts) and the loader's LoadingManager
// (download counts) see the same start/progress/end as before. Without Worker/Blob support, or `?assetworker=0`, the
// caller keeps FileLoader.
import { assetBytes } from '../asset-bytes.ts';
import { cdnRoute, type CdnRoute } from '../cdn-assets.ts';

const OFF = typeof location !== 'undefined' && new URLSearchParams(location.search).get('assetworker') === '0';
const NO_IMAGES = typeof location !== 'undefined' && new URLSearchParams(location.search).get('workerImages') === '0';   // A/B: images decoded by GLTFLoader
export const SRC = `
// Phone arrival round 2 (lane L3): a GLB's embedded PNG/JPEG/WebP images are decoded here as GLTFLoader's
// ImageBitmapLoader would (same bytes, premultiplyAlpha 'none', colorSpaceConversion 'none'). On the main thread each one
// first cost a Blob copy of its bytes (~0.15 s of a 4x phone on Mars) and a decode scheduled behind the parse.
async function decodeImages(buf, n) {
  try {
    if (typeof createImageBitmap !== 'function' || n < 28) return [];
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x46546C67 || dv.getUint32(4, true) !== 2 || dv.getUint32(16, true) !== 0x4E4F534A) return [];
    const jl = dv.getUint32(12, true), bin = 20 + jl;
    if (bin + 8 > n || dv.getUint32(bin + 4, true) !== 0x004E4942) return [];
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl))), b0 = bin + 8, b1 = b0 + dv.getUint32(bin, true);
    if (b1 > n || (json.buffers && json.buffers[0] && json.buffers[0].uri !== undefined)) return [];
    const jobs = (json.images || []).map((im, i) => {
      const bv = im && im.bufferView !== undefined && json.bufferViews ? json.bufferViews[im.bufferView] : null;
      if (!bv || (bv.buffer || 0) !== 0 || !/^image\\/(png|jpeg|webp)$/.test(im.mimeType || '')) return null;
      const off = b0 + (bv.byteOffset || 0); if (off + bv.byteLength > b1) return null;
      return createImageBitmap(new Blob([new Uint8Array(buf, off, bv.byteLength)], { type: im.mimeType }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }).then((b) => [i, b], () => null);
    }).filter(Boolean);
    return (await Promise.all(jobs)).filter(Boolean);
  } catch (e) { return []; }
}
// Each header wait is bounded independently; the second request starts after 4 s. Body deadlines measure inactivity,
// not total transfer time, so a slow connection that keeps delivering bytes can finish without a size/quality change.
const HEDGE_MS = 4000, STALL_MS = 12000;
const running = new Map();
const abortError = () => new DOMException('asset request aborted', 'AbortError');
function cancelResponse(r) { try { if (r.body) void r.body.cancel().catch(() => {}); } catch (_) {} }
function headers(run, job) {
  const ctl = new AbortController(); job.requests.add(ctl);
  const release = () => job.requests.delete(ctl);
  const promise = new Promise((resolve, reject) => {
    let settled = false, timer;
    const finish = (error, r) => {
      if (settled) { if (r) cancelResponse(r); return; }
      settled = true; clearTimeout(timer); ctl.signal.removeEventListener('abort', aborted);
      if (error) { release(); reject(error); } else resolve({ r, ctl, release });
    };
    const aborted = () => finish(ctl.signal.reason || abortError());
    ctl.signal.addEventListener('abort', aborted, { once: true });
    timer = setTimeout(() => { const e = new Error('headers stalled for ' + STALL_MS / 1000 + ' s'); finish(e); ctl.abort(e); }, STALL_MS);
    if (job.cancelled) { ctl.abort(abortError()); return; }
    Promise.resolve().then(() => { ctl.signal.throwIfAborted(); return run(ctl.signal); }).then((r) => {
      // A failed hedge must not beat a successful sibling that is still waiting for its headers.
      if (!r.ok) { const e = Object.assign(new Error('HTTP ' + r.status), { status: r.status }); cancelResponse(r); finish(e); ctl.abort(e); }
      else finish(null, r);
    }, (e) => finish(e));
  });
  return { ctl, promise };
}
function hedged(a, b, job) {
  return new Promise((resolve, reject) => {
    const ctl = []; let settled = false, out = 1, timer;
    const win = (i) => (got) => {
      if (settled) { got.ctl.abort(); cancelResponse(got.r); got.release(); return; }
      settled = true; clearTimeout(timer); if (ctl[1 - i]) ctl[1 - i].abort();
      resolve({ ...got, cdn: i === 0 && a.cdn === true });
    };
    const lose = (e) => { if (--out === 0 && !settled) { settled = true; clearTimeout(timer); reject(e); } };
    const launch = (run, i) => { const r = headers(run, job); ctl[i] = r.ctl; r.promise.then(win(i), lose); };
    launch(a, 0);
    timer = setTimeout(() => { if (settled) return; out++; launch(b, 1); }, HEDGE_MS);
  });
}
// Every reader is released; abort/timeout settles even if a fetch/reader ignores its signal.
async function body(id, got, max, job) {
  let timer, reader, rejectStopped, stoppedOnce = false;
  const stopped = new Promise((_, reject) => { rejectStopped = reject; });
  // There can be no read yet when an already-cancelled request enters this function.
  void stopped.catch(() => {});
  const stop = (error) => { if (stoppedOnce) return; stoppedOnce = true; rejectStopped(error); got.ctl.abort(error); try { if (reader) void reader.cancel().catch(() => {}); } catch (_) {} };
  const aborted = () => stop(got.ctl.signal.reason || abortError());
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => stop(new Error('body stalled')), STALL_MS); };
  try {
    got.ctl.signal.throwIfAborted();
    if (!got.r.body) return null;
    reader = got.r.body.getReader(); got.ctl.signal.addEventListener('abort', aborted, { once: true });
    const parts = []; let loaded = 0, last = 0; arm();
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), stopped]); if (done) break;
      if (!value.byteLength) continue;
      arm(); loaded += value.byteLength;
      if (loaded > max) { stop(new Error('asset length mismatch')); return null; }
      parts.push(value);
      const now = Date.now(); if (now - last > 100 && !job.cancelled) { last = now; self.postMessage({ id, loaded }); }
    }
    const out = new Uint8Array(loaded); let o = 0; for (const p of parts) { out.set(p, o); o += p.byteLength; }
    return out;
  } catch (e) { return null; } finally {
    clearTimeout(timer); got.ctl.signal.removeEventListener('abort', aborted);
    try { if (reader) reader.releaseLock(); else cancelResponse(got.r); } catch (_) {}
    got.release();
  }
}
async function fromCdn(id, cdn, got, job) {
  self.postMessage({ id, total: cdn.bytes });
  const out = await body(id, got, cdn.bytes, job);
  if (!out || out.byteLength !== cdn.bytes || job.cancelled) return null;
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', out)), (b) => b.toString(16).padStart(2, '0')).join('');
  return hash === cdn.sha256 ? out : null;
}
self.onmessage = async (ev) => {
  const { id, url, cdn, images: decode, cancel } = ev.data;
  if (cancel) {
    const job = running.get(id); if (!job) return;
    job.cancelled = true; running.delete(id);
    for (const ctl of job.requests) ctl.abort(abortError());
    job.requests.clear(); return;
  }
  const job = { cancelled: false, requests: new Set() }; running.set(id, job);
  const send = async (out, viaCdn) => {
    if (job.cancelled) return;
    const images = decode ? await decodeImages(out.buffer, out.byteLength) : [];
    if (job.cancelled) { for (const [, bitmap] of images) bitmap.close(); return; }
    try { self.postMessage({ id, loaded: out.byteLength, buffer: out.buffer, images, ...(viaCdn ? { cdn: true } : {}) }, [out.buffer, ...images.map((x) => x[1])]); }
    catch (e) { for (const [, bitmap] of images) bitmap.close(); throw e; }
  };
  try {
    const original = (signal) => fetch(url, { credentials: 'same-origin', signal });
    let got = null;
    if (cdn) {
      const fromEdge = Object.assign((signal) => fetch(cdn.url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal }), { cdn: true });
      got = await hedged(fromEdge, original, job).catch(() => null);
      if (job.cancelled) return;
      if (got && got.cdn) { const verified = await fromCdn(id, cdn, got, job); if (verified) return await send(verified, true); got = null; }
    }
    for (let attempt = 0; ; attempt++) {
      if (job.cancelled) return;
      if (!got) got = await hedged(original, original, job);
      if (job.cancelled) return;
      const r = got.r;
      const enc = r.headers.get('content-encoding'), len = Number(r.headers.get('content-length'));
      self.postMessage({ id, total: !enc && Number.isFinite(len) && len > 0 ? len : null });
      const out = await body(id, got, Infinity, job);
      if (out) return await send(out, false);
      if (attempt) throw new Error('stalled for ' + STALL_MS / 1000 + ' s');
      got = null;
    }
  } catch (e) { if (!job.cancelled) self.postMessage({ id, error: String(e && e.message || e), ...(e && e.status ? { status: e.status } : {}) }); }
  finally { if (running.get(id) === job) running.delete(id); for (const ctl of job.requests) ctl.abort(); job.requests.clear(); }
};`;

type Job = { url: string; resolve: (b: ArrayBuffer) => void; reject: (e: Error) => void; cleanup: () => void; posted: boolean };
let worker: Worker | null | undefined;
const stats = { delivered: 0, images: 0, failed: false, cdn: 0, get pending() { return jobs.size; } };   // probes (tools/speed)
if (typeof window !== 'undefined') (window as unknown as { __assetWorker?: unknown }).__assetWorker = stats;
const jobs = new Map<number, Job>();
let next = 1;
function start(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (OFF || typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof location === 'undefined') return (worker = null);
    const w = new Worker(URL.createObjectURL(new Blob([SRC], { type: 'text/javascript' })));
    w.onmessage = (ev: MessageEvent<{ id: number; total?: number | null; loaded?: number; buffer?: ArrayBuffer; images?: [number, ImageBitmap][]; error?: string; status?: number; cdn?: boolean }>) => {
      const m = ev.data, job = jobs.get(m.id);
      if (!job || worker !== w) { for (const [, bitmap] of m.images ?? []) bitmap.close(); return; }
      if (m.error !== undefined) { jobs.delete(m.id); job.cleanup(); assetBytes.done(job.url, false); job.reject(Object.assign(new Error(`asset fetch failed: ${m.error} (${job.url})`), m.status ? { status: m.status } : {})); return; }
      if (m.total !== undefined) assetBytes.headers(job.url, m.total);
      if (m.loaded !== undefined) assetBytes.progress(job.url, m.loaded);
      if (m.buffer) { jobs.delete(m.id); job.cleanup(); assetBytes.done(job.url, true); stats.delivered++; if (m.cdn) stats.cdn++; stats.images += m.images?.length ?? 0; if (m.images?.length) decoded.set(m.buffer, new Map(m.images)); job.resolve(m.buffer); }
    };
    // a worker that cannot run (blocked blob: URLs) fails every pending job; later loads use FileLoader
    w.onerror = () => { if (worker !== w) return; worker = null; stats.failed = true; w.terminate(); for (const [id, job] of jobs) { jobs.delete(id); job.cleanup(); assetBytes.done(job.url, false); job.reject(Object.assign(new Error(`asset worker unavailable (${job.url})`), { unavailable: true })); } };
    return (worker = w);
  } catch { return (worker = null); }
}

/** Images the worker decoded for a GLB it delivered (image index -> bitmap), for GLTFLoader (gltf-assets.ts). */
const decoded = new WeakMap<ArrayBuffer, Map<number, ImageBitmap>>();
export function decodedImagesOf(buffer: ArrayBuffer): Map<number, ImageBitmap> | null { return decoded.get(buffer) ?? null; }

/** Start the worker early (the viewer's mount): its startup needs a main-thread turn, which a phone's arrival build
 *  would otherwise not give it until its downloads are already late. */
export function warmAssetWorker() { start(); }

/** The bytes of `url` (same origin), downloaded off the main thread; null when no worker is available. */
export function fetchInWorker(url: string, signal?: AbortSignal): Promise<ArrayBuffer> | null {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('asset request aborted', 'AbortError'));
  const w = start(); if (!w) return null;
  const abs = new URL(url, location.href).href, id = next++;
  assetBytes.start(abs);
  // The CDN manifest decides first (it is loaded at boot, like the page transport waits for it); then the worker fetches.
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const cancel = () => {
      const job = jobs.get(id); if (!job) return;
      jobs.delete(id); job.cleanup(); assetBytes.done(abs, false);
      if (job.posted) { try { w.postMessage({ id, cancel: true }); } catch { /* the worker may already have failed */ } }
      reject(signal?.reason ?? new DOMException('asset request aborted', 'AbortError'));
    };
    const cleanup = () => signal?.removeEventListener('abort', cancel);
    const job = { url: abs, resolve, reject, cleanup, posted: false };
    jobs.set(id, job); signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) { cancel(); return; }
    void cdnRoute(abs).catch(() => null).then((cdn: CdnRoute | null) => {
      if (jobs.get(id) !== job) return;   // cancelled or the worker failed while the manifest was loading
      try { job.posted = true; w.postMessage({ id, url: abs, ...(cdn ? { cdn } : {}), images: !NO_IMAGES }); }
      catch {
        jobs.delete(id); cleanup(); assetBytes.done(abs, false);
        reject(Object.assign(new Error(`asset worker unavailable (${abs})`), { unavailable: true }));
      }
    });
  });
}

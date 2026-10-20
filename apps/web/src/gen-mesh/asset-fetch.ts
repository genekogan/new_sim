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
// CDN2 (2026-10-20): a GLB the CDN manifest lists comes from assets.eden.art (cdn-assets.ts cdnRoute, resolved on the page
// before the job is posted). Its bytes must be exactly cdn.bytes long and hash to cdn.sha256; otherwise (HTTP, CORS,
// network, a 12 s stall, length or hash) the worker downloads the original URL, as the page's transport does.
// PF2 (2026-10-20), as the page-entry snapshot (snapshot-wire.ts hedged): a GLB request that has not answered in HEDGE_MS
// is asked for again beside it (the original URL beside the CDN, the original again beside itself) and the first answer
// wins, the other is cancelled; an original body that sends nothing for STALL_MS is asked for once more. Before, nothing
// bounded the original request at all, and a stalled CDN request held its GLB for the full 12 s before the fallback.
const HEDGE_MS = 4000, STALL_MS = 12000;
function hedged(a, b) {
  return new Promise((resolve, reject) => {
    const ctl = [new AbortController(), null]; let settled = false, out = 1, timer;
    const win = (i) => (r) => { if (settled) { ctl[i].abort(); return; } settled = true; clearTimeout(timer); if (ctl[1 - i]) ctl[1 - i].abort(); resolve({ r, ctl: ctl[i], cdn: i === 0 && a.cdn === true }); };
    const lose = (e) => { if (--out === 0 && !settled) { settled = true; clearTimeout(timer); reject(e); } };
    a(ctl[0].signal).then(win(0), lose);
    timer = setTimeout(() => { if (settled) return; out++; ctl[1] = new AbortController(); try { b(ctl[1].signal).then(win(1), lose); } catch (e) { lose(e); } }, HEDGE_MS);
  });
}
// The body of a response, or null when it sends nothing for STALL_MS (the request is then cancelled) or more than max bytes.
async function body(id, got, max) {
  let timer; const arm = () => { clearTimeout(timer); timer = setTimeout(() => got.ctl.abort(), STALL_MS); };
  try {
    if (!got.r.body) return null;
    const reader = got.r.body.getReader(), parts = []; let loaded = 0, last = 0;
    for (arm(); ; arm()) {
      const { done, value } = await reader.read(); if (done) break;
      loaded += value.byteLength; if (loaded > max) { reader.cancel().catch(() => {}); return null; }
      parts.push(value);
      const now = Date.now(); if (now - last > 100) { last = now; self.postMessage({ id, loaded }); }
    }
    const out = new Uint8Array(loaded); let o = 0; for (const p of parts) { out.set(p, o); o += p.byteLength; }
    return out;
  } catch (e) { return null; } finally { clearTimeout(timer); }
}
async function fromCdn(id, cdn, got) {
  if (!got.r.ok) return null;
  self.postMessage({ id, total: cdn.bytes });
  const out = await body(id, got, cdn.bytes);
  if (!out || out.byteLength !== cdn.bytes) return null;
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', out)), (b) => b.toString(16).padStart(2, '0')).join('');
  return hash === cdn.sha256 ? out : null;
}
self.onmessage = async (ev) => {
  const { id, url, cdn, images: decode } = ev.data;
  const send = async (out, viaCdn) => {
    const images = decode ? await decodeImages(out.buffer, out.byteLength) : [];
    self.postMessage({ id, loaded: out.byteLength, buffer: out.buffer, images, ...(viaCdn ? { cdn: true } : {}) }, [out.buffer, ...images.map((x) => x[1])]);
  };
  try {
    const original = (signal) => fetch(url, { credentials: 'same-origin', signal });
    let got = null;
    if (cdn) {
      const fromEdge = Object.assign((signal) => fetch(cdn.url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal }), { cdn: true });
      got = await hedged(fromEdge, original).catch(() => null);
      if (got && got.cdn) { const verified = await fromCdn(id, cdn, got); if (verified) return await send(verified, true); got = null; }
    }
    for (let attempt = 0; ; attempt++) {
      if (!got) got = await hedged(original, original);
      const r = got.r;
      if (!r.ok) { self.postMessage({ id, error: 'HTTP ' + r.status, status: r.status }); return; }
      const enc = r.headers.get('content-encoding'), len = Number(r.headers.get('content-length'));
      self.postMessage({ id, total: !enc && Number.isFinite(len) && len > 0 ? len : null });
      const out = await body(id, got, Infinity);
      if (out) return await send(out, false);
      if (attempt) throw new Error('stalled for ' + STALL_MS / 1000 + ' s');
      got = null;
    }
  } catch (e) { self.postMessage({ id, error: String(e && e.message || e) }); }
};`;

type Job = { url: string; resolve: (b: ArrayBuffer) => void; reject: (e: Error) => void };
let worker: Worker | null | undefined;
const stats = { delivered: 0, images: 0, failed: false, cdn: 0 };   // probes (tools/speed)
if (typeof window !== 'undefined') (window as unknown as { __assetWorker?: unknown }).__assetWorker = stats;
const jobs = new Map<number, Job>();
let next = 1;
function start(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (OFF || typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof location === 'undefined') return (worker = null);
    const w = new Worker(URL.createObjectURL(new Blob([SRC], { type: 'text/javascript' })));
    w.onmessage = (ev: MessageEvent<{ id: number; total?: number | null; loaded?: number; buffer?: ArrayBuffer; images?: [number, ImageBitmap][]; error?: string; status?: number; cdn?: boolean }>) => {
      const m = ev.data, job = jobs.get(m.id); if (!job) return;
      if (m.error !== undefined) { jobs.delete(m.id); assetBytes.done(job.url, false); job.reject(Object.assign(new Error(`asset fetch failed: ${m.error} (${job.url})`), m.status ? { status: m.status } : {})); return; }
      if (m.total !== undefined) assetBytes.headers(job.url, m.total);
      if (m.loaded !== undefined) assetBytes.progress(job.url, m.loaded);
      if (m.buffer) { jobs.delete(m.id); assetBytes.done(job.url, true); stats.delivered++; if (m.cdn) stats.cdn++; stats.images += m.images?.length ?? 0; if (m.images?.length) decoded.set(m.buffer, new Map(m.images)); job.resolve(m.buffer); }
    };
    // a worker that cannot run (blocked blob: URLs) fails every pending job; later loads use FileLoader
    w.onerror = () => { worker = null; stats.failed = true; for (const [id, job] of jobs) { jobs.delete(id); assetBytes.done(job.url, false); job.reject(Object.assign(new Error(`asset worker unavailable (${job.url})`), { unavailable: true })); } };
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
export function fetchInWorker(url: string): Promise<ArrayBuffer> | null {
  const w = start(); if (!w) return null;
  const abs = new URL(url, location.href).href, id = next++;
  assetBytes.start(abs);
  // The CDN manifest decides first (it is loaded at boot, like the page transport waits for it); then the worker fetches.
  return new Promise<ArrayBuffer>((resolve, reject) => {
    jobs.set(id, { url: abs, resolve, reject });
    void cdnRoute(abs).catch(() => null).then((cdn: CdnRoute | null) => {
      if (!jobs.has(id)) return;   // the worker failed meanwhile and rejected this job as unavailable
      w.postMessage({ id, url: abs, ...(cdn ? { cdn } : {}), images: !NO_IMAGES });
    });
  });
}

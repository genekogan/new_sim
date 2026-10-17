// Phone arrival (lane d3): GLB bytes are downloaded in a worker. three's FileLoader pumps every response body through a
// main-thread ReadableStream, and the browser only buffers a little of each response, so while the page's main thread
// is in a long task (a phone builds the terrain and every thing's holder for ~2 s at arrival) the downloads stall and the
// arrival card waits for them afterwards. A worker drains them meanwhile; the main thread only parses the finished
// ArrayBuffer (GLTFLoader.parseAsync, same decoders). The byte bar (asset-bytes.ts) and the loader's LoadingManager
// (download counts) see the same start/progress/end as before. Without Worker/Blob support, or `?assetworker=0`, the
// caller keeps FileLoader.
import { assetBytes } from '../asset-bytes.ts';

const OFF = typeof location !== 'undefined' && new URLSearchParams(location.search).get('assetworker') === '0';
const SRC = `
self.onmessage = async (ev) => {
  const { id, url } = ev.data;
  try {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) { self.postMessage({ id, error: 'HTTP ' + r.status, status: r.status }); return; }
    const enc = r.headers.get('content-encoding'), len = Number(r.headers.get('content-length'));
    self.postMessage({ id, total: !enc && Number.isFinite(len) && len > 0 ? len : null });
    const reader = r.body.getReader(), parts = []; let loaded = 0, last = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); loaded += value.byteLength; const now = Date.now(); if (now - last > 100) { last = now; self.postMessage({ id, loaded }); } }
    const out = new Uint8Array(loaded); let o = 0; for (const p of parts) { out.set(p, o); o += p.byteLength; }
    self.postMessage({ id, loaded, buffer: out.buffer }, [out.buffer]);
  } catch (e) { self.postMessage({ id, error: String(e && e.message || e) }); }
};`;

type Job = { url: string; resolve: (b: ArrayBuffer) => void; reject: (e: Error) => void };
let worker: Worker | null | undefined;
const jobs = new Map<number, Job>();
let next = 1;
function start(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (OFF || typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof location === 'undefined') return (worker = null);
    const w = new Worker(URL.createObjectURL(new Blob([SRC], { type: 'text/javascript' })));
    w.onmessage = (ev: MessageEvent<{ id: number; total?: number | null; loaded?: number; buffer?: ArrayBuffer; error?: string; status?: number }>) => {
      const m = ev.data, job = jobs.get(m.id); if (!job) return;
      if (m.error !== undefined) { jobs.delete(m.id); assetBytes.done(job.url, false); job.reject(Object.assign(new Error(`asset fetch failed: ${m.error} (${job.url})`), m.status ? { status: m.status } : {})); return; }
      if (m.total !== undefined) assetBytes.headers(job.url, m.total);
      if (m.loaded !== undefined) assetBytes.progress(job.url, m.loaded);
      if (m.buffer) { jobs.delete(m.id); assetBytes.done(job.url, true); job.resolve(m.buffer); }
    };
    // a worker that cannot run (blocked blob: URLs) fails every pending job; later loads use FileLoader
    w.onerror = () => { worker = null; for (const [id, job] of jobs) { jobs.delete(id); assetBytes.done(job.url, false); job.reject(Object.assign(new Error(`asset worker unavailable (${job.url})`), { unavailable: true })); } };
    return (worker = w);
  } catch { return (worker = null); }
}

/** Start the worker early (the viewer's mount): its startup needs a main-thread turn, which a phone's arrival build
 *  would otherwise not give it until its downloads are already late. */
export function warmAssetWorker() { start(); }

/** The bytes of `url` (same origin), downloaded off the main thread; null when no worker is available. */
export function fetchInWorker(url: string): Promise<ArrayBuffer> | null {
  const w = start(); if (!w) return null;
  const abs = new URL(url, location.href).href, id = next++;
  assetBytes.start(abs);
  return new Promise<ArrayBuffer>((resolve, reject) => { jobs.set(id, { url: abs, resolve, reject }); w.postMessage({ id, url: abs }); });
}

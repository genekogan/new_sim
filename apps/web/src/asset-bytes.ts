// Byte-weighted loading progress (Gene, 2026-10-11: "the progress bar is useless because it's counted in number of
// files, not in actual MB"). Every asset the page fetches (GLB, textures, decoder wasm) is counted as its bytes stream
// in; the total is known up front from
//   - old worlds: a manifest of the arrival's assets with byte sizes, made at release time (src/initial-assets.json,
//     apps/web/scripts/initial-assets.mjs, loaded in main.tsx), and
//   - new worlds: the world snapshot's `assetBytes` (the server's asset index: every GLB the world's things load),
// and otherwise from each response's Content-Length as soon as its headers arrive.

type Row = { loaded: number; total: number | null; done: boolean };
/** `known`: a total was declared up front (manifest or snapshot); until then the sum covers only what has started. */
export type ByteProgress = { loaded: number; total: number; known: boolean };

const ASSET = /\.(glb|gltf|bin|ktx2|wasm|drc|hdr|exr|png|jpe?g|webp)$/i;
const keyOf = (url: string) => { try { return new URL(url, location.href).pathname; } catch { return url.split(/[?#]/)[0]; } };

export class ByteMeter {
  private expected = new Map<string, number>();
  private rows = new Map<string, Row>();
  private listeners = new Set<() => void>();
  private current: ByteProgress = { loaded: 0, total: 0, known: false };
  private queued = false;
  private declared = false;
  /** Sizes known before the download starts (manifest, server asset index). */
  expect(sizes: Readonly<Record<string, number>>) {
    this.declared = true;
    for (const [url, bytes] of Object.entries(sizes)) if (Number.isFinite(bytes) && bytes > 0) this.expected.set(keyOf(url), bytes);
    this.changed();
  }
  start(url: string) { const k = keyOf(url); if (!this.rows.has(k)) this.rows.set(k, { loaded: 0, total: null, done: false }); this.changed(); }
  headers(url: string, total: number | null) { const r = this.rows.get(keyOf(url)); if (r && total && total > 0) { r.total = total; this.changed(); } }
  progress(url: string, loaded: number) { const r = this.rows.get(keyOf(url)); if (r) { r.loaded = loaded; this.changed(); } }
  /** Finished (or failed): the bytes that arrived are the file's whole size. */
  done(url: string, ok: boolean) { const r = this.rows.get(keyOf(url)); if (!r) return; r.done = true; if (ok) r.total = Math.max(r.loaded, 1); this.changed(); }
  /** Bytes in and bytes expected over every asset this page has asked for or knows it will ask for. */
  snapshot(): ByteProgress { return this.current; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private compute(): ByteProgress {
    let loaded = 0, total = 0;
    for (const k of new Set([...this.expected.keys(), ...this.rows.keys()])) {
      const r = this.rows.get(k), size = r?.total ?? this.expected.get(k) ?? null;
      if (!size) continue;
      total += size; loaded += Math.min(r?.loaded ?? 0, size);
    }
    return { loaded, total, known: this.declared };
  }
  // at most ~10 updates a second: chunks arrive far more often than a bar can show them
  private changed() {
    if (this.queued) return; this.queued = true;
    setTimeout(() => { this.queued = false; this.current = this.compute(); for (const l of this.listeners) l(); }, 100);
  }
}
export const assetBytes = new ByteMeter();

async function count(body: ReadableStream<Uint8Array>, url: string) {
  const reader = body.getReader(); let loaded = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; loaded += value.byteLength; assetBytes.progress(url, loaded); } assetBytes.done(url, true); }
  catch { assetBytes.done(url, false); }
}

let installed = false;
/** Count the bytes of every asset fetch (three's loaders all use fetch). The caller's response is untouched; a clone
 *  of its body is read alongside it. */
export function installAssetMeter() {
  if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const url = request ? request.url : input instanceof URL ? input.href : String(input);
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    if (method !== 'GET' || !ASSET.test(keyOf(url))) return original(input, init);
    assetBytes.start(url);
    let response: Response;
    try { response = await original(input, init); } catch (e) { assetBytes.done(url, false); throw e; }
    // a compressed body streams more bytes than its Content-Length says: then only the expected size (if any) counts
    const length = Number(response.headers.get('content-length'));
    assetBytes.headers(url, response.headers.get('content-encoding') ? null : Number.isFinite(length) && length > 0 ? length : null);
    if (response.ok && response.body) { try { void count(response.clone().body!, url); } catch { assetBytes.done(url, false); } }
    else assetBytes.done(url, false);
    return response;
  };
}

/** "38 of 112 MB" (one decimal below 10 MB). */
export function megabytes({ loaded, total }: Pick<ByteProgress, 'loaded' | 'total'>): string {
  const mb = (b: number) => { const v = b / 1048576; return total / 1048576 < 10 ? v.toFixed(1) : String(Math.round(v)); };
  return `${mb(loaded)} of ${mb(total)} MB`;
}

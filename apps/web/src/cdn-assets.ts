// An optional transport for explicitly published public assets. Every world uses the same web entry point.
// Never infer a CDN URL from a filename: only the reviewed, hash-pinned publication manifest can opt a file in.
import { ImageLoader } from 'three';

export type CdnAsset = { key: string; sha256: string; bytes: number; licence: string };
/** `assets`: the shared CC0/own-work catalogue. `worlds`: world-scoped publications, keyed by the exact world page
 *  namespace (`/w/<slug>` or `/worlds/w/<slug>`); an entry there only applies on that world's own page. */
export type CdnManifest = { version: 1; assets: Record<string, CdnAsset>; worlds?: Record<string, Record<string, CdnAsset>> };
export type CdnProgress = (url: string, loaded: number, total: number) => void;
type Fetch = typeof fetch;
const FILE = /\.(glb|bin|ktx2|png|jpe?g|webp|avif|hdr|exr)$/i;
const IMAGE = /\.(png|jpe?g|webp|avif)$/i;
const LICENCES = new Set(['CC0-1.0', 'own-work']);
/** World-scoped art keeps its own rights; it is never CC0, never shared and never a hash alias for another world. */
const SCOPED = 'world-scoped';
const WORLD = /^(?:\/worlds)?\/w\/[a-z][a-z0-9-]{0,31}$/;
const ext = (path: string) => /\.([a-z0-9]+)$/i.exec(path.split('?')[0])?.[1].toLowerCase();
const validPath = (path: string) => path.startsWith('/') && !path.startsWith('//') && !/[#\\]/.test(path) && FILE.test(path.split('?')[0]);
const validEntry = (a: CdnAsset) => !!a && /^[a-f0-9]{64}$/.test(a.sha256) && Number.isSafeInteger(a.bytes) && a.bytes >= 1;

/** The world page namespace a page URL belongs to, e.g. `/w/mars` or `/worlds/w/mars`. */
export function pageWorld(pageUrl: string): string | undefined {
  try { return /^((?:\/worlds)?\/w\/[a-z][a-z0-9-]{0,31})(?:\/|$)/.exec(new URL(pageUrl).pathname)?.[1]; } catch { return; }
}

export function readCdnManifest(value: unknown): CdnManifest {
  if (!value || typeof value !== 'object' || (value as CdnManifest).version !== 1 ||
      !(value as CdnManifest).assets || typeof (value as CdnManifest).assets !== 'object' || Array.isArray((value as CdnManifest).assets)) throw Error('Invalid CDN manifest');
  const assets: Record<string, CdnAsset> = Object.create(null);
  for (const [path, a] of Object.entries((value as CdnManifest).assets)) {
    if (!validPath(path) || !validEntry(a) || !LICENCES.has(a.licence)) throw Error('Invalid CDN asset');
    const match = /^assets\/([a-f0-9]{2})\/([a-f0-9]{64})\.[a-z0-9]+$/.exec(a.key);
    if (!match || match[1] !== a.sha256.slice(0, 2) || match[2] !== a.sha256) throw Error('Invalid CDN key');
    const canonical = /^(?:\/worlds)?\/assets\/([a-f0-9]{64})\.[a-z0-9]+$/.exec(path);
    if (canonical && canonical[1] !== a.sha256) throw Error('Invalid CDN hash alias');
    assets[path] = a;
  }
  const worlds: Record<string, Record<string, CdnAsset>> = Object.create(null);
  const scoped = (value as CdnManifest).worlds;
  if (scoped !== undefined && (!scoped || typeof scoped !== 'object' || Array.isArray(scoped))) throw Error('Invalid CDN world scopes');
  for (const [world, entries] of Object.entries(scoped ?? {})) {
    if (!WORLD.test(world) || !entries || typeof entries !== 'object' || Array.isArray(entries)) throw Error('Invalid CDN world scope');
    worlds[world] = Object.create(null);
    for (const [path, a] of Object.entries(entries)) {
      // The key is bound to this world's own namespace and the requested file type, never to the shared catalogue.
      if (!validPath(path) || !validEntry(a) || a.licence !== SCOPED || a.key !== `assets${world}/${a.sha256}.${ext(path)}`) throw Error('Invalid world-scoped CDN asset');
      worlds[world][path] = a;
    }
  }
  return { version: 1, assets, ...(Object.keys(worlds).length ? { worlds } : {}) };
}

export function cdnOrigin(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      !(url.origin === 'https://assets.eden.art' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw Error('Invalid CDN origin');
  return url.origin;
}

export function manifestAsset(manifest: CdnManifest, input: string, pageUrl: string): CdnAsset | undefined {
  try {
    const url = new URL(input, pageUrl);
    if (url.origin !== new URL(pageUrl).origin || !FILE.test(url.pathname)) return;
    // World-scoped publications apply only on their own world's page, by exact path and version query.
    const world = pageWorld(pageUrl), scoped = world ? manifest.worlds?.[world]?.[url.pathname + url.search] : undefined;
    if (scoped) return scoped;
    // Query strings are version pins. Do not silently give a newly pinned request an older pathname's bytes.
    const direct = manifest.assets[url.pathname + url.search];
    if (direct || url.search) return direct;
    // Entity worlds serve stored bytes under their own slug. Only a reviewed immutable hash may share
    // the canonical /assets alias; this does not turn arbitrary world paths or uploads into public CDN URLs.
    const stored = /^(\/worlds)?\/w\/[a-z][a-z0-9-]{0,31}\/assets\/([a-f0-9]{64}\.[a-z0-9]+)$/.exec(url.pathname);
    return stored ? manifest.assets[(stored[1] ?? '') + '/assets/' + stored[2]] : undefined;
  } catch { return; }
}

/** `timeoutMs` bounds the wait for CDN headers and every stall in its body (no bytes for that long), so a large world
 *  file on a slow but moving connection is not abandoned halfway. `onProgress` reports verified-download progress
 *  under the original URL while the body is buffered for its hash check. */
export function cdnFetch(original: Fetch, manifest: CdnManifest, origin: string, pageUrl: string, timeoutMs = 12_000, onProgress?: CdnProgress): Fetch {
  const remote = cdnOrigin(origin);
  return async (input, init) => {
    const request = input instanceof Request ? input : null;
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    const url = request?.url ?? String(input);
    const headers = new Headers(init?.headers ?? request?.headers);
    const asset = method === 'GET' && !headers.has('range') ? manifestAsset(manifest, url, pageUrl) : undefined;
    if (!asset) return original(input, init);
    const callerSignal = init?.signal ?? request?.signal;
    const stall = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => stall.abort(new DOMException('CDN stalled', 'TimeoutError')), timeoutMs); };
    try {
      arm();
      const signal = callerSignal ? AbortSignal.any([callerSignal, stall.signal]) : stall.signal;
      // Never send an origin's auth headers, cookies or referrer to the public bucket.
      const response = await original(remote + '/' + asset.key, { method: 'GET', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal });
      if (!response.ok || !response.body) throw Error('CDN response failed');
      const reader = response.body.getReader();
      signal.addEventListener('abort', () => { void reader.cancel().catch(() => {}); }, { once: true });
      const bytes = new Uint8Array(asset.bytes);
      let loaded = 0;
      for (arm(); ; arm()) {
        const { done, value } = await reader.read();
        if (done) break;
        if (loaded + value.byteLength > asset.bytes) throw Error('CDN length mismatch');
        bytes.set(value, loaded); loaded += value.byteLength;
        onProgress?.(url, loaded, asset.bytes);
      }
      callerSignal?.throwIfAborted();
      if (loaded !== asset.bytes || stall.signal.aborted) throw Error('CDN length mismatch');
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
      if (hash !== asset.sha256) throw Error('CDN hash mismatch');
      callerSignal?.throwIfAborted();
      const outHeaders = new Headers(response.headers);
      outHeaders.delete('content-encoding'); // fetch already decoded the transfer encoding
      outHeaders.set('content-length', String(bytes.byteLength));
      return new Response(bytes, { status: 200, headers: outHeaders });
    } catch (error) {
      if (callerSignal?.aborted) throw error;
      // The caller's exact request survives HTTP/CORS/network/timeout/integrity errors.
      return original(input, init);
    } finally { clearTimeout(timer); }
  };
}

/** ImageLoader uses <img> rather than fetch. Keep standalone textures on the same verified transport too. */
function installCdnImages(manifest: CdnManifest) {
  const load = ImageLoader.prototype.load;
  ImageLoader.prototype.load = function (url, onLoad, onProgress, onError) {
    const path = this.manager.resolveURL((this.path ?? '') + url);
    if (!IMAGE.test(new URL(path, location.href).pathname) || !manifestAsset(manifest, path, location.href)) return load.call(this, url, onLoad, onProgress, onError);
    const image = document.createElementNS('http://www.w3.org/1999/xhtml', 'img') as HTMLImageElement;
    let objectUrl: string | undefined, originRetry = false;
    const cleanup = () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
    const terminal = () => { cleanup(); image.onload = null; image.onerror = null; };
    const fail = (error: unknown) => { terminal(); try { onError?.(error); } finally { this.manager.itemError(path); this.manager.itemEnd(path); } };
    image.onload = () => { terminal(); try { onLoad?.(image); } finally { this.manager.itemEnd(path); } };
    image.onerror = error => {
      cleanup();
      if (!originRetry) { originRetry = true; image.crossOrigin = this.crossOrigin; image.src = path; }
      else fail(error);
    };
    this.manager.itemStart(path);
    void fetch(path).then(async response => {
      if (!response.ok) throw Error('Texture response failed');
      objectUrl = URL.createObjectURL(await response.blob());
      image.src = objectUrl;
    }).catch(fail);
    return image;
  };
}

declare const __SIM_ASSETS_CDN_ENABLED__: boolean;
declare const __SIM_ASSETS_CDN_ORIGIN__: string;
/** Fail open to today's origin transport, including a missing or invalid publication manifest.
 *  Lane W1: installed at once (the page no longer waits for the manifest GET before it starts); only asset-file
 *  fetches wait for the manifest, everything else goes straight to the original fetch. */
export function installCdnAssets(manifestPath: string, onProgress?: CdnProgress): void {
  if (typeof __SIM_ASSETS_CDN_ENABLED__ === 'undefined' || !__SIM_ASSETS_CDN_ENABLED__) return;
  const original = window.fetch.bind(window);
  const transport: Promise<Fetch | null> = original(manifestPath, { signal: AbortSignal.timeout(3000) }).then(async (response) => {
    if (!response.ok) return null;
    const manifest = readCdnManifest(await response.json());
    installCdnImages(manifest);
    return cdnFetch(original, manifest, __SIM_ASSETS_CDN_ORIGIN__, location.href, undefined, onProgress);
  }).catch(() => null);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    let path = '';
    try { path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href).pathname; } catch { /* not a URL: origin */ }
    if (!FILE.test(path)) return original(input, init);
    return transport.then((t) => (t ?? original)(input, init));
  }) as Fetch;
}

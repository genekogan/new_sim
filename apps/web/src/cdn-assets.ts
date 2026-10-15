// An optional transport for explicitly published public assets. Every world uses the same web entry point.
// Never infer a CDN URL from a filename: only the reviewed, hash-pinned publication manifest can opt a file in.
import { ImageLoader } from 'three';

export type CdnAsset = { key: string; sha256: string; bytes: number; licence: string };
export type CdnManifest = { version: 1; assets: Record<string, CdnAsset> };
type Fetch = typeof fetch;
const FILE = /\.(glb|bin|ktx2|png|jpe?g|webp|avif|hdr|exr)$/i;
const IMAGE = /\.(png|jpe?g|webp|avif)$/i;
const LICENCES = new Set(['CC0-1.0', 'own-work']);

export function readCdnManifest(value: unknown): CdnManifest {
  if (!value || typeof value !== 'object' || (value as CdnManifest).version !== 1 ||
      !(value as CdnManifest).assets || typeof (value as CdnManifest).assets !== 'object' || Array.isArray((value as CdnManifest).assets)) throw Error('Invalid CDN manifest');
  const assets: Record<string, CdnAsset> = Object.create(null);
  for (const [path, a] of Object.entries((value as CdnManifest).assets)) {
    if (!path.startsWith('/') || path.startsWith('//') || /[#\\]/.test(path) || !FILE.test(path.split('?')[0]) ||
        !a || !/^[a-f0-9]{64}$/.test(a.sha256) || !Number.isSafeInteger(a.bytes) || a.bytes < 1 || !LICENCES.has(a.licence)) throw Error('Invalid CDN asset');
    const match = /^assets\/([a-f0-9]{2})\/([a-f0-9]{64})\.[a-z0-9]+$/.exec(a.key);
    if (!match || match[1] !== a.sha256.slice(0, 2) || match[2] !== a.sha256) throw Error('Invalid CDN key');
    const canonical = /^(?:\/worlds)?\/assets\/([a-f0-9]{64})\.[a-z0-9]+$/.exec(path);
    if (canonical && canonical[1] !== a.sha256) throw Error('Invalid CDN hash alias');
    assets[path] = a;
  }
  return { version: 1, assets };
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
    // Query strings are version pins. Do not silently give a newly pinned request an older pathname's bytes.
    const direct = manifest.assets[url.pathname + url.search];
    if (direct || url.search) return direct;
    // Entity worlds serve stored bytes under their own slug. Only a reviewed immutable hash may share
    // the canonical /assets alias; this does not turn arbitrary world paths or uploads into public CDN URLs.
    const stored = /^(\/worlds)?\/w\/[a-z][a-z0-9-]{0,31}\/assets\/([a-f0-9]{64}\.[a-z0-9]+)$/.exec(url.pathname);
    return stored ? manifest.assets[(stored[1] ?? '') + '/assets/' + stored[2]] : undefined;
  } catch { return; }
}

export function cdnFetch(original: Fetch, manifest: CdnManifest, origin: string, pageUrl: string, timeoutMs = 12_000): Fetch {
  const remote = cdnOrigin(origin);
  return async (input, init) => {
    const request = input instanceof Request ? input : null;
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    const url = request?.url ?? String(input);
    const headers = new Headers(init?.headers ?? request?.headers);
    const asset = method === 'GET' && !headers.has('range') ? manifestAsset(manifest, url, pageUrl) : undefined;
    if (!asset) return original(input, init);
    const callerSignal = init?.signal ?? request?.signal;
    try {
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
      // Never send an origin's auth headers, cookies or referrer to the public bucket.
      const response = await original(remote + '/' + asset.key, { method: 'GET', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal });
      if (!response.ok) throw Error('CDN response failed');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== asset.bytes) throw Error('CDN length mismatch');
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
    }
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
/** Fail open to today's origin transport, including a missing or invalid publication manifest. */
export async function installCdnAssets(manifestPath: string): Promise<void> {
  if (typeof __SIM_ASSETS_CDN_ENABLED__ === 'undefined' || !__SIM_ASSETS_CDN_ENABLED__) return;
  try {
    const original = window.fetch.bind(window);
    const response = await original(manifestPath, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return;
    const manifest = readCdnManifest(await response.json());
    const transport = cdnFetch(original, manifest, __SIM_ASSETS_CDN_ORIGIN__, location.href);
    window.fetch = transport;
    installCdnImages(manifest);
  } catch { /* origin remains available even when manifest/configuration is broken */ }
}

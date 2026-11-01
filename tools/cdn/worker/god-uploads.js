// god-uploads.js — Cloudflare Worker (module syntax) on the route assets.eden.art/w/* (lane CDN4, 2026-10-20).
//
// Pull-through CDN for god uploads (POST /v1/god/assets). It serves exactly one URL shape:
//
//   https://assets.eden.art/w/<slug>/assets/<sha256>.<ext>      ext = glb | png | jpg | json (what the server accepts)
//
// and nothing else under /w/ (400). The R2 key mirrors the path, `w/<slug>/assets/<sha256>.<ext>`, a top-level prefix no
// publisher uses (CDN1-3 keys all start with `assets/`), so it cannot overwrite or shadow any published object.
//
//   R2 hit  -> the stored object: immutable cache, Content-Type by extension, CORS for the requesting allowed site, ETag "<sha>",
//              Content-Encoding br when the object was stored precompressed; also kept in the edge cache (Cache API).
//   R2 miss -> GET https://souls.game/w/<slug>/assets/<sha>.<ext> (old slugs resolve through launcher aliases). The body is read as a
//              stream, counted against MAX_BYTES and hashed; only bytes whose SHA-256 equals the sha in the path are
//              returned (200) and stored, so the bucket cannot be poisoned. Mismatch -> 502, origin 404 -> 404, any other
//              origin status or a redirect -> 502, too large -> 502; none of these is stored or cached (no-store). The R2 write is
//              awaited before the 200, so `x-eden-cdn: miss` means stored; a failed write answers `miss-unstored` and logs.
//
// Cloudflare may compress the Worker's uncompressed answers on the way out (seen live: GLB misses sent as
// Content-Encoding br with ETag W/"<sha>"). That is left on: it is transport only, browsers and fetch decode it, and the
// client's checks (byte count and SHA-256 of the decoded body, cdn-assets.ts) run on what the loaders get.
//
// The Worker holds no secrets: R2 is an object binding (env.ASSETS, bucket eden-assets). Deployment: README.md here.
// Tests: god-uploads.test.mjs (fake R2, fake origin, fake edge cache). Post-deploy proof: verify-worker.mjs.

export const APP_ORIGIN = 'https://sim.eden.art';
export const APP_ORIGINS = [APP_ORIGIN, 'https://souls.game', 'https://soul.game'];
export const ORIGIN = 'https://souls.game';
/** God uploads are budgeted at 3 MB by default (creation limits); a world can raise its budget. 32 MiB bounds memory. */
export const MAX_BYTES = 32 * 1024 * 1024;
export const IMMUTABLE = 'public, max-age=31536000, immutable';
export const TYPES = { glb: 'model/gltf-binary', png: 'image/png', jpg: 'image/jpeg', json: 'application/json' };
const PATH = /^\/w\/([a-z][a-z0-9-]{0,31})\/assets\/([0-9a-f]{64})\.(glb|png|jpg|json)$/;

/** The one accepted path, or null. Slug: the server's world slug shape; sha: 64 lowercase hex; ext: the upload formats. */
export function parsePath(pathname) {
  const m = PATH.exec(pathname);
  return m ? { slug: m[1], sha: m[2], ext: m[3], key: `w/${m[1]}/assets/${m[2]}.${m[3]}` } : null;
}

// Cached bytes are shared; caller-specific CORS is applied after every response, including old edge entries.
function refuse(status, reason, method) {
  return new Response(method === 'HEAD' ? null : JSON.stringify({ error: reason }) + '\n', { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-eden-cdn': `refused:${reason}` } });
}
function objectHeaders(p, obj, state) {
  const h = new Headers({ 'content-type': obj?.httpMetadata?.contentType || TYPES[p.ext], 'cache-control': IMMUTABLE, etag: `"${p.sha}"`, 'x-eden-cdn': state });
  const enc = obj?.httpMetadata?.contentEncoding;
  if (enc) h.set('content-encoding', enc); else if (obj && Number.isSafeInteger(obj.size)) h.set('content-length', String(obj.size));
  return h;
}
/** Failures the client never sees (it gets verified bytes either way) go to the Worker's logs: dashboard > Logs. */
function logError(what, p, e) { console.error(`god-uploads: ${what} failed for ${p.key}: ${e?.stack ?? e?.message ?? e}`); }
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const notModified = (request, p) => (request.headers.get('if-none-match') ?? '').split(',').some((t) => t.trim().replace(/^W\//, '') === `"${p.sha}"`);

/** Read a body to its end, refusing more than `max` bytes (stops reading at once). */
async function readCapped(body, max) {
  const reader = body.getReader(), parts = []; let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { await reader.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  const out = new Uint8Array(n); let o = 0;
  for (const part of parts) { out.set(part, o); o += part.byteLength; }
  return out;
}

/**
 * The handler. `deps` exists for the local tests: `fetch` (the origin), `caches` (the edge cache; absent = none),
 * `subtle` (Web Crypto), `origin` (a loopback stand-in for souls.game). In Cloudflare these are the runtime's own.
 */
async function respond(request, env, ctx, deps = {}) {
  const originFetch = deps.fetch ?? globalThis.fetch.bind(globalThis);
  const edge = 'caches' in deps ? deps.caches : globalThis.caches?.default;
  const subtle = deps.subtle ?? globalThis.crypto.subtle;
  const origin = deps.origin ?? ORIGIN;   // tests and the local stand-in only
  const method = request.method.toUpperCase();
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-methods': 'GET, HEAD', 'access-control-allow-headers': '*', 'access-control-max-age': '86400' } });
  if (method !== 'GET' && method !== 'HEAD') return refuse(405, 'method', method);
  const url = new URL(request.url);
  const p = url.search ? null : parsePath(url.pathname);
  if (!p) return refuse(400, 'path', method);
  if (!env?.ASSETS) return refuse(500, 'binding', method);
  if (notModified(request, p)) return new Response(null, { status: 304, headers: { etag: `"${p.sha}"`, 'cache-control': IMMUTABLE } });

  const cacheKey = new Request(`https://assets.eden.art/${p.key}`, { method: 'GET' });
  if (method === 'GET' && edge) {
    const cached = await edge.match(cacheKey).catch(() => undefined);
    if (cached) { const r = new Response(cached.body, cached); r.headers.set('x-eden-cdn', 'edge'); return r; }
  }

  if (method === 'HEAD') {
    const head = await env.ASSETS.head(p.key);
    return head && head.customMetadata?.sha256 === p.sha ? new Response(null, { status: 200, headers: objectHeaders(p, head, 'hit') }) : refuse(404, 'absent', method);
  }

  const obj = await env.ASSETS.get(p.key);
  if (obj && obj.customMetadata?.sha256 === p.sha) {
    const headers = objectHeaders(p, obj, 'hit');
    if (headers.has('content-encoding')) return new Response(obj.body, { status: 200, headers, encodeBody: 'manual' });
    const bytes = new Uint8Array(await obj.arrayBuffer());
    if (edge) ctx?.waitUntil?.(edge.put(cacheKey, new Response(bytes, { headers })).catch((e) => logError('edge cache put', p, e)));
    return new Response(bytes, { status: 200, headers });
  }
  if (obj) await obj.arrayBuffer().catch(() => {});   // a stray object without our metadata is never served; re-pulled below

  // Miss: pull from the god world's own route, verify, store.
  const source = `${origin}/w/${p.slug}/assets/${p.sha}.${p.ext}`;
  let res;
  try { res = await originFetch(source, { method: 'GET', redirect: 'manual', headers: { accept: '*/*', 'user-agent': 'eden-assets-pull/1 (god-uploads worker)' } }); }
  catch { return refuse(502, 'origin-unreachable', method); }
  if (res.status !== 200 || !res.body) { await res.body?.cancel().catch(() => {}); return refuse(res.status === 404 ? 404 : 502, `origin-${res.status}`, method); }
  const declared = Number(res.headers.get('content-length'));
  if (!res.headers.get('content-encoding') && Number.isFinite(declared) && declared > MAX_BYTES) { await res.body.cancel().catch(() => {}); return refuse(502, 'too-large', method); }
  let bytes;
  try { bytes = await readCapped(res.body, MAX_BYTES); } catch { return refuse(502, 'origin-body', method); }
  if (!bytes) return refuse(502, 'too-large', method);
  if (!bytes.byteLength) return refuse(502, 'empty', method);
  if (hex(await subtle.digest('SHA-256', bytes)) !== p.sha) return refuse(502, 'sha-mismatch', method);

  // The R2 write is awaited before answering: a put left in waitUntil was still in flight when the live HEAD came
  // (2026-10-20, 404 absent; the object landed seconds later), and its errors were swallowed. One upload's write latency
  // on the first request is the price of "200 miss" meaning "stored". A failed write still answers the verified bytes,
  // marked `miss-unstored`, and is logged (dashboard Logs); the next request pulls again.
  const meta = { contentType: TYPES[p.ext], cacheControl: IMMUTABLE };
  let state = 'miss';
  try { await env.ASSETS.put(p.key, bytes, { httpMetadata: meta, sha256: p.sha, customMetadata: { sha256: p.sha, bytes: String(bytes.byteLength), world: p.slug, licence: 'god-upload', source } }); }
  catch (e) { state = 'miss-unstored'; logError('R2 put', p, e); }
  const headers = objectHeaders(p, { httpMetadata: meta, size: bytes.byteLength }, state);
  if (edge) ctx?.waitUntil?.(edge.put(cacheKey, new Response(bytes, { headers: { ...Object.fromEntries(headers), 'x-eden-cdn': 'hit' } })).catch((e) => logError('edge cache put', p, e)));
  return new Response(bytes, { status: 200, headers });
}

export async function handle(request, env, ctx, deps = {}) {
  const response = await respond(request, env, ctx, deps);
  // Mutate our response rather than reconstruct it: precompressed R2 responses retain encodeBody: manual.
  for (const name of ['access-control-allow-origin', 'timing-allow-origin', 'access-control-expose-headers']) response.headers.delete(name);
  const origin = request.headers.get('origin');
  if (APP_ORIGINS.includes(origin)) {
    response.headers.set('access-control-allow-origin', origin);
    response.headers.set('timing-allow-origin', origin);
    response.headers.set('access-control-expose-headers', 'x-eden-cdn, etag');
  }
  const vary = response.headers.get('vary');
  if (!vary?.split(',').some((part) => part.trim().toLowerCase() === 'origin')) response.headers.set('vary', vary ? `${vary}, Origin` : 'Origin');
  return response;
}

export default { fetch: (request, env, ctx) => handle(request, env, ctx) };

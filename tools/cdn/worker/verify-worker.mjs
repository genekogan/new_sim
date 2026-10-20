#!/usr/bin/env node
// verify-worker.mjs — post-deploy proof of the god-uploads Worker on assets.eden.art/w/* (lane CDN4, 2026-10-20).
//
//   node tools/cdn/worker/verify-worker.mjs --god <team>/runtime/t4-bench/bench-hamlet --out <receipt.json>
//   node tools/cdn/worker/verify-worker.mjs --self-test [--out <receipt.json>]   (loopback stand-ins, no network)
//
// With --god it uploads ONE fresh, never-seen GLB (a single triangle with random vertices, so its sha is new) to that
// scratch god world with the folder's own god session (the session file is read by path and never printed), then:
//   1. origin   GET <world>/assets/<sha>.glb is 200 and hashes to <sha>;
//   2. absent   HEAD https://assets.eden.art/w/<slug>/assets/<sha>.glb is 404 (HEAD never pulls);
//   3. miss     GET  same URL: 200, x-eden-cdn miss, immutable, model/gltf-binary, CORS sim.eden.art, body hashes to <sha>;
//   4. stored   GET  again (up to 10 s for the R2 write): x-eden-cdn hit or edge, same bytes; HEAD 200 hit;
//   5. refusals a malformed path is 400, an unknown sha is 404, a core sha whose origin route sends a rendition (a body
//               that does not hash to the URL's sha) is 502 sha-mismatch twice (never stored), a query is 400;
//   6. no collision: a published core key (assets/...) still answers 200 from R2, not from the Worker.
// Exit 0 and "result":"PASS" only when every check passes. The upload is not placed or defined (no world edit).
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../../..');
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const APP = 'https://sim.eden.art';

/** A minimal valid GLB: one triangle, random vertices (a fresh sha every run), about 1 m tall. */
export function triangleGlb() {
  const r = randomBytes(12), j = (i) => (r.readUInt16LE(i) / 65535) * 0.2;
  const pos = new Float32Array([0, 0, 0, 1 + j(0), 0, j(2), j(4), 1 + j(6), j(8)]);
  const min = [0, 1, 2].map((k) => Math.min(pos[k], pos[3 + k], pos[6 + k])), max = [0, 1, 2].map((k) => Math.max(pos[k], pos[3 + k], pos[6 + k]));
  const json = { asset: { version: '2.0', generator: 'cdn4 verify-worker' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min, max }] };
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const bin = Buffer.from(pos.buffer);
  const out = Buffer.alloc(12 + 8 + js.length + 8 + bin.length);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(js.length, 12); out.writeUInt32LE(0x4e4f534a, 16); js.copy(out, 20);
  out.writeUInt32LE(bin.length, 20 + js.length); out.writeUInt32LE(0x004e4942, 24 + js.length); bin.copy(out, 28 + js.length);
  return out;
}

/** The god session in a god folder: { world, token }. Read by path; never logged. */
function session(dir) {
  const s = JSON.parse(readFileSync(join(dir, '.eden-god.json'), 'utf8'));
  if (typeof s.world !== 'string' || typeof s.token !== 'string') throw Error(`${dir}/.eden-god.json has no world session`);
  return { world: s.world.replace(/\/?$/, '/'), token: s.token };
}

/** A core hash alias whose origin route sends a rendition: the bytes never hash to the URL's sha (a live mismatch). */
function renditionSha() {
  const m = JSON.parse(readFileSync(join(root, 'apps/web/src/cdn-manifest.json'), 'utf8'));
  return Object.entries(m.assets).find(([p, a]) => a.of && /^\/assets\/[0-9a-f]{64}\.glb$/.test(p))?.[1].of ?? null;
}
function coreKey() {
  const m = JSON.parse(readFileSync(join(root, 'apps/web/src/cdn-manifest.json'), 'utf8'));
  return Object.values(m.assets).find((a) => /^assets\/[0-9a-f]{2}\//.test(a.key) && a.bytes < 200_000)?.key ?? null;
}

export async function verify({ cdn, world, token, slug, fetch: f = fetch, settleMs = 10_000 }) {
  const checks = [], note = (name, ok, detail = {}) => { checks.push({ name, ok: !!ok, ...detail }); return !!ok; };
  const get = async (url, init = {}) => {
    const r = await f(url, { ...init, headers: { origin: APP, ...(init.headers ?? {}) } });
    const body = init.method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await r.arrayBuffer());
    const h = Object.fromEntries(['x-eden-cdn', 'cache-control', 'content-type', 'access-control-allow-origin', 'content-encoding', 'etag', 'cf-cache-status'].map((k) => [k, r.headers.get(k)]));
    return { status: r.status, h, bytes: body.length, sha: body.length ? sha(body) : null };
  };
  // 0. a fresh upload (or the given sha)
  const glb = triangleGlb();
  const up = await f(`${world}v1/god/assets?name=${encodeURIComponent(`cdn4-verify-${Date.now()}`)}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'model/gltf-binary' }, body: glb });
  const upBody = await up.json().catch(() => ({}));
  const asset = upBody?.asset;
  if (!note('upload', up.status === 200 && /^[0-9a-f]{64}$/.test(asset?.sha ?? '') && asset.ext === 'glb', { status: up.status, sha: asset?.sha, bytes: asset?.bytes, error: upBody?.error?.code ?? upBody?.error })) return { checks };
  const s = asset.sha, url = `${cdn}/w/${slug}/assets/${s}.glb`;
  // 1. origin
  const o = await get(`${world}assets/${s}.glb`);
  note('origin serves the upload', o.status === 200 && o.sha === s, { status: o.status, bytes: o.bytes });
  // 2. absent (HEAD never pulls)
  const h0 = await get(url, { method: 'HEAD' });
  note('HEAD before any GET: 404 (no pull)', h0.status === 404, { status: h0.status, worker: h0.h['x-eden-cdn'] });
  // 3. miss
  const m = await get(url, { headers: { 'accept-encoding': 'br' } });
  note('miss: pulled, verified, returned', m.status === 200 && m.h['x-eden-cdn'] === 'miss' && m.sha === s && m.bytes === asset.bytes &&
    m.h['cache-control'] === 'public, max-age=31536000, immutable' && m.h['content-type'] === 'model/gltf-binary' && m.h['access-control-allow-origin'] === APP && m.h.etag === `"${s}"`, { status: m.status, ...m.h, bytes: m.bytes });
  // 4. stored: hit (R2) or edge (cache) within settleMs
  let hit, t0 = Date.now();
  do { hit = await get(url, { headers: { 'accept-encoding': 'br' } }); if (hit.h['x-eden-cdn'] !== 'miss') break; await new Promise((r) => setTimeout(r, 1000)); } while (Date.now() - t0 < settleMs);
  note('second GET: from R2 or the edge cache, same bytes', hit.status === 200 && ['hit', 'edge'].includes(hit.h['x-eden-cdn']) && hit.sha === s && hit.h['access-control-allow-origin'] === APP, { status: hit.status, ...hit.h, waitedMs: Date.now() - t0 });
  const h1 = await get(url, { method: 'HEAD' });
  note('HEAD after: 200 hit', h1.status === 200 && h1.h['x-eden-cdn'] === 'hit', { status: h1.status, worker: h1.h['x-eden-cdn'] });
  const plain = await get(url, { headers: { 'accept-encoding': 'identity' } });
  note('identity client gets the same decoded bytes', plain.status === 200 && plain.sha === s, { status: plain.status, encoding: plain.h['content-encoding'] });
  // 5. refusals
  const bad = await get(`${cdn}/w/${slug}/assets/${s}.exe`);
  note('malformed path: 400', bad.status === 400 && bad.h['cache-control'] === 'no-store', { status: bad.status, worker: bad.h['x-eden-cdn'] });
  const q = await get(`${url}?v=1`);
  note('query: 400', q.status === 400, { status: q.status });
  const unknown = await get(`${cdn}/w/${slug}/assets/${sha(randomBytes(32))}.glb`);
  note('unknown sha: 404, no-store', unknown.status === 404 && unknown.h['cache-control'] === 'no-store', { status: unknown.status, worker: unknown.h['x-eden-cdn'] });
  const ren = renditionSha();
  if (ren) for (const n of [1, 2]) {
    const x = await get(`${cdn}/w/${slug}/assets/${ren}.glb`);
    note(`origin bytes that do not hash to the URL sha: 502 sha-mismatch (${n})`, x.status === 502 && x.h['x-eden-cdn'] === 'refused:sha-mismatch', { sha: ren, status: x.status, worker: x.h['x-eden-cdn'] });
  }
  // 6. the published core objects are untouched by the route
  const key = coreKey();
  if (key) { const c = await get(`${cdn}/${key}`); note('core object (assets/...) still served, not by the Worker', c.status === 200 && !c.h['x-eden-cdn'], { key, status: c.status }); }
  return { sha: s, bytes: asset.bytes, url, checks };
}

/** Loopback stand-ins: a god world (upload + /assets route, a rendition-style mismatch) and the Worker with an in-memory R2. */
async function selfTest() {
  const { handle } = await import('./god-uploads.js');
  const store = new Map(), r2 = new Map();
  const ren = renditionSha(), key = coreKey();
  const listen = (fn) => new Promise((ok) => { const srv = createServer(fn); srv.listen(0, '127.0.0.1', () => ok(srv)); });
  const world = await listen(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (req.method === 'POST' && u.pathname === '/worlds/w/bench-hamlet/v1/god/assets') {
      if (req.headers.authorization !== 'Bearer self-test') { res.writeHead(401).end(); return; }
      const parts = []; for await (const c of req) parts.push(c); const b = Buffer.concat(parts), s = sha(b);
      store.set(s, b); res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, asset: { sha: s, ext: 'glb', bytes: b.length } })); return;
    }
    const m = /^\/worlds\/w\/bench-hamlet\/assets\/([0-9a-f]{64})\.glb$/.exec(u.pathname);
    if (m && store.has(m[1])) { res.writeHead(200, { 'content-type': 'model/gltf-binary' }).end(store.get(m[1])); return; }
    if (m && m[1] === ren) { res.writeHead(200, { 'content-type': 'model/gltf-binary' }).end(Buffer.from('a smaller rendition')); return; }
    res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not-found"}');
  });
  const wport = world.address().port;
  const env = { ASSETS: {
    head: async (k) => (r2.get(k) ? { size: r2.get(k).bytes.length, httpMetadata: r2.get(k).httpMetadata, customMetadata: r2.get(k).customMetadata } : null),
    get: async (k) => { const o = r2.get(k); return o ? { size: o.bytes.length, httpMetadata: o.httpMetadata, customMetadata: o.customMetadata, body: new Response(o.bytes).body, arrayBuffer: async () => Uint8Array.from(o.bytes).buffer } : null; },
    put: async (k, bytes, opts) => { if (sha(bytes) !== opts.sha256) throw Error('sha256'); r2.set(k, { bytes: Buffer.from(bytes), httpMetadata: opts.httpMetadata, customMetadata: opts.customMetadata }); },
  } };
  const coreBytes = Buffer.from('a published core object');
  const worker = await listen(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (!u.pathname.startsWith('/w/')) {   // the R2 custom domain itself (no Worker on this path)
      if (u.pathname === `/${key}`) res.writeHead(200, { 'content-type': 'model/gltf-binary' }).end(coreBytes); else res.writeHead(404).end();
      return;
    }
    const waits = [];
    const r = await handle(new Request(`https://assets.eden.art${req.url}`, { method: req.method, headers: req.headers }), env, { waitUntil: (p) => waits.push(p) }, { origin: `http://127.0.0.1:${wport}`, caches: null });
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(req.method === 'HEAD' ? undefined : Buffer.from(await r.arrayBuffer()));
    await Promise.all(waits);
  });
  try {
    return await verify({ cdn: `http://127.0.0.1:${worker.address().port}`, world: `http://127.0.0.1:${wport}/worlds/w/bench-hamlet/`, token: 'self-test', slug: 'bench-hamlet', settleMs: 3000 });
  } finally { world.close(); worker.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = opt('out');
  let result;
  if (args.includes('--self-test')) result = { mode: 'self-test (loopback stand-ins)', ...(await selfTest()) };
  else {
    const dir = opt('god'); if (!dir) throw Error('usage: verify-worker.mjs --god <god folder> [--out receipt.json] [--cdn https://assets.eden.art] | --self-test');
    const { world, token } = session(resolve(dir));
    const slug = /\/worlds\/w\/([a-z][a-z0-9-]{0,31})\/$/.exec(new URL(world).pathname)?.[1];
    if (!slug || new URL(world).origin !== APP) throw Error(`the god folder's world is not a ${APP}/worlds/w/<slug> world`);
    result = { mode: 'live', world, at: new Date().toISOString(), ...(await verify({ cdn: opt('cdn', 'https://assets.eden.art'), world, token, slug })) };
  }
  const failed = result.checks.filter((c) => !c.ok);
  const receipt = { result: failed.length ? 'FAIL' : 'PASS', failed: failed.map((c) => c.name), ...result };
  if (out) { mkdirSync(dirname(resolve(out)), { recursive: true }); writeFileSync(out, JSON.stringify(receipt, null, 1) + '\n'); }
  for (const c of result.checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}`);
  console.log(JSON.stringify({ result: receipt.result, sha: result.sha, url: result.url, failed: receipt.failed, ...(out ? { out } : {}) }));
  if (failed.length) process.exitCode = 1;
}

#!/usr/bin/env node
// L5 e2e: the asset store and the catalog, end to end, as a god agent would use them.
//
//   node tools/god-skill/e2e/assets.mjs [--port 4999] [--keep]
//
// Starts its own world on a fresh DATA_DIR (and a fresh ASSET_DIR) and:
//  A1 searches the library (duck, pup, kitty, lighthouse, boat, oak) and checks the first hits;
//  A2 builds a GLB from nothing (a crate, @gltf-transform), imports it with a height, defines and places it;
//  A3 imports a Draco+WebP ceramic head (a Little Martians Soul's scan) scaled to 1.2 m and places it;
//  A4 is refused an over-budget texture and a non-model file;
//  A5 places five pack animals, the Ceramic Tower (a bench in its second room) and the six kin;
//  A6 photographs the scene and checks the page drew the GLBs (no placeholder boxes);
//  A7 renders and stores a thumbnail, then reads it back.
// Writes .lane/e2e/assets-<stamp>/report.json and screenshots.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const port = Number(args.port ?? 4999), slug = 'assets-e2e';
const out = resolve(root, '.lane/e2e', `assets-${stamp}`); mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${port}/w/${slug}`;
const report = { port, startedAt: new Date().toISOString(), steps: [], shots: [], failures: [] };
const log = (...a) => console.log(...a);
const now = () => performance.now();

// ---------- world
const marsWeb = resolve(root, '.lane/mars-web');
const server = spawn('node', ['apps/server/src/main.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), WORLD_KEY: slug, WORLD_ID: `${slug}-1`, ENGINE: 'mars', PORT: String(port), DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', DATA_DIR: resolve(out, 'data'), ASSET_DIR: resolve(out, 'assets'), PUBLIC_URL: `http://127.0.0.1:${port}` } });
let serverLog = ''; server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
process.on('exit', () => { if (!args.keep) try { server.kill(); } catch { /* gone */ } });
for (let i = 0; i < 600; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* booting */ } await new Promise((r) => setTimeout(r, 100)); }

let token = '';
async function api(path, { method, body, raw, headers = {} } = {}) {
  const h = { authorization: `Bearer ${token || 'dev:admin'}`, ...headers };
  if (body && !(body instanceof FormData)) h['content-type'] = 'application/json';
  const r = await fetch(base + path, { method: method ?? (body || raw ? 'POST' : 'GET'), headers: h, body: raw ?? (body instanceof FormData ? body : body ? JSON.stringify(body) : undefined) });
  const buf = new Uint8Array(await r.arrayBuffer()); let data = null; try { data = JSON.parse(new TextDecoder().decode(buf)); } catch { /* binary */ }
  return { status: r.status, data, headers: r.headers, bytes: buf };
}
async function step(name, fn, expect) {
  const t0 = now(); let result, error;
  try { result = await fn(); } catch (e) { error = String(e?.stack ?? e); }
  const ms = now() - t0, okay = !error && (expect ? !!expect(result) : true);
  const brief = result && typeof result === 'object' ? JSON.stringify(result.data ?? result, (k, v) => (k === 'defs' && Array.isArray(v) ? v.slice(0, 3).map((d) => d.publicRef ?? d.name) : v)).slice(0, 400) : String(result);
  report.steps.push({ name, ms: +ms.toFixed(1), ok: okay, result: brief, error });
  if (!okay) report.failures.push({ name, result: brief, error });
  log(`${okay ? '✔' : '✖'} ${name} — ${ms.toFixed(0)} ms${okay ? '' : ' — ' + (error ?? brief).slice(0, 400)}`);
  return result;
}
const act = (ops, note) => api('/v1/god/act', { body: { ops, note } });
const accepted = (r) => r.status === 200 && r.data?.accepted === true;
const first = async (q) => (await api(`/v1/god/defs?q=${encodeURIComponent(q)}&limit=5`)).data?.defs?.map((d) => d.publicRef) ?? [];

// ---------- a GLB from nothing: a 0.6 m crate (two boxes), with @gltf-transform
async function crateGlb() {
  const require = createRequire(resolve(root, 'apps/server/package.json'));
  const { Document, NodeIO } = require('@gltf-transform/core');
  const doc = new Document(); const buffer = doc.createBuffer();
  const box = (cx, cy, cz, sx, sy, sz) => { const p = [], idx = []; const v = (x, y, z) => p.push(cx + x * sx / 2, cy + y * sy / 2, cz + z * sz / 2); for (const [a, b, c] of [[0, 1, 2], [1, 2, 0], [2, 0, 1]]) for (const s of [-1, 1]) { const o = p.length / 3; const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]]; for (const [u, w] of q) { const pt = [0, 0, 0]; pt[a] = s; pt[b] = u; pt[c] = w; v(...pt); } idx.push(...(s > 0 ? [o, o + 1, o + 2, o, o + 2, o + 3] : [o, o + 2, o + 1, o, o + 3, o + 2])); } return { p, idx }; };
  const parts = [box(0, 0.3, 0, 0.6, 0.6, 0.6), box(0, 0.62, 0, 0.66, 0.04, 0.66)];
  const scene = doc.createScene('crate');
  parts.forEach((pt, i) => {
    const pos = doc.createAccessor().setArray(new Float32Array(pt.p)).setType('VEC3').setBuffer(buffer);
    const ind = doc.createAccessor().setArray(new Uint16Array(pt.idx)).setType('SCALAR').setBuffer(buffer);
    const mat = doc.createMaterial(i ? 'lid' : 'wood').setBaseColorFactor(i ? [0.45, 0.3, 0.18, 1] : [0.72, 0.52, 0.3, 1]).setMetallicFactor(0).setRoughnessFactor(0.9);
    const mesh = doc.createMesh(`crate-${i}`).addPrimitive(doc.createPrimitive().setAttribute('POSITION', pos).setIndices(ind).setMaterial(mat));
    scene.addChild(doc.createNode(`crate-${i}`).setMesh(mesh));
  });
  return new NodeIO().writeBinary(doc);
}
/** A PNG header that claims 4096 × 4096 (the store reads the header; the budget refuses before decoding). */
function hugePngGlbFake() {
  const png = Buffer.from('89504e470d0a1a0a0000000d494844520000100000001000080600000000000000', 'hex');
  return png;
}

// ---------- browser
let chromium = null;
try { chromium = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test').chromium; } catch { log('  (no @playwright/test; screenshots skipped)'); }
let browser = null, page = null; const pageErrors = [];
// One page load for the whole run (a swiftshader page takes minutes to come up on a loaded laptop); views move the camera.
async function look(name, { eye, at, settle = 6000, size = [1280, 800] } = {}) {
  if (!chromium) return null;
  const t0 = now();
  if (!page) {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    page = await (await browser.newContext({ viewport: { width: size[0], height: size[1] } })).newPage();
    page.setDefaultTimeout(900_000);
    page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
    await page.goto(`${base}?dev=1&shot=1&eye=${eye.join(',')}&at=${at.join(',')}&settle=3000`, { waitUntil: 'domcontentloaded', timeout: 900_000 });
    await page.waitForFunction(() => document.title === 'ready' || document.title === 'no-entity-world', null, { timeout: 1_200_000, polling: 2000 });
  }
  const vp = page.viewportSize(); if (vp.width !== size[0] || vp.height !== size[1]) await page.setViewportSize({ width: size[0], height: size[1] });
  await page.evaluate(([e, a]) => { const s = window.__simEntity; s.controls.target.set(a[0], a[1], a[2]); s.camera.position.set(e[0], e[1], e[2]); s.camera.lookAt(s.controls.target); s.controls.update?.(); }, [eye, at]);
  // wait for every GLB to arrive (or fail), then let the frame settle
  await page.waitForFunction(() => { let pending = 0; window.__simEntity.layer.group.traverse((o) => { if (o.name.startsWith('mesh ') && !o.getObjectByName('asset') && !o.getObjectByName('asset missing')) pending++; }); return pending === 0; }, null, { timeout: 300_000, polling: 1000 }).catch(() => {});
  await page.waitForTimeout(settle);
  const state = await page.evaluate(() => {
    const w = window.__simEntity; if (!w) return null;
    const meshes = []; w.layer.group.traverse((o) => { if (o.name.startsWith('mesh ')) meshes.push({ name: o.name, loaded: !!o.getObjectByName('asset'), missing: !!o.getObjectByName('asset missing') }); });
    return { drawn: w.layer.drawn?.size, lastError: w.layer.stats?.lastError, meshes };
  });
  const file = resolve(out, `${name}.png`); await page.screenshot({ path: file, timeout: 900_000 });
  report.shots.push({ name, file, state: { drawn: state?.drawn, lastError: state?.lastError, meshes: state?.meshes.length, loaded: state?.meshes.filter((m) => m.loaded).length, missing: state?.meshes.filter((m) => m.missing).map((m) => m.name) }, errors: [...pageErrors], ms: +(now() - t0).toFixed(0) });
  log(`  📷 ${name}.png drawn ${state?.drawn} meshes ${state?.meshes.filter((m) => m.loaded).length}/${state?.meshes.length} loaded${pageErrors.length ? ' errors ' + pageErrors.join(' | ') : ''}`);
  return { state, file };
}

try {
  await step('A0 mint a god token for the new world', async () => { const r = await api('/v1/god/mint', { body: { label: 'assets-e2e' } }); token = r.data.token; return r; }, (r) => r.status === 200 && token.startsWith('god_'));

  // A1 the library first
  await step('A1 defs?q=duck → a duck (kit) or, before L4 lands, the pack bird', () => first('duck'), (h) => /duck|goose|bird/.test(h[0] ?? ''));
  await step('A1 defs?q=pup → a dog', () => first('pup'), (h) => /dog|pug/.test(h[0] ?? ''));
  await step('A1 defs?q=kitty → a cat', () => first('kitty'), (h) => /cat/.test(h[0] ?? ''));
  await step('A1 defs?q=lighthouse → a tower', () => first('lighthouse'), (h) => /lighthouse|tower/.test(h[0] ?? ''));
  await step('A1 defs?q=boat → a rowing boat', () => first('boat'), (h) => /row/.test(h[0] ?? ''));
  await step('A1 defs?q=oak → an oak tree', () => first('oak'), (h) => /oak/.test(h[0] ?? ''));
  await step('A1 defs/<ref> → full def and an example op that works', async () => { const d = await api('/v1/god/defs/core/rowboat-pack@1'); return d; }, (r) => r.status === 200 && r.data.example.ops[0].op === 'place' && r.data.asset?.tris > 0);

  // A2 import a GLB made from nothing
  const crate = await crateGlb();
  const imp = await step('A2 import crate.glb (height 0.9 m, define=1): measured, defined', async () => {
    const f = new FormData(); f.set('file', new Blob([crate], { type: 'model/gltf-binary' }), 'crate.glb');
    for (const [k, v] of Object.entries({ name: 'crate', height: '0.9', tags: 'crate, box, storage', license: 'CC0 1.0', source: 'e2e', define: '1' })) f.set(k, v);
    return api('/v1/god/assets', { body: f });
  }, (r) => r.status === 200 && r.data.asset.tris === 24 && r.data.defined?.accepted === true && Math.abs(r.data.def.size.box[1] - 0.9) < 1e-6);
  log(imp?.data?.report ? '    ' + imp.data.report.replace(/\n/g, '\n    ') : '');
  await step('A2 the file is served immutable with an ETag', async () => api(imp.data.asset.url), (r) => r.status === 200 && r.bytes.byteLength === crate.byteLength && /immutable/.test(r.headers.get('cache-control') ?? '') && r.headers.get('etag') === `"${imp.data.asset.sha}"`);
  await step('A2 the crate is in the library (defs?q=crate)', () => first('crate'), (h) => h[0] === 'crate@1');
  await step('A2 place three crates by the path', () => act([[0, 6], [1.2, 6], [0.6, 7.1]].map((p, i) => ({ op: 'place', def: 'crate@1', name: `crate-${i + 1}`, p, r: i * 0.4 })), 'A2 crates'), accepted);

  // A3 a Draco + WebP scan scaled to a stated height
  const head = new Uint8Array(readFileSync(resolve(root, 'worlds/littlemartians/characters/kalama.glb')));
  const kal = await step('A3 import kalama.glb (Draco+WebP, 17k tris) at 1.2 m as a statue', () => api(`/v1/god/assets?name=kalama-statue&height=1.2&tags=statue,ceramic&define=1&license=${encodeURIComponent('Vanessa Rosa (Little Martians), project use')}`, { raw: head, headers: { 'content-type': 'model/gltf-binary' } }), (r) => r.status === 200 && r.data.asset.tris === 17230 && r.data.defined?.accepted === true);
  log(kal?.data?.report ? '    ' + kal.data.report.replace(/\n/g, '\n    ') : '');
  await step('A3 place the statue on the green', () => act([{ op: 'place', def: 'kalama-statue@1', name: 'statue', p: [-3, 7] }], 'A3 statue'), accepted);

  // A4 refusals
  await step('A4 an image over the texture budget is refused (413 asset.budget)', () => api('/v1/god/assets', { raw: hugePngGlbFake(), headers: { 'content-type': 'image/png' } }), (r) => r.status === 413 && r.data.code === 'asset.budget');
  await step('A4 a text file is refused (415 asset.type)', () => api('/v1/god/assets', { raw: new TextEncoder().encode('just words'), headers: { 'content-type': 'text/plain' } }), (r) => r.status === 415);
  await step('A4 no god token → 401', async () => { const t = token; token = 'god_nope'; const r = await api('/v1/god/assets', { raw: crate }); token = t; return r; }, (r) => r.status === 401);

  // A5 the core library on the ground
  await step('A5 five pack animals on the meadow', () => act(['cow', 'sheep', 'horse', 'pig', 'dog'].map((s, i) => ({ op: 'place', def: `core/${s}-pack@1`, name: `${s}-1`, p: [-14 + i * 3.2, -6], r: 0.5 })), 'A5 animals'), accepted);
  await step('A5 a few trees and a mossy log', () => act([
    { op: 'place', def: 'core/oak-tree-1-pack@1', name: 'oak', p: [-22, -14] }, { op: 'place', def: 'core/birch-tree-1-pack@1', name: 'birch', p: [-28, -4] },
    { op: 'place', def: 'core/willow-tree-1-pack@1', name: 'willow', p: [8, -14] }, { op: 'place', def: 'core/mossy-log-pack@1', name: 'log', p: [-6, -12], r: 1.2 },
    { op: 'place', def: 'core/bush-1-pack@1', name: 'bush', p: [4, -4] }, { op: 'place', def: 'core/wildflowers-pack@1', name: 'flowers', p: [5, -3] },
  ], 'A5 green'), accepted);
  await step('A5 the Ceramic Tower with a bench in its second room, the Minaret Temple, the six kin', () => act([
    { op: 'place', tmp: '$t', def: 'core/ceramic-tower@1', name: 'tower', p: [30, 26] },
    { op: 'place', def: 'core/bench@1', name: 'tower-bench', in: { parent: '$t', slot: 'tower-l1' }, p: [3, 0] },
    { op: 'place', def: 'core/minaret-temple@1', name: 'temple', p: [-30, 34] },
    ...['chebel', 'colors-lemuet', 'crystal-freeman', 'dark-blue', 'green-brains-out', 'green-patterns-blue'].map((k, i) => ({ op: 'place', def: `core/kin-${k}@1`, name: `kin-${k}`, p: [-6 + i * 2.2, 16], r: Math.PI })),
  ], 'A5 littlemartians'), accepted);
  await step('A5 the tower bench sits on the second floor (footprint room slot, y ≈ 9 m)', async () => (await api('/v1/world/entities/tower/tower-bench')).data, (r) => r?.pose && Math.abs(r.pose.y - 9) < 0.7);
  await step('A5 the tower is hollow: a crate fits in the ground hall, one in the east wall is refused', async () => ({ inside: await act([{ op: 'place', def: 'crate@1', name: 'hall-crate', p: [30, 26] }]), wall: await act([{ op: 'place', def: 'crate@1', name: 'wall-crate', p: [38.7, 28.6] }]) }), (r) => accepted(r.inside) && r.wall.data?.accepted === false && r.wall.data.failures[0].code === 'overlap.solid');

  // A6 look
  const pic = await look('a6-overview', { eye: [-38, 22, 42], at: [0, 2, 0], settle: 8000 });
  await step('A6 every mesh def in view drew its GLB (no placeholders)', async () => pic?.state, (s) => !chromium || (s && s.meshes.length >= 20 && s.meshes.every((m) => m.loaded && !m.missing)));
  await look('a6-animals-close', { eye: [-8, 3.2, 2], at: [-8, 0.6, -6], settle: 6000 });
  await look('a6-crates-statue', { eye: [2.5, 2.2, 11], at: [-0.5, 0.6, 6.5], settle: 6000 });
  await look('a6-tower', { eye: [70, 30, 80], at: [10, 14, 20], settle: 8000 });

  // A7 thumbnail: render the crate alone, store, read back
  const thumb = await look('a7-thumb-crate', { eye: [1.6, 1.4, 8.6], at: [0.4, 0.4, 6.4], settle: 5000, size: [256, 256] });
  await step('A7 store a thumbnail for crate@1 and read it back', async () => {
    if (!thumb) return { skipped: true };
    const png = new Uint8Array(readFileSync(thumb.file));
    const put = await api('/v1/god/defs/crate@1/thumb.png', { raw: png, headers: { 'content-type': 'image/png' } });
    const get = await fetch(`${base}/v1/god/defs/crate@1/thumb.png`);
    const listed = (await api('/v1/god/defs?q=crate')).data.defs[0];
    return { put: put.status, get: get.status, type: get.headers.get('content-type'), listed: listed.thumb };
  }, (r) => r.skipped || (r.put === 200 && r.get === 200 && r.type === 'image/png' && /thumb\.png$/.test(r.listed)));
} finally {
  await browser?.close();
  report.finishedAt = new Date().toISOString();
  report.passed = report.steps.filter((s) => s.ok).length; report.total = report.steps.length;
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(resolve(out, 'server.log'), serverLog);
  log(`\n${report.passed}/${report.total} steps passed; report ${resolve(out, 'report.json')}`);
  if (!args.keep) server.kill();
  process.exit(report.failures.length ? 1 : 0);
}

#!/usr/bin/env node
// Render a thumbnail per def and store it (GET /v1/god/defs/<ref>/thumb.png serves it). Owner: L5.
//
//   node tools/god-skill/scripts/thumbs.mjs [--port 4999] [--q <query>] [--mesh] [--limit 40] [--only-missing] [--core]
//
// `--core` also writes worlds/core-assets/thumbs/<def hash>.png (committed; every box serves them).
//
// Starts a scratch world (fresh data dir; shares the box's ASSET_DIR unless --assets <dir>), places each
// def alone on a 40 m grid, frames it from the front-left at a distance fitted to its box, screenshots a
// 256 × 256 picture with the world page's shot mode, and POSTs it. Thumbnails are keyed by def hash, so
// every world on the box that has the same def shows the same picture. `--mesh` = every core mesh def;
// `--q` = whatever the catalog search returns; default: every core def with something to draw.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startWorld } from '../dev-world.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const port = Number(args.port ?? 4999), limit = Number(args.limit ?? 400);
const out = resolve(root, '.lane/thumbs'); mkdirSync(out, { recursive: true });
if (args.assets) process.env.ASSET_DIR = resolve(String(args.assets));
const { child, base } = await startWorld({ slug: 'thumbs', port, fresh: true, log: resolve(root, '.lane/thumbs.log') });
const stop = () => { try { child.kill(); } catch { /* gone */ } };
process.on('exit', stop);
const api = async (path, { body, raw, headers = {}, token } = {}) => {
  const h = { authorization: `Bearer ${token ?? 'dev:admin'}`, ...headers }; if (body) h['content-type'] = 'application/json';
  const r = await fetch(base + path, { method: body || raw ? 'POST' : 'GET', headers: h, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const token = (await api('/v1/god/mint', { body: { label: 'thumbs' } })).data.token;
const god = (p, o = {}) => api(p, { ...o, token });

let defs = (await god(`/v1/god/defs?limit=500${args.q ? `&q=${encodeURIComponent(args.q)}` : ''}`)).data.defs;
defs = defs.filter((d) => d.make.kind !== 'none' && d.make.kind !== 'parts' && d.form === 'point' && !d.tags.includes('landform') && !d.components?.body);
if (args.mesh) defs = defs.filter((d) => d.make.kind === 'mesh');
if (args['only-missing']) defs = defs.filter((d) => !d.thumb);
defs = defs.slice(0, limit);
console.log(`thumbs: ${defs.length} defs`);

// place them all at once on a grid (one batch per 40 so a bad one refuses alone)
const GRID = 40, cols = Math.ceil(Math.sqrt(defs.length));
const spot = (i) => [((i % cols) - cols / 2) * GRID, (Math.floor(i / cols) - cols / 2) * GRID];
const placed = [];
for (let i = 0; i < defs.length; i += 40) {
  const chunk = defs.slice(i, i + 40);
  const ops = chunk.map((d, j) => ({ op: 'place', def: d.publicRef, name: `t${i + j}`, p: spot(i + j), mode: 'nudge', ...(d.anchor === 'float' ? { anchor: 'base' } : {}) }));
  const r = await god('/v1/god/act', { body: { ops, note: 'thumbs' } });
  if (r.data?.accepted) placed.push(...chunk.map((d, j) => ({ d, i: i + j })));
  else for (const [j, op] of ops.entries()) { const r1 = await god('/v1/god/act', { body: { ops: [op] } }); if (r1.data?.accepted) placed.push({ d: chunk[j], i: i + j }); else console.log(`  skip ${chunk[j].publicRef}: ${r1.data?.failures?.[0]?.code}`); }
}
const pose = async (name) => (await api(`/v1/world/entities/${name}`)).data?.pose;

const { chromium } = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test');
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 256, height: 256 } })).newPage();
page.setDefaultTimeout(900_000);
const first = placed[0];
const p0 = first ? await pose(`t${first.i}`) : { x: 0, y: 0, z: 0 };
await page.goto(`${base}?dev=1&shot=1&eye=${p0.x - 3},${p0.y + 2},${p0.z + 4}&at=${p0.x},${p0.y + 0.5},${p0.z}&settle=4000`, { waitUntil: 'domcontentloaded', timeout: 900_000 });
await page.waitForFunction(() => document.title === 'ready', null, { timeout: 1_200_000, polling: 2000 });
let ok = 0;
for (const { d, i } of placed) {
  const p = await pose(`t${i}`); if (!p) continue;
  const [w, h, dd] = d.size.box, r = Math.max(w, h, dd) * 0.5 * (p.s ?? 1), dist = Math.max(1.2, r * 2.6);
  const at = [p.x, p.y + h * 0.45 * (p.s ?? 1), p.z], eye = [at[0] - dist * 0.55, at[1] + dist * 0.45, at[2] + dist * 0.8];
  await page.evaluate(([e, a]) => { const s = window.__simEntity; s.controls.target.set(a[0], a[1], a[2]); s.camera.position.set(e[0], e[1], e[2]); s.camera.lookAt(s.controls.target); s.controls.update?.(); }, [eye, at]);
  // wait until this entity's GLB (if any) has loaded, then a beat for the frame
  await page.waitForFunction((name) => { let ready = true; window.__simEntity.layer.group.traverse((o) => { if (o.name === name && !o.getObjectByName('asset') && !o.getObjectByName('asset missing')) ready = false; }); return ready; }, `mesh ${d.name}`, { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(900);
  const png = await page.screenshot({ type: 'png' });
  writeFileSync(resolve(out, `${d.name}.png`), png);
  if (args.core && d.ref.startsWith('core-')) { mkdirSync(resolve(root, 'worlds/core-assets/thumbs'), { recursive: true }); writeFileSync(resolve(root, 'worlds/core-assets/thumbs', `${d.hash}.png`), png); }
  const put = await god(`/v1/god/defs/${d.publicRef}/thumb.png`, { raw: png, headers: { 'content-type': 'image/png' } });
  if (put.status === 200) ok++; else console.log(`  ${d.publicRef}: ${put.status} ${JSON.stringify(put.data)}`);
}
await browser.close();
console.log(`thumbs: ${ok}/${placed.length} stored (copies in ${out})`);
stop(); process.exit(0);

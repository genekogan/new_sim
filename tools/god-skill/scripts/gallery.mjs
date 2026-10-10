#!/usr/bin/env node
// The library gallery (L4): every core point def in a labelled contact sheet — the visual gate for
// the Eden look (rounded low-poly, recognisable silhouettes). Spec <eden4>/29 WP4, 33 §3.1.
//
//   node tools/god-skill/scripts/gallery.mjs <world-url> [--filter <q>] [--out <dir>] [--token <god>] [--walk]
//        sheet of the world's library (GET /v1/god/defs), rendered by the real mesh halves in a studio page
//   node tools/god-skill/scripts/gallery.mjs --local [--filter <q>] [--walk]
//        same, from this checkout's core kit (no server)
//   node tools/god-skill/scripts/gallery.mjs <world-url> --world [--cols 8]
//        also place every def in a grid in that world and photograph the grid from the viewer
//   --serve <port>  start an own small studio world (240 m, fresh) for --world and stop it after
//
// Writes <out>/sheet.png (+ sheet-walk rows with --walk), <out>/gallery.json (defs, tris, errors),
// and with --world <out>/world-overview.png. Without --token it mints one with the dev owner.
import { existsSync, mkdirSync, openSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes(`--${k}`);
const out = resolve(flag('out', resolve(root, '.lane/gallery', new Date().toISOString().replace(/[:.]/g, '-'))));
mkdirSync(out, { recursive: true });
const filter = (flag('filter', '') ?? '').toLowerCase();
const cols = Number(flag('cols', 8));
let base = (argv.find((a) => /^https?:/.test(a)) ?? '').replace(/\/$/, '').replace(/\?.*$/, '');
let served = null;
if (flag('serve')) {
  // a small studio world: flat, 240 m, nothing else in it
  const genesis = resolve(out, 'studio-genesis.json'), port = Number(flag('serve')), dataDir = resolve(out, 'data');
  writeFileSync(genesis, JSON.stringify({ schema: 'genesis/1', name: 'Gallery studio', constants: { extent: 240, ground: 'land' }, state: { sky: { palette: 'clear-day', sun: 0.7 } }, batches: [] }));
  rmSync(dataDir, { recursive: true, force: true }); mkdirSync(dataDir, { recursive: true });
  const marsWeb = resolve(root, '.lane/mars-web'), logFd = openSync(resolve(out, 'server.log'), 'a');
  const env = { ...process.env, WORLD_KEY: 'gallery', WORLD_ID: 'gallery-1', ENGINE: 'mars', PORT: String(port), DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', DATA_DIR: dataDir, PUBLIC_URL: `http://127.0.0.1:${port}`, GENESIS_FILE: genesis, ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}) };
  const child = spawn(process.execPath, ['apps/server/src/main.ts'], { cwd: root, env, stdio: ['ignore', logFd, logFd] });
  served = { child }; base = `http://127.0.0.1:${port}/w/gallery`;
  let up = false; for (let i = 0; i < 1500 && !up; i++) { try { up = (await fetch(`${base}/healthz`)).ok; } catch { /* booting */ } if (!up) await new Promise((r) => setTimeout(r, 200)); }
  if (!up) { child.kill(); throw new Error(`studio world did not come up on :${port} (see ${resolve(out, 'server.log')})`); }
}
process.on('exit', () => { try { served?.child.kill(); } catch { } });

let token = flag('token', '');
async function api(path, body, auth = token) {
  const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); try { return JSON.parse(text); } catch { return { error: text }; }
}
let lib;
if (has('local') || !base) {
  const wc = await import(pathToFileURL(resolve(root, 'packages/world-compiler/src/index.ts')).href);
  const m = new wc.WorldModel({ constants: { ground: 'land' }, seed: 'gallery' });
  lib = wc.CORE_KIT.map((d) => m.defineDef(d, 'core', 0));
} else {
  if (!token) { const m = await api('/v1/god/mint', { label: 'gallery' }, 'dev:admin'); token = m.token; if (!token) throw new Error('no god token: pass --token (mint failed: ' + JSON.stringify(m).slice(0, 200) + ')'); }
  lib = (await api('/v1/god/defs')).defs ?? [];
}

// ---- which defs: core point defs that draw something (no landforms, covers, bodies, markers)
const SKIP_GEN = new Set(['landform/1', 'lake/1', 'scatter/1', 'scatter/2', 'animals/1']);
const family = (d) => (d.tags.includes('creature') ? 'creatures' : ['furniture', 'kitchen', 'plant', 'garden', 'tree', 'rock', 'street', 'civic', 'play', 'ride', 'transport', 'vehicle', 'work', 'signage', 'sign', 'light'].find((t) => d.tags.includes(t)) ?? 'props');
let defs = lib.filter((d) => d.ref.startsWith('core-') && d.form === 'point' && d.make?.kind !== 'none' && d.make?.kind !== 'parts' && !SKIP_GEN.has(d.make?.gen) && !d.tags.includes('body') && !d.tags.includes('marker') && !d.tags.includes('landform'));
if (filter) defs = defs.filter((d) => d.name.includes(filter) || d.tags.some((t) => t.includes(filter)) || family(d) === filter);
const ORDER = ['creatures', 'furniture', 'kitchen', 'props', 'street', 'light', 'signage', 'sign', 'plant', 'tree', 'garden', 'rock', 'civic', 'play', 'ride', 'transport', 'vehicle', 'work'];
defs.sort((a, b) => (ORDER.indexOf(family(a)) - ORDER.indexOf(family(b))) || a.name.localeCompare(b.name));
console.log(`gallery: ${defs.length} defs from ${base}`);

// ---- layout: rows of `cols` cells; cell size from the biggest box in the row; water things in a pond
const z0 = -60; const cells = []; let z = z0;
const isWater = (d) => d.anchor === 'float' || (d.tags.includes('creature') && d.tags.includes('fish'));
const dry = defs.filter((d) => !isWater(d)), wet = defs.filter(isWater);
for (let i = 0; i < dry.length; i += cols) {
  const row = dry.slice(i, i + cols), cell = Math.max(4, ...row.map((d) => Math.max(d.size.box[0], d.size.box[2]) + 2.5));
  row.forEach((d, j) => cells.push({ def: d, x: (j - (cols - 1) / 2) * cell, z, cell }));
  z += cell;
}
const pondZ = z + 6;
if (wet.length) wet.forEach((d, j) => cells.push({ def: d, x: (j - (wet.length - 1) / 2) * 4, z: pondZ, cell: 4, wet: true }));

// ---- place (fresh grid; idle creatures so close-ups find them)
if (has('world') && base) {
  const ops = [];
  if (wet.length) { const w = wet.length * 2 + 6; ops.push({ op: 'place', def: 'core/pond@1', name: 'gallery-pond', shape: { area: [[-w, pondZ - 5], [w, pondZ - 5], [w, pondZ + 5], [-w, pondZ + 5]] }, params: { depth: 1.2, level: -0.2 } }); }
  for (const c of cells) {
    const params = c.def.tags.includes('creature') ? { behavior: 'idle' } : undefined;
    ops.push({ op: 'place', def: c.def.ref.replace(/^core-/, 'core/'), name: `g-${c.def.name.replace(/^core-/, '')}`, p: [c.x, c.z], r: 0.5, mode: 'nudge', ...(params ? { params } : {}) });
  }
  for (let i = 0; i < ops.length; i += 200) {
    const r = await api('/v1/god/act', { ops: ops.slice(i, i + 200), note: 'gallery', group: 'gallery' });
    if (!r.accepted) { console.error('refused:', JSON.stringify(r.failures?.slice(0, 5))); }
  }
}

// ---- the contact sheet: bundle the studio page with every mesh half and render the defs in it
const { chromium } = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test');
const esbuild = await import(pathToFileURL(resolve(realpathSync(resolve(root, 'apps/web/node_modules/vite')), '../esbuild/lib/main.js')).href);
const meshDir = resolve(root, 'apps/web/src/gen-mesh'), meshFiles = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.mesh.ts')) meshFiles.push(p); } };
walk(meshDir);
const entry = resolve(out, 'studio-entry.ts');
writeFileSync(entry, [...meshFiles, resolve(meshDir, 'kits/studio.ts')].map((f) => `import ${JSON.stringify(relative(out, f).startsWith('.') ? relative(out, f) : './' + relative(out, f))};`).join('\n') + '\n');
await esbuild.build({ entryPoints: [entry], bundle: true, format: 'iife', platform: 'browser', outfile: resolve(out, 'studio.js'), logLevel: 'error', absWorkingDir: resolve(root, 'apps/web'), nodePaths: [resolve(root, 'apps/web/node_modules')], define: { 'import.meta.env': '{}' } });
writeFileSync(resolve(out, 'studio.html'), `<!doctype html><meta charset=utf-8><style>body{margin:0;background:#efe9dc;font:12px system-ui;color:#2a2622}h1{font:600 15px system-ui;margin:0;padding:10px 12px}#sheet{position:relative}.lbl{position:absolute;box-sizing:border-box;padding:3px 7px;background:#f8f5ee;border-top:1px solid #e2dccd;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.lbl b{font-weight:600;margin-right:6px}.lbl i{color:#8a8278;font-style:normal;font-size:11px}</style><h1 id=title></h1><div id=sheet></div><script src="./studio.js"></script>`);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: cols * 220, height: 800 } }); page.setDefaultTimeout(600000);
const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 300))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
await page.goto(pathToFileURL(resolve(out, 'studio.html')).href);
await page.waitForFunction(() => !!window.studio, null, { timeout: 120000 });
await page.evaluate((t) => { document.getElementById('title').textContent = t; }, `Eden core library — ${defs.length} defs — ${new Date().toISOString().slice(0, 16)}Z${filter ? ` — filter “${filter}”` : ''}`);
const t0 = Date.now();
const res = await page.evaluate(([d, c, w]) => window.studio.render(d, { cols: c, walk: w }), [defs, cols, has('walk')]);
await page.locator('body').screenshot({ path: resolve(out, 'sheet.png') });
console.log(`sheet: ${resolve(out, 'sheet.png')} — ${res.cells} cells in ${((Date.now() - t0) / 1000).toFixed(1)} s, errors ${res.errors.length + errors.length}`);
writeFileSync(resolve(out, 'gallery.json'), JSON.stringify({ base: base || 'local', count: defs.length, defs: defs.map((d, i) => ({ name: d.name, tags: d.tags, box: d.size.box, family: family(d), description: d.description })), tris: res.tris, errors: [...res.errors, ...errors] }, null, 1));
await browser.close();
if (!has('world') || !base) process.exit(0);

// ---- the grid in the world, from the viewer
{
const browser2 = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser2.newContext({ viewport: { width: 960, height: 600 } });
const page = await ctx.newPage(); page.setDefaultTimeout(180000);
const werrors = []; page.on('pageerror', (e) => werrors.push(String(e).slice(0, 200)));
const zm = (z0 + z) / 2; const q = new URLSearchParams({ dev: '1', eye: `-40,40,${z0 - 20}`, at: `0,0,${zm}` });
await page.goto(`${base}?${q}`, { waitUntil: 'commit', timeout: 120000 });
for (let i = 0; i < 60; i++) { const ok = await page.evaluate(() => !!window.__simEntity?.layer?.active).catch(() => false); if (ok) break; await page.waitForTimeout(500); }
await page.waitForTimeout(6000);
// hide the page chrome for clean shots
await page.addStyleTag({ content: 'body > *:not(:has(canvas)) { display: none !important; } [class*=panel], [class*=Panel], [class*=dock], [class*=Dock], header, nav, aside { display: none !important; }' }).catch(() => {});
const look = (eye, at) => page.evaluate(([e, a]) => { const w = window.__simEntity; w.controls.target.set(a[0], a[1], a[2]); w.camera.position.set(e[0], e[1], e[2]); w.camera.lookAt(w.controls.target); w.controls.update?.(); }, [eye, at]);
await look([0, Math.max(30, (z - z0) * 0.9), z0 - (z - z0) * 0.35], [0, 0, zm]);
await page.waitForTimeout(2500);
await page.screenshot({ path: resolve(out, 'world-overview.png') });
await browser2.close();
console.log(`world overview: ${resolve(out, 'world-overview.png')}`);
}

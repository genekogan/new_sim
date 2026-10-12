#!/usr/bin/env node
// G4 — headless render gate (CATALOG-PROGRAM (c) "Gates": G4). Continuous: every new or changed item is rendered and
// checked (Gene, Q9). Runs here on the laptop's real GPU (Chrome over Metal, with the shared Chrome lease) or on a Modal
// GPU (tools/catalog/g4/g4_modal.py runs this same script inside the container). NEVER software rendering: the run
// aborts if WebGL reports SwiftShader / llvmpipe / a software rasterizer.
//
//   node tools/catalog/g4/g4-render.mjs --port 6002 [--items eden/chair@1,eden/dumpster@1 | --sample 20] [--out .lane/g4/<run>]
//          [--baseline <dir>] [--approve] [--chrome <path>] [--no-lease] [--url http://127.0.0.1:6002/w/g4 (an already running world)]
//
// For each item: the default, up to 3 enum variants (the `variant` param first) and each actuator's "on" state, every one
// placed alone on a 40 m grid in a fresh world with fixed light (11:00, clock paused, clear weather), shot from 4 fixed
// views (front-left, front-right, back, above) at a distance fitted to the def's box, 256 × 256.
// Machine look checks (each a number, so a regression is a number that moved):
//   blank       one colour covers > 90 % of the crop (nothing drew)
//   dark        > 35 % near-black pixels (opaque black glass, missing textures)
//   same        a variant's colour thumbnail differs from the default's by < 2.0 (mean abs, 0–255): "variants all green"
//   ssim        per view against the approved baseline (--baseline); < 0.85 fails (re-approve with --approve)
// Writes <out>/<id>/<variant>/<view>.png, <out>/report.json, and a contact sheet <out>/sheet.html for the review queue.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateExit } from './checks.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : null)).filter(Boolean));
const port = Number(args.port ?? 6002);
const run = `g4-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const out = resolve(String(args.out ?? join(root, '.lane/g4', run)));
mkdirSync(out, { recursive: true });
const t0 = performance.now();

// ---------------------------------------------------------------- the world
let base = args.url ? String(args.url) : null, child = null;
if (!base) { const { startWorld } = await import('../../god-skill/dev-world.mjs'); ({ child, base } = await startWorld({ slug: 'g4', port, fresh: true, log: join(out, 'server.log') })); }
const stop = () => { try { child?.kill(); } catch { /* gone */ } };
process.on('exit', stop);
const api = async (path, { body, token } = {}) => {
  const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token ?? 'dev:admin'}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const token = (await api('/v1/god/mint', { body: { label: 'g4' } })).data.token;
const god = (p, o = {}) => api(p, { ...o, token });
await god('/v1/god/act', { body: { ops: [{ op: 'world', state: { time: { set: { hour: 11, n: 1 }, paused: true }, weather: { kind: 'clear', clouds: 0, wind: 0, rain: 0, fog: 0 } } }], note: 'g4: fixed light' } });

// ---------------------------------------------------------------- which items
const toRef = (r) => r.replace(/^eden\//, 'core/').replace(/^lm\//, 'core/lm-').replace(/^mars\//, 'core/mars-');
const defOf = async (ref) => { const r = await god(`/v1/god/defs/${encodeURIComponent(ref)}`); return r.status === 200 ? { ...r.data.def, publicRef: r.data.publicRef } : null; };
let picks;
if (args.items) {
  const refs = String(args.items).split(',').map((r) => toRef(r.trim()));
  picks = await Promise.all(refs.map(defOf));
  if (picks.some((d) => !d)) throw new Error(`G4 missing requested refs: ${refs.filter((_, i) => !picks[i]).join(', ')}`);
}
else {
  // the whole manifest (one row per item), then a deterministic spread of drawable point items across it
  const rows = (await god('/v1/god/catalog?per=2000&format=json')).data.rows;
  const drawable = rows.filter((r) => r.make !== 'none' && r.form === 'point' && !/^living\.character/.test(r.cat) && Math.max(...r.size.split('×').map(Number)) <= 40);
  const n = Number(args.sample ?? 20), step = Math.max(1, Math.floor(drawable.length / n));
  picks = (await Promise.all(drawable.filter((_, i) => i % step === 0).slice(0, n).map((r) => defOf(r.ref)))).filter((d) => d && !d.components?.body);
}
const ACT = { power: ['on', true], door: ['open', true], ignite: ['lit', true], play: ['playing', true], fill: ['level', 1] };
const shotsOf = (d) => {
  const list = [{ label: 'default', params: {}, state: {} }];
  const enums = Object.entries(d.params ?? {}).filter(([, f]) => f.type === 'enum').sort(([a], [b]) => (a === 'variant' ? -1 : b === 'variant' ? 1 : 0));
  for (const [k, f] of enums) for (const v of f.values) { if (list.length >= 4) break; if (v !== (f.default ?? f.values[0])) list.push({ label: `${k}=${v}`, params: { [k]: v }, state: {} }); }
  for (const [, [field, val]] of Object.entries(ACT)) if (d.state?.[field] && d.state[field].default !== val) list.push({ label: `${field}=${val}`, params: {}, state: { [field]: val } });
  return list;
};
const jobs = picks.flatMap((d) => shotsOf(d).map((s) => ({ d, ...s })));
if (!jobs.length) throw new Error('G4 selected no drawable items');
console.log(`G4: ${picks.length} items, ${jobs.length} variants/states, 4 views each → ${jobs.length * 4} renders`);

// place every job on a 40 m grid (one batch per item so a refusal stays local)
// each job's spot is a hash of (item, variant) on a 40 m grid, so the same picture has the same surroundings whatever
// else the run renders (other items are also hidden while one is shot)
const GRID = 40, CELLS = 22, used = new Set();
if (jobs.length > CELLS * CELLS) throw new Error(`G4 has ${jobs.length} jobs for ${CELLS * CELLS} cells; split the item list into batches`);
const h32 = (str) => { let h = 2166136261; for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
jobs.forEach((j, i) => { j.name = `g${i}`; let c = h32(`${j.d.publicRef}|${j.label}`) % (CELLS * CELLS); while (used.has(c)) c = (c + 1) % (CELLS * CELLS); used.add(c); j.p = [((c % CELLS) - CELLS / 2) * GRID, 0, (Math.floor(c / CELLS) - CELLS / 2) * GRID]; });
const water = jobs.filter((j) => j.d.anchor === 'float');
if (water.length) await god('/v1/god/act', { body: { ops: water.map((j, k) => ({ op: 'place', def: 'core/pond@1', name: `w${k}`, p: [0, 0, 0], params: { depth: 3 }, shape: { area: [[j.p[0] - 12, j.p[2] - 12], [j.p[0] + 12, j.p[2] - 12], [j.p[0] + 12, j.p[2] + 12], [j.p[0] - 12, j.p[2] + 12]] } })) } });
for (const j of jobs) {
  const r = await god('/v1/god/act', { body: { ops: [{ op: 'place', def: j.d.publicRef, name: j.name, p: j.p, mode: 'nudge', ...(Object.keys(j.params).length ? { params: j.params } : {}), ...(Object.keys(j.state).length ? { state: j.state } : {}) }] } });
  j.placed = !!r.data?.accepted; if (!j.placed) j.refused = r.data?.failures?.[0];
}

// ---------------------------------------------------------------- Chrome on a real GPU
const { chromium } = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test');
let release = () => {};
if (!args['no-lease']) { const { chromeLease } = await import('../../god-skill/lib/chrome-lease.mjs'); release = await chromeLease('catrun-g4'); }
const angle = String(args.angle ?? 'vulkan');
const gpuArgs = process.platform === 'linux' ? ['--no-sandbox', '--ignore-gpu-blocklist', `--use-angle=${angle}`, ...(angle === 'vulkan' ? ['--enable-features=Vulkan', '--disable-vulkan-surface'] : [])] : ['--ignore-gpu-blocklist'];
const browser = await chromium.launch({ ...(args.chrome ? { executablePath: String(args.chrome) } : { channel: 'chrome' }), headless: true, args: gpuArgs });
const page = await (await browser.newContext({ viewport: { width: 900, height: 900 } })).newPage();
page.setDefaultTimeout(600_000);
const first = jobs.find((j) => j.placed) ?? { p: [0, 0, 0] };
await page.goto(`${base}?dev=1&shot=1&weather=clear&eye=${first.p[0] - 3},2,${first.p[2] + 4}&at=${first.p[0]},0.5,${first.p[2]}&settle=4000`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.title === 'ready' || document.title === 'no-entity-world', null, { polling: 1000 });
const gpu = await page.evaluate(() => { const gl = window.__simEntity.renderer.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); });
console.log(`G4 renderer: ${gpu}`);
if (/swiftshader|llvmpipe|software|softpipe/i.test(gpu)) { console.error('G4 refuses software rendering (never swiftshader): no GPU in this browser'); await browser.close(); release(); process.exit(3); }

// deterministic pictures: the entity layer's clock stands still at a fixed instant (eases finished, motion and clips at
// one phase), so a re-render compares like with like; the self-SSIM floor below covers whatever still moves
await page.evaluate(() => { const L = window.__simEntity.layer; if (!L.__g4) { const orig = L.update.bind(L); L.update = (dt, now, g) => orig(0, 1e9, g); L.__g4 = true; } });
const VIEWS = { 'front-left': [-0.55, 0.42, 0.8], 'front-right': [0.55, 0.42, 0.8], back: [0.3, 0.45, -0.85], above: [-0.2, 1.4, 0.35] };
const results = [];
for (const j of jobs) {
  const rec = { id: j.d.publicRef, label: j.label, placed: j.placed, refused: j.refused, views: {} };
  results.push(rec);
  if (!j.placed) continue;
  const ent = (await api(`/v1/world/entities/${j.name}`)).data, pose = ent?.pose, eid = ent?.entity?.id ?? null;
  // wait until this entity's GLB (if any) has loaded
  await page.waitForFunction((name) => { let ready = true; window.__simEntity.layer.group.traverse((o) => { if (o.name === name && !o.getObjectByName('asset') && !o.getObjectByName('asset missing')) ready = false; }); return ready; }, `mesh ${j.d.name}`, { timeout: 120_000 }).catch(() => { rec.note = 'asset load timeout'; });
  for (const [view, k] of Object.entries(VIEWS)) {
    const [bw, bh, bd] = j.d.size.box;
    const shoot = (a) => page.evaluate(async ([id, fb, k]) => {
      const s = window.__simEntity, dr = s.layer.drawn.get(id), o = dr && !dr.inst ? dr.obj : null;
      const hidden = []; for (const [oid, other] of s.layer.drawn) if (oid !== id && other.obj && other.obj.visible && !String(other.obj.name).includes('pond')) { other.obj.visible = false; hidden.push(other.obj); }
      try {
      const c = o ? [o.position.x, o.position.y + fb.h / 2, o.position.z] : fb.at, yaw = o ? o.rotation.y : fb.yaw;
      const dist = Math.max(2.4, fb.r * 2.6), n = Math.hypot(...k), cy = Math.cos(yaw), sy = Math.sin(yaw);
      const eye = [c[0] + (k[0] * cy + k[2] * sy) / n * dist, c[1] + k[1] / n * dist, c[2] + (-k[0] * sy + k[2] * cy) / n * dist];
      s.controls.target.set(c[0], c[1], c[2]); s.camera.position.set(eye[0], eye[1], eye[2]); s.camera.lookAt(s.controls.target); s.controls.update?.();
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const cam = s.camera, v = cam.position.clone().set(c[0], c[1], c[2]), dcam = cam.position.distanceTo(v); v.project(cam);
      const src = s.renderer.domElement, W = src.width, H = src.height;
      const rpx = (fb.r / Math.max(0.01, dcam)) / Math.tan(cam.fov * Math.PI / 360) * (H / 2), side = Math.max(40, Math.min(Math.min(W, H), rpx * 2.3));
      const px = (v.x + 1) / 2 * W, py = (1 - v.y) / 2 * H, x0 = Math.max(0, Math.min(W - side, px - side / 2)), y0 = Math.max(0, Math.min(H - side, py - side * 0.52));
      s.renderer.render(s.scene, cam);
      const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, x0, y0, side, side, 0, 0, 256, 256);
      const px256 = g.getImageData(0, 0, 256, 256).data;
      // look checks on the crop: dominant colour share, near-black share
      const bins = new Map(); let dark = 0;
      for (let i = 0; i < px256.length; i += 4) { const key = (px256[i] >> 4) << 8 | (px256[i + 1] >> 4) << 4 | (px256[i + 2] >> 4); bins.set(key, (bins.get(key) ?? 0) + 1); if (px256[i] + px256[i + 1] + px256[i + 2] < 48) dark++; }
      const total = px256.length / 4, top = Math.max(...bins.values()) / total;
      // small thumbnails for diffs: 32×32 RGB (variants) and 64×64 grey (SSIM)
      const t = document.createElement('canvas'); t.width = t.height = 64; const tg = t.getContext('2d'); tg.drawImage(cv, 0, 0, 64, 64); const g64 = tg.getImageData(0, 0, 64, 64).data;
      const grey = []; for (let i = 0; i < g64.length; i += 4) grey.push(Math.round(0.299 * g64[i] + 0.587 * g64[i + 1] + 0.114 * g64[i + 2]));
      const t2 = document.createElement('canvas'); t2.width = t2.height = 32; const t2g = t2.getContext('2d'); t2g.drawImage(cv, 0, 0, 32, 32); const rgb = [...t2g.getImageData(0, 0, 32, 32).data].filter((_, i) => i % 4 !== 3);
      // coverage: how much of the crop is the object itself (hide it, render the same view again, count changed pixels)
      let cover = null;
      if (o) {
        o.visible = false; s.renderer.render(s.scene, cam);
        const cv2 = document.createElement('canvas'); cv2.width = cv2.height = 256; const g2 = cv2.getContext('2d'); g2.drawImage(src, x0, y0, side, side, 0, 0, 256, 256);
        o.visible = true;
        const bg = g2.getImageData(0, 0, 256, 256).data; let changed = 0;
        for (let i = 0; i < bg.length; i += 4) if (Math.abs(bg[i] - px256[i]) + Math.abs(bg[i + 1] - px256[i + 1]) + Math.abs(bg[i + 2] - px256[i + 2]) > 36) changed++;
        cover = +(changed / total).toFixed(4);
      }
      return { live: !!o, moving: !!dr?.motion, png: cv.toDataURL('image/png'), top: +top.toFixed(3), dark: +(dark / total).toFixed(3), cover, grey, rgb };
      } finally { for (const h of hidden) h.visible = true; }
    }, a);
    const shotArgs = [eid, { at: pose ? [pose.x, pose.y + bh / 2, pose.z] : [j.p[0], bh / 2, j.p[2]], h: bh, r: Math.hypot(bw, bh, bd) * 0.5, yaw: pose?.yaw ?? 0 }, k];
    const shot = await shoot(shotArgs);
    // the noise floor: the default's first view shot again 0.5 s later (animated rigs, wind, water move between shots)
    if (view === 'front-left' && j.label === 'default') { await new Promise((r) => setTimeout(r, 500)); rec.again = (await shoot(shotArgs)).grey; }
    const dir = join(out, rec.id.replace(/[/@]/g, '_'), rec.label.replace(/[^a-z0-9=._-]/gi, '_')); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${view}.png`), Buffer.from(shot.png.split(',')[1], 'base64'));
    rec.moving = rec.moving || shot.moving;
    rec.views[view] = { live: shot.live, top: shot.top, dark: shot.dark, cover: shot.cover, grey: shot.grey, rgb: shot.rgb, file: join(dir, `${view}.png`) };
  }
}
await browser.close(); release();

// ---------------------------------------------------------------- checks
const ssim = (a, b, w = 64) => {   // mean SSIM over 8×8 windows on 64×64 grey
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2; let sum = 0, n = 0;
  for (let y = 0; y + 8 <= w; y += 4) for (let x = 0; x + 8 <= w; x += 4) {
    let ma = 0, mb = 0; for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { ma += a[(y + j) * w + x + i]; mb += b[(y + j) * w + x + i]; } ma /= 64; mb /= 64;
    let va = 0, vb = 0, cov = 0; for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { const da = a[(y + j) * w + x + i] - ma, db = b[(y + j) * w + x + i] - mb; va += da * da; vb += db * db; cov += da * db; } va /= 63; vb /= 63; cov /= 63;
    sum += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); n++;
  }
  return sum / n;
};
const mad = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;
const baseDir = args.baseline ? resolve(String(args.baseline)) : null;
const items = new Map();
for (const r of results) { const l = items.get(r.id) ?? []; l.push(r); items.set(r.id, l); }
const report = { run, gpu, base, ms: 0, items: [] };
for (const [id, recs] of items) {
  const errors = [], warnings = [], numbers = {};
  const def = recs[0];
  // pass mark: 0.85, or below the item's own shot-to-shot noise (self-SSIM − 0.05) when it moves by itself
  const self = def.again && def.views['front-left'] ? ssim(def.views['front-left'].grey, def.again) : 1;
  // creatures wander and animate on the server between runs: a looser mark (0.7) for anything with motion
  const floor = def.moving ? 0.7 : Math.min(0.85, self - 0.05); numbers.selfSsim = +self.toFixed(3); if (def.moving) numbers.moving = 1;
  for (const r of recs) {
    if (!r.placed) { errors.push(`${r.label}: refused ${r.refused?.code ?? ''} ${String(r.refused?.detail ?? '').slice(0, 80)}`); continue; }
    for (const [view, v] of Object.entries(r.views)) {
      // nothing drew: the object covers < 0.3 % of its own crop (or, when it is instanced and cannot be hidden, one colour fills > 97 %)
      if (v.cover !== null && v.cover !== undefined) { numbers[`cover:${r.label}/${view}`] = v.cover; if (v.cover < 0.003) errors.push(`${r.label}/${view}: blank (object covers ${(v.cover * 100).toFixed(2)} % of the view)`); }
      else if (v.top > 0.97) errors.push(`${r.label}/${view}: blank (${Math.round(v.top * 100)} % one colour)`);
      if (v.dark > 0.35) warnings.push(`${r.label}/${view}: dark (${Math.round(v.dark * 100)} % near-black)`);
      if (baseDir) {
        const bf = join(baseDir, id.replace(/[/@]/g, '_'), `${r.label.replace(/[^a-z0-9=._-]/gi, '_')}-${view}.json`);
        if (!args.approve) {
          if (existsSync(bf)) { const s = ssim(v.grey, JSON.parse(readFileSync(bf, 'utf8')).grey); numbers[`ssim:${r.label}/${view}`] = +s.toFixed(3); if (s < floor) errors.push(`${r.label}/${view}: ssim ${s.toFixed(3)} < ${floor.toFixed(3)} vs baseline`); }
          else errors.push(`${r.label}/${view}: no baseline`);
        }
      }
    }
    if (r !== def && def.placed && r.placed) {
      const d = Object.keys(r.views).reduce((s, view) => s + mad(r.views[view].rgb, def.views[view].rgb), 0) / Object.keys(r.views).length;
      numbers[`diff:${r.label}`] = +d.toFixed(2);
      const state = /^(on|open|lit|playing|level)=/.test(r.label);
      if (!state && d < 2) errors.push(`${r.label}: looks the same as the default (mean diff ${d.toFixed(2)})`);
      if (state && d < 1) warnings.push(`${r.label}: the state draws no visible change (mean diff ${d.toFixed(2)})`);
    }
  }
  // A failed machine look check must never become an approved reference image.
  if (baseDir && args.approve && !errors.length) for (const r of recs) for (const [view, v] of Object.entries(r.views)) {
    const bf = join(baseDir, id.replace(/[/@]/g, '_'), `${r.label.replace(/[^a-z0-9=._-]/gi, '_')}-${view}.json`);
    mkdirSync(dirname(bf), { recursive: true }); writeFileSync(bf, JSON.stringify({ grey: v.grey }));
  }
  report.items.push({ id, ok: errors.length === 0, errors, warnings, numbers, variants: recs.map((r) => r.label), views: recs.flatMap((r) => Object.entries(r.views).map(([view, v]) => ({ label: r.label, view, file: v.file, top: v.top, dark: v.dark }))) });
}
report.ms = Math.round(performance.now() - t0);
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
// contact sheet for the review queue
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
writeFileSync(join(out, 'sheet.html'), `<!doctype html><meta charset="utf-8"><title>G4 ${run}</title><style>body{font:13px system-ui;background:#111;color:#ddd;margin:16px}h2{font-size:14px;margin:18px 0 4px}.ok{color:#7c7}.bad{color:#f77}img{width:128px;height:128px;margin:1px;border-radius:3px}.row{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.lbl{width:120px;color:#999}</style><h1>G4 ${esc(run)} · ${esc(gpu)}</h1>${report.items.map((it) => `<h2 class="${it.ok ? 'ok' : 'bad'}">${esc(it.id)} ${it.ok ? 'ok' : '✖ ' + esc(it.errors.join('; '))}</h2>${[...new Set(it.views.map((v) => v.label))].map((l) => `<div class="row"><span class="lbl">${esc(l)}</span>${it.views.filter((v) => v.label === l).map((v) => `<img src="${esc(v.file.replace(out + '/', ''))}" title="${esc(v.view)} top ${v.top} dark ${v.dark}">`).join('')}</div>`).join('')}`).join('')}`);
const bad = report.items.filter((i) => !i.ok).length;
console.log(`G4: ${report.items.length} items, ${bad} failing, ${results.reduce((a, r) => a + Object.keys(r.views).length, 0)} renders in ${(report.ms / 1000).toFixed(1)} s on ${gpu}\n  report ${join(out, 'report.json')}\n  sheet  ${join(out, 'sheet.html')}`);
for (const it of report.items.filter((i) => !i.ok)) console.log(`  ✖ ${it.id}: ${it.errors.join('; ')}`);
stop(); process.exit(gateExit(report));

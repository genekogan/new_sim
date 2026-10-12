// Lane FORKFIX: the live old world (/w/<world>/) and its fork (/worlds/w/<world>/) side by side, real Chrome (GPU, Chrome lease).
//   node compare-forks.mjs <origin e.g. https://sim.eden.art> <outDir> [world ...]      env DPRS=1,2  SETTLE_MS=15000
// Per world and dpr: the live page loads first; its arrival camera (pose) is captured and then forced on both pages, so
// the views are identical: 'detail' = the live arrival pose, 'overview' = 70 m up and back from its pivot.
// The camera is forced at render time through three.js's own __THREE_DEVTOOLS__ 'observe' hook (no app hook needed).
// Records every same-origin request (status, bytes, cache), failed requests, page/console errors, a scene census of
// the main three.js scene (meshes, instances, tris, named groups) and GL draws/tris of the last frame, and writes
// <world>-dpr<d>-{live,fork}-<view>.png plus <world>-dpr<d>-<view>-sheet.png (live left, fork right) and report.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { chromeLease } from '<worktrees>/root-world-engine/tools/god-skill/lib/chrome-lease.mjs';
const [origin, outArg, ...only] = process.argv.slice(2);
const out = resolve(outArg); mkdirSync(out, { recursive: true });
const { chromium } = createRequire('<worktrees>/root-world-engine/mars/viewer/package.json')('@playwright/test');
const worlds = only.length ? only : ['eden', 'mars', 'littlemartians']; const W = 1352, H = 780;
const SETTLE = Number(process.env.SETTLE_MS ?? 15000);
const DPRS = (process.env.DPRS ?? '1,2').split(',').map(Number);
const PREFIX = process.env.FORK_PREFIX ?? '/worlds';
const probe = () => {
  const st = { cur: { draws: 0, tris: 0 }, last: { draws: 0, tris: 0 }, frames: 0, scenes: [], renderers: [], main: null, pose: null };
  globalThis.__fk = st;
  const tick = () => { st.last = st.cur; st.cur = { draws: 0, tris: 0 }; st.frames++; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  const tri = (mode, n, inst = 1) => (mode === 4 ? n / 3 : mode === 5 || mode === 6 ? Math.max(0, n - 2) : 0) * inst;
  for (const P of [globalThis.WebGL2RenderingContext?.prototype, globalThis.WebGLRenderingContext?.prototype].filter(Boolean)) {
    const wrap = (name, f) => { const o = P[name]; if (o) P[name] = function (...a) { st.cur.draws++; st.cur.tris += f(...a); return o.apply(this, a); }; };
    wrap('drawElements', (m, n) => tri(m, n)); wrap('drawArrays', (m, _f, n) => tri(m, n));
    wrap('drawElementsInstanced', (m, n, _t, _o, i) => tri(m, n, i)); wrap('drawArraysInstanced', (m, _f, n, i) => tri(m, n, i));
  }
  const dev = new EventTarget(); globalThis.__THREE_DEVTOOLS__ = dev;
  dev.addEventListener('observe', (e) => {
    const o = e.detail; if (o?.isScene) st.scenes.push(o);
    else if (o && typeof o.render === 'function' && o.domElement) {
      st.renderers.push(o); const orig = o.render;
      o.render = function (scene, camera) {
        if (camera?.isPerspectiveCamera && this.domElement?.isConnected && this.domElement.clientWidth > 200) {
          st.main = { scene, camera };
          if (st.pose) { camera.position.fromArray(st.pose.p); camera.up.set(0, 1, 0); camera.lookAt(st.pose.t[0], st.pose.t[1], st.pose.t[2]); camera.updateMatrixWorld(true); }
        }
        return orig.call(this, scene, camera);
      };
    }
  });
};
const ready = () => { const h = document.querySelector('.world-canvas-host'); return { revealed: h?.getAttribute('data-initial-revealed') ?? null, arrival: !!document.querySelector('.viewer-arrival') }; };
const census = () => {
  const s = globalThis.__fk; const m = s.main; if (!m) return null;
  const c = { meshes: 0, visibleMeshes: 0, instanced: 0, instances: 0, skinned: 0, points: 0, lines: 0, sprites: 0, tris: 0, lights: 0, objects: 0, groups: {} };
  const triOf = (g) => !g ? 0 : (g.index ? g.index.count : g.attributes?.position?.count ?? 0) / 3;
  const top = (o) => { let n = o; while (n.parent && n.parent !== m.scene) n = n.parent; return n === m.scene ? '(scene)' : (n.name || n.type); };
  m.scene.traverse((o) => {
    c.objects++; if (o.isLight) c.lights++;
    let vis = true; for (let n = o; n; n = n.parent) if (!n.visible) { vis = false; break; }
    if (o.isMesh) {
      c.meshes++; if (o.isSkinnedMesh) c.skinned++;
      const k = o.isInstancedMesh ? o.count : 1; if (o.isInstancedMesh) { c.instanced++; c.instances += k; }
      if (vis) { c.visibleMeshes++; c.tris += triOf(o.geometry) * k; }
      const g = top(o); const e = (c.groups[g] ??= { meshes: 0, visible: 0, tris: 0 }); e.meshes++; if (vis) { e.visible++; e.tris += triOf(o.geometry) * k; }
    } else if (o.isPoints) c.points++; else if (o.isLine) c.lines++; else if (o.isSprite) c.sprites++;
  });
  c.tris = Math.round(c.tris); for (const g of Object.values(c.groups)) g.tris = Math.round(g.tris);
  c.camera = { p: m.camera.position.toArray().map((v) => +v.toFixed(2)), fov: m.camera.fov };
  c.frame = { ...s.last, frames: s.frames }; c.scenes = s.scenes.length; c.renderers = s.renderers.length;
  c.dataset = { ...document.querySelector('canvas[data-scene-hash]')?.dataset }; c.clock = document.querySelector('header')?.textContent.match(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[^A-Za-z]*\d+:\d+\s*[ap]m/)?.[0] ?? null;
  return c;
};
async function sheet(browser, left, right, file, title) {
  const p = await browser.newPage({ viewport: { width: W * 2 + 12, height: H + 34 } });
  const img = (b) => `data:image/png;base64,${b.toString('base64')}`;
  await p.setContent(`<body style="margin:0;background:#111;color:#ddd;font:13px system-ui"><div style="padding:8px">${title} — left: live /w (laptop) · right: fork ${PREFIX}/w (eden2) — same forced camera</div><div style="display:flex;gap:12px"><img src="${img(left)}" width=${W} height=${H}><img src="${img(right)}" width=${W} height=${H}></div></body>`);
  await p.screenshot({ path: file }); await p.close();
}
const release = await chromeLease('forkfix-compare'); const report = [];
try {
  for (const dpr of DPRS) {
    const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
    try {
      for (const world of worlds) {
        const shots = {}; let views = null;
        for (const side of ['live', 'fork']) {
          const url = `${origin}${side === 'live' ? '' : PREFIX}/w/${world}/`;
          const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: dpr });
          await ctx.addInitScript(probe); const page = await ctx.newPage();
          const reqs = [], errors = [], consoleErrors = [], host = new URL(origin).host;
          page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
          page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
          page.on('requestfailed', (r) => reqs.push({ path: r.url().slice(0, 160), status: 0, err: r.failure()?.errorText }));
          page.on('response', (r) => {
            const u = new URL(r.url()); if (u.host !== host) return; const h = r.headers();
            reqs.push({ path: u.pathname + (u.search.length < 40 ? u.search : '?…'), status: r.status(), type: (h['content-type'] || '').split(';')[0], len: Number(h['content-length'] || 0), via: h['via'] ? 'proxied' : 'caddy', cache: h['cache-control'] || '' });
          });
          const t0 = Date.now(); await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
          let st; for (;;) { st = await page.evaluate(ready).catch(() => null); if (st && st.revealed === 'true' && !st.arrival) break; if (Date.now() - t0 > 150000) break; await page.waitForTimeout(300); }
          const arrivalMs = Date.now() - t0; await page.waitForTimeout(SETTLE);
          const run = { world, dpr, side, url, arrivalMs, ready: st, views: {} };
          run.views.arrival = await page.evaluate(census);
          shots[`${side}-arrival`] = await page.screenshot({ path: resolve(out, `${world}-dpr${dpr}-${side}-arrival.png`) });
          if (!views) {
            const pv = await page.evaluate(() => globalThis.__simCamera ?? null); const cam = run.views.arrival?.camera?.p;
            const t = pv?.pivot ?? [0, 0, 0], p = pv?.p ?? cam ?? [0, 30, 30];
            views = { detail: { p, t }, overview: { p: [t[0], t[1] + 70, t[2] + 70], t } };
          }
          for (const [name, pose] of Object.entries(views)) {
            await page.evaluate((v) => { globalThis.__fk.pose = v; }, pose); await page.waitForTimeout(name === 'overview' ? 9000 : 5000);
            run.views[name] = await page.evaluate(census);
            shots[`${side}-${name}`] = await page.screenshot({ path: resolve(out, `${world}-dpr${dpr}-${side}-${name}.png`) });
          }
          run.errors = errors; run.consoleErrors = consoleErrors.slice(0, 25);
          run.bad = reqs.filter((r) => r.status === 0 || r.status >= 400);
          run.requests = reqs; report.push(run);
          const v = run.views; const sum = (k) => k && { meshes: k.meshes, vis: k.visibleMeshes, inst: k.instances, tris: k.tris, draws: k.frame?.draws, glTris: k.frame?.tris, clock: k.clock };
          console.log(JSON.stringify({ world, dpr, side, arrivalMs, detail: sum(v.detail), overview: sum(v.overview), reqs: reqs.length, bad: run.bad.map((r) => `${r.status} ${r.path}`).slice(0, 12), errors: errors.length }));
          await ctx.close();
        }
        for (const view of ['arrival', 'detail', 'overview']) await sheet(browser, shots[`live-${view}`], shots[`fork-${view}`], resolve(out, `${world}-dpr${dpr}-${view}-sheet.png`), `${world} dpr ${dpr} ${view}`);
      }
    } finally { await browser.close(); }
  }
} finally { release(); }
writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 1));

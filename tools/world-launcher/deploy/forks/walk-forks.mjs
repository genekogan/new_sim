// Lane FORKS: walk the old-world forks as a stranger in real Chrome (GPU, Chrome lease), dpr 1 and 2, real mouse/wheel/keys.
//   node walk-forks.mjs <origin e.g. https://sim.eden.art> <outDir> [world ...]
// Per world: arrival time, canvas geometry, drag/wheel/W/double-click camera moves, page errors, failed requests,
// requests outside /worlds (on the same origin), the CLI served, and natives moving (two /v1/take samples 8 s apart).
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { chromeLease } from '<worktrees>/root-world-engine/tools/god-skill/lib/chrome-lease.mjs';
const [origin, outArg, ...only] = process.argv.slice(2);
const out = resolve(outArg); mkdirSync(out, { recursive: true });
const { chromium } = createRequire('<worktrees>/root-world-engine/mars/viewer/package.json')('@playwright/test');
const worlds = only.length ? only : ['eden', 'mars', 'littlemartians']; const W = 1352, H = 780;
const geometry = () => { const c = document.querySelector('canvas[aria-label="Live 3D view of the world"]'); const r = c?.getBoundingClientRect(); return { window: [innerWidth, innerHeight], dpr: devicePixelRatio, canvasCss: r && [Math.round(r.width), Math.round(r.height)], buffer: c && [c.width, c.height] }; };
const ui = () => { const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  return { buttons: [...document.querySelectorAll('header button, header a, .hud-actions button, .hud-actions a')].filter(vis).map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)).sort(),
    simEntity: '__simEntity' in window, arrival: !!document.querySelector('.viewer-arrival'), revealed: document.querySelector('.world-canvas-host')?.getAttribute('data-initial-revealed') ?? null }; };
const cam = () => globalThis.__simCamera ?? null;
const moved = (a, b, k) => !!(a && b) && a[k].some((v, i) => Math.abs(v - b[k][i]) > 0.01);
async function natives(world) {
  const get = async () => { const d = await (await fetch(`${origin}/worlds/w/${world}/v1/take`)).json(); const c = d.chunks?.at(-1)?.take; return c ? Object.fromEntries(Object.values(c.finalState.entities).filter((e) => e.kind !== 'component' && e.pose?.p).map((e) => [e.id, e.pose.p])) : {}; };
  const a = await get(); await new Promise((r) => setTimeout(r, 8000)); const b = await get();
  const ids = Object.keys(a).filter((id) => b[id]);
  const movers = ids.filter((id) => Math.hypot(a[id][0] - b[id][0], a[id][2] - b[id][2]) > 0.05);
  return { bodies: ids.length, moved: movers.length, sample: movers.slice(0, 6) };
}
const release = await chromeLease('forks-walk'); const report = [];
try {
  for (const dpr of [1, 2]) {
    const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
    try {
      for (const world of worlds) {
        const tag = `${world}-dpr${dpr}`; const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: dpr }); const page = await ctx.newPage();
        const errors = [], consoleErrors = [], failed = [], outside = new Set(), host = new URL(origin).host;
        page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
        page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });
        page.on('requestfailed', (r) => failed.push(`${r.failure()?.errorText} ${r.url().slice(0, 140)}`));
        page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url().slice(0, 140)}`); });
        page.on('request', (r) => { const u = new URL(r.url()); if (u.host === host && !u.pathname.startsWith('/worlds/')) outside.add(u.pathname.replace(/[^/]+$/, '*')); });
        const t0 = Date.now(); await page.goto(`${origin}/worlds/w/${world}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
        let state; for (;;) { state = await page.evaluate(ui).catch(() => null); if (state && state.revealed === 'true' && !state.arrival) break; if (Date.now() - t0 > 150000) break; await page.waitForTimeout(300); }
        const arrivalMs = Date.now() - t0; await page.waitForTimeout(2000);
        const run = { tag, world, dpr, arrivalMs, geometry: await page.evaluate(geometry), ui: await page.evaluate(ui) };
        await page.screenshot({ path: resolve(out, `${tag}-arrived.png`) });
        const a = await page.evaluate(cam); const cx = Math.round(W * 0.5), cy = Math.round(H * 0.55);
        await page.mouse.move(cx, cy); await page.mouse.down(); for (let k = 1; k <= 10; k++) await page.mouse.move(cx + k * 16, cy - k * 2); await page.mouse.up(); await page.waitForTimeout(700); const d = await page.evaluate(cam);
        await page.mouse.move(cx, cy); await page.mouse.wheel(0, -600); await page.waitForTimeout(900); const wh = await page.evaluate(cam);
        await page.keyboard.down('w'); await page.waitForTimeout(1000); await page.keyboard.up('w'); await page.waitForTimeout(400); const k = await page.evaluate(cam);
        await page.mouse.dblclick(Math.round(W * 0.42), Math.round(H * 0.68)); await page.waitForTimeout(2500); const dc = await page.evaluate(cam);
        run.input = { drag: moved(a, d, 'p'), wheel: moved(d, wh, 'p'), wasd: moved(wh, k, 'p'), doubleClick: moved(k, dc, 'pivot') };
        await page.screenshot({ path: resolve(out, `${tag}-after-input.png`) });
        if (dpr === 1) {
          run.natives = await natives(world);
          const cli = await fetch(`${origin}/worlds/w/${world}/eden-agent.mjs`); const body = await cli.text();
          run.cli = { status: cli.status, bytes: body.length, sha256: (await import('node:crypto')).createHash('sha256').update(body).digest('hex').slice(0, 8) };
        }
        run.errors = errors; run.consoleErrors = consoleErrors.slice(0, 10); run.failed = failed.slice(0, 20); run.outside = [...outside].sort(); report.push(run);
        console.log(JSON.stringify({ tag, arrivalMs, geom: run.geometry, input: run.input, natives: run.natives, cli: run.cli, buttons: run.ui.buttons, ent: run.ui.simEntity, errors: errors.length, consoleErrors: consoleErrors.length, failed: failed.length, outside: run.outside.length }));
        await ctx.close();
      }
    } finally { await browser.close(); }
  }
} finally { release(); }
writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 1));

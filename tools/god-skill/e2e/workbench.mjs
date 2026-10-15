#!/usr/bin/env node
// W1 local-only acceptance. Node22.20; fresh fake world on 127.0.0.1:5362; always stops its server.
// Writes screenshots and machine-readable evidence below .e2e/runs/. No paid providers or external requests.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kitLook, defineKit, look } from '../cli.mjs';
import { findPlaywright, shoot } from '../lib/look.mjs';
const apiOnly = process.argv.includes('--api-only');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), cwd = process.cwd();
const out = resolve(root, '.e2e/runs', `w1-workbench-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(out, { recursive: true }); const data = mkdtempSync(resolve(tmpdir(), 'sim-w1-'));
const base = 'http://127.0.0.1:5362/w/w1-workbench', results = { status: 'running', port: 5362, steps: [], measures: {}, externalRequests: [], consoleErrors: [], captures: [] };
const genesis = resolve(data, 'genesis.json'); writeFileSync(genesis, JSON.stringify({ schema: 'genesis/1', name: 'W1 workbench', constants: { ground: 'land', extent: 100 }, state: { sky: { palette: 'clear-day', sun: .7 } }, batches: [] }));
let server, logs = '', token = '', defineCalls = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(path, body, auth = token) {
  const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
  const json = await r.json(); assert.equal(r.status, 200, JSON.stringify(json)); return json;
}
const pw = apiOnly ? null : findPlaywright(); assert.ok(apiOnly || pw, 'existing local Playwright is required (set EDEN_GOD_NO_NPX=1)');
const restrictedPw = { chromium: { launch: async options => {
  const browser = await pw.chromium.launch(options), newContext = browser.newContext.bind(browser);
  browser.newContext = async options => {
    const ctx = await newContext(options);
    await ctx.route('**/*', route => { const u = new URL(route.request().url()); if (u.hostname === '127.0.0.1' && u.port === '5362') return route.continue(); results.externalRequests.push(u.origin); return route.abort(); });
    ctx.on('page', page => {
      page.on('pageerror', e => results.consoleErrors.push(String(e)));
      const evaluate = page.evaluate.bind(page);
      page.evaluate = async (fn, arg) => {
        if (fn.name === 'waitForShot') results.captures.push({ readinessWait: true });
        if (fn.name === 'composeSheet') results.captures.push({ labels: arg.cells.map(c => c.label), hashes: arg.cells.map(c => createHash('sha256').update(c.data).digest('hex')) });
        return evaluate(fn, arg);
      };
    });
    return ctx;
  };
  return browser;
} } };
const capture = args => shoot({ ...args, timeoutMs: 45000 }, { pw: restrictedPw });
async function step(name, fn) { const start = Date.now(); const result = await fn(); results.steps.push({ name, ok: true, ms: Date.now() - start, result }); console.log(`${name}: PASS (${Date.now() - start} ms)`); return result; }
try {
  try { await fetch('http://127.0.0.1:5362/healthz', { signal: AbortSignal.timeout(500) }); throw Error('Port 5362 is occupied; refusing to reuse another process'); } catch (e) { if (e.message?.includes('occupied')) throw e; }
  server = spawn(process.execPath, ['apps/server/src/main.ts'], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: '5362', WORLD_KEY: 'w1-workbench', WORLD_ID: 'w1-workbench-1', WORLD_NAME: 'W1 workbench', ENGINE: 'mars', DATA_DIR: data, ACCOUNT_REGISTRY_PATH: resolve(data, 'accounts.sqlite'), ACCOUNT_AUTH_REQUIRED: '0', PUBLIC_URL: 'http://127.0.0.1:5362', DEV_AUTH: '1', BRAIN_MODE: 'fake', MIND_DRIVER: 'edge', SEED_NATIVES: '0', SOUL_LIFECYCLE: '1', INVITE_REQUIRED: '0', GENESIS_FILE: genesis, WEB_DIR: resolve(root, 'apps/web/dist'), MARS_WEB_DIR: resolve(data, 'no-mars'), ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', b => { logs += b; }); server.stderr.on('data', b => { logs += b; });
  let ready = false;
  for (let i = 0; i < 300 && !ready; i++) { if (server.exitCode !== null) throw Error(`server exited ${server.exitCode}: ${logs.slice(-1500)}`); try { ready = (await fetch(base + '/healthz')).ok; } catch {} if (!ready) await sleep(100); }
  assert.ok(ready, 'isolated server startup');
  token = (await api('/v1/god/mint', { label: 'W1 smoke' }, 'dev:admin')).token; assert.ok(token);
  const godDir = resolve(out, 'god'); mkdirSync(godDir); process.chdir(godDir);
  writeFileSync('.eden-god.json', JSON.stringify({ world: base, token }));
  const kit = { name: 'w1-motion-chair', tags: ['furniture'], shapes: [
    { kind: 'rbox', at: [0, .75, 0], size: [1.5, .18, 1], color: '#cb793f' },
    { kind: 'box', at: [0, 1.2, -.44], size: [1.5, .9, .12], color: '#b96432', pitch: .16 },
    { kind: 'box', at: [-.55, .35, 0], size: [.14, .7, .8], color: '#5c4b3e' },
    { kind: 'box', at: [.55, .35, 0], size: [.14, .7, .8], color: '#5c4b3e' }
  ], slots: [{ id: 'seat', kind: 'seat', p: [0, .85, 0] }], components: { spin: { axis: 'y', rpm: 12 } } };
  const before = await api('/v1/god/snapshot'), journal = await api('/v1/god/edits');
  await step('workbench no-world iteration, 3 previews / beside church / hour 21', async () => {
    let shot;
    for (let i = 0; i < 3; i++) {
      const candidate = structuredClone(kit); candidate.shapes[0].color = ['#ae713f', '#c17e48', '#cb793f'][i];
      if (apiOnly) {
        const { kitDefinition } = await import('../lib/kit.mjs');
        const admitted = await api('/v1/god/kit/render', { def: kitDefinition(candidate), beside: 'core/church@1' });
        assert.equal(admitted.accepted, true); assert.equal(admitted.def.ref, 'w1-motion-chair@1'); assert.ok(admitted.beside);
        continue;
      }
      shot = await kitLook(candidate, { beside: 'core/church@1', hour: '21', out: resolve(out, `kit-${i + 1}.png`), json: true, width: 640, h: 420 }, { shoot: capture });
      assert.equal(shot.views.length, 4); assert.ok(shot.colliders > 0); assert.equal(shot.seats, 1); assert.match(shot.warnings.join(' '), /Tilted collider/);
    }
    const after = await api('/v1/god/snapshot'); assert.equal(after.seq, before.seq); assert.equal(after.entities.length, before.entities.length); assert.equal(after.library.length, before.library.length); assert.deepEqual(await api('/v1/god/edits'), journal);
    results.measures.workbenchJournalUnchanged = true; results.measures.trialEntities = 0; results.measures.trialDefs = 0;
    return { seqBefore: before.seq, seqAfter: after.seq, views: shot?.views, warnings: shot?.warnings };
  });
  await step('publish the final kit once, then place it', async () => {
    defineCalls++; const r = await defineKit(kit); assert.ok(!/^REFUSED/.test(String(r)), String(r));
    const placed = await api('/v1/god/act', { ops: [{ op: 'place', def: 'w1-motion-chair@1', name: 'chair', p: [0, 0] }] }); assert.equal(placed.accepted, true, JSON.stringify(placed));
    results.measures.defineKitCalls = defineCalls; return { seq: placed.seq, defineKitCalls: defineCalls };
  });
  if (!apiOnly) {
  await step('four-view sheet, one readiness wait, hour/weather retained', async () => {
    const before = results.captures.filter(c => c.readinessWait).length, t = Date.now();
    const r = await look({ at: 'chair', views: 'sw;w --dist 10;above;inside', span: '4', hour: '21', weather: 'rain', out: resolve(out, 'views.png'), json: true }, { shoot: capture });
    const ms = Date.now() - t; assert.equal(r.cells, 4); assert.equal(results.captures.filter(c => c.readinessWait).length - before, 1); assert.ok(ms <= 9000, `four views took ${ms} ms (budget 9000)`);
    results.measures.fourViewMs = ms; return { ms, cells: r.cells };
  });
  await step('current site default views', async () => {
    const b = await api('/v1/god/builds', { id: 'w1-site', title: 'Chair study', steps: ['seat', 'finish'], site: { at: [0, 0], size: [8, 8], yaw: 0 } }); assert.equal(b.ok, true, JSON.stringify(b));
    writeFileSync('.eden-god.json', JSON.stringify({ world: base, token, build: { id: 'w1-site' } }));
    const r = await look({ site: true, out: resolve(out, 'site.png'), json: true }, { shoot: capture }); assert.equal(r.cells, 4);
    writeFileSync('.eden-god.json', JSON.stringify({ world: base, token }));
    return { cells: r.cells, at: r.at };
  });
  await step('motion strip has 4 distinct timed frames', async () => {
    const r = await look({ at: 'chair', from: 'sw', frames: 4, every: 250, span: '3', out: resolve(out, 'frames.png'), json: true }, { shoot: capture });
    assert.equal(r.cells, 4); const cells = results.captures.filter(c => c.hashes).at(-1); assert.equal(new Set(cells.hashes).size, 4);
    assert.ok(r.frames.at(-1).ms >= 650); return { timestamps: r.frames.map(f => f.ms), distinctFrames: new Set(cells.hashes).size };
  });
  }
  await step('cleanup retires only never-placed trial, undo and redo restore/retire', async () => {
    const trial = structuredClone(kit); trial.name = 'w1-never-placed';
    const r = await defineKit(trial); assert.ok(!/^REFUSED/.test(String(r)), String(r));
    const before = await api('/v1/god/defs/unused'); assert.deepEqual(before.defs.map(d => d.ref), ['w1-never-placed@1']);
    const removed = await api('/v1/god/defs/unused/remove', {}); assert.equal(removed.accepted, true); assert.equal((await api('/v1/god/defs/unused')).defs.length, 0);
    assert.equal((await api('/v1/god/undo', {})).accepted, true); assert.equal((await api('/v1/god/defs/unused')).defs.length, 1);
    assert.equal((await api('/v1/god/redo', {})).accepted, true); assert.equal((await api('/v1/god/defs/unused')).defs.length, 0);
    return { removed: removed.removed, cleanupSeq: removed.seq };
  });
  assert.deepEqual(results.consoleErrors, []); results.status = apiOnly ? 'partial' : 'pass';
  if (apiOnly) results.skipped = ['Browser screenshots, four-view <=9s, site views and motion-pixel verification require a permitted Chrome launch.'];
} catch (e) { results.status = 'fail'; results.error = String(e.stack ?? e); console.error(results.error); process.exitCode = 1; }
finally {
  process.chdir(cwd); if (server && server.exitCode === null) { server.kill('SIGTERM'); await Promise.race([once(server, 'exit'), sleep(5000)]); if (server.exitCode === null) { server.kill('SIGKILL'); await once(server, 'exit'); } }
  results.serverStopped = !server || server.exitCode !== null || server.signalCode !== null;
  // Never retain operator credentials in the proof bundle.
  mkdirSync(resolve(out, 'god'), { recursive: true });
  writeFileSync(resolve(out, 'god/.eden-god.json'), JSON.stringify({ world: base, token: '[removed after smoke]' }));
  writeFileSync(resolve(out, 'server.log'), logs.replace(/god_[A-Za-z0-9_-]+/g, 'god_[redacted]'));
  writeFileSync(resolve(out, 'summary.json'), JSON.stringify(results, null, 2));
  writeFileSync(resolve(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>W1 workbench proof</title><style>body{max-width:1200px;margin:24px auto;font:16px system-ui}img{max-width:100%}pre{white-space:pre-wrap}</style><h1>W1 workbench: ${results.status}</h1><pre>${JSON.stringify(results, null, 2).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>${['kit-3.png', 'views.png', 'site.png', 'frames.png'].map(f => `<h2>${f}</h2><img src="${f}" alt="${f}">`).join('')}`);
  console.log(`proof: ${out}/index.html`);
}

#!/usr/bin/env node
// W2b acceptance: disposable Eden district on 5368 at hour 21, real remote CLI PNG vs local shoot.
// Run with Node 22.20 and NODE_USE_SYSTEM_CA unset. Uses already-installed test tools; never downloads packages.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { shoot, findPlaywright } from '../lib/look.mjs';
import { chromeLease } from '../lib/chrome-lease.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const base = 'http://127.0.0.1:5368/w/remote-looks';
const out = resolve(root, '.lane/remote-looks', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(out, { recursive: true });
const template = resolve(root, 'worlds/templates/eden-district.json'), hour = '21:00';
const temp = mkdtempSync(join(tmpdir(), 'remote-looks-smoke-')), report = { base, out, template, hour, checks: [], timings: {} };
const exec = promisify(execFile), cliFile = resolve(root, 'tools/god-skill/eden-god.mjs');
const env = { ...process.env, HOST: '127.0.0.1', PORT: '5368', WORLD_KEY: 'remote-looks', WORLD_ID: 'remote-looks-1', WORLD_OWNER_ID: 'dev:admin',
  PUBLIC_URL: 'http://127.0.0.1:5368', GENESIS_FILE: template, DATA_DIR: join(temp, 'data'), ASSET_DIR: join(temp, 'assets'), ENGINE: 'mars', DEV_AUTH: '1', AUTH_PROVIDER: 'none',
  SEED_NATIVES: '0', BRAIN_MODE: 'fake', MIND_DRIVER: 'edge', INVITE_REQUIRED: '0', ARCHIVE_TAKES: '0', TAKES_PERSIST: '0',
  MARS_WEB_DIR: resolve(root, '.lane/mars-web'), ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', TYPESAFE_API_KEY: '', EDEN_GOD_NO_NPX: '1' };
delete env.NODE_USE_SYSTEM_CA;
let server, release = () => {};
const check = (name, details) => { report.checks.push({ name, ok: true, ...details }); console.log(`PASS ${name}`); };
const cli = async (...args) => { const r = await exec(process.execPath, [cliFile, ...args], { cwd: temp, env, timeout: 100_000 }); return r.stdout; };
try {
  // A foreign listener must never be reused or stopped.
  const { createServer } = await import('node:net');
  await new Promise((resolve, reject) => { const probe = createServer(); probe.once('error', reject); probe.listen(5368, '127.0.0.1', () => probe.close(resolve)); });
  release = await chromeLease('W2 remote look acceptance', { waitMs: 60_000 });
  const log = openSync(join(out, 'server.log'), 'a');
  server = spawn(process.execPath, ['apps/server/src/main.ts'], { cwd: root, env, stdio: ['ignore', log, log] }); closeSync(log);
  for (let i = 0; ; i++) {
    if (server.exitCode !== null || i > 600) throw Error('disposable world failed to boot; see server.log');
    try { if ((await fetch(base + '/healthz')).ok) break; } catch { /* booting */ }
    await new Promise(r => setTimeout(r, 100));
  }
  check('fake world ready on own port');
  assert.equal((await fetch(base + '/v1/god/look', { method: 'POST', body: '{}' })).status, 401); check('real route rejects unauthenticated look');
  await cli('register', base, 'dev:admin'); await cli('mint');
  const { token } = JSON.parse(readFileSync(join(temp, '.eden-god.json')));
  const response = await fetch(base + '/v1/god/snapshot', { headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  const snapshot = await response.json();
  assert.ok(snapshot.entities.length >= 150, 'the full Eden district, including furnished buildings, must be present');
  report.entities = snapshot.entities.length;
  check('heavy Eden district booted from genesis template', { entities: snapshot.entities.length, seq: snapshot.seq });
  const before = await (await fetch(base + '/v1/world/seq')).json();
  const args = ['look', '--remote', '--at', '20,10', '--from', 's', '--dist', '180', '--hour', '21', '--weather', 'clear', '--width', '1024', '--h', '640', '--out', join(out, 'remote.png'), '--json'];
  const remote = JSON.parse(await cli(...args));
  assert.equal(remote.via, 'remote'); assert.equal(remote.size, '1024x640');
  check('downloaded CLI --remote returns full-resolution night PNG and actual size', { ms: remote.ms, eye: remote.eye, at: remote.at, size: remote.size });
  report.timings.remoteMs = remote.ms;
  const pw = findPlaywright(); assert.ok(pw, 'local comparison requires already-installed Playwright');
  // Same request/resource boundary for the local reference. The product's local shoot applies its ordinary camera logic.
  const guardedPw = { chromium: { launch: async options => {
    const browser = await pw.chromium.launch({ ...options, args: [...options.args, '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
    const original = browser.newContext.bind(browser);
    browser.newContext = async options => { const context = await original(options); await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:5368' ? route.continue() : route.abort()); return context; };
    return browser;
  } } };
  const local = await shoot({ worldUrl: base, eye: remote.eye, at: remote.at, out: join(out, 'local.png'), hour, weather: 'clear', width: 1024, height: 640, expect: snapshot.entities.length, timeoutMs: 60_000 }, { pw: guardedPw, lease: async () => () => {} });
  assert.equal(local.via, 'chrome'); assert.equal(local.state.ready, true); check('local reference captured with identical camera', { ms: local.ms, frames: local.frames });
  report.timings.localMs = local.ms;
  const { PNG } = createRequire(resolve(root, 'mars/viewer/package.json'))('pngjs');
  const a = PNG.sync.read(readFileSync(remote.file)), b = PNG.sync.read(readFileSync(local.file));
  assert.equal(a.width, 1024); assert.equal(a.height, 640); assert.equal(a.width, b.width); assert.equal(a.height, b.height);
  let sum = 0, squares = 0, different = 0, pixels = 0; const colors = new Set();
  for (let i = 0; i < a.data.length; i += 4) {
    colors.add(`${a.data[i] >> 4},${a.data[i + 1] >> 4},${a.data[i + 2] >> 4}`);
    let delta = 0;
    for (let c = 0; c < 3; c++) { const d = Math.abs(a.data[i + c] - b.data[i + c]); sum += d; squares += d * d; delta += d; }
    if (delta > 60) different++; pixels++;
  }
  const comparison = { quantizedColors: colors.size, meanAbsoluteError: sum / (pixels * 3), rmse: Math.sqrt(squares / (pixels * 3)), changedFraction: different / pixels };
  assert.ok(colors.size > 50, 'PNG is non-blank'); assert.ok(comparison.meanAbsoluteError < 8 && comparison.changedFraction < 0.08, `framing mismatch: ${JSON.stringify(comparison)}`);
  check('PNG is non-blank and matches local framing within tolerance', comparison);
  const after = await (await fetch(base + '/v1/world/seq')).json(); assert.equal(after.seq, before.seq); check('looks leave edit sequence unchanged');
  report.status = 'pass';
} catch (e) {
  report.status = 'fail'; report.error = String(e.stack ?? e); console.error(report.error); process.exitCode = 1;
} finally {
  if (server) { server.kill('SIGTERM'); await new Promise(r => { if (server.exitCode !== null || server.signalCode !== null) return r(); const timer = setTimeout(() => server.kill('SIGKILL'), 5000); server.once('exit', () => { clearTimeout(timer); r(); }); }); }
  release(); rmSync(temp, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString(); writeFileSync(join(out, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(out, 'index.html'), `<!doctype html><title>W2 remote look acceptance</title><h1>${report.status}</h1><pre>${JSON.stringify(report, null, 2).replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</pre><h2>Remote</h2><img width="800" src="remote.png"><h2>Local</h2><img width="800" src="local.png">`);
  console.log(`Evidence: ${out}/index.html`);
}

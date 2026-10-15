import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { shoot } from './look.mjs';
import { checkArgs, parseFlags } from '../cli.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'remote-look-test-')), calls = [], previous = process.env.EDEN_GOD_LOOK;
  delete process.env.EDEN_GOD_LOOK;
  t.after(() => { rmSync(dir, { recursive: true, force: true }); if (previous === undefined) delete process.env.EDEN_GOD_LOOK; else process.env.EDEN_GOD_LOOK = previous; });
  const args = { worldUrl: 'http://127.0.0.1:5368/w/looks', eye: [0, 10, 20], at: [0, 0, 0], out: join(dir, 'looks', 'same-name.png'), hideRoofs: true, cut: 1, span: 12, hour: '21:00', weather: 'rain', width: 1024, height: 640, expect: 40, cliPath: '/fixture/cli.mjs' };
  const runtime = { load: () => ({ token: 'fixture-token' }), fetch: async (url, options) => { calls.push({ url, ...options }); return new Response(png, { headers: { 'content-type': 'image/png', 'x-look-size': '1x1' } }); } };
  return { dir, args, runtime, calls };
}

test('look --remote and env use authenticated world PNG with unchanged output path and no local launch', async t => {
  const f = fixture(t);
  const { flags, rest } = parseFlags(['--remote']); checkArgs('look', flags, rest); assert.equal(flags.remote, true);
  let launched = false;
  const runtime = { ...f.runtime, pw: { chromium: { launch: () => { launched = true; throw Error('must not launch'); } } } };
  for (const fromEnv of [false, true]) {
    if (fromEnv) process.env.EDEN_GOD_LOOK = 'remote';
    const result = await shoot({ ...f.args, remote: !fromEnv }, runtime);
    assert.equal(result.file, f.args.out); assert.equal(result.via, 'remote'); assert.ok(result.ms >= 0);
    assert.equal(result.size, '1x1', 'report the actual PNG size, including a mismatch');
    assert.deepEqual(readFileSync(f.args.out), png);
  }
  assert.equal(launched, false); assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].url, f.args.worldUrl + '/v1/god/look');
  assert.equal(f.calls[0].headers.authorization, 'Bearer fixture-token'); assert.equal(f.calls[0].redirect, 'error');
  assert.deepEqual(JSON.parse(f.calls[0].body), Object.fromEntries(['eye', 'at', 'hideRoofs', 'cut', 'span', 'hour', 'weather', 'width', 'height'].map(k => [k, f.args[k]])));
});

test('Chrome launch failure falls back after releasing local lease', async t => {
  const f = fixture(t); let released = 0, launched = 0;
  const result = await shoot(f.args, { ...f.runtime, lease: async () => () => { released++; }, pw: { chromium: { launch: async () => { launched++; throw Error('browserType.launch: Target page, context or browser has been closed'); } } } });
  assert.equal(launched, 1); assert.equal(released, 1); assert.equal(result.via, 'remote'); assert.equal(f.calls.length, 1);
  assert.deepEqual(readFileSync(f.args.out), png);
});

test('missing Chrome goes remote before Playwright discovery/npx and does not need a lease', async t => {
  const f = fixture(t); let leased = false, spawned = false;
  const result = await shoot(f.args, { ...f.runtime, chromeExists: () => false, lease: async () => { leased = true; }, spawnSync: () => { spawned = true; throw Error('must not spawn npx'); } });
  assert.equal(result.via, 'remote'); assert.equal(leased, false); assert.equal(spawned, false);
});

test('sheets, frame strips and workbench clearly require local Chrome instead of returning one remote view', async t => {
  const f = fixture(t);
  const modes = [{ views: [{ eye: f.args.eye, at: f.args.at }] }, { frames: 3, every: 250 }, { studio: { accepted: true, defs: [] } }];
  for (const mode of modes) {
    await assert.rejects(shoot({ ...f.args, ...mode, remote: true }, f.runtime), /require local Playwright and Google Chrome.*single views only/);
    await assert.rejects(shoot({ ...f.args, ...mode }, { ...f.runtime, chromeExists: () => false }), /require local Playwright and Google Chrome/);
    await assert.rejects(shoot({ ...f.args, ...mode, keep: true }, { ...f.runtime, pw: null }), /require local Playwright and Google Chrome/);
    await assert.rejects(shoot({ ...f.args, ...mode }, { ...f.runtime, lease: async () => () => {}, pw: { chromium: { launch: async () => { throw Error('cannot start Chrome'); } } } }), /require local Playwright and Google Chrome/);
  }
  process.env.EDEN_GOD_LOOK = 'remote';
  await assert.rejects(shoot({ ...f.args, frames: 2 }, f.runtime), /require local Playwright and Google Chrome/);
  assert.equal(f.calls.length, 0); assert.equal(existsSync(f.args.out), false);
});

test('a sandbox npx/Playwright failure also falls back', async t => {
  const f = fixture(t);
  const result = await shoot(f.args, { ...f.runtime, pw: null, spawnSync: () => ({ status: 1, stderr: 'EPERM: cache not writable' }) });
  assert.equal(result.via, 'remote'); assert.equal(f.calls.length, 1);
});

test('--keep with no Playwright falls back without npx, lease or keeper startup', async t => {
  const f = fixture(t);
  const unexpected = () => { throw Error('must not start local renderer'); };
  const result = await shoot({ ...f.args, keep: true }, { ...f.runtime, pw: null, spawnSync: unexpected, lease: unexpected, ensureKeeper: unexpected });
  assert.equal(result.via, 'remote'); assert.equal(f.calls.length, 1);
  assert.deepEqual(readFileSync(f.args.out), png);
});

test('--keep falls back on keeper startup or CDP connection failures', async t => {
  const f = fixture(t);
  for (const failedConnection of [false, true]) {
    const result = await shoot({ ...f.args, keep: true }, { ...f.runtime,
      ensureKeeper: async () => { if (!failedConnection) throw Error('EACCES: keeper cannot start'); return { port: 1 }; },
      pw: { chromium: { connectOverCDP: async () => { throw Error('ECONNREFUSED'); } } },
    });
    assert.equal(result.via, 'remote');
  }
  assert.equal(f.calls.length, 2);
});

test('a real keeper child that exits is detected promptly and falls back without leaving keeper state', async t => {
  const f = fixture(t), cwd = process.cwd();
  process.chdir(f.dir); t.after(() => process.chdir(cwd));
  const cliPath = join(f.dir, 'failed-keeper.mjs'); writeFileSync(cliPath, 'process.exit(1);\n');
  const started = Date.now();
  const result = await shoot({ ...f.args, keep: true, cliPath }, { ...f.runtime, pw: { chromium: { connectOverCDP: async () => { throw Error('must not connect to exited keeper'); } } } });
  assert.equal(result.via, 'remote'); assert.ok(Date.now() - started < 5000);
  assert.equal(existsSync(join(f.dir, '.eden-god.look.json')), false);
});

test('CLI prints the actual remote PNG size in text and JSON', async t => {
  const f = fixture(t), cliPath = resolve('tools/god-skill/cli.mjs');
  const server = createServer(async (req, res) => {
    let body = ''; for await (const b of req) body += b;
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    if (path.endsWith('/look')) { res.writeHead(200, { 'content-type': 'image/png', 'x-look-size': '1x1' }); res.end(png); return; }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(path.endsWith('/seq') ? { seq: 0 } : path.endsWith('/snapshot') ? { seq: 0, constants: { extent: 100 }, entities: [] } : JSON.parse(body).layout ? { layout: { entities: [] } } : { points: [{ y: 0, water: 0 }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  writeFileSync(join(f.dir, '.eden-god.json'), JSON.stringify({ world: `http://127.0.0.1:${server.address().port}`, token: 'fixture-token' }));
  const exec = promisify(execFile), env = { ...process.env, EDEN_GOD_NO_NPX: '1' }; delete env.NODE_USE_SYSTEM_CA;
  const args = [cliPath, 'look', '--remote', '--out', f.args.out];
  assert.match((await exec(process.execPath, args, { cwd: f.dir, env })).stdout, /1x1 px/);
  assert.equal(JSON.parse((await exec(process.execPath, [...args, '--json'], { cwd: f.dir, env })).stdout).size, '1x1');
});

test('unrelated local rendering errors remain visible and do not trigger another render', async t => {
  const f = fixture(t); let closed = false;
  const browser = { newContext: async () => ({ addInitScript: async () => {}, newPage: async () => ({ goto: async () => {}, evaluate: async () => ({ ready: false, why: 'no entity world on this page' }) }) }), close: async () => { closed = true; } };
  await assert.rejects(shoot(f.args, { ...f.runtime, lease: async () => () => {}, pw: { chromium: { launch: async () => browser } } }), /no entity layer/);
  assert.equal(closed, true); assert.equal(f.calls.length, 0); assert.equal(existsSync(f.args.out), false);
});

test('remote refusal, malformed PNG and missing token do not write a screenshot', async t => {
  const f = fixture(t);
  await assert.rejects(shoot({ ...f.args, remote: true }, { ...f.runtime, fetch: async () => Response.json({ code: 'look.unavailable', message: 'Install Google Chrome on world host' }, { status: 503 }) }), /look.unavailable.*Install Google Chrome/);
  await assert.rejects(shoot({ ...f.args, remote: true }, { ...f.runtime, fetch: async () => Response.json({ code: 'rate-limited', message: 'too many looks', retry_after: 5 }, { status: 429 }) }), /rate-limited.*retry in 5s/);
  await assert.rejects(shoot({ ...f.args, remote: true }, { ...f.runtime, fetch: async () => new Response('not a PNG', { headers: { 'content-type': 'image/png' } }) }), /did not return a PNG/);
  await assert.rejects(shoot({ ...f.args, remote: true }, { ...f.runtime, load: () => ({}) }), /needs a god token/);
  assert.equal(existsSync(f.args.out), false);
});

for (const fallback of ['remote', 'missing Chrome', 'launch failure', 'keeper failure']) test(`one look deadline aborts ${fallback} remote fetch and rejects a late PNG`, { timeout: 2000 }, async t => {
  const f = fixture(t); let signal, respond, released = 0;
  const runtime = { ...f.runtime, fetch: async (_url, options) => { signal = options.signal; return new Promise(resolve => { respond = resolve; }); } };
  if (fallback === 'missing Chrome') runtime.chromeExists = () => false;
  if (fallback === 'launch failure') {
    runtime.lease = async () => () => { released++; };
    runtime.pw = { chromium: { launch: async () => { await new Promise(resolve => setTimeout(resolve, 20)); throw Error('browserType.launch: unavailable'); } } };
  }
  if (fallback === 'keeper failure') {
    runtime.pw = {};
    runtime.ensureKeeper = async () => { await new Promise(resolve => setTimeout(resolve, 20)); throw Error('EACCES: keeper cannot start'); };
  }
  await assert.rejects(shoot({ ...f.args, remote: fallback === 'remote', keep: fallback === 'keeper failure', timeoutMs: 60 }, runtime), { code: 'look.timeout' });
  assert.ok(signal?.aborted, 'the shared deadline must cancel the remote request too');
  if (fallback === 'launch failure') assert.equal(released, 1);
  respond(new Response(png, { headers: { 'content-type': 'image/png' } }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(existsSync(f.args.out), false, 'an ignored abort must never write output after timeout');
});

test('the remote body must finish inside the same look deadline', { timeout: 2000 }, async t => {
  const f = fixture(t); let body, signal;
  const runtime = { ...f.runtime, fetch: async (_url, options) => {
    signal = options.signal;
    return { ok: true, headers: new Headers({ 'content-type': 'image/png' }), arrayBuffer: () => new Promise(resolve => { body = resolve; }) };
  } };
  await assert.rejects(shoot({ ...f.args, remote: true, timeoutMs: 30 }, runtime), { code: 'look.timeout' });
  assert.ok(signal.aborted); body(png);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(existsSync(f.args.out), false);
});

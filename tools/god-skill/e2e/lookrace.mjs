#!/usr/bin/env node
// lookrace regression: repeated looks with different cameras in a busy world never refuse with
// "requested camera changed before capture", locally (Chrome) or through the world's renderer (--remote).
// The world: the furnished Eden district template (150+ entities) plus a mountain and hills, so cameras land
// beyond the orbit camera's 320 m limit, under the terrain, on slopes and across wide spans (the harvest's genesis looks).
//   node tools/god-skill/e2e/lookrace.mjs [--port 7901] [--rounds 3] [--data <dir>] [--keep-world]
// Exit 0 only when every look returned a picture whose receipt camera is the one the look pinned.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { startWorld } from '../dev-world.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const port = Number(arg('port', 7901)), rounds = Number(arg('rounds', 3)), slug = 'lookrace-e2e';
const out = resolve(root, '.lane/lookrace', new Date().toISOString().replace(/[:.]/g, '-')); mkdirSync(out, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), 'lookrace-')), exec = promisify(execFile), cliFile = resolve(root, 'tools/god-skill/eden-god.mjs');
const env = { ...process.env, EDEN_GOD_NO_NPX: '1' };
const cli = async (...args) => (await exec(process.execPath, [cliFile, ...args], { cwd: temp, env, timeout: 180_000, maxBuffer: 1 << 24 })).stdout;
const report = { port, rounds, out, looks: [], refusals: 0, otherFailures: 0 };

// Local cameras: > 320 m (span 260, --dist 350/450, whole-world default), eyes inside the mountain, short slope views, a sheet.
const local = [
  ['--at', '0,0', '--from', 'sw', '--span', '240', '--hour', '18:30'],
  ['--at', '0,130', '--span', '260', '--from', 'se'],
  ['--from', 'sw', '--dist', '120'],
  ['--at', '0,150', '--from', 's', '--dist', '350'],
  ['--at', '-200,-100', '--from', 'sw', '--dist', '450', '--hour', '19'],
  ['--at', '160,150', '--from', 'e', '--dist', '100'],
  ['--at', '230,220', '--from', 'w', '--dist', '60'],
  ['--at', '-60,40', '--from', 'w', '--dist', '18'],
  ['--hour', '19:50'],
  ['--at', '0,0', '--span', '260', '--views', 'sw;ne;above', '--hour', '12'],
];
const remote = [local[1], local[3], local[5], local[6], ['--at', '20,10', '--from', 's', '--dist', '180', '--hour', '21']];

let world;
try {
  const { createServer } = await import('node:net');
  await new Promise((res, rej) => { const probe = createServer(); probe.once('error', () => rej(Error(`port ${port} is in use; pass --port`))); probe.listen(port, '127.0.0.1', () => probe.close(res)); });
  world = await startWorld({ slug, port, data: arg('data', join(temp, 'data')), genesis: resolve(root, 'worlds/templates/eden-district.json'), fresh: true, log: join(out, 'server.log') });
  await cli('register', world.base, 'dev:admin'); await cli('mint');
  for (const [def, at, extra] of [['mountain', '230,200', []], ['hill', '-60,40', []], ['hill', '120,-160', ['--param', 'height=40']]]) await cli('place', def, '--at', at, ...extra);
  const { token } = JSON.parse(readFileSync(join(temp, '.eden-god.json')));
  const snapshot = await (await fetch(world.base + '/v1/god/snapshot', { headers: { authorization: `Bearer ${token}` } })).json();
  assert.ok(snapshot.entities.length >= 150, `busy world expected (got ${snapshot.entities.length} entities)`);
  report.entities = snapshot.entities.length; console.log(`world ready: ${report.entities} entities on :${port}`);

  const run = async (via, flags, i, round) => {
    const file = join(out, `${via}-${round}-${i}.png`), t0 = Date.now();
    try {
      const r = JSON.parse(await cli('look', ...flags, ...(via === 'remote' ? ['--remote'] : []), '--out', file, '--json'));
      assert.ok(existsSync(file), 'picture written');
      if (via === 'local' && !flags.includes('--views')) {
        // the receipt is the camera the page pinned and captured; when nothing was lifted it is the requested (or span-fitted) eye
        assert.ok(Array.isArray(r.frames?.eye) && r.frames.eye.every(Number.isFinite), 'receipt camera');
        if (!r.frames.lifted && !r.frames.raised) { const d = Math.hypot(...r.frames.eye.map((v, k) => v - r.at[k])), want = Math.hypot(...r.eye.map((v, k) => v - r.at[k])); assert.ok(d >= want - 1e-6, `eye not pulled in (${d} < ${want})`); }
      }
      report.looks.push({ via, round, flags: flags.join(' '), ok: true, ms: r.ms, wallMs: Date.now() - t0, closer: r.frames?.closer ?? 0, raised: r.frames?.raised ?? 0, lifted: r.frames?.lifted ?? 0 });
      console.log(`PASS ${via} r${round} [${flags.join(' ')}] ${r.ms} ms${r.frames?.closer ? ` closer ${r.frames.closer} m` : ''}${r.frames?.raised ? ` raised ${r.frames.raised}°` : ''}${r.frames?.lifted ? ` lifted ${r.frames.lifted} m` : ''}`);
    } catch (e) {
      const text = String(e.stderr || e.stdout || e.message), refused = /requested camera changed/.test(text);
      if (refused) report.refusals++; else report.otherFailures++;
      report.looks.push({ via, round, flags: flags.join(' '), ok: false, refused, error: text.slice(0, 300), wallMs: Date.now() - t0 });
      console.log(`FAIL ${via} r${round} [${flags.join(' ')}] ${text.split('\n')[0].slice(0, 200)}`);
    }
  };
  for (let round = 1; round <= rounds; round++) {
    for (const [i, flags] of local.entries()) await run('local', flags, i, round);
    for (const [i, flags] of remote.entries()) await run('remote', flags, i, round);
  }
} finally {
  if (world?.child && !process.argv.includes('--keep-world')) { try { process.kill(-world.child.pid, 'SIGTERM'); } catch { try { world.child.kill('SIGTERM'); } catch { /* gone */ } } }
  const ok = report.looks.filter(l => l.ok), med = a => a.length ? a.sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;
  report.summary = { looks: report.looks.length, ok: ok.length, refusals: report.refusals, otherFailures: report.otherFailures,
    medianMsLocal: med(ok.filter(l => l.via === 'local').map(l => l.ms)), medianMsRemote: med(ok.filter(l => l.via === 'remote').map(l => l.ms)) };
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report.summary));
  if (!process.argv.includes('--keep-world')) { rmSync(temp, { recursive: true, force: true }); if (arg('data')) rmSync(resolve(arg('data')), { recursive: true, force: true }); }
}
process.exit(report.refusals || report.otherFailures || !report.looks.length ? 1 : 0);

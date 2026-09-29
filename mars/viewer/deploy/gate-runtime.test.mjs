import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GateProcesses, nodeTestSummary, startLocalSimulation } from './gate-runtime.mjs';

const fixture = async (fn) => {
  const outDir = await mkdtemp(join(tmpdir(), 'mars-gate-test-'));
  const processes = new GateProcesses();
  try { await fn({ root: process.cwd(), outDir, processes }); }
  finally { processes.cleanup(); await rm(outDir, { recursive: true, force: true }); }
};

test('gate node summaries separate TODO from skipped (spec and TAP)', () => {
  for (const prefix of ['ℹ ', '# ']) {
    const r = nodeTestSummary(['tests 9', 'pass 5', 'fail 0', 'skipped 1', 'todo 3'].map((s) => prefix + s).join('\n'));
    assert.equal(r.todo, '3');
    assert.equal(r.skipped, '1');
    assert.equal(r.summary, '5 pass / 0 fail / 1 skip / 3 todo');
  }
});

test('isolated gate server waits for readiness and closes its listening socket', () => fixture(async (options) => {
  const server = await startLocalSimulation({ ...options, timeout: 3000,
    command: (port) => [process.execPath, '-e', `require('http').createServer((q,r)=>{r.statusCode=401;r.end()}).listen(${port},'127.0.0.1')`],
  });
  assert.equal((await fetch(`${server.base}/api/simulation/state`)).status, 401);
  await server.stop();
  await assert.rejects(fetch(server.base));
  assert.equal(options.processes.children.size, 0);
}));

test('gate startup failure and readiness timeout both stop owned children', () => fixture(async (options) => {
  await assert.rejects(startLocalSimulation({ ...options, timeout: 2000, command: () => ['/mars-nonexistent-gate-command'] }), /ENOENT/);
  assert.equal(options.processes.children.size, 0);
  await assert.rejects(startLocalSimulation({ ...options, timeout: 150, command: () => [process.execPath, '-e', 'setInterval(()=>{},1000)'] }), /readiness timed out/);
  assert.equal(options.processes.children.size, 0);
}));

test('gate cleanup terminates descendants as well as wrapper processes', () => fixture(async (options) => {
  const child = options.processes.spawn(process.execPath, ['-e', `const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); console.log(c.pid); setInterval(()=>{},1000)`], { stdio: ['ignore', 'pipe', 'pipe'] });
  const descendant = await new Promise((resolve) => child.stdout.once('data', (data) => resolve(Number(data.toString().trim()))));
  const closed = new Promise((resolve) => child.once('close', resolve));
  options.processes.cleanup();
  await closed;
  // A killed descendant may briefly remain a zombie until init reaps it.
  const { execFileSync } = await import('node:child_process');
  let state = '';
  try { state = execFileSync('ps', ['-o', 'stat=', '-p', String(descendant)], { encoding: 'utf8' }).trim(); } catch { /* already reaped */ }
  assert.ok(state === '' || state.startsWith('Z'), `descendant is still running: ${state}`);
}));

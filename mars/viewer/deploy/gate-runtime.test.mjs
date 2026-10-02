import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GateProcesses, nodeTestSummary, startLocalSimulation, unusedPort } from './gate-runtime.mjs';

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
  options.processes.kill(child); // late close/timeout cleanup is idempotent
  options.processes.cleanup();
  await closed;
  // A killed descendant may briefly remain a zombie until init reaps it.
  const { execFileSync } = await import('node:child_process');
  let state = '';
  try { state = execFileSync('ps', ['-o', 'stat=', '-p', String(descendant)], { encoding: 'utf8' }).trim(); } catch { /* already reaped */ }
  assert.ok(state === '' || state.startsWith('Z'), `descendant is still running: ${state}`);
}));


test('SIGINT writes an interrupted gate report and closes a detached descendant server', { timeout: 15000 }, async () => {
  const { spawn, execFileSync } = await import('node:child_process');
  const { setTimeout: delay } = await import('node:timers/promises');
  const repository = await mkdtemp(join(tmpdir(), 'mars-gate-interrupt-'));
  const dir = join(repository, 'viewer');
  const port = await unusedPort();
  let gate;
  try {
    await mkdir(join(dir, 'deploy'), { recursive: true });
    for (const file of ['gate.mjs', 'gate-runtime.mjs', 'engine-proof.mjs', 'engine-proof-reporter.mjs']) await copyFile(new URL(file, import.meta.url), join(dir, 'deploy', file));
    await mkdir(join(dir, 'engine/test'), { recursive: true });
    await writeFile(join(dir, 'engine/test/fixture.test.ts'), "import test from 'node:test';test('fixture',()=>{});\n");
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'gate-interrupt-fixture', scripts: { lint: 'node fixture.cjs', 'test:engine': 'node --test engine/test/*.test.ts' } }));
    await writeFile(join(dir, 'fixture.cjs'), `const {spawn}=require('child_process');
const code="process.on('SIGTERM',()=>{});require('http').createServer((q,r)=>r.end('ready')).listen(${port},'127.0.0.1',()=>require('fs').writeFileSync('ready',String(process.pid)))";
spawn(process.execPath,['-e',code],{detached:true,stdio:'ignore'});setInterval(()=>{},1000);`);
    // Exercise the actual gate's new source-bound reporting in a real, clean
    // temporary repository. Never replace git or bypass hooks for this fixture.
    execFileSync('git', ['init', '--quiet'], { cwd: repository });
    execFileSync('git', ['add', 'viewer'], { cwd: repository });
    execFileSync('git', ['-c', 'user.name=genekogan', '-c', 'user.email=1335251+genekogan@users.noreply.github.com', 'commit', '--quiet', '-m', 'Gate interruption fixture', '-m', 'Co-Authored-By: Codex <noreply@openai.com>'], { cwd: repository });
    gate = spawn(process.execPath, ['deploy/gate.mjs'], { cwd: dir, stdio: 'ignore' });
    const closed = new Promise((resolve) => gate.once('close', (code) => resolve(code)));
    let pid;
    for (let i = 0; i < 100; i++) {
      try { pid = Number(await readFile(join(dir, 'ready'), 'utf8')); break; } catch { await delay(25); }
    }
    assert.ok(pid, 'detached server became ready');
    assert.equal((await fetch(`http://127.0.0.1:${port}`)).status, 200);
    gate.kill('SIGINT');
    assert.equal(await closed, 1);
    const [stamp] = await readdir(join(dir, '.cloudflare/gate'));
    const report = JSON.parse(await readFile(join(dir, '.cloudflare/gate', stamp, 'report.json'), 'utf8'));
    assert.equal(report.interrupted, 'SIGINT');
    assert.equal(report.cleanupError, null);
    assert.equal(report.ok, false);
    assert.equal(report.steps[0].status, 'fail');
    assert.ok(report.finishedAt);
    assert.ok(report.skipped.length > 0);
    await assert.rejects(fetch(`http://127.0.0.1:${port}`));
    let state = '';
    try { state = execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim(); } catch { /* reaped */ }
    assert.ok(state === '' || state.startsWith('Z'), `detached descendant still running: ${state}`);
  } finally {
    gate?.kill('SIGKILL');
    await rm(repository, { recursive: true, force: true });
  }
});

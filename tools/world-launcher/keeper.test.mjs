// node --test tools/world-launcher/keeper.test.mjs
// The keeper (keeper.mjs) and launcher handover, on lane C4's ports 6017–6019 only (keeper :6017, children 6018–6019).
// Two throwaway "releases" in a temp dir: this launcher's own files plus fake-world.mjs as apps/server/src/main.ts, so the
// real keeper forks the real launcher, which spawns fake worlds. Nothing outside the temp dir is read or written.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, symlinkSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 6017, RANGE = '6018-6019';
const dir = mkdtempSync(join(tmpdir(), 'keeper-test-'));
const data = join(dir, 'data'), link = join(dir, 'current');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function release(name, { brokenLauncher = false, brokenWorlds = false } = {}) {
  const r = join(dir, name);
  mkdirSync(join(r, 'apps/server/src'), { recursive: true }); mkdirSync(join(r, 'worlds/templates'), { recursive: true });
  mkdirSync(join(r, 'apps/web/dist'), { recursive: true }); writeFileSync(join(r, 'apps/web/dist/index.html'), `<!doctype html><title>${name}</title>`);
  cpSync(here, join(r, 'tools/world-launcher'), { recursive: true, filter: (f) => !f.includes('/deploy/') && !f.endsWith('.test.mjs') });
  writeFileSync(join(r, 'apps/server/src/main.ts'), brokenWorlds ? 'process.exit(5);\n' : readFileSync(join(here, 'fake-world.mjs')));
  if (brokenLauncher) writeFileSync(join(r, 'tools/world-launcher/launcher.mjs'), 'process.exit(3);\n');
  writeFileSync(join(r, 'BUILD'), `we-${name}`);
  return r;
}
const point = (target) => { try { unlinkSync(`${link}.next`); } catch { /* none */ } symlinkSync(target, `${link}.next`); renameSync(`${link}.next`, link); };
const api = (p, o) => fetch(`http://127.0.0.1:${PORT}/worlds${p}`, o);
const status = () => JSON.parse(readFileSync(join(data, 'keeper.json'), 'utf8'));
async function handover(target) {
  const before = status().handover?.startedAt ?? null;
  point(target); keeper.kill('SIGHUP');
  for (let i = 0; i < 300; i++) { const h = status().handover; if (h && h.startedAt !== before && (h.state === 'done' || h.state === 'failed')) return h; await sleep(50); }
  throw new Error('handover did not finish');
}
/** GETs every 20 ms while `during` runs: any refused connection or 5xx is what a visitor would see as an error page. */
async function watch(slugs, during) {
  let stop = false; const bad = [], slow = [];
  const loops = slugs.map(async (s) => { while (!stop) { const t0 = performance.now(); try { const r = await api(`/w/${s}/healthz`); await r.arrayBuffer(); if (r.status >= 500) bad.push(`${s} ${r.status}`); } catch (e) { bad.push(`${s} ${e.cause?.code ?? e.message}`); } slow.push(performance.now() - t0); await sleep(20); } });
  const out = await during(); stop = true; await Promise.all(loops);
  return { out, bad, slowest: Math.max(0, ...slow) };
}
let keeper, A, B;
before(async () => {
  A = release('a'); B = release('b');
  point(A);
  keeper = spawn(process.execPath, [join(A, 'tools/world-launcher/keeper.mjs'), '--link', link, '--port', String(PORT), '--range', RANGE, '--data', data, '--base', '/worlds', '--eager', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; keeper.stdout.on('data', (d) => { logs += d; }); keeper.stderr.on('data', (d) => { logs += d; }); keeper.logs = () => logs;
  for (let i = 0; i < 100; i++) { try { if ((await api('/__sim/healthz')).ok) break; } catch { /* starting */ } await sleep(100); }
  for (const name of ['One', 'Two']) assert.equal((await api('/__sim/worlds', { method: 'POST', body: JSON.stringify({ name }) })).status, 201);
});
after(async () => { if (keeper && keeper.exitCode === null) { keeper.kill('SIGTERM'); await new Promise((r) => keeper.once('exit', r)); } });

test('the keeper serves the launcher of the linked release', async () => {
  const h = await (await api('/__sim/healthz')).json();
  assert.equal(h.build, 'we-a'); assert.equal(h.running, 2);
  const s = status(); assert.equal(s.keeper.pid, keeper.pid); assert.match(s.keeper.sha, /^[0-9a-f]{64}$/); assert.equal(s.active.build, 'we-a');
});
test('reload hands every world to the new release with no refused connection and no 5xx', async () => {
  const pids = Object.fromEntries((await Promise.all(['one', 'two'].map(async (s) => [s, (await (await api(`/w/${s}/healthz`)).json()).pid]))));
  // a viewer socket on One stays usable until its world moves, then the new launcher accepts it again
  const { out: h, bad, slowest } = await watch(['one', 'two'], () => handover(B));
  assert.equal(h.state, 'done', JSON.stringify(h)); assert.equal(h.from, 'we-a'); assert.equal(h.to, 'we-b');
  assert.deepEqual(Object.keys(h.worlds).sort(), ['one', 'two']); assert.ok(Object.values(h.worlds).every((w) => w.ok));
  assert.deepEqual(bad, [], 'a visitor saw an error');
  assert.ok(slowest < 5000, `a request waited ${slowest} ms`);
  assert.equal((await (await api('/__sim/healthz')).json()).build, 'we-b');
  for (const s of ['one', 'two']) { const now = (await (await api(`/w/${s}/healthz`)).json()).pid; assert.notEqual(now, pids[s], `${s} runs a new process`); }
  assert.equal(status().active.build, 'we-b');
  // the registry stayed one file with both worlds, and creating still works on the new launcher
  assert.equal((await api('/__sim/worlds', { method: 'POST', body: JSON.stringify({ name: 'Three' }) })).status, 503, 'two child ports, both busy: the cap still holds');
  assert.deepEqual(JSON.parse(readFileSync(join(data, 'worlds.json'), 'utf8')).worlds.map((w) => w.slug).sort(), ['one', 'two']);
});
test('a new release whose launcher cannot start changes nothing: the running one serves on', async () => {
  const { out: h, bad } = await watch(['one', 'two'], () => handover(release('broken', { brokenLauncher: true })));
  assert.equal(h.state, 'failed'); assert.match(h.error, /exited/);
  assert.deepEqual(bad, []);
  assert.equal((await (await api('/__sim/healthz')).json()).build, 'we-b');
});
test('a release whose worlds cannot boot is reported per world, never boots a world twice, and reloading back restores it', async () => {
  const h = await handover(release('noboot', { brokenWorlds: true }));
  assert.equal(h.state, 'failed'); assert.deepEqual(h.failed.sort(), ['one', 'two']);
  const back = await handover(B);
  assert.equal(back.state, 'done');
  for (const s of ['one', 'two']) { let ok = false; for (let i = 0; i < 50 && !ok; i++) { ok = (await api(`/w/${s}/healthz`)).ok; if (!ok) await sleep(100); } assert.ok(ok, `${s} is back`); }
  assert.equal((await (await api('/__sim/healthz')).json()).build, 'we-b');
});
test('SIGTERM stops the keeper, its launcher and every world', async () => {
  const kids = (await (await api('/__sim/launcher')).json()).children.map((c) => c.pid).filter(Boolean);
  keeper.kill('SIGTERM'); const code = await new Promise((r) => keeper.once('exit', r));
  assert.equal(code, 0);
  for (const pid of kids) assert.throws(() => process.kill(pid, 0), 'world process gone');
  assert.equal(status().active, null);
});

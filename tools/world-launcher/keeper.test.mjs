// node --test tools/world-launcher/keeper.test.mjs
// The keeper (keeper.mjs) and launcher handover, on lane C4's ports 6017–6019 only (keeper :6017, children 6018–6019).
// Two throwaway "releases" in a temp dir: this launcher's own files plus fake-world.mjs as apps/server/src/main.ts, so the
// real keeper forks the real launcher, which spawns fake worlds. Nothing outside the temp dir is read or written.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, symlinkSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.KEEPER_TEST_PORT ?? 6017), RANGE = `${PORT + 1}-${PORT + 2}`;   // a lane may move it into its own range
const dir = mkdtempSync(join(tmpdir(), 'keeper-test-'));
const data = join(dir, 'data'), link = join(dir, 'current');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function release(name, { brokenLauncher = false, brokenWorlds = false, loadMs = 0 } = {}) {
  const r = join(dir, name);
  mkdirSync(join(r, 'apps/server/src'), { recursive: true }); mkdirSync(join(r, 'worlds/templates'), { recursive: true });
  mkdirSync(join(r, 'apps/web/dist'), { recursive: true }); writeFileSync(join(r, 'apps/web/dist/index.html'), `<!doctype html><title>${name}</title>`);
  cpSync(here, join(r, 'tools/world-launcher'), { recursive: true, filter: (f) => !f.includes('/deploy/') && !f.endsWith('.test.mjs') });
  // loadMs: the release's code takes that long to load (the part a pre-warmed take-over hides)
  writeFileSync(join(r, 'apps/server/src/main.ts'), brokenWorlds ? 'process.exit(5);\n' : `process.env.FAKE_LOAD_MS ??= '${loadMs}';\n` + readFileSync(join(here, 'fake-world.mjs')));
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
  for (let i = 0; i < 300; i++) { const h = status().handover; if (h && h.startedAt !== before && (h.state === 'done' || h.state === 'failed' || h.state === 'rolled-back')) return h; await sleep(50); }
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
  A = release('a'); B = release('b', { loadMs: 800 });
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
  // canary first, then the rest; every new process was pre-warmed, so a world's pause is shorter than B's 800 ms code load
  assert.equal(Object.values(h.worlds).filter((w) => w.canary).length, 1, JSON.stringify(h.worlds));
  for (const [s, w] of Object.entries(h.worlds)) { assert.equal(w.warm?.ok, true, `${s} pre-warmed`); assert.ok(w.warm.ms >= 700, `${s} loaded its code in standby (${w.warm.ms} ms)`); assert.ok(w.ms < 700, `${s} paused ${w.ms} ms, under the code load`); }
  assert.deepEqual(bad, [], 'a visitor saw an error');
  assert.ok(slowest < 5000, `a request waited ${slowest} ms`);
  assert.equal((await (await api('/__sim/healthz')).json()).build, 'we-b');
  for (const s of ['one', 'two']) { const now = (await (await api(`/w/${s}/healthz`)).json()).pid; assert.notEqual(now, pids[s], `${s} runs a new process`); }
  assert.equal(status().active.build, 'we-b');
  // the registry stayed one file with both worlds, and creating still works on the new launcher
  assert.equal((await api('/__sim/worlds', { method: 'POST', body: JSON.stringify({ name: 'Three' }) })).status, 503, 'two child ports, both busy: the cap still holds');
  assert.deepEqual(JSON.parse(readFileSync(join(data, 'worlds.json'), 'utf8')).worlds.map((w) => w.slug).sort(), ['one', 'two']);
});
test('a keep-alive connection idle at the switch still answers its next request (a POST), then closes cleanly', async () => {
  // Caddy keeps idle connections to the launcher and may send on one at any instant; a POST on a connection the old
  // launcher closes under it cannot be replayed (Caddy answers 502). The old launcher answers it, with Connection: close.
  const sock = connect(PORT, '127.0.0.1'); let buf = '', ended = false;
  sock.setEncoding('utf8'); sock.on('data', (d) => { buf += d; }); sock.on('close', () => { ended = true; });
  const until = async (ok, what) => { for (let i = 0; i < 200 && !ok(); i++) await sleep(25); assert.ok(ok(), typeof what === 'function' ? what() : what); };
  sock.write('GET /worlds/w/one/healthz HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\n\r\n');
  await until(() => /\r\n0\r\n\r\n$/.test(buf) || /content-length: \d+[\s\S]*\r\n\r\n\{[\s\S]*\}$/i.test(buf), () => `first response (${JSON.stringify(buf)})`);
  assert.match(buf, /^HTTP\/1\.1 200/); assert.doesNotMatch(buf, /connection: close/i, 'kept alive before the switch'); buf = '';
  const before = status().handover?.startedAt;
  point(release('b2', { loadMs: 800 })); keeper.kill('SIGHUP');
  await until(() => { const h = status().handover; return h && h.startedAt !== before && h.state === 'taking-over'; }, 'handover reached take-over');
  await sleep(100);   // the old launcher has its retire message by now
  assert.equal(ended, false, 'the idle connection was not closed at the switch');
  const body = '{"x":1}';
  sock.write(`POST /worlds/w/two/v1/probe-post HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
  await until(() => ended, () => `the connection closes after its answer (${JSON.stringify(buf)})`);
  const code = Number(/^HTTP\/1\.1 (\d+)/.exec(buf)?.[1]);
  assert.ok(code > 0 && code < 500, `the POST was answered, not dropped (${buf.slice(0, 200)})`); assert.match(buf, /connection: close/i);
  for (let i = 0; i < 300 && status().handover?.state === 'taking-over'; i++) await sleep(50);
  assert.equal(status().handover.state, 'done', JSON.stringify(status().handover));
  assert.equal((await handover(B)).state, 'done');   // back to B for the tests below
});
test('a new release whose launcher cannot start changes nothing: the running one serves on', async () => {
  const { out: h, bad } = await watch(['one', 'two'], () => handover(release('broken', { brokenLauncher: true })));
  assert.equal(h.state, 'failed'); assert.match(h.error, /exited/);
  assert.deepEqual(bad, []);
  assert.equal((await (await api('/__sim/healthz')).json()).build, 'we-b');
});
test('a release whose worlds cannot boot fails its canary: only that world pauses (no error), the running release serves on, no reload', async () => {
  const pids = Object.fromEntries((await Promise.all(['one', 'two'].map(async (s) => [s, (await (await api(`/w/${s}/healthz`)).json()).pid]))));
  const { out: h, bad } = await watch(['one', 'two'], () => handover(release('noboot', { brokenWorlds: true })));
  assert.equal(h.state, 'rolled-back', JSON.stringify(h)); assert.ok(['one', 'two'].includes(h.canary));
  assert.deepEqual(Object.keys(h.worlds), [h.canary], 'nothing but the canary moved'); assert.equal(h.worlds[h.canary].ok, false);
  const other = h.canary === 'one' ? 'two' : 'one';
  assert.equal((await (await api(`/w/${other}/healthz`)).json()).pid, pids[other], 'the other world kept its process');
  assert.deepEqual(bad, [], 'requests for the canary world wait for it to come back instead of failing');
  assert.equal((await (await api('/__sim/healthz')).json()).build, 'we-b');
  assert.equal(status().active.build, 'we-b');
  let ok = false; for (let i = 0; i < 50 && !ok; i++) { ok = (await api(`/w/${h.canary}/healthz`)).ok; if (!ok) await sleep(100); }
  assert.ok(ok, 'the canary world runs again on the previous release');
  // and the next good release still hands over normally from the generation that served on
  const next = await handover(release('c'));
  assert.equal(next.state, 'done', JSON.stringify(next)); assert.equal(next.to, 'we-c');
  assert.equal((await (await api('/__sim/healthz')).json()).build, 'we-c');
});
test('SIGTERM stops the keeper, its launcher and every world', async () => {
  const kids = (await (await api('/__sim/launcher')).json()).children.map((c) => c.pid).filter(Boolean);
  keeper.kill('SIGTERM'); const code = await new Promise((r) => keeper.once('exit', r));
  assert.equal(code, 0);
  for (const pid of kids) assert.throws(() => process.kill(pid, 0), 'world process gone');
  assert.equal(status().active, null);
});

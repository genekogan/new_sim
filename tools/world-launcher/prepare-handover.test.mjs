// node --test tools/world-launcher/prepare-handover.test.mjs (lane soul3-prepare; fake worlds, launcher :6664, children 6660–6663)
// The launcher's own prepareHandover (keeper step 1) must answer inside the keeper's 60 s even when a world is stuck
// booting (R389/R390) or a creation is in flight, without ever letting two processes hold one world's data, without
// touching a new world's data, and without freezing the registry after the keeper has given up and resumed it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLauncher } from './launcher.mjs';

const PORT = 6664, RANGE = [6660, 6663];
const dir = mkdtempSync(join(tmpdir(), 'prepare-test-'));
const templatesDir = join(dir, 'templates'); mkdirSync(templatesDir);
const webDir = join(dir, 'web'); mkdirSync(webDir); writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>Sim</title>');
const fake = new URL('./fake-world.mjs', import.meta.url).pathname;
const hang = new Set();   // worlds whose next process never opens its port (stuck booting)
const command = (w, port) => ({ cmd: process.execPath, args: [fake], env: { ...process.env, WORLD_KEY: w.slug, PORT: String(port), ...(hang.has(w.slug) ? { FAKE_BOOT_MS: '600000' } : {}) } });
const L = await openLauncher({ port: PORT, range: RANGE, dataDir: join(dir, 'data'), webDir, templatesDir, command, eager: 0, idleMs: 0, sleepMs: 0, log: () => {},
  prepareCreateWaitMs: 600, prepareBootWaitMs: 600 });
after(async () => { await L.close(); });
const api = (p, o = {}) => fetch(`http://127.0.0.1:${PORT}${p}`, o);
const create = (name) => api('/__sim/worlds', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const booting = async (slug) => { for (let i = 0; i < 300 && !L.pool.state(slug)?.child; i++) await new Promise((r) => setTimeout(r, 10)); return L.pool.state(slug).child.pid; };
const ms = async (p) => { const t0 = Date.now(); try { return { ms: Date.now() - t0, value: await p, at: Date.now() - t0 }; } catch (e) { return { error: e, at: Date.now() - t0 }; } };

test('setup: two healthy worlds', async () => {
  assert.equal((await create('Fine')).status, 201);
  assert.equal((await create('Wedged')).status, 201);
});

test('an existing world stuck booting: prepare answers in time, hands over the healthy one, the stuck process is gone', async () => {
  await L.pool.stop('wedged'); hang.add('wedged');
  api('/w/wedged/healthz').catch(() => {});   // a visit boots it again: this boot never opens its port
  const pid = await booting('wedged');
  const r = await ms(L.prepareHandover());
  assert.ifError(r.error);
  assert.ok(r.at < 3_000, `prepare answered in ${r.at} ms`);
  assert.deepEqual(r.value.children.map((c) => c.slug), ['fine']);
  assert.deepEqual(r.value.abandoned.map((b) => [b.slug, b.pid]), [['wedged', pid]]);
  assert.match(r.value.abandoned[0].error, /still booting/);
  assert.equal(alive(pid), false, 'the stuck process is gone before prepare answers');
  assert.equal(L.registry.frozen, true);
  assert.equal((await api('/w/fine/healthz')).status, 200, 'the healthy world serves through prepare');
  L.resumeHandover();   // (the keeper's next generation failed: carry on)
  assert.equal(L.registry.frozen, false);
  hang.delete('wedged');
  assert.equal((await api('/w/wedged/healthz')).status, 200, 'the abandoned world boots fresh on its next visit');
});

test('a creation in flight that cannot finish: prepare fails in time, touches nothing, and creations go on', async () => {
  hang.add('stalled');
  const making = create('Stalled');
  const pid = await booting('stalled');
  const r = await ms(L.prepareHandover());
  assert.match(r.error?.message ?? '', /a world creation is still in progress after 0.6 s: handover not prepared/);
  assert.ok(r.at < 3_000, `prepare failed in ${r.at} ms`);
  assert.equal(L.registry.frozen, false, 'the registry is not frozen');
  assert.ok(alive(pid), 'the creation\'s boot is not killed');
  assert.ok(L.registry.get('stalled') && existsSync(L.registry.worldDir('stalled')), 'the new world\'s data is untouched');
  // the launcher is active again: another prepare may run, a later creation is accepted
  hang.delete('stalled'); L.pool.state('stalled').child.kill('SIGKILL');
  await making;
  assert.equal((await create('After')).status, 201);
});

test('the keeper gives up (resume) while prepare waits on a stuck boot: nothing freezes late, no new boot is killed', async () => {
  await L.pool.stop('wedged'); hang.add('wedged');
  api('/w/wedged/healthz').catch(() => {});
  const pid = await booting('wedged');
  const pidFile = L.pool.o.pidFile;
  const preparing = ms(L.prepareHandover());
  await new Promise((r) => setTimeout(r, 100));
  L.resumeHandover();
  const r = await preparing;
  assert.match(r.error?.message ?? '', /handover abandoned while preparing/);
  assert.equal(L.registry.frozen, false, 'not frozen after the resume');
  assert.equal(L.pool.o.pidFile, pidFile, 'the pid file is still written');
  assert.ok(alive(pid), 'a boot belonging to the resumed launcher is not killed by the abandoned prepare');
  hang.delete('wedged'); await L.pool.stop('wedged');
});

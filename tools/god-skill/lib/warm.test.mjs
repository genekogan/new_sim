import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { holder } from './locks.mjs';
import { KEEPER, WARM, lookRoute, startWarm, treeRssMb, warmEnabled, warmStatus } from './warm.mjs';

const W = 'http://127.0.0.1:1/w';
function folder(t, state = { world: W, token: 'synthetic-g1-token' }) {
  const scratch = '<team>/scratch/g1/tests';
  mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(join(scratch, 'warm-')), cwd = process.cwd();
  process.chdir(dir);
  writeFileSync('.eden-god.json', JSON.stringify(state));
  t.after(() => { process.chdir(cwd); rmSync(dir, { recursive: true, force: true }); });
}
const env = (e = {}) => ({ ...e });

test('G1 warmEnabled: human-paired folders with Chrome only; env overrides; never under node --test', () => {
  const yes = () => true, no = () => false;
  assert.equal(warmEnabled({ world: W, token: 't' }, env(), yes), true);
  assert.equal(warmEnabled({ world: W, token: 't', identity: 'dev' }, env(), yes), false, 'minted dev folders stay cold');
  assert.equal(warmEnabled({ world: W }, env(), yes), false, 'not paired');
  assert.equal(warmEnabled({ world: W, token: 't' }, env(), no), false, 'no Google Chrome');
  assert.equal(warmEnabled({ world: W, token: 't' }, env({ EDEN_GOD_WARM: '0' }), yes), false);
  assert.equal(warmEnabled({ world: W, token: 't' }, env({ EDEN_GOD_LOOK: 'remote' }), yes), false);
  assert.equal(warmEnabled({ world: W, token: 't' }, env({ NODE_TEST_CONTEXT: 'child' }), yes), false);
  assert.equal(warmEnabled({ world: W, identity: 'dev' }, env({ EDEN_GOD_WARM: '1', NODE_TEST_CONTEXT: 'child' }), no), true);
  assert.equal(warmEnabled({}, env({ EDEN_GOD_WARM: '1' }), yes), false, 'no world, nothing to load');
});

test('G1 warmStatus reads the keeper file and the warm marker', t => {
  folder(t);
  assert.equal(warmStatus(W), 'none');
  const me = holder('test');
  writeFileSync(WARM, JSON.stringify({ world: W, pid: process.pid, holder: me, phase: 'chrome', at: Date.now() }));
  assert.equal(warmStatus(W), 'warming');
  assert.equal(warmStatus(W, Date.now() + 6 * 60_000), 'none', 'a warm-up stuck past 5 min is given up');
  writeFileSync(WARM, JSON.stringify({ world: W, pid: 999999, phase: 'starting', at: Date.now() }));
  assert.equal(warmStatus(W), 'none', 'a dead starter');
  writeFileSync(WARM, JSON.stringify({ world: W, phase: 'failed', at: Date.now() }));
  assert.equal(warmStatus(W), 'failed');
  assert.equal(warmStatus(W, Date.now() + 11 * 60_000), 'none', 'retry a failure after 10 min');
  writeFileSync(WARM, JSON.stringify({ world: W, phase: 'stopped', at: Date.now() }));
  assert.equal(warmStatus(W), 'stopped');
  writeFileSync(WARM, JSON.stringify({ world: 'http://other', phase: 'chrome', pid: process.pid, holder: me, at: Date.now() }));
  assert.equal(warmStatus(W), 'none');
  writeFileSync(KEEPER, JSON.stringify({ world: W, port: 1, pid: process.pid, holder: me, heartbeatAt: Date.now() }));
  assert.equal(warmStatus(W), 'ready');
  writeFileSync(KEEPER, JSON.stringify({ world: 'http://other', port: 1, pid: process.pid, holder: me, heartbeatAt: Date.now() }));
  assert.equal(warmStatus(W), 'other');
  writeFileSync(KEEPER, JSON.stringify({ world: W, port: 1, pid: 999999, holder: { ...me, pid: 999999 }, heartbeatAt: Date.now() - 120_000 }));
  assert.notEqual(warmStatus(W), 'ready', 'a dead keeper is not ready');
});

test('G1 startWarm spawns one detached keeper and never waits; skips when stopped unless forced', t => {
  folder(t);
  const spawned = [];
  const spawnFn = (cmd, args, opts) => { spawned.push({ cmd, args, opts }); return { pid: 999998, unref() {}, on() {} }; };
  assert.equal(startWarm(W, '/x/eden-god.mjs', { spawnFn }), 'started');
  assert.deepEqual(spawned[0].args, ['/x/eden-god.mjs', 'look-keeper', W, '0', '--warm']);
  assert.equal(spawned[0].opts.detached, true); assert.equal(spawned[0].opts.stdio, 'ignore');
  writeFileSync(WARM, JSON.stringify({ world: W, phase: 'stopped', at: Date.now() }));
  assert.equal(startWarm(W, '/x', { spawnFn }), 'stopped');
  assert.equal(startWarm(W, '/x', { spawnFn, force: true }), 'started');
  assert.equal(spawned.length, 2);
});

test('G1 lookRoute: keeper when warm, remote while warming, waits when the world has no renderer, cold otherwise', async t => {
  const prev = process.env.EDEN_GOD_WARM; process.env.EDEN_GOD_WARM = '1';
  t.after(() => { if (prev === undefined) delete process.env.EDEN_GOD_WARM; else process.env.EDEN_GOD_WARM = prev; });
  folder(t);
  const me = holder('test'), deadlineAt = Date.now() + 120_000;
  writeFileSync(KEEPER, JSON.stringify({ world: W, port: 1, pid: process.pid, holder: me, heartbeatAt: Date.now() }));
  assert.equal(await lookRoute({ world: W, cliPath: '/x', single: true, deadlineAt, remote: async () => assert.fail('no remote when warm') }), 'keeper');
  rmSync(KEEPER);
  writeFileSync(WARM, JSON.stringify({ world: W, pid: process.pid, holder: me, phase: 'chrome', at: Date.now() }));
  assert.deepEqual(await lookRoute({ world: W, cliPath: '/x', single: true, deadlineAt, remote: async () => 'png' }), { shot: 'png' });
  // the world says look.unavailable (live eden2 has no Chrome): remembered, and the look waits for the keeper
  let waited = 0, remotes = 0;
  const wait = async () => { if (++waited === 3) writeFileSync(KEEPER, JSON.stringify({ world: W, port: 1, pid: process.pid, holder: me, heartbeatAt: Date.now() })); };
  const unavailable = async () => { remotes++; throw new Error('look: look.unavailable: no renderer'); };
  assert.equal(await lookRoute({ world: W, cliPath: '/x', single: true, deadlineAt, remote: unavailable, wait }), 'keeper');
  rmSync(KEEPER); waited = 0;
  assert.equal(await lookRoute({ world: W, cliPath: '/x', single: true, deadlineAt, remote: unavailable, wait }), 'keeper');
  assert.equal(remotes, 1, 'look.unavailable is remembered for an hour');
  rmSync(KEEPER);
  // sheets never go remote; past the deadline margin the look goes cold
  assert.equal(await lookRoute({ world: W, cliPath: '/x', single: false, deadlineAt: Date.now() + 10_000, remote: async () => assert.fail('sheet'), wait: async () => {} }), 'cold');
  writeFileSync(WARM, JSON.stringify({ world: W, phase: 'stopped', at: Date.now() }));
  assert.equal(await lookRoute({ world: W, cliPath: '/x', single: true, deadlineAt, remote: async () => assert.fail('stopped') }), 'cold');
});

test('G1 treeRssMb sums the Chrome tree on one debug port only', () => {
  const ps = [
    '  100     1  204800 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless --remote-debugging-port=6330 --x',
    '  101   100  102400 /Applications/Google Chrome.app/.../Google Chrome Helper (Renderer) --type=renderer',
    '  102   101   51200 /Applications/Google Chrome.app/.../Google Chrome Helper --type=utility',
    '  200     1  999999 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9222',
    '  300   100    1024 garbage line without numbers ok',
  ].join('\n');
  assert.equal(treeRssMb(ps, 6330), 351);
  assert.equal(treeRssMb(ps, 7000), null);
});

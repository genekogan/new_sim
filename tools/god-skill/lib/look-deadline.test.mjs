import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { shoot } from './look.mjs';
test('look deadline includes a hung browser launch and releases Chrome ownership', async () => {
  let released = 0;
  const pw = { chromium: { launch: () => new Promise(() => {}) } };
  const at = Date.now();
  await assert.rejects(shoot({ worldUrl: 'http://127.0.0.1:5366', eye: [1, 1, 1], at: [0, 0, 0], out: '/tmp/eden-look-deadline.png', timeoutMs: 30 }, { pw, lease: async () => () => { released++; } }), { code: 'look.timeout' });
  assert.ok(Date.now() - at < 1000); assert.equal(released, 1);
});
test('look command deadline includes a hung mirror read before Chrome', async () => {
  const { look } = await import('../cli.mjs'); const started = Date.now();
  await assert.rejects(look({}, { timeoutMs: 30, mirror: () => new Promise(() => {}) }), { code: 'look.timeout' });
  assert.ok(Date.now() - started < 1000);
});
test('synchronous fallback uses only the remaining look budget', async () => {
  let clock = 0, timeout;
  await shoot({ worldUrl: 'http://127.0.0.1:5366', eye: [1, 1, 1], at: [0, 0, 0], out: '/tmp/eden-look-fallback.png', timeoutMs: 100 }, { pw: null, now: () => { const n = clock; clock += 10; return n; }, spawnSync: (_cmd, _args, opts) => { timeout = opts.timeout; return { status: 0 }; } });
  assert.ok(timeout > 0 && timeout < 100);
});

test('sheets, frame strips and workbench obey the shared deadline and cannot write late captures', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'm4-look-deadline-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const eye = [1, 1, 1], at = [0, 0, 0];
  for (const [name, mode] of [['sheet', { views: [{ eye, at }, { eye, at }] }], ['frames', { frames: 2 }], ['studio', { studio: { accepted: true } }]]) {
    let finish, released = 0, closed = 0;
    const pending = new Promise(resolve => { finish = resolve; });
    const page = { goto: async () => {}, waitForFunction: async () => {}, waitForTimeout: async () => {}, evaluate: async (fn, arg) => {
      if (mode.studio || fn.name === 'composeSheet') return pending;
      return Array.isArray(arg) ? { eye, at } : 'data:image/png;base64,cGljdHVyZQ=';
    } };
    const browser = { newContext: async () => ({ addInitScript: async () => {}, newPage: async () => page }), close: async () => { closed++; } };
    const out = join(dir, `${name}.png`);
    await assert.rejects(shoot({ worldUrl: 'http://127.0.0.1:5366', eye, at, out, timeoutMs: 30, ...mode }, {
      pw: { chromium: { launch: async () => browser } }, lease: async () => () => { released++; }, waitReady: async () => ({ ready: true }),
    }), { code: 'look.timeout' });
    assert.equal(released, 1); assert.ok(closed >= 1); assert.equal(existsSync(out), false);
    finish(mode.studio ? { data: 'data:image/png;base64,cGljdHVyZQ=' } : 'data:image/png;base64,cGljdHVyZQ=');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(existsSync(out), false, `${name} cannot write after the deadline`);
    assert.equal(released, 1);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
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

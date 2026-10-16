// CE8: look, where and free send one fire-and-forget attention hint for the lead's build; it never blocks or fails them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COMMANDS, look } from '../cli.mjs';
import { invalidate } from './mirror.mjs';
import { attention, ATTENTION_TIMEOUT_MS } from './state.mjs';

const lead = { id: 'chapel', lease: 'l_1234abcd', n: 1, label: 'shell', steps: ['shell'] };
/** hint: (call) => Response | Promise (the attention endpoint's behaviour). Everything else is a tiny world. */
function fixture(t, { build = lead, hint = () => Response.json({ ok: true, t: 1, published: true }), free = [{ at: [12, -7], y: 1.5, slope: 0, dist: 3 }] } = {}) {
  const cwd = process.cwd(), original = globalThis.fetch, claim = process.env.EDEN_GOD_CLAIM, flag = process.env.EDEN_GOD_ATTENTION, dir = mkdtempSync(join(tmpdir(), 'y7-attention-')), calls = [], hints = [];
  process.chdir(dir); invalidate(); delete process.env.EDEN_GOD_CLAIM; delete process.env.EDEN_GOD_ATTENTION;
  writeFileSync('.eden-god.json', JSON.stringify({ world: 'http://127.0.0.1:5369/w/unit', token: 'fixture-only', ...(build ? { build } : {}) }));
  globalThis.fetch = async (url, o = {}) => {
    const path = new URL(url).pathname, c = { url, path, ...o, body: o.body ? JSON.parse(o.body) : undefined }; calls.push(c);
    if (path.endsWith('/attention')) { hints.push(c); return hint(c); }
    if (path.endsWith('/seq')) return Response.json({ seq: 1, builds: 0 });
    if (path.endsWith('/snapshot')) return Response.json({ seq: 1, buildsRev: 0, constants: { extent: 100 }, entities: [], library: [] });
    if (path.endsWith('/query')) {
      const q = c.body;
      if (q.where) return Response.json({ where: { x: q.where[0], z: q.where[1], y: 0.4, slopeDeg: 0, medium: 'walk', inside: [], near: [] }, clearance: { clear: true, blockedBy: [] } });
      if (q.free) return Response.json({ free });
      if (q.points) return Response.json({ points: [{ y: 2, water: 0 }] });
      return Response.json({ layout: { entities: [] } });
    }
    throw Error(`unexpected ${path}`);
  };
  t.after(() => { globalThis.fetch = original; process.chdir(cwd); invalidate(); rmSync(dir, { recursive: true, force: true });
    if (claim === undefined) delete process.env.EDEN_GOD_CLAIM; else process.env.EDEN_GOD_CLAIM = claim;
    if (flag === undefined) delete process.env.EDEN_GOD_ATTENTION; else process.env.EDEN_GOD_ATTENTION = flag; });
  return { calls, hints };
}
const settle = () => new Promise(r => setImmediate(r));

test('where sends the queried point with the lead lease, once, and its answer is unchanged', async t => {
  const f = fixture(t);
  const out = await COMMANDS.where(['3,4'], {});
  assert.match(out, /^\(3, 4\): ground y 0\.4/);
  await settle();
  assert.equal(f.hints.length, 1);
  assert.equal(f.hints[0].url, 'http://127.0.0.1:5369/w/unit/v1/god/builds/chapel/attention'); assert.equal(f.hints[0].method, 'POST');
  assert.equal(f.hints[0].headers.authorization, 'Bearer fixture-only');
  assert.deepEqual(f.hints[0].body, { lease: 'l_1234abcd', at: [3, 0.4, 4] });
  assert.ok(f.hints[0].signal instanceof AbortSignal, 'bounded by its own timeout');
  assert.deepEqual(await COMMANDS.where(['3,4'], { json: true }), { x: 3, z: 4, y: 0.4, slopeDeg: 0, medium: 'walk', inside: [], near: [] });
  await settle(); assert.equal(f.hints.length, 2, '--json answers still mark the look');
});

test('look sends the camera target and eye before the shot finishes; free sends the best plot', async t => {
  const f = fixture(t); let during;
  const shot = await look({ at: '10,20', from: 'se', dist: '30', json: true }, { shoot: async args => { await settle(); during = f.hints.length; return { file: args.out, ms: 1 }; } });
  assert.equal(during, 1, 'already in flight while the browser renders');
  assert.deepEqual(f.hints[0].body, { lease: 'l_1234abcd', at: shot.at, eye: shot.eye });
  assert.deepEqual(shot.at, [10, 2, 20]);
  await COMMANDS.free(['8x8'], {}); await settle();
  assert.deepEqual(f.hints.at(-1).body, { lease: 'l_1234abcd', at: [12, 1.5, -7] });
});

test('a hanging, failing or refusing world never blocks, fails or prints from the command', async t => {
  let release;
  const f = fixture(t, { hint: c => new Promise((_, reject) => { release = () => reject(Error('reset')); c.signal.addEventListener('abort', () => reject(c.signal.reason), { once: true }); }) });
  const noise = []; t.mock.method(console, 'error', s => noise.push(s)); t.mock.method(console, 'warn', s => noise.push(s));
  const t0 = performance.now();
  assert.match(await COMMANDS.where(['1,1'], {}), /ground y/);
  assert.ok(performance.now() - t0 < ATTENTION_TIMEOUT_MS / 2, 'the answer does not wait for the hint');
  await settle(); assert.equal(f.hints.length, 1);
  // The hint gives up on its own timeout and resolves false.
  // AbortSignal.timeout is unref'd; in the CLI the pending socket keeps the process alive, here a timer does.
  const keep = setTimeout(() => {}, 10_000), started = performance.now(); assert.equal(await attention([1, 1, 1]), false); clearTimeout(keep);
  assert.ok(performance.now() - started >= ATTENTION_TIMEOUT_MS - 50 && performance.now() - started < ATTENTION_TIMEOUT_MS + 1500);
  release();
  const base = globalThis.fetch;
  for (const reply of [() => new Response('nope', { status: 500 }), () => Response.json({ ok: false, failures: [{ code: 'build.lease' }] }), () => { throw TypeError('fetch failed'); }]) {
    globalThis.fetch = async (url, o) => new URL(url).pathname.endsWith('/attention') ? reply() : base(url, o);
    assert.match(await COMMANDS.where(['1,1'], {}), /ground y/);
    assert.equal(await attention([1, 1, 1]), false);
  }
  assert.deepEqual(noise, []);
});

test('no hint without a lead build: none, claim helpers, --no-build, EDEN_GOD_ATTENTION=off, bad points', async t => {
  for (const [name, setup] of [
    ['no build', { build: null }],
    ['claim helper', { build: { id: 'chapel', claim: 'c_1234abcd', n: 1, label: 'shell' } }],
  ]) {
    await t.test(name, async t2 => { const f = fixture(t2, setup); await COMMANDS.where(['1,1'], {}); await settle(); assert.equal(f.hints.length, 0); });
  }
  await t.test('--no-build', async t2 => { const f = fixture(t2); await COMMANDS.where(['1,1'], { 'no-build': true }); await settle(); assert.equal(f.hints.length, 0); });
  await t.test('env off', async t2 => { const f = fixture(t2); process.env.EDEN_GOD_ATTENTION = 'off'; await COMMANDS.where(['1,1'], {}); await settle(); assert.equal(f.hints.length, 0); });
  await t.test('EDEN_GOD_CLAIM', async t2 => {
    const f = fixture(t2); process.env.EDEN_GOD_CLAIM = 'c_1234abcd'; writeFileSync('.eden-god.claim-c_1234abcd.json', JSON.stringify({}));
    await COMMANDS.where(['1,1'], {}); await settle(); assert.equal(f.hints.length, 0, 'a claim file strips the lead lease');
  });
  await t.test('no plot, bad point', async t2 => {
    const f = fixture(t2, { free: [] }); await COMMANDS.free(['8x8'], {}); await settle();
    for (const p of [[1, 2], [1, NaN, 2], '1,2,3', null]) assert.equal(await attention(p), false);
    assert.equal(f.hints.length, 0);
  });
});

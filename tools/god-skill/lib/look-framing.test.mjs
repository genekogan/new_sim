// Ported coordinate/span policy coverage from retained 02-coordinate-look-distance.patch.
// Runs the actual shoot callbacks against a scripted viewer; no browser, server or GPU.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lookFrame, parseFlags, checkArgs, COMMANDS } from '../cli.mjs';
import { camera, shoot } from './look.mjs';

const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const near = (a, b, eps = 1e-8) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const v = { rows: [], extent: 60, get: () => null, def: () => null };
const resolveArgs = argv => { const { flags, rest } = parseFlags(argv); checkArgs('look', flags, rest); return { flags, frame: lookFrame(v, 60, flags) }; };
const camFor = (f, flags = {}) => camera({ target: f.target, span: f.span, dist: f.dist, tight: f.tight, from: flags.from ?? 's', inside: !!flags.inside, height: flags.height !== undefined ? Number(flags.height) : undefined });

class Vector {
  constructor(a = [0, 0, 0]) { this.a = [...a]; }
  set(...a) { this.a = a; return this; }
  toArray() { return [...this.a]; }
}
async function realized(frame, cam, { keep = false, first = false, fov = 45, aspect = 1.6, nearPlane = .1, drift = false, neverReady = false, shots = [{}] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'w3-look-cpu-')), out = join(dir, 'scripted.png');
  const saved = Object.fromEntries(['window', 'document', 'requestAnimationFrame'].map(k => [k, globalThis[k]]));
  let closed = 0, released = 0, captures = 0, clock = 0, navigations = [], appliedBeforeReady = false;
  let url = 'http://world.invalid/w/fixture?shot=1' + (first ? '' : '&eye=0,10,10&at=0,0,0'), initialized = !first;
  const viewer = { camera: { fov, aspect, near: nearPlane, far: 2400, position: new Vector(), lookAt() {}, updateProjectionMatrix() {} },
    controls: { target: new Vector(), update() { if (!initialized) appliedBeforeReady = true; } },
    layer: { active: true, drawn: new Map(), now: 0 }, scene: { fog: null, traverse() {} } };
  const canvas = { width: 1024, height: 640, children: [], style: {}, parentElement: null,
    toDataURL() { captures++; return 'data:image/png;base64,c2NyaXB0ZWQ='; } };
  globalThis.window = { __simEntity: viewer, __shotReady: initialized && !neverReady };
  globalThis.document = { title: 'loading', querySelector: () => canvas, querySelectorAll: () => [canvas] };
  globalThis.requestAnimationFrame = callback => callback();
  const advance = ms => {
    clock += ms;
    if (!initialized && clock >= 3000) {
      initialized = true;
      // The viewer's own delayed first framing reads the navigation URL, or uses its default.
      const q = new URL(url).searchParams;
      viewer.camera.position.set(...(q.get('eye')?.split(',').map(Number) ?? [100, 100, 100]));
      viewer.controls.target.set(...(q.get('at')?.split(',').map(Number) ?? [0, 0, 0]));
      window.__shotReady = !neverReady;
    }
  };
  const page = { url: () => url, goto: async u => { url = u; navigations.push(u); initialized = false; window.__shotReady = false; },
    evaluate: async (fn, args) => fn(args), waitForTimeout: async ms => { advance(ms); if (drift) viewer.controls.target.set(7, 8, 9); } };
  const browser = { contexts: () => [{ pages: () => [page] }], newContext: async () => ({ addInitScript: async () => {}, newPage: async () => page }), close: async () => { closed++; } };
  try {
    const results = [];
    for (const overrides of shots) {
      const receipt = await shoot({ worldUrl: 'http://world.invalid/w/fixture', eye: cam.eye, at: cam.at, span: frame.fitSpan,
        out, timeoutMs: 9000, settleMs: first ? 3500 : 800, keep, ...overrides },
        { pw: { chromium: { launch: async () => browser, connectOverCDP: async () => browser } },
          // This fixture isolates capture/camera policy; look-sheet.test covers the real event waiter.
          waitReady: async () => { advance(3000); if (!window.__shotReady) throw Error('viewer did not initialize and settle'); return { ready: true }; },
          ensureKeeper: async () => ({ port: 1 }), lease: async () => () => { released++; }, now: () => clock, sleep: async ms => advance(ms) });
      assert.equal(readFileSync(out, 'utf8'), 'scripted');
      results.push({ receipt, url, navigations: navigations.length });
    }
    return { eye: viewer.camera.position.toArray(), at: viewer.controls.target.toArray(), receipt: results.at(-1).receipt, results, navigations, appliedBeforeReady, captures };
  } catch (e) {
    assert.equal(existsSync(out), false, 'refuse before writing an unverified shot');
    assert.equal(captures, 0, 'refuse before reading the canvas');
    throw e;
  } finally {
    assert.equal(closed, keep ? 0 : 1); assert.equal(released, keep ? 0 : 1);
    for (const [k, value] of Object.entries(saved)) { if (value === undefined) delete globalThis[k]; else globalThis[k] = value; }
    rmSync(dir, { recursive: true, force: true });
  }
}

test('first kept shot navigates with requested eye/at and waits for viewer initialization', async () => {
  const frame = lookFrame(v, 60, { at: '-2,0', from: 'sw', dist: '9' }), cam = camFor(frame, { from: 'sw' });
  const actual = await realized(frame, cam, { keep: true, first: true });
  assert.equal(actual.navigations.length, 1);
  const q = new URL(actual.navigations[0]).searchParams;
  assert.equal(q.get('eye'), cam.eye.join(',')); assert.equal(q.get('at'), cam.at.join(','));
  assert.equal(actual.appliedBeforeReady, false);
  assert.deepEqual(actual.eye, cam.eye); assert.deepEqual(actual.at, cam.at);
  assert.deepEqual(actual.receipt.frames.at, cam.at);
});

test('subsequent kept shots reuse the initialized tab and apply new framing', async () => {
  const frame = { fitSpan: 0 }, cam = camera({ target: [3, 2, -4], span: 4, dist: 12 });
  const actual = await realized(frame, cam, { keep: true });
  assert.equal(actual.navigations.length, 0);
  assert.deepEqual(actual.eye, cam.eye); assert.deepEqual(actual.at, cam.at);
});

test('plain and first kept shots carry hour/weather without changing initial camera framing', async () => {
  const frame = { fitSpan: 0 }, cam = camera({ target: [3, 2, -4], span: 4, dist: 12 });
  for (const keep of [false, true]) {
    const actual = await realized(frame, cam, { keep, first: true, shots: [{ hour: '21:00', weather: 'rain' }] });
    assert.equal(actual.navigations.length, 1);
    const q = new URL(actual.navigations[0]).searchParams;
    assert.equal(q.get('hour'), '21:00'); assert.equal(q.get('weather'), 'rain');
    assert.equal(q.get('eye'), cam.eye.join(',')); assert.equal(q.get('at'), cam.at.join(','));
    assert.equal(q.get('shot'), '1'); assert.equal(q.get('settle'), '1500');
    assert.equal(actual.appliedBeforeReady, false);
    assert.deepEqual(actual.eye, cam.eye); assert.deepEqual(actual.at, cam.at);
  }
});

test('kept shots reload only when hour/weather change or clear, and reuse repeats', async () => {
  const frame = { fitSpan: 0 }, cam = camera({ target: [3, 2, -4], span: 4, dist: 12 });
  const shots = [{}, { hour: '21:00', weather: 'rain' }, { hour: '21:00', weather: 'rain' },
    { hour: '22:00', weather: 'rain' }, { hour: '22:00', weather: 'clear' },
    { hour: '22:00' }, { hour: '22:00' }, { weather: 'rain' }, { weather: 'rain' }, {}, {}];
  const actual = await realized(frame, cam, { keep: true, shots });
  assert.deepEqual(actual.results.map(r => r.navigations), [0, 1, 1, 2, 3, 4, 4, 5, 5, 6, 6]);
  for (const [i, result] of actual.results.entries()) {
    const q = new URL(result.url).searchParams;
    assert.equal(q.get('hour'), shots[i].hour ?? null);
    assert.equal(q.get('weather'), shots[i].weather ?? null);
    assert.deepEqual(result.receipt.frames.eye, cam.eye); assert.deepEqual(result.receipt.frames.at, cam.at);
  }
  assert.equal(actual.captures, shots.length);
  assert.equal(actual.appliedBeforeReady, false);
});

test('shots without overrides preserve the existing launch URL and kept tab URL', async () => {
  const frame = { fitSpan: 0 }, cam = camera({ target: [3, 2, -4], span: 4, dist: 12 });
  const expected = `http://world.invalid/w/fixture?${new URLSearchParams({ shot: '1', eye: cam.eye.join(','), at: cam.at.join(','), settle: '1500' })}`;
  for (const keep of [false, true]) {
    const first = await realized(frame, cam, { keep, first: true });
    assert.deepEqual(first.navigations, [expected]);
  }
  const reused = await realized(frame, cam, { keep: true });
  assert.deepEqual(reused.navigations, []);
  assert.equal(reused.results[0].url, 'http://world.invalid/w/fixture?shot=1&eye=0,10,10&at=0,0,0');
});

test('npx fallback carries hour/weather and leaves URLs without overrides unchanged', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'look-fallback-')), out = join(dir, 'fallback.png');
  const eye = [0, 10, 10], at = [0, 0, 0];
  try {
    for (const overrides of [{}, { hour: '21:00', weather: 'rain' }]) {
      const calls = [];
      const receipt = await shoot({ worldUrl: 'http://world.invalid/w/fixture', eye, at, out, ...overrides },
        { pw: null, spawnSync: (cmd, args) => { calls.push({ cmd, args }); writeFileSync(out, 'scripted'); return { status: 0 }; } });
      assert.equal(calls.length, 1); assert.equal(calls[0].cmd, 'npx');
      const url = calls[0].args.at(-2), q = new URL(url).searchParams;
      assert.equal(q.get('hour'), overrides.hour ?? null); assert.equal(q.get('weather'), overrides.weather ?? null);
      assert.equal(q.get('eye'), eye.join(',')); assert.equal(q.get('at'), at.join(','));
      assert.equal(receipt.via, 'npx playwright-core screenshot'); assert.equal(receipt.file, out);
      if (!Object.keys(overrides).length) assert.equal(url, 'http://world.invalid/w/fixture?shot=1&eye=0%2C10%2C10&at=0%2C0%2C0');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('camera retargeting during settle refuses capture', async () => {
  const frame = { fitSpan: 0 }, cam = camera({ target: [0, 0, 0], span: 4, dist: 9 });
  await assert.rejects(realized(frame, cam, { drift: true }), /camera.*changed|retargeted/i);
});

test('viewer startup timeout refuses capture', async () => {
  const frame = { fitSpan: 0 }, cam = camera({ target: [0, 0, 0], span: 4, dist: 9 });
  await assert.rejects(realized(frame, cam, { first: true, neverReady: true }), /initializ|ready|settle/i);
});

test('coordinate dist26/dist9 stay distinct through the actual shoot fitting callback', async () => {
  const actualDistances = [];
  for (const dist of [26, 9]) {
    const { flags, frame } = resolveArgs(['--at', '-2,0', '--from', 'sw', '--dist', String(dist)]);
    assert.equal(frame.span, 40); assert.equal(frame.fitSpan, 0);
    const cam = camFor(frame, flags), actual = await realized(frame, cam);
    assert.deepEqual(actual.eye, cam.eye); assert.deepEqual(actual.at, [-2, 0, 0]);
    actualDistances.push(distance(actual.eye, actual.at));
    near(actualDistances.at(-1), dist, .08);
    const old = await realized({ ...frame, fitSpan: 40 }, cam);
    near(distance(old.eye, old.at), 50.698484809834994);
  }
  assert.ok(actualDistances[0] > 2.8 * actualDistances[1]);
});

test('explicit span preserves minimum fit with dist and tightens without the 16m floor', async () => {
  for (const [span, dist, fov, aspect] of [[40, 9, 45, 1.6], [4, 26, 45, 1.6], [4, 1, 60, .5], [4, undefined, 45, 1.6], [1, undefined, 45, 1.6], [.1, undefined, 45, 1.6]]) {
    const flags = { at: '-2,0', span: String(span), ...(dist === undefined ? {} : { dist: String(dist) }) };
    const frame = lookFrame(v, 60, flags), cam = camFor(frame), actual = await realized(frame, cam, { fov, aspect });
    const need = span / (2 * Math.tan(Math.min(fov * Math.PI / 180, 2 * Math.atan(Math.tan(fov * Math.PI / 360) * aspect)) / 2)) * 1.05;
    assert.equal(frame.tight, dist === undefined);
    near(distance(actual.eye, actual.at), Math.max(distance(cam.eye, cam.at), need));
    if (dist === undefined) assert.ok(distance(actual.eye, actual.at) < 16);
  }
});

test('named things/sets, world filtering, target rounding and inside/height keep their policy', async () => {
  const row = (name, pose, aabb, extra = {}) => ({ id: name, name, path: name, def: 'core/fixture@1', parent: 'world', pose, aabb, ...extra });
  const rows = [row('tiny', [3.04, .75, -4.04, 0, 1], [3, -4.1, 3.1, -4]), row('chairs-1', [-5, 0, -2, 0, 1], [-6, -3, -4, -1]),
    row('chairs-2', [5, 0, 2, 0, 1], [4, 1, 6, 3]), row('marker', [60, 0, 60, 0, 1], [60, 60, 60.1, 60.1], { def: 'core/flag@1' }),
    row('large-area', [0, 0, 0, 0, 1], [-100, -100, 100, 100], { shape: { area: [[-100, -100], [100, 100]] } })];
  const fixture = { rows, extent: 60, get: key => rows.find(r => r.name === key) ?? null, def: ref => ({ ref }) };
  const before = JSON.stringify(rows), tiny = lookFrame(fixture, 60, { at: 'tiny' });
  assert.equal(tiny.fitSpan, 4); assert.equal(tiny.tight, false);
  assert.deepEqual(camFor(tiny), { eye: [3, 8.4, 10], at: [3, .8, -4], from: 's' });
  const set = lookFrame(fixture, 60, { at: 'chairs', dist: '1' }); assert.equal(set.fitSpan, 12);
  const actual = await realized(set, camFor(set)); near(distance(actual.eye, actual.at), 15.209545442950498);
  const world = lookFrame(fixture, 60); assert.equal(world.span, 30); near(world.target[2], -.55);
  assert.equal(lookFrame(v, 60).span, 160);
  for (const from of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'above', 'top', 'west']) {
    const flags = { at: 'tiny', from, inside: true, span: '1', height: '2' }, frame = lookFrame(fixture, 60, flags);
    assert.equal(frame.fitSpan, 0); assert.equal(frame.tight, false); assert.equal(camFor(frame, flags).eye[1], 2.8);
  }
  assert.equal(JSON.stringify(rows), before);
});

test('invalid/duplicate dist/span refuse and CLI help explains coordinate/span precedence', () => {
  for (const key of ['dist', 'span']) for (const value of ['0', '-1', 'NaN', 'Infinity', '', true, ['9', '26']]) {
    assert.throws(() => checkArgs('look', { [key]: value }, []), /needs a value|number/);
    assert.throws(() => lookFrame(v, 60, { [key]: value }), /finite positive/);
  }
  assert.throws(() => resolveArgs(['--dist', '9', '--dist', '26']), /one finite positive/);
  assert.throws(() => resolveArgs(['--zoom=2']), /no option --zoom/);
  assert.match(COMMANDS.help(), /--dist controls coordinate views/); assert.match(COMMANDS.help(), /--span is a minimum fit/);
});

test('near-plane camera collapse refuses before canvas capture', async () => {
  for (const flags of [{ at: '-2.04,0.04', span: '.01' }, ...['s', 'sw', 'above'].map(from => ({ at: '-2,0', dist: '.001', from }))]) {
    const frame = lookFrame(v, 60, flags), cam = camFor(frame, flags);
    assert.deepEqual(cam.at, [-2, 0, 0]);
    await assert.rejects(realized(frame, cam), /near clipping plane/);
  }
});

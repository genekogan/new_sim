import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shoot, waitForShot } from './look.mjs';
import { lookViews, look, kitLook, defs, parseFlags, checkArgs } from '../cli.mjs';
import { kitDefinition } from './kit.mjs';
import { invalidate } from './mirror.mjs';

const kit = { name: 'test-chair', shapes: [{ kind: 'box', at: [0, .5, 0], size: [1, 1, 1] }], slots: [{ id: 'seat', kind: 'seat', p: [0, 1, 0] }] };
test('views parse shorthand and per-camera options without changing their base or permitting actions', () => {
  const base = { at: 'chapel', hour: '21', weather: 'rain' };
  const rows = lookViews('sw;w --dist 30;inside;above --span 10', base);
  assert.equal(rows.length, 4); assert.equal(rows[1].dist, '30'); assert.equal(rows[2].inside, true);
  assert.equal(rows[0].at, 'chapel'); assert.equal(rows[0].hour, '21'); assert.equal(base.from, undefined);
  for (const s of ['', 'sw;', 'a;w', 'sw --out hack', 'sw --dist 0', Array(9).fill('s').join(';')]) assert.throws(() => lookViews(s));
  for (const [cmd, args] of [['look', ['--site']], ['look', ['--views', 'sw;inside']], ['look', ['--frames', '4', '--every', '250']], ['defs', ['--unused', '--remove']], ['kit', ['look', 'defs/chair.json', '--hour', '21']]]) {
    const { flags, rest } = parseFlags(args); checkArgs(cmd, flags, rest);
  }
});
function apiFixture(t) {
  const cwd = process.cwd(), original = globalThis.fetch, dir = mkdtempSync(join(tmpdir(), 'w1-cli-')), calls = [];
  process.chdir(dir); invalidate();
  writeFileSync('.eden-god.json', JSON.stringify({ world: 'http://127.0.0.1:5362/w/unit', token: 'fixture-only', build: { id: 'chapel' } }));
  globalThis.fetch = async (url, o) => {
    calls.push({ url, ...o });
    const path = new URL(url).pathname;
    if (path.endsWith('/seq')) return Response.json({ seq: 1, builds: 0 });
    if (path.endsWith('/snapshot')) return Response.json({ seq: 1, buildsRev: 0, constants: { extent: 100 }, entities: [], library: [] });
    if (path.endsWith('/query')) return Response.json(JSON.parse(o.body).layout ? { layout: { entities: [] } } : { points: [{ y: 2, water: 0 }] });
    if (path.endsWith('/builds/chapel')) return Response.json({ build: { site: { at: [12, -7], size: [20, 10], yaw: .5 } } });
    if (path.endsWith('/kit/render')) return Response.json({ accepted: true, def: JSON.parse(o.body).def, defs: [] });
    if (path.endsWith('/unused/remove')) return Response.json({ accepted: true, seq: 2, removed: ['test-chair@1'] });
    if (path.endsWith('/unused')) return Response.json({ defs: [{ ref: 'test-chair@1' }] });
    throw Error(`unexpected ${path}`);
  };
  t.after(() => { globalThis.fetch = original; process.chdir(cwd); invalidate(); rmSync(dir, { recursive: true, force: true }); });
  return calls;
}
test('look --site centers four default views on the current site and preserves picture overrides', async t => {
  apiFixture(t); let captured;
  const shot = await look({ site: true, hour: '21', weather: 'rain', json: true }, { shoot: async args => { captured = args; return { file: args.out, ms: 12 }; } });
  assert.equal(captured.views.length, 4); assert.deepEqual(shot.at, [12, 2, -7]);
  assert.equal(captured.views[3].hideRoofs, true); assert.equal(captured.views[3].span, 0);
  assert.equal(captured.hour, '21:00'); assert.equal(captured.weather, 'rain');
});
test('kit look sends only one render admission, uses the shared definition conversion, and never define/act', async t => {
  const calls = apiFixture(t); let captured;
  await kitLook(JSON.stringify(kit), { beside: 'core/church@1', hour: '21' }, { shoot: async args => { captured = args; return { file: args.out, ms: 1, warnings: [] }; } });
  assert.equal(calls.length, 1); assert.match(calls[0].url, /kit\/render$/);
  assert.deepEqual(JSON.parse(calls[0].body), { def: kitDefinition(kit), beside: 'core/church@1' });
  assert.equal(captured.hour, '21:00'); assert.ok(captured.studio);
});
test('unused cleanup posts a dedicated authenticated request without current-build injection', async t => {
  const calls = apiFixture(t);
  assert.deepEqual(await defs(undefined, { unused: true, json: true }), [{ ref: 'test-chair@1' }]);
  const removed = await defs(undefined, { unused: true, remove: true, json: true });
  assert.deepEqual(removed.removed, ['test-chair@1']); assert.deepEqual(JSON.parse(calls[1].body), {});
  await assert.rejects(defs('chair', { unused: true }), /search/); await assert.rejects(defs(undefined, { remove: true }), /requires --unused/);
});
test('invalid frame/sheet options refuse before HTTP or Chrome', async () => {
  for (const flags of [{ frames: 0 }, { frames: 17 }, { frames: 2.5 }, { every: 250 }, { frames: 3, every: 1 }, { frames: 2, views: 's;w' }]) await assert.rejects(look(flags), /frames|every|choose/);
  await assert.rejects(shoot({ frames: 17 }), /frames/);
  await assert.rejects(shoot({ frames: 2, width: 4096, height: 4096 }), /megapixel/);
});

function globals(t, values) {
  const before = Object.fromEntries(Object.keys(values).map(k => [k, globalThis[k]])); Object.assign(globalThis, values);
  t.after(() => { for (const [k, value] of Object.entries(before)) if (value === undefined) delete globalThis[k]; else globalThis[k] = value; });
}
test('real readiness waiter wakes on ready event, waits for easing and releases listeners/frames', async t => {
  const target = new EventTarget(); let listeners = 0, ticks = 0;
  const w = { __shotReady: false, __simEntity: { layer: { active: true, drawn: new Map(), now: 0 } },
    addEventListener(...args) { listeners++; target.addEventListener(...args); }, removeEventListener(...args) { listeners--; target.removeEventListener(...args); } };
  const layer = w.__simEntity.layer; layer.drawn.set('chair', { t0: 0, dur: .04 });
  globals(t, { window: w, document: { title: 'loading' }, requestAnimationFrame: fn => setImmediate(() => { ticks++; layer.now += 16; fn(); }), cancelAnimationFrame: id => clearImmediate(id) });
  queueMicrotask(() => { w.__shotReady = true; target.dispatchEvent(new Event('sim-shot-ready')); });
  const result = await waitForShot({ expect: 1, timeoutMs: 500 });
  assert.equal(result.ready, true); assert.ok(ticks >= 3); assert.equal(listeners, 0);
});
test('real readiness waiter rejects an unready or non-entity page without capture', async t => {
  globals(t, { window: { addEventListener() {}, removeEventListener() {} }, document: { title: 'no-entity-world' }, cancelAnimationFrame() {} });
  await assert.rejects(waitForShot({ timeoutMs: 10 }), /no entity layer/);
  document.title = 'loading'; globalThis.requestAnimationFrame = () => 1;
  await assert.rejects(waitForShot({ timeoutMs: 5 }), /timeout/);
});

test('one browser/page/readiness wait produces labelled views or timed frame strip and closes on navigation failure', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'w1-sheet-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  let clock = 0, launches = 0, closes = 0, waits = 0, released = 0, captures = 0, failGoto = false, cameraSets = 0; const labels = [], cuts = [];
  class V { set(...v) { this.v = v; return this; } toArray() { return this.v; } }
  const canvas = { width: 1024, height: 640, style: {}, children: [], toDataURL() { captures++; cuts.push(window.__buildingView?.cut); return 'data:image/png;base64,cGljdHVyZQ='; } };
  globals(t, { window: { __shotReady: true, __simEntity: { camera: { near: .1, far: 500, position: new V(), lookAt() {} }, controls: { target: new V(), update() { cameraSets++; } }, scene: { traverse() {} } } },
    document: { querySelector: () => canvas, querySelectorAll: () => [canvas], createElement: () => ({ getContext: () => ({ fillRect() {}, drawImage() {}, fillText: text => labels.push(text) }), toDataURL: () => 'data:image/png;base64,c2hlZXQ=' }) },
    requestAnimationFrame: fn => fn(), Image: class { async decode() {} } });
  const page = { goto: async () => { if (failGoto) throw Error('navigation failed'); }, evaluate: async (fn, args) => fn(args), waitForTimeout: async ms => { clock += ms; } };
  const browser = { newContext: async () => ({ addInitScript() {}, newPage: async () => page }), close: async () => { closes++; } };
  const runtime = { pw: { chromium: { launch: async () => { launches++; return browser; } } }, lease: async () => () => { released++; }, now: () => clock, waitReady: async () => { waits++; return { ready: true }; } };
  const common = { worldUrl: 'http://127.0.0.1:5362', out: join(dir, 'sheet.png'), eye: [0, 5, 10], at: [0, 0, 0] };
  const sheet = await shoot({ ...common, cut: 1, hideRoofs: true, views: ['sw', 'side', 'top', 'inside'].map((label, i) => ({ eye: [0, 5, 10], at: [0, 0, 0], hideRoofs: true, cut: i === 0 ? 1 : null, label })) }, runtime);
  assert.equal(sheet.cells, 4); assert.equal(waits, 1); assert.equal(launches, 1); assert.equal(captures, 4); assert.deepEqual(labels, ['sw', 'side', 'top', 'inside']); assert.deepEqual(cuts, [1, null, null, null], 'each view can clear a prior floor cut');
  assert.equal(readFileSync(common.out, 'utf8'), 'sheet');
  const strip = await shoot({ ...common, frames: 3, every: 250 }, runtime);
  assert.deepEqual(strip.frames.map(f => f.ms), [0, 250, 500]); assert.deepEqual(labels.slice(4), ['Frame 1 · +0 ms', 'Frame 2 · +250 ms', 'Frame 3 · +500 ms']);
  assert.equal(cameraSets, 5, 'one camera setup for the entire motion strip');
  assert.equal(waits, 2); failGoto = true; await assert.rejects(shoot(common, runtime), /navigation failed/);
  assert.equal(launches, 3); assert.equal(closes, 3); assert.equal(released, 3);
});

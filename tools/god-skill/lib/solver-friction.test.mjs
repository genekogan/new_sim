import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { solve, frameOf, toWorldIn, obbHit, dirOfYaw, inPoly } from './solver.mjs';
import { COMMANDS, checkArgs } from '../cli.mjs';
import { invalidate } from './mirror.mjs';

const bench = { def: 'core/bench@1', form: 'point', layer: 'solid', box: [1.6, .5, .5] };
const view = rows => ({ rows, extent: 200, get: key => rows.find(r => r.path === key || r.id === key) ?? null });
const house = (yaw = 0, scale = 1) => ({ id: 'h', path: 'house', parent: 'world', form: 'point', layer: 'solid', def: 'core/house@1', tags: [],
  pose: [10, 0, 20, yaw, scale], box: [12, 5, 8], aabb: [-10, 0, 30, 40], obbs: [],
  slots: [{ id: 'room', kind: 'room', p: [11, 0, 21], yaw: yaw + .3, capacity: 64, used: 0, local: [[-5, -3], [5, -3], [5, 3], [-5, 3]] }], doors: [] });
const first = sol => sol.items[0].candidates[0];
const near = (a, b, eps = .02) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const zone = d => { const f = dirOfYaw(d.yaw); return { c: [d.at[0] + f[0] * 1.25, d.at[1] + f[1] * 1.25], half: [d.width / 2 + .35, 1.25], yaw: d.yaw }; };

test('against signed offset moves along each selected side and keeps the wall distance', () => {
  const h = house(), v = view([h]);
  for (const [side, tang] of [['n', [1, 0]], ['e', [0, 1]], ['s', [-1, 0]], ['w', [0, -1]]]) {
    const center = first(solve(v, bench, { against: `house.${side}` }));
    for (const offset of [-2, 2]) {
      const c = first(solve(v, bench, { against: `house.${side}`, offset }));
      near(c.p[0] - center.p[0], tang[0] * offset); near(c.p[1] - center.p[1], tang[1] * offset);
    }
  }
  checkArgs('place', { against: 'house.n', offset: '2' }, ['bench']);
  assert.match(COMMANDS.help(), /--against ref\[\.n\].*--offset m/);
});

test('against doorway candidates all stay clear and report a slide', () => {
  const h = house(); h.doors = [{ id: 'front-door', out: true, level: 0, width: 1.2, at: [10, 24], yaw: 0 }];
  const sol = solve(view([h]), bench, { against: 'house.s', offset: 0 });
  for (const item of sol.items) for (const c of item.candidates) assert.equal(obbHit({ c: c.p, half: [.8, .25], yaw: c.r }, zone(h.doors[0])), false);
  assert.match(first(sol).note, /slid along/); assert.match(sol.notes.join(' '), /doorway front-door clear/);
});

test('against offset row preserves spacing, and t selects a fraction of the wall', () => {
  const h = house(), v = view([h]);
  const sol = solve(v, bench, { against: 'house.n', offset: 1, row: 3, gap: .4 });
  assert.deepEqual(sol.items.map(i => i.candidates[0].p[0]), [9, 11, 13]);
  const c = first(solve(v, bench, { against: 'house.n', t: .75 })); near(c.p[0], 13);
  // Rotated hosts still use the selected face tangent, not a world-axis offset.
  const rotated = house(Math.PI / 4), rv = view([rotated]);
  const a = first(solve(rv, bench, { against: 'house.e' })), b = first(solve(rv, bench, { against: 'house.e', offset: 1 }));
  near(Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]), 1);
});

test('against refuses invalid/off-wall offsets and walls with no safe doorway space', () => {
  const h = house(), v = view([h]);
  for (const rel of [{ offset: '1,2' }, { offset: '' }, { offset: true }, { offset: [1, 2] }, { offset: 99 }, { t: -.1 }, { t: 1.1 }, { offset: 1, t: .5 }])
    assert.throws(() => solve(v, bench, { against: 'house.n', ...rel }), /offset|--t|side|wall/);
  h.doors = [{ id: 'wide-door', out: true, level: 0, width: 12, at: [10, 24], yaw: 0 }];
  assert.throws(() => solve(v, bench, { against: 'house.s' }), /doorway|door|clear/);
});

test('inside --at honors a world point in translated, rotated and scaled room frames', () => {
  for (const [yaw, scale] of [[0, 1], [Math.PI / 2, 1], [.65, 2]]) {
    const h = house(yaw, scale), F = frameOf(h, 'room'), point = toWorldIn(F, 1.5, -.75);
    const c = first(solve(view([h]), bench, { inside: 'house/room', at: point.join(','), yaw: 1.2 }));
    assert.deepEqual(c.in, { parent: 'house', slot: 'room' }); assert.deepEqual(c.p, [1.5, -.75]);
    const actual = toWorldIn(F, ...c.p); near(actual[0], point[0]); near(actual[1], point[1]); near(c.r + F.RY, 1.2);
    assert.ok(c.constraints.some(x => x.kind === 'inside' && x.ref === 'house/room'));
  }
});

test('inside explicit point refuses outside/through-wall locations and ambiguous automatic placement', () => {
  const h = house(), v = view([h]);
  for (const at of ['100,100', '15.9,21']) assert.throws(() => solve(v, bench, { inside: 'house/room', at }), /outside|wall|fit/);
  for (const rel of [{ wall: 'n' }, { corner: 'ne' }, { count: 2 }]) assert.throws(() => solve(v, bench, { inside: 'house/room', at: '12,21', ...rel }), /--at|point/);
});

test('inside explicit point keeps doorways/occupants clear and supports world offsets/facing', () => {
  const h = house(), v = view([h]);
  h.doors = [{ id: 'inner-door', out: true, level: 0, width: 1, at: [11, 21], yaw: 0 }];
  assert.throws(() => solve(v, bench, { inside: 'house/room', at: '11,21' }), /doorway inner-door/);
  h.doors = [];
  const prop = { id: 'p', path: 'house/prop', parent: 'h', slot: 'room', layer: 'solid', form: 'point', tags: [], pose: [12, 0, 21, 0, 1], box: [1, 1, 1], aabb: [11.5, 20.5, 12.5, 21.5], obbs: [[12, 21, .5, .5, 0]] };
  assert.throws(() => solve(view([h, prop]), bench, { inside: 'house/room', at: '12,21' }), /house\/prop/);
  const c = first(solve(v, bench, { inside: 'house/room', at: '11,21', offset: '1,0', facing: 'n' }));
  assert.deepEqual(c.p, [1, 0]); near(c.r + h.slots[0].yaw, Math.PI);
});

test('inside row/grid preserves the requested count, world gaps and complete footprints in rotated/scaled rooms', () => {
  for (const [yaw, scale] of [[0, 1], [Math.PI / 2, 1], [.65, 2]]) {
    const h = house(yaw, scale), F = frameOf(h, 'room');
    for (const [rel, count] of [[{ row: 3 }, 3], [{ grid: '3x2' }, 6]]) {
      const sol = solve(view([h]), bench, { inside: 'house/room', gap: 1, ...rel });
      assert.equal(sol.items.length, count);
      const ps = sol.items.map(i => i.candidates[0]);
      for (const c of ps) {
        assert.deepEqual(c.in, { parent: 'house', slot: 'room' });
        // The complete rotated footprint, not just its centre, stays in the polygon.
        for (const a of [-1, 1]) for (const b of [-1, 1]) {
          const angle = c.r + F.RY - F.PY, x = a * bench.box[0] / 2, z = b * bench.box[2] / 2;
          assert.ok(inPoly(c.p[0] + x * Math.cos(angle) + z * Math.sin(angle), c.p[1] - x * Math.sin(angle) + z * Math.cos(angle), h.slots[0].local));
        }
      }
      const p0 = toWorldIn(F, ...ps[0].p), p1 = toWorldIn(F, ...ps[1].p);
      near(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), bench.box[0] * scale + 1, .04);
    }
  }
});

test('inside row/grid uses exact world anchors and wall placement, and refuses an unfit run with a typed fix', () => {
  const h = house(), v = view([h]);
  for (const rel of [{ at: '11,21' }, { wall: 'back' }]) assert.equal(solve(v, bench, { inside: 'house/room', row: 3, gap: .2, ...rel }).items.length, 3);
  for (const rel of [{ row: 20 }, { grid: '3x20' }, { row: 0 }, { row: 2.5 }, { grid: '2x2x2' }, { row: 2, grid: '2x2' }, { row: 2, gap: -1 }, { row: 2, at: '100,100' }]) {
    assert.throws(() => solve(v, bench, { inside: 'house/room', ...rel }), e => e.code === 'constraint.unsatisfied' && e.failure.field && /fewer items.*gap.*larger room/.test(e.fix));
  }
  // A notch crossing the run between its corners must not be mistaken for room space.
  h.slots[0].local = [[-5,-3],[5,-3],[5,3],[.5,3],[.5,-1],[-.5,-1],[-.5,3],[-5,3]];
  assert.throws(() => solve(v, bench, { inside: 'house/room', at: '11,21', row: 3, gap: .1 }), e => e.code === 'constraint.unsatisfied');
});

function dryFixture(t, h) {
  const cwd = process.cwd(), originalFetch = globalThis.fetch, dir = mkdtempSync(join(tmpdir(), 'w3-place-cpu-')), bodies = [];
  process.chdir(dir); invalidate();
  writeFileSync('.eden-god.json', JSON.stringify({ world: 'http://world.invalid/w/fixture' }));
  globalThis.fetch = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : null;
    if (url.endsWith('/v1/world/seq')) return Response.json({ seq: 1 });
    if (url.endsWith('/v1/god/snapshot')) return Response.json({ seq: 1, constants: { extent: 200 }, entities: [], defs: [], library: [] });
    if (url.endsWith('/v1/god/query')) return Response.json(body.bake ? { bake: bench } : { layout: { entities: [h] } });
    assert.ok(url.endsWith('/v1/god/dryrun'), `unexpected request: ${url}`);
    bodies.push(body); return Response.json({ accepted: true });
  };
  t.after(() => { globalThis.fetch = originalFetch; process.chdir(cwd); invalidate(); rmSync(dir, { recursive: true, force: true }); });
  return bodies;
}

test('place dry run forwards --against offset and reports doorway sliding in text and JSON', async t => {
  const h = house(); h.doors = [{ id: 'front-door', out: true, level: 0, width: 1.2, at: [10, 24], yaw: 0 }];
  const bodies = dryFixture(t, h);
  const text = await COMMANDS.place(['bench'], { against: 'house.s', offset: '0', dry: true });
  assert.match(text, /slid along/); assert.match(text, /doorway front-door clear/);
  const json = await COMMANDS.place(['bench'], { against: 'house.n', offset: '2', dry: true, json: true });
  near(json.ops[0].p[0], 12); assert.ok(json.notes.some(n => /2 m along/.test(n)));
  assert.equal(bodies.length, 2, 'only dry runs, no act requests');
});

test('place dry run forwards --inside --at as the requested world point in a room frame', async t => {
  const h = house(Math.PI / 2, 2), point = toWorldIn(frameOf(h, 'room'), 1.5, -.75), bodies = dryFixture(t, h);
  const flags = { inside: 'house/room', at: point.join(','), dry: true, json: true };
  const json = await COMMANDS.place(['bench'], flags);
  assert.deepEqual(json.ops[0].p, [1.5, -.75]); assert.deepEqual(json.ops[0].in, { parent: 'house', slot: 'room' });
  await assert.rejects(COMMANDS.place(['bench'], { ...flags, at: '100,100' }), /outside room/);
  assert.equal(bodies.length, 1, 'outside point refuses before a dry run');
});

test('place --inside --row sends every entity, and an unfit grid refuses before admission', async t => {
  const bodies = dryFixture(t, house());
  const json = await COMMANDS.place(['bench'], { inside: 'house/room', row: '3', gap: '1', dry: true, json: true });
  assert.equal(json.ops.length, 3); assert.equal(bodies[0].ops.length, 3);
  assert.ok(json.ops.every(op => op.in.parent === 'house' && op.in.slot === 'room'));
  await assert.rejects(COMMANDS.place(['bench'], { inside: 'house/room', grid: '8x8', gap: '1', dry: true }), e => e.code === 'constraint.unsatisfied' && !!e.fix);
  assert.equal(bodies.length, 1);
});

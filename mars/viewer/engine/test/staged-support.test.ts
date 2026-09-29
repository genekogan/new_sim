import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { Runtime } from '../runtime/runtime.ts';
import { Spatial, entityFootprint } from '../spatial/service.ts';
import { emptyWorld, addAll, component, human } from '../world/factory.ts';
import { installTread } from '../construction/stairs.ts';
import { stagedCheck } from '../construction/access.ts';
import { rot2, type Vec2 } from '../core/math.ts';
import type { Surface, SpatialScene } from '../spatial/types.ts';

const captures: unknown[] = [];
function fixture(yaw = 0) {
  const item = component('sheet', 'plywood-4x6', [0, 2, 0], yaw, { phase: 'staged', support: { kind: 'ground' } });
  const fp = entityFootprint(item);
  const base: SpatialScene = { bounds: [-5, -5, 5, 5], levels: [{ id: 1, y: 2, label: 'deck' }], surfaces: [], obstacles: [], links: [] };
  const floor = (id: string, x: number, hx: number): Surface => ({ id, level: 1, y: 2, obb: { c: rot2([x, 0], yaw), half: [hx, fp.obb.half[1]], yaw } });
  const world = addAll(emptyWorld('stage-support', base), item);
  const rt = new Runtime(world, new Map(), { spatial: new Spatial(base) });
  return { item, fp, base, floor, rt };
}
function check(f: ReturnType<typeof fixture>, label: string, ok: boolean) {
  const before = structuredClone(f.rt.world);
  const result = stagedCheck(f.rt, f.item, [0, 0], 'plywood.not-staged');
  assert.equal(result === null, ok, `${label}: ${result?.diagnostic.message}`);
  if (result) assert.equal(result.diagnostic.code, 'plywood.not-staged');
  assert.deepEqual(f.rt.world, before, 'validation does not mutate world/support/ownership');
  captures.push({ case: label, accepted: result === null, diagnostic: result?.diagnostic, footprint: entityFootprint(f.item), surfaces: f.base.surfaces });
}
test('LM041 staged loads need full floor coverage, including rotated contiguous tiles and interior gaps', () => {
  for (const yaw of [0, Math.PI / 4]) {
    const full = fixture(yaw), hx = full.fp.obb.half[0];
    full.base.surfaces = [full.floor('left', -hx / 2, hx / 2), full.floor('right', hx / 2, hx / 2)];
    check(full, `contiguous two surfaces yaw${yaw}`, true);
    const half = fixture(yaw); half.base.surfaces = [half.floor('half', -hx / 2, hx / 2)];
    check(half, `half over deck edge yaw${yaw}`, false);
    const gap = fixture(yaw);
    gap.base.surfaces = [gap.floor('left', -hx / 2 - 0.0005, hx / 2 - 0.0005), gap.floor('right', hx / 2 + 0.0005, hx / 2 - 0.0005)];
    check(gap, `1mm floor seam gap yaw${yaw}`, false);
    const hole = fixture(yaw), hz = hole.fp.obb.half[1];
    hole.base.surfaces = [[-1,-1],[-1,1],[1,-1],[1,1]].map(([x,z], i) => ({ id: `corner${i}`, level: 1, y: 2, obb: { c: rot2([x * hx * 0.8, z * hz * 0.8], yaw), half: [hx * 0.25, hz * 0.25] as Vec2, yaw } }));
    check(hole, `four supported corners with unsupported centre yaw${yaw}`, false);
  }
});
test('LM041 a nearby staged label cannot hide floating, sinking or overlapping geometry', () => {
  for (const dy of [-0.001, 0.001]) {
    const f = fixture(); f.base.surfaces = [f.floor('deck', 0, f.fp.obb.half[0])]; f.item.pose.p[1] += dy;
    check(f, `vertical displacement${dy}`, false);
  }
  const obstructed = fixture();
  obstructed.base.surfaces = [obstructed.floor('deck', 0, obstructed.fp.obb.half[0])];
  obstructed.base.obstacles = [{ id: 'post', obb: { c: [0, 0], half: [0.02, 0.02], yaw: 0 }, y0: 2, y1: 3 }];
  check(obstructed, 'post through sheet', false);
  const held = fixture(); held.base.surfaces = [held.floor('deck', 0, held.fp.obb.half[0])];
  held.rt.world.entities.other = component('other', 'plywood-4x6', [0, 2, 0], 0, { phase: 'carried', support: { kind: 'held', by: ['crew'] } });
  check(held, 'moving load intersects staged sheet', false);
  const person = fixture(); person.base.surfaces = [person.floor('deck', 0, person.fp.obb.half[0])];
  const h = human('bystander', 0, -person.fp.obb.half[1] - 0.22); h.pose.p[1] = 2;
  person.rt.world.entities[h.id] = h;
  check(person, 'person normal body radius extends beyond catalog half-depth', false);
  const prone = fixture(); prone.base.surfaces = [prone.floor('deck', 0, prone.fp.obb.half[0])];
  const lying = human('lying', 0, -prone.fp.obb.half[1] - 0.8); lying.pose.p[1] = 2; lying.human!.activity = 'prone-wait';
  prone.rt.world.entities[lying.id] = lying;
  check(prone, 'prone body extends beyond standing cylinder', false);
  const hands = fixture(); hands.base.surfaces = [hands.floor('deck', 0, hands.fp.obb.half[0])];
  const reaching = human('reaching', 0, -hands.fp.obb.half[1] - 0.8); reaching.pose.p[1] = 2;
  reaching.human!.hands = { left: [0, 2.01, 0] }; hands.rt.world.entities[reaching.id] = reaching;
  check(hands, 'published hand intersects staged sheet', false);

});


test('LM041 exact side/top contact is allowed while penetration beyond round-off is refused', () => {
  for (const side of ['side', 'top']) for (const penetration of [0, 0.5e-7, 2e-7]) {
    const f = fixture(); f.base.surfaces = [f.floor('deck', 0, f.fp.obb.half[0])];
    f.base.obstacles = [{ id: 'contact', obb: { c: side === 'side' ? [f.fp.obb.half[0] + 0.1 - penetration, 0] : [0, 0], half: [0.1, 0.1], yaw: 0 },
      y0: side === 'top' ? f.fp.y1 - penetration : f.fp.y0, y1: f.fp.y1 + 0.2 }];
    check(f, `${side} contact penetration ${penetration}m`, penetration <= 1e-7);
  }
});

test('LM041 public install_tread refuses unsafe staging before reserving crew or mutating support', () => {
  for (const mode of ['half-off-floor', 'obstructed']) {
    const f = fixture();
    delete f.rt.world.entities.sheet;
    const tread = component('tread', 'stair-tread', [0, 2, 0], 0, { phase: 'staged', support: { kind: 'ground' } });
    const fp = entityFootprint(tread);
    // Installed flight is fixture input: this test audits admission, not its prior construction.
    f.rt.world.entities.stair = component('stair', 'stair-flight-10', [3, 2, 0], 0, { phase: 'installed', support: { kind: 'ground' } });
    f.rt.world.entities.tread = tread;
    f.rt.world.entities.crew = human('crew', -3, 0); f.rt.world.entities.crew.pose.p[1] = 2;
    f.base.surfaces = [{ id: 'floor', level: 1, y: 2, obb: { c: mode === 'half-off-floor' ? [-fp.obb.half[0] / 2, 0] : [0, 0], half: [mode === 'half-off-floor' ? fp.obb.half[0] / 2 : 4, 4], yaw: 0 } }];
    if (mode === 'obstructed') f.base.obstacles = [{ id: 'post', obb: { c: [0, 0], half: [0.01, 0.01], yaw: 0 }, y0: 2, y1: 3 }];
    f.rt.registry.set('install_tread', installTread);
    const before = structuredClone(f.rt.world);
    const action = f.rt.submit('install_tread', { crew: ['crew'], stair: 'stair', tread: 'tread', index: 1 });
    assert.equal(action.status, 'failed');
    assert.equal(action.diagnostic?.code, 'tread.not-staged', action.diagnostic?.message);
    assert.deepEqual(f.rt.world, before);
    assert.deepEqual(f.rt.holder('actor:crew'), []);
    assert.deepEqual(f.rt.holder('entity:tread'), []);
    assert.ok(!action.history.some((h) => h.status === 'reserved' || h.status === 'executing'));
    captures.push({ case: `public install_tread ${mode}`, accepted: false, diagnostic: action.diagnostic, footprint: fp, surfaces: f.base.surfaces, action, worldUnchanged: true, actorHolders: f.rt.holder('actor:crew'), itemHolders: f.rt.holder('entity:tread') });
  }
});

after(() => {
  if (process.env.MARS_STAGED_SUPPORT_CAPTURE) writeFileSync(process.env.MARS_STAGED_SUPPORT_CAPTURE, JSON.stringify(captures, null, 2) + '\n');
});

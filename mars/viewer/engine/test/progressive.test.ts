// Progressive construction (spec §7, §10, §12, §28 "Construction changes
// navigation", "Incomplete floor/stairs"; milestone E): joists, plywood decks
// and stairs are walkable only once actually built and supported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS, forgetMotion } from '../runtime/invariants.ts';
import { Spatial, type Contributor } from '../spatial/service.ts';
import { emptyWorld, human, addAll, component } from '../world/factory.ts';
import { walkTo } from '../locomotion/walk.ts';
import { CONSTRUCTION_ACTIONS, liftHandsInReach, progressiveContributor, progressiveSupported, uprightsSupported } from '../construction/index.ts';
import { levelFor } from '../construction/access.ts';
import { handPoint, HAND_REACH, LIFT_APEX_MAX, FOLLOW_SPEED } from '../construction/liftcrew.ts';
import { deckSurfaces } from '../construction/contributor.ts';
import { seatPoint, snapSeat } from '../construction/rules.ts';
import { def } from '../world/catalog.ts';
import type { ActionDef, ActionRecord } from '../actions/types.ts';
import type { Obstacle, SpatialScene } from '../spatial/types.ts';

const L9 = def('beam-9ft').size[0];
const D12 = def('upright-12ft').size[0];
const PANEL_Z = def('plywood-4x6').size[2];
const LYING = Math.PI / 2;
/** A lying frame rests on its face: origin (base centre) raised by half the column thickness (canonicalLying). */
const REST_Y = def('upright-12ft').size[2] / 2;
const JOISTS: [string, number][] = [['j1', 0.2], ['j2', 0.8], ['j3', 1.37], ['j4', 1.95], ['j5', 2.55]];
const PANELS: [string, number][] = [['s1', 0.15 + PANEL_Z / 2], ['s2', 0.15 + PANEL_Z * 1.5]]; // z centres: s1 z∈[0.15,1.37], s2 z∈[1.37,2.59]
const STAIR = { x: 0.94 + def('stair-flight-10').size[0], z: 0.75, heading: Math.PI }; // foot east of the bay, top at the deck's east edge
const DECK_LEVEL = levelFor(1.9875);

function openGround(extra: Obstacle[] = []): SpatialScene {
  return {
    bounds: [-15, -15, 15, 15],
    levels: [{ id: 0, y: 0, label: 'ground' }],
    surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [15, 15], yaw: 0 } }],
    obstacles: extra,
    links: [],
  };
}

function setup(extra: Obstacle[] = [], contributors: Contributor[] = []) {
  const base = openGround(extra);
  const w = addAll(
    emptyWorld('open-ground', base),
    component('A', 'upright-12ft', [0, 0, 0], Math.PI, { phase: 'staged', pose: { p: [0, REST_Y, 0], yaw: Math.PI, pitch: LYING } }),
    component('B', 'upright-12ft', [0, 0, L9], 0, { phase: 'staged', pose: { p: [0, REST_Y, L9], yaw: 0, pitch: LYING } }),
    ...['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((id, i) => human(id, -6 + i * 1.2, -6)),
    human('w', 6, 4),
  );
  const reg = new Map<string, ActionDef>([['walk_to', walkTo], ...CONSTRUCTION_ACTIONS.map((a) => [a.verb, a] as [string, ActionDef])]);
  return new Runtime(w, reg, { spatial: new Spatial(base, { contributors: [progressiveContributor, ...contributors] }) }, [...DEFAULT_INVARIANTS, uprightsSupported, progressiveSupported, liftHandsInReach]);
}

const kids = (rt: Runtime, r: ActionRecord) => JSON.stringify([...rt.records.values()].filter((x) => x.parent === r.id).map((x) => [x.verb, x.status, x.diagnostic?.message]));

function must(rt: Runtime, verb: string, params: unknown) {
  const r = rt.submit(verb, params);
  if (r.status !== 'failed') rt.runUntilIdle(20 * 180, [r.id]);
  assert.equal(r.status, 'completed', `${verb} ${JSON.stringify(params)}: ${r.status} ${r.phase ?? ''} ${r.diagnostic?.code} ${r.diagnostic?.message} ${kids(rt, r)}`);
  return r;
}

/** Raise A and B, seat beams at 0.5 m and 1.8 m on both columns, release (supported bay). */
function buildBay(rt: Runtime, release = true) {
  must(rt, 'raise_upright', { crew: ['p1', 'p2'], item: 'A' });
  must(rt, 'raise_upright', { crew: ['p3', 'p4'], item: 'B' });
  // raised frames stand on the ground (y 0): beam seats — and so every deck above — take their world
  // height from the upright's base, so a frame sunk into the ground lowers the whole deck
  for (const id of ['A', 'B']) assert.ok(Math.abs(rt.world.entities[id].pose.p[1]) < 1e-9, `${id} stands at y ${rt.world.entities[id].pose.p[1]}`);
  const x = D12 / 2;
  rt.world.entities.b1 = component('b1', 'beam-9ft', [-x, 0, L9 / 2], Math.PI / 2, { phase: 'staged' });
  rt.world.entities.b2 = component('b2', 'beam-9ft', [x, 0, L9 / 2], Math.PI / 2, { phase: 'staged' });
  rt.world.entities.b3 = component('b3', 'beam-9ft', [-x + 0.25, 0, L9 / 2], Math.PI / 2, { phase: 'staged' });
  rt.world.entities.b4 = component('b4', 'beam-9ft', [x - 0.25, 0, L9 / 2], Math.PI / 2, { phase: 'staged' });
  for (const [beam, col, height] of [['b1', 'r', 0.5], ['b2', 'l', 0.5], ['b3', 'r', 1.8], ['b4', 'l', 1.8]] as const)
    must(rt, 'connect_beam', { crew: ['p5', 'p6'], beam, a: 'A', b: 'B', column: col, height });
  if (release) {
    must(rt, 'release_support', { item: 'A' });
    must(rt, 'release_support', { item: 'B' });
  }
}

/** Components delivered to the work area (the carry action's job; placed directly here). */
function stageParts(rt: Runtime) {
  const E = rt.world.entities;
  JOISTS.forEach(([id], k) => (E[id] = component(id, '2x4-6ft', [-1.6 - 0.12 * k, 0, 1.37], Math.PI / 2, { phase: 'staged' })));
  PANELS.forEach(([id, z]) => (E[id] = component(id, 'plywood-4x6', [-2.7, 0, z], 0, { phase: 'staged' })));
  E.st = component('st', 'stair-flight-10', [5.0, 0, 0.75], Math.PI, { phase: 'staged' });
  for (let i = 1; i <= 10; i++) {
    const s = -1.25 + (i - 0.5) * 0.25; // tread i along the flight (local), flight centre x = 2.19, heading −x
    E[`t${i}`] = component(`t${i}`, 'stair-tread', [0.94 + 1.25 - s, 0, 2.4], Math.PI / 2, { phase: 'staged' });
  }
}

const joists = (rt: Runtime, which = JOISTS) => { for (const [joist, at] of which) must(rt, 'install_joist', { crew: ['p5'], joist, bay: { a: 'A', b: 'B' }, height: 1.8, at }); };
const panel = (rt: Runtime, i: 0 | 1, crew = ['p3', 'p4']) => must(rt, 'install_plywood', { crew, sheet: PANELS[i][0], x: 0, z: PANELS[i][1], yaw: 0 });
/** Deck crews step back to the muster line so the stair site is clear (a stair on people is refused: stair.site-occupied). */
function muster(rt: Runtime) {
  ['p3', 'p4', 'p5'].forEach((id) => must(rt, 'walk_to', { actor: id, x: -6 + 1.2 * (Number(id[1]) - 1), z: -6, level: 0 }));
}
const stair = (rt: Runtime) => must(rt, 'install_stair_flight', { crew: ['p1', 'p2'], stair: 'st', ...STAIR });
const treads = (rt: Runtime, ix: number[]) => { for (const i of ix) must(rt, 'install_tread', { crew: ['p6'], stair: 'st', tread: `t${i}`, index: i }); };
const all10 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const stairLinkNow = (rt: Runtime) => { const sp = rt.services.spatial as Spatial; sp.sync(rt.world); return sp.scene.links.find((l) => l.id === 'st')!; };

test('progressive floor: after 1 of 2 sheets only the installed sheet is walkable', () => {
  const rt = setup();
  buildBay(rt);
  stageParts(rt);
  joists(rt);
  panel(rt, 0);
  muster(rt);
  stair(rt);
  treads(rt, all10);
  assert.equal(stairLinkNow(rt).usable, true, stairLinkNow(rt).reason);
  const up = must(rt, 'walk_to', { actor: 'w', x: 0, z: 0.9, level: DECK_LEVEL });
  const W = rt.world.entities.w;
  assert.equal(W.human!.level, DECK_LEVEL);
  assert.ok(Math.abs(W.pose.p[1] - 1.9875) < 0.01, `standing on the deck (y ${W.pose.p[1]})`);
  const S1 = rt.world.entities.s1;
  assert.ok(Math.abs(W.pose.p[1] - (S1.pose.p[1] + def(S1.def).size[1])) < 1e-9, 'feet on the sheet top');
  assert.ok(up.history.some((h) => h.phase === 'climb'), 'climbed the stairs');
  // over the missing sheet: no floor
  const miss = rt.submit('walk_to', { actor: 'w', x: 0, z: 2.0, level: DECK_LEVEL });
  assert.equal(miss.status, 'failed');
  assert.equal(miss.diagnostic?.code, 'route.goal-blocked');
  assert.match(miss.diagnostic!.message, /no floor/);
  // the second sheet makes it reachable
  panel(rt, 1);
  must(rt, 'walk_to', { actor: 'w', x: 0, z: 2.0, level: DECK_LEVEL });
  assert.deepEqual(rt.violations.map((v) => v.message), []);
});

test('progressive stairs: incomplete flight is not traversable and names what is missing', () => {
  const rt = setup();
  buildBay(rt);
  stageParts(rt);
  joists(rt);
  muster(rt);
  stair(rt);
  let link = stairLinkNow(rt);
  assert.equal(link.usable, false);
  assert.equal(link.reason, 'treads 1–10 missing; no landing at top');
  treads(rt, [1, 2, 4, 5, 6, 8, 9, 10]);
  assert.equal(stairLinkNow(rt).reason, 'treads 3, 7 missing; no landing at top');
  panel(rt, 0);
  link = stairLinkNow(rt);
  assert.equal(link.reason, 'treads 3, 7 missing');
  const r = rt.submit('walk_to', { actor: 'w', x: 0, z: 0.9, level: DECK_LEVEL });
  assert.equal(r.diagnostic?.code, 'route.link-unusable');
  assert.match(r.diagnostic!.message, /stairs st \(treads 3, 7 missing\)/);
  treads(rt, [3, 7]);
  assert.equal(stairLinkNow(rt).usable, true);
  must(rt, 'walk_to', { actor: 'w', x: 0, z: 0.9, level: DECK_LEVEL });
  // and back down
  must(rt, 'walk_to', { actor: 'w', x: 6, z: 4, level: 0 });
  assert.equal(rt.world.entities.w.human!.level, 0);
  assert.deepEqual(rt.violations.map((v) => v.message), []);
});

test('construction changes navigation: a stair flight set down across a walker\'s corridor forces a replan', () => {
  const rt = setup();
  buildBay(rt);
  stageParts(rt);
  joists(rt, JOISTS.slice(0, 3));
  muster(rt);
  const ins = rt.submit('install_stair_flight', { crew: ['p1', 'p2'], stair: 'st', ...STAIR });
  assert.notEqual(ins.status, 'failed', ins.diagnostic?.message);
  while (rt.isActive(ins.id) && ins.phase !== 'place') rt.step();
  rt.world.entities.w.pose.p = [3.0, 0, 9];
  forgetMotion(rt); // scenario set-up teleport, not an engine motion
  const walk = rt.submit('walk_to', { actor: 'w', x: 3.0, z: -5 });
  assert.notEqual(walk.status, 'failed', walk.diagnostic?.message);
  rt.runUntilIdle(20 * 120, [ins.id, walk.id]);
  assert.equal(ins.status, 'completed', ins.diagnostic?.message);
  assert.equal(walk.status, 'completed', `${walk.diagnostic?.code} ${walk.diagnostic?.message}`);
  assert.ok((walk.outputs?.replans as number) >= 1, `walker replanned (${JSON.stringify(walk.outputs)})`);
  assert.deepEqual(rt.violations.map((v) => v.message), []);
});

test('plywood without joists is rejected with a diagnostic', () => {
  const rt = setup();
  buildBay(rt);
  stageParts(rt);
  const onBeams = rt.submit('install_plywood', { crew: ['p3', 'p4'], sheet: 's1', x: 0, z: PANELS[0][1], yaw: 0 });
  assert.equal(onBeams.diagnostic?.code, 'plywood.span');
  assert.match(onBeams.diagnostic!.message, /1\.22 m between b\d and b\d.*install 2x4 joists first/);
  joists(rt, JOISTS.slice(1, 2));
  const one = rt.submit('install_plywood', { crew: ['p3', 'p4'], sheet: 's1', x: 0, z: PANELS[0][1], yaw: 0 });
  assert.equal(one.diagnostic?.code, 'plywood.too-few-supports');
  assert.match(one.diagnostic!.message, /rest on j2 \(1 joist\)/);
  const air = rt.submit('install_plywood', { crew: ['p3', 'p4'], sheet: 's1', x: 0, z: -2, yaw: 0 });
  assert.equal(air.diagnostic?.code, 'plywood.unsupported');
  assert.equal(rt.world.entities.s1.phase, 'staged');
});

test('joist without beams is rejected; joist too long / out of reach rules', () => {
  const rt = setup();
  must(rt, 'raise_upright', { crew: ['p1', 'p2'], item: 'A' });
  must(rt, 'raise_upright', { crew: ['p3', 'p4'], item: 'B' });
  stageParts(rt);
  const r = rt.submit('install_joist', { crew: ['p5'], joist: 'j1', bay: { a: 'A', b: 'B' }, height: 1.8, at: 0.5 });
  assert.equal(r.diagnostic?.code, 'joist.no-beams');
  assert.match(r.diagnostic!.message, /both columns of bay A–B at 1\.83 m .*found none/);
  rt.world.entities.b3 = component('b3', 'beam-9ft', [-D12 / 2 + 0.25, 0, L9 / 2], Math.PI / 2, { phase: 'staged' });
  must(rt, 'connect_beam', { crew: ['p5', 'p6'], beam: 'b3', a: 'A', b: 'B', column: 'r', height: 1.8 });
  const half = rt.submit('install_joist', { crew: ['p5'], joist: 'j1', bay: { a: 'A', b: 'B' }, height: 1.8, at: 0.5 });
  assert.equal(half.diagnostic?.code, 'joist.no-beams');
  assert.match(half.diagnostic!.message, /found b3/);
  rt.world.entities.long = component('long', '2x4-8ft', [-2, 0, 1], 0, { phase: 'staged' });
  rt.world.entities.b4 = component('b4', 'beam-9ft', [D12 / 2 - 0.25, 0, L9 / 2], Math.PI / 2, { phase: 'staged' });
  must(rt, 'connect_beam', { crew: ['p5', 'p6'], beam: 'b4', a: 'A', b: 'B', column: 'l', height: 1.8 });
  assert.equal(rt.submit('install_joist', { crew: ['p5'], joist: 'long', bay: { a: 'A', b: 'B' }, height: 1.8, at: 0.5 }).diagnostic?.code, 'joist.overhang');
  assert.deepEqual(rt.violations.map((v) => v.message), []);
});

function fullSequence() {
  const rt = setup();
  buildBay(rt);
  stageParts(rt);
  joists(rt);
  panel(rt, 0);
  panel(rt, 1);
  muster(rt);
  stair(rt);
  treads(rt, all10);
  const up = must(rt, 'walk_to', { actor: 'w', x: 0, z: 2.2, level: DECK_LEVEL });
  return { rt, up };
}

test('full sequence: uprights → beams → release → joists → plywood → stairs → a person walks up; zero violations', () => {
  const { rt, up } = fullSequence();
  const W = rt.world.entities.w;
  assert.equal(W.human!.level, DECK_LEVEL);
  assert.ok(up.history.some((h) => h.phase === 'climb'));
  console.log(`# full sequence: ${rt.tick} ticks = ${(rt.tick / 20).toFixed(1)} s simulated, ${rt.records.size} actions (incl. child walks)`);
  for (const id of ['j1', 's1', 's2', 'st', 't10']) assert.equal(rt.world.entities[id].phase, 'installed', id);
  assert.deepEqual(rt.violations.map((v) => `${v.code}: ${v.message}`), []);
});

test('determinism: identical final state hash across runs', () => {
  const a = fullSequence().rt.stateHash();
  const b = fullSequence().rt.stateHash();
  assert.equal(a, b);
});

/** Test fixture: a second bay B–C with beams at 0.5 m and at a seat far above standing reach (placed as state, not simulated). */
function fixtureUpperBay(rt: Runtime) {
  const E = rt.world.entities;
  E.C = component('C', 'upright-12ft', [0, 0, 2 * L9], 0, { phase: 'installed', support: { kind: 'connected', to: [] } });
  const hi = snapSeat(E.B, 3.5)!, lo = snapSeat(E.B, 0.5)!;
  for (const [id, col, h] of [['b5', 'l', hi], ['b6', 'r', hi], ['b7', 'l', lo], ['b8', 'r', lo]] as const) {
    const c = col === 'l' ? -1 : 1;
    const sa = seatPoint(E.B, c, h), sb = seatPoint(E.C, c, h);
    const key = `col${col}@${h.toFixed(3)}`;
    E[id] = component(id, 'beam-9ft', [(sa[0] + sb[0]) / 2, h - def('beam-9ft').size[1] / 2, (sa[2] + sb[2]) / 2], Math.PI / 2, {
      phase: 'installed', support: { kind: 'connected', to: ['B', 'C'] },
      connections: [{ socket: 'end-l', to: 'B', toSocket: key }, { socket: 'end-r', to: 'C', toSocket: key }],
    });
    (E.B.connections ??= []).push({ socket: key, to: id, toSocket: 'end-l' });
    (E.C.connections ??= []).push({ socket: key, to: id, toSocket: 'end-r' });
  }
  E.C.support = { kind: 'connected', to: ['b5', 'b6', 'b7', 'b8'] };
  E.jx = component('jx', '2x4-6ft', [1.8, 0, 3.0], Math.PI / 2, { phase: 'staged' });
  return hi;
}

test('work from deck: a joist above standing reach needs a supported deck below it', () => {
  // no deck yet: refused, naming the reach problem
  const bare = setup();
  buildBay(bare);
  stageParts(bare);
  const hi = fixtureUpperBay(bare);
  const r = bare.submit('install_joist', { crew: ['p5'], joist: 'jx', bay: { a: 'B', b: 'C' }, height: hi, at: 0.2 });
  assert.equal(r.diagnostic?.code, 'reach.too-high');
  assert.match(r.diagnostic!.message, /level 0 at 0\.00 m\) is 3\.6\d m down \(standing reach 2\.06 m\)/);
  // with the deck and stairs built, the person on the deck sets it
  const { rt } = fullSequence();
  fixtureUpperBay(rt);
  const ok = must(rt, 'install_joist', { crew: ['w'], joist: 'jx', bay: { a: 'B', b: 'C' }, height: hi, at: 0.2 });
  const walk = [...rt.records.values()].find((x) => x.parent === ok.id)!;
  assert.equal((walk.params as { level: number }).level, DECK_LEVEL, 'station is on the deck');
  assert.equal(rt.world.entities.w.human!.level, DECK_LEVEL);
  assert.equal(rt.world.entities.jx.phase, 'installed');
  assert.deepEqual(rt.violations.map((v) => v.message), []);
});

test('a sheet whose support goes missing stops being floor and is flagged', () => {
  const { rt } = fullSequence();
  assert.deepEqual(deckSurfaces(rt.world).map((s) => s.id), ['deck:s1', 'deck:s2']);
  assert.deepEqual(progressiveSupported(rt), []);
  // (not a modelled action: the joist under s1 is knocked out as a state edit)
  Object.assign(rt.world.entities.j2, { phase: 'staged', support: { kind: 'ground' }, connections: [] });
  assert.deepEqual(deckSurfaces(rt.world).map((s) => s.id), ['deck:s2']);
  const v = progressiveSupported(rt);
  assert.ok(v.some((d) => d.code === 'support.deck-unsupported' && d.subjects?.[0] === 's1' && /j2 is not installed/.test(d.message)), JSON.stringify(v));
  const sp = rt.services.spatial as Spatial;
  sp.sync(rt.world);
  const g = sp.level(DECK_LEVEL)!;
  const cell = Math.floor((0 - g.x0) / g.cell) + Math.floor((0.8 - g.z0) / g.cell) * g.nx;
  assert.equal(g.free[cell], 0, 'no floor where s1 was');
});

// ---- swept lifts (install_* / connect_beam never pass a part through anything) ----

/** A crate on joist j1's straight path from its staging spot (−1.6, 1.37) to its seat (0, 0.2) at 1.88 m. */
const CRATE: Obstacle = { id: 'crate', obb: { c: [-0.8, 0.785], half: [0.1, 0.1], yaw: 0 }, y0: 0.5, y1: 1.2, kind: 'solid', label: 'tool crate' };
/** A canopy over the staging side, below the lift-over height (seat top + 0.3 m ≈ 2.27 m). */
const CANOPY: Obstacle = { id: 'canopy', obb: { c: [-1.3, 1.35], half: [0.6, 0.85], yaw: 0 }, y0: 2.1, y1: 2.2, kind: 'solid', label: 'shade canopy' };

test('swept lift: a joist whose straight path is obstructed is lifted over (up, across, down)', () => {
  const rt = setup([CRATE]);
  buildBay(rt);
  stageParts(rt);
  let maxY = 0, xAtLift = NaN;
  rt.observers.push({ onTick: (r) => {
    const j = r.world.entities.j1;
    if (j.phase !== 'carried') return;
    if (Number.isNaN(xAtLift) && j.pose.p[1] > 1.0) xAtLift = j.pose.p[0];
    maxY = Math.max(maxY, j.pose.p[1]);
  } });
  must(rt, 'install_joist', { crew: ['p5'], joist: 'j1', bay: { a: 'A', b: 'B' }, height: 1.8, at: 0.2 });
  const j1 = rt.world.entities.j1;
  const seat = j1.pose.p[1];
  assert.equal(j1.phase, 'installed');
  assert.ok(maxY >= seat + def('2x4-6ft').size[1] + 0.3 - 1e-6, `lifted over at ${maxY.toFixed(2)} m (seat ${seat.toFixed(2)} m)`);
  assert.ok(Math.abs(xAtLift - -1.6) < 1e-6, `rose straight up from where it lay (x ${xAtLift} at 1 m)`);
  assert.deepEqual(rt.violations.map((v) => `${v.code}: ${v.message}`), []);
});

test('swept lift: blocked straight and lifted over is refused with lift.path-blocked naming both obstacles', () => {
  const rt = setup([CRATE, CANOPY]);
  buildBay(rt);
  stageParts(rt);
  const r = rt.submit('install_joist', { crew: ['p5'], joist: 'j1', bay: { a: 'A', b: 'B' }, height: 1.8, at: 0.2 });
  assert.equal(r.status, 'failed');
  assert.equal(r.diagnostic?.code, 'lift.path-blocked');
  assert.match(r.diagnostic!.message, /joist j1 cannot be lifted into place: its straight path would pass through tool crate \(crate\).*lifting it over at 2\.2\d m is blocked too, by shade canopy \(canopy\)/);
  assert.deepEqual(r.diagnostic!.subjects, ['j1', 'crate']);
  assert.equal(rt.world.entities.j1.phase, 'staged');
  // the unobstructed neighbour still goes in (its path clears both)
  must(rt, 'install_joist', { crew: ['p5'], joist: 'j5', bay: { a: 'A', b: 'B' }, height: 1.8, at: 2.55 });
  assert.deepEqual(rt.violations.map((v) => `${v.code}: ${v.message}`), []);
});

// ---- crew accompanies lifted parts (liftcrew.ts; spec §7/§8) ----

/** Sample every tick while `item` is held by a lift: holder ↔ hand point distance and height, holder speed. */
function watchHands(rt: Runtime, item: string) {
  const s = { ticks: 0, maxD: 0, maxUp: -Infinity, maxSpeed: 0, walked: 0, maxY: 0, slots: new Set<string>() };
  const last = new Map<string, [number, number]>();
  rt.observers.push({ onTick: (r) => {
    const e = r.world.entities[item];
    if (e.phase !== 'carried' || e.support?.kind !== 'held') return;
    s.ticks++;
    s.maxY = Math.max(s.maxY, e.pose.p[1]);
    for (const id of e.support.by) {
      const h = r.world.entities[id];
      const slot = h.human!.grip!.slot;
      const hand = handPoint(e, e.pose, slot);
      assert.ok(hand, `${id} holds ${item} by a follow slot (got ${slot})`);
      s.slots.add(`${id}:${slot}`);
      s.maxD = Math.max(s.maxD, Math.hypot(h.pose.p[0] - hand.p[0], h.pose.p[2] - hand.p[2]));
      s.maxUp = Math.max(s.maxUp, hand.p[1] - h.pose.p[1]);
      const p: [number, number] = [h.pose.p[0], h.pose.p[2]];
      const q = last.get(id);
      if (q) {
        const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
        s.maxSpeed = Math.max(s.maxSpeed, d * 20);
        s.walked += d;
      }
      last.set(id, p);
    }
  } });
  return s;
}

function assertHands(s: ReturnType<typeof watchHands>, what: string, t0: number, rt: Runtime) {
  const info = JSON.stringify({ ...s, slots: [...s.slots] });
  console.log(`# ${what}: held ${(s.ticks / 20).toFixed(2)} s, action ${((rt.tick - t0) / 20).toFixed(1)} s simulated; hands ≤ ${s.maxD.toFixed(2)} m away, ≤ ${s.maxUp.toFixed(2)} m up; crew walked ${s.walked.toFixed(2)} m at ≤ ${s.maxSpeed.toFixed(2)} m/s`);
  assert.ok(s.ticks > 20, info);
  assert.ok(s.maxD <= HAND_REACH + 1e-9, `hand point out of reach: ${info}`);
  assert.ok(s.maxUp <= LIFT_APEX_MAX + 1e-9, `hand point too high: ${info}`);
  assert.ok(s.maxSpeed <= FOLLOW_SPEED + 1e-6, `crew too fast: ${info}`);
  assert.ok(s.walked > 1.0, `the crew walks with the part: ${info}`);
}

test('lift crew: a joist lift keeps the holder beside its hand point (≤ 1.0 m, ≤ 2.4 m up) every tick', () => {
  const rt = setup();
  buildBay(rt);
  stageParts(rt);
  const s = watchHands(rt, 'j1');
  const t0 = rt.tick;
  must(rt, 'install_joist', { crew: ['p5'], joist: 'j1', bay: { a: 'A', b: 'B' }, height: 1.8, at: 0.2 });
  assertHands(s, 'joist lift j1', t0, rt);
  assert.deepEqual(rt.violations.map((v) => `${v.code}: ${v.message}`), []);
});

test('lift crew: a plywood lift-over keeps both holders beside their hand points every tick', () => {
  const rt = setup();
  buildBay(rt);
  stageParts(rt);
  joists(rt);
  const s = watchHands(rt, 's1');
  const t0 = rt.tick;
  panel(rt, 0);
  const seat = rt.world.entities.s1.pose.p[1];
  assert.ok(s.maxY >= seat + def('plywood-4x6').size[1] + 0.3 - 1e-6, `lifted over (max ${s.maxY.toFixed(2)} m, seat ${seat.toFixed(2)} m)`);
  assertHands(s, 'plywood lift-over s1', t0, rt);
  assert.equal(s.slots.size, 2);
  assert.deepEqual(rt.violations.map((v) => `${v.code}: ${v.message}`), []);
});

/** Crates set down on the holder's way the moment j1 leaves the ground (a gap at the joist too narrow to pass). */
const CRATES: Obstacle[] = [
  { id: 'crate', obb: { c: [-1.245, 1.85], half: [0.295, 0.25], yaw: 0 }, y0: 0, y1: 1.5, kind: 'solid', label: 'tool crate' },
  { id: 'crate-w', obb: { c: [-2.03, 1.85], half: [0.37, 0.25], yaw: 0 }, y0: 0, y1: 1.5, kind: 'solid', label: 'tool crate' },
];

test('lift crew: crates dropped on the holder\'s way block the lift (lift.crew-blocked, no clipping, part held)', () => {
  const late: Contributor = (w) => ({ obstacles: w.entities.j1?.phase === 'carried' ? CRATES : [] });
  const rt = setup([CRATE], [late]);
  buildBay(rt);
  stageParts(rt);
  const r = rt.submit('install_joist', { crew: ['p5'], joist: 'j1', bay: { a: 'A', b: 'B' }, height: 1.8, at: 0.2 });
  rt.runUntilIdle(20 * 40, [r.id]);
  assert.equal(r.status, 'blocked', `${r.status} ${r.diagnostic?.message}`);
  assert.equal(r.diagnostic?.code, 'lift.crew-blocked');
  assert.match(r.diagnostic!.message, /^p5 cannot keep hold of j1 .*blocked by crate/);
  assert.equal(rt.world.entities.j1.support?.kind, 'held');
  assert.deepEqual(rt.violations.map((v) => `${v.code}: ${v.message}`), []);
});

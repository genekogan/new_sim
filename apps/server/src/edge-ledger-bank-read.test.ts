import test from 'node:test';
import assert from 'node:assert/strict';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {Spatial} from '../../../mars/viewer/engine/spatial/service.ts';
import {emptyWorld, addAll, human, component} from '../../../mars/viewer/engine/world/factory.ts';
import type {SpatialScene} from '../../../mars/viewer/engine/spatial/types.ts';

type Point = [number, number];
type Engine = {clearanceAtV1?: (x: number, z: number) => number; clearanceUpToV1?: (x: number, z: number, cap?: number) => number; readPassV1?: <T>(f: () => T) => T};
const ledger = (engine: Engine) => Object.assign(Object.create(EdgeLedger.prototype), {host: {engine}}) as {bankLoop(poly: Point[], from: Point): Point[]};

// Frozen pre-optimization body from64bea1230, with only the host's engine supplied as an argument.
function legacy(engine: Engine, poly: Point[], from: Point): Point[] {
  if (!engine.clearanceAtV1 || poly.length < 3) return [];
  const clear = (x: number, z: number) => engine.clearanceUpToV1 ? engine.clearanceUpToV1(x, z, 1) : engine.clearanceAtV1!(x, z);
  const xs = poly.map(p => p[0]), zs = poly.map(p => p[1]);
  for (const margin of [2, 3.5, 5]) {
    const x0 = Math.min(...xs) - margin, x1 = Math.max(...xs) + margin, z0 = Math.min(...zs) - margin, z1 = Math.max(...zs) + margin;
    const route: Point[] = [[x0,z0],[(x0+x1)/2,z0],[x1,z0],[x1,(z0+z1)/2],[x1,z1],[(x0+x1)/2,z1],[x0,z1],[x0,(z0+z1)/2]];
    if (route.some(p => clear(p[0], p[1]) < 0.7)) continue;
    let near = 0; for (let i = 1; i < route.length; i++) if (Math.hypot(route[i][0]-from[0],route[i][1]-from[1]) < Math.hypot(route[near][0]-from[0],route[near][1]-from[1])) near=i;
    return [...route.slice(near), ...route.slice(0,near)];
  }
  return [];
}

test('bank read: exact routes and ordered clearance probes match the old arithmetic, with and without readPass', () => {
  const polys: Point[][] = [[], [[0, 0]], [[-4, -7], [6, -7], [6, 8], [-4, 8]], [[-0, 0], [0, -0], [Number.MIN_VALUE, 0]],
    [[1e12, -1e12], [1e12 + 13.5, -1e12], [1e12 + 13.5, -1e12 + 7]], [[NaN, 0], [1, 2], [Infinity, -Infinity]]];
  const froms: Point[] = [[0, 0], [-100, 2], [4, 200], [1e12, -1e12], [-0, -0]];
  const fields = [(x: number, z: number) => 1, () => 0, () => 0.7, () => 0.7 - Number.EPSILON,
    (x: number, z: number) => Math.abs(x) < 7 && Math.abs(z) < 10 ? 0 : 1, () => NaN];
  let cases = 0;
  for (const poly of polys) for (const from of froms) for (const field of fields) for (const capped of [false, true]) for (const pass of [false, true]) {
    const trace: number[][] = [], oracleTrace: number[][] = []; let calls = 0, held = false;
    const make = (rows: number[][]): Engine => ({clearanceAtV1(x, z) {rows.push([x, z]); return field(x, z);},
      ...(capped ? {clearanceUpToV1(x: number, z: number, cap = 1) {rows.push([x, z, cap]); return field(x, z);}} : {})});
    const engine = make(trace);
    if (pass) engine.readPassV1 = function (fn) {assert.equal(this, engine); assert.equal(held, false); calls++; held = true; try {return fn();} finally {held = false;}};
    assert.deepEqual(ledger(engine).bankLoop(poly, from), legacy(make(oracleTrace), poly, from));
    assert.deepEqual(trace, oracleTrace); assert.equal(held, false); assert.equal(calls, pass && poly.length >= 3 ? 1 : 0); cases++;
  }
  assert.equal(cases, 720);
  let touched = false;
  assert.deepEqual(ledger({readPassV1: fn => {touched = true; return fn();}}).bankLoop(polys[2], [0, 0]), []);
  assert.equal(touched, false, 'missing clearance keeps the original early refusal');
});

test('bank read: real Spatial pass releases after queries and throws; next invocation sees changed world', () => {
  const scene: SpatialScene = {bounds: [-30, -30, 30, 30], levels: [{id: 0, y: 0, label: 'ground'}],
    surfaces: [{id: 'ground', level: 0, y: 0, obb: {c: [0, 0], half: [30, 30], yaw: 0}}], obstacles: [], links: []};
  const world = addAll(emptyWorld('bank-read', scene), human('me', 0, 0), component('wall', 'test-wall', [5, 0, 0], 0, {phase: 'stored'}));
  const sp = new Spatial(scene); let fail = false;
  const engine: Engine = {readPassV1: fn => sp.readPass(world, fn), clearanceAtV1(x, z) {
    sp.sync(world); if (fail) throw new Error('probe failed'); return sp.clearanceReader(0, [x, z])?.([x, z]) ?? 0;
  }, clearanceUpToV1(x, z, cap = 1) {
    sp.sync(world); if (fail) throw new Error('probe failed'); return sp.clearanceCapped(0, [x, z], cap)?.([x, z]) ?? 0;
  }};
  const poly: Point[] = [[-4, -4], [4, -4], [4, 4], [-4, 4]], L = ledger(engine);
  const check = () => {const before = structuredClone(world); assert.deepEqual(L.bankLoop(poly, [0, 0]), legacy(engine, poly, [0, 0])); assert.deepEqual(world, before);};
  check(); const epoch = sp.epoch;
  world.entities.wall.pose.p = [6, 0, 0]; check(); assert.ok(sp.epoch > epoch);
  world.entities = {...world.entities, extra: human('extra', 9, 9)}; check();
  fail = true; assert.throws(() => L.bankLoop(poly, [0, 0]), /probe failed/); fail = false;
  world.entities.wall.pose.p = [7, 0, 0]; assert.equal(sp.sync(world), true, 'no planner hold survives a throw'); check();
  sp.readPass(world, () => check());
  world.entities.wall.pose.p = [8, 0, 0]; assert.equal(sp.sync(world), true, 'nested pass restores outer lifetime');
});

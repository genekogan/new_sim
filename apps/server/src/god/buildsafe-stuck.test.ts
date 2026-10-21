// BUILDSAFE (lane BS3, 2026-10-21): Souls never stuck. (b) The coarse ground search runs through enterable buildings (only
// big solids are coarse-solid), so a walk's intermediate hop could end inside a closed room no fine route reaches and the
// whole walk failed route.unreachable (eden-2026: jetty -> cliff-village chapel stopped at old-town-north-arcade-1). The
// planner now retries waypoints along the same coarse path (spatial/tiled.ts hopRetries), paged and unpaged ground.
import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {fixture, factory} from '../../test/native-owner-fixture.ts';
import {EdgeLedger} from '../edge/ledger/ledger.ts';
import {GodMode} from './god.ts';
import {installEngineBridge} from './engine-bridge.ts';
import {GroundHost} from './ground-host.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Vec2 = [number, number];
function world(t: TestContext, paged: boolean) {
  const was = process.env.NAV_PAGED;
  process.env.NAV_PAGED = paged ? '1' : '0';
  const w = fixture(':memory:', factory, {durableClockV1: true});
  w.brain.quiesce();
  const god = new GodMode(w.db, {worldId: w.host.worldId, ownerId: 'owner', tick: () => w.host.engine.world.tick, emit() {}});
  new GroundHost(w.db, w.host, god);
  const edge = new EdgeLedger(w.host, w.db), bridge = installEngineBridge({host: w.host, god, edge, log() {}, worldClock: false, worldLore: false});
  t.after(() => {w.brain.quiesce(); w.host.stop(); edge.comms?.close(); w.db.close(); if (was === undefined) delete process.env.NAV_PAGED; else process.env.NAV_PAGED = was;});
  const settle = async (n = 4) => {for (let i = 0; i < n; i++) {w.host.tickOnce(); await setImmediate(); w.host.drainInputs();}};
  const act = (ops: any[]) => {const r = god.act({ops}) as any; assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 600)); return r;};
  return {...w, god, bridge, edge, settle, act, E: w.host.engine as any};
}
const box = (name: string, x: number, z: number) => ({schema: 'def/1', name, version: 1, layer: 'solid', size: {box: [x, 3, z]}, make: {kind: 'gen', gen: 'kit/2', args: {shapes: [{kind: 'box', at: [0, 1.5, 0], size: [x, 3, z]}]}}});
/** A closed room (four 1 m walls, inner side `s`, no door) round c: thin solids the coarse search walks straight through. */
function ring(c: Vec2, s: number, tag: string) {
  const h = s / 2 + 0.5;
  return [{op: 'define', def: box(`${tag}long`, s + 2, 1)}, {op: 'define', def: box(`${tag}short`, s - 0.1, 1)},
    {op: 'place', def: `${tag}short@1`, name: `${tag}n`, p: [c[0], c[1] + h]}, {op: 'place', def: `${tag}short@1`, name: `${tag}s`, p: [c[0], c[1] - h]},
    {op: 'place', def: `${tag}long@1`, name: `${tag}e`, p: [c[0] + h, c[1]], r: Math.PI / 2}, {op: 'place', def: `${tag}long@1`, name: `${tag}w`, p: [c[0] - h, c[1]], r: Math.PI / 2}];
}
export {world, ring, box};

for (const paged of [true, false]) {
  test(`a closed room on the coarse path's hop waypoint is walked round, not a dead end (${paged ? 'paged' : 'unpaged'} ground)`, {timeout: 300_000}, async t => {
    const w = world(t, paged); await w.settle(2);
    assert.equal(w.E.world.groundV1?.nav === 'paged/1', paged, 'the ground navigates as asked');
    const A: Vec2 = [0.5, 20.5], B: Vec2 = [110.5, 20.5];
    assert.equal(w.E.reachV1({p: A}, {p: B}).ok, true, 'open lawn before');
    // the first hop ends 48 coarse cells along the straight line: (48.5, 20.5), the middle of this room
    w.act(ring([48.5, 20.5], 7, 'r')); await w.settle(3);
    assert.equal(w.E.reachV1({p: A}, {p: [48.5, 20.5]}).ok, false, 'the room is closed');
    const r = w.E.reachV1({p: A}, {p: B});
    assert.equal(r.ok, true, `${A} -> ${B} round the room: ${JSON.stringify(r).slice(0, 300)}`);
    // and back the other way (the hop from the east end lands in the room too when the distance matches)
    assert.equal(w.E.reachV1({p: [97, 20.5]}, {p: [0.5, 20.5]}).ok, true, 'west round the room');
  });
}

// ---- the ledger side: a Soul on the same harness, plans injected through the world-profile hook ----
import {invite, accept} from '../../test/native-owner-fixture.ts';
type Plans = Map<string, {label: string; steps: any[]}>;
async function soulIn(t: TestContext, paged = false) {
  const w = world(t, paged); await w.settle(2);
  await invite(w as any, 'ada'); const row: any = await accept(w.host, w.souls.create('dev:ada', {name: 'Ada', description: 'curious'})); await w.settle(3);
  const soul = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner};
  const extra = new Map<string, {label: string; steps: any[]}>();
  w.edge.worldProfile = (_s, caps, plans) => {for (const [id, p] of extra) {caps.push({id, verb: id.split(':')[0]!, label: p.label, available: true, target: {id: id.split(':')[1]!, kind: 'place'}} as any); (plans as Plans).set(id, p);}};
  const body = () => w.E.world.entities[soul.entityId], pos = (): Vec2 => {const p = body().pose.p; return [p[0], p[2]];};
  const go = (capability: string) => accept(w.host, w.edge.act(soul, {capability})) as Promise<any>;
  const until = async (id: string, max = 6000) => {
    for (let i = 0; i < max; i++) {w.host.tickOnce(); if (i % 10 === 0) {await setImmediate(); w.host.drainInputs(); const r = w.edge.receipt(soul.soulId, id); if (r && !['waiting', 'started', 'running'].includes(r.phase)) return r;}}
    return w.edge.receipt(soul.soulId, id);
  };
  return {...w, soul, extra, body, pos, go, until};
}

test('closest approach: a walk to a closed room goes as near as a walk does and says by how much', {timeout: 300_000}, async t => {
  const w = await soulIn(t);
  const at = w.pos(), c: Vec2 = [Math.round(at[0]) + 20.5, Math.round(at[1]) + 0.5];
  w.act(ring(c, 7, 'q')); await w.settle(3);
  assert.equal(w.E.reachV1({p: at}, {p: c}).ok, false, 'the room is closed');
  w.extra.set('walk:closed-room', {label: 'Walk to the closed room', steps: [{verb: 'walk_to', params: {to: c}}]});
  const out = await w.go('walk:closed-room');
  assert.equal(out.accepted, true, JSON.stringify(out));
  const r: any = await w.until(out.receipt.id);
  t.diagnostic(JSON.stringify(r));
  assert.equal(r.phase, 'completed', JSON.stringify(r));
  assert.match(r.reason ?? '', /^Got within [\d.]+ m of the closed room: no walkable route reaches it from here \(route\.(unreachable|goal-blocked)\)/);
  assert.ok(r.approach && r.approach.short > 3 && r.approach.short < 9, JSON.stringify(r.approach));
  assert.deepEqual(r.approach.goal, c);
  const end = w.pos(), d = Math.hypot(end[0] - c[0], end[1] - c[1]);
  assert.ok(Math.abs(d - r.approach.short) < 1.0, `stands ${d.toFixed(2)} m from the room's middle (said ${r.approach.short})`);
});

/** The engine's walk exec for this walker (test only): its pace forced to 0 stands it 'running' with no headway. */
const execOf = (w: any) => [...((w.E.rt.services.walkExecs ?? new Map()) as Map<string, any>).values()].find(x => x.actor === w.soul.entityId);
async function frozenWalk(t: TestContext, stubInside: boolean) {
  const w = await soulIn(t);
  const at = w.pos(), to: Vec2 = [Math.round(at[0]) + 25.5, Math.round(at[1]) + 0.5];
  w.extra.set('walk:far-lawn', {label: 'Walk to the far lawn', steps: [{verb: 'walk_to', params: {to}}]});
  if (stubInside) {const real = w.E.clearanceAtV1.bind(w.E); let once = true; w.E.clearanceAtV1 = (x: number, z: number, l?: number) => (once ? (once = false, 0.1) : real(x, z, l));}
  const out = await w.go('walk:far-lawn'); assert.equal(out.accepted, true, JSON.stringify(out));
  let frozen = true, ticks = 0, relocations = 0, first: any;
  const origEnqueue = w.host.enqueue.bind(w.host);
  w.host.enqueue = (kind: string, ...rest: any[]) => {if (kind === 'edge-relocate') {relocations++; frozen = false;} return origEnqueue(kind, ...rest);};
  for (let i = 0; i < 4000; i++) {
    const ex = execOf(w); if (ex && frozen) {ex.speed = 0; first ??= ex.id;}
    w.host.tickOnce(); ticks++;
    if (i % 10 === 0) {await setImmediate(); w.host.drainInputs(); const r = w.edge.receipt(w.soul.soulId, out.receipt.id); if (r && !['waiting', 'started', 'running'].includes(r.phase)) return {w, r, ticks, relocations, to};}
  }
  return {w, r: w.edge.receipt(w.soul.soulId, out.receipt.id), ticks, relocations, to};
}

test('walk.stuck: a walk with no headway ends its receipt honestly after 30 s (no step-out when the body has room)', {timeout: 300_000}, async t => {
  const {r, ticks, relocations} = await frozenWalk(t, false);
  assert.equal(r?.phase, 'failed', JSON.stringify(r));
  assert.equal(r?.code, 'walk.stuck', JSON.stringify(r));
  assert.match(r?.reason ?? '', /made no headway for 30 seconds/);
  assert.equal(relocations, 0);
  assert.ok(ticks >= 590 && ticks <= 700, `ended at tick ${ticks}`);
});

test('walk.stuck: a body caught in geometry steps out and the same plan walks on under the same receipt', {timeout: 300_000}, async t => {
  const {w, r, relocations, to} = await frozenWalk(t, true);
  assert.equal(relocations, 1, 'one step-out');
  assert.equal(r?.phase, 'completed', JSON.stringify(r));
  assert.equal(kinds.length, 1, JSON.stringify(kinds)); assert.equal(kinds[0].godWalkout, true, 'rose with the god walk-out');
  assert.match(kinds[0].why, /stood up and stepped clear to start/);
  const end = w.pos(); assert.ok(Math.hypot(end[0] - to[0], end[1] - to[1]) < 1, `arrived: ${end}`);
});

test('gait fallback: a run the water refuses (gait.dry-ground-required) walks instead, and the receipt says why', {timeout: 300_000}, async t => {
  const w = await soulIn(t);
  const at = w.pos(), to: Vec2 = [Math.round(at[0]) + 20.5, Math.round(at[1]) + 0.5];
  w.extra.set('run:shore', {label: 'Run to the shore', steps: [{verb: 'walk_to', params: {to, gait: 'run'}}]});
  // the engine's refusal for a run whose way goes through the shallows (engine.ts walk_to gait check; the engine side of
  // wading at walking pace is buildsafe-walk.test.ts); a plain walk on the same way is admitted
  const real = w.host.engine.canPerform.bind(w.host.engine), seen: string[] = [];
  (w.host.engine as any).canPerform = (p: any) => {const g = p.steps.find((s: any) => s.verb === 'walk_to')?.params?.gait; seen.push(g ?? 'walk'); return g && g !== 'walk' ? {code: 'gait.dry-ground-required', message: 'This shore or water route does not support jogging or running; return to dry ground first.'} : real(p);};
  const out = await w.go('run:shore');
  assert.equal(out.accepted, true, JSON.stringify(out));
  assert.ok(seen.includes('run') && seen.includes('walk'), seen.join());
  const r: any = await w.until(out.receipt.id);
  assert.equal(r.phase, 'completed', JSON.stringify(r));
  assert.match(r.reason ?? '', /^Walking, not running: the way goes through shallow water/);
  assert.equal(kinds.length, 1, JSON.stringify(kinds)); assert.equal(kinds[0].godWalkout, true, 'rose with the god walk-out');
  assert.match(kinds[0].why, /stood up and stepped clear to start/);
  const end = w.pos(); assert.ok(Math.hypot(end[0] - to[0], end[1] - to[1]) < 1, `arrived: ${end}`);
});

test('seated start-blocked: a Soul on a bench whose walk cannot start where it sits rises with the walk-out and walks', {timeout: 300_000}, async t => {
  const w = await soulIn(t);
  const at = w.pos(), bench: Vec2 = [Math.round(at[0]) + 4.5, Math.round(at[1]) + 0.5], to: Vec2 = [bench[0] + 20, bench[1]];
  w.act([{op: 'place', def: 'core/bench@1', name: 'bench', p: bench}]); await w.settle(3);
  const seatId = Object.values(w.E.world.entities as Record<string, any>).find((e: any) => e.label === 'bench' && Math.hypot(e.pose.p[0] - bench[0], e.pose.p[2] - bench[1]) < 2)?.id;
  assert.ok(seatId, 'the bench is in the world');
  w.extra.set('sit:the-bench', {label: 'Sit on the bench', steps: [{verb: 'sit', params: {on: seatId, seconds: 600}}]});
  const s1 = await w.go('sit:the-bench'); assert.equal(s1.accepted, true, JSON.stringify(s1));
  for (let i = 0; i < 1500 && w.body().human.activity !== 'sit'; i++) {w.host.tickOnce(); if (i % 10 === 0) {await setImmediate(); w.host.drainInputs();}}
  assert.equal(w.body().human.activity, 'sit', 'sits on the bench');
  // a seat-slot hold (seatOf) is what makes a plain relocate refuse a seated body; this bench is a fixture seat, so the
  // slot is stubbed: the ledger sees the Soul held by its seat while it sits
  const seatOf = () => w.body().human.activity === 'sit' ? 'slot-0' : null; (w.edge as any).seatOf = seatOf;
  const kinds: any[] = []; const origEnqueue = w.host.enqueue.bind(w.host);
  w.host.enqueue = (kind: string, ...rest: any[]) => {if (kind === 'edge-relocate') kinds.push(rest[1]); return origEnqueue(kind, ...rest);};
  w.extra.set('walk:lawn', {label: 'Walk to the lawn', steps: [{verb: 'walk_to', params: {to}}]});
  // the live shape (finding c): where the body sits no walk can start; once standing clear it can
  const real = w.host.engine.canPerform.bind(w.host.engine);
  (w.host.engine as any).canPerform = (p: any) => seatOf() ? {code: 'route.start-blocked', message: 'no walk starts where it sits'} : real(p);
  const out = await w.go('walk:lawn');
  assert.equal(out.accepted, true, JSON.stringify(out));
  const r: any = await w.until(out.receipt.id);
  assert.equal(r.phase, 'completed', JSON.stringify(r));
  assert.equal(kinds.length, 1, JSON.stringify(kinds)); assert.equal(kinds[0].godWalkout, true, 'rose with the god walk-out');
  assert.match(kinds[0].why, /stood up and stepped clear to start/);
  const end = w.pos(); assert.ok(Math.hypot(end[0] - to[0], end[1] - to[1]) < 1, `arrived: ${end}`);
});

// Eden camp (scenarios/eden-camp.ts): genesis, honest walls and doors, routes between affordances,
// playability of every activity example (plan validation, with its own precondition fixtures), real
// execution of the kitchen, garden, sleep and the whole construction blueprint, and the manifest file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  edenCampWorld, edenCampScene, edenCampActivities, edenCampManifest, edenCampPlanSvg, campActivityPlayable, bindCampActivity, bindCampChess, doorPoints,
  EDEN_CAMP_SCENE, EDEN_CAMP_CAMPUS, CAMP_ARRIVALS, CAMP_DOORS, CAMP_SPOTS, CAMP_BUILDINGS, LOOKOUT_BEAMS, LOOKOUT_JOISTS, LOOKOUT_SHEETS,
  type CampActivity,
} from '../scenarios/eden-camp.ts';
import { Runtime } from '../runtime/runtime.ts';
import { createRegistry, servicesFor, ENGINE_INVARIANTS } from '../api/registry.ts';
import { Spatial } from '../spatial/service.ts';
import { HUMAN_PROFILE, type SpatialScene } from '../spatial/types.ts';
import { CATALOG } from '../world/catalog.ts';
import { human } from '../world/factory.ts';
import { physicalView, type WorldState } from '../world/types.ts';
import { hashOf } from '../core/hash.ts';
import { surfaceSlot } from '../items/model.ts';
import { readGarden } from '../objects/garden.ts';
import { readChess } from '../objects/chess.ts';
import type { Vec2 } from '../core/math.ts';

// Pinned genesis: any change to the camp's ids, geometry or contents must update this on purpose.
const GENESIS_HASH = 'f60cf9fd4bef443710eeea8946cfdc6c3146d009d40eac8a30022f3b1a31cc24';
const SOULS = ['s1', 's2', 's3', 's4'];
const MANIFEST = fileURLToPath(new URL('../../../../worlds/mars/camp/manifest.json', import.meta.url));
const PLAN = fileURLToPath(new URL('../../../../worlds/mars/camp/plan.svg', import.meta.url));

function seeded(seed?: string) {
  const w = edenCampWorld(seed);
  CAMP_ARRIVALS.forEach((a, i) => { w.entities[SOULS[i]] = human(SOULS[i], a.p[0], a.p[1], { yaw: a.yaw }); });
  return w;
}
function runtime(w: WorldState = seeded()) {
  return new Runtime(w, createRegistry(), servicesFor({ [EDEN_CAMP_CAMPUS]: EDEN_CAMP_SCENE })(w), ENGINE_INVARIANTS);
}
const byId = new Map(edenCampActivities().map((a) => [a.id, a]));
const free = (rt: Runtime) => SOULS.filter((s) => rt.holder(`actor:${s}`).length === 0 && !rt.world.entities[s].human!.grip && rt.world.entities[s].human!.level === 0);
/** Bind roles to the first free Souls, in order (the kitchen chain keeps one person: pass `fixed`). */
function roles(rt: Runtime, a: CampActivity, fixed: Record<string, string> = {}) {
  const pool = free(rt).filter((s) => !Object.values(fixed).includes(s));
  return Object.fromEntries(a.roles.map((r) => [r, fixed[r] ?? pool.shift()!]));
}
function run(rt: Runtime, a: CampActivity, who: Record<string, string>, patch: (p: Record<string, unknown>) => void = () => {}) {
  const ok = campActivityPlayable(rt, a, who);
  assert.ok(ok.ok, `${a.id} not playable: ${!ok.ok && ok.diagnostic.code}: ${!ok.ok && ok.diagnostic.message}`);
  const params = bindCampActivity(a, who) as Record<string, unknown>;
  patch(params);
  const r = rt.submit(a.verb, params, { preempt: false });
  for (let n = 0; rt.isActive(r.id) && n < 30000; n++) rt.step();
  assert.equal(r.status, 'completed', `${a.id}: ${r.status} ${r.diagnostic?.code}: ${r.diagnostic?.message}`);
  assert.deepEqual(rt.violations, [], a.id);
  return r;
}
/** Every activity in dependency (`after`) order, keeping list order among the ready ones. */
function ordered(ids: string[]): CampActivity[] {
  const need = new Set<string>();
  const add = (id: string) => { if (need.has(id)) return; for (const x of byId.get(id)!.after ?? []) add(x); need.add(id); };
  ids.forEach(add);
  const all = [...byId.values()].filter((a) => need.has(a.id)), out: CampActivity[] = [], done = new Set<string>();
  while (out.length < all.length) {
    const next = all.find((a) => !done.has(a.id) && (a.after ?? []).every((x) => done.has(x)));
    assert.ok(next, 'activity preconditions form a cycle');
    out.push(next); done.add(next.id);
  }
  return out;
}

test('genesis: no humans, tick 0, deterministic pinned hash; the seed changes only the RNG', () => {
  const a = edenCampWorld(), b = edenCampWorld();
  assert.equal(Object.values(a.entities).filter((e) => e.kind === 'human').length, 0);
  assert.equal(a.tick, 0);
  assert.equal(a.base.campus, EDEN_CAMP_CAMPUS);
  assert.equal(a.base.staticHash, hashOf(EDEN_CAMP_SCENE));
  assert.equal(hashOf(a), hashOf(b));
  assert.equal(hashOf(a), GENESIS_HASH, `genesis hash is now ${hashOf(a)}`);
  const c = edenCampWorld('another seed');
  assert.notEqual(hashOf(c), hashOf(a));
  assert.deepEqual(Object.keys(c.entities), Object.keys(a.entities));
  assert.deepEqual({ ...physicalView(c), rng: null }, { ...physicalView(a), rng: null });
  assert.equal(hashOf(EDEN_CAMP_SCENE), hashOf(edenCampScene()));
});

test('every reference resolves: catalog defs, supports, slots, regions and activity ids', () => {
  const w = edenCampWorld();
  for (const e of Object.values(w.entities)) {
    assert.ok(CATALOG[e.def], `${e.id}: unknown def ${e.def}`);
    if (e.support?.kind === 'resting-on') {
      assert.ok(w.entities[e.support.on], `${e.id} rests on missing ${e.support.on}`);
      assert.ok(!('code' in surfaceSlot(w, `${e.support.on}#${e.support.slot}`)), `${e.id}: bad slot`);
    } else assert.equal(e.support?.kind, 'ground', e.id);
    const [x, , z] = e.pose.p, [x0, z0, x1, z1] = EDEN_CAMP_SCENE.bounds;
    assert.ok(x > x0 && x < x1 && z > z0 && z < z1, `${e.id} outside the scene`);
  }
  const names = new Set([...Object.keys(w.entities), ...Object.keys(w.regions)]);
  const roles = new Set<string>();
  const check = (a: CampActivity, v: unknown, key = '') => {
    if (typeof v === 'string') {
      if (v.startsWith('$')) { assert.ok(a.roles.includes(v.slice(1)), `${a.id}: undeclared role ${v}`); roles.add(v); return; }
      if (['task', 'score', 'mode', 'content', 'column', 'hand', 'from', 'to', 'label'].includes(key)) return;
      const owner = v.includes('#') ? v.slice(0, v.indexOf('#')) : v;
      assert.ok(names.has(owner), `${a.id}.${key}: unknown id ${v}`);
      if (v.includes('#') && w.entities[owner] && CATALOG[w.entities[owner].def].surfaceSlots?.length) assert.ok(!('code' in surfaceSlot(w, v)), `${a.id}: unknown slot ${v}`);
    } else if (Array.isArray(v)) v.forEach((x) => check(a, x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k.startsWith('$')) assert.ok(a.roles.includes(k.slice(1)), `${a.id}: key role ${k}`); check(a, x, k); }
  };
  for (const a of byId.values()) {
    check(a, a.params);
    for (const r of a.roles) assert.ok(JSON.stringify(a.params).includes(`"$${r}"`), `${a.id}: role ${r} unused`);
    for (const x of a.after ?? []) assert.ok(byId.has(x), `${a.id}: unknown after ${x}`);
    assert.ok(w.regions[a.region], `${a.id}: unknown region ${a.region}`);
    assert.ok(createRegistry().has(a.verb), `${a.id}: unknown verb ${a.verb}`);
  }
  assert.equal(byId.size, edenCampActivities().length, 'activity ids are unique');
  // No routine machinery: single activities only, never the scripted intention/routine verbs.
  for (const a of byId.values()) assert.ok(!['living_intention', 'purposeful_routine', 'gathering_continuation', 'room_preparation'].includes(a.verb), a.id);
});

test('walls are solid and doors are the only way in: blocking a door cuts its building off', () => {
  const w = seeded();
  for (const d of CAMP_DOORS) {
    const q = doorPoints(d);
    const open = new Spatial(EDEN_CAMP_SCENE);
    open.sync(w);
    assert.ok(open.route(w, HUMAN_PROFILE, { level: 0, p: q.outside }, { level: 0, p: q.inside }).ok, `${d.id} passable`);
    const shut: SpatialScene = { ...EDEN_CAMP_SCENE, obstacles: [...EDEN_CAMP_SCENE.obstacles, { id: `${d.id}-shut`, obb: { c: q.centre, half: d.side === 's' || d.side === 'n' ? [d.width / 2 + 0.1, 0.1] : [0.1, d.width / 2 + 0.1], yaw: 0 }, y0: 0, y1: 2.6, kind: 'wall' }] };
    const closed = new Spatial(shut);
    closed.sync(w);
    const r = closed.route(w, HUMAN_PROFILE, { level: 0, p: q.outside }, { level: 0, p: q.inside });
    assert.equal(r.ok, false, `${d.id}: the building has another opening`);
  }
  // Walls are 2.6 m solid prisms with exactly one opening per building.
  for (const b of CAMP_BUILDINGS) assert.equal(EDEN_CAMP_SCENE.obstacles.filter((o) => o.id.startsWith(`${b.id}-wall-`)).length, 5, b.id);
});

test('routes join every arrival to every named spot, and every room hub to every other', () => {
  const w = seeded(), sp = new Spatial(EDEN_CAMP_SCENE);
  sp.sync(w);
  const go = (a: Vec2, b: Vec2) => sp.route(w, HUMAN_PROFILE, { level: 0, p: a }, { level: 0, p: b });
  for (const a of CAMP_ARRIVALS) for (const s of CAMP_SPOTS) { const r = go(a.p, s.p); assert.ok(r.ok, `${a.id} → ${s.id}: ${!r.ok && r.diagnostic.message}`); }
  const hubs = ['kitchen-middle', 'classroom-floor', 'living-middle', 'bunkhouse-aisle', 'fire-side', 'garden-path', 'build-site-edge', 'rack-pile-edge', 'timber-pile-edge'].map((id) => CAMP_SPOTS.find((s) => s.id === id)!);
  for (const a of hubs) for (const b of hubs) if (a !== b) { const r = go(a.p, b.p); assert.ok(r.ok, `${a.id} → ${b.id}`); }
});

test('every activity without preconditions is playable at genesis by Souls at the arrivals', () => {
  const w = seeded();
  bindCampChess(w, 's1', 's2');
  const rt = runtime(w), before = rt.stateHash();
  const genesis = [...byId.values()].filter((a) => !a.after);
  assert.ok(genesis.length >= 30, `${genesis.length} genesis activities`);
  for (const a of genesis) {
    const r = campActivityPlayable(rt, a, roles(rt, a));
    assert.ok(r.ok, `${a.id}: ${!r.ok && `${r.diagnostic.code}: ${r.diagnostic.message}`}`);
  }
  assert.equal(rt.stateHash(), before, 'playability checks are read-only');
});

test('chess is honest about unbound players, then plays a real move once bound', () => {
  const rt = runtime(), a = byId.get('living.chess-opening')!;
  const r = campActivityPlayable(rt, a, { white: 's1' });
  assert.equal(!r.ok && r.diagnostic.code, 'chess.wrong-player');
  bindCampChess(rt.world, 's1', 's2');
  run(rt, a, { white: 's1' });
  const c = readChess(rt, 'chess-board');
  assert.ok(!('code' in c));
  assert.equal(c.position.turn, 'black');
  assert.equal(rt.world.entities['white-pawn-e2'].support?.kind === 'resting-on' && rt.world.entities['white-pawn-e2'].support.slot, 'e4');
});

test('kitchen: cook, then one person takes, serves, eats and returns a bowl through ordinary verbs', () => {
  const rt = runtime();
  run(rt, byId.get('kitchen.prepare-supper')!, { actor: 's1' });
  assert.equal(rt.world.entities['supper-pot'].contents!.fraction, 0.5);
  assert.equal(rt.world.entities['beans-bowl'].contents!.fraction, 0);
  run(rt, byId.get('kitchen.return-prep-spoon')!, { actor: 's1' });
  for (const a of ordered(['kitchen.return-bowl', 'kitchen.return-spoon'])) run(rt, a, { actor: 's2' });
  assert.ok(rt.world.entities['stew-pot'].contents!.fraction < 1, 'stew was served');
  assert.deepEqual(rt.world.entities['bowl-3'].support, { kind: 'resting-on', on: 'dining-table', slot: 'r2c0' });
  assert.deepEqual(rt.world.entities['spoon-3'].support, { kind: 'resting-on', on: 'dining-table', slot: 'r2c1' });
  // The two-person shared meal is still available to the two who have not eaten; the eater stays put.
  run(rt, byId.get('kitchen.shared-meal')!, { actor: 's3', partner: 's4' });
  assert.equal(rt.world.entities['stew-pot'].contents!.fraction, 0.25, 'three servings of 0.25 left one; nothing refills it');
});

test('the shared meal repeats with the same utensils until the finite stew runs out', () => {
  const rt = runtime(), meal = byId.get('kitchen.shared-meal')!;
  run(rt, meal, { actor: 's1', partner: 's2' });
  run(rt, meal, { actor: 's3', partner: 's4' });
  assert.equal(rt.world.entities['stew-pot'].contents!.fraction, 0);
  for (const id of ['bowl-1', 'bowl-2']) assert.equal(rt.world.entities[id].contents!.fraction, 0, `${id} eaten`);
  assert.equal(campActivityPlayable(rt, meal, { actor: 's1', partner: 's2' }).ok, false, 'an empty pot refuses honestly');
});

test('social activities run to completion: class, warm-up, music, fire circle', () => {
  const rt = runtime();
  run(rt, byId.get('class.display')!, {});
  run(rt, byId.get('class.session')!, { host: 's1', presenter: 's2', a1: 's3', a2: 's4' }, (p) => { Object.assign(p, { talkSeconds: 6, questionSeconds: 3, conversationSeconds: 4 }); });
  run(rt, byId.get('camp.warmup')!, { instructor: 's1', f1: 's2', f2: 's3', f3: 's4' });
  run(rt, byId.get('living.computer-music')!, { actor: 's1', listener: 's2' }, (p) => { p.duration = 6; });
  const fire = rt.submit('campfire_circle', bindCampActivity(byId.get('fire.circle')!, { actor: 's3', partner: 's4' }), { preempt: false });
  for (let n = 0; n < 1200 && ['s3', 's4'].some((s) => rt.world.entities[s].human!.activity !== 'warm'); n++) rt.step();
  assert.deepEqual(['s3', 's4'].map((s) => rt.world.entities[s].human!.activity), ['warm', 'warm']);
  rt.cancel(fire.id);
  for (let n = 0; rt.isActive(fire.id) && n < 400; n++) rt.step();
  assert.deepEqual(rt.violations, []);
});

test('garden, sleep and seated activities complete in place', () => {
  const rt = runtime();
  run(rt, byId.get('garden.water-1')!, { actor: 's1' });
  const g = readGarden(rt, 'planter-1');
  assert.ok(!('code' in g) && g.cycles === 1);
  assert.equal(rt.world.entities['water-bowl'].contents!.fraction, 0.75);
  run(rt, byId.get('garden.plant-3')!, { actor: 's2' });
  for (const m of [1, 2, 3, 4]) run(rt, byId.get(`bunk.sleep-mat-${m}`)!, { actor: SOULS[m - 1] }, (p) => { p.duration = 3; });
  run(rt, byId.get('living.read')!, { actor: 's3' }, (p) => { p.duration = 4; });
  run(rt, byId.get('living.computer-work')!, { actor: 's4' }, (p) => { p.duration = 4; });
  run(rt, byId.get('living.draw')!, { actor: 's1' });
});

test('the lookout bay blueprint builds from the piles with four people and stays built', () => {
  const rt = runtime(), build = ordered([...byId.keys()].filter((id) => id.startsWith('build.')));
  assert.equal(build.length, [...byId.keys()].filter((id) => id.startsWith('build.')).length);
  for (const a of build) {
    const r = rt.submit(a.verb, (assert.ok(campActivityPlayable(rt, a, roles(rt, a)).ok, a.id), bindCampActivity(a, roles(rt, a))), { preempt: false });
    for (let n = 0; rt.isActive(r.id) && n < 30000; n++) rt.step();
    assert.equal(r.status, 'completed', `${a.id}: ${r.diagnostic?.code}: ${r.diagnostic?.message}`);
  }
  assert.deepEqual(rt.violations, []);
  const installed = ['upright-a', 'upright-b', ...LOOKOUT_BEAMS.map((b) => b.id), ...LOOKOUT_JOISTS.map((j) => j.id), ...LOOKOUT_SHEETS.map((s) => s.id), 'lookout-stair', ...Array.from({ length: 10 }, (_, i) => `tread-${i + 1}`)];
  for (const id of installed) assert.equal(rt.world.entities[id].phase, 'installed', id);
  assert.equal(SOULS.filter((s) => rt.world.entities[s].human!.level === 4).length, 1, 'someone stands on the new deck');
  // A fresh runtime from the built WorldState alone (daily compaction) keeps the structure.
  const fresh = runtime(structuredClone(rt.world));
  for (const _ of Array(5)) fresh.step();
  assert.deepEqual(fresh.violations, []);
  for (const id of installed) assert.equal(fresh.world.entities[id].phase, 'installed', id);
  // Ground-only kitchen activities still refuse nothing because of the new stair.
  for (const id of ['kitchen.prepare-supper', 'kitchen.shared-meal', 'garden.water-2']) {
    const a = byId.get(id)!, r = campActivityPlayable(fresh, a, roles(fresh, a));
    assert.ok(r.ok, `${id} after the build: ${!r.ok && r.diagnostic.message}`);
  }
});

test('worlds/mars/camp/manifest.json and plan.svg are current', () => {
  const m = JSON.parse(JSON.stringify(edenCampManifest()));
  if (process.env.UPDATE_CAMP_MANIFEST) { writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + '\n'); writeFileSync(PLAN, edenCampPlanSvg()); }
  assert.deepEqual(JSON.parse(readFileSync(MANIFEST, 'utf8')), m, 'run with UPDATE_CAMP_MANIFEST=1 to refresh');
  assert.equal(readFileSync(PLAN, 'utf8'), edenCampPlanSvg(), 'run with UPDATE_CAMP_MANIFEST=1 to refresh');
  assert.equal(m.arrivals.length, 4);
  for (const f of m.fixtures) assert.ok(f.region, `${f.id} lies in a named region`);
  for (const c of m.construction.components) assert.equal(c.region, c.phase === 'staged' ? 'build-site' : `${c.def.startsWith('2x4') ? 'timber' : c.def.startsWith('plywood') ? 'plywood' : 'rack'}-pile`, c.id);
});

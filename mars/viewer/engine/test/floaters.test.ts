// Floater body family (engine/bodies; eden4 Little Martians): humanoids unchanged, the per-verb floater
// policy complete against the registry with a named reason for every verdict, admission pure and
// role-aware, the drawn bob a pure function of the sampled tick (replay-stable), floater movement on
// the ordinary ground planner with level changes only through declared openings, and the shipped GLBs
// static (no skins, no morph targets, no animations) and equal to their manifest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRegistry } from '../api/registry.ts';
import { SEQUENCE_VERBS } from '../sequence/runner.ts';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { provingGround, DECK_Y } from '../scenes/proving-ground.ts';
import { addAll, emptyWorld, human } from '../world/factory.ts';
import { hashOf } from '../core/hash.ts';
import { physicalView, type Body } from '../world/types.ts';
import { TakeRecorder } from '../take/recorder.ts';
import { sampleTake } from '../take/replay.ts';
import {
  admitFloaters, BOB, bodyOf, bodyProblem, FLOATER_HOVER, FLOATER_MODELS, FLOATER_POLICY, FloatPlanner, floaterBody, floaterBodiesOfTake,
  floaterPose, floaterProfile, isFloater, policyRows, R, sampleFloat, withBody,
} from '../bodies/index.ts';

const VERBS = [...createRegistry().keys(), ...Object.keys(SEQUENCE_VERBS)];
const FLOAT: Body = { family: 'floater', model: 'verdelis' };

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}

// ---------------------------------------------------------------- humanoids unchanged

// The same scenario run against the original Mars engine (~/Mars/…/viewer/engine, read-only, before the
// fork added Entity.body) produced exactly these hashes: a walk up stairs-a to the deck and back down,
// and a two-person conversation, 918 ticks, no violations.
const PRE_FORK = { tick: 918, world: 'bfc3c1beaaf487ecd3c797adc9f998b38f54fb02b7628dba9dcc47b4ad013a13', physical: '213060af79e9ee12842d3a389e0ed80674e79d214404d4e412ee9ffef90ecd9b' };

function humanScenario() {
  const base = provingGround();
  const w = addAll(emptyWorld('proving-ground', base), human('ann', -4, 10), human('bo', 0, -4, { yaw: 1 }), human('cy', 1.5, -4, { yaw: 2 }));
  const rt = new Runtime(w, createRegistry(), { spatial: new Spatial(base) }, DEFAULT_INVARIANTS);
  const up = rt.submit('walk_to', { actor: 'ann', x: 10, z: 10, level: 1 });
  const talk = rt.submit('converse', { actors: ['bo', 'cy'], duration: 8 });
  rt.runUntilIdle(20 * 90, [up.id, talk.id]);
  const down = rt.submit('walk_to', { actor: 'ann', x: -6, z: 6, level: 0 });
  rt.runUntilIdle(20 * 90, [down.id]);
  return { rt, statuses: [up.status, talk.status, down.status] };
}

test('humanoids: a world without body fields hashes exactly as the pre-fork engine did', () => {
  const { rt, statuses } = humanScenario();
  assert.deepEqual(statuses, ['completed', 'completed', 'completed']);
  assert.equal(rt.violations.length, 0);
  assert.equal(rt.world.tick, PRE_FORK.tick);
  assert.equal(hashOf(rt.world), PRE_FORK.world);
  assert.equal(hashOf(physicalView(rt.world)), PRE_FORK.physical);
  for (const e of Object.values(rt.world.entities)) {
    assert.equal('body' in e, false, `${e.id} gained a body field`);
    assert.equal(bodyOf(e).family, 'humanoid');
    assert.equal(isFloater(e), false);
  }
});

test('humanoids: withBody(humanoid) adds no field; a floater body is a separate, validated copy', () => {
  const ann = human('ann', 0, 0);
  const before = structuredClone(ann);
  deepFreeze(ann);
  const same = withBody(ann, { family: 'humanoid' });
  assert.equal('body' in same, false);
  assert.equal(hashOf(same), hashOf(before));
  const f = withBody(ann, { family: 'floater', model: 'kweku', radius: 0.3 });
  assert.deepEqual(f.body, { family: 'floater', model: 'kweku', radius: 0.3 });
  assert.notEqual(hashOf(f), hashOf(before));
  assert.deepEqual(ann, before); // input untouched (and frozen)
  assert.deepEqual(floaterBody(f.body), { family: 'floater', model: 'kweku', radius: 0.3, hoverHeight: FLOATER_HOVER });
  for (const [bad, code] of [[{ family: 'ghost' }, 'body.family'], [{ family: 'floater', radius: 5 }, 'body.radius'], [{ family: 'floater', hoverHeight: 0 }, 'body.hover-height'], [{ family: 'humanoid', model: 'x' }, 'body.humanoid-fields'], [{ family: 'floater', legs: 2 }, 'body.unknown-field:legs']] as const)
    assert.equal(bodyProblem(bad), code);
  assert.throws(() => withBody(ann, { family: 'floater', radius: 5 }), /body.radius/);
});

// ---------------------------------------------------------------- policy

test('policy: exactly one entry per registry verb and sequence built-in, each with a named reason', () => {
  const policy = Object.keys(FLOATER_POLICY).sort();
  assert.deepEqual(policy, [...VERBS].sort(), 'FLOATER_POLICY must match createRegistry() + SEQUENCE_VERBS exactly');
  for (const row of policyRows(VERBS)) {
    assert.match(row.reason, /^floater\.[a-z-]+$/, `${row.verb}: reason`);
    assert.ok(row.note.length > 10, `${row.verb}: note`);
    assert.ok(['works', 'approximates', 'refuses'].includes(row.status));
  }
  const p = FLOATER_POLICY;
  for (const r of Object.values(p).flatMap((x) => Object.values(x.roles ?? {}))) assert.match(r.reason, /^floater\.[a-z-]+$/);
  // never pretend: everything that drives a hand or a foot refuses
  for (const verb of ['carry', 'take_item', 'put_item', 'serve', 'eat', 'hold_items', 'work_at', 'read_book', 'chess_move', 'drawing_work', 'paint', 'prepare_food', 'garden_care', 'seed_planting', 'tidy_table', 'hand_up', 'install_plywood', 'move_fixture', 'setup_room', 'shared_food_break'])
    assert.deepEqual([p[verb].status, p[verb].reason], ['refuses', R.noHands], verb);
  for (const verb of ['group_warmup', 'warmup_participant', 'grounded_dance']) assert.deepEqual([p[verb].status, p[verb].reason], ['refuses', R.noArms], verb);
  assert.deepEqual([p.climb_frame.status, p.climb_frame.reason], ['refuses', R.climb]);
  assert.deepEqual([p.beam_walk.status, p.beam_walk.reason], ['refuses', R.noFeet]);
  for (const verb of ['mount', 'ride_to', 'ride_loop', 'dismount', 'forklift_pick', 'forklift_deliver', 'forklift_present', 'forklift_back']) assert.equal(p[verb].reason, R.ride, verb);
  assert.deepEqual([p.walk_to.status, p.walk_to.reason], ['approximates', R.glide]);
  assert.deepEqual([p.face.status, p.converse.status], ['works', 'works']);
});

test('admission: every verb with a floater actor gets an explicit verdict; humans only are not judged', () => {
  const bodies: Record<string, Body> = { v: FLOAT };
  const lookup = (id: string) => bodies[id];
  const counts = { works: 0, approximates: 0, refuses: 0 };
  for (const verb of VERBS) {
    const params = deepFreeze({ actor: 'v', actors: ['v', 'h'], session: 's1' });
    const a = admitFloaters(verb, params, lookup);
    assert.deepEqual(a.floaters, ['v'], verb);
    assert.match(a.reason, /^floater\.[a-z-]+$/, verb);
    assert.ok(a.note.length > 0, verb);
    const p = FLOATER_POLICY[verb];
    if (!p.delegate) assert.equal(a.status, (p.roles?.actor ?? p).status, verb);
    if (a.status === 'refuses') assert.ok(a.blockedBy?.length, `${verb}: refusal names who`);
    counts[a.status]++;
    const human = admitFloaters(verb, deepFreeze({ actor: 'h', actors: ['h', 'k'] }), lookup);
    assert.deepEqual([human.status, human.reason, human.floaters], ['works', 'floater.not-involved', []], verb);
  }
  assert.ok(counts.works > 0 && counts.approximates > 0 && counts.refuses > 0, JSON.stringify(counts));
  assert.equal(admitFloaters('fly_to_venus', { actor: 'v' }, lookup).reason, 'floater.unknown-verb');
});

test('admission: roles and delegation; params are never modified', () => {
  const lookup = (id: string) => (id.startsWith('lm-') ? FLOAT : undefined);
  const reading = deepFreeze({ book: 'b', reader: 'lm-ada', seat: 's', listeners: ['lm-kweku', 'ann'] });
  const before = structuredClone(reading);
  const r = admitFloaters('reading_circle', reading, lookup);
  assert.equal(r.status, 'refuses');
  assert.deepEqual(r.blockedBy, [{ id: 'lm-ada', role: 'reader', reason: R.noHands }]);
  assert.deepEqual(reading, before);
  const listen = admitFloaters('reading_circle', { book: 'b', reader: 'ann', seat: 's', listeners: ['lm-kweku'] }, lookup);
  assert.deepEqual([listen.status, listen.reason], ['approximates', R.hoverSeat]);
  const jam = admitFloaters('music_gathering', { performer: 'ann', station: 'w', seat: 's', listeners: ['lm-mycos'], dancers: ['lm-kalama'] }, lookup);
  assert.equal(jam.status, 'refuses');
  assert.deepEqual(jam.blockedBy?.map((b) => [b.id, b.role, b.reason]), [['lm-kalama', 'dancers', R.noArms]]);
  // gathering_continuation follows its binding
  assert.equal(admitFloaters('gathering_continuation', { session: 's', binding: { kind: 'discussion', actors: ['lm-ada', 'ann'], duration: 30 } }, lookup).status, 'works');
  assert.equal(admitFloaters('gathering_continuation', { session: 's', binding: { kind: 'work', actor: 'lm-ada' } }, lookup).status, 'refuses');
  // living_intention: each objective needs an alternative the floater can do
  const objectives = deepFreeze({
    actor: 'lm-verdelis',
    objectives: [
      { purpose: 'p1', label: 'talk', alternatives: [{ verb: 'work_at', params: { station: 'w' } }, { verb: 'converse', params: { actors: ['lm-verdelis', 'ann'] } }] },
      { purpose: 'p2', label: 'rest', alternatives: [{ verb: 'sit', params: { fixture: 'bench' } }] },
    ],
  });
  const li = admitFloaters('living_intention', objectives, lookup);
  assert.equal(li.status, 'approximates');
  assert.deepEqual(li.alternatives, [{ objective: 0, admissible: [1] }, { objective: 1, admissible: [0] }]);
  const dead = admitFloaters('living_intention', { actor: 'lm-verdelis', objectives: [{ purpose: 'p', label: 'cook', alternatives: [{ verb: 'prepare_food', params: {} }] }] }, lookup);
  assert.deepEqual([dead.status, dead.reason], ['refuses', R.noAlternative]);
  // determinism: the same question gets the same answer
  assert.deepEqual(admitFloaters('reading_circle', reading, lookup), r);
});

// ---------------------------------------------------------------- drawn pose: replay-stable bob

test('pose: bob, tilt and yaw are pure functions of the sampled tick (no wall clock, no state)', () => {
  const body = floaterBody(FLOAT);
  const ground = deepFreeze({ p: [1, 0, 2] as [number, number, number], yaw: 0.3 });
  const a = floaterPose('lm-verdelis', ground, body, 1234.5, 0.05, 0.8);
  for (let i = 0; i < 50; i++) floaterPose(`other-${i}`, ground, body, i * 7, 0.05);
  assert.deepEqual(floaterPose('lm-verdelis', ground, body, 1234.5, 0.05, 0.8), a);
  // it bobs around the hover height within its amplitude, and differs between heads at one tick
  let lo = Infinity, hi = -Infinity;
  for (let t = 0; t < 2000; t += 3) {
    const y = floaterPose('lm-verdelis', ground, body, t, 0.05).p[1] - body.hoverHeight;
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  assert.ok(hi <= BOB.amp + 1e-12 && lo >= -BOB.amp - 1e-12 && hi - lo > BOB.amp, `bob range ${lo}..${hi}`);
  assert.notEqual(floaterPose('lm-ada', ground, body, 100, 0.05).p[1], floaterPose('lm-kweku', ground, body, 100, 0.05).p[1]);
  // leaning into travel grows with speed and is capped
  const still = floaterPose('x', ground, body, 10, 0.05, 0), fast = floaterPose('x', ground, body, 10, 0.05, 1.2), faster = floaterPose('x', ground, body, 10, 0.05, 9);
  assert.ok(fast.pitch > still.pitch && faster.pitch - still.pitch <= BOB.leanMax + 1e-12);
});

test('pose: replaying a recorded take draws the same floater at the same tick', () => {
  const base = provingGround();
  const lm = withBody(human('lm-shuijing', -6, -6), { family: 'floater', model: 'shuijing' });
  const w = addAll(emptyWorld('proving-ground', base), lm, human('ann', 3, -6));
  const rt = new Runtime(w, createRegistry(), { spatial: new Spatial(base) }, DEFAULT_INVARIANTS);
  const rec = new TakeRecorder(rt, { rulesVersion: 'floaters-test' });
  const go = rt.submit('walk_to', { actor: 'lm-shuijing', x: 0, z: -3 });
  rt.runUntilIdle(20 * 30, [go.id]);
  assert.equal(go.status, 'completed', go.diagnostic?.message);
  const take = rec.finish();
  const bodies = floaterBodiesOfTake(take);
  assert.deepEqual([...bodies.keys()], ['lm-shuijing']);
  const body = floaterBody(bodies.get('lm-shuijing'));
  const draw = (t: number) => {
    const f = sampleTake(take, t);
    const e = f.entities['lm-shuijing'];
    return floaterPose('lm-shuijing', e, body, take.startTick + f.tick, take.dt, e.speed ?? 0);
  };
  const times = [0, 0.37, 1.5, 2.25, 3.0001];
  const first = times.map(draw);
  const again = [...times].reverse().map(draw).reverse(); // scrubbing order does not matter
  assert.deepEqual(again, first);
  assert.notDeepEqual(first[1].p, first[3].p);
  // and the take's world is still free of bodies for the humanoid
  assert.equal('body' in take.finalState.entities.ann, false);
});

// ---------------------------------------------------------------- movement

test('movement: floaters glide at constant hover on the ordinary ground route', () => {
  const base = provingGround();
  const w = addAll(emptyWorld('proving-ground', base), withBody(human('lm-ada', -6, -6), FLOAT));
  const before = structuredClone(w);
  const fp = new FloatPlanner(base);
  const plan = fp.plan(w, FLOAT, { level: 0, p: [-6, -6] }, { level: 0, p: [6, -6] });
  assert.ok(plan.ok, !plan.ok ? plan.message : '');
  if (!plan.ok) return;
  assert.deepEqual(w, before, 'planning does not touch the world');
  for (const p of plan.track.points) assert.equal(p.g[1], 0);
  for (let s = 0; s <= plan.track.length; s += 0.25) assert.ok(Math.abs(sampleFloat(plan.track, s).at[1] - FLOATER_HOVER) < 1e-9);
  // same ground planner as humans: the route a floater gets is the human planner's route at its radius
  const human_ = new Spatial(base).route(w, floaterProfile(floaterBody(FLOAT)), { level: 0, p: [-6, -6] }, { level: 0, p: [6, -6] });
  assert.ok(human_.ok);
  if (human_.ok) assert.deepEqual(plan.route, human_.route);
});

test('movement: stairs are refused by name; a declared opening is glided through without a jump', () => {
  const base = provingGround();
  const w = emptyWorld('proving-ground', base);
  const start = { level: 0, p: [-2, 10] as [number, number] }, goal = { level: 1, p: [10, 10] as [number, number] };
  const refused = new FloatPlanner(base).plan(w, FLOAT, start, goal);
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.reason, 'floater.stairs-unsupported');
    assert.ok(refused.links.includes('stairs-a'), refused.message);
  }
  // the same scene with stairs-a declared a passable opening (e.g. a stairwell void)
  const plan = new FloatPlanner(base, { openings: ['stairs-a'] }).plan(w, FLOAT, start, goal);
  assert.ok(plan.ok, !plan.ok ? plan.message : '');
  if (!plan.ok) return;
  const last = sampleFloat(plan.track, plan.track.length);
  assert.equal(last.level, 1);
  assert.equal(last.ground[1], DECK_Y);
  let prev = sampleFloat(plan.track, 0);
  const step = 0.05;
  for (let s = step; s <= plan.track.length + step; s += step) {
    const cur = sampleFloat(plan.track, s);
    const d = Math.hypot(cur.at[0] - prev.at[0], cur.at[1] - prev.at[1], cur.at[2] - prev.at[2]);
    assert.ok(d <= step + 1e-9, `jump of ${d} m at s=${s}`);
    assert.ok(Math.abs(cur.at[1] - cur.ground[1] - FLOATER_HOVER) < 1e-9);
    prev = cur;
  }
  // the humans' planner still uses the stairs as before (floater rules live on a separate Spatial)
  const humans = new Spatial(base).route(w, { ...floaterProfile(floaterBody(FLOAT)), radius: 0.28 }, start, goal);
  assert.ok(humans.ok);
});

// ---------------------------------------------------------------- models

const HERE = path.dirname(fileURLToPath(import.meta.url));
function charactersDir(): string {
  for (let d = HERE; d !== path.dirname(d); d = path.dirname(d)) {
    const c = path.join(d, 'worlds', 'littlemartians', 'characters');
    if (fs.existsSync(path.join(c, 'manifest.json'))) return c;
  }
  throw new Error('worlds/littlemartians/characters/manifest.json not found above engine/test');
}

/** The JSON chunk of a GLB, after checking the container (magic, version 2, declared length, chunk types). */
function glbJson(buf: Buffer): Record<string, unknown> {
  assert.equal(buf.readUInt32LE(0), 0x46546c67, 'magic glTF');
  assert.equal(buf.readUInt32LE(4), 2, 'version 2');
  assert.equal(buf.readUInt32LE(8), buf.length, 'declared length');
  const jsonLen = buf.readUInt32LE(12);
  assert.equal(buf.readUInt32LE(16), 0x4e4f534a, 'JSON chunk');
  const binAt = 20 + jsonLen;
  assert.equal(buf.readUInt32LE(binAt + 4), 0x004e4942, 'BIN chunk');
  assert.equal(binAt + 8 + buf.readUInt32LE(binAt), buf.length, 'BIN chunk fills the file');
  return JSON.parse(buf.subarray(20, binAt).toString('utf8'));
}

test('models: every shipped GLB is a valid static glTF (no skins, morph targets or animations) matching its manifest', () => {
  const dir = charactersDir();
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as { models: { id: string; group: string; file: string; bytes: number; sha256: string; facing: { yaw: number }; license: { owner: string }; lore: object; source: { archiveId: string } }[] };
  assert.deepEqual(manifest.models.map((m) => [m.id, m.group, m.file]), FLOATER_MODELS.map((m) => [m.id, m.group, m.file]), 'engine/bodies/models.ts matches the manifest');
  assert.deepEqual(manifest.models.filter((m) => m.group === 'floater').map((m) => m.id), ['verdelis', 'kalama', 'kweku', 'mycos', 'ada', 'shuijing', 'nyx']);
  for (const m of manifest.models) {
    const buf = fs.readFileSync(path.join(dir, m.file));
    assert.equal(buf.length, m.bytes, m.id);
    assert.equal(createHash('sha256').update(buf).digest('hex'), m.sha256, m.id);
    assert.equal(FLOATER_MODELS.find((x) => x.id === m.id)?.facingYaw, m.facing.yaw, `${m.id} facing`);
    assert.ok(m.license.owner && Object.keys(m.lore).length && !/rigged/.test(m.source.archiveId), m.id);
    const j = glbJson(buf) as { skins?: unknown[]; animations?: unknown[]; meshes?: { primitives: { targets?: unknown[] }[]; weights?: unknown[] }[]; nodes?: { skin?: number; weights?: unknown[] }[]; extensionsRequired?: string[] };
    assert.equal(j.skins?.length ?? 0, 0, `${m.id} skins`);
    assert.equal(j.animations?.length ?? 0, 0, `${m.id} animations`);
    for (const mesh of j.meshes ?? []) {
      assert.equal(mesh.weights?.length ?? 0, 0, `${m.id} mesh weights`);
      for (const prim of mesh.primitives) assert.equal(prim.targets?.length ?? 0, 0, `${m.id} morph targets`);
    }
    for (const n of j.nodes ?? []) assert.ok(n.skin === undefined && !n.weights?.length, `${m.id} node skin/weights`);
    for (const ext of j.extensionsRequired ?? []) assert.ok(['KHR_draco_mesh_compression', 'EXT_texture_webp'].includes(ext), `${m.id} requires ${ext}`);
  }
});

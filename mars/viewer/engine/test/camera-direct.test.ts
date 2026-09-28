// Camera direction language (OWNER_FEEDBACK_2026-09-28 §11 layer 1, docs/engineering/CAMERA_DIRECT.md):
// direction sentences as typed objects → resolved intents / shot programs; ambiguity is a question, unknown
// names and invalid verbs are refused; the engine_direct_camera tool.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileDirection, parseDirection, SemanticWorld, cameraDirectionSchema, type CameraDirection, type DirectContext } from '../camera/direct.ts';
import { directCamera } from '../camera/synth.ts';
import { solarPosition, sunBehindWindow, worldHeadingOfAzimuth } from '../env/sun.ts';
import { createController, engineTools, ENGINE_SCENES, seedHistory } from '../api/index.ts';
import { crossBindings, crossTemplate } from './sequence-fixtures.ts';
import { datan, dtan } from '../core/math.ts';
import type { SpatialScene } from '../spatial/types.ts';
import type { WorldState } from '../world/types.ts';
import { beforeSunset, campus2024, campus2026, flagship, onGrid, stepTimes, withTime } from './camera-direct-fixtures.ts';

const DEG = Math.PI / 180;
const wrapDiff = (a: number, b: number) => Math.abs(((a - b + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);

function ctxOf(scene: SpatialScene, world: WorldState, extra: Partial<DirectContext> = {}): DirectContext {
  return { semantic: new SemanticWorld(scene, world), datetime: world.env.datetime, duration: 600, ...extra };
}
function compile(d: unknown, ctx: DirectContext, t0 = 0) {
  const p = parseDirection(d, 0);
  assert.ok(p.ok, JSON.stringify(p));
  return compileDirection(p.direction, 0, t0, ctx);
}

test('vocabulary: invalid verbs, a revolution without an angle, duration + speed are refused by the schema', () => {
  const base = { subject: { kind: 'region', ref: 'chiba' } };
  const zoom = parseDirection({ ...base, motion: { verb: 'zoom' } }, 3);
  assert.ok(!zoom.ok);
  assert.equal(zoom.diagnostic.code, 'camera.direct.invalid');
  assert.match(zoom.diagnostic.message, /direction 3: motion\.verb/);
  assert.deepEqual((zoom.diagnostic.details as any).verbs, ['pan', 'tilt', 'dolly', 'orbit', 'crane', 'push_in', 'pull_out', 'fly_through', 'hold']);
  assert.ok(!parseDirection({ ...base, motion: { verb: 'orbit' } }, 0).ok, 'orbit needs degrees');
  assert.ok(!parseDirection({ subject: { kind: 'building', ref: 'x' }, motion: { verb: 'hold' } }, 0).ok, 'subject kinds are closed');
  const both = parseDirection({ ...base, motion: { verb: 'pan' }, duration: 5, speed: 3 }, 0);
  assert.ok(!both.ok && /duration or speed/.test(both.diagnostic.message));
  assert.ok(parseDirection({ ...base, motion: { verb: 'orbit', degrees: 270, direction: 'ccw' }, duration: 120, framing: { size: 'wide', headroom: 0.1, thirds: 'left', side: 'south-east' }, context: { sunBehind: { sunset: true } } }, 0).ok);
  // the zod schema is what MCP clients see
  const js = engineTools().find((t) => t.name === 'engine_direct_camera');
  assert.ok(js, 'engine_direct_camera is registered');
  assert.equal(cameraDirectionSchema.safeParse({ ...base, motion: { verb: 'fly_through', from: [0, 1.6, 0] } }).success, true);
});

test('sentence: "do a 270° revolution around the main pallet racks over 2 minutes" → orbit of the take\'s rack bay', () => {
  const { take, input } = flagship();
  const ctx: DirectContext = { semantic: new SemanticWorld(input.scene, take.finalState, input.facts), datetime: take.finalState.env.datetime, duration: input.duration, sampler: input.sampler };
  const at = onGrid(stepTimes(take).get('seat_b1')!.start); // both uprights raised, beams about to be seated
  const c = compile({ subject: { kind: 'assembly', ref: 'rack bay' }, motion: { verb: 'orbit', degrees: 270 }, duration: 120, at }, ctx, at);
  assert.ok(c.ok, JSON.stringify(c));
  const it = c.intent;
  assert.equal(it.verb, 'orbit');
  assert.equal(it.t0, at);
  assert.equal(it.subject.kind, 'assembly');
  assert.equal(it.subject.id, 'structure:A', 'the connected rack structure (uprights + beams + joists + deck + stair)');
  assert.match(it.subject.label, /^rack bay \(24 parts/);
  assert.ok(it.subject.ids.includes('A') && it.subject.ids.includes('B'), 'scored members = the parts already in place (both uprights)');
  assert.ok(!it.subject.ids.some((id) => /^j\d|^s\d|^t\d/.test(id)), 'joists, sheets and treads are still on the piles');
  // "pallet rack" names the same structure; the static campus racks are buildings named differently
  const c2 = compile({ subject: { kind: 'assembly', ref: 'pallet racks' }, motion: { verb: 'orbit', degrees: 270 } }, ctx, at);
  assert.ok(c2.ok && c2.intent.subject.id === 'structure:A');
});

test('sentence: "do a pan across Chiba with the sunset in the background" → pan + sun window from the sun model', () => {
  const { scene, world } = campus2026();
  const at = beforeSunset('2026-03-01', 20);
  const w = withTime(world, at);
  const c = compile({ subject: { kind: 'region', ref: 'Chiba' }, motion: { verb: 'pan' }, context: { sunBehind: { sunset: true } } }, ctxOf(scene, w));
  assert.ok(c.ok, JSON.stringify(c));
  assert.equal(c.intent.subject.id, 'chiba');
  const sun = c.intent.sun!;
  const sp = solarPosition(at);
  assert.ok(sp.elevationDeg > 0 && sp.elevationDeg < 12, `low sun at ${at}: ${sp.elevationDeg}`);
  assert.ok(sp.azimuthDeg > 240 && sp.azimuthDeg < 275, 'a March sunset is west-south-west');
  assert.ok(wrapDiff(sun.cameraHeading.centre, worldHeadingOfAzimuth(sp.azimuthDeg) + Math.PI) < 1e-9, 'camera on the far side of the subject from the sun');
  const hfov = 2 * datan(dtan(25 * DEG) * 16 / 9);
  assert.ok(Math.abs(sun.cameraHeading.halfWidth - (hfov / 2 - 3 * DEG)) < 1e-9, 'window half-width = hfov/2 − margin');
  assert.ok(Math.abs(sun.pitch.max - (sp.elevationDeg - 6) * DEG) < 1e-9 && Math.abs(sun.pitch.min - (sp.elevationDeg - 22) * DEG) < 1e-9, 'pitch window: sun 6°..22° above the axis');
  // at the take's own 16:00 light "sunset" is refused (never silently relit)
  const noon = compile({ subject: { kind: 'region', ref: 'chiba' }, motion: { verb: 'pan' }, context: { sunBehind: { sunset: true } } }, ctxOf(scene, world));
  assert.ok(!noon.ok);
  assert.equal(noon.diagnostics[0].code, 'camera.direct.not-sunset');
  assert.match(noon.diagnostics[0].message, /2026-03-01T16:00/);
  // a set sun has no window; an orbit wider than the window cannot keep the sun behind
  const night = compile({ subject: { kind: 'region', ref: 'chiba' }, motion: { verb: 'hold' }, context: { sunBehind: true } }, ctxOf(scene, withTime(world, '2026-03-01T21:00')));
  assert.ok(!night.ok && night.diagnostics[0].code === 'camera.direct.sun-below-horizon');
  const orbit = compile({ subject: { kind: 'region', ref: 'chiba' }, motion: { verb: 'orbit', degrees: 270 }, context: { sunBehind: true } }, ctxOf(scene, w));
  assert.ok(!orbit.ok && orbit.diagnostics.some((d) => d.code === 'camera.direct.incompatible'));
  assert.deepEqual(sunBehindWindow(at, { vfovDeg: 50 }).sun.direction, sp.direction);
});

test('sentence: "go inside the kitchen and face the sink" (2024) → interior room + clustered sink fixture', () => {
  const { scene, world } = campus2024();
  const c = compile({ subject: { kind: 'region', ref: 'kitchen-interior' }, motion: { verb: 'fly_through' }, context: { interior: 'Kitchen · sink, pantry and appliances', lookAt: 'sink' } }, ctxOf(scene, world));
  assert.ok(c.ok, JSON.stringify(c));
  assert.equal(c.intent.interior!.id, 'kitchen-interior', 'region named by its label');
  assert.equal(c.intent.lookAt!.label, 'sink bowl + stainless sink rim', 'touching parts of one sink are one thing');
  assert.equal(c.intent.lookAt!.members!.length, 2);
  // "kitchen" is an exact region id (the communal kitchen and lounge) — exact ids always win over word matches
  const k = compile({ subject: { kind: 'region', ref: 'kitchen' }, motion: { verb: 'hold' } }, ctxOf(scene, world));
  assert.ok(k.ok && k.intent.subject.id === 'kitchen');
  // separate things are a question: three table tops in the kitchen
  const tt = compile({ subject: { kind: 'region', ref: 'kitchen-interior' }, motion: { verb: 'fly_through' }, context: { interior: 'kitchen-interior', lookAt: 'table top' } }, ctxOf(scene, world));
  assert.ok(!tt.ok);
  const q = tt.diagnostics[0];
  assert.equal(q.code, 'camera.direct.ambiguous');
  assert.equal((q.details as any).candidates.length, 3);
  assert.equal((q.details as any).question, "Which fixture is 'table top'?");
  // interior only for moves that make sense in a room
  const orb = compile({ subject: { kind: 'region', ref: 'kitchen-interior' }, motion: { verb: 'orbit', degrees: 90 }, context: { interior: 'kitchen-interior' } }, ctxOf(scene, world));
  assert.ok(!orb.ok && orb.diagnostics[0].code === 'camera.direct.incompatible');
});

test('sentence: "look at this crowd of people having this activity" → the group in that action at that time', () => {
  const { take, input } = flagship();
  const ctx: DirectContext = { semantic: new SemanticWorld(input.scene, take.finalState, input.facts), datetime: take.finalState.env.datetime, duration: input.duration, sampler: input.sampler };
  const t30 = onGrid(stepTimes(take).get('carryA')!.start + 20); // p1 + p2 carrying upright A
  const byAction = compile({ subject: { kind: 'group', ref: 'carryA' }, motion: { verb: 'hold' } }, ctx, t30);
  assert.ok(byAction.ok && byAction.intent.subject.id === 'step:carryA');
  assert.deepEqual(byAction.intent.subject.ids, ['p1', 'p2']);
  assert.equal(byAction.intent.subject.dynamic, true);
  const byActivity = compile({ subject: { kind: 'group', ref: 'carry' }, motion: { verb: 'hold' } }, ctx, t30);
  assert.ok(byActivity.ok && byActivity.intent.subject.id === 'step:carryA', 'one carry going on');
  // a moment when two crews share an activity for two different actions: the director is asked which
  let two: { t: number; act: string; tasks: string[] } | null = null;
  for (let t = 0; t < input.duration && !two; t += 1) {
    const by = new Map<string, Set<string>>();
    for (const f of Object.values(input.facts!(t))) if (f.task?.startsWith('step:') && f.activity) (by.get(f.activity) ?? by.set(f.activity, new Set()).get(f.activity)!).add(f.task);
    for (const [act, tasks] of [...by.entries()].sort()) if (tasks.size > 1) { two = { t, act, tasks: [...tasks].sort() }; break; }
  }
  assert.ok(two, 'the flagship has overlapping crews');
  const amb = compile({ subject: { kind: 'group', ref: two.act }, motion: { verb: 'hold' } }, ctx, two.t);
  assert.ok(!amb.ok);
  assert.equal(amb.diagnostics[0].code, 'camera.direct.ambiguous');
  assert.deepEqual((amb.diagnostics[0].details as any).candidates.map((c: any) => c.id), two.tasks);
  const none = compile({ subject: { kind: 'group', ref: 'dancing' }, motion: { verb: 'hold' } }, ctx, two.t);
  assert.ok(!none.ok && none.diagnostics[0].code === 'camera.direct.unknown');
  assert.match(none.diagnostics[0].message, /actions now: .*step:/);
});

test('resolver: ambiguous and unknown names are refused with candidates / what is known, never guessed', () => {
  const { scene, world } = campus2026();
  const racks = compile({ subject: { kind: 'assembly', ref: 'rack building' }, motion: { verb: 'hold' } }, ctxOf(scene, world));
  assert.ok(!racks.ok);
  const d = racks.diagnostics[0];
  assert.equal(d.code, 'camera.direct.ambiguous');
  assert.deepEqual(d.subjects, ['north-rack-building', 'west-rack-building']);
  assert.match(d.message, /which one\? north-rack-building \('North rack building'\) \| west-rack-building \('West rack building'\)/);
  const moon = compile({ subject: { kind: 'region', ref: 'moon base' }, motion: { verb: 'hold' } }, ctxOf(scene, world));
  assert.ok(!moon.ok && moon.diagnostics[0].code === 'camera.direct.unknown');
  assert.ok((moon.diagnostics[0].details as any).known.some((k: any) => k.id === 'chiba'), 'lists the known regions');
  const ok = compile({ subject: { kind: 'assembly', ref: 'north rack building' }, motion: { verb: 'hold' } }, ctxOf(scene, world));
  assert.ok(ok.ok && ok.intent.subject.id === 'north-rack-building');
});

test('program: lead-in hold, one dense path shot per direction, contiguous windows, corrections reserved', () => {
  const { scene, world } = campus2026();
  const dirs: CameraDirection[] = [
    { subject: { kind: 'region', ref: 'chiba' }, motion: { verb: 'hold' }, duration: 4, at: 2, framing: { size: 'wide' } },
    { subject: { kind: 'region', ref: 'chiba' }, motion: { verb: 'push_in' }, duration: 16 },
  ];
  const r = directCamera(dirs, { scene, world, sampler: () => ({}), duration: 60 });
  assert.ok(r.ok, JSON.stringify(!r.ok && r.diagnostics));
  const shots = r.plan.shots;
  assert.deepEqual(shots.map((s) => [s.label, s.t0, s.t1, s.spec.kind]), [
    ['lead-in hold (before the first direction)', 0, 2, 'fixed'],
    ["hold region 'chiba'", 2, 6, 'path'],
    ["push_in region 'chiba'", 6, 22, 'path'],
  ]);
  assert.equal(r.plan.samples.length, 221, '22 s at 10 Hz');
  const push = r.shots[1];
  assert.equal(push.keys.length, 161);
  const d0 = push.params.fromDistance as number, d1 = push.params.toDistance as number;
  assert.ok(d0 > d1, `push_in: ${d0} → ${d1}`);
  for (const s of r.report.shots) assert.deepEqual(s.corrections, [], 'phase 2 slot is present and empty');
  assert.equal(r.report.shots[0].subject.id, 'chiba');
  assert.equal(r.report.rejected, false);
  // overlapping starts are refused
  const bad = directCamera([dirs[0], { ...dirs[1], at: 3 }], { scene, world, sampler: () => ({}), duration: 60 });
  assert.ok(!bad.ok && bad.diagnostics[0].code === 'camera.direct.overlap');
});

test('api: engine_direct_camera plans + stores a directed track beside the take; refusals are structured; the take is untouched', () => {
  const c = createController({ history: seedHistory(), scenes: ENGINE_SCENES });
  assert.ok(c.call('fork', { from: 'proving-ground', name: 'ws' }).ok);
  const plan = (c.call('bind_plan', { template: crossTemplate, bindings: crossBindings, workspace: 'ws' }) as any).plan_id;
  const ex = c.call('execute', { plan_id: plan, workspace: 'ws' }) as any;
  assert.ok(ex.ok);
  const hash = c.takes.takeHash(ex.take_id);
  const dirs = [
    { subject: { kind: 'region', ref: 'lawn' }, motion: { verb: 'hold' }, duration: 3 },
    { subject: { kind: 'entity', ref: 'n1' }, motion: { verb: 'orbit', degrees: 90 }, duration: 10 },
  ];
  const r = c.call('direct_camera', { take_id: ex.take_id, directions: dirs }) as any;
  assert.ok(r.ok, JSON.stringify(r).slice(0, 600));
  assert.ok(r.takeHashUnchanged);
  assert.equal(c.takes.takeHash(ex.take_id), hash);
  assert.match(r.track_id, /^dir-/);
  assert.equal(r.track.samples, 131);
  assert.equal(r.track.keyframes.length, 14, '1 Hz keyframes');
  assert.equal(r.report.shots.length, 2);
  const orbit = r.report.shots[1];
  assert.equal(orbit.subject.id, 'n1');
  assert.ok(orbit.params.orbitRadius > 1);
  // phase 2 found a genuine issue: the computed orbit of n1 passes through the passage west wall (phase 1 left it to
  // the planner, which cut away from it); the self-correction raises it 1 m and records why
  assert.equal(orbit.corrections.length, 1);
  const fix = orbit.corrections[0];
  assert.equal(fix.failure, 'collision');
  assert.equal(fix.strategy, 'raise');
  assert.equal(fix.params.heightOffset, 1);
  assert.match(fix.reason, /passage west wall/);
  assert.equal(fix.after.failingSamples, 0);
  assert.ok(orbit.simulation.valid);
  assert.equal(orbit.validation.invalidSamples, 0);
  assert.equal(orbit.planner.cuts, 0, 'no planner rescue cut any more');
  const stored = (c.call('get_take', { take_id: ex.take_id, include: ['cameras'] }) as any).cameras;
  assert.deepEqual(stored.map((t: any) => [t.id, t.kind]), [[r.track_id, 'directed']]);
  // same directions → same track id and samples
  const again = c.call('direct_camera', { take_id: ex.take_id, directions: dirs }) as any;
  assert.equal(again.track_id, r.track_id);
  assert.equal(again.report.trackHash, r.report.trackHash);
  // ambiguity → a question with candidates; invalid verb → input refused; too fast → the minimum duration
  const amb = c.call('direct_camera', { take_id: ex.take_id, directions: [{ subject: { kind: 'entity', ref: 'bench' }, motion: { verb: 'hold' } }] }) as any;
  assert.equal(amb.ok, false);
  assert.equal(amb.code, 'camera.direct.ambiguous');
  assert.deepEqual(amb.diagnostics[0].details.candidates.map((x: any) => x.id), ['bench-n', 'bench-s']);
  const zoom = c.call('direct_camera', { take_id: ex.take_id, directions: [{ subject: { kind: 'entity', ref: 'n1' }, motion: { verb: 'zoom' } }] });
  assert.equal(zoom.code, 'op.invalid-input');
  const fast = c.call('direct_camera', { take_id: ex.take_id, directions: [{ subject: { kind: 'entity', ref: 'n1' }, motion: { verb: 'orbit', degrees: 90 }, duration: 8 }] }) as any;
  assert.equal(fast.code, 'camera.direct.motion-cap');
  assert.match(fast.message, /needs ≥ 8\.44 s/);
  const raw = c.call('direct_camera', { take_id: ex.take_id, directions: dirs, correct: false }) as any;
  assert.ok(raw.ok && raw.track_id !== r.track_id);
  assert.ok(raw.report.shots[1].validation.invalidSamples > 0 && raw.report.shots[1].planner.cuts > 0, 'correct: false = the phase-1 move (inside the wall, rescued by a planner cut)');
  assert.deepEqual(raw.report.shots[1].corrections, []);
  assert.equal(c.call('direct_camera', { take_id: 'nope', directions: dirs }).code, 'take.unknown');
});

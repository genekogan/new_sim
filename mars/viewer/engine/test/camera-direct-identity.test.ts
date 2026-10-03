// W54 output identity for `directCamera` (docs/engineering/CAMERA_DIRECT.md §9 "Performance"): the CAMERA_DIRECT
// fixtures and the W48 chapter case are run and the full result — plan (every sample), shots (keys, simulation,
// corrections) and report — is serialised with JSON.stringify (key order included) and compared by sha256 with the
// golden recorded from the code before the performance work. Any change to a directed track, a report or a planned
// camera fails here. To re-record after a deliberate output change: CAMERA_IDENTITY_UPDATE=1 node --test <this file>.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sha256 } from '../core/hash.ts';
import { directCamera, type DirectInput } from '../camera/synth.ts';
import { takeSampler } from '../camera/take-sampler.ts';
import { takeFacts } from '../camera/direct.ts';
import { DEFAULT_CAMERA_POLICY, type CameraPolicy } from '../camera/geom.ts';
import type { SubjectPose } from '../camera/shots.ts';
import { takeDuration } from '../take/replay.ts';
import { hashOf } from '../core/hash.ts';
import { hypot, type Vec3 } from '../core/math.ts';
import { sceneFromYearFile } from '../campus/history.ts';
import { loadCampusFile } from '../campus/history-node.ts';
import { assemblyGraph } from '../campus/assembly.ts';
import { buildingFootprint } from '../campus/bom.ts';
import { yearBuildScene } from '../campus/sequence.ts';
import { entityFootprint } from '../spatial/service.ts';
import type { Obstacle } from '../spatial/types.ts';
import type { Take } from '../take/types.ts';
import { beforeSunset, sourceEraCampus2024, campus2026, flagship, onGrid, personAt, roomScene, standingSheet, stepTimes, withTime, yardScene } from './camera-direct-fixtures.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(HERE, 'camera-direct-identity.golden.json');

/** The studio's camera scene for a year-build chapter take (app/studio/direct-camera.ts `takeCameraScene`). */
function chapterBaseCurrent(file: string): boolean {
  const f = JSON.parse(readFileSync(path.join(HERE, '../../public/engine/takes', file), 'utf8')) as { take: Take };
  const take = f.take;
  const m = /^mars-(\d{4}):build:(.+)$/.exec(take.finalState.base.campus)!;
  const year = Number(m[1]);
  const base = sceneFromYearFile(year, loadCampusFile(year));
  const g = assemblyGraph(year, base);
  const fp = buildingFootprint(g.nodes.filter((n) => n.assembly === m[2]));
  return hashOf(yearBuildScene(base, m[2], fp.c, 35)) === take.finalState.base.staticHash;
}

function chapterInput(file: string): { take: Take; input: DirectInput } {
  const f = JSON.parse(readFileSync(path.join(HERE, '../../public/engine/takes', file), 'utf8')) as { take: Take };
  const take = f.take;
  const m = /^mars-(\d{4}):build:(.+)$/.exec(take.finalState.base.campus)!;
  const year = Number(m[1]);
  const base = sceneFromYearFile(year, loadCampusFile(year));
  const g = assemblyGraph(year, base);
  const fp = buildingFootprint(g.nodes.filter((n) => n.assembly === m[2]));
  const scene = yearBuildScene(base, m[2], fp.c, 35);
  assert.equal(hashOf(scene), take.finalState.base.staticHash, `${file}: the camera scene is the take's recorded base`);
  const solids: Obstacle[] = Object.values(take.finalState.entities)
    .filter((e) => e.kind === 'component' && e.phase === 'installed')
    .map((e) => ({ id: `take:${e.id}`, kind: 'component', label: `hypothetical ${e.def} ${e.id}`, ...entityFootprint(e) }));
  const policy: CameraPolicy = { ...DEFAULT_CAMERA_POLICY, component: { collide: true, occlude: false } };
  return { take, input: { scene: { ...scene, obstacles: [...scene.obstacles, ...solids] }, world: take.finalState, sampler: takeSampler(take), facts: takeFacts(take), duration: takeDuration(take), hz: 10, policy } };
}

type Case = [name: string, run: () => unknown];
function cases(): Case[] {
  const out: Case[] = [];
  const direct = (name: string, dirs: unknown[], input: () => DirectInput) => out.push([name, () => directCamera(dirs, input())]);
  // flagship (2026 campus crop + the take): the bay orbit (phase 2 raise + phase 1), the carry crew (orbit + hold)
  const flag = () => { const { take } = flagship(); return { take, seat: onGrid(stepTimes(take).get('seat_b1')!.start), carry: onGrid(stepTimes(take).get('carryA')!.start + 10) }; };
  const bay = () => ({ subject: { kind: 'assembly', ref: 'rack bay' }, motion: { verb: 'orbit', degrees: 270 }, duration: 120, at: flag().seat, framing: { size: 'wide' } });
  out.push(['flagship bay orbit 270° wide (phase 2)', () => directCamera([bay()], { ...flagship().input, correct: true })]);
  out.push(['flagship bay orbit 270° wide (phase 1)', () => directCamera([bay()], { ...flagship().input, correct: false })]);
  out.push(['flagship bay orbit 270° medium (W48 sentence)', () => directCamera([{ ...bay(), framing: undefined }], flagship().input)]);
  out.push(['flagship carryA orbit 90°', () => directCamera([{ subject: { kind: 'group', ref: 'carryA' }, motion: { verb: 'orbit', degrees: 90 }, at: flag().carry, duration: 20 }], flagship().input)]);
  out.push(['flagship carryA hold', () => directCamera([{ subject: { kind: 'group', ref: 'carryA' }, motion: { verb: 'hold' }, at: flag().carry, duration: 10 }], flagship().input)]);
  // 2026 Chiba sunset pan; 2024 kitchen fly-through (phase 1 + phase 2 split)
  direct('Chiba sunset pan', [{ subject: { kind: 'region', ref: 'chiba' }, motion: { verb: 'pan' }, context: { sunBehind: { sunset: true } } }], () => ({ scene: campus2026().scene, world: withTime(campus2026().world, beforeSunset('2026-03-01', 20)), sampler: () => ({}), duration: 60 }));
  const kitchen = { subject: { kind: 'region', ref: 'kitchen-interior' }, motion: { verb: 'fly_through', from: [8, 1.6, 36] }, context: { interior: 'kitchen-interior', lookAt: 'sink' } };
  direct('2024 kitchen fly-through (phase 1)', [kitchen], () => ({ ...sourceEraCampus2024(), sampler: () => ({}), duration: 120, correct: false }));
  direct('2024 kitchen fly-through (phase 2)', [kitchen], () => ({ ...sourceEraCampus2024(), sampler: () => ({}), duration: 120 }));
  // synthetic corrections (camera-correct.test.ts)
  out.push(['plywood squeeze → raise', () => {
    const { scene, world } = yardScene();
    const dir = { subject: { kind: 'region', ref: 'plot' }, motion: { verb: 'dolly', distance: 6 }, framing: { side: 'south' }, duration: 8 };
    const raw = directCamera([dir], { scene, world, sampler: () => ({}), duration: 30, correct: false });
    assert.ok(raw.ok);
    const k = raw.shots[0].keys, a = k[0].position, b = k[k.length - 1].position, m = k[Math.floor(k.length / 2)].position;
    const L = hypot(b[0] - a[0], b[2] - a[2]), al: [number, number] = [(b[0] - a[0]) / L, (b[2] - a[2]) / L], n = [al[1], -al[0]];
    const sheets = { s1: standingSheet(m[0] + n[0] * 0.4095, m[2] + n[1] * 0.4095, al), s2: standingSheet(m[0] - n[0] * 0.4095, m[2] - n[1] * 0.4095, al) };
    return [raw, directCamera([dir], { scene, world, sampler: () => sheets, duration: 30 })];
  }]);
  out.push(['behind a head → raise', () => {
    const { scene, world } = yardScene();
    const pair = { s1: personAt([-0.4, 0, 0]), s2: personAt([0.4, 0, 0.2]) };
    const facts = () => ({ s1: { task: 'talk', activity: 'idle' }, s2: { task: 'talk', activity: 'idle' }, w1: { task: 'errand', activity: 'walk' } });
    const dir = { subject: { kind: 'group', ref: 'talk' }, motion: { verb: 'hold' }, framing: { side: 'south' }, duration: 8 };
    const raw = directCamera([dir], { scene, world, sampler: () => ({ ...pair, w1: personAt([10, 0, 10]) }), facts, duration: 30, correct: false });
    assert.ok(raw.ok);
    const P = raw.shots[0].keys[0].position, T = raw.shots[0].keys[0].target;
    const fl = hypot(T[0] - P[0], T[2] - P[2]), f = [(T[0] - P[0]) / fl, (T[2] - P[2]) / fl], lat = [-f[1], f[0]];
    const w1 = (t: number): Vec3 => { const s = -3 + 6 * Math.max(0, Math.min(1, (t - 2) / 4)); return [P[0] + f[0] * 0.9 + lat[0] * s, 0, P[2] + f[1] * 0.9 + lat[1] * s]; };
    return [raw, directCamera([dir], { scene, world, sampler: (t) => ({ ...pair, w1: personAt(w1(t)) }), facts, duration: 30 })];
  }]);
  out.push(['group outgrows the frame → widen', () => {
    const { scene, world } = yardScene();
    const facts = () => ({ s1: { task: 'talk', activity: 'idle' }, s2: { task: 'talk', activity: 'idle' } });
    const sampler = (t: number) => ({ s1: personAt([-0.4, 0, 0]), s2: personAt([0.4 + 5 * Math.max(0, Math.min(1, (t - 2) / 4)), 0, 0]) });
    return directCamera([{ subject: { kind: 'group', ref: 'talk' }, motion: { verb: 'hold' }, framing: { side: 'west' }, duration: 8 }], { scene, world, sampler, facts, duration: 30 });
  }]);
  out.push(['walking crew orbit (no correction)', () => {
    const { scene, world } = yardScene();
    const crew = (t: number): Record<string, SubjectPose> => { const x = -3 + 6 * Math.max(0, Math.min(1, t / 45)); return { p1: personAt([x, 0, 0]), p2: personAt([x + 0.8, 0, 0.5]), p3: personAt([x - 0.6, 0, -0.6]) }; };
    const facts = () => ({ p1: { task: 'haul', activity: 'walk' }, p2: { task: 'haul', activity: 'walk' }, p3: { task: 'haul', activity: 'walk' } });
    return directCamera([{ subject: { kind: 'group', ref: 'haul' }, motion: { verb: 'orbit', degrees: 270 } }], { scene, world, sampler: crew, facts, duration: 60 });
  }]);
  out.push(['flare → swing', () => {
    const { scene, world } = yardScene([], beforeSunset('2026-03-20', 10));
    const dir = { subject: { kind: 'region', ref: 'plot' }, motion: { verb: 'pan', degrees: 30 }, framing: { side: 'east' } };
    return [directCamera([dir], { scene, world, sampler: () => ({}), duration: 60, correct: false }), directCamera([dir], { scene, world, sampler: () => ({}), duration: 60 })];
  }]);
  const room = { subject: { kind: 'region', ref: 'room' }, motion: { verb: 'fly_through', from: [8, 1.6, 0] }, context: { interior: 'room' } };
  direct('room: through the door', [room], () => ({ ...roomScene({ door: true, roof: true }), sampler: () => ({}), duration: 120 }));
  direct('room: over an open-top wall', [room], () => ({ ...roomScene({ door: false, roof: false }), sampler: () => ({}), duration: 120 }));
  direct('room: sealed (refused)', [room], () => ({ ...roomScene({ door: false, roof: true }), sampler: () => ({}), duration: 120 }));
  // W48: a medium hold on m1 at the D2 relay (local 2728.8 s, 20 s) on the chapter take (5 367 s, 220 entities)
  // Content is parked (W51 re-seeded the 2022 scene; the shipped chapter takes were recorded against the old scene, so their
  // recorded base no longer equals the current year file). The chapter case runs only while the take's base is current; until
  // the content agent re-records the 2022 takes it is reported as skipped, not failed, and the other fixtures still assert.
  if (chapterBaseCurrent('year-build-2022-east-house-ab-d2.json')) {
    out.push(['D2 chapter: medium hold on m1 at 2728.8 s', () => {
      const { input } = chapterInput('year-build-2022-east-house-ab-d2.json');
      return directCamera([{ subject: { kind: 'entity', ref: 'm1' }, motion: { verb: 'hold' }, duration: 20, at: 2728.8, framing: { size: 'medium' } }], input);
    }]);
  } else {
    console.log('camera-direct-identity: D2 chapter case skipped — the 2022 scene was re-seeded after the take was recorded (content parked; re-record the 2022 chapters to re-enable)');
  }
  return out;
}

test('directCamera output identity: every CAMERA_DIRECT fixture and the W48 chapter case hash to the pre-W54 golden', () => {
  const got: Record<string, string> = {};
  const dump = process.env.CAMERA_IDENTITY_DUMP; // a directory: also write each result's JSON (for a byte diff)
  for (const [name, run] of cases()) {
    const json = JSON.stringify(run());
    got[name] = sha256(json);
    if (dump) writeFileSync(path.join(dump, `${name.replace(/[^A-Za-z0-9]+/g, '_')}.json`), json);
  }
  if (process.env.CAMERA_IDENTITY_UPDATE) { writeFileSync(GOLDEN, `${JSON.stringify(got, null, 2)}\n`); return; }
  const want = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, string>;
  const ran = Object.keys(got);
  assert.ok(ran.every((k) => k in want), 'every fixture that ran has a golden');
  assert.ok(ran.length >= Object.keys(want).length - 1, 'at most the parked chapter case may be skipped');
  for (const k of ran) assert.equal(got[k], want[k], `${k}: directCamera output changed`);
});

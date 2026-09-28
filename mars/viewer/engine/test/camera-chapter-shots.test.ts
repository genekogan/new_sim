// Event-driven chapter shot lists (W39, engine/camera/chapter-shots.ts).
// 1. the mechanism on a hand-made take: activity grid, cuts at telling steps, no framing of idle people while someone
//    else works, a yard wide every `wideEvery`, contiguous shots on the camera grid, moments, determinism;
// 2. the shipped 2022 A+B chapter takes: every planned camera frames no idle-only group for > 20 s while someone works,
//    shows the yard at least every 6.5 min, holds no frameGroup longer than 90 s, and is 100 % readable with 0 invalid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activityGrid, chapterShots, shotActivityReport, stepActors, type StepTime } from '../camera/chapter-shots.ts';
import type { ShotSpec } from '../camera/shots.ts';
import type { ChangeEvent, PoseSample, Take } from '../take/types.ts';

const DT = 0.05;
const tk = (s: number) => Math.round(s / DT);
/** A take with fixed people (x, z in m) and activity changes [s, id, activity]; nothing else. */
function fakeTake(seconds: number, people: Record<string, [number, number]>, acts: [number, string, string][]): Take {
  const tracks: Record<string, PoseSample[]> = {};
  for (const [id, [x, z]] of Object.entries(people)) tracks[id] = [[0, x * 1000, 0, z * 1000, 0]];
  const changes: ChangeEvent[] = acts.map(([s, id, a]) => [tk(s), id, 'activity', a] as ChangeEvent).sort((p, q) => p[0] - q[0]);
  return { schema: 'mars-take/4', id: 'fake', baselineStateHash: '', rulesVersion: 'test', dt: DT, startTick: 0, ticks: tk(seconds), keyframeEvery: 20, tracks, changes, events: [], finalStateHash: '', finalState: { entities: {} } } as unknown as Take;
}

// a and b raise at the house 0–100 s, then wait; c cuts at the station in the yard 100–300 s; a and b set a wall 300–360 s
const PEOPLE: Record<string, [number, number]> = { a: [0, 0], b: [1, 0], c: [20, 0] };
const ACTS: [number, string, string][] = [
  [0, 'a', 'lift'], [0, 'b', 'lift'], [0, 'c', 'idle'],
  [100, 'a', 'wait'], [100, 'b', 'idle'], [100, 'c', 'cut'],
  [300, 'a', 'set'], [300, 'b', 'set'], [300, 'c', 'idle'],
  [360, 'a', 'idle'], [360, 'b', 'idle'],
];
const STEPS: StepTime[] = [
  { id: 's1', verb: 'raise_upright', start: 0, end: 100, label: 'raise frame (0, 0)' },
  { id: 's2', verb: 'cut', start: 100, end: 300, label: 'cut 2x12 at the station' },
  { id: 's3', verb: 'install_wall', start: 300, end: 360, label: 'raise wall panel p1' },
];
const PLAN = [{ id: 's1', params: { crew: ['a', 'b'] } }, { id: 's2', params: { crew: ['c'] } }, { id: 's3', params: { crew: ['a', 'b'] } }];
const opts = (take: Take) => ({
  take, steps: STEPS, planSteps: PLAN, crew: ['a', 'b', 'c'], what: 'test', hz: 0.5,
  site: { origin: [0, 0] as [number, number], half: [3, 3] as [number, number], yaw: 0, groundY: 0 },
  yard: { min: [-5, -5] as [number, number], max: [25, 5] as [number, number], y: 0 }, yardCentre: [20, 0] as [number, number],
  wideEvery: 120, open: 10, close: 10,
});

test('activityGrid: working vs idle / wait per camera sample, positions', () => {
  const take = fakeTake(400, PEOPLE, ACTS);
  const g = activityGrid(take, ['c', 'a', 'b'], 2);
  assert.deepEqual(g.crew, ['a', 'b', 'c']);
  assert.equal(g.n, 201);
  const on = (id: string, s: number) => g.active[g.crew.indexOf(id)][Math.round(s / 2)];
  assert.equal(on('a', 50), 1);
  assert.equal(on('a', 150), 0, 'wait is not work');
  assert.equal(on('c', 150), 1);
  assert.equal(on('c', 50), 0);
  assert.equal(g.pos[g.crew.indexOf('c')][0], 20);
  assert.deepEqual(stepActors({ crew: ['b', 'a'], x: 'c-1' }, ['a', 'b', 'c']), ['a', 'b']);
});

test('chapterShots: cuts to whoever works, a yard wide every wideEvery, contiguous on the grid, deterministic', () => {
  const take = fakeTake(400, PEOPLE, ACTS);
  const p = chapterShots(opts(take));
  const shots = p.shots.map((s, i, all) => ({ ...s, t0: i ? all[i - 1].t1 : 0 }));
  for (const s of shots) {
    assert.ok(s.t1 > s.t0, `empty shot ${s.label}`);
    assert.equal(Math.round(s.t1 / 2) * 2, s.t1, `${s.label} ends off the 2 s grid`);
  }
  assert.equal(shots[shots.length - 1].t1, 400);
  const at = (t: number) => shots.find((s) => s.t0 <= t && t < s.t1)!;
  const subj = (s: { spec: ShotSpec }) => (s.spec.kind === 'frameGroup' ? s.spec.subjects.join(' ') : s.spec.kind);
  assert.equal(subj(at(40)), 'a b', 'the raise frames its crew');
  assert.equal(subj(at(250)), 'c', 'while a and b wait, the camera is on the cut at the station');
  assert.equal(subj(at(330)), 'a b', 'the wall');
  const r = shotActivityReport(shots, p.grid);
  assert.equal(r.idleStretches, 0);
  assert.ok(r.maxIdleRun <= 12, `idle framing ${r.maxIdleRun} s`);
  assert.ok(r.wides >= 2 && r.maxWideGap <= 120 + 90, JSON.stringify(r));
  assert.ok(shots.some((s) => s.label.includes('wide from the yard')));
  assert.deepEqual(Object.keys(p.moments), ['first raise', 'first cut', 'first wall', 'done']);
  assert.equal(p.moments['first cut'], 106);
  assert.deepEqual(chapterShots(opts(take)).shots, p.shots, 'deterministic');
});

test('chapterShots: rate picks the first readable angle, splits an unreadable window, else frames the one who works', () => {
  const take = fakeTake(400, PEOPLE, ACTS);
  // readable only from 22° up: the first such candidate wins
  
  const p = chapterShots({ ...opts(take), rate: (spec) => {
    if (spec.kind !== 'frameGroup') return 1;

    return spec.subjects.includes('c') || spec.elevation > 0.38 ? 1 : 0.3;
  } });
  const ab = p.shots.filter((s) => s.spec.kind === 'frameGroup' && s.spec.subjects.join(' ') === 'a b');
  assert.ok(ab.length > 0 && ab.every((s) => s.spec.kind === 'frameGroup' && s.spec.elevation > 0.38), 'a steeper angle was chosen');
  // nothing reads the pair: split to 12 s pieces, then the readable one of them who works
  const q = chapterShots({ ...opts(take), rate: (spec) => (spec.kind === 'frameGroup' && spec.subjects.length > 1 ? 0.3 : spec.kind === 'frameGroup' && spec.subjects[0] === 'a' ? 0.9 : 0.2) });
  const pieces = q.shots.map((s, i, all) => ({ ...s, t0: i ? all[i - 1].t1 : 0 })).filter((s) => s.t0 < 100 && s.t1 > 10);
  assert.ok(pieces.length > 1 && pieces.every((s) => s.t1 - s.t0 >= 12 || s.spec.kind === 'establishing'), JSON.stringify(pieces.map((s) => [s.t0, s.t1, s.label])));
  assert.ok(pieces.some((s) => s.spec.kind === 'frameGroup' && s.spec.subjects.join(' ') === 'a'), 'the readable, working one of the pair');
});

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST = join(ROOT, 'public/engine/takes/manifest.json');

test('shipped A+B chapter cameras: no idle framing > 20 s, a yard wide at least every 6.5 min, 100 % readable', { skip: !existsSync(MANIFEST) && 'no manifest' }, () => {
  type Entry = { file: string; kind?: string; chapter?: { id: string }; camera: { readableFraction: number; invalidSamples: number; minReadability: number } };
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { otherYears?: Entry[] };
  const chapters = (m.otherYears ?? []).filter((e) => e.kind === 'year-build-chapter');
  assert.ok(chapters.length >= 7);
  for (const e of chapters) {
    assert.equal(e.camera.readableFraction, 1, `${e.chapter?.id}: readable fraction`);
    assert.equal(e.camera.invalidSamples, 0, `${e.chapter?.id}: invalid samples`);
    assert.ok(e.camera.minReadability >= 0.6, `${e.chapter?.id}: min readability ${e.camera.minReadability}`);
    const f = JSON.parse(readFileSync(join(ROOT, 'public', e.file), 'utf8')) as { take: Take; camera: { data: { shots: { t0: number; t1: number; spec: ShotSpec }[] } } };
    const crew = Object.entries(f.take.entities0 ?? {}).filter(([, x]) => x.kind === 'human').map(([id]) => id);
    const r = shotActivityReport(f.camera.data.shots, activityGrid(f.take, crew, 2));
    assert.equal(r.idleStretches, 0, `${e.chapter?.id}: ${JSON.stringify(r)}`);
    assert.ok(r.maxIdleRun <= 20, `${e.chapter?.id}: ${JSON.stringify(r)}`);
    assert.ok(r.maxWideGap <= 390, `${e.chapter?.id}: ${JSON.stringify(r)}`);
    assert.ok(r.maxShot <= 90, `${e.chapter?.id}: ${JSON.stringify(r)}`);
  }
});

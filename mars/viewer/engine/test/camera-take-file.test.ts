// The camera's view of a recorded take file (W23): the take sampler classifies entities by kind from the final state
// or entities0 (mars-take/4) — a pile is a box, never a person, and an emptied pile disappears at its removal tick —
// and a take file carries extra named camera tracks (`cameras`, e.g. a directed one) beside its planned `camera`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { hashOf } from '../core/hash.ts';
import { takeSampler } from '../camera/take-sampler.ts';
import { directCamera } from '../camera/synth.ts';
import { fileCamera, fileCameras, sampleTrack, toCameraTrack, trackData, withFileCamera, type TakeFileWithCameras } from '../camera/track.ts';
import type { CameraTrack, Take } from '../take/types.ts';
import { flagship, onGrid, stepTimes } from './camera-direct-fixtures.ts';

const TAKES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/engine/takes');
const readFile = (f: string) => JSON.parse(readFileSync(path.join(TAKES, f), 'utf8')) as TakeFileWithCameras & { take: Take };

test('takeSampler: piles are boxes (kind from finalState / entities0), the emptied pile leaves at its removal tick; legacyKinds reproduces the old people-piles', () => {
  const take = readFile('year-build-2022-east-house-bay1.json').take;
  const gone = take.removed!.find((r) => r.id === 'pile-upright-16ft-kit-1')!;
  assert.ok(gone && !take.finalState.entities[gone.id], 'the emptied pile is absent from the final state');
  assert.equal(take.entities0![gone.id].kind, 'fixture');
  const s = takeSampler(take), legacy = takeSampler(take, { legacyKinds: true });
  const piles = Object.keys(take.tracks).filter((id) => (take.finalState.entities[id] ?? take.entities0![id]).kind === 'fixture');
  assert.equal(piles.length, 10, 'nine piles and the cutting station');
  for (const tick of [0, gone.t - 1, gone.t, take.ticks]) {
    const now = s(tick * take.dt), old = legacy(tick * take.dt);
    for (const id of piles) {
      if (id === gone.id && tick >= gone.t) { assert.equal(now[id], undefined, `${id} dropped at its removal tick ${gone.t}`); continue; }
      assert.equal(now[id].kind, 'component', `${id} at ${tick}: a box, not a person`);
      assert.equal(now[id].occluders?.length, 1, `${id}: one sight-blocking box`);
      assert.ok((now[id].points?.length ?? 0) === 9, 'centre + 8 corners');
      assert.equal(old[id]?.kind, 'human', 'legacy: every pile was a person');
    }
    // people and parts are unchanged
    for (const id of Object.keys(now)) if (!piles.includes(id)) assert.deepEqual(now[id], old[id], `${id} at ${tick}`);
  }
});

test('takeSampler: the flagship has no piles — identical with and without legacyKinds, so its planned camera is unchanged', () => {
  const take = readFile('flagship-campus-2026.json').take;
  const s = takeSampler(take), legacy = takeSampler(take, { legacyKinds: true });
  for (let t = 0; t <= take.ticks * take.dt; t += 7.3) assert.deepEqual(s(t), legacy(t), `t=${t}`);
});

test('take file: a directed track is carried beside the planned camera (`cameras`), round-trips through JSON, never changes the take; foreign / clashing tracks are refused', () => {
  const file = readFile('flagship-campus-2026.json');
  const takeHash = hashOf(file.take);
  assert.deepEqual(fileCameras(file).map((c) => c.id), [file.camera.id], 'as recorded: the planned camera only');
  const { take, input } = flagship();
  const at = onGrid(stepTimes(take).get('carryA')!.start + 10);
  const r = directCamera([{ subject: { kind: 'group', ref: 'carryA' }, motion: { verb: 'orbit', degrees: 90 }, at, duration: 20 }], input);
  assert.ok(r.ok);
  const track: CameraTrack = toCameraTrack(`dir-${r.report.trackHash.slice(0, 16)}`, file.take.id, r.plan, 'directed');
  const withDir = JSON.parse(JSON.stringify(withFileCamera(file, track))) as typeof file;
  assert.deepEqual(fileCameras(withDir).map((c) => [c.id, c.kind]), [[file.camera.id, 'planned-shot-list'], [track.id, 'directed']]);
  assert.equal(hashOf(withDir.take), takeHash, 'the take is untouched');
  assert.deepEqual(withDir.camera, file.camera, 'the planned camera is untouched');
  const back = trackData(fileCamera(withDir, track.id)!);
  for (const t of [at, at + 7.5, at + 20]) assert.deepEqual(sampleTrack(back, t), sampleTrack(trackData(track), t), `pose at ${t}`);
  // re-adding the same id replaces it; a second track sorts in by id
  const again = withFileCamera(withFileCamera(withDir, track), { ...track, id: 'dir-0' });
  assert.deepEqual(Object.keys(again.cameras!), ['dir-0', track.id]);
  // refusals
  assert.throws(() => withFileCamera(file, { ...track, takeId: 'another-take' }), /belongs to take another-take/);
  assert.throws(() => withFileCamera(file, { ...track, id: file.camera.id }), /planned camera/);
  assert.throws(() => withFileCamera(file, { ...track, data: { schema: 'nope' } }), /not a mars-camera-track\/1 track/);
  assert.throws(() => fileCameras({ ...withDir, cameras: { 'dir-x': track } }), /stored under dir-x/);
});

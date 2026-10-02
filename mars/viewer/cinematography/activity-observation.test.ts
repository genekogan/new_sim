import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivityObserver } from './activity-observation.ts';
import type { CameraEntity, CameraActivityFact } from './activity-observation.ts';
import { Director } from './director.ts';
import { poseValid } from './physical.ts';
import type { SpatialScene } from '../engine/spatial/types.ts';

const scene: SpatialScene = { bounds: [-30, -30, 30, 30], levels: [], surfaces: [], obstacles: [], links: [] };
const entities: CameraEntity[] = [
  { id: 'editor-new', kind: 'human', pose: { p: [0, 0, 0], yaw: 0 }, human: { activity: 'idle' } },
  { id: 'reviewer-new', kind: 'human', pose: { p: [2, 0, 0], yaw: 0 }, human: { activity: 'idle' } },
  { id: 'pot-new', kind: 'item', pose: { p: [1, .8, 1], yaw: 0 }, corners: [[.8, .8, .8], [1.2, 1.1, 1.2]] },
];
const fact: CameraActivityFact = { id: 'purpose-1', actors: ['editor-new', 'reviewer-new'], focus: 'editor-new', objects: ['pot-new'], phase: 'preparing-food', mode: 'running', status: 'executing', purpose: 'same project notes' };
function observer() { const o = new ActivityObserver(); o.reset('test'); return o; }

void test('actual unknown actors and item targets appear without changing detached inputs', () => {
  const before = JSON.stringify([entities, fact, scene]);
  const o = observer().read(entities, [fact], 1, .05, scene);
  assert.deepEqual(Object.keys(o.subjects), ['editor-new', 'pot-new', 'reviewer-new']);
  assert.equal(o.activity.display, 'pot-new');
  assert.equal(o.activity.focus, 'editor-new');
  assert.equal(o.activity.phase, 'working');
  o.subjects['editor-new'].p[0] = 200;
  assert.equal(JSON.stringify([entities, fact, scene]), before);
});
void test('progress/movement/paused render frames do not churn semantics; interruption and purpose do', () => {
  const r = observer(), first = r.read(entities, [fact], 1, .05, scene);
  const moved = structuredClone(entities); moved[0].pose.p[0] = .4;
  assert.equal(r.read(moved, [fact], 500, 25, scene).semanticVersion, first.semanticVersion);
  const paused = { ...fact, mode: 'paused' };
  const v = r.read(moved, [paused], 500, 25, scene).semanticVersion;
  assert.equal(v, first.semanticVersion + 1);
  assert.equal(r.read(moved, [paused], 500, 25, scene).semanticVersion, v);
  assert.equal(r.read(moved, [{ ...paused, purpose: 'another project' }], 500, 25, scene).semanticVersion, v + 1);
});
void test('floor, companion walking and wait edges use current authoritative identities', () => {
  const r = observer();
  const question = { ...fact, id: 'question', phase: 'question', focus: 'reviewer-new' };
  assert.equal(r.read(entities, [fact, question], 1, .05, scene).activity.focus, 'reviewer-new');
  assert.equal(r.read(entities, [{ ...fact, phase: 'walk-to-lunch' }], 2, .1, scene).activity.phase, 'walking');
  const wait = { ...fact, id: 'waiting', focus: 'editor-new', waitingReason: 'computer occupied', mode: 'waiting' };
  assert.equal(r.read(entities, [question, wait], 3, .15, scene).activity.focus, 'editor-new');
});
void test('sleep framing observes authored mat corners rather than standing head points', () => {
  const q = structuredClone(entities);q[0].human!.sleepPose = { mat: 'mat-new', standingFraction: 0 };
  const corners = [[-1.6, 0, -.7], [1.6, .02, .7]];
  q.push({ id: 'mat-new', kind: 'region', pose: { p: [0, 0, 0], yaw: 0 }, corners });
  const o = observer().read(q, [{ ...fact, phase: 'sleeping', objects: ['mat-new'] }], 1, .05, scene);
  assert.deepEqual(o.subjects['editor-new'].points, [...corners, [0, 0, 0]]);
  assert.equal(o.activity.display, 'mat-new');
});
void test('current Clear and Restrained decisions are deterministic and finite across the same day', () => {
  for (const policy of ['clear', 'restrained'] as const) {
    const run = () => {
      const o = observer(), d = new Director(policy);d.reset('test');
      for (let tick = 1; tick <= 240; tick += 2) {
        const f = tick < 80 ? { ...fact, phase: 'walk-to-lunch' } : tick < 160 ? fact : { ...fact, phase: 'finish-work', objects: [] };
        const result = d.update(o.read(entities, [f], tick, tick / 20, scene));
        assert(result.pose && poseValid(result.pose));
      }
      return d.decisions;
    };
    assert.deepEqual(run(), run());
  }
});
void test('manual pose wins during the existing six simulation seconds and explicit release returns to auto', () => {
  const o = observer(), d = new Director('clear');d.reset('test');
  const manual = { position: [-8, 5, 8] as [number, number, number], target: [0, 1, 0] as [number, number, number], fov: 50 };
  d.takeover({ pose: manual, movement: 'still', expires: 6 });
  assert.deepEqual(d.update(o.read(entities, [fact], 0, 0, scene)).pose, manual);
  assert.deepEqual(d.update(o.read(entities, [{ ...fact, phase: 'question' }], 0, 0, scene)).pose, manual);
  assert.deepEqual(d.update(o.read(entities, [fact], 119, 5.95, scene)).pose, manual);
  d.release();
  assert.equal(d.operator, undefined);
  assert(d.update(o.read(entities, [fact], 119, 5.95, scene)).pose);
  d.takeover({ pose: manual, movement: 'still', expires: 6 });
  d.update(o.read(entities, [fact], 120, 6, scene));
  assert.equal(d.operator, undefined);
});

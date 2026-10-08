import test from 'node:test';
import assert from 'node:assert/strict';
import { attachLabCamera } from './lab-driver.ts';
import { classroomWorld } from '../engine/scenarios/classroom.ts';

function liveHook() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let handle = 0, wall = 0, paused = false;
  const listeners = new Map<string, (e: unknown) => void>();
  const canvas = { width: 1280, height: 800, addEventListener() {}, removeEventListener() {} };
  const viewWindow = {
    requestAnimationFrame(callback: FrameRequestCallback) { callbacks.set(++handle, callback); return handle; },
    cancelAnimationFrame(id: number) { callbacks.delete(id); },
    addEventListener(name: string, callback: (e: unknown) => void) { listeners.set(name, callback); },
    removeEventListener(name: string) { listeners.delete(name); },
  };
  const doc = {
    defaultView: viewWindow,
    createElement: () => ({ style: {}, textContent: '', remove() {} }),
    body: { appendChild() {} },
    querySelector: () => canvas,
  };
  const applied: { wall: number; p: number[]; target: number[] }[] = [];
  const ids = Object.values(classroomWorld().entities).filter(e => e.kind === 'human').map(e => e.id);
  let pose = { position: [0, 5, 10], target: [0, 1, 0], fov: 45 };
  const hook = {
    state: () => ({ scenario: 'classroom-4', tick: Math.floor(wall / 50), time: Math.floor(wall / 50) * 0.05, paused,
      humans: ids.map((id, i) => ({ id, p: id === 'guest1' ? [Math.floor(wall / 50) * .04, 0, 0] : [-15 + i * 3, 0, 12], yaw: 0, activity: id === 'guest1' ? 'walk' : 'idle' })) }),
    cameraGeometry: () => ({ epoch: 1, scene: { bounds: [-20,-20,20,20], levels: [], surfaces: [], obstacles: [], links: [] } }),
    classroom: () => ({ session: { phase: 'walking', floorHolder: 'guest1', attentionTarget: { actor: 'guest1' }, participants: [{ actor: 'guest1', state: 'participating' }] } }),
    cameraPose: () => pose,
    camera(p: number[], target: number[], fov = 45) {
      pose = { position: [...p], target: [...target], fov };
      applied.push({ wall, p: [...p], target: [...target] });
    },
  };
  const controller = attachLabCamera(hook as never, 'continuous', undefined, { document: doc as unknown as Document });
  return {
    applied, controller,
    pause() { paused = true; },
    frame(at: number) {
      wall = at;
      const [id, callback] = callbacks.entries().next().value!;
      callbacks.delete(id);
      callback(wall);
    },
    pending: () => callbacks.size,
  };
}

void test('live Lab camera applies a safe pose on every display frame, including repeated engine ticks', () => {
  const run = liveHook();
  try {
    for (let i = 0; i < 61; i++) run.frame(i * 1000 / 60);
    assert.equal(run.applied.length, 61, 'camera must not hold for a 90ms wall gate or repeated 20Hz tick');
    assert.ok(run.applied.every(x => [...x.p, ...x.target].every(Number.isFinite)));
    assert.notDeepEqual(run.applied[4].p, run.applied[3].p, 'camera advances between repeated causal ticks, rather than reapplying a held pose');
  } finally { run.controller.dispose(); }
  assert.equal(run.pending(), 0);
});

void test('unchanged paused Lab view stays still; explicit release refreshes without advancing the world', () => {
  const run = liveHook();
  try {
    run.pause();
    run.frame(0);
    for (let i = 1; i < 8; i++) run.frame(i); // same paused tick
    assert.equal(run.applied.length, 1);
    run.controller.release();
    run.frame(9);
    assert.equal(run.applied.length, 2);
  } finally { run.controller.dispose(); }
});

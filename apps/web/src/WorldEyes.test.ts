import test from 'node:test'; import assert from 'node:assert/strict';
import {WorldEyes, eyesIdleMs, IDLE_MS} from './WorldEyes.ts';
// lane soul-eyes-on: between jobs the eyes page asks for no animation frames (render on demand, idle CPU ~0)
test('eyes mode sleeps between jobs and a job wakes it at once', async () => {
  const g = globalThis as unknown as {requestAnimationFrame: (cb: FrameRequestCallback) => number; window: unknown};
  let rafs = 0; g.requestAnimationFrame = cb => {rafs++; setTimeout(() => cb(0), 0); return rafs;}; g.window = {};
  const host = {renderer: {setPixelRatio() {}}, ready: () => true} as never;
  const eyes = new WorldEyes(host, 60_000), frames: number[] = [];
  const next = (cb: FrameRequestCallback) => requestAnimationFrame(cb);
  eyes.schedule(() => frames.push(1), next);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(rafs, 0, 'no frame while idle'); assert.equal(frames.length, 0);
  (eyes as unknown as {compiled: Promise<unknown>}).compiled = Promise.resolve();
  void (window as unknown as {edenEyes: {capture(j: unknown): Promise<unknown>}}).edenEyes.capture({});
  await new Promise(r => setTimeout(r, 30));
  assert.equal(rafs, 1, 'the job woke the sleeping loop'); assert.equal(frames.length, 1);
  eyes.dispose();
  assert.equal(eyesIdleMs('?eyes=1'), IDLE_MS); assert.equal(eyesIdleMs('?eyes=1&eyesIdle=250'), 250); assert.equal(eyesIdleMs('?eyesIdle=5'), IDLE_MS);
});

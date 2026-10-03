import test from 'node:test';
import assert from 'node:assert/strict';
import { compileInWorker } from '../../app/studio/direct-camera-client.ts';
import { compileTakeCamera, cameraWorkerFailure, DIRECT_POLICY, type CameraCompileJob } from '../../app/studio/direct-camera-compile.ts';
import { directCamera } from '../camera/synth.ts';
import { takeFacts } from '../camera/direct.ts';
import { takeSampler } from '../camera/take-sampler.ts';
import { takeDuration } from '../take/replay.ts';
import { loadCampusYear } from '../campus/history.ts';
import { sourceEra2024File } from './camera-source-era-fixture.ts';
import { kitchenCameraFile } from './camera-studio-fixtures.ts';

class FakeWorker {
  onmessage: Worker['onmessage'] = null;
  onerror: Worker['onerror'] = null;
  onmessageerror: Worker['onmessageerror'] = null;
  stopped = 0;
  sent = 0;
  postMessage() { this.sent++; }
  terminate() { this.stopped++; }
  reply(data: unknown) { this.onmessage?.call({} as Worker, new MessageEvent('message', { data })); }
}
const job = { take: { id: 'test-take' } } as CameraCompileJob;
const reply = cameraWorkerFailure('test-take', 'camera.direct.unknown', 'intentional test refusal');
const code = (r: Awaited<ReturnType<typeof compileInWorker>>) => !r.result.ok && r.result.diagnostics[0].code;

test('source-era camera worker kernel preserves the complete synchronous result and reads inputs only', () => {
  const file = kitchenCameraFile();
  const { base: scene } = loadCampusYear(2024, sourceEra2024File());
  const directions = [{ subject: { kind: 'fixture', ref: 'sink' }, motion: { verb: 'hold' } }];
  const before = JSON.stringify({ file, scene, directions });
  const got = compileTakeCamera({ take: file.take, scene, directions, opts: {} });
  const want = directCamera(directions, { scene, world: file.take.finalState, sampler: takeSampler(file.take), facts: takeFacts(file.take), duration: takeDuration(file.take), hz: 10, policy: DIRECT_POLICY });
  assert.deepEqual(got.result, want);
  assert.equal(JSON.stringify({ file, scene, directions }), before);
  assert.ok(got.track);
});

test('worker completion terminates once, detaches callbacks, and removes abort handling', async () => {
  const w = new FakeWorker(), abort = new AbortController();
  const pending = compileInWorker(job, abort.signal, () => w);
  assert.equal(w.sent, 1);
  w.reply({ type: 'started' });
  assert.equal(w.stopped, 0);
  w.reply({ type: 'result', compiled: reply });
  assert.deepEqual(await pending, reply);
  abort.abort();
  assert.equal(w.stopped, 1);
  assert.equal(w.onmessage, null);
  assert.equal(w.onerror, null);
  assert.equal(w.onmessageerror, null);
});

test('worker abort before start, while pending, and during construction has bounded cleanup', async () => {
  const already = new AbortController(); already.abort();
  let created = 0;
  assert.equal(code(await compileInWorker(job, already.signal, () => { created++; return new FakeWorker(); })), 'camera.worker.cancelled');
  assert.equal(created, 0);
  for (const duringCreation of [false, true]) {
    const abort = new AbortController(), w = new FakeWorker();
    const pending = compileInWorker(job, abort.signal, () => { if (duringCreation) abort.abort(); return w; });
    abort.abort();
    assert.equal(code(await pending), 'camera.worker.cancelled');
    assert.equal(w.stopped, 1);
  }
});

test('creation, delivery, runtime, decoding and malformed-reply failures are named diagnostics', async () => {
  assert.equal(code(await compileInWorker(job, undefined, () => { throw new Error('blocked'); })), 'camera.worker.unavailable');
  const send = new FakeWorker(); send.postMessage = () => { throw new Error('not clonable'); };
  assert.equal(code(await compileInWorker(job, undefined, () => send)), 'camera.worker.message');
  assert.equal(send.stopped, 1);
  for (const failure of ['runtime', 'decode', 'reply'] as const) {
    const w = new FakeWorker(), pending = compileInWorker(job, undefined, () => w);
    if (failure === 'runtime') w.onerror?.call({} as Worker, { message: 'crash', preventDefault() {} } as ErrorEvent);
    else if (failure === 'decode') w.onmessageerror?.call({} as Worker, new MessageEvent('messageerror'));
    else w.reply({ invalid: true });
    assert.equal(code(await pending), failure === 'runtime' ? 'camera.worker.error' : failure === 'decode' ? 'camera.worker.message' : 'camera.worker.protocol');
    assert.equal(w.stopped, 1);
  }
});

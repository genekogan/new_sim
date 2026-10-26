// Execute the real browser-worker handler in a Node worker: its bridge uses native structured
// clone and transfer, and reports detached buffers after posting the result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { on } from 'node:events';
import { Worker } from 'node:worker_threads';
import { buildingLayout } from '../../../../packages/generators/src/building.ts';
import { buildingBuffers, type BuildingJob } from './building-buffers.ts';

test('building worker imports only geometry, transfers its result, and returns null on failure', { timeout: 30_000 }, async (t) => {
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    globalThis.self = {
      postMessage(message, transfer = []) {
        parentPort.postMessage({ kind: 'reply', message }, transfer);
        parentPort.postMessage({ kind: 'detached', lengths: transfer.map(b => b.byteLength) });
      }
    };
    (async () => {
      await import(${JSON.stringify(new URL('./building.worker.ts', import.meta.url).href)});
      const { registeredMeshes } = await import(${JSON.stringify(new URL('./registry.ts', import.meta.url).href)});
      parentPort.postMessage({ kind: 'ready', registered: registeredMeshes() });
      parentPort.on('message', data => self.onmessage({ data }));
    })().catch(error => { throw error; });
  `, { eval: true });
  const messages = on(worker, 'message');
  t.after(async () => { await messages.return?.(); await worker.terminate(); });
  const next = async () => (await messages.next()).value![0];
  assert.deepEqual(await next(), { kind: 'ready', registered: [] }, 'worker must not register page meshes');
  const variants: BuildingJob['params'][] = [
    { floors: 1, w: 8, d: 6 },
    { floors: 3, w: 16, d: 12, material: 'brick', front: 'e', roof: 'hip' },
    { style: 'lighthouse', floors: 3, roof: 'dome' },
  ];
  for (const [id, params] of variants.entries()) {
    const job: BuildingJob = { L: buildingLayout(params), params, paint: '#abc123', presetTrim: '#6b4a2b', seed: id * 12345 };
    const expected = buildingBuffers(job);
    worker.postMessage({ id, job });
    assert.deepEqual(await next(), { kind: 'reply', message: { id, out: expected } });
    assert.deepEqual(await next(), { kind: 'detached', lengths: expected.raw.flatMap(() => [0, 0, 0]) });
  }
  worker.postMessage({ id: 123, job: null });
  assert.deepEqual(await next(), { kind: 'reply', message: { id: 123, out: null } });
  assert.deepEqual(await next(), { kind: 'detached', lengths: [] });
  // A failed job leaves the handler available for the page's subsequent jobs.
  const job: BuildingJob = { L: buildingLayout({}), params: {}, paint: '#f1e7d2', presetTrim: null, seed: 42 };
  worker.postMessage({ id: 124, job });
  const expected = buildingBuffers(job);
  assert.deepEqual(await next(), { kind: 'reply', message: { id: 124, out: expected } });
  assert.deepEqual(await next(), { kind: 'detached', lengths: expected.raw.flatMap(() => [0, 0, 0]) });
});

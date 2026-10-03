// Current museum coverage is separate from byte-frozen source-era camera goldens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCampusFile } from '../campus/history-node.ts';
import { loadCampusYear } from '../campus/history.ts';
import { Runtime } from '../runtime/runtime.ts';
import { TakeRecorder } from '../take/recorder.ts';
import { parseForTake, directForTake, takeCameraScene } from '../../app/studio/direct-camera.ts';
import { compileTakeCamera } from '../../app/studio/direct-camera-compile.ts';
import type { TakeReplayFile } from '../../app/engine-view/take-replay.ts';

test('current-source file and worker refuse missing sink and resolve actual counter without world/source mutation', async (t) => {
  const source = loadCampusFile(2024);
  t.mock.method(globalThis, 'fetch', async () => Response.json(source));
  const { base: scene, world } = loadCampusYear(2024, source);
  const runtime = new Runtime(world, new Map(), {});
  const recorder = new TakeRecorder(runtime, { rulesVersion: 'current-source-camera-contract' });
  for (let i = 0; i < 120; i++) runtime.step();
  const take = recorder.finish();
  const file: TakeReplayFile = { schema: 'mars-take-replay/1', label: 'Current museum camera contract', hypothetical: true, note: 'Action-free test; no historical activity claim', campus: 'mars-2024', steps: [], moments: {}, take,
    // Required file payload only; this inert test track is never played or claimed as a physical camera result.
    camera: { id: 'unused-test-payload', takeId: take.id, kind: 'test', data: { schema: 'mars-camera-track/1', duration: 0, hz: 10, samples: [{ t: 0, position: [0, 2, 0], target: [0, 2, -1], fov: 50 }] } } };
  const before = JSON.stringify({ source, file });
  const missing = await parseForTake(file, 'go inside the kitchen and face the sink');
  assert.equal(missing.directions.length, 0);
  assert.equal(missing.refusals[0].code, 'camera.direct.unknown');
  assert.match(missing.refusals[0].message, /no fixture named 'sink'/);
  const id = 'chiba-kitchen-kitchen-counter-f36f13fb';
  const parsed = await parseForTake(file, `hold on ${id}`);
  assert.deepEqual(parsed.refusals, []);
  assert.equal(parsed.directions[0].subject.id, id);
  const directions = parsed.directions.map(d => d.direction);
  const compiled = await directForTake(file, directions);
  assert.ok(!compiled.result.ok);
  if (!compiled.result.ok) {
    assert.equal(compiled.result.diagnostics[0].code, 'camera.direct.uncorrectable');
    assert.match(compiled.result.diagnostics[0].message, /occluded/);
    // Finished occupied geometry now exposes the retained plywood frontage as the occluder.
    assert.deepEqual(compiled.result.diagnostics[0].subjects,['chiba-plywood-wall-853f6846','chiba-plywood-wall-853f6846.up']);
    assert.ok(compiled.result.diagnostics[0].subjects.every(subject=>scene.obstacles.some(o=>o.id===subject)));
  }
  assert.equal(compiled.track, undefined, 'physical refusal does not create a fictitious valid track');
  const worker = compileTakeCamera({ take, scene, directions, opts: {} });
  assert.deepEqual(worker.result, compiled.result);
  const refusal = compileTakeCamera({ take, scene, directions: [{ subject: { kind: 'fixture', ref: 'sink' }, motion: { verb: 'hold' } }], opts: {} });
  assert.ok(!refusal.result.ok);
  if (!refusal.result.ok) {
    assert.equal(refusal.result.diagnostics[0].code, 'camera.direct.unknown');
    assert.match(refusal.result.diagnostics[0].message, /no fixture named 'sink'/);
  }
  const loaded = await takeCameraScene(file);
  assert.ok(loaded.scene.obstacles.some(o => o.id === id));
  assert.equal(JSON.stringify({ source, file }), before);
});

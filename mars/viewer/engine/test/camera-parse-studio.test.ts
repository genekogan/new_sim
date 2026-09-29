import test from 'node:test';
import assert from 'node:assert/strict';
import { parseForTake, directForTake, takeCameraScene } from '../../app/studio/direct-camera.ts';
import { loadCampusFile } from '../campus/history-node.ts';
import { activitiesOf, cameraVocab, parseCameraSentences } from '../api/camera-vocab.ts';
import { SemanticWorld, takeFacts } from '../camera/direct.ts';
import { splitCameraSentences } from '../camera/parse.ts';
import { kitchenCameraFile } from './camera-studio-fixtures.ts';

test('studio file sentences use the op parser, vocabulary and resolver without a simulation room', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json(loadCampusFile(2024)));
  const file = kitchenCameraFile();
  const before = JSON.stringify(file);
  const text = 'hold on the sink then zoom in';
  const parsed = await parseForTake(file, text);
  const { scene } = await takeCameraScene(file);
  const semantic = new SemanticWorld(scene, file.take.finalState, takeFacts(file.take));
  assert.deepEqual(parsed, parseCameraSentences(semantic, splitCameraSentences(text), cameraVocab(semantic, activitiesOf(file.take.finalState, file.take))));
  assert.equal(parsed.directions[0].direction.subject.kind, 'fixture');
  assert.equal(parsed.refusals[0].code, 'camera.parse.unknown-verb');
  assert.equal(parsed.refusals[0].index, 1);
  assert.equal((await parseForTake(file, 'then')).refusals[0].code, 'camera.parse.missing');
  const valid = await parseForTake(file, 'hold on the sink');
  const compiled = await directForTake(file, valid.directions.map((d) => d.direction));
  assert.ok(compiled.result.ok);
  assert.equal(JSON.stringify(file), before);
});

test('file camera scene and vocabulary reflect checkpoint obstacle edits without changing the shared source', async (t) => {
  const source = loadCampusFile(2024);
  const before = JSON.stringify(source);
  t.mock.method(globalThis, 'fetch', async () => Response.json(source));
  const file = kitchenCameraFile();
  const original = await takeCameraScene(file);
  const sink = original.scene.obstacles.filter((o) => /sink/i.test(o.label ?? ''));
  assert.ok(sink.length > 0);
  file.take.finalState.obstacleEdits = Object.fromEntries(sink.map((o) => [o.id, null]));
  file.take.finalState.obstacleEdits['test-basin'] = { id: 'test-basin', kind: 'solid', label: 'test basin', obb: { c: [0, 0], half: [0.5, 0.5], yaw: 0 }, y0: 0, y1: 1 };
  const edited = await takeCameraScene(file);
  assert.ok(sink.every((o) => !edited.scene.obstacles.some((s) => s.id === o.id)));
  assert.ok(edited.scene.obstacles.some((o) => o.id === 'test-basin'));
  const parsed = await parseForTake(file, 'hold on the test basin');
  assert.deepEqual(parsed.refusals, []);
  assert.equal(parsed.directions[0].subject.id, 'test-basin');
  const gone = await parseForTake(file, 'hold on the sink');
  assert.equal(gone.directions.length, 0);
  assert.equal(gone.refusals[0].code, 'camera.parse.ambiguous');
  assert.equal(JSON.stringify(source), before);
});

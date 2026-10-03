import test from 'node:test';
import assert from 'node:assert/strict';
import { SemanticWorld, cameraDirectionSchema, resolveSubject, type CameraDirection } from '../camera/direct.ts';
import { parseSentence } from '../camera/parse.ts';
import { directCamera } from '../camera/synth.ts';
import { cameraVocab, parseCameraSentences } from '../api/camera-vocab.ts';
import { emptyWorld } from '../world/factory.ts';
import type { SpatialScene } from '../spatial/types.ts';

function fixtureScene(secondSink = false) {
  const scene: SpatialScene = {
    bounds: [-20, -20, 20, 20], levels: [{ id: 0, y: 0, label: 'ground' }],
    surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [20, 20], yaw: 0 } }], links: [],
    obstacles: [
      { id: 'sink-bowl', label: 'sink bowl', kind: 'solid', obb: { c: [0, 0], half: [0.5, 0.5], yaw: 0 }, y0: 0, y1: 1 },
      { id: 'sink-rim', label: 'sink rim', kind: 'solid', obb: { c: [1, 0], half: [0.5, 0.5], yaw: 0 }, y0: 0, y1: 1 },
      ...(secondSink ? [{ id: 'second-sink', label: 'sink', kind: 'solid' as const, obb: { c: [10, 0] as [number, number], half: [0.5, 0.5] as [number, number], yaw: 0 }, y0: 0, y1: 1 }] : []),
    ],
  };
  // Deliberately share the label when testing separated physical sinks; exact unique labels win otherwise.
  if (secondSink) scene.obstacles.forEach((o) => { o.label = 'sink'; });
  return { scene, world: emptyWorld('camera-fixture-test', scene) };
}

test('LM-009: sink vocabulary parses a fixture subject and respects cross-kind ambiguity', () => {
  const parsed = parseSentence('hold on the sink', { fixtures: ['sink'] });
  assert.deepEqual(parsed, { ok: true, direction: { subject: { kind: 'fixture', ref: 'sink' }, motion: { verb: 'hold' } }, notes: [] });
  assert.ok(parsed.ok);
  assert.deepEqual(cameraDirectionSchema.parse(parsed.direction), parsed.direction);
  assert.deepEqual(parseSentence('hold on the Sink', { fixtures: ['sink bowl', 'sink rim'] }), parsed);
  const ambiguous = parseSentence('hold on the sink', { fixtures: ['sink'], regions: ['sink'] });
  assert.ok(!ambiguous.ok);
  assert.equal(ambiguous.refusal.code, 'camera.parse.ambiguous');
  assert.deepEqual(ambiguous.refusal.candidates, ['fixture:sink', 'region:sink']);
});

test('LM-009: sentence fixture cluster compiles identically to typed direction without mutating world', () => {
  const { scene, world } = fixtureScene();
  const before = JSON.stringify({ scene, world });
  const sw = new SemanticWorld(scene, world);
  const parsed = parseCameraSentences(sw, ['hold on the sink'], cameraVocab(sw, []));
  assert.deepEqual(parsed.refusals, []);
  assert.equal(parsed.directions[0].subject.kind, 'fixture');
  const direction: CameraDirection = { subject: { kind: 'fixture', ref: 'sink' }, motion: { verb: 'hold' } };
  assert.deepEqual(parsed.directions[0].direction, direction);
  const resolved = resolveSubject(sw, direction.subject, 0);
  assert.ok(resolved.ok);
  assert.equal(resolved.subject.dynamic, false);
  assert.deepEqual(resolved.subject.members, ['sink-bowl', 'sink-rim']);
  const input = { scene, world, sampler: () => ({}), duration: 30 };
  const typed = directCamera([direction], input);
  assert.ok(typed.ok, JSON.stringify(typed));
  assert.deepEqual(directCamera(parsed.directions.map((d) => d.direction), input), typed);
  assert.equal(JSON.stringify({ scene, world }), before);
});

test('LM-009: separate sinks and unknown fixtures refuse with concrete diagnostic evidence', () => {
  const { scene, world } = fixtureScene(true);
  const sw = new SemanticWorld(scene, world);
  const ambiguous = parseCameraSentences(sw, ['hold on the sink'], cameraVocab(sw, []));
  assert.equal(ambiguous.directions.length, 0);
  assert.equal(ambiguous.refusals[0].code, 'camera.direct.ambiguous');
  assert.deepEqual(ambiguous.refusals[0].candidates, ['second-sink', 'sink-bowl']);
  assert.match(ambiguous.refusals[0].question ?? '', /Which fixture/);
  const missing = directCamera([{ subject: { kind: 'fixture', ref: 'missing-basin' }, motion: { verb: 'hold' } }], { scene, world, sampler: () => ({}), duration: 30 });
  assert.ok(!missing.ok);
  assert.equal(missing.diagnostics[0].code, 'camera.direct.unknown');
  assert.match(missing.diagnostics[0].message, /missing-basin/);
});

test('LM-009: source-era 2024 kitchen sink compiles with no invalid samples or world mutation', async () => {
  const { sourceEraCampus2024 } = await import('./camera-direct-fixtures.ts');
  const { scene, world } = sourceEraCampus2024();
  const before = JSON.stringify({ scene, world });
  const sw = new SemanticWorld(scene, world);
  const parsed = parseCameraSentences(sw, ['hold on the sink'], cameraVocab(sw, []));
  assert.deepEqual(parsed.refusals, []);
  assert.equal(parsed.directions[0].subject.kind, 'fixture');
  const input = { scene, world, sampler: () => ({}), duration: 30 };
  const directed = directCamera(parsed.directions.map((d) => d.direction), input);
  assert.ok(directed.ok, JSON.stringify(directed));
  assert.deepEqual(directed, directCamera([{ subject: { kind: 'fixture', ref: 'sink' }, motion: { verb: 'hold' } }], input));
  assert.equal(directed.shots[0].validation.invalidSamples, 0);
  assert.equal(directed.shots[0].validation.sweptCrossings, 0);
  assert.equal(directed.shots[0].simulation?.failingSamples, 0);
  assert.equal(JSON.stringify({ scene, world }), before);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCameraDemo } from './prepare-camera-demo.mjs';
const fixture = () => ({ schema: 'mars-camera-suite/1', live: false, cases:
  ['presentation', 'conversation', 'walking', 'workstation', 'simultaneous', 'operator'].map((id) => ({
    id, take: { finalState: {} }, worldHash: 'recorded-world', violations: [], records: [],
    policies: Object.fromEntries(['clear', 'restrained', 'continuous'].map((p) => [p, { frames: [{}] }])),
  })),
});
await test('camera demo packaging requires recorded complete scenes with coherent execution and every policy', () => {
  const good = fixture(); assert.equal(validateCameraDemo(good), good);
  const live = fixture(); live.live = true; assert.throws(() => validateCameraDemo(live), /demo-schema/);
  const missing = fixture(); missing.cases.pop(); assert.throws(() => validateCameraDemo(missing), /demo-cases/);
  const failure = fixture(); failure.cases[0].records.push({ status: 'failed' }); assert.throws(() => validateCameraDemo(failure), /demo-world/);
  const violation = fixture(); violation.cases[1].violations.push({ code: 'unsupported' }); assert.throws(() => validateCameraDemo(violation), /demo-world/);
  const camera = fixture(); camera.cases[2].policies.continuous.frames = []; assert.throws(() => validateCameraDemo(camera), /demo-policy/);
});

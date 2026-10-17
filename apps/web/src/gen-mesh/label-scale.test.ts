// Flag labels stay readable but never fill the screen when the camera stands beside the flag.
//   node --test apps/web/src/gen-mesh/label-scale.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labelScale, LABEL_MAX_PX } from './basic.mesh.ts';

test('a label keeps its size far away and is capped on screen up close', () => {
  const px = 900 / (2 * Math.tan((45 * Math.PI) / 360));   // 1440x900, fov 45: ~1086 px per metre at 1 m
  assert.equal(labelScale(100, px), 1, 'far: unchanged (13 px tall)');
  const near = labelScale(2, px); assert.ok(near < 0.1, `near: shrunk to ${near}`);
  assert.ok(Math.abs((1.2 * near * px) / 2 - LABEL_MAX_PX) < 1e-9, 'exactly the cap');
  assert.ok(labelScale(2, px, 2) < near, 'a scaled-up flag shrinks its label more');
  assert.ok(Number.isFinite(labelScale(0, px)));
});

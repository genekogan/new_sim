import test from 'node:test';
import assert from 'node:assert/strict';
import { worldResolution } from '../src/adaptive-resolution.ts';

test('shot canvases retain requested dimensions on retina and slow frames without an adaptive controller', () => {
  for (const entityWorld of [false, true]) for (const deviceRatio of [0.75, 1, 2, 3]) {
    let ratio = 0;
    const renderer = { setPixelRatio(value: number) { ratio = value; } };
    const adaptive = worldResolution(renderer as never, deviceRatio, entityWorld, true);
    assert.equal(adaptive, null);
    for (let frame = 0; frame < 1000; frame++) {
      (adaptive as { frame(now: number): void } | null)?.frame(frame * 100);
    }
    assert.equal(ratio, 1);
    assert.deepEqual([1024 * ratio, 640 * ratio], [1024, 640]);
  }
});

test('ordinary entity worlds still adapt on slow frames; other viewers keep their capped device ratio', () => {
  let ratio = 0;
  const renderer = { setPixelRatio(value: number) { ratio = value; } };
  assert.equal(worldResolution(renderer as never, 3, false, false), null);
  assert.equal(ratio, 2);
  const adaptive = worldResolution(renderer as never, 2, true, false);
  assert.ok(adaptive);
  const start = performance.now();
  for (let frame = 0; frame < 300; frame++) adaptive.frame(start + frame * 50);
  assert.ok(adaptive.log.some(entry => entry.ratio < 2), 'ordinary slow viewer still reduces its resolution');
});

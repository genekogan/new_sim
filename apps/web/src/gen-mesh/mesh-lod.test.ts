import test from 'node:test';
import assert from 'node:assert/strict';
import { meshLodAsset, meshLodDistance } from './mesh-lod.ts';

const make = { asset: 'a'.repeat(64), lod1: 'b'.repeat(64) };

test('switch distance: 4x the largest side, never under 40 m, grows with an enlarged entity only', () => {
  assert.equal(meshLodDistance([1, 2, 1]), 40);
  assert.equal(meshLodDistance([30, 12, 18]), 120);
  assert.equal(meshLodDistance([30, 12, 18], 2), 240);
  assert.equal(meshLodDistance([30, 12, 18], 0.5), 120);
});

test('a def without lod1 always draws its original', () => {
  assert.equal(meshLodAsset({ asset: make.asset }, [30, 12, 18], 10_000), make.asset);
});

test('the original up close, lod1 past the switch, with 10% hysteresis at the boundary', () => {
  const box = [30, 12, 18];
  assert.equal(meshLodAsset(make, box, 50), make.asset);
  assert.equal(meshLodAsset(make, box, 125), make.asset, 'just past 120 m from the original: still the original (hysteresis)');
  assert.equal(meshLodAsset(make, box, 133), make.lod1);
  assert.equal(meshLodAsset(make, box, 125, 1, make.lod1), make.lod1, 'already on lod1: stays until back under 120 m');
  assert.equal(meshLodAsset(make, box, 119, 1, make.lod1), make.asset);
});

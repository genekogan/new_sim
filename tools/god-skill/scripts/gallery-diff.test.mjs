import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareGalleries } from './gallery-diff.mjs';

test('gallery gate reports per-def pixel and triangle changes and requires a reason for each', t => {
  const root = mkdtempSync(join(tmpdir(), 'kit-gallery-test-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const capture = (dir, rgba = [1, 2, 3, 255], tris = 12, name = 'box') => {
    mkdirSync(join(root, dir), { recursive: true }); writeFileSync(join(root, dir, 'pixel.rgba'), Buffer.from(rgba));
    writeFileSync(join(root, dir, 'gallery.json'), JSON.stringify({ schema: 'kit-gallery/1', errors: [], captures: [{ name, phase: 'rest', width: 1, height: 1, file: 'pixel.rgba', tris }] }));
    return join(root, dir);
  };
  const before = capture('before'), same = capture('same'), pixels = capture('pixels', [1, 20, 3, 255]), triangles = capture('triangles', undefined, 20);
  assert.equal(compareGalleries(before, same).ok, true);
  const diff = compareGalleries(before, pixels); assert.equal(diff.ok, false); assert.equal(diff.changed[0].changedPixels, 1); assert.equal(diff.changed[0].maxChannelDelta, 18); assert.equal(diff.changed[0].triangleDelta, 0);
  assert.equal(compareGalleries(before, pixels, { allow: { box: 'v2 opts into changed emission' } }).ok, true);
  assert.equal(compareGalleries(before, pixels, { allow: { box: '' } }).ok, false);
  assert.equal(compareGalleries(before, triangles).changed[0].triangleDelta, 8);
  assert.equal(compareGalleries(before, triangles).ok, false);
  assert.equal(compareGalleries(before, capture('added', undefined, 12, 'sphere')).changed.length, 2);
});

test('gallery errors, missing captures, empty galleries and malformed RGBA cannot pass', t => {
  const dir = mkdtempSync(join(tmpdir(), 'kit-gallery-bad-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'gallery.json');
  writeFileSync(file, JSON.stringify({})); assert.throws(() => compareGalleries(dir, dir), /captures missing/);
  writeFileSync(file, JSON.stringify({ schema: 'kit-gallery/1', errors: [], captures: [] })); assert.equal(compareGalleries(dir, dir).ok, false);
  writeFileSync(join(dir, 'bad.rgba'), ''); writeFileSync(file, JSON.stringify({ schema: 'kit-gallery/1', errors: [], captures: [{ name: 'x', phase: 'rest', file: 'bad.rgba', width: 1, height: 1, tris: 12 }] }));
  assert.throws(() => compareGalleries(dir, dir), /invalid pixel capture/);
});

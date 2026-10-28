import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ContextTextureFailures } from './context-texture-failures.ts';
import { imageFailed, onRenderedImageFallback, whenImageFails } from './gen-mesh/art-media.ts';

test('context accepts a completed visible media fallback but rejects a second unhandled consumer of its URL', () => {
  const tracker = new ContextTextureFailures('http://localhost/w/lab/context-view');
  const manager = new THREE.LoadingManager();
  manager.onError = url => tracker.failed(url);
  const stop = onRenderedImageFallback(url => tracker.renderedFallback(url));
  const url = 'https://blocked.invalid/context-fallback.jpg';
  const faces: string[] = [];
  try {
    whenImageFails(url, () => faces.push('visible broken-link face 1'));
    whenImageFails(url, () => faces.push('visible broken-link face 2'));
    // ImageLoader invokes its request error callback before manager.itemError.
    imageFailed(url);
    manager.itemError(url);
    assert.equal(faces.length, 2);
    assert.equal(tracker.unresolved, false);
    manager.itemError(url); // e.g. a decal/GLTF consumer with no rendered fallback
    assert.equal(tracker.unresolved, true);
  } finally { stop(); }
});

test('missing local textures and failure without a registered face remain fatal', () => {
  const tracker = new ContextTextureFailures('http://localhost/w/lab/context-view');
  const stop = onRenderedImageFallback(url => tracker.renderedFallback(url));
  try {
    const url = '/w/lab/assets/unhandled.png';
    imageFailed(url);
    tracker.failed(url);
    assert.equal(tracker.unresolved, true);
  } finally { stop(); }
});

test('fallback accounting normalizes relative URLs and cannot clear an earlier failure', () => {
  const tracker = new ContextTextureFailures('http://localhost/w/lab/context-view');
  tracker.renderedFallback('/w/lab/assets/handled.png');
  tracker.failed('http://localhost/w/lab/assets/handled.png');
  assert.equal(tracker.unresolved, false);
  tracker.failed('/w/lab/assets/missing.png');
  tracker.renderedFallback('/w/lab/assets/missing.png');
  assert.equal(tracker.unresolved, true);
});

test('a broken replacement or disposed observer does not credit recovery', () => {
  const tracker = new ContextTextureFailures('http://localhost/w/lab/context-view');
  const stop = onRenderedImageFallback(url => tracker.renderedFallback(url));
  const url = 'https://blocked.invalid/context-broken-fallback.jpg';
  whenImageFails(url, () => { throw Error('replacement failed'); });
  try {
    assert.throws(() => imageFailed(url), /replacement failed/);
    tracker.failed(url);
    assert.equal(tracker.unresolved, true);
  } finally { stop(); }
  const disposed = new ContextTextureFailures('http://localhost/w/lab/context-view');
  const dispose = onRenderedImageFallback(url => disposed.renderedFallback(url));
  dispose();
  const other = 'https://blocked.invalid/context-disposed.jpg';
  whenImageFails(other, () => {});
  imageFailed(other);
  disposed.failed(other);
  assert.equal(disposed.unresolved, true);
});

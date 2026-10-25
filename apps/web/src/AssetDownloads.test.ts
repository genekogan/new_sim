import assert from 'node:assert/strict';
import test from 'node:test';
import { LoadingManager } from 'three';
import { AssetDownloads, trackAssetDownloads } from './AssetDownloads.ts';

test('view download tracking releases every callback retained by a cached GLTF manager', () => {
 const manager = new LoadingManager();
 const original = { onStart: manager.onStart, onProgress: manager.onProgress, onError: manager.onError, itemStart: manager.itemStart };
 let changes = 0;
 const downloads = new AssetDownloads(() => changes++);
 const release = trackAssetDownloads(manager, downloads);
 manager.itemStart('a'); manager.itemStart('b'); manager.itemError('b'); manager.itemEnd('b');
 assert.deepEqual(downloads.snapshot(), { loaded: 0, total: 2, failed: 1, pending: 1 });
 release(); release();
 for (const key of ['onStart', 'onProgress', 'onError', 'itemStart'] as const) assert.equal(manager[key], original[key]);
 const before = changes;
 manager.itemEnd('a'); manager.itemStart('c'); manager.itemError('c'); manager.itemEnd('c');
 assert.equal(changes, before, 'late parser requests retain manager behavior without invoking the departed view');
});

test('release preserves callbacks subsequently installed by another owner', () => {
 const manager = new LoadingManager();
 const release = trackAssetDownloads(manager, new AssetDownloads());
 const start = () => {}, progress = () => {}, error = () => {}, itemStart = () => {};
 manager.onStart = start; manager.onProgress = progress; manager.onError = error; manager.itemStart = itemStart;
 release();
 assert.equal(manager.onStart, start); assert.equal(manager.onProgress, progress);
 assert.equal(manager.onError, error); assert.equal(manager.itemStart, itemStart);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { setTextureRenderer } from './texture-budget.ts';

test('a download finishing after remount remains cacheable without preparing GPU resources in the new view', async t => {
  const location = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL('http://localhost/w/texture-lifecycle-test') });
  t.after(() => { setTextureRenderer(null); if (location) Object.defineProperty(globalThis, 'location', location); else Reflect.deleteProperty(globalThis, 'location'); });
  const { loadAsset, setAssetLoader, instantiate } = await import('./gltf-assets.ts');
  const scene = new THREE.Group(); scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: new THREE.Texture({ width: 1, height: 1 }) })));
  const gltf = { scene, scenes: [scene], animations: [], userData: {} } as unknown as GLTF;
  let finish!: (g: GLTF) => void;
  const a = new GLTFLoader(); a.loadAsync = () => new Promise(resolve => { finish = resolve; });
  const log: string[] = [], renderer = (name: string) => ({ compile: () => { log.push(name + ':compile'); return new Set(); }, initTexture: () => { log.push(name + ':upload'); } }) as unknown as THREE.WebGLRenderer;
  const releaseA = setTextureRenderer(renderer('A'), new THREE.Scene(), new THREE.Camera()); setAssetLoader(a);
  const sha = 'b'.repeat(64), pending = loadAsset(sha);
  releaseA(); setTextureRenderer(renderer('B'), new THREE.Scene(), new THREE.Camera()); setAssetLoader(new GLTFLoader());
  finish(gltf); assert.equal(await pending, gltf); assert.deepEqual(log, []);
  assert.equal(await loadAsset(sha), gltf);
  const instance = instantiate(gltf, { height: 2 }); assert.ok(instance.object.children.length); instance.dispose();
});

function assetModel() {
  const scene = new THREE.Group(); scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
  return { scene, scenes: [scene], animations: [], userData: {} } as unknown as GLTF;
}
function fixtureLocation(t: import('node:test').TestContext) {
  const location = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL('http://localhost/w/asset-loader-lifecycle') });
  t.after(() => { setTextureRenderer(null); if (location) Object.defineProperty(globalThis, 'location', location); else Reflect.deleteProperty(globalThis, 'location'); });
}

test('an old loader release cannot clear a new registration of the same loader', async t => {
  fixtureLocation(t);
  const { loadAsset, setAssetLoader } = await import('./gltf-assets.ts');
  const loader = new GLTFLoader(), gltf = assetModel(); let calls = 0;
  loader.loadAsync = async () => { calls++; return gltf; };
  const releaseA = setAssetLoader(loader), releaseB = setAssetLoader(loader); t.after(releaseB);
  releaseA(); releaseA();
  assert.equal(await loadAsset('c'.repeat(64)), gltf); assert.equal(calls, 1);
  assert.equal(await loadAsset('c'.repeat(64)), gltf); assert.equal(calls, 1);
});

test('a new loader replaces an in-flight cache entry and a late old success cannot replace the new cached asset', async t => {
  fixtureLocation(t);
  const { loadAsset, setAssetLoader } = await import('./gltf-assets.ts');
  const a = new GLTFLoader(), b = new GLTFLoader(), ga = assetModel(), gb = assetModel(); let finish!: (g: GLTF) => void, calls = 0;
  a.loadAsync = () => new Promise(resolve => { finish = resolve; }); b.loadAsync = async () => { calls++; return gb; };
  const releaseA = setAssetLoader(a), pending = loadAsset('d'.repeat(64));
  const releaseB = setAssetLoader(b); t.after(releaseB); releaseA();
  assert.equal(await loadAsset('d'.repeat(64)), gb); finish(ga); assert.equal(await pending, ga);
  assert.equal(await loadAsset('d'.repeat(64)), gb); assert.equal(calls, 1);
});

test('a late failure from a replaced loader cannot mark the replacement asset failed', async t => {
  fixtureLocation(t);
  const { loadAsset, setAssetLoader, assetFailed } = await import('./gltf-assets.ts');
  const a = new GLTFLoader(), b = new GLTFLoader(), gb = assetModel(); let fail!: (e: Error) => void;
  a.loadAsync = () => new Promise((_resolve, reject) => { fail = reject; }); b.loadAsync = async () => gb;
  const releaseA = setAssetLoader(a), pending = loadAsset('e'.repeat(64));
  const rejected = assert.rejects(pending, /old request/);
  const releaseB = setAssetLoader(b); t.after(releaseB); releaseA();
  assert.equal(await loadAsset('e'.repeat(64)), gb); fail(Error('old request')); await rejected;
  assert.equal(assetFailed('e'.repeat(64)), false); assert.equal(await loadAsset('e'.repeat(64)), gb);
});

test('settled failures keep the existing retry delay after releasing their loader reference', async t => {
  fixtureLocation(t); t.mock.timers.enable({ apis: ['setTimeout'] });
  const { loadAsset, setAssetLoader, assetFailed } = await import('./gltf-assets.ts');
  const loader = new GLTFLoader(), gltf = assetModel(); let calls = 0;
  loader.loadAsync = async () => { if (++calls === 1) throw Error('temporary failure'); return gltf; };
  const release = setAssetLoader(loader); t.after(release); const sha = 'f'.repeat(64);
  await assert.rejects(loadAsset(sha), /temporary failure/); assert.equal(assetFailed(sha), true);
  await assert.rejects(loadAsset(sha), /temporary failure/); assert.equal(calls, 1);
  t.mock.timers.tick(30_000); assert.equal(assetFailed(sha), false);
  assert.equal(await loadAsset(sha), gltf); assert.equal(calls, 2);
});

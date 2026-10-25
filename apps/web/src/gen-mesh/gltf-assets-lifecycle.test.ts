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

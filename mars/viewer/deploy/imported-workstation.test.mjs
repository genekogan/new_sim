import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { fitWorkstationModel, attachWorkstationScreen, importedWorkstation } from '../app/engine-view/imported-workstation.ts';
import { ThreeResources } from '../lib/three-resources.ts';
import { workstationObject } from '../app/engine-view/workstation.ts';

// Build actual binary geometry with all authored node transforms, without a DOM texture decoder.
function assetScene() {
  const bytes = readFileSync(new URL('../public/models/retro-computer-monitor.glb', import.meta.url));
  const length = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + length)), binary = bytes.subarray(28 + length);
  const attribute = id => {
    const a = json.accessors[id], v = json.bufferViews[a.bufferView], count = { SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type], width = a.componentType === 5123 ? 2 : 4, values = [];
    for (let i = 0; i < a.count; i++) for (let k = 0; k < count; k++) {
      const offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (v.byteStride ?? width * count) + k * width;
      values.push(a.componentType === 5126 ? binary.readFloatLE(offset) : width === 2 ? binary.readUInt16LE(offset) : binary.readUInt32LE(offset));
    }
    return a.componentType === 5126 ? new THREE.Float32BufferAttribute(values, count) : new THREE.Uint32BufferAttribute(values, count);
  };
  const nodes = json.nodes.map(node => {
    let object = new THREE.Group();
    if (node.mesh !== undefined) {
      const primitive = json.meshes[node.mesh].primitives[0], geometry = new THREE.BufferGeometry();
      for (const [name, id] of Object.entries(primitive.attributes)) geometry.setAttribute({ POSITION: 'position', NORMAL: 'normal', TEXCOORD_0: 'uv' }[name], attribute(id));
      geometry.setIndex(attribute(primitive.indices)); object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    }
    // Match GLTFLoader._loadNodeShallow: sanitized display name, exact source identity.
    object.name = THREE.PropertyBinding.sanitizeNodeName(node.name);
    object.userData.name = node.name;
    if (node.matrix) object.applyMatrix4(new THREE.Matrix4().fromArray(node.matrix));
    return object;
  });
  json.nodes.forEach((node, i) => (node.children ?? []).forEach(child => nodes[i].add(nodes[child])));
  const scene = new THREE.Group(); json.scenes[0].nodes.forEach(i => scene.add(nodes[i]));
  return { scene, bytes, json };
}
const turn = () => new Promise(resolve => setImmediate(resolve));
const box = (_c, x, y, z, sx, sy, sz) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshBasicMaterial()); m.position.set(x, y + sy / 2, z); return m; };
await test('selected binary and embedded attribution match credit', () => {
  const { bytes, json, scene } = assetScene(), credit = JSON.parse(readFileSync(new URL('../public/models/retro-computer-monitor.credit.json', import.meta.url)));
  assert.equal(bytes.length, 139184); assert.equal(createHash('sha256').update(bytes).digest('hex'), credit.sha256);
  assert.match(json.asset.extras.author, /JasperTobias/); assert.equal(json.asset.extras.source, credit.sourceUrl); assert.match(json.asset.extras.license, /CC-BY-4.0/);
  const r = new ThreeResources(); r.object(scene); r.dispose();
});
await test('actual complete transformed model fits above desk inside current envelope', () => {
  const { scene } = assetScene(), r = new ThreeResources(); r.object(scene);
  const { bounds } = fitWorkstationModel(scene, 1.4, 1.3, 0.75, 0.74);
  assert.ok(bounds.min[0] >= -0.62 && bounds.max[0] <= 0.62);
  assert.ok(bounds.min[1] >= 0.743 - 1e-12 && bounds.max[1] <= 1.3);
  assert.ok(bounds.min[2] >= -0.335 && bounds.max[2] <= 0.335);
  assert.ok(bounds.max[1] - bounds.min[1] > 0.4); r.dispose();
});
await test('live canvas material replaces actual CRT faces without changing source geometry', () => {
  const { scene } = assetScene(), r = new ThreeResources(); r.object(scene);
  const monitor = scene.getObjectByName('Monitor002_RetroPalette2_0'), original = monitor.geometry, uv = Array.from(original.attributes.uv.array), live = new THREE.MeshBasicMaterial();
  assert.equal(scene.getObjectByName('Monitor.002_RetroPalette2_0'), undefined, 'actual loader removes periods');
  assert.equal(monitor.userData.name, 'Monitor.002_RetroPalette2_0');
  assert.equal(attachWorkstationScreen(scene, live, r), 8);
  assert.deepEqual(Array.from(original.attributes.uv.array), uv); assert.notEqual(monitor.geometry, original); assert.equal(monitor.material[1], live);
  const mappedGeometry = monitor.geometry;
  assert.ok(mappedGeometry.groups.length <= 7, 'actual asset needs at most seven contiguous draws, not one draw per triangle');
  assert.equal(mappedGeometry.groups.filter(g => g.materialIndex === 1).reduce((sum, g) => sum + g.count, 0), 8 * 3);
  assert.deepEqual(Array.from(mappedGeometry.index.array), Array.from(original.index.array));
  assert.deepEqual(Array.from(mappedGeometry.attributes.position.array), Array.from(original.attributes.position.array));
  assert.deepEqual(Array.from(mappedGeometry.attributes.normal.array), Array.from(original.attributes.normal.array));
  const selected = i => Math.abs(original.attributes.uv.getX(i) - 0.188) < 0.001 && Math.abs(original.attributes.uv.getY(i) - 0.858) < 0.001;
  let covered = 0;
  for (const g of mappedGeometry.groups) {
    assert.equal(g.start, covered); covered += g.count;
    for (let i = g.start; i < g.start + g.count; i += 3)
      assert.equal(g.materialIndex, [0, 1, 2].every(k => selected(original.index.getX(i + k))) ? 1 : 0);
  }
  assert.equal(covered, original.index.count);
  for (let i = 0; i < original.attributes.uv.count; i++) if (!selected(i)) {
    assert.equal(mappedGeometry.attributes.uv.getX(i), original.attributes.uv.getX(i));
    assert.equal(mappedGeometry.attributes.uv.getY(i), original.attributes.uv.getY(i));
  }
  for (const g of monitor.geometry.groups.filter(g => g.materialIndex === 1)) for (let k = 0; k < g.count; k++) {
    const i = monitor.geometry.index.getX(g.start + k), mapped = monitor.geometry.attributes.uv;
    assert.ok(mapped.getX(i) >= 0 && mapped.getX(i) <= 1 && mapped.getY(i) >= 0 && mapped.getY(i) <= 1);
  }
  r.dispose(); live.dispose();
});
await test('primitive default preserves geometry and authoritative task canvas', () => {
  const saved = globalThis.document, writes = [];
  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: { createElement: () => ({ getContext: () => ({ fillRect() {}, fillText: text => writes.push(text) }) }) } });
  try {
    const v = workstationObject(box, 1.4, 1.3, 0.75); assert.equal(v.obj.children.length, 12); assert.equal(Object.hasOwn(v, 'appearanceState'), false);
    const e = { equipment: { kind: 'workstation', config: { status: 'active', task: 'Prototype project notes', workSeconds: 15, durationSeconds: 30 } } }, before = structuredClone(e);
    v.update(e); assert.deepEqual(writes, ['Prototype project notes', 'active · 50%']); assert.deepEqual(e, before); v.dispose();
  } finally { globalThis.document = saved; }
});
await test('load refusal retains fallback and detached named diagnostic', async () => {
  const saved = globalThis.fetch; globalThis.fetch = async () => ({ ok: false, status: 404 });
  try {
    let ready = 0; const parent = new THREE.Group(), texture = new THREE.Texture();
    const v = importedWorkstation(parent, texture, 1.4, 1.3, 0.75, 0.74, { kind: 'retro-computer' }, () => ready++);
    await turn(); assert.equal(v.state().status, 'failed'); assert.match(v.state().diagnostic, /appearance.load-failed.*primitive retained.*404/);
    const state = v.state(); state.status = 'ready'; assert.equal(v.state().status, 'failed'); assert.equal(ready, 0);
    v.dispose(); assert.equal(v.state().status, 'disposed'); texture.dispose();
  } finally { globalThis.fetch = saved; }
});
await test('reset during late texture decode disposes model and palette without attaching', async () => {
  const saved = { fetch: globalThis.fetch, location: globalThis.location }, parse = Object.getOwnPropertyDescriptor(GLTFLoader.prototype, 'parseAsync');
  let resolvePalette; const { scene } = assetScene();
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }); globalThis.location = { href: 'http://localhost/lab' };
  GLTFLoader.prototype.parseAsync = async () => ({ scene, parser: { getDependency: () => new Promise(resolve => { resolvePalette = resolve; }) } });
  try {
    const parent = new THREE.Group(), texture = new THREE.Texture(), states = []; let ready = 0;
    const v = importedWorkstation(parent, texture, 1.4, 1.3, 0.75, 0.74, { kind: 'retro-computer', onStatus: s => states.push(s.status) }, () => ready++);
    await turn(); assert.equal(typeof resolvePalette, 'function'); v.dispose();
    const palette = new THREE.Texture(); let disposed = 0; palette.addEventListener('dispose', () => disposed++); resolvePalette(palette); await turn();
    assert.equal(disposed, 1); assert.equal(parent.children.length, 0); assert.equal(ready, 0); assert.deepEqual(states, ['loading', 'disposed']); texture.dispose();
  } finally { Object.defineProperty(GLTFLoader.prototype, 'parseAsync', parse); Object.assign(globalThis, saved); }
});
await test('successful load exposes detached fit proof and disposes owned imported resources', async () => {
  const saved = { fetch: globalThis.fetch, location: globalThis.location }, parse = Object.getOwnPropertyDescriptor(GLTFLoader.prototype, 'parseAsync');
  const { scene } = assetScene(), palette = new THREE.Texture();
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }); globalThis.location = { href: 'http://localhost/lab' };
  GLTFLoader.prototype.parseAsync = async () => ({ scene, parser: { getDependency: async () => palette } });
  try {
    const parent = new THREE.Group(), texture = new THREE.Texture(); let ready = 0, disposed = 0;
    palette.addEventListener('dispose', () => disposed++);
    const v = importedWorkstation(parent, texture, 1.4, 1.3, 0.75, 0.74, { kind: 'retro-computer' }, () => ready++);
    await turn(); assert.equal(v.state().status, 'ready'); assert.equal(ready, 1); assert.equal(parent.children.length, 1);
    const state = v.state(); state.bounds.min[1] = -100; assert.ok(v.state().bounds.min[1] > 0.74);
    assert.equal(scene.getObjectByName('Monitor002_RetroPalette2_0').material[1].map, texture);
    v.dispose(); v.dispose(); assert.equal(disposed, 1); assert.equal(parent.children.length, 0); texture.dispose();
  } finally { Object.defineProperty(GLTFLoader.prototype, 'parseAsync', parse); Object.assign(globalThis, saved); }
});
await test('reset during asynchronous parse disposes late geometry and never attaches', async () => {
  const saved = { fetch: globalThis.fetch, location: globalThis.location }, parse = Object.getOwnPropertyDescriptor(GLTFLoader.prototype, 'parseAsync');
  let resolveParse;
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }); globalThis.location = { href: 'http://localhost/lab' };
  GLTFLoader.prototype.parseAsync = () => new Promise(resolve => { resolveParse = resolve; });
  try {
    const parent = new THREE.Group(), texture = new THREE.Texture(), states = []; let ready = 0;
    const v = importedWorkstation(parent, texture, 1.4, 1.3, 0.75, 0.74, { kind: 'retro-computer', onStatus: s => states.push(s.status) }, () => ready++);
    await turn(); v.dispose();
    const { scene } = assetScene(); let disposed = 0;
    scene.getObjectByName('Monitor002_RetroPalette2_0').geometry.addEventListener('dispose', () => disposed++);
    resolveParse({ scene }); await turn();
    assert.equal(disposed, 1); assert.equal(parent.children.length, 0); assert.equal(ready, 0); assert.deepEqual(states, ['loading', 'disposed']); texture.dispose();
  } finally { Object.defineProperty(GLTFLoader.prototype, 'parseAsync', parse); Object.assign(globalThis, saved); }
});

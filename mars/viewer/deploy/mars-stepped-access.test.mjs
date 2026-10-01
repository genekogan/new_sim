import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { WalkingBody } from '../app/studio/walking.ts';
import { tagMarsSteppedAccess } from '../app/studio/mars-stepped-access.ts';
import { rectangularSupport, steppedAccess } from '../app/studio/stepped-access.ts';

// Preserve every binary geometry byte. Only omit browser image decoding in Node.
async function campus() {
  const b = readFileSync(new URL('../public/browser/campus.glb', import.meta.url));
  const length = b.readUInt32LE(12), json = JSON.parse(b.subarray(20, 20 + length));
  json.images = []; json.textures = [];
  json.materials = json.materials.map(m => ({ name: m.name, doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }));
  let text = Buffer.from(JSON.stringify(json));
  text = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 32)]);
  const header = Buffer.alloc(20);
  header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + text.length + b.length - 20 - length, 8);
  header.writeUInt32LE(text.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const packed = Buffer.concat([header, text, b.subarray(20 + length)]);
  const result = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength), '');
  result.scene.updateMatrixWorld(true);
  return result.scene;
}
function support(root, suffix) {
  const owner = root.getObjectByName(`wood_component-${suffix}`);
  assert.ok(owner, suffix);
  const meshes = []; owner.traverse(o => { if (o instanceof THREE.Mesh) meshes.push(o); });
  assert.equal(meshes.length, 1, suffix);
  return meshes[0];
}
const ids = ['0758', '0752', '0756', '0754', '0727', '0804', '0826', '0806'];
const root = await campus();
const axis = new THREE.Vector3(-1.103851318359375, 0, -0.5241432189941406).normalize();

test('measured released auditorium supports retain complete authored-axis box profiles', () => {
  const measurements = [];
  for (const id of ids) {
    const mesh = support(root, id), attr = mesh.geometry.getAttribute('position');
    const across = new THREE.Vector3(-axis.z, 0, axis.x);
    const points = Array.from({ length: attr.count }, (_, i) => {
      const p = new THREE.Vector3().fromBufferAttribute(attr, i);
      return new THREE.Vector3(p.dot(axis), p.y, p.dot(across));
    });
    const bounds = new THREE.Box3().setFromPoints(points);
    let residual = 0;
    for (const p of points) for (const at of ['x', 'y', 'z']) residual = Math.max(residual, Math.min(Math.abs(p[at] - bounds.min[at]), Math.abs(p[at] - bounds.max[at])));
    mesh.userData.walkTraversal = { kind: 'stepped-access', id: 'diagnostic', axis: [axis.x, axis.z], maxRise: .4, maxDrop: .4, maxGap: .04, profile: 'authored-rectangle' };
    const data = steppedAccess(mesh);
    measurements.push({ id, residual, data });
    assert.ok(residual < 1e-6, `${id}: measured Float32 residual ${residual}`);
    assert.equal(rectangularSupport(mesh.geometry, axis, 2e-6), true, id);
    delete mesh.userData.walkTraversal;
  }
  for (let i = 1; i < measurements.length; i++) {
    const upper = measurements[i - 1].data, lower = measurements[i].data;
    assert.ok(upper.start < lower.end, 'actual tiers overlap; no physical gap');
    assert.ok(upper.top - lower.top <= .4, 'actual support delta fits authored cap');
  }
});

function pose(scene, u, v = 5.7) {
  const frame = new THREE.Object3D();
  frame.position.set(-8.47875, 0, 8.925);
  frame.rotation.y = -Math.atan2(.4265, .9045); frame.updateMatrix();
  const transform = scene.getObjectByName('Chiba').matrixWorld.clone().multiply(frame.matrix);
  return new THREE.Vector3(u, 0, -v).applyMatrix4(transform);
}
function walker(scene, start = 11.5) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.copy(pose(scene, start)); camera.position.y = 2;
  const target = pose(scene, 3.0); target.y = camera.position.y;
  camera.lookAt(target);
  const body = new WalkingBody(camera); body.rebuild([scene]); body.place();
  return { camera, body };
}
function journey(body, frames, forward) {
  for (let i = 0; i < frames; i++) {
    const y = body.camera.position.y;
    body.step(1 / 90, forward, 0, false);
    assert.equal(body.grounded, true, `grounded frame ${i}, position ${body.camera.position.toArray().join(',')}`);
    assert.ok(Math.abs(body.camera.position.y - y) < .04, `continuous lift frame ${i}`);
  }
}
test('exact released CAD entry and eight tiers ascend and descend with physical support', () => {
  const scene = root.clone(true);
  const before = ids.concat('1814').map(id => {
    const m = support(scene, id); return { geometry: m.geometry, material: m.material, matrix: m.matrix.toArray(), position: Array.from(m.geometry.attributes.position.array), index: Array.from(m.geometry.index.array) };
  });
  const result = tagMarsSteppedAccess(scene);
  assert.deepEqual(result.refused, []); assert.equal(result.tagged.length, 9);
  const { camera, body } = walker(scene);
  assert.ok(Math.abs(camera.position.y - 1.9130799) < 2e-6, 'actual entry floor, not fallback ground');
  journey(body, 255, 1);
  assert.ok(camera.position.distanceTo(pose(scene, 3.0).setY(4.8022931)) < .04, `actual ascent end ${camera.position.toArray().join(',')}`);
  journey(body, 255, -1);
  assert.ok(camera.position.distanceTo(pose(scene, 11.5).setY(1.9130799)) < .04, `actual descent end ${camera.position.toArray().join(',')}`);
  ids.concat('1814').forEach((id, i) => {
    const m = support(scene, id);
    assert.equal(m.geometry, before[i].geometry); assert.equal(m.material, before[i].material);
    assert.deepEqual(m.matrix.toArray(), before[i].matrix);
    assert.deepEqual(Array.from(m.geometry.attributes.position.array), before[i].position);
    assert.deepEqual(Array.from(m.geometry.index.array), before[i].index);
  });
});
test('untagged released CAD retains legacy support behavior without authored access semantics', () => {
  const scene = root.clone(true); const { camera, body } = walker(scene);
  let largestLift = 0;
  for (let i = 0; i < 255; i++) {
    const y = camera.position.y; body.step(1 / 90, 1, 0, false);
    largestLift = Math.max(largestLift, camera.position.y - y);
  }
  // This centerline has intermediate imported rack supports: it was never a
  // proven blocked line. Preserve that baseline instead of inventing a failure.
  assert.ok(Math.abs(camera.position.y - 4.8022931) < 2e-6);
  assert.ok(largestLift > .1, 'legacy support query retains abrupt ordinary lifts');
  for (const id of ids.concat('1814')) assert.equal(support(scene, id).userData.walkTraversal, undefined);
});
test('exact source changes and entry footprint holes refuse atomic authored tags', () => {
  for (const kind of ['source', 'hole', 'position']) {
    const scene = root.clone(true), landing = support(scene, '1814');
    if (kind === 'source') landing.userData.source_mesh = 'Geom3D.foreign';
    else {
      landing.geometry = landing.geometry.clone();
      if (kind === 'hole') landing.geometry.setIndex(Array.from(landing.geometry.index.array).slice(3));
      else landing.geometry.attributes.position.setX(0, landing.geometry.attributes.position.getX(0) + .001);
    }
    const result = tagMarsSteppedAccess(scene);
    assert.equal(result.tagged.length, 0);
    assert.ok(result.refused.some(r => r.id === 'wood_component-1814' && r.reason.includes(kind === 'source' ? 'access.source-mesh' : 'access.entry-signature')));
    for (const id of ids.concat('1814')) assert.equal(support(scene, id).userData.walkTraversal, undefined);
  }
});

test('entry registration revalidates its exact footprint after source mutation', () => {
  const scene = root.clone(true); assert.deepEqual(tagMarsSteppedAccess(scene).refused, []);
  const entry = support(scene, '1814');
  assert.equal(steppedAccess(entry).entry, true);
  entry.geometry = entry.geometry.clone(); entry.geometry.setIndex(Array.from(entry.geometry.index.array).slice(3));
  assert.equal(steppedAccess(entry), undefined, 'removed authored triangle cannot retain entry witness');
});

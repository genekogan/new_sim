import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

await mkdir('.cloudflare/audit2/unit', { recursive: true });
await build({
  entryPoints: ['app/studio/euc-riders.ts'],
  outfile: '.cloudflare/audit2/unit/euc-riders.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['three', 'three/*'],
});
const { createEucRiders } =
  await import('../.cloudflare/audit2/unit/euc-riders.mjs');

async function load(name) {
  const bytes = await readFile(`public/modular/environment/${name}.glb`);
  return new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
}

function shoeBox(model, foot) {
  const box = new THREE.Box3();
  model.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    const index = object.skeleton.bones.indexOf(foot);
    if (index < 0) return;
    const position = object.geometry.getAttribute('position');
    const skinIndex = object.geometry.getAttribute('skinIndex');
    const skinWeight = object.geometry.getAttribute('skinWeight');
    for (let i = 0; i < position.count; i++) {
      let weight = 0;
      for (let j = 0; j < 4; j++)
        if (skinIndex.getComponent(i, j) === index)
          weight += skinWeight.getComponent(i, j);
      if (weight < 0.5) continue;
      const point = new THREE.Vector3().fromBufferAttribute(position, i);
      object.applyBoneTransform(i, point);
      box.expandByPoint(object.localToWorld(point));
    }
  });
  return box;
}

test('all EUC rider shoes stay on their pedals and the vehicle remains locked to the rider', async () => {
  const [vehicle, ...people] = await Promise.all(
    [
      'electric-unicycle',
      'animated-casual',
      'animated-punk',
      'animated-woman',
    ].map(load),
  );
  const scene = new THREE.Scene();
  const campus = new THREE.Group();
  campus.add(new THREE.Mesh(new THREE.BoxGeometry(10, 1, 10)));
  const riders = createEucRiders(scene, campus, vehicle, people);
  riders.configure({ count: 3, speed: 6 });
  const group = scene.getObjectByName('Electric unicycle perimeter riders');
  riders.update(1 / 60, 1, true);

  const initial = [];
  for (const holder of group.children.slice(0, 3)) {
    const model = holder.children[1];
    holder.updateMatrixWorld(true);
    const feet = ['L', 'R'].map((side) => model.getObjectByName(`Foot${side}`));
    for (const [i, foot] of feet.entries()) {
      const box = shoeBox(model, foot);
      const center = box.getCenter(new THREE.Vector3());
      const localCenter = holder.worldToLocal(center.clone());
      assert.ok(Math.abs(localCenter.x - (i === 0 ? 0.16 : -0.16)) < 0.025);
      assert.ok(Math.abs(localCenter.z) < 0.025);
      assert.ok(Math.abs(box.min.y - holder.position.y - 0.14) < 0.025);
    }
    const wheel = holder.children[0].getObjectByName('EUC_Wheel');
    initial.push({
      feet: feet.map((foot) =>
        holder.worldToLocal(foot.getWorldPosition(new THREE.Vector3())),
      ),
      wheelRotation: wheel.rotation.x,
    });
  }

  for (const time of [1.1, 1.2, 1.5, 2, 3, 5]) {
    riders.update(1 / 10, time, true);
    group.children.slice(0, 3).forEach((holder, i) => {
      holder.updateMatrixWorld(true);
      const model = holder.children[1];
      for (const [j, side] of ['L', 'R'].entries()) {
        const foot = model.getObjectByName(`Foot${side}`);
        const local = holder.worldToLocal(
          foot.getWorldPosition(new THREE.Vector3()),
        );
        assert.ok(local.distanceTo(initial[i].feet[j]) < 1e-6);
      }
      assert.equal(
        holder.children[0].getObjectByName('EUC_Wheel').rotation.x,
        initial[i].wheelRotation,
      );
    });
  }
  riders.dispose();
});

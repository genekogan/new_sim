import { build } from 'esbuild';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const b = await readFile('public/modular/campus-components.glb');
const len = b.readUInt32LE(12),
  j = JSON.parse(b.subarray(20, 20 + len));
j.images = [];
j.textures = [];
j.materials = j.materials.map(() => ({}));
let json = Buffer.from(JSON.stringify(j));
json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 32)]);
const bin = b.subarray(20 + len),
  header = Buffer.alloc(20);
header.write('glTF');
header.writeUInt32LE(2, 4);
header.writeUInt32LE(20 + json.length + bin.length, 8);
header.writeUInt32LE(json.length, 12);
header.writeUInt32LE(0x4e4f534a, 16);
const stripped = Buffer.concat([header, json, bin]);
const { scene } = await new GLTFLoader().parseAsync(
  stripped.buffer.slice(
    stripped.byteOffset,
    stripped.byteOffset + stripped.byteLength,
  ),
  '',
);
await build({entryPoints:['app/history/details-2026.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.details-catalog.mjs'});
THREE.TextureLoader.prototype.load=function(){return new THREE.Texture();};
// oxlint-disable-next-line typescript/no-deprecated -- offline canvas stub for geometry extraction
globalThis.document={createElement:()=>({width:1,height:1,getContext:()=>new Proxy({}, {get:()=>()=>{}})})};
const {add2026Details}=await import('../.details-catalog.mjs');
add2026Details(scene);await unlink('.details-catalog.mjs');
scene.updateMatrixWorld(true);
const people = [],
  obstacles = [],
  bounds = new THREE.Box3();
scene.traverse((o) => {
  if (o.userData.kind === 'context_person') {
    people.push({
      id: o.userData.component_id || o.name,
      position: o.getWorldPosition(new THREE.Vector3()).toArray(),
      yaw: new THREE.Euler().setFromQuaternion(
        o.getWorldQuaternion(new THREE.Quaternion()),
      ).y,
      roaming: o.userData.assembly_id === 'people',
      template: o.userData.definition_id,
    });
    return;
  }
  if (!o.isMesh) return;
  let p = o;
  while (p) {
    if (
      p.userData.kind === 'context_person' ||
      p.userData.layer === 'Aerial reference'
    )
      return;
    p = p.parent;
  }
  o.geometry.computeBoundingBox();
  const box = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
  bounds.union(box);
  if (box.max.y > 0.14 && box.min.y < 1.69)
    obstacles.push([box.min.toArray(), box.max.toArray()]);
});
const out = {
  units: 'metres',
  up: 'Y',
  ground: -0.16,
  people,
  obstacles,
  bounds: [bounds.min.toArray(), bounds.max.toArray()],
};
await writeFile('simulation/catalog.json', JSON.stringify(out));
console.log({people: people.length, bounds: out.bounds, obstacles: obstacles.length});

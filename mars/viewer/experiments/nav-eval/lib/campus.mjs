// Load the real 2026 campus model (viewer/public/browser/campus.glb, meshopt-compressed)
// in Node and flatten it to world-space triangles. Mirrors deploy/catalog.mjs: strip
// images/textures/materials so GLTFLoader never touches the DOM, skip people.
// Result is cached in out/campus-<subset>.bin (Float32 positions + Uint32 indices).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const GLB = path.resolve(here, '../../../public/browser/campus.glb');
const OUT = path.resolve(here, '../out');
export const GROUND_Y = -0.16;

async function loadScene() {
  const b = await readFile(GLB);
  const len = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + len));
  j.images = [];
  j.textures = [];
  j.materials = (j.materials || []).map(() => ({}));
  let json = Buffer.from(JSON.stringify(j));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 32)]);
  const bin = b.subarray(20 + len);
  const header = Buffer.alloc(20);
  header.write('glTF');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + json.length + bin.length, 8);
  header.writeUInt32LE(json.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const stripped = Buffer.concat([header, json, bin]);
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const { scene } = await loader.parseAsync(
    stripped.buffer.slice(stripped.byteOffset, stripped.byteOffset + stripped.byteLength),
    '',
  );
  scene.updateMatrixWorld(true);
  return scene;
}

function skip(o) {
  for (let p = o; p; p = p.parent) {
    const u = p.userData || {};
    if (u.kind === 'context_person' || u.kind === 'context_group' || u.assembly_id === 'people') return true;
    if (u.layer === 'Glazing') return false; // glass still blocks walking
  }
  return false;
}

/**
 * subset: 'all' | 'chiba' (assembly_id === 'chiba' plus everything whose bbox
 * intersects Chiba's bbox grown by `pad` metres).
 * Adds a flat ground quad at the model's lowest y (the GLB has no terrain).
 */
export async function loadCampus({ subset = 'all', pad = 15 } = {}) {
  const cache = path.join(OUT, `campus-${subset}.bin`);
  if (existsSync(cache)) {
    const buf = await readFile(cache);
    const nPos = buf.readUInt32LE(0), nIdx = buf.readUInt32LE(4);
    const positions = new Float32Array(buf.buffer.slice(buf.byteOffset + 8, buf.byteOffset + 8 + nPos * 4));
    const indices = new Uint32Array(buf.buffer.slice(buf.byteOffset + 8 + nPos * 4, buf.byteOffset + 8 + nPos * 4 + nIdx * 4));
    const meta = JSON.parse(await readFile(cache + '.json', 'utf8'));
    return { positions, indices, ...meta, cached: true };
  }
  const t0 = performance.now();
  const scene = await loadScene();
  const tLoad = performance.now() - t0;
  const meshes = [];
  scene.traverse((o) => { if (o.isMesh && !skip(o)) meshes.push(o); });
  let region = null;
  if (subset === 'chiba') {
    region = new THREE.Box3();
    for (const m of meshes) {
      let a = null;
      for (let p = m; p && !a; p = p.parent) a = p.userData?.assembly_id;
      if (a === 'chiba') region.union(new THREE.Box3().setFromObject(m));
    }
    region.expandByVector(new THREE.Vector3(pad, 0, pad));
    region.min.y = -1e9; region.max.y = 1e9;
  }
  const pos = [], idx = [];
  const v = new THREE.Vector3();
  const bounds = new THREE.Box3();
  let instanced = 0;
  for (const m of meshes) {
    const box = new THREE.Box3().setFromObject(m);
    if (region && !region.intersectsBox(box)) continue;
    const g = m.geometry;
    const p = g.attributes.position;
    const mats = [];
    if (m.isInstancedMesh) {
      instanced++;
      const im = new THREE.Matrix4();
      for (let i = 0; i < m.count; i++) { m.getMatrixAt(i, im); mats.push(new THREE.Matrix4().multiplyMatrices(m.matrixWorld, im)); }
    } else mats.push(m.matrixWorld);
    for (const M of mats) {
      const base = pos.length / 3;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(M);
        pos.push(v.x, v.y, v.z);
        bounds.expandByPoint(v);
      }
      if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
      else for (let i = 0; i < p.count; i++) idx.push(base + i);
    }
  }
  const meshTris = idx.length / 3;
  // ground quad (the model has no terrain), 20 m margin
  const gy = GROUND_Y; // simulation/catalog.json "ground"; some members extend below it
  const x0 = bounds.min.x - 20, x1 = bounds.max.x + 20, z0 = bounds.min.z - 20, z1 = bounds.max.z + 20;
  const gb = pos.length / 3;
  pos.push(x0, gy, z0, x1, gy, z0, x1, gy, z1, x0, gy, z1);
  idx.push(gb, gb + 3, gb + 2, gb, gb + 2, gb + 1); // +Y facing
  const positions = new Float32Array(pos), indices = new Uint32Array(idx);
  const meta = {
    subset, meshTris, tris: indices.length / 3, verts: positions.length / 3, groundY: gy,
    bounds: [bounds.min.toArray(), bounds.max.toArray()], meshes: meshes.length, instanced,
    region: region ? [region.min.x, region.min.z, region.max.x, region.max.z] : null,
    glbLoadMs: Math.round(tLoad),
  };
  await mkdir(OUT, { recursive: true });
  const head = Buffer.alloc(8);
  head.writeUInt32LE(positions.length, 0); head.writeUInt32LE(indices.length, 4);
  await writeFile(cache, Buffer.concat([head, Buffer.from(positions.buffer), Buffer.from(indices.buffer)]));
  await writeFile(cache + '.json', JSON.stringify(meta));
  return { positions, indices, ...meta, cached: false };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const s of ['chiba', 'all']) {
    const t = performance.now();
    const r = await loadCampus({ subset: s });
    const { positions, indices, ...meta } = r;
    console.log(s, JSON.stringify(meta), `${Math.round(performance.now() - t)} ms`);
  }
}

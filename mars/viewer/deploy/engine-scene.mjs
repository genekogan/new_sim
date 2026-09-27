// Offline extractor: Mars 2026 campus GLB + components.json → compact,
// provenance-tagged engine SpatialScene data (public/engine/campus-2026.json).
//   node deploy/engine-scene.mjs            # write
//   node deploy/engine-scene.mjs --check    # re-extract, compare contentHash, write nothing
// Loading mirrors deploy/catalog.mjs / experiments/nav-eval/lib/campus.mjs:
// strip images/materials so GLTFLoader never touches the DOM.
import { readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { extractObstacles, GROUND_Y, LOW_BAND } from '../engine/campus/extract.ts';
import { buildRegions } from '../engine/campus/regions.ts';
import { hashOf } from '../engine/core/hash.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const GLB = 'public/browser/campus.glb';
const MANIFEST = 'public/modular/components.json';
const OUT = 'public/engine/campus-2026.json';
const SKIP_ASSEMBLIES = new Set(['people', 'reference-ground']);
const SKIP_KINDS = new Set(['context_person', 'context_group', 'reference']);

async function loadScene() {
  const b = await readFile(path.join(ROOT, GLB));
  const len = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + len));
  const materialNames = (j.materials || []).map((m) => m.name || '');
  j.images = []; j.textures = []; j.materials = (j.materials || []).map(() => ({}));
  let json = Buffer.from(JSON.stringify(j));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 32)]);
  const bin = b.subarray(20 + len);
  const header = Buffer.alloc(20);
  header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + json.length + bin.length, 8);
  header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const s = Buffer.concat([header, json, bin]);
  await MeshoptDecoder.ready;
  const { scene } = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(s.buffer.slice(s.byteOffset, s.byteOffset + s.byteLength), '');
  scene.updateMatrixWorld(true);
  return { scene, bytes: b.length, materialNames };
}

function ownerOf(o) {
  for (let p = o; p; p = p.parent) if (p.userData?.component_id) return p;
  return null;
}
function skipped(o) {
  for (let p = o; p; p = p.parent) {
    const u = p.userData || {};
    if (SKIP_KINDS.has(u.kind) || SKIP_ASSEMBLIES.has(u.assembly_id) || u.layer === 'Aerial reference') return true;
  }
  return false;
}

export async function extract() {
  const t0 = performance.now();
  const manifest = JSON.parse(await readFile(path.join(ROOT, MANIFEST), 'utf8'));
  const byId = new Map(manifest.instances.map((i) => [i.id, i]));
  const assemblyNames = Object.fromEntries(manifest.assemblies.map((a) => [a.id, a.name]));
  const { scene, bytes } = await loadScene();
  const tLoad = performance.now() - t0;
  const tris = new Map(); // component id → number[]
  const extras = new Map();
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    if (!o.isMesh || skipped(o)) return;
    const owner = ownerOf(o);
    if (!owner) return;
    const id = owner.userData.component_id;
    extras.set(id, owner.userData);
    let arr = tris.get(id);
    if (!arr) tris.set(id, (arr = []));
    const g = o.geometry, p = g.attributes.position, idx = g.index;
    const n = idx ? idx.count : p.count;
    for (let k = 0; k < n; k++) {
      v.fromBufferAttribute(p, idx ? idx.getX(k) : k).applyMatrix4(o.matrixWorld);
      arr.push(v.x, v.y, v.z);
    }
  });
  const components = [...tris.entries()].map(([id, a]) => {
    const u = extras.get(id), m = byId.get(id);
    return { id, kind: u.kind, layer: u.layer, assembly: u.assembly_id ?? m?.assembly_id ?? 'unknown', accuracy: u.accuracy, ancestors: m?.source_ancestors ?? [], tris: Float64Array.from(a) };
  });
  const ex = extractObstacles(components, assemblyNames);
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const r of ex.rows) {
    const e = Math.hypot(r[4], r[5]);
    minX = Math.min(minX, r[2] - e); maxX = Math.max(maxX, r[2] + e); minZ = Math.min(minZ, r[3] - e); maxZ = Math.max(maxZ, r[3] + e);
  }
  const m = 10; // open-ground margin beyond the outermost object
  const bounds = [Math.floor(minX - m), Math.floor(minZ - m), Math.ceil(maxX + m), Math.ceil(maxZ + m)];
  const file = {
    schema: 'mars-campus-scene/1',
    campus: 'mars-2026',
    generator: 'deploy/engine-scene.mjs',
    source: { glb: GLB, glbBytes: bytes, manifest: MANIFEST, status: manifest.status },
    groundY: GROUND_Y,
    bands: { low: LOW_BAND, note: 'low prisms = geometry within the ground body band; .up = above it; interior: = covered space under building roofs (non-walkable by rule)' },
    bounds,
    assemblies: manifest.assemblies.filter((a) => !SKIP_ASSEMBLIES.has(a.id)).map((a) => ({ id: a.id, name: a.name })),
    labels: ex.labels,
    obstacles: ex.rows,
    regions: [],
    stats: { ...ex.stats, glbLoadMs: 0, extractMs: 0 },
  };
  const t1 = performance.now();
  file.regions = buildRegions(file);
  const timing = { glbLoadMs: Math.round(tLoad), extractMs: Math.round(t1 - t0 - tLoad), regionsMs: Math.round(performance.now() - t1) };
  delete file.stats.glbLoadMs; delete file.stats.extractMs;
  file.contentHash = hashOf(file);
  return { file, timing };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { file, timing } = await extract();
  const out = path.join(ROOT, OUT);
  if (process.argv.includes('--check')) {
    const prev = JSON.parse(await readFile(out, 'utf8'));
    const same = prev.contentHash === file.contentHash;
    console.log(same ? 'deterministic: contentHash matches' : `MISMATCH ${prev.contentHash} != ${file.contentHash}`, timing);
    process.exit(same ? 0 : 1);
  }
  await writeFile(out, JSON.stringify(file));
  console.log({ out: OUT, bytes: (await stat(out)).size, obstacles: file.obstacles.length, regions: file.regions.map((r) => r.id), stats: file.stats, bounds: file.bounds, timing, hash: file.contentHash.slice(0, 16) });
}

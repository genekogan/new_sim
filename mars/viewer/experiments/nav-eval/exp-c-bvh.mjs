// Experiment C: three-mesh-bvh OBB-vs-mesh queries (no native sweep: sample poses).
// Run: node exp-c-bvh.mjs
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { OBB } from 'three/addons/math/OBB.js';
import { provingGround } from '../../engine/scenes/proving-ground.ts';
import { sceneToMesh } from './lib/scene-to-mesh.mjs';
import { loadCampus } from './lib/campus.mjs';
import { now, time, r2, save } from './lib/util.mjs';

const geom = (m) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3)); g.setIndex(new THREE.BufferAttribute(m.indices, 1)); return g; };
const I = new THREE.Matrix4();
// beam 5.8 x 0.1 x 0.1 as an oriented box in world space; test via intersectsBox(box3, boxToMesh matrix)
const beamBox = new THREE.Box3(new THREE.Vector3(-2.9, -0.05, -0.05), new THREE.Vector3(2.9, 0.05, 0.05));
const pose = (x, y, z, yaw) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
const out = {};
{
  const g = geom(sceneToMesh(provingGround()));
  const [bvh, ms] = time(() => new MeshBVH(g));
  // sampled sweep of the beam from x=-22 to -12 at z=-15 (wall at x=-15): step 0.05 m
  let firstHit = null, samples = 0;
  const t = now();
  for (let x = -22; x <= -12; x += 0.05) { samples++; if (bvh.intersectsBox(beamBox, pose(x, 1, -15, 0))) { firstHit = r2(x); break; } }
  const sweepMs = now() - t;
  const endOn = [...Array(200).keys()].some((i) => bvh.intersectsBox(beamBox, pose(15, 1, -20 + i * 0.05, Math.PI / 2)));
  out.proving = { buildMs: r2(ms), beamFirstHitX: firstHit, samplesToHit: samples, sweepMs: r2(sweepMs), endOnThroughGapHits: endOn };
}
{
  const geo = await loadCampus({ subset: 'chiba' });
  const g = geom(geo);
  const [bvh, ms] = time(() => new MeshBVH(g));
  let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const poses = Array.from({ length: 5000 }, () => pose(-25 + rnd() * 55, 1.1, -30 + rnd() * 45, rnd() * 6.28));
  let hits = 0; const t = now();
  for (const p of poses) if (bvh.intersectsBox(beamBox, p)) hits++;
  const us = ((now() - t) / poses.length) * 1000;
  // capsule-ish: sphere queries via shapecast (closest point) for a 0.28 m body at waist
  const sphere = new THREE.Sphere(new THREE.Vector3(), 0.28);
  let sh = 0; const t2 = now();
  for (const p of poses) { sphere.center.setFromMatrixPosition(p); if (bvh.intersectsSphere(sphere)) sh++; }
  const sus = ((now() - t2) / poses.length) * 1000;
  const serialized = MeshBVH.serialize(bvh);
  out.campusChiba = { tris: geo.tris, buildMs: r2(ms), obbUs: r2(us), hitRate: r2(hits / poses.length), sphereUs: r2(sus), serializedMB: r2(serialized.index.byteLength / 1048576 + serialized.roots.reduce((a, r) => a + r.byteLength, 0) / 1048576) };
}
console.log(JSON.stringify(out));
save('exp-c-bvh.json', out);

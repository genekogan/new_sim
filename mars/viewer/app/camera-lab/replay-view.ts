// Camera-owned review renderer, reusing actual engine TakePeople. Replay clearly labeled.
import * as THREE from 'three';
import { TakePeople } from '../engine-view/take-replay.ts';
import { loadTemplates } from '../engine-view/people.ts';
import { ThreeResources } from '../../lib/three-resources.ts';
import { replayFrame } from '../../cinematography/replay.ts';
import type { ProgramFrame } from '../../cinematography/replay.ts';
import type { Take } from '../../engine/take/types.ts';
import type { SpatialScene } from '../../engine/spatial/types.ts';
const query = new URLSearchParams(location.search),
  policy = query.get('policy') ?? 'clear';
const data = (await (
  await fetch('/e2e/artifacts/codex-autonomous-camera-comparison/sequence.json')
).json()) as {
  branch: string;
  commit: string;
  take: Take;
  scene: SpatialScene;
  policies: Record<string, { frames: ProgramFrame[] }>;
};
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
document.getElementById('view')!.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#bcd3e4');
scene.add(new THREE.HemisphereLight('#dfefff', '#8a7355', 1.3));
const sun = new THREE.DirectionalLight('#fff4e0', 2.4);
sun.position.set(10, 20, 8);
scene.add(sun);
const resources = new ThreeResources(),
  abort = new AbortController();
const templates = await loadTemplates(abort.signal, resources);
const people = new TakePeople(data.take, { scene: data.scene });
people.setTemplates(templates);
scene.add(people.group);
const geometry: THREE.BufferGeometry[] = [],
  materials: THREE.Material[] = [];
const box = (
  sx: number,
  sy: number,
  sz: number,
  x: number,
  y: number,
  z: number,
  color: string,
) => {
  const g = new THREE.BoxGeometry(sx, sy, sz),
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
  geometry.push(g);
  materials.push(m);
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  return mesh;
};
box(32, 0.1, 32, 0, -0.05, 0, '#a89575');
for (const o of data.scene.obstacles.filter((o) => o.id.endsWith('wall'))) {
  const m = box(
    o.obb.half[0] * 2,
    o.y1 - o.y0,
    o.obb.half[1] * 2,
    o.obb.c[0],
    (o.y0 + o.y1) / 2,
    o.obb.c[1],
    '#baae91',
  );
  m.rotation.y = -o.obb.yaw;
}
const partition = box(0.24, 2.5, 5, 2.2, 1.25, -2.7, '#b27646');
partition.visible = false;
const camera = new THREE.PerspectiveCamera(
  45,
  innerWidth / innerHeight,
  0.1,
  400,
);
let time = 0,
  start = 0,
  playing = false,
  raf = 0;
document.querySelector('#label')!.textContent =
  `REPLAY · ${policy} · same recorded world · ${data.branch} · ${data.commit?.slice(0, 7)} · camera-owned partition58–64s`;
function draw() {
  const frame = replayFrame(data.policies[policy].frames, time);
  people.show(time);
  partition.visible = time >= 58 && time < 64;
  if (frame) {
    camera.position.fromArray(frame.pose.position);
    camera.lookAt(...frame.pose.target);
    camera.fov = frame.pose.fov;
    camera.updateProjectionMatrix();
  }
  renderer.render(scene, camera);
  document.querySelector('#status')!.textContent =
    `${time.toFixed(1)}s · ${frame?.shot ?? 'no feasible pose'} · ${partition.visible ? 'SYNTHETIC OCCLUSION FIXTURE' : 'recorded classroom'} · replay head attention unsupported`;
}
const loop = (wall: number) => {
  if (playing) {
    time = Math.min(70, (wall - start) / 1000);
    draw();
    if (time >= 70) playing = false;
  }
  raf = requestAnimationFrame(loop);
};
raf = requestAnimationFrame(loop);
draw();
const hook = {
  ready: true,
  play() {
    start = performance.now() - time * 1000;
    playing = true;
  },
  seek(t: number) {
    playing = false;
    time = t;
    draw();
  },
  state: () => ({ time, playing, policy }),
  dispose() {
    playing = false;
    cancelAnimationFrame(raf);
    abort.abort();
    people.dispose();
    resources.dispose();
    geometry.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    renderer.dispose();
  },
};
(window as unknown as { __cameraReplay: typeof hook }).__cameraReplay = hook;
window.addEventListener('beforeunload', () => hook.dispose());

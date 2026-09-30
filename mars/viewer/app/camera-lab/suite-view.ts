// Development-only comparison. Same actual recorded world in both viewports.
import * as THREE from 'three';
import { TakePeople } from '../engine-view/take-replay.ts';
import { loadTemplates } from '../engine-view/people.ts';
import { ThreeResources } from '../../lib/three-resources.ts';
import { replayFrame } from '../../cinematography/replay.ts';
import type { ProgramFrame } from '../../cinematography/replay.ts';
import type { Observation, Policy } from '../../cinematography/types.ts';
import type { Take } from '../../engine/take/types.ts';
const data = (await (
  await fetch('/e2e/artifacts/codex-autonomous-camera-suite/suite.json')
).json()) as {
  branch: string;
  commit: string;
  cases: {
    id: string;
    label: string;
    note: string;
    window: number;
    take: Take;
    observations: Observation[];
    policies: Record<Policy, { frames: ProgramFrame[] }>;
  }[];
};
const resources = new ThreeResources(),
  abort = new AbortController(),
  templates = await loadTemplates(abort.signal, resources);
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setSize(1280, 720);
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
document.body.appendChild(renderer.domElement);
const query = new URLSearchParams(location.search),
  single = query.get('case');
const selected = single
  ? data.cases.filter((c) => c.id === single)
  : data.cases;
let index = -1,
  time = 0,
  start = 0,
  playing = false,
  raf = 0;
type View = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  people: TakePeople;
  partition: THREE.Mesh;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
};
let views: View[] = [];
function disposeViews() {
  for (const v of views) {
    v.people.dispose();
    v.geometries.forEach((g) => g.dispose());
    v.materials.forEach((m) => m.dispose());
  }
  views = [];
}
function create(c: (typeof selected)[number]): View {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#bcd3e4');
  scene.add(new THREE.HemisphereLight('#dfefff', '#8a7355', 1.3));
  const sun = new THREE.DirectionalLight('#fff4e0', 2.4);
  sun.position.set(10, 20, 8);
  scene.add(sun);
  const geometries: THREE.BufferGeometry[] = [],
    materials: THREE.Material[] = [];
  const box = (
    sx: number,
    sy: number,
    sz: number,
    x: number,
    y: number,
    z: number,
    color: string,
    yaw = 0,
  ) => {
    const g = new THREE.BoxGeometry(sx, sy, sz),
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
    geometries.push(g);
    materials.push(m);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.rotation.y = -yaw;
    scene.add(mesh);
    return mesh;
  };
  box(120, 0.1, 120, 0, -0.05, 0, '#a89575');
  for (const o of c.observations[0].scene.obstacles) {
    if (c.take.finalState.entities[o.id]) continue;
    box(
      o.obb.half[0] * 2,
      o.y1 - o.y0,
      o.obb.half[1] * 2,
      o.obb.c[0],
      (o.y0 + o.y1) / 2,
      o.obb.c[1],
      '#baae91',
      o.obb.yaw,
    );
  }
  const partition = box(0.24, 2.5, 5, 2.2, 1.25, -2.7, '#b27646');
  partition.visible = false;
  const people = new TakePeople(c.take, { scene: c.observations[0].scene });
  people.setTemplates(templates);
  scene.add(people.group);
  return {
    scene,
    people,
    partition,
    geometries,
    materials,
    camera: new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 400),
  };
}
function draw() {
  const next = Math.min(selected.length - 1, Math.floor(time / 15)),
    c = selected[next];
  if (next !== index) {
    disposeViews();
    index = next;
    views = [create(c), create(c)];
  }
  const local = c.window + (time % 15);
  const policies: Policy[] =
    c.id === 'walking'
      ? ['continuous', 'clear']
      : c.id === 'operator'
        ? ['continuous', 'clear']
        : ['clear', 'restrained'];
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, 1280, 720);
  renderer.setClearColor('#101820');
  renderer.clear();
  renderer.setScissorTest(true);
  for (let i = 0; i < 2; i++) {
    const v = views[i],
      p = policies[i],
      frame = replayFrame(c.policies[p].frames, local);
    v.people.show(local);
    v.partition.visible = c.id === 'operator' && local >= 24 && local < 32;
    if (frame) {
      v.camera.position.fromArray(frame.pose.position);
      v.camera.lookAt(...frame.pose.target);
      v.camera.fov = frame.pose.fov;
      v.camera.updateProjectionMatrix();
    }
    renderer.setViewport(i * 640, 180, 640, 360);
    renderer.setScissor(i * 640, 180, 640, 360);
    renderer.render(v.scene, v.camera);
    document.querySelector(i ? '#right' : '#left')!.textContent =
      `${p} · ${frame?.shot ?? 'NO FEASIBLE VIEW'}`;
  }
  document.querySelector('#title')!.textContent =
    `REPLAY · ${c.label} · ${data.branch} · ${data.commit.slice(0, 7)}`;
  document.querySelector('#status')!.textContent =
    `${local.toFixed(1)}s world time · same take in both views. ${c.note} Remaining limits: recorded head attention unsupported; camera-only wall recovery may cut; initial baseline may show backs/foreground obstruction.`;
}
raf = requestAnimationFrame(function loop(wall) {
  if (playing) {
    time = Math.min(selected.length * 15 - 0.001, (wall - start) / 1000);
    draw();
    if (time >= selected.length * 15 - 0.001) playing = false;
  }
  raf = requestAnimationFrame(loop);
});
draw();
const hook = {
  ready: true,
  play() {
    start = performance.now() - time * 1000;
    playing = true;
  },
  seek(t: number) {
    time = t;
    draw();
  },
  state: () => ({ time, playing, index }),
  dispose() {
    playing = false;
    cancelAnimationFrame(raf);
    disposeViews();
    abort.abort();
    resources.dispose();
    renderer.dispose();
  },
};
(window as unknown as { __cameraSuite: typeof hook }).__cameraSuite = hook;
window.addEventListener('beforeunload', () => hook.dispose());

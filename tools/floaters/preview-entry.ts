// Preview page for the floater renderer (bundled by preview.mjs). Draws the seven floaters through
// the real FloaterView + engine/bodies pose code from a synthetic sampled frame, with a 1.75 m human
// reference post and yaw arrows, so facing, scale and hover can be checked by eye.
//   ?mode=lineup  all seven face the camera (engine yaw +π/2 = +z, toward the camera)
//   ?mode=side    all seven face engine yaw 0 (+x, to the right); arrows show the expected facing
//   ?mode=kin     the background kin subset as scenery around two floaters
//   ?tick=N       sampled tick (bob/tilt/yaw are pure functions of it)
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FloaterView, KinScenery } from '../../mars/viewer/app/engine-view/floaters.ts';
import { FLOATER_MODELS } from '../../mars/viewer/engine/bodies/models.ts';
import type { SampledEntity } from '../../mars/viewer/engine/take/replay.ts';

const q = new URLSearchParams(location.search);
const mode = q.get('mode') ?? 'lineup';
const tick = Number(q.get('tick') ?? 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x20232b);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.7;
const sun = new THREE.DirectionalLight(0xffe3bd, 2.2);
sun.position.set(6, 10, 8);
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x8a6a4f, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
scene.add(new THREE.GridHelper(60, 60, 0x553f2f, 0x6d533f));

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 200);
const opts = { baseUrl: '/worlds/littlemartians/characters/', dracoDecoderPath: '/tools/floaters/node_modules/three/examples/jsm/libs/draco/gltf/' };
const view = new FloaterView(scene, opts);
const frame: Record<string, SampledEntity> = {};
const chars = FLOATER_MODELS.filter((m) => m.group === 'floater');

function post(x: number, z: number) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.75, 8), new THREE.MeshStandardMaterial({ color: 0xffffff }));
  m.position.set(x, 0.875, z);
  scene.add(m);
}
function arrow(x: number, z: number, yaw: number) {
  scene.add(new THREE.ArrowHelper(new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw)), new THREE.Vector3(x, 0.02, z), 0.8, 0xffd040, 0.2, 0.12));
}

if (mode === 'axes') {
  // six raw views of one model (no facing offset): +X −X +Y(top) −Y(bottom) +Z −Z, labelled in the shot name
  const id = q.get('model') ?? 'verdelis';
  const m = FLOATER_MODELS.find((x) => x.id === id)!;
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');
  const g = await new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath(opts.dracoDecoderPath)).loadAsync(opts.baseUrl + m.file);
  const box = new THREE.Box3().setFromObject(g.scene);
  const c = box.getCenter(new THREE.Vector3());
  const s = 1 / Math.max(...box.getSize(new THREE.Vector3()).toArray());
  const holder = new THREE.Group();
  g.scene.position.sub(c);
  holder.add(g.scene);
  holder.scale.setScalar(s);
  holder.position.set(0, 50, 0);
  scene.add(holder);
  scene.add(new THREE.AxesHelper(0.8).translateY(50));
  const W = innerWidth / 3, H = innerHeight / 2;
  const dirs: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  renderer.setScissorTest(true);
  dirs.forEach((d, i) => {
    const cam = new THREE.PerspectiveCamera(35, W / H, 0.01, 50);
    cam.position.set(d[0] * 2, 50 + d[1] * 2, d[2] * 2);
    cam.up.set(0, d[1] ? 0 : 1, d[1] ? -1 : 0);
    cam.lookAt(0, 50, 0);
    const x = (i % 3) * W, y = (1 - Math.floor(i / 3)) * H;
    renderer.setViewport(x, y, W, H);
    renderer.setScissor(x, y, W, H);
    renderer.render(scene, cam);
  });
  (window as unknown as { __ready: boolean }).__ready = true;
  throw new Error('axes done');
} else if (mode === 'kin') {
  const kin = new KinScenery(scene, opts);
  const ks = FLOATER_MODELS.filter((m) => m.group === 'kin');
  kin.place(ks.map((m, i) => ({ model: m.id, p: [-4 + i * 1.6, 0.9 + (i % 3) * 0.7, -3 - (i % 2) * 1.5] })));
  kin.update(tick);
  for (const [i, id] of ['verdelis', 'mycos'].entries()) {
    view.add(id, { family: 'floater', model: id });
    frame[id] = { p: [-1 + i * 2, 0, 1], yaw: Math.PI / 2, pitch: 0, roll: 0, state: {} };
  }
  post(0, 1);
  camera.position.set(0, 2.2, 8);
  camera.lookAt(0, 1.4, -1);
  await kin.ready();
} else {
  const yaw = mode === 'side' ? 0 : Math.PI / 2;
  chars.forEach((m, i) => {
    const x = (i - (chars.length - 1) / 2) * 1.3;
    view.add(m.id, { family: 'floater', model: m.id });
    frame[m.id] = { p: [x, 0, 0], yaw, pitch: 0, roll: 0, state: {} };
    arrow(x, 0, yaw);
  });
  post(-5.6, 0);
  camera.position.set(0, mode === 'side' ? 1.6 : 1.7, mode === 'side' ? 7 : 6);
  camera.lookAt(0, 1.3, 0);
}
view.update(frame, tick);
await view.ready();
view.update(frame, tick);
renderer.render(scene, camera);
(window as unknown as { __ready: boolean }).__ready = true;

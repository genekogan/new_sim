import * as THREE from 'three';
import { loadGltf, ThreeResources } from '../../lib/three-resources.ts';

export const RETRO_COMPUTER_URL = '/models/retro-computer-monitor.glb';
export interface WorkstationAppearanceState {
  status: 'loading' | 'ready' | 'failed' | 'disposed';
  modelUrl: string;
  diagnostic?: string;
  bounds?: { min: [number, number, number]; max: [number, number, number] };
}
export interface WorkstationAppearanceOptions {
  kind: 'retro-computer';
  onStatus?: (state: WorkstationAppearanceState) => void;
}

/** Fit the complete transformed model, including peripherals, above the ordinary desk. */
export function fitWorkstationModel(model: THREE.Object3D, sx: number, sy: number, sz: number, desktop: number) {
  const fitted = new THREE.Group();
  fitted.add(model);
  fitted.rotation.y = -Math.PI / 2; // source monitor faces -X; worker approaches -Z
  fitted.updateMatrixWorld(true);
  const source = new THREE.Box3().setFromObject(fitted, true);
  const size = source.getSize(new THREE.Vector3());
  const space = new THREE.Vector3(sx - 0.16, sy - desktop - 0.006, sz - 0.08);
  if (![...size.toArray(), ...space.toArray()].every(v => Number.isFinite(v) && v > 0))
    throw Error('Imported workstation has empty bounds or cannot fit the desktop envelope');
  const scale = Math.min(space.x / size.x, space.y / size.y, space.z / size.z);
  fitted.scale.setScalar(scale);
  fitted.position.set(-source.getCenter(new THREE.Vector3()).x * scale, desktop + 0.003 - source.min.y * scale, -source.getCenter(new THREE.Vector3()).z * scale);
  fitted.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(fitted, true);
  return { fitted, bounds: { min: box.min.toArray() as [number, number, number], max: box.max.toArray() as [number, number, number] } };
}

/** Authored CRT palette region in this one attributed asset; preserve its curved faces. */
export function attachWorkstationScreen(model: THREE.Object3D, material: THREE.Material, resources: ThreeResources) {
  const monitor = model.getObjectByName('Monitor.002_RetroPalette2_0');
  if (!(monitor instanceof THREE.Mesh) || Array.isArray(monitor.material)) throw Error('Imported computer CRT mesh is unavailable');
  const original = monitor.geometry;
  const uv = original.getAttribute('uv'), positions = original.getAttribute('position'), index = original.index;
  if (!uv || !positions || !index) throw Error('Imported computer CRT geometry is unavailable');
  model.updateMatrixWorld(true);
  const selected = (i: number) => Math.abs(uv.getX(i) - 0.188) < 0.001 && Math.abs(uv.getY(i) - 0.858) < 0.001;
  const screenBounds = new THREE.Box3();
  for (let i = 0; i < positions.count; i++) if (selected(i)) screenBounds.expandByPoint(new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(monitor.matrixWorld));
  const size = screenBounds.getSize(new THREE.Vector3());
  if (!(size.y > 0 && size.z > 0)) throw Error('Imported computer CRT face region is unavailable');
  const geometry = original.clone();
  geometry.clearGroups();
  const mapped = geometry.getAttribute('uv');
  for (let i = 0; i < positions.count; i++) if (selected(i)) {
    const point = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(monitor.matrixWorld);
    mapped.setXY(i, (point.z - screenBounds.min.z) / size.z, (point.y - screenBounds.min.y) / size.y);
  }
  let faces = 0;
  for (let i = 0; i < index.count; i += 3) {
    const screen = [0, 1, 2].every(k => selected(index.getX(i + k)));
    const materialIndex = screen ? 1 : 0;
    const previous = geometry.groups.at(-1);
    // Preserve indexed triangle order while drawing each contiguous material run once.
    if (previous?.materialIndex === materialIndex) previous.count += 3;
    else geometry.addGroup(i, 3, materialIndex);
    if (screen) faces++;
  }
  if (!faces) { geometry.dispose(); throw Error('Imported computer CRT triangles are unavailable'); }
  monitor.geometry = geometry;
  resources.object(monitor); // own cloned geometry and existing material; caller owns live canvas
  monitor.material = [monitor.material, material];
  return faces;
}

export function importedWorkstation(parent: THREE.Group, texture: THREE.Texture, sx: number, sy: number, sz: number, desktop: number, options: WorkstationAppearanceOptions, ready: () => void) {
  const resources = new ThreeResources(), controller = new AbortController();
  const screen = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
  let current: WorkstationAppearanceState = { status: 'loading', modelUrl: RETRO_COMPUTER_URL };
  let closed = false;
  let fitted: THREE.Group | undefined;
  const state = () => structuredClone(current);
  const publish = () => options.onStatus?.(state());
  publish();
  void loadGltf(RETRO_COMPUTER_URL, controller.signal, resources).then(async gltf => {
    // Three no longer supports this source's legacy specular/glossiness extension.
    // Retain its embedded diffuse palette through the ordinary texture dependency.
    const palette = await gltf.parser.getDependency('texture', 0) as THREE.Texture;
    palette.colorSpace = THREE.SRGBColorSpace;
    gltf.scene.traverse(object => {
      if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial) {
        object.material.map = palette;
        object.material.color.set(0xffffff);
        object.material.roughness = 1;
        object.material.needsUpdate = true;
      }
    });
    resources.object(gltf.scene); // also disposes palette if reset happened during decode
    if (closed) return;
    attachWorkstationScreen(gltf.scene, screen, resources);
    const fit = fitWorkstationModel(gltf.scene, sx, sy, sz, desktop);
    fitted = fit.fitted;
    parent.add(fitted);
    ready();
    current = { status: 'ready', modelUrl: RETRO_COMPUTER_URL, bounds: fit.bounds };
    publish();
  }).catch(error => {
    if (closed) return;
    resources.dispose();
    screen.dispose();
    current = { status: 'failed', modelUrl: RETRO_COMPUTER_URL, diagnostic: `appearance.load-failed: retro computer unavailable; primitive retained: ${error instanceof Error ? error.message : String(error)}` };
    publish();
  });
  return { state, dispose() {
    if (closed) return;
    closed = true;
    controller.abort();
    fitted?.removeFromParent();
    resources.dispose();
    screen.dispose();
    current = { ...current, status: 'disposed' };
    publish();
  } };
}

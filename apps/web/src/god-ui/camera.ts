// Fly the world camera somewhere (flags, preview ghosts). Uses the handles the
// world page exposes as window.__simEntity; keeps the current viewing direction.
import * as THREE from 'three';

type Sim = { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3; update?: () => void } };
let flight = 0;

export function canFly(): boolean { return !!(window as unknown as { __simEntity?: Sim }).__simEntity?.camera; }

/** Ease the camera over `ms` to look at (x, y, z) from `distance` metres, same heading as now. */
export function flyTo(x: number, y: number, z: number, { distance = 45, ms = 900 }: { distance?: number; ms?: number } = {}) {
  const sim = (window as unknown as { __simEntity?: Sim }).__simEntity; if (!sim?.camera) return false;
  const { camera, controls } = sim;
  const fromT = controls.target.clone(), fromP = camera.position.clone();
  const dir = fromP.clone().sub(fromT); if (dir.lengthSq() < 1e-6) dir.set(-0.6, 0.5, 0.7);
  dir.normalize();
  if (dir.y < 0.35) { dir.y = 0.35; dir.normalize(); }   // never skim the ground
  const toT = new THREE.Vector3(x, y, z), toP = toT.clone().addScaledVector(dir, distance);
  const t0 = performance.now(), id = ++flight;
  const step = (now: number) => {
    if (id !== flight) return;
    const k = Math.min(1, (now - t0) / ms), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    controls.target.lerpVectors(fromT, toT, e); camera.position.lerpVectors(fromP, toP, e); camera.lookAt(controls.target); controls.update?.();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return true;
}

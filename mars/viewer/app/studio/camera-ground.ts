import * as THREE from 'three';

/** Enforce the terrain boundary after all controls, immediately before rendering.
 * Keep the near plane above the soil too, including wide views and tilted cameras.
 */
export function keepCameraAboveGround(
  camera: THREE.PerspectiveCamera,
  target?: THREE.Vector3,
  ground = -0.16,
) {
  const halfHeight =
    (camera.near * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) /
    camera.zoom;
  const nearRadius = Math.hypot(
    camera.near,
    halfHeight,
    halfHeight * camera.aspect,
  );
  const minimum = ground + Math.max(0.2, nearRadius + 0.02);
  let changed = false;
  if (camera.position.y < minimum) {
    camera.position.y = minimum;
    changed = true;
  }
  if (target && target.y < ground) {
    target.y = ground;
    changed = true;
  }
  if (changed) {
    if (target) camera.lookAt(target);
    camera.updateMatrixWorld();
  }
}

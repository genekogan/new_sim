import * as THREE from 'three';

const PERIOD = 60;
const TAU = Math.PI * 2;

/** One slow orbit with a small three-lobed epicycle. The angular warp spends
 * roughly three quarters of each lap outside the rider, looking toward Chiba.
 * Bearing points from Chiba to the rider; phase zero is the preferred backdrop.
 */
export function eucFollowOffset(
  seconds: number,
  bearing: number,
  out: THREE.Vector3,
) {
  const phase = ((seconds % PERIOD) / PERIOD) * TAU;
  const angle = phase - 1.2 * Math.sin(phase);
  const outward = 9 * Math.cos(angle) + 1.1 * Math.cos(3 * phase);
  const sideways = 9 * Math.sin(angle) + 1.1 * Math.sin(3 * phase);
  return out.set(
    Math.cos(bearing) * outward - Math.sin(bearing) * sideways,
    3 + 0.45 * Math.sin(2 * phase),
    Math.sin(bearing) * outward + Math.cos(bearing) * sideways,
  );
}

/** Reuses vectors and smooths offsets, rather than lagging behind the moving
 * rider. The camera's entry pose blends in without teleporting. Hidden tabs and
 * paused rooms pass no elapsed time, so the local camera does not jump ahead.
 */
export function createEucFollowCamera() {
  let seconds = 0;
  let bearing = 0;
  const offset = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const riderAim = new THREE.Vector3(0, 1.6, 0);
  return {
    start(
      rider: THREE.Vector3,
      chiba: THREE.Vector3,
      camera: THREE.Vector3,
      target: THREE.Vector3,
    ) {
      seconds = 0;
      bearing = Math.atan2(rider.z - chiba.z, rider.x - chiba.x);
      offset.copy(camera).sub(rider);
      aim.copy(target).sub(rider);
    },
    update(
      dt: number,
      rider: THREE.Vector3,
      chiba: THREE.Vector3,
      camera: THREE.Vector3,
      target: THREE.Vector3,
    ) {
      seconds += dt;
      if (Math.hypot(rider.x - chiba.x, rider.z - chiba.z) > 1) {
        const next = Math.atan2(rider.z - chiba.z, rider.x - chiba.x);
        // Follow the shortest angular arc across the -pi/pi seam.
        bearing +=
          Math.atan2(Math.sin(next - bearing), Math.cos(next - bearing)) *
          (1 - Math.exp(-3 * dt));
      }
      eucFollowOffset(seconds, bearing, desired);
      const blend = 1 - Math.exp(-2.5 * dt);
      offset.lerp(desired, blend);
      aim.lerp(riderAim, blend);
      camera.copy(rider).add(offset);
      target.copy(rider).add(aim);
    },
  };
}

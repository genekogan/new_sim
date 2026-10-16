import * as THREE from 'three';
// todo (leisure): a dock bicycle under a cycling body (engine gait 'cycle', 4.5 m/s). The engine moves the body point; the
// viewer seats the rider on the saddle, turns the cranks with the distance covered, and draws the bicycle along the heading.
// Local frame: +x forward, +y up, +z right (holder convention: engine yaw 0 faces +x).

/** Saddle top above the ground (m): the rider's seat height while cycling. */
export const BIKE_SADDLE = 0.8;
/** Crank centre (forward, up) from the body point and crank radius (m). */
export const CRANK: readonly [number, number] = [0.2, 0.3], CRANK_R = 0.17;
const WHEEL_R = 0.33, WHEEL_BASE = [-0.42, 0.62] as const;
/** Crank angle for a distance ridden: about one turn every 4.4 m (a middle gear on a 0.66 m wheel). */
export const crankAngle = (metres: number) => (metres / 4.4) * Math.PI * 2;

/** Where a pedal is, in the bicycle's local frame, for leg `side` (+1 right, -1 left) at crank angle `a`. */
export function pedalLocal(a: number, side: number): [number, number, number] {
  // the crank arm for this side points up (side +1) or down (side -1) at a = 0 and turns forward (top moving +x) as a grows
  return [CRANK[0] + side * Math.sin(a) * CRANK_R, CRANK[1] + side * Math.cos(a) * CRANK_R, side * 0.13];
}

const mats = new Map<string, THREE.MeshStandardMaterial>();
const mat = (c: string) => { let m = mats.get(c); if (!m) mats.set(c, m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.2 })); return m; };
const COLORS = ['#c43a2a', '#3d5a80', '#2f6f4f', '#e0b04a'];
/** One bicycle (frame colour by index): wheels, frame, saddle, bars and the crank set (child 'crank', turned about z). */
export function makeBicycle(colour = 0): THREE.Group {
  const g = new THREE.Group(), frame = mat(COLORS[colour % COLORS.length]), dark = mat('#1e1e1e'), steel = mat('#9aa0a6');
  const tube = (a: [number, number], b: [number, number], r = 0.018, m = frame, z = 0) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), m);
    t.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z); t.rotation.z = Math.atan2(b[1] - a[1], b[0] - a[0]) - Math.PI / 2; g.add(t); return t;
  };
  for (const x of WHEEL_BASE) {
    const w = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R, 0.022, 6, 20), dark); w.position.set(x, WHEEL_R, 0); g.add(w);
    for (let k = 0; k < 3; k++) { const s = tube([x - Math.cos(k) * WHEEL_R, WHEEL_R - Math.sin(k) * WHEEL_R], [x + Math.cos(k) * WHEEL_R, WHEEL_R + Math.sin(k) * WHEEL_R], 0.004, steel); s.name = 'spoke'; }
  }
  const bb: [number, number] = [CRANK[0], CRANK[1]], seat: [number, number] = [-0.08, BIKE_SADDLE - 0.04], head: [number, number] = [0.5, 0.86];
  tube(bb, seat); tube(seat, head); tube(bb, head); tube(bb, [WHEEL_BASE[0], WHEEL_R]); tube(seat, [WHEEL_BASE[0], WHEEL_R]); tube(head, [WHEEL_BASE[1], WHEEL_R]);
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.13), dark); saddle.position.set(seat[0] - 0.02, BIKE_SADDLE - 0.02, 0); g.add(saddle);
  tube(head, [0.46, 1.02], 0.016, steel);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.52, 6), dark); bar.rotation.x = Math.PI / 2; bar.position.set(0.44, 1.02, 0); g.add(bar);
  const crank = new THREE.Group(); crank.name = 'crank'; crank.position.set(bb[0], bb[1], 0); g.add(crank);
  for (const side of [-1, 1]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, CRANK_R, 0.02), steel); arm.position.set(0, (side * CRANK_R) / 2, side * 0.1); crank.add(arm);
    const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.07), dark); pedal.position.set(0, side * CRANK_R, side * 0.13); crank.add(pedal); }
  g.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = false; } });
  return g;
}
/** Place a bicycle at a body point along heading `yaw` with its cranks at angle `a`. */
export function poseBicycle(bike: THREE.Object3D, x: number, y: number, z: number, yaw: number, a: number) {
  bike.position.set(x, y, z); bike.rotation.set(0, -yaw, 0);
  const crank = bike.getObjectByName('crank'); if (crank) crank.rotation.z = -a;
}

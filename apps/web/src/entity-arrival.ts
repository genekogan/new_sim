// Lane X (real-user fix, Gene item 2/3b): where the camera starts on a world made with "New world" (an entity world).
// The old framing put the eye up to 320 m (OrbitControls' maxDistance) from the middle of an empty plain: WASD (3 m/s),
// wheel steps and a double-click flight then changed almost nothing a person could see, and dragging orbited an empty
// point hundreds of metres away, which reads as the view spinning around itself. Arrival now frames what was built at
// a human distance (the scale /w/eden's camera works at) and runs once, on first arrival; afterwards the camera is the
// person's. Pure: no three.js, no DOM.
export type ArrivalPose = { target: [number, number, number]; eye: [number, number, number]; distance: number };
/** Eye distance range (m): an empty plain starts near (WASD/zoom/double-click read at once); a built world is fitted
 * into the uncovered view up to ARRIVAL_MAX (the old framing went to OrbitControls' 320 m limit). */
export const ARRIVAL_MIN = 22, ARRIVAL_MAX = 110;
const ELEVATION = (16 * Math.PI) / 180; // 16° above the ground: the horizon stays in view (45° fov), so an empty plain still shows where you are
const AZIMUTH: [number, number] = [-0.9 / Math.hypot(0.9, 1.1), 1.1 / Math.hypot(0.9, 1.1)]; // from the south-west, as before (x −, z +)

/**
 * @param bounds   [x0, z0, x1, z1] of what was built (WorldEntityLayer.viewBounds)
 * @param built    how many things the world has (0: an empty plain; frame its middle at the near distance)
 * @param groundAt terrain height, or null outside the world
 * @param fovDeg   vertical field of view; aspect = width / height
 * @param visible  the fraction of the width left of the god panel (1: nothing covers the view); what was built is
 *                 framed in that part, so the panel does not hide it
 */
export function entityArrivalPose(bounds: readonly [number, number, number, number], built: number, groundAt: (x: number, z: number) => number | null, fovDeg = 45, aspect = 16 / 9, visible = 1): ArrivalPose {
  const [x0, z0, x1, z1] = bounds.every(Number.isFinite) ? bounds : [-20, -20, 20, 20];
  const cx = built > 0 ? (x0 + x1) / 2 : 0, cz = built > 0 ? (z0 + z1) / 2 : 0;
  const span = built > 0 ? Math.max(x1 - x0, z1 - z0) : 0;
  const f = Number.isFinite(visible) ? Math.min(1, Math.max(0.3, visible)) : 1;
  const vfov = (fovDeg * Math.PI) / 180, tanH = Math.tan(vfov / 2) * (aspect > 0 ? aspect : 1), hfov = 2 * Math.atan(tanH * f);
  const half = Math.max(0.1, Math.min(vfov, hfov) / 2);
  const fit = span > 0 ? (span / 2) / Math.sin(half) * 0.9 : 0;
  const distance = Math.min(ARRIVAL_MAX, Math.max(ARRIVAL_MIN, fit));
  const gy = groundAt(cx, cz) ?? 0;
  const h = Math.cos(ELEVATION) * distance;
  // Screen centre = the target. Put the built centre at the middle of the uncovered part: move the target right (the
  // camera's right, perpendicular to the azimuth) by (1 − f)/2 of the view's width at that distance.
  const shift = ((1 - f) / 2) * 2 * distance * tanH, rx = AZIMUTH[1], rz = -AZIMUTH[0]; // camera right = forward × up, forward = −AZIMUTH
  const tx = cx + rx * shift, tz = cz + rz * shift, ty = groundAt(tx, tz) ?? gy;
  const eye: [number, number, number] = [tx + AZIMUTH[0] * h, ty + Math.sin(ELEVATION) * distance, tz + AZIMUTH[1] * h];
  return { target: [tx, ty, tz], eye, distance };
}

// Synthetic subject samplers for tests / previews (no runtime needed).
import { datan2, type Vec2, hypot } from '../core/math.ts';
import type { SubjectPose } from './shots.ts';

/** Subject walking a polyline at `speed` m/s from t0; holds at the end unless `loop`. */
export function walker(pts: Vec2[], speed = 1.3, t0 = 0, loop = false): (t: number) => SubjectPose {
  const seg = pts.slice(1).map((p, i) => hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  const total = seg.reduce((a, b) => a + b, 0);
  return (t) => {
    let s = Math.max(0, (t - t0) * speed);
    s = loop ? s % total : Math.min(s, total - 1e-9);
    let i = 0;
    while (i < seg.length - 1 && s > seg[i]) { s -= seg[i]; i++; }
    const a = pts[i], b = pts[i + 1], u = Math.min(1, s / seg[i]);
    return { p: [a[0] + (b[0] - a[0]) * u, 0, a[1] + (b[1] - a[1]) * u], yaw: datan2(b[1] - a[1], b[0] - a[0]) };
  };
}

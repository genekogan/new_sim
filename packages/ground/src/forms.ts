// Tranche-2 landform kinds (owner: L3; spec <eden4>/29 WP3, 33 §2 row 5):
//   cliff    — a stepped rise along a path (escarpment, ledge, sea cliff); natural class
//   terrace  — an area flattened to a named level, or a hillside cut into steps; terrace class
//   channel  — a cut / fill / set along a path to per-vertex levels (river beds, graded roads); carve class
//   brush    — small edits: raise / lower (natural), smooth (after carve), flatten (terrace class)
// Fold order (the scales blend by it): base + noise → natural (bump, ridge, plateau, cliff, raise/lower)
// → carve (carve, channel) → smooth → terrace (terrace, flatten) → pad. Height field only: no caves,
// no overhangs. Same arithmetic discipline as geom.ts: + − × ÷, comparisons and sqrt only.
import { z } from 'zod';
import { bumpK, clamp01, smooth, sq } from './geom.ts';
import type { Vec2 } from './types.ts';

const v2 = z.tuple([z.number(), z.number()]);
const poly = z.array(v2).min(3).max(512);
const path = z.array(v2).min(2).max(512);
const finite = z.number().finite();

/** A rise along a path: the left side (side = 1) or right side (side = −1) goes up by h over a face `face` m wide, in `steps` ledges, holds for `w` m and falls back over `back` m. */
export const cliffBody = z.object({
  kind: z.literal('cliff'),
  path, h: finite, side: z.union([z.literal(1), z.literal(-1)]).default(1),
  face: finite.positive().default(3), w: finite.nonnegative().default(30), back: finite.positive().default(12),
  steps: z.number().int().min(1).max(12).default(1),
});
/** Flatten an area to `level` (named, e.g. "upper-lawn"), or with `step` cut whatever is there into terraces `step` m high. */
const terraceRaw = z.object({
  kind: z.literal('terrace'),
  area: poly, level: finite.optional(), step: finite.positive().optional(), riser: finite.min(0.05).max(0.95).default(0.3),
  edge: finite.positive().default(4), name: z.string().max(48).optional(),
});
const terraceOk = (t: { level?: number; step?: number }) => t.level !== undefined || t.step !== undefined;
export const terraceBody = terraceRaw.refine(terraceOk, { message: 'terrace needs level or step' });
/** Cut (lower only), fill (raise only) or set (both) to per-vertex levels along a path: flat across `w` either side of the centre line, blending out over `edge`. */
const channelRaw = z.object({
  kind: z.literal('channel'),
  path, levels: z.array(finite).min(2).max(512), w: finite.positive(), edge: finite.positive().default(3),
  mode: z.enum(['cut', 'fill', 'set']).default('cut'),
  /** Per-vertex 0..1 (0 = leave the ground alone there, e.g. under a bridge span). */
  strength: z.array(finite.min(0).max(1)).max(512).optional(),
});
const channelOk = (c: { path: unknown[]; levels: unknown[]; strength?: unknown[] }) => c.levels.length === c.path.length && (!c.strength || c.strength.length === c.path.length);
export const channelBody = channelRaw.refine(channelOk, { message: 'channel levels/strength need one value per path point' });
/** A brush stroke at a point: raise / lower by `amount` m, flatten toward `level`, or smooth (amount 0..1 = strength). */
const brushRaw = z.object({
  kind: z.literal('brush'),
  op: z.enum(['raise', 'lower', 'flatten', 'smooth']), c: v2, r: finite.positive().max(400),
  amount: finite.nonnegative().default(1), level: finite.optional(),
});
const brushOk = (b: { op: string; level?: number }) => b.op !== 'flatten' || b.level !== undefined;
export const brushBody = brushRaw.refine(brushOk, { message: 'flatten needs level' });
const id = { id: z.string() };
/** The same kinds carrying their landform id (ground records). */
export const cliffForm = cliffBody.extend(id);
export const terraceForm = terraceRaw.extend(id).refine(terraceOk, { message: 'terrace needs level or step' });
export const channelForm = channelRaw.extend(id).refine(channelOk, { message: 'channel levels/strength need one value per path point' });
export const brushForm = brushRaw.extend(id).refine(brushOk, { message: 'flatten needs level' });

export type Cliff = z.infer<typeof cliffBody> & { id: string };
export type Terrace = z.infer<typeof terraceBody> & { id: string };
export type Channel = z.infer<typeof channelBody> & { id: string };
export type Brush = z.infer<typeof brushBody> & { id: string };

/** Nearest point on a polyline: distance, segment index, parameter on it, signed side (+ left of travel) and metres beyond either end. */
export function nearestOnPath(px: number, pz: number, p: Vec2[]): { d: number; i: number; t: number; side: number; beyond: number } {
  let best = Infinity, bi = 0, bt = 0, bside = 1, bbeyond = 0;
  for (let i = 1; i < p.length; i++) {
    const ax = p[i - 1][0], az = p[i - 1][1], vx = p[i][0] - ax, vz = p[i][1] - az, wx = px - ax, wz = pz - az;
    const n = vx * vx + vz * vz;
    const raw = n === 0 ? 0 : (wx * vx + wz * vz) / n;
    const t = clamp01(raw);
    const d = Math.sqrt(sq(px - (ax + vx * t)) + sq(pz - (az + vz * t)));
    if (d < best) {
      best = d; bi = i - 1; bt = t; bside = vx * wz - vz * wx >= 0 ? 1 : -1;
      const len = Math.sqrt(n);
      bbeyond = i === 1 && raw < 0 ? -raw * len : i === p.length - 1 && raw > 1 ? (raw - 1) * len : 0;
    }
  }
  return { d: best, i: bi, t: bt, side: bside, beyond: bbeyond };
}
/** Level interpolated along a path at the nearest point (per-vertex levels). */
export function levelAlong(px: number, pz: number, p: Vec2[], levels: number[]): { level: number; d: number; i: number; t: number } {
  const n = nearestOnPath(px, pz, p);
  const a = levels[n.i], b = levels[n.i + 1] ?? a;
  return { level: a + (b - a) * n.t, d: n.d, i: n.i, t: n.t };
}

/** Steps on [0,1]: flat ledges, short risers. n = 1 is a plain smoothstep. */
function stair(u: number, n: number): number {
  const c = clamp01(u);
  if (n <= 1) return smooth(c);
  const k = Math.floor(c * n);
  if (k >= n) return 1;
  const f = c * n - k;
  return (k + smooth((f - 0.6) / 0.4)) / n;
}

export function cliffRise(l: Cliff, x: number, z: number): number {
  const q = nearestOnPath(x, z, l.path);
  const s = q.side * l.side * q.d, half = l.face / 2;
  if (s <= -half) return 0;
  let k: number;
  if (s < half) k = stair((s + half) / l.face, l.steps);
  else if (s <= half + l.w) k = 1;
  else if (s < half + l.w + l.back) k = 1 - smooth((s - half - l.w) / l.back);
  else return 0;
  if (q.beyond > 0) k *= 1 - smooth(q.beyond / l.back);
  return l.h * k;
}
export function cliffReach(l: Cliff): number { return l.face / 2 + l.w + l.back; }

/** Natural-class brush: raise / lower. */
export function brushRaise(l: Brush, x: number, z: number): number {
  if (l.op !== 'raise' && l.op !== 'lower') return 0;
  const d = Math.sqrt(sq(x - l.c[0]) + sq(z - l.c[1])) / l.r;
  if (d >= 1) return 0;
  const k = bumpK(d);
  return l.op === 'raise' ? l.amount * k : -l.amount * k;
}
/** Falloff for flatten / smooth: full inside half the radius, smooth to zero at r. */
export function brushFalloff(l: Brush, x: number, z: number): number {
  const d = Math.sqrt(sq(x - l.c[0]) + sq(z - l.c[1]));
  if (d >= l.r) return 0;
  const core = l.r * 0.5;
  return d <= core ? 1 : 1 - smooth((d - core) / core);
}
/** Kernel radius of a smooth brush (neighbour samples sit this far from the point). */
export function smoothRadius(l: Brush): number { return l.r * 0.35 > 2 ? l.r * 0.35 : 2; }
const R2 = 0.7071067811865476;
/** Eight unit directions as literals (no trig: engine-independent). */
export const KERNEL: Vec2[] = [[1, 0], [R2, R2], [0, 1], [-R2, R2], [-1, 0], [-R2, -R2], [0, -1], [R2, -R2]];

export function channelApply(l: Channel, h: number, x: number, z: number): number {
  const q = nearestOnPath(x, z, l.path);
  if (q.d >= l.w + l.edge) return h;
  const a = l.levels[q.i], b = l.levels[q.i + 1] ?? a;
  const level = a + (b - a) * q.t;
  let m = q.d <= l.w ? 1 : 1 - smooth((q.d - l.w) / l.edge);
  if (q.beyond > 0) m *= 1 - smooth(q.beyond / l.edge);
  if (l.strength) { const sa = l.strength[q.i], sb = l.strength[q.i + 1] ?? sa; m *= sa + (sb - sa) * q.t; }
  if (m <= 0) return h;
  if (l.mode === 'cut' && level >= h) return h;
  if (l.mode === 'fill' && level <= h) return h;
  return h + (level - h) * m;
}

export function terraceTarget(l: Terrace, h: number): number {
  if (l.step === undefined) return l.level!;
  const base = l.level ?? 0, rel = (h - base) / l.step, k = Math.floor(rel), f = rel - k;
  return base + l.step * (k + smooth((f - (1 - l.riser)) / l.riser));
}

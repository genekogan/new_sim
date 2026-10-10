// road/1 and path/1: roads as systems. Owner: L3. Spec <eden4>/29 WP3, 33 §2 row 6.
//   - the control path is smoothed (Catmull-Rom, ≈2 m) into the centre line every half shares;
//   - width, kerbs (decor), shoulders (a verge surface each side), material;
//   - grading: `prepareRoad` freezes a profile that keeps the slope under `maxGrade` (cut and fill,
//     approach embankments) into params.grade; physics turns it into a `channel` landform (mode set)
//     so the ground itself is graded and the road drapes on it (ground is the only height source);
//   - auto-bridges: where the centre line crosses water, prepare records spans; physics leaves the
//     ground alone there (channel strength 0) and emits bridge deck surfaces at absolute heights;
//   - intersections are a viewer matter (same-priority surfaces merge; kerbs and markings stop at
//     another road's ribbon; a junction patch rounds the corners).
import { n } from './geom.ts';
import { arcLengths, band, hyp, movingAverage, pathSig, round2, smoothPath, subPath, valueAt, type AbsOBB, type AbsSurface, type TerrainQuery } from './terrain-query.ts';
import type { Baked, Generator, Shape, Vec2 } from './types.ts';
import { bounds2, boxOfBounds } from './geom.ts';
import type { Value } from './fields.ts';

export type Span = { from: number; to: number; y0: number; y1: number; rise: number };
export type Grade = { sig: string; h?: number[]; spans?: Span[]; maxGrade?: number; cut?: number; fill?: number };

const pathOf = (shape: Shape | undefined): Vec2[] => shape?.path ?? [[-5, 0], [5, 0]];
export const centreLine = (shape: Shape | undefined): Vec2[] => smoothPath(pathOf(shape), 2, 400);

/** The prepared grade, if it was computed for this exact path; else null (stale or never prepared). */
export function gradeOf(params: Record<string, Value>, shape: Shape | undefined): Grade | null {
  const g = params.grade as Grade | null | undefined;
  if (!g || typeof g !== 'object' || g.sig !== pathSig(pathOf(shape))) return null;
  return g;
}

/** Deck height along a span at arc length q (parabolic arch over the straight line between abutments). */
export function deckAt(sp: Span, q: number): number { const u = (q - sp.from) / Math.max(1e-6, sp.to - sp.from); return sp.y0 + (sp.y1 - sp.y0) * u + sp.rise * 4 * u * (1 - u); }

function roadPhysics(params: Record<string, Value>, shape: Shape | undefined, defaults: { width: number; material: string; tag: string }): Baked {
  const w = n(params.width, defaults.width), sh = n(params.shoulder, defaults.tag === 'road' ? 0.6 : 0), mat = String(params.material ?? defaults.material);
  const c = centreLine(shape), s = arcLengths(c), total = s[s.length - 1];
  const grade = gradeOf(params, shape), spans = grade?.spans ?? [];
  const inSpan = (q: number) => spans.find((sp) => q >= sp.from && q <= sp.to);
  const surfaces: AbsSurface[] = [], colliders: AbsOBB[] = [], notes: string[] = [];
  // ground runs between spans
  let cur = 0;
  const runs: [number, number][] = [];
  for (const sp of [...spans].sort((a, b) => a.from - b.from)) { if (sp.from > cur + 0.5) runs.push([cur, sp.from]); cur = Math.max(cur, sp.to); }
  if (total > cur + 0.5) runs.push([cur, total]);
  for (const [a, b] of runs) {
    const sub = a === 0 && b === total ? c : subPath(c, s, a, b);
    surfaces.push({ level: 0, y: 0.04, polygon: band(sub, w / 2, -w / 2), material: mat, tag: defaults.tag });
    if (sh > 0) { surfaces.push({ level: 0, y: 0.02, polygon: band(sub, w / 2 + sh, w / 2), material: 'gravel', tag: 'shoulder' }, { level: 0, y: 0.02, polygon: band(sub, -w / 2, -w / 2 - sh), material: 'gravel', tag: 'shoulder' }); }
  }
  // bridge decks: 2 m quads at absolute heights, rails as absolute colliders
  for (const sp of spans) {
    const steps = Math.max(1, Math.ceil((sp.to - sp.from) / 2));
    for (let k = 0; k < steps; k++) {
      const q0 = sp.from + ((sp.to - sp.from) * k) / steps, q1 = sp.from + ((sp.to - sp.from) * (k + 1)) / steps;
      const seg = subPath(c, s, q0, q1), y = (deckAt(sp, q0) + deckAt(sp, q1)) / 2;
      surfaces.push({ level: 0, y, polygon: band([seg[0], seg[seg.length - 1]], w / 2, -w / 2), material: mat === 'asphalt' ? 'stone' : mat === 'cobble' ? 'stone' : 'wood', tag: 'bridge', abs: true });
      const [a, b] = [seg[0], seg[seg.length - 1]], dx = b[0] - a[0], dz = b[1] - a[1], len = hyp(dx, dz) || 1, yaw = Math.atan2(-dz / len, dx / len);
      for (const side of [1, -1]) colliders.push({ c: [(a[0] + b[0]) / 2 - (dz / len) * side * (w / 2 + 0.1), (a[1] + b[1]) / 2 + (dx / len) * side * (w / 2 + 0.1)], half: [len / 2, 0.08], yaw, y0: y, y1: y + 1.0, tag: 'rail', abs: true });
    }
    notes.push(`bridge ${sp.from.toFixed(0)}–${sp.to.toFixed(0)} m, deck ${sp.y0.toFixed(1)}→${sp.y1.toFixed(1)} m`);
  }
  let landform: Baked['landform'];
  const maxGrade = n(params.maxGrade, 0.08);
  if (grade?.h && grade.h.length === c.length && maxGrade > 0) {
    const strength = c.map((_, i) => (inSpan(s[i]) ? 0 : 1));
    // soften the strength at abutments so embankments meet the bank, not a cliff
    landform = { kind: 'channel', path: c, levels: grade.h, w: w / 2 + sh + 0.3, edge: Math.min(24, Math.max(3, w * 0.7, 1.6 * Math.max(grade.cut ?? 0, grade.fill ?? 0))), mode: 'set', strength };
    notes.push(`graded to ≤ ${(100 * (grade.maxGrade ?? maxGrade)).toFixed(1)} % (cut ${(grade.cut ?? 0).toFixed(1)} m, fill ${(grade.fill ?? 0).toFixed(1)} m)`);
  } else if (maxGrade > 0 && params.grade) notes.push('grade is stale for this path: run prepareRoad again');
  const bb = bounds2(band(c, w / 2 + sh, -w / 2 - sh));
  return { box: boxOfBounds(bb, 0.2), colliders, surfaces, slots: [], ...(landform ? { landform } : {}), tris: c.length * (defaults.tag === 'road' ? 16 : 6) + spans.length * 400, notes };
}

export const roadGen: Generator = {
  id: 'road/1', form: 'path', owner: 'L3', doc: 'A road along a spline: width, material, kerbs, shoulders; follows and grades the terrain (prepareRoad); auto-bridges water.',
  params: {
    width: { type: 'number', min: 2, max: 30, default: 6 }, material: { type: 'enum', values: ['asphalt', 'cobble', 'gravel', 'dirt', 'sand'], default: 'cobble' },
    kerb: { type: 'bool', default: true }, shoulder: { type: 'number', min: 0, max: 4, default: 0.6 },
    maxGrade: { type: 'number', min: 0, max: 0.2, default: 0.08, doc: 'carve/fill to keep slope below this (0 = follow terrain)' },
    autoBridge: { type: 'bool', default: true }, lines: { type: 'bool', default: false },
    grade: { type: 'json', doc: 'frozen by prepareRoad: {sig, h[], spans[]} — profile per centre-line point and bridge spans' },
  },
  physics({ params, shape }) { return roadPhysics(params, shape, { width: 6, material: 'cobble', tag: 'road' }); },
};
export const footpathGen: Generator = {
  id: 'path/1', form: 'path', owner: 'L3', doc: 'A footpath: narrow, follows the terrain, gravel, dirt, cobble, stone flags or a boardwalk; bridges water like a road.',
  params: {
    width: { type: 'number', min: 0.5, max: 6, default: 1.6 }, material: { type: 'enum', values: ['gravel', 'dirt', 'cobble', 'stone', 'wood'], default: 'gravel' },
    edging: { type: 'bool', default: false }, maxGrade: { type: 'number', min: 0, max: 0.3, default: 0 }, autoBridge: { type: 'bool', default: true },
    grade: { type: 'json', doc: 'frozen by prepareRoad' },
  },
  physics({ params, shape }) { return roadPhysics(params, shape, { width: 1.6, material: 'gravel', tag: 'path' }); },
};

/**
 * Freeze a road's grade and bridges from the world it is placed in. Call before placing (the skill)
 * or from the compiler (patch requested). Returns params to merge: `{ grade }`.
 * Profile: the cross-section mean of the ground, a 24 m moving average, then forward/backward
 * passes that cap the slope at maxGrade; spans where the centre line is over water get a deck at
 * water + clearance and the approaches are re-capped (embankments).
 */
export function prepareRoad(q: TerrainQuery, path: Vec2[], params: Record<string, Value> = {}): { grade: Grade } {
  const shape = { path };
  const c = centreLine(shape), s = arcLengths(c), N = c.length;
  const w = n(params.width, 6), maxGrade = n(params.maxGrade, 0.08), auto = params.autoBridge !== false;
  const g = maxGrade * 0.95; // headroom for the centimetre rounding of the frozen profile
  const raw = c.map(([x, z], i) => {
    const a = c[Math.max(0, i - 1)], b = c[Math.min(N - 1, i + 1)], dx = b[0] - a[0], dz = b[1] - a[1], l = hyp(dx, dz) || 1, nx = -dz / l, nz = dx / l;
    return (q.height(x, z) * 2 + q.height(x + nx * w / 2, z + nz * w / 2) + q.height(x - nx * w / 2, z - nz * w / 2)) / 4;
  });
  // water crossings → spans (wet runs extended by an abutment margin)
  const spans: Span[] = [];
  if (auto) {
    const wet = c.map(([x, z], i) => { const lv = q.waterLevel(x, z); return lv !== null && lv > raw[i] - 0.05 ? lv : null; });
    for (let i = 0; i < N; i++) {
      if (wet[i] === null) continue;
      let j = i; let lv = wet[i]!; while (j + 1 < N && wet[j + 1] !== null) { j++; lv = Math.max(lv, wet[j]!); }
      const from = Math.max(0, s[i] - 2.5), to = Math.min(s[N - 1], s[j] + 2.5);
      const bank0 = valueAt(raw, s, from), bank1 = valueAt(raw, s, to), clear = lv + 1.4;
      const y0 = Math.max(bank0, clear), y1 = Math.max(bank1, clear);
      spans.push({ from: round2(from), to: round2(to), y0: round2(y0), y1: round2(y1), rise: round2(Math.min(1.5, (to - from) * 0.04)) });
      i = j;
    }
  }
  if (maxGrade <= 0) return { grade: { sig: pathSig(path), spans } };
  let h = movingAverage(raw, s, 24);
  const pin = (arr: number[]) => { for (const sp of spans) for (let i = 0; i < N; i++) if (s[i] >= sp.from && s[i] <= sp.to) arr[i] = deckAt(sp, s[i]); };
  pin(h);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < N; i++) { const d = (s[i] - s[i - 1]) * g; if (h[i] > h[i - 1] + d) h[i] = h[i - 1] + d; else if (h[i] < h[i - 1] - d) h[i] = h[i - 1] - d; }
    for (let i = N - 2; i >= 0; i--) { const d = (s[i + 1] - s[i]) * g; if (h[i] > h[i + 1] + d) h[i] = h[i + 1] + d; else if (h[i] < h[i + 1] - d) h[i] = h[i + 1] - d; }
    // decks may not sink below their clearance: lift and re-run
    for (const sp of spans) for (let i = 0; i < N; i++) if (s[i] >= sp.from && s[i] <= sp.to && h[i] < deckAt(sp, s[i])) h[i] = deckAt(sp, s[i]);
  }
  // spans follow the final profile at their ends (so the deck meets the graded approach)
  for (const sp of spans) { sp.y0 = round2(Math.max(sp.y0, valueAt(h, s, sp.from))); sp.y1 = round2(Math.max(sp.y1, valueAt(h, s, sp.to))); }
  let cut = 0, fill = 0;
  for (let i = 0; i < N; i++) { const d = h[i] - raw[i]; if (d < cut) cut = d; if (d > fill) fill = d; }
  return { grade: { sig: pathSig(path), h: h.map(round2), spans, maxGrade, cut: round2(-cut), fill: round2(fill) } };
}

/** Steepest slope of a profile (rise/run), for tests and describe. */
export function steepest(h: number[], c: Vec2[]): number { const s = arcLengths(c); let m = 0; for (let i = 1; i < h.length; i++) { const d = s[i] - s[i - 1]; if (d > 0.5) m = Math.max(m, Math.abs(h[i] - h[i - 1]) / d); } return m; }

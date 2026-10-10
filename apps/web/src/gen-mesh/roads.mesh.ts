// road/1, path/1, parking/1 mesh halves: draped paving in the Eden look. Owner: L3.
//   cobble / stone: running-bond setts with grout, each stone its own tone; asphalt: a dark ribbon
//   with dashed centre and edge lines; gravel: speckled; dirt / sand: with wheel ruts; wood: a
//   boardwalk. Kerbs (chamfered) along both edges, stopping where another road's ribbon begins;
//   junction patches round T and X crossings (drawn once, by the lower id) with kerb arcs; verges;
//   bridge spans (from the frozen grade) as stone arches or timber trestles.
import { centreLine, gradeOf, type Span } from '@sim/generators';
import type { Entity, WorldModel } from '@sim/world-compiler';
import * as THREE from 'three';
import { registerMesh, type MeshCtx } from './registry.ts';
import { at, bridgeDeck, dirAt, line, type Line } from './l3-path.ts';
import { Soup, h01, mix, rgb, scale, soupMesh, type RGB, type V3 } from './soup.ts';

const BASE: Record<string, string> = { asphalt: '#4d5054', cobble: '#a49b8c', gravel: '#b5ad9c', dirt: '#8e6d4b', sand: '#d6c08c', stone: '#bdb5a5', wood: '#a07a4f' };
const GROUT: Record<string, string> = { cobble: '#6f685d', stone: '#8a8273' };
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

type Other = { id: string; L: Line; w: number; bb: [number, number, number, number] };
/** Other roads and paths in the world (for junctions and kerb cuts). */
function otherRoads(model: WorldModel, self: Entity): Other[] {
  const out: Other[] = [];
  for (const e of model.entities.values()) {
    if (e.id === self.id || !e.shape || !('path' in e.shape)) continue;
    const d = model.resolvedDef(e.def); if (!d || d.make.kind !== 'gen' || (d.make.gen !== 'road/1' && d.make.gen !== 'path/1')) continue;
    const w = num(e.params?.width, typeof d.params.width?.default === 'number' ? d.params.width.default : d.make.gen === 'road/1' ? 6 : 1.6);
    const c = centreLine(e.shape); const L = line(c);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const [x, z] of c) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
    out.push({ id: e.id, L, w, bb: [x0 - w, z0 - w, x1 + w, z1 + w] });
  }
  return out;
}
function nearestOn(L: Line, x: number, z: number): { d: number; q: number } {
  let best = Infinity, bq = 0;
  for (let i = 1; i < L.c.length; i++) {
    const a = L.c[i - 1], b = L.c[i], vx = b[0] - a[0], vz = b[1] - a[1], n = vx * vx + vz * vz; let t = n ? ((x - a[0]) * vx + (z - a[1]) * vz) / n : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t); if (d < best) { best = d; bq = L.s[i - 1] + (L.s[i] - L.s[i - 1]) * t; }
  }
  return { d: best, q: bq };
}
const inBB = (o: Other, x: number, z: number) => x >= o.bb[0] && x <= o.bb[2] && z >= o.bb[1] && z <= o.bb[3];
const onOther = (others: Other[], x: number, z: number, pad = 0) => others.some((o) => inBB(o, x, z) && nearestOn(o.L, x, z).d < o.w / 2 + pad);

/** Junction centres between this road and the others: centre-line crossings and ends that butt onto another road. */
function junctions(L: Line, w: number, others: Other[]): { x: number; z: number; r: number; other: Other }[] {
  const out: { x: number; z: number; r: number; other: Other }[] = [];
  for (const o of others) {
    for (let i = 1; i < L.c.length; i++) for (let j = 1; j < o.L.c.length; j++) {
      const p = L.c[i - 1], p2 = L.c[i], q = o.L.c[j - 1], q2 = o.L.c[j];
      const rx = p2[0] - p[0], rz = p2[1] - p[1], sx = q2[0] - q[0], sz = q2[1] - q[1], den = rx * sz - rz * sx; if (Math.abs(den) < 1e-9) continue;
      const t = ((q[0] - p[0]) * sz - (q[1] - p[1]) * sx) / den, u = ((q[0] - p[0]) * rz - (q[1] - p[1]) * rx) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) out.push({ x: p[0] + rx * t, z: p[1] + rz * t, r: Math.max(w, o.w) / 2 + 1.4, other: o });
    }
    for (const end of [L.c[0], L.c[L.c.length - 1]]) {
      const nr = nearestOn(o.L, end[0], end[1]);
      if (nr.d < o.w / 2 + 2.5 && !out.some((j) => Math.hypot(j.x - end[0], j.z - end[1]) < 3)) { const [x, z] = at(o.L, nr.q); out.push({ x, z, r: Math.max(w, o.w) / 2 + 1.4, other: o }); }
    }
  }
  return out;
}

export function buildRoad(ctx: MeshCtx, kind: 'road' | 'path'): THREE.Object3D | null {
  const e = ctx.entity; if (!e.shape || !('path' in e.shape)) return null;
  const p = ctx.params, w = num(p.width, kind === 'road' ? 6 : 1.6), sh = num(p.shoulder, kind === 'road' ? 0.6 : 0), mat = String(p.material ?? (kind === 'road' ? 'cobble' : 'gravel'));
  const kerb = p.kerb !== false && kind === 'road' && mat !== 'dirt' && mat !== 'sand', lines = p.lines === true || (mat === 'asphalt' && kind === 'road' && p.lines !== false && w >= 5);
  const L = line(centreLine(e.shape));
  const ground = (x: number, z: number) => ctx.model.terrain.sample(x, z);
  const grade = gradeOf(p, e.shape), spans: Span[] = grade?.spans ?? [];
  const inSpan = (q: number) => spans.some((sp) => q >= sp.from - 0.01 && q <= sp.to + 0.01);
  const others = otherRoads(ctx.model, e), juncs = junctions(L, w, others);
  const inJunc = (x: number, z: number, pad = 0) => juncs.some((j) => Math.hypot(x - j.x, z - j.z) < j.r + pad);
  const base = rgb(typeof p.color === 'string' && /^#/.test(p.color) ? p.color : BASE[mat] ?? BASE.cobble);
  const soup = new Soup();
  const G = (x: number, z: number, lift: number): V3 => [x, ground(x, z) + lift, z];
  const tone = (a: number, b: number, k = 0) => 0.86 + h01(a, b, k) * 0.24;
  const stations = (step: number) => { const out: number[] = []; for (let q = 0; q < L.total; q += step) out.push(q); out.push(L.total); return out; };

  // 1) base ribbon (grout for setts, the surface itself otherwise), in 1 m stations, 3 lanes across
  const qs = stations(kind === 'road' ? 1 : 0.8), cols = mat === 'asphalt' || mat === 'gravel' ? 4 : 2;
  const baseCol = mat in GROUT ? rgb(GROUT[mat]) : base;
  for (let k = 0; k < qs.length - 1; k++) {
    const q0 = qs[k], q1 = qs[k + 1]; if (inSpan((q0 + q1) / 2)) continue;
    for (let cI = 0; cI < cols; cI++) {
      const t0 = w / 2 - (w * cI) / cols, t1 = w / 2 - (w * (cI + 1)) / cols;
      const a = at(L, q0, t0), b = at(L, q1, t0), c = at(L, q1, t1), d = at(L, q0, t1);
      const speck = (x: number, z: number) => mat === 'gravel' ? scale(base, 0.82 + h01(Math.round(x * 3), Math.round(z * 3), 1) * 0.3) : mat === 'asphalt' ? scale(base, 0.94 + h01(Math.round(x), Math.round(z), 2) * 0.1) : (mat === 'dirt' || mat === 'sand') ? scale(base, 0.92 + h01(Math.round(x * 2), Math.round(z * 2), 3) * 0.14) : baseCol;
      soup.topQuad(G(a[0], a[1], 0.05), G(b[0], b[1], 0.05), G(c[0], c[1], 0.05), G(d[0], d[1], 0.05), [speck(a[0], a[1]), speck(b[0], b[1]), speck(c[0], c[1]), speck(d[0], d[1])]);
    }
    // wheel ruts on dirt / sand tracks
    if (mat === 'dirt' || mat === 'sand') for (const t of [w * 0.22, -w * 0.22]) { const a = at(L, q0, t + 0.25), b = at(L, q1, t + 0.25), c = at(L, q1, t - 0.25), d = at(L, q0, t - 0.25); soup.topQuad(G(a[0], a[1], 0.06), G(b[0], b[1], 0.06), G(c[0], c[1], 0.06), G(d[0], d[1], 0.06), scale(base, 0.8)); }
  }
  // 2) setts: running bond along the road (cobble 0.45 × 0.3, stone flags 0.9 × 0.6, wood boards)
  if (mat === 'cobble' || mat === 'stone' || mat === 'wood') {
    const len = mat === 'cobble' ? 0.42 : mat === 'stone' ? 0.9 : 0.25, wid = mat === 'cobble' ? 0.3 : mat === 'stone' ? 0.6 : w, gap = mat === 'wood' ? 0.03 : 0.05;
    const nAcross = Math.max(1, Math.round(w / wid)), ww = w / nAcross;
    let row = 0;
    for (let q = 0; q < L.total - 0.05; q += len, row++) {
      if (inSpan(q + len / 2)) continue;
      const q1 = Math.min(L.total, q + len - gap);
      for (let k = 0; k < nAcross + 1; k++) {
        const off = mat === 'wood' ? 0 : (row % 2) * ww / 2;
        let t0 = w / 2 - k * ww + off, t1 = t0 - ww + gap;
        t0 = Math.min(w / 2, t0); t1 = Math.max(-w / 2, t1); if (t0 - t1 < 0.08) continue;
        const m = at(L, (q + q1) / 2, (t0 + t1) / 2);
        if (inJunc(m[0], m[1], -0.3) && !juncsOwn(juncs, e)) continue;
        const a = at(L, q, t0), b = at(L, q1, t0), c = at(L, q1, t1), d = at(L, q, t1);
        const col = scale(base, tone(row, k, 7));
        soup.topQuad(G(a[0], a[1], 0.085), G(b[0], b[1], 0.085), G(c[0], c[1], 0.085), G(d[0], d[1], 0.085), col);
      }
    }
  }
  // 3) markings on asphalt: dashed centre line, solid edge lines; stop at junctions
  if (lines) {
    const white = rgb('#ece8dc');
    for (let q = 0; q < L.total - 3; q += 6) {
      const m = at(L, q + 1.5); if (inSpan(q + 1.5) || inJunc(m[0], m[1], 1)) continue;
      const a = at(L, q, 0.07), b = at(L, q + 3, 0.07), c = at(L, q + 3, -0.07), d = at(L, q, -0.07);
      soup.topQuad(G(a[0], a[1], 0.07), G(b[0], b[1], 0.07), G(c[0], c[1], 0.07), G(d[0], d[1], 0.07), white);
    }
    for (const side of [1, -1]) for (let k = 0; k < qs.length - 1; k++) {
      const q0 = qs[k], q1 = qs[k + 1], t = side * (w / 2 - 0.35), m = at(L, (q0 + q1) / 2, t);
      if (inSpan((q0 + q1) / 2) || inJunc(m[0], m[1], 0.6) || onOther(others, m[0], m[1], 0.2)) continue;
      const a = at(L, q0, t + 0.06), b = at(L, q1, t + 0.06), c = at(L, q1, t - 0.06), d = at(L, q0, t - 0.06);
      soup.topQuad(G(a[0], a[1], 0.07), G(b[0], b[1], 0.07), G(c[0], c[1], 0.07), G(d[0], d[1], 0.07), scale(white, 0.95));
    }
  }
  // 4) junction patches (once per pair, by the lower id): a round patch in the base surface + kerb arcs
  for (const j of juncs) {
    if (!(e.id < j.other.id)) continue;
    const segs = 20, col = mat in GROUT ? scale(base, 0.95) : base;
    for (let k = 0; k < segs; k++) {
      const a0 = (k / segs) * Math.PI * 2, a1 = ((k + 1) / segs) * Math.PI * 2;
      soup.topQuad(G(j.x, j.z, 0.075), G(j.x + Math.cos(a0) * j.r, j.z + Math.sin(a0) * j.r, 0.075), G(j.x + Math.cos(a1) * j.r, j.z + Math.sin(a1) * j.r, 0.075), G(j.x, j.z, 0.075), col);
    }
    if (mat === 'cobble' || mat === 'stone') for (let ring = 1; ring * 0.5 < j.r; ring++) { // radial setts
      const r0 = ring * 0.5 - 0.5, r1 = ring * 0.5 - 0.05, nn = Math.max(6, Math.round((2 * Math.PI * r1) / 0.42));
      for (let k = 0; k < nn; k++) { const a0 = (k / nn) * Math.PI * 2 + ring * 0.3, a1 = a0 + (Math.PI * 2) / nn * 0.88; soup.topQuad(G(j.x + Math.cos(a0) * r0, j.z + Math.sin(a0) * r0, 0.09), G(j.x + Math.cos(a0) * r1, j.z + Math.sin(a0) * r1, 0.09), G(j.x + Math.cos(a1) * r1, j.z + Math.sin(a1) * r1, 0.09), G(j.x + Math.cos(a1) * r0, j.z + Math.sin(a1) * r0, 0.09), scale(base, tone(ring, k, 11))); }
    }
    if (kerb) { // kerb arcs where the patch edge is outside both ribbons
      const segK = 32;
      for (let k = 0; k < segK; k++) {
        const a0 = (k / segK) * Math.PI * 2, a1 = ((k + 1) / segK) * Math.PI * 2;
        const p0: [number, number] = [j.x + Math.cos(a0) * (j.r + 0.08), j.z + Math.sin(a0) * (j.r + 0.08)], p1: [number, number] = [j.x + Math.cos(a1) * (j.r + 0.08), j.z + Math.sin(a1) * (j.r + 0.08)];
        const outside = (pt: [number, number]) => nearestOn(L, pt[0], pt[1]).d > w / 2 + 0.05 && nearestOn(j.other.L, pt[0], pt[1]).d > j.other.w / 2 + 0.05;
        if (outside(p0) && outside(p1)) kerbSeg(soup, G(p0[0], p0[1], 0), G(p1[0], p1[1], 0));
      }
    }
  }
  // 5) kerbs along both edges, cut at other ribbons and junction patches
  if (kerb) for (const side of [1, -1]) for (let k = 0; k < qs.length - 1; k++) {
    const q0 = qs[k], q1 = qs[k + 1]; if (inSpan((q0 + q1) / 2)) continue;
    const a = at(L, q0, side * (w / 2 + 0.08)), b = at(L, q1, side * (w / 2 + 0.08)), m = at(L, (q0 + q1) / 2, side * (w / 2 + 0.08));
    if (onOther(others, m[0], m[1], 0.1) || inJunc(m[0], m[1], 0.05)) continue;
    kerbSeg(soup, G(a[0], a[1], 0), G(b[0], b[1], 0));
  }
  // 6) verges (shoulders): a band of rough grass / gravel each side
  if (sh > 0) {
    const verge = mat === 'asphalt' ? rgb('#7d8a5c') : rgb('#b2a98f');
    for (const side of [1, -1]) for (let k = 0; k < qs.length - 1; k++) {
      const q0 = qs[k], q1 = qs[k + 1]; if (inSpan((q0 + q1) / 2)) continue;
      const t0 = side * (w / 2 + (kerb ? 0.16 : 0)), t1 = side * (w / 2 + sh), m = at(L, (q0 + q1) / 2, (t0 + t1) / 2);
      if (onOther(others, m[0], m[1], 0.2) || inJunc(m[0], m[1], 0.2)) continue;
      const a = at(L, q0, t0), b = at(L, q1, t0), c = at(L, q1, t1), d = at(L, q0, t1), v = scale(verge, 0.9 + h01(k, side, 4) * 0.15);
      soup.topQuad(G(a[0], a[1], 0.035), G(b[0], b[1], 0.035), G(c[0], c[1], 0.03), G(d[0], d[1], 0.03), [v, v, mix(v, rgb('#6f8f4f'), 0.4), mix(v, rgb('#6f8f4f'), 0.4)]);
    }
  }
  // 7) bridge spans
  const style = mat === 'cobble' || mat === 'stone' || mat === 'asphalt' ? 'stone' : 'wood';
  const water = (x: number, z: number) => { const g = ctx.model.ground(); let lv: number | null = null; for (const wt of g.waters) { if (wt.area && insidePoly(x, z, wt.area)) lv = wt.level; } return lv; };
  for (const sp of spans) bridgeDeck(soup, L, sp, w + (kerb ? 0.3 : 0), style, ground, water);
  const mesh = soupMesh(soup, `road ${e.name ?? e.id}`, { shadow: spans.length > 0 });
  if (mesh) { mesh.userData.tris = soup.tris; void dirAt; }
  return mesh;
}
function juncsOwn(_j: unknown[], _e: Entity) { return false; }
function insidePoly(px: number, pz: number, poly: [number, number][]) { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside; } return inside; }
const KERB = rgb('#cfc8b8');
function kerbSeg(soup: Soup, a: V3, b: V3) {
  // chamfered kerb stone: 0.16 wide, 0.13 high, sunk 0.05
  soup.beam([a[0], a[1] - 0.05, a[2]], [b[0], b[1] - 0.05, b[2]], 0.16, 0.18, scale(KERB, 0.95 + h01(Math.round(a[0] * 10), Math.round(a[2] * 10)) * 0.08), 0.04);
}

registerMesh({ gen: 'road/1', world: true, build: (ctx) => buildRoad(ctx, 'road') });
registerMesh({ gen: 'path/1', world: true, build: (ctx) => buildRoad(ctx, 'path') });
export type { RGB };

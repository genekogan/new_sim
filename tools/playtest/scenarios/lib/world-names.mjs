// Named things in a genesis template (worlds/templates/*.json), for authoring and validating scenario expectations
// (wayfinding/look batteries, podium casts). Pure file reading, no world: every `place` op's name, its def, its parent
// (`in.parent`, `tmp` handles resolved), and a ground position [x, z] — the op's own `p` for top-level things (a 3-vector
// is [x, y, z]), the centroid of `shape.area` for areas, and parent position + local offset for things placed in a parent
// (unrotated: good to a few metres inside one building). Positions are template truth, not the live world's.
import { readFileSync } from 'node:fs';

const xzOf = (p) => (!Array.isArray(p) ? null : p.length >= 3 ? [p[0], p[2]] : [p[0], p[1]]);
const centroid = (a) => [a.reduce((s, q) => s + q[0], 0) / a.length, a.reduce((s, q) => s + q[1], 0) / a.length];
const r1 = (v) => Math.round(v * 10) / 10;

/** templateNames(genesisFile) → Map(name → {name, def, parent, pos:[x,z]|null, note}) (first placement wins). */
export function templateNames(file) {
  const g = JSON.parse(readFileSync(file, 'utf8'));
  const out = new Map(), tmp = new Map();
  for (const b of g.batches ?? []) for (const op of b.ops ?? []) {
    if (op.op !== 'place' || !op.name) continue;
    if (op.tmp) tmp.set(op.tmp, op.name);
    let parent = op.in?.parent ?? null;
    if (parent && tmp.has(parent)) parent = tmp.get(parent);
    let pos = null;
    if (op.shape?.area?.length >= 3) pos = centroid(op.shape.area);
    else if (!parent) pos = xzOf(op.p);
    else { const root = out.get(String(parent).split('/')[0]); const local = xzOf(op.p) ?? [0, 0]; pos = root?.pos ? [root.pos[0] + local[0], root.pos[1] + local[1]] : null; }
    if (!out.has(op.name)) out.set(op.name, { name: op.name, def: op.def ?? null, parent, pos: pos ? pos.map(r1) : null, note: b.note ?? null });
  }
  return out;
}

export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Things within radius metres of a point, nearest first (top-level and areas by default). */
export function near(names, at, radius, { children = false } = {}) {
  return [...names.values()].filter((n) => n.pos && (children || !n.parent) && dist(n.pos, at) <= radius)
    .map((n) => ({ ...n, d: r1(dist(n.pos, at)) })).sort((a, b) => a.d - b.d);
}

/** Compass point (8-way, as the world's perception speaks it: north is −z, east is +x) from one point to another. */
export function compassFrom(from, to) {
  const deg = ((Math.atan2(to[0] - from[0], -(to[1] - from[1])) * 180) / Math.PI + 360) % 360;
  return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(deg / 45) % 8];
}

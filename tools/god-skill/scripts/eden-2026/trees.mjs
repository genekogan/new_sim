// Eden 2026 tree density (gap V2): old /w/eden stood hundreds of round trees along its paths, round the commons and in
// the south park, and conifer forests on the hills. Woodland areas (scatter/2: one entity per patch, instanced trees that
// avoid solids, roads and water) are planted where old Eden had trees: its expansion forests and footpaths at their
// original coordinates, old district trees one by one where they stood, and 20 m patches wherever old-trees.json
// (extract-old-trees.mts) has far-forest trees.
import { readFileSync } from 'node:fs';
const OLD = JSON.parse(readFileSync(new URL('./old-trees.json', import.meta.url))).trees;
const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const r1 = n => Math.round(n * 10) / 10, r4 = n => Math.round(n * 10000) / 10000;
const KIND = { round: 'oak', conifer: 'pine', poplar: 'poplar', cypress: 'poplar', birch: 'birch' };
const wood = (name, b, density, palette, extra = {}) => ({ op: 'place', def: 'core/woodland@1', name: `trees-${name}`.slice(0, 48), shape: { area: rect(...b) }, params: { density: r4(density), minSpacing: 3.2, cluster: 0.3, palette, ...extra } });
const path = (name, points, width) => ({ op: 'place', def: 'core/footpath@1', name: `trees-path-${name}`.slice(0, 48), shape: { path: points }, params: { width, material: 'gravel', maxGrade: 0, autoBridge: false, edging: false } });

// Old expansion woodland paths (eden-expansion-landscape/layout.mjs), the ones clear of eden-2026's buildings and gardens.
export const OLD_PATHS = [
  ['north-forest-loop', 3, [[9,-24],[24,-28],[29,-34],[22,-43],[6,-51],[-10,-43],[-20,-32],[-26,-27]]],
  ['north-lookout', 2, [[6,-51],[3,-57]]], ['forest-reading', 2, [[25,-40],[16,-36]]], ['birch-stop', 2, [[-5,-45.5],[-8,-53]]],
  ['western-nature-loop', 3, [[-38,24],[-57,27],[-68,28],[-90,24],[-92,42],[-80,57],[-56,57],[-38,44],[-38,24]]],
  ['western-link', 3, [[-28,18],[-38,24]]],
  ['commons-south-country', 3, [[9,30],[9,34],[0,34],[0,53]]],
  ['south-country-loop', 2.5, [[0,53],[-6,53],[-20,55],[-20,68],[-13,77],[0,79],[21,74],[22,56],[6,53],[0,53]]],
  ['south-country-west', 2.5, [[-20,60],[-25,64],[-27,66]]],
  ['southern-forest-loop', 2.5, [[-80,57],[-68,68],[-51,73],[-30,68],[-38,44]]],
  ['southern-clearing', 2, [[-51,73],[-49,66]]], ['meadow-stop', 2, [[-44,48.3],[-51,45]]],
];
// Old expansion forests (planting.mjs forest(region, step, kind)); density is one tree per step² less the share old Eden
// left out on its reserved ground (paths, clearings).
export const OLD_WOODS = [
  ['north-canopy', [-13,-58,23,-34], 6, 'round'], ['west-pond-canopy', [-58,34,-36,66], 6, 'round'], ['south-west-canopy', [-68,65,-26,79], 7, 'round'],
  ['south-park-canopy', [-23,35,23,77], 5, 'round'], ['north-west-conifers', [-60,-58,-36,-35], 6, 'conifer'], ['far-west-conifers', [-95,-56,-69,-40], 7, 'conifer'],
  ['north-conifers', [-27,-62,-19,-42], 6, 'conifer'], ['north-east-canopy', [37,-59,94,-34], 9, 'round'],
];
const palette = counts => Object.entries(counts).map(([k, n]) => ({ kind: KIND[k] ?? 'oak', weight: n, ...(k === 'cypress' ? { scale: [0.6, 0.8] } : k === 'conifer' ? { scale: [0.9, 1.4] } : { scale: [0.8, 1.25] }) }));
const inside = (x, z, b, m = 0) => x > b[0] - m && x < b[2] + m && z > b[1] - m && z < b[3] + m;

/** `existing`: bounds of woodlands the landscape already plants (no double density there). */
export function treeBatches(existing = []) {
  const ops = [];
  for (const [name, w, pts] of OLD_PATHS) ops.push(path(name, pts, w));
  // old Eden's turf was full of small things: grass tufts, wild flowers and pebbles across the village meadow
  for (const [i, b] of [[-100, -65, 0, 10], [0, -65, 105, 10], [-100, 10, 0, 88], [0, 10, 105, 88]].entries()) ops.push(wood(`meadow-tufts-${i + 1}`, b, 0.03, [{ kind: 'grass', weight: 6, scale: [0.6, 1.2] }, { kind: 'flower', weight: 2, scale: [0.6, 1] }, { kind: 'rock', weight: 1, scale: [0.2, 0.4], maxSlope: 0.5 }], { minSpacing: 1.1, cluster: 0.5 }));
  for (const [name, b, step, kind] of OLD_WOODS) ops.push(wood(name, b, 0.75 / (step * step), palette({ [kind]: 1, ...(kind === 'round' ? { poplar: 0.15 } : {}) }), { minSpacing: Math.max(3, step * 0.6) }));
  // Old district trees (avenue rows, squares, campus quad) stand where they stood, one entity each.
  const SET_DEF = { round: 'core/tree@1', conifer: 'core/pine@1', cypress: 'core/pine@1', poplar: 'core/birch@1' };
  // The core trees are ~1.6x the old low-poly crowns (round: 2.5 m crown, 4 m tall at scale 1), hence s = 0.62 x old scale.
  OLD.filter(t => t[3] === 'set').forEach(([k, x, z, , sc = 1], i) => ops.push({ op: 'place', def: SET_DEF[k] ?? 'core/tree@1', name: `trees-set-${i + 1}`, p: [x, z], s: Math.min(3, Math.max(0.3, Math.round(sc * 62) / 100)) }));
  const skip = [...existing, ...OLD_WOODS.map(w => w[1])];
  const C = 20, cells = new Map();
  for (const [k, x, z, how] of OLD) { if (how === 'set' || skip.some(b => inside(x, z, b))) continue; const key = `${Math.floor(x / C)},${Math.floor(z / C)}`; const c = cells.get(key) ?? cells.set(key, { n: 0, k: {} }).get(key); c.n++; c.k[k] = (c.k[k] ?? 0) + 1; }
  // Merge runs of neighbouring cells along x with the same leading kind and similar counts into one patch.
  const rows = new Map();
  for (const [key, c] of cells) { const [i, j] = key.split(',').map(Number); (rows.get(j) ?? rows.set(j, []).get(j)).push({ i, ...c }); }
  for (const [j, row] of [...rows].sort((a, b) => a[0] - b[0])) {
    row.sort((a, b) => a.i - b.i);
    let run = null; const flush = () => { if (!run) return; const n = run.cells.reduce((s, c) => s + c.n, 0), k = {}; for (const c of run.cells) for (const [kk, v] of Object.entries(c.k)) k[kk] = (k[kk] ?? 0) + v;
      const b = [run.i0 * C, j * C, (run.i1 + 1) * C, (j + 1) * C], area = (b[2] - b[0]) * (b[3] - b[1]);
      const f = v => (v < 0 ? `n${-v}` : `${v}`);
      ops.push(wood(`old-${f(run.i0)}${run.i1 > run.i0 ? `to${f(run.i1)}` : ''}-${f(j)}`, b, Math.min(0.05, Math.max(0.002, n * 1.15 / area)), palette(k))); run = null; };
    for (const c of row) {
      const lead = Object.entries(c.k).sort((a, b) => b[1] - a[1])[0][0];
      if (run && c.i === run.i1 + 1 && lead === run.lead && run.cells.length < 6 && Math.abs(c.n - run.cells[0].n) <= 3) { run.i1 = c.i; run.cells.push(c); continue; }
      flush(); run = { i0: c.i, i1: c.i, lead, cells: [c] };
    }
    flush();
  }
  return ops;
}

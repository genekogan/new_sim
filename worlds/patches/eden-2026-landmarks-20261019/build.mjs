#!/usr/bin/env node
// Eden 2026 landmarks (lane E2, 2026-10-19): what old Eden had and Eden 2026 lacks or does weakly, added to the Eden 2026
// template as ordinary god ops (defines + places + a few moves), in Eden 2026's own layout. Inventory and shots:
// team/reviews/eden2026-landmarks-20261019/. This script edits worlds/templates/eden-2026.json in place (idempotent: it
// first drops what an earlier run added) and is the only source of those ops; the live upgrade spec is the template diff:
//   node worlds/patches/eden-2026-landmarks-20261019/build.mjs
//   node tools/template-upgrade/upgrade.mjs spec --old <template before> --new worlds/templates/eden-2026.json \
//     --id eden-2026-landmarks-20261019 --world eden-2026 --from <rev> --to <rev> --out worlds/patches/eden-2026-landmarks-20261019/spec.json
//
// Added: the cable car (pylons, cables, two cabins) between the alpine stations; a sun terrace with parasol tables below
// the mountain restaurant; the big top's canopy restyled (red and white stripes, a striped canvas skirt round the hall, open
// at both doors) with bunting avenues to its doors (three flags and one festoon moved clear of the canvas); two beached
// marina sailboats moved onto the water; a ticket booth,
// flags and festoon lights at the Ferris wheel; a sandy, picket-fenced playground yard; a painted stage floor and two
// speakers at the amphitheatre; the 17 m core Ferris wheel replaced by a ~29 m wheel with sixteen hanging gondolas. Heights along the cable car come from Eden 2026's own terrain (sampled once, below).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../../..');
const TPL = `${root}/worlds/templates/eden-2026.json`;
const NOTE = 'eden landmarks 2026-10-19';
const r3 = (v) => Math.round(v * 1000) / 1000;
const RED = '#c9342d', CREAM = '#f4efe4', GOLD = '#e8b33a', STEEL = '#7a8288', DARK = '#3a3d40';

// ---------- cable car: valley station (-4, -196) -> mountain station (6, -312) ----------
// Eden 2026 ground (WorldModel terrain.sample on the live snapshot, seq 1797) at the valley, the pylons and the top.
const VALLEY = { x: -4, z: -196, g: 0 }, TOP = { x: 6, z: -312, g: 43.9 };
const PYLON_GROUND = [0.11, 1.86, 7.58, 18.13, 32.46]; // at u = 1/6 .. 5/6
const ROOF = 5.0; // cable height above each station's ground (4 m hall + housing)
function cableCarDef() {
  const N = 6, dx = TOP.x - VALLEY.x, dz = TOP.z - VALLEY.z, len = Math.hypot(dx, dz);
  const d = [dx / len, dz / len], n = [-d[1], d[0]]; // along the line, across it
  const yaw = Math.atan2(-n[1], n[0]); // a box's local x turned onto `n`
  const y0 = VALLEY.g + ROOF, y1 = TOP.g + ROOF;
  const pts = []; // cable support points (local frame: origin at the valley station's ground)
  for (let i = 0; i <= N; i++) {
    const u = i / N, x = dx * u, z = dz * u, g = i === 0 ? VALLEY.g : i === N ? TOP.g : PYLON_GROUND[i - 1];
    pts.push({ x, z, g, y: i === 0 || i === N ? y0 + (y1 - y0) * u : Math.max(y0 + (y1 - y0) * u, g + 10) });
  }
  const shapes = [], off = 1.8;
  // pylons: a steel column on a concrete foot, a cross-arm and two sheaves
  for (const p of pts.slice(1, -1)) {
    const h = p.y - p.g;
    shapes.push({ kind: 'box', at: [r3(p.x), r3(p.g + 0.3), r3(p.z)], size: [1.4, 0.6, 1.4], color: '#9a958a', collide: false });
    shapes.push({ kind: 'cyl', at: [r3(p.x), r3(p.g + h / 2), r3(p.z)], r: 0.34, r2: 0.22, h: r3(h), segments: 8, color: STEEL, collide: false });
    shapes.push({ kind: 'box', at: [r3(p.x), r3(p.y + 0.1), r3(p.z)], size: [2 * off + 0.8, 0.35, 0.5], yaw: r3(yaw), color: STEEL, collide: false });
    for (const s of [-off, off]) shapes.push({ kind: 'cyl', at: [r3(p.x + n[0] * s), r3(p.y + 0.38), r3(p.z + n[1] * s)], r: 0.28, h: 0.12, segments: 10, roll: 1.5708, yaw: r3(yaw), color: DARK, collide: false });
  }
  // bull-wheel housings on both station roofs
  for (const p of [pts[0], pts[N]]) shapes.push({ kind: 'box', at: [r3(p.x), r3(p.y - 0.4), r3(p.z)], size: [2 * off + 1.2, 1.2, 1.4], yaw: r3(yaw), color: '#5a5f66', collide: false });
  // two cables, sagging between supports
  const cable = (s) => {
    const path = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]; path.push([r3(a.x + n[0] * s), r3(a.y + 0.45), r3(a.z + n[1] * s)]);
      if (i < pts.length - 1) { const b = pts[i + 1], span = Math.hypot(b.x - a.x, b.z - a.z); path.push([r3((a.x + b.x) / 2 + n[0] * s), r3((a.y + b.y) / 2 + 0.45 - span * 0.012), r3((a.z + b.z) / 2 + n[1] * s)]); }
    }
    return { kind: 'sweep', at: [0, 0, 0], path, r: 0.045, segments: 5, color: '#2a2a2a', collide: false };
  };
  shapes.push(cable(-off), cable(off));
  // two cabins hanging from the cables (red on the left cable a third of the way up, yellow on the right two thirds up)
  for (const [u, s, c] of [[0.35, -off, '#c43a2a'], [0.7, off, '#f0c040']]) {
    const k = u * N, i = Math.floor(k), f = k - i, a = pts[i], b = pts[i + 1];
    const x = a.x + (b.x - a.x) * f + n[0] * s, z = a.z + (b.z - a.z) * f + n[1] * s, y = a.y + (b.y - a.y) * f + 0.45 - Math.hypot(b.x - a.x, b.z - a.z) * 0.012 * 4 * f * (1 - f);
    shapes.push({ kind: 'box', at: [r3(x), r3(y - 0.75), r3(z)], size: [0.08, 1.5, 0.08], color: DARK, collide: false });
    shapes.push({ kind: 'box', at: [r3(x), r3(y - 1.55), r3(z)], size: [2, 0.14, 2.4], yaw: r3(yaw), color: '#3a3a3a', collide: false });
    shapes.push({ kind: 'box', at: [r3(x), r3(y - 2.6), r3(z)], size: [1.9, 2, 2.3], yaw: r3(yaw), round: 0.12, color: c, collide: false });
    shapes.push({ kind: 'box', at: [r3(x), r3(y - 2.3), r3(z)], size: [1.94, 0.75, 2.1], yaw: r3(yaw), color: '#3b4a52', collide: false });
  }
  const xs = shapes.flatMap((s) => s.path ? s.path.map((p) => p[0]) : [s.at[0]]), zs = shapes.flatMap((s) => s.path ? s.path.map((p) => p[2]) : [s.at[2]]);
  const box = [r3(Math.max(...xs) - Math.min(...xs) + 4), r3(y1 + 1), r3(Math.max(...zs) - Math.min(...zs) + 4)];
  return {
    schema: 'def/1', name: 'eden-cable-car', version: 1,
    description: 'The alpine cable car as scenery: five steel pylons, two cables and a red and a yellow cabin from the valley station up to the mountain station (116 m). Placed at the valley station with its height given.',
    tags: ['eden', 'scenery', 'cable-car', 'transport'], form: 'point', layer: 'decor', anchor: 'center',
    size: { box, scale: [1, 1] }, make: { kind: 'gen', gen: 'kit/2', args: { shapes } },
  };
}

// ---------- big top: striped canopy + striped canvas skirt (open at the two doors), on the hall's roof slot ----------
function bigTopCanopyDef() {
  const S = 24, R = 16.4, H = 8, SK = 15.8, shapes = [];
  for (let k = 0; k < S; k++) shapes.push({ kind: 'cone', at: [0, H / 2, 0], r: R, h: H, segments: 2, arc: r3((2 * Math.PI) / S), yaw: r3((k * 2 * Math.PI) / S), color: k % 2 ? CREAM : RED, material: 'fabric', collide: false });
  shapes.push({ kind: 'torus', at: [0, 0.05, 0], r: R - 0.1, r2: 0.12, segments: 24, pitch: 1.5708, color: GOLD, collide: false });
  // skirt: 24 panels round the square hall (corners at 15.56 m); the two panels either side of each door axis are left out
  const w = 2 * SK * Math.sin(Math.PI / S) + 0.06;
  for (let k = 0; k < S; k++) {
    const a = ((k + 0.5) * 2 * Math.PI) / S;
    if (k === 0 || k === S - 1 || k === S / 2 - 1 || k === S / 2) continue; // doors on the hall's s and n walls
    shapes.push({ kind: 'box', at: [r3(SK * Math.sin(a)), -2.55, r3(SK * Math.cos(a))], size: [r3(w), 5.2, 0.08], yaw: r3(a), color: k % 2 ? RED : CREAM, material: 'fabric', collide: false });
  }
  // door posts at the skirt's openings, the king pole and its pennant
  for (const a of [Math.PI / 12, -Math.PI / 12, Math.PI - Math.PI / 12, Math.PI + Math.PI / 12]) shapes.push({ kind: 'cyl', at: [r3(SK * Math.sin(a)), -2.5, r3(SK * Math.cos(a))], r: 0.1, h: 5.2, segments: 6, color: GOLD, collide: false });
  shapes.push({ kind: 'cyl', at: [0, H + 1.4, 0], r: 0.09, h: 3, segments: 6, color: '#5a4632', collide: false });
  shapes.push({ kind: 'box', at: [0.6, H + 2.5, 0], size: [1.2, 0.7, 0.05], color: '#f0c040', collide: false });
  return {
    schema: 'def/1', name: 'eden-big-top-canopy', version: 1,
    description: 'The canvas of a circus big top: a red and white striped canopy (33 m) with a gold rim, a striped canvas skirt round the hall below, open at both doors, and a pennant on the king pole; sits on an enterable hall.',
    tags: ['eden', 'scenery'], form: 'point', layer: 'decor',
    size: { box: [33, H + 9, 33], scale: [1, 1] }, make: { kind: 'gen', gen: 'kit/2', args: { shapes } },
  };
}

// ---------- bunting: a 10 m run of pennants on a cord between two poles (decor) ----------
function buntingDef() {
  const L = 10, shapes = [], cols = ['#c9342d', '#f0c040', '#3d8ab0', '#2e9e5a', '#f4efe4', '#e86aa8'];
  for (const x of [-L / 2, L / 2]) shapes.push({ kind: 'cyl', at: [x, 1.6, 0], r: 0.06, h: 3.2, segments: 6, color: '#6b5038', collide: false });
  const sag = (x) => 3.05 - 0.45 * (1 - (2 * x / L) ** 2);
  shapes.push({ kind: 'sweep', at: [0, 0, 0], path: [-5, -2.5, 0, 2.5, 5].map((x) => [x, r3(sag(x)), 0]), r: 0.015, segments: 5, color: '#3a3430', collide: false });
  for (let i = 0; i < 14; i++) {
    const x = -L / 2 + 0.55 + i * ((L - 1.1) / 13);
    shapes.push({ kind: 'extrude', at: [r3(x), r3(sag(x) - 0.02), 0], polygon: [[-0.17, 0], [0.17, 0], [0, 0.34]], h: 0.02, pitch: 1.5708, color: cols[i % cols.length], collide: false });
  }
  return {
    schema: 'def/1', name: 'eden-bunting', version: 1,
    description: 'A 10 m run of coloured bunting: fourteen pennants on a sagging cord between two wooden poles (3.2 m).',
    tags: ['eden', 'decor', 'fair', 'bunting'], form: 'point', layer: 'decor',
    size: { box: [10.2, 3.3, 0.2], scale: [0.5, 2] }, make: { kind: 'gen', gen: 'kit/2', args: { shapes } },
  };
}

// ---------- amphitheatre: a painted round stage floor ----------
// ---------- the big wheel: old Eden's ~29 m wheel with hanging gondolas, replacing the 17 m core wheel at the resort ----------
// The wheel turns (spin role `wheel`); sixteen gondolas are kit role `gondola`, each pivoted at its hanger point, which the
// viewer carries round with the wheel upright (apps/web gen-mesh/motion.ts hangFrom). Proportions keep its ride (server
// god/rides.ts attractionRoute: a circle of radius width/2 - 1 about height radius + 1) on the gondolas' own circle, and the
// bottom gondola at the boarding platform.
const WHEEL = { R: 13, H: 15.4, N: 16, legX: 8, legZ: 1.5, rim: 0.6 };
function bigWheelDef() {
  const { R, H, N, legX, legZ, rim } = WHEEL, shapes = [], hub = [0, H, 0];
  const RIM = '#f4f0e6', LEG = '#c9342d', CABS = ['#c9342d', '#f0c040', '#2e8b57', '#6a3d8f', '#e07b39', '#3a7fc4'];
  const W = { role: 'wheel', pivot: hub, collide: false };
  // base platform, boarding steps in front, and two A-frames (front and back) up to the axle
  shapes.push({ kind: 'extrude', at: [0, 0, 0], polygon: [[-legX - 1, -legZ - 1], [legX + 1, -legZ - 1], [legX + 1, legZ + 1], [-legX - 1, legZ + 1]], h: 0.4, color: '#9a958a' });
  shapes.push({ kind: 'extrude', at: [0, 0, legZ + 1.6], polygon: [[-2, -0.6], [2, -0.6], [2, 0.6], [-2, 0.6]], h: 0.2, color: '#9a958a' });
  for (const z of [-legZ, legZ]) {
    for (const x of [-legX, legX]) shapes.push({ kind: 'sweep', at: [0, 0, 0], path: [[x, 0.4, z], [0, H, z * 0.55]], r: 0.32, segments: 8, color: LEG });
    shapes.push({ kind: 'sweep', at: [0, 0, 0], path: [[-legX * 0.55, H * 0.45, z * 0.8], [legX * 0.55, H * 0.45, z * 0.8]], r: 0.16, segments: 6, color: LEG });
  }
  shapes.push({ kind: 'cyl', at: [0, H, 0], r: 0.3, h: 2 * legZ + 0.4, segments: 10, pitch: 1.5708, color: DARK });
  // the wheel: two rims with an inner ring, sixteen spokes a side (eight diameters); the kit allows 96 shapes in all
  shapes.push({ kind: 'cyl', at: [0, H, 0], r: 0.8, h: 1.6, segments: 12, pitch: 1.5708, color: '#d9d2c3', ...W });
  for (const z of [-rim, rim]) {
    shapes.push({ kind: 'torus', at: [0, H, z], r: R, r2: 0.13, segments: 64, color: RIM, ...W });
    shapes.push({ kind: 'torus', at: [0, H, z], r: R * 0.55, r2: 0.07, segments: 40, color: RIM, ...W });
    for (let k = 0; k < N / 2; k++) { const a = (k / N) * Math.PI * 2 + Math.PI / N; shapes.push({ kind: 'box', at: [0, H, z], size: [2 * R, 0.07, 0.07], roll: r3(a), color: RIM, ...W }); }
  }
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2 - Math.PI / 2, P = [r3(R * Math.cos(a)), r3(H + R * Math.sin(a)), 0], c = CABS[k % CABS.length];
    // the gondola, hanging from its axle between the rims: hanger, white roof, coloured cabin with a window band
    const G = { role: 'gondola', pivot: P, collide: false };
    shapes.push({ kind: 'box', at: [P[0], r3(P[1] - 0.2), 0], size: [0.1, 0.4, 2 * rim], color: DARK, ...G });
    shapes.push({ kind: 'box', at: [P[0], r3(P[1] - 0.45), 0], size: [1.8, 0.14, 1.5], color: CREAM, ...G });
    shapes.push({ kind: 'box', at: [P[0], r3(P[1] - 1.05), 0], size: [1.6, 1.05, 1.35], color: c, ...G });
    shapes.push({ kind: 'box', at: [P[0], r3(P[1] - 0.85), 0], size: [1.64, 0.34, 1.1], color: '#2b3a44', ...G });
  }
  return {
    schema: 'def/1', name: 'eden-big-wheel', version: 1,
    description: `A big ferris wheel (${Math.round(H + R + 0.3)} m) on red A-frames with sixteen hanging gondolas; it turns slowly and residents ride it.`,
    tags: ['play', 'ferris-wheel', 'ride', 'fair', 'structure', 'large', 'moving', 'eden'], form: 'point', layer: 'solid',
    components: { carrier: { seats: 16 }, spin: { axis: 'z', rpm: 0.8, role: 'wheel' } },
    make: { kind: 'gen', gen: 'kit/2', args: { shapes } },
  };
}

function stageFloorDef() {
  const S = 8, R = 1.9, cols = ['#d9534f', '#f0ad4e', '#f4d35e', '#5cb85c', '#3d8ab0', '#6f5fb0', '#e86aa8', '#f4efe4'], shapes = [];
  // each segment an explicit wedge polygon (a cyl `arc` slice drew whole overlapping discs that z-fought)
  for (let k = 0; k < S; k++) {
    const poly = [[0, 0]];
    for (let j = 0; j <= 6; j++) { const a = ((k + j / 6) * 2 * Math.PI) / S; poly.push([r3(R * Math.cos(a)), r3(R * Math.sin(a))]); }
    shapes.push({ kind: 'extrude', at: [0, 0.01, 0], polygon: poly, h: 0.03, color: cols[k], collide: false });
  }
  shapes.push({ kind: 'cyl', at: [0, 0.03, 0], r: 0.35, h: 0.035, segments: 12, color: '#2a2826', collide: false });
  shapes.push({ kind: 'torus', at: [0, 0.03, 0], r: R, r2: 0.04, segments: 24, pitch: 1.5708, color: '#f4efe4', collide: false });
  return {
    schema: 'def/1', name: 'eden-stage-floor', version: 1,
    description: 'A round painted stage floor (3.8 m) in eight bright segments with a white rim, laid on the ground for open-air music.',
    tags: ['eden', 'decor', 'stage', 'music'], form: 'point', layer: 'decor',
    size: { box: [3.9, 0.08, 3.9], scale: [0.5, 2] }, make: { kind: 'gen', gen: 'kit/2', args: { shapes } },
  };
}

// ---------- the batch ----------
const TERRACE_Y = 35.4; // the mountain restaurant's floor level
const STATION_PATH = [[-1, -301], [-26, -305], [-26, -310.2], [1.2, -310.8]];
// its grade, frozen here (team/scratch/t4/e2/grade-station.ts on the copy before the path): prepareRoad's profile but
// with its ends on the two pads it joins (35.46 restaurant, 43.9 station). prepareRoad's one-sided 24 m average at the
// ends left them 4.7 m above the restaurant pad and 3.2 m above the station's: a cliff at each end
const STATION_GRADE = {"sig":"1dz9lnf","h":[35.46,35.74,36.11,36.56,37.06,37.6,38.17,38.74,39.31,39.86,40.36,40.81,41.19,41.48,42.28,42.75,43.52,43.8,44.17,44.6,45.09,45.62,46.19,46.76,46.56,46,45.46,44.97,44.54,44.18,43.9],"spans":[],"maxGrade":0.25,"cut":4.01,"fill":0.6};
const place = (def, name, p, extra = {}) => ({ op: 'place', def, name, ...(p ? { p } : {}), ...extra });
function landmarkOps() {
  const ops = [
    { op: 'define', def: cableCarDef() }, { op: 'define', def: buntingDef() }, { op: 'define', def: stageFloorDef() }, { op: 'define', def: bigWheelDef() },
    // cable car, at the valley station with its height given (anchor center: no settling, no pad)
    place('eden-cable-car@1', 'alpine-cable-car', [VALLEY.x, VALLEY.g, VALLEY.z], { anchor: 'center' }),
    // mountain restaurant sun terrace, level with the restaurant's pad, on its downhill side
    // (flat to its edges, edge 1: with a wide blend the tables' pads settled at different heights, 2 m apart, and no chair
    // had standing room; it stops short of the restaurant's footprint so the restaurant keeps its own level)
    place('core/terrace@1', 'land-alpine-restaurant-terrace', null, { shape: { area: [[5, -297.5], [17, -297.5], [17, -290.5], [5, -290.5]] }, params: { level: TERRACE_Y, edge: 1 } }),
    // tables and lights at the terrace's level (y given): settled in the same batch as the terrace, each table cut its own
    // pad at the slope's height, a metre or two below the terrace. One row of three, each footprint over a metre inside
    // the terrace's edge (the edge blends 1 m inward): a later edit on this tile re-settles them on their lowest corner, and
    // with two rows of two the corners on the blend sank them 2.4 m into pads of their own (seen on the copy when the
    // station path went in). The terrace cannot grow north: the switchback runs along that edge
    ...[[7.5, -294.3], [11, -294.3], [14.5, -294.3]].map(([x, z], i) => place('core/parasol-table@1', `alpine-terrace-table-${i + 1}`, [x, TERRACE_Y, z], { params: { canopy: i % 3 === 1 ? CREAM : '#c43a2a' } })),
    place('core/string-lights@1', 'alpine-terrace-lights', [11, TERRACE_Y, -291.6]),
    // the mountain station's own path: its pad is cut 8 m above the restaurant's (2 m apart, a cliff between), so it was an
    // island. A graded gravel path like the switchback leaves the restaurant's west side, climbs west across the hillside,
    // turns and comes back east in a cutting to the station's west apron, round the corner from its south door. Its legs
    // keep 6-7 m from each other and from the switchback's last leg: graded paths blend 3 m past their edges and the later
    // one (by id) dragged the other's uphill side into a step a resident could not climb
    place('core/footpath@1', 'land-alpine-station-path', null, { shape: { path: STATION_PATH }, params: { width: 2.5, material: 'gravel', maxGrade: 0.25, autoBridge: false, edging: false, grade: STATION_GRADE } }),
    // fair: bunting avenues to the big top's two doors
    ...[[272, 75], [282, 75], [272, 29], [282, 29]].map(([x, z], i) => place('eden-bunting@1', `fair-bunting-${i + 1}`, [x, z], { r: 1.5708 })),
    // the big wheel in the 17 m core wheel's place (same name, so its ride re-routes rather than doubling), with a ticket
    // booth, two flags and festoon lights at its front, clear of its base and of the boarding step its ride uses
    place('eden-big-wheel@1', 'resort-ferris-wheel', [184, 124]),
    place('core/kiosk@1', 'resort-ferris-ticket-booth', [195.5, 128.5], { r: -1.5708, params: { paint: '#c43a2a', roof: '#f0c040' } }),
    place('core/flagpole@1', 'resort-ferris-flag-1', [176.5, 129.5], { params: { flag: '#c43a2a' } }),
    place('core/flagpole@1', 'resort-ferris-flag-2', [191.5, 130.5], { params: { flag: '#f0c040' } }),
    place('core/string-lights@1', 'resort-ferris-lights', [184, 128.4]),
    // playground: a sandy yard in a red picket fence with gates on the avenue side and the west
    place('core/sand-patch@1', 'park-playground-sand', null, { shape: { area: [[10, 96.5], [26, 96.5], [26, 109], [10, 109]] }, params: { material: 'sand', edge: 0.6 } }),
    place('core/fence@1', 'park-playground-fence', null, { shape: { path: [[9, 95.5], [27, 95.5], [27, 110], [9, 110], [9, 95.5]] }, params: { style: 'picket', color: '#c43a2a', height: 0.9, gates: [{ at: 9, width: 2.2, state: 'open' }, { at: 57.75, width: 2.2, state: 'open' }] } }),
    // amphitheatre: painted stage floor under the microphone, two speakers either side facing the steps
    place('eden-stage-floor@1', 'amphitheatre-stage-floor', [76, 80.6]),
    place('core/speaker@1', 'amphitheatre-speaker-1', [73.3, 79.4]),
    place('core/speaker@1', 'amphitheatre-speaker-2', [78.7, 79.4]),
  ];
  return ops;
}
// existing things moved: clear of the big top's new canvas (they stood where the skirt now hangs), and the marina's two
// inshore sailboats (their row at z 151 is dry beach): moored either side of the first pontoon's head (x 121.5-126.5,
// z 167-172), in 5.5 m of water
const MOVES = { 'festival-flag-1': [270.8, 34.5], 'festival-flag-2': [276, 34.5], 'festival-flag-3': [284, 34.5], 'festival-lights-2': [262.5, 69.5],
  'marina-sailboat-3': [119.6, 169.5], 'marina-sailboat-4': [128.4, 169.5] };

const tpl = JSON.parse(readFileSync(TPL, 'utf8'));
tpl.batches = tpl.batches.filter((b) => b.note !== NOTE);
let redefined = 0, moved = 0;
for (const b of tpl.batches) for (const o of b.ops) {
  if (o.op === 'define' && o.def.name === 'eden-big-top-canopy') { o.def = bigTopCanopyDef(); redefined++; }
  if (o.op === 'place' && MOVES[o.name] && (o.in?.parent ?? 'world') === 'world') { o.p = MOVES[o.name]; moved++; }
}
// the alpine switchback: ungraded, its last two legs climbed the summit's slope at 32-35 % across ground steeper than a
// resident can walk (30 degrees), so the summit (mountain station, restaurant, terrace) was an island nobody reached on
// foot. Now graded (<= 25 %), with the last climb as five shorter zigzags (raw leg grades 5-20 %) ending at the
// restaurant's front; grading the old legs as they were cut the summit down by 6-8 m.
const SWITCHBACK = [[-20, -134], [-45, -177], [23, -201], [-31, -235], [26, -260], [-24, -266], [22, -273], [-22, -280], [20, -287], [-18, -293], [1, -297]];
const PARAMS = { 'land-alpine-switchback': { width: 3, maxGrade: 0.25 } };
let reparamed = 0;
for (const b of tpl.batches) for (const o of b.ops) if (o.op === 'place' && PARAMS[o.name] && (o.in?.parent ?? 'world') === 'world') { o.params = { ...o.params, ...PARAMS[o.name] }; o.shape = { path: SWITCHBACK }; reparamed++; }
// the mountain station's north door opened onto the 8 m cut behind it and its south door onto the drop to the restaurant
// (no footing outside either): the north door moves to the west wall, onto the apron where the station path arrives
let redoored = 0;
for (const b of tpl.batches) for (const o of b.ops) if (o.op === 'place' && o.name === 'region-alpine-mountain-station' && (o.in?.parent ?? 'world') === 'world') {
  for (const x of o.params.plan.floors[0].exterior) if (x.kind === 'door' && (x.wall === 'n' || x.wall === 'w')) { x.wall = 'w'; redoored++; }
}
if (redoored !== 1) throw new Error(`template drifted: station doors ${redoored}`);
if (redefined !== 1 || moved !== Object.keys(MOVES).length || reparamed !== Object.keys(PARAMS).length) throw new Error(`template drifted: redefined ${redefined}, moved ${moved}`);
// the 17 m core wheel's own op goes (the big wheel above takes its name); absent when this script ran before
for (const b of tpl.batches) b.ops = b.ops.filter((o) => !(o.op === 'place' && o.name === 'resort-ferris-wheel' && o.def === 'core/ferris-wheel@1'));
tpl.batches.push({ note: NOTE, group: 'eden-2026', ops: landmarkOps() });
writeFileSync(TPL, JSON.stringify(tpl, null, 2) + '\n');
console.log(JSON.stringify({ template: TPL, added: tpl.batches.at(-1).ops.length, redefined, moved, reparamed }));

// Path-form generators: road, path, wall, fence, hedge, river, bridge, power-line. Owner: L3.
// Spec <eden4>/29 WP3, 33 §2 rows 5–6.
// Roads and footpaths live in road.ts, rivers and shores in river.ts, bridges/piers/decks in
// bridge.ts, landform generators in landforms.ts. Walls, fences, hedges and power lines are here:
// colliders are wall segments (ground-relative heights, see terrain-query.ts), gates are gaps.
import { bounds2, boxOfBounds, n, segmentColliders } from './geom.ts';
import { BRIDGE_GENERATORS } from './bridge.ts';
import { LANDFORM_GENERATORS } from './landforms.ts';
import { RIVER_GENERATORS } from './river.ts';
import { footpathGen, roadGen } from './road.ts';
import { pointAlong } from './geom.ts';
import type { Generator, Opening, Shape, Vec2 } from './types.ts';

const pathOf = (shape: Shape | undefined): Vec2[] => shape?.path ?? [[-5, 0], [5, 0]];
export { roadGen, footpathGen };

type Gate = { at: number; width: number; state?: 'open' | 'closed' };
export function gatesOf(v: unknown): Gate[] { return Array.isArray(v) ? (v as Gate[]).filter((g) => g && typeof g.at === 'number' && typeof g.width === 'number' && g.width > 0) : []; }
/** Gates as openings (Stage B: walkable when open) at their arc-length positions. */
function gateOpenings(path: Vec2[], gates: Gate[], h: number): Opening[] {
  let total = 0; for (let i = 1; i < path.length; i++) total += Math.sqrt((path[i][0] - path[i - 1][0]) ** 2 + (path[i][1] - path[i - 1][1]) ** 2);
  return gates.map((g, i) => { const { p, dir } = pointAlong(path, total ? g.at / total : 0); return { id: `gate-${i + 1}`, kind: 'gate' as const, at: p, yaw: Math.atan2(-dir[1], dir[0]), width: g.width, height: h, level: 0, state: g.state ?? 'closed' }; });
}

export const wallGen: Generator = {
  id: 'wall/1', form: 'path', owner: 'L3', doc: 'A freestanding wall along a path (garden wall, partition, rampart) with optional gates at arc-length positions.',
  params: { height: { type: 'number', min: 0.3, max: 12, default: 1.8 }, thickness: { type: 'number', min: 0.08, max: 3, default: 0.3 }, material: { type: 'enum', values: ['stone', 'brick', 'plaster', 'wood', 'hedge', 'glass'], default: 'stone' }, color: { type: 'color', default: '#c9c1b2' }, gates: { type: 'json', doc: '[{at: metres along, width}]' }, cap: { type: 'bool', default: true } },
  physics({ params, shape }) {
    const path = pathOf(shape), h = n(params.height, 1.8), t = n(params.thickness, 0.3);
    const g = gatesOf(params.gates), gaps = g.map((x) => ({ from: x.at - x.width / 2, to: x.at + x.width / 2 }));
    return { box: boxOfBounds(bounds2(path, t), h), colliders: segmentColliders(path, t, 0, h, gaps, 'wall'), openings: gateOpenings(path, g, h), slots: [], tris: path.length * 36 + g.length * 80 };
  },
};
export const fenceGen: Generator = {
  id: 'fence/1', form: 'path', owner: 'L3', doc: 'A fence of posts and rails (picket, rail, wire). Blocks walking, not sight.',
  params: { height: { type: 'number', min: 0.4, max: 3, default: 1.1 }, style: { type: 'enum', values: ['picket', 'rail', 'wire', 'iron'], default: 'picket' }, color: { type: 'color', default: '#e9e2d0' }, postSpacing: { type: 'number', min: 0.5, max: 6, default: 2 }, gates: { type: 'json' } },
  physics({ params, shape }) {
    const path = pathOf(shape), h = n(params.height, 1.1);
    const g = gatesOf(params.gates), gaps = g.map((x) => ({ from: x.at - x.width / 2, to: x.at + x.width / 2 }));
    return { box: boxOfBounds(bounds2(path, 0.1), h), colliders: segmentColliders(path, 0.08, 0, h, gaps, 'fence'), openings: gateOpenings(path, g, h), slots: [], tris: path.length * 40 };
  },
};
export const hedgeGen: Generator = {
  id: 'hedge/1', form: 'path', owner: 'L3', doc: 'A clipped hedge along a path.',
  params: { height: { type: 'number', min: 0.3, max: 4, default: 1.2 }, width: { type: 'number', min: 0.3, max: 3, default: 0.8 }, color: { type: 'color', default: '#3f6b35' }, flowers: { type: 'bool', default: false }, gates: { type: 'json', doc: '[{at, width}] gaps' } },
  physics({ params, shape }) { const path = pathOf(shape), h = n(params.height, 1.2), w = n(params.width, 0.8), g = gatesOf(params.gates); return { box: boxOfBounds(bounds2(path, w), h), colliders: segmentColliders(path, w, 0, h, g.map((x) => ({ from: x.at - x.width / 2, to: x.at + x.width / 2 })), 'hedge'), openings: gateOpenings(path, g, h).map((o) => ({ ...o, kind: 'arch' as const, state: 'always' as const })), slots: [], tris: path.length * 60 }; },
};
export const powerLineGen: Generator = {
  id: 'power-line/1', form: 'path', owner: 'L3', doc: 'Poles along a path with drooping wires (decor).',
  params: { spacing: { type: 'number', min: 10, max: 80, default: 30 }, height: { type: 'number', min: 4, max: 20, default: 8 }, wires: { type: 'int', min: 1, max: 6, default: 3 }, droop: { type: 'number', min: 0, max: 0.1, default: 0.03, doc: 'sag as a fraction of the span' } },
  physics({ params, shape }) { const path = pathOf(shape); return { box: boxOfBounds(bounds2(path, 0.3), n(params.height, 8)), colliders: [], slots: [], tris: path.length * 30 }; },
};

export const PATH_GENERATORS = [roadGen, footpathGen, wallGen, fenceGen, hedgeGen, powerLineGen, ...RIVER_GENERATORS, ...BRIDGE_GENERATORS, ...LANDFORM_GENERATORS];

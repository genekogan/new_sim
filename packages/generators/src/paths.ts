// Path-form generators: road, path, wall, fence, hedge, river, bridge, power-line. Owner: L3.
// Spec <eden4>/29 WP3, 33 §2 rows 5–6.
// CONTRACT STUB (L1): params are final; physics is a working placeholder (surfaces for roads and
// paths, segment colliders for walls/fences/hedges, a carve + water for rivers, a deck for
// bridges). L3 adds grading, shoulders, intersections, auto-bridges, flow, waterfalls, shores.
import { bounds2, boxOfBounds, n, offsetPolyline, segmentColliders } from './geom.ts';
import type { Baked, Generator, Shape, Vec2 } from './types.ts';

const ribbon = (path: Vec2[], width: number): Vec2[] => [...offsetPolyline(path, width / 2), ...offsetPolyline(path, -width / 2).reverse()];
const pathOf = (shape: Shape | undefined): Vec2[] => shape?.path ?? [[-5, 0], [5, 0]];

function surfacePath(shape: Shape | undefined, width: number, material: string, tag: string): Baked {
  const path = pathOf(shape); const poly = ribbon(path, width);
  return { box: boxOfBounds(bounds2(poly), 0.1), colliders: [], surfaces: [{ level: 0, y: 0.02, polygon: poly, material, tag }], slots: [], tris: path.length * 4 };
}

export const roadGen: Generator = {
  id: 'road/1', form: 'path', owner: 'L3', doc: 'A road along a spline: width, material, kerbs, shoulders; follows and grades the terrain; auto-bridges water when asked.',
  params: { width: { type: 'number', min: 2, max: 30, default: 6 }, material: { type: 'enum', values: ['asphalt', 'cobble', 'gravel', 'dirt', 'sand'], default: 'cobble' }, kerb: { type: 'bool', default: true }, shoulder: { type: 'number', min: 0, max: 4, default: 0.6 }, maxGrade: { type: 'number', min: 0, max: 0.2, default: 0.08, doc: 'carve/fill to keep slope below this (0 = follow terrain)' }, autoBridge: { type: 'bool', default: true }, lines: { type: 'bool', default: false } },
  physics({ params, shape }) { return surfacePath(shape, n(params.width, 6), String(params.material ?? 'cobble'), 'road'); },
};
export const footpathGen: Generator = {
  id: 'path/1', form: 'path', owner: 'L3', doc: 'A footpath: narrow, follows the terrain, gravel or stepping stones.',
  params: { width: { type: 'number', min: 0.5, max: 6, default: 1.6 }, material: { type: 'enum', values: ['gravel', 'dirt', 'cobble', 'stone', 'wood'], default: 'gravel' }, edging: { type: 'bool', default: false } },
  physics({ params, shape }) { return surfacePath(shape, n(params.width, 1.6), String(params.material ?? 'gravel'), 'path'); },
};
export const wallGen: Generator = {
  id: 'wall/1', form: 'path', owner: 'L3', doc: 'A freestanding wall along a path (garden wall, partition, rampart) with optional gates at arc-length positions.',
  params: { height: { type: 'number', min: 0.3, max: 12, default: 1.8 }, thickness: { type: 'number', min: 0.08, max: 3, default: 0.3 }, material: { type: 'enum', values: ['stone', 'brick', 'plaster', 'wood', 'hedge', 'glass'], default: 'stone' }, color: { type: 'color', default: '#c9c1b2' }, gates: { type: 'json', doc: '[{at: metres along, width}]' }, cap: { type: 'bool', default: true } },
  physics({ params, shape }) {
    const path = pathOf(shape), h = n(params.height, 1.8), t = n(params.thickness, 0.3);
    const gates = Array.isArray(params.gates) ? (params.gates as { at: number; width: number }[]).map((g) => ({ from: g.at - g.width / 2, to: g.at + g.width / 2 })) : [];
    return { box: boxOfBounds(bounds2(path, t), h), colliders: segmentColliders(path, t, 0, h, gates, 'wall'), slots: [], tris: path.length * 24 };
  },
};
export const fenceGen: Generator = {
  id: 'fence/1', form: 'path', owner: 'L3', doc: 'A fence of posts and rails (picket, rail, wire). Blocks walking, not sight.',
  params: { height: { type: 'number', min: 0.4, max: 3, default: 1.1 }, style: { type: 'enum', values: ['picket', 'rail', 'wire', 'iron'], default: 'picket' }, color: { type: 'color', default: '#e9e2d0' }, postSpacing: { type: 'number', min: 0.5, max: 6, default: 2 }, gates: { type: 'json' } },
  physics({ params, shape }) {
    const path = pathOf(shape), h = n(params.height, 1.1);
    const gates = Array.isArray(params.gates) ? (params.gates as { at: number; width: number }[]).map((g) => ({ from: g.at - g.width / 2, to: g.at + g.width / 2 })) : [];
    return { box: boxOfBounds(bounds2(path, 0.1), h), colliders: segmentColliders(path, 0.08, 0, h, gates, 'fence'), slots: [], tris: path.length * 40 };
  },
};
export const hedgeGen: Generator = {
  id: 'hedge/1', form: 'path', owner: 'L3', doc: 'A clipped hedge along a path.',
  params: { height: { type: 'number', min: 0.3, max: 4, default: 1.2 }, width: { type: 'number', min: 0.3, max: 3, default: 0.8 }, color: { type: 'color', default: '#3f6b35' }, flowers: { type: 'bool', default: false } },
  physics({ params, shape }) { const path = pathOf(shape), h = n(params.height, 1.2), w = n(params.width, 0.8); return { box: boxOfBounds(bounds2(path, w), h), colliders: segmentColliders(path, w, 0, h, [], 'hedge'), slots: [], tris: path.length * 60 }; },
};
export const riverGen: Generator = {
  id: 'river/1', form: 'path', owner: 'L3', doc: 'A river along a path: carves a bed, fills with water flowing from the first point to the last; ends snap to lakes; waterfalls where the bed steps.',
  params: { width: { type: 'number', min: 1, max: 60, default: 6 }, depth: { type: 'number', min: 0.2, max: 10, default: 1.2 }, level: { type: 'number', min: -50, max: 400, default: -0.3, doc: 'water level at the source; L3 interpolates along the flow' }, banks: { type: 'enum', values: ['grass', 'sand', 'stone', 'reeds'], default: 'grass' } },
  physics({ params, shape }) {
    const path = pathOf(shape), w = n(params.width, 6), depth = n(params.depth, 1.2), level = n(params.level, -0.3);
    return { box: boxOfBounds(bounds2(path, w), depth), colliders: [], slots: [], landform: { kind: 'carve', path, w, bed: level - depth, edge: Math.max(1, w * 0.3) }, water: { level, path, width: w }, tris: 0 };
  },
};
export const bridgeGen: Generator = {
  id: 'bridge/1', form: 'path', owner: 'L3', doc: 'A bridge deck along a short path (over water or a gap), with rails and posts; a walkable surface above the water.',
  params: { width: { type: 'number', min: 1, max: 20, default: 3 }, deck: { type: 'number', min: 0, max: 20, default: 0.8, doc: 'deck height above the higher end' }, material: { type: 'enum', values: ['wood', 'stone', 'metal'], default: 'wood' }, arch: { type: 'number', min: 0, max: 6, default: 0.6, doc: 'rise at mid-span' }, rails: { type: 'bool', default: true } },
  physics({ params, shape }) {
    const path = pathOf(shape), w = n(params.width, 3), deck = n(params.deck, 0.8), poly = ribbon(path, w);
    const rails = params.rails === false ? [] : [...segmentColliders(offsetPolyline(path, w / 2), 0.08, deck, deck + 1.0, [], 'rail'), ...segmentColliders(offsetPolyline(path, -w / 2), 0.08, deck, deck + 1.0, [], 'rail')];
    return { box: boxOfBounds(bounds2(poly), deck + 1.2), colliders: rails, surfaces: [{ level: 0, y: deck, polygon: poly, material: String(params.material ?? 'wood'), tag: 'bridge' }], slots: [], tris: path.length * 60 };
  },
};
export const powerLineGen: Generator = {
  id: 'power-line/1', form: 'path', owner: 'L3', doc: 'Poles along a path with drooping wires (decor).',
  params: { spacing: { type: 'number', min: 10, max: 80, default: 30 }, height: { type: 'number', min: 4, max: 20, default: 8 } },
  physics({ params, shape }) { const path = pathOf(shape); return { box: boxOfBounds(bounds2(path, 0.3), n(params.height, 8)), colliders: [], slots: [], tris: path.length * 30 }; },
};

export const PATH_GENERATORS = [roadGen, footpathGen, wallGen, fenceGen, hedgeGen, riverGen, bridgeGen, powerLineGen];

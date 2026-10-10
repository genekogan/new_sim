// building/1 and stairs/1. Owner: L2 (buildings). Spec <eden4>/29 WP2, 33 §2 row 3.
// CONTRACT STUB (L1): params are final; physics is a working placeholder — a hollow one-room
// shell with a door on `front`, a floor surface, wall-segment colliders and a room slot — so
// gods can place buildings before L2 lands. L2 replaces `buildingPhysics` (auto-plan, floors,
// stairs, openings, roofs, balconies, architecture checks) keeping the params and Baked shape.
import { n, s, segmentColliders, rectPoly } from './geom.ts';
import type { Baked, Generator, Opening, Room, Vec2 } from './types.ts';

export const BUILDING_STYLES = ['cottage', 'townhouse', 'hall', 'barn', 'tower', 'pavilion', 'greenhouse', 'shed', 'shop', 'chapel'] as const;

export const buildingParams = {
  w: { type: 'number', min: 3, max: 40, default: 8, doc: 'width (x) in metres' },
  d: { type: 'number', min: 3, max: 40, default: 6, doc: 'depth (z) in metres' },
  floors: { type: 'int', min: 1, max: 6, default: 1 },
  floorHeight: { type: 'number', min: 2.4, max: 5, default: 2.8 },
  style: { type: 'enum', values: [...BUILDING_STYLES], default: 'cottage' },
  roof: { type: 'enum', values: ['gable', 'hip', 'flat', 'shed', 'dome', 'none'], default: 'gable' },
  roofPitch: { type: 'number', min: 0, max: 60, default: 32, doc: 'degrees' },
  material: { type: 'enum', values: ['plaster', 'brick', 'stone', 'wood', 'glass', 'metal'], default: 'plaster' },
  wall: { type: 'color', default: '#f1e7d2' },
  trim: { type: 'color', default: '#6b4a2b' },
  roofColor: { type: 'color', default: '#8a3b2a' },
  front: { type: 'enum', values: ['s', 'n', 'e', 'w'], default: 's', doc: 'side of the main door (s = +z)' },
  porch: { type: 'number', min: 0, max: 4, default: 0, doc: 'porch depth in metres (0 = none)' },
  balcony: { type: 'bool', default: false },
  windows: { type: 'number', min: 0, max: 1, default: 0.6, doc: 'window density along exterior walls' },
  plan: { type: 'json', doc: 'optional explicit plan: {floors:[{rooms:[{id,name,rect:[x0,z0,x1,z1]}],doors:[…],exterior:[…]}],stairs:[…]}' },
  wallThickness: { type: 'number', min: 0.1, max: 0.6, default: 0.22 },
} as const;

export function buildingPhysics(params: Record<string, unknown>): Baked {
  const w = n(params.w, 8), d = n(params.d, 6), fh = n(params.floorHeight, 2.8), floors = Math.round(n(params.floors, 1));
  const t = n(params.wallThickness, 0.22), front = s(params.front, 's'), height = fh * floors;
  const hx = w / 2, hz = d / 2, door = Math.min(1.1, w * 0.4);
  // perimeter walls; the front wall has a door gap at its middle
  const walls: Record<string, Vec2[]> = { s: [[-hx, hz], [hx, hz]], e: [[hx, hz], [hx, -hz]], n: [[hx, -hz], [-hx, -hz]], w: [[-hx, -hz], [-hx, hz]] };
  const colliders = Object.entries(walls).flatMap(([side, path]) => {
    const len = side === 's' || side === 'n' ? w : d;
    const gaps = side === front ? [{ from: len / 2 - door / 2, to: len / 2 + door / 2 }] : [];
    return segmentColliders(path, t, 0, height, gaps, `wall:${side}`);
  });
  const doorAt: Record<string, Vec2> = { s: [0, hz], n: [0, -hz], e: [hx, 0], w: [-hx, 0] };
  const doorYaw: Record<string, number> = { s: 0, n: Math.PI, e: -Math.PI / 2, w: Math.PI / 2 };
  const openings: Opening[] = [{ id: 'front-door', kind: 'door', at: doorAt[front], yaw: doorYaw[front], width: door, height: 2.1, level: 0, state: 'always' }];
  const inner = rectPoly(-hx + t, -hz + t, hx - t, hz - t);
  const rooms: Room[] = Array.from({ length: floors }, (_, f) => ({ id: f === 0 ? 'ground' : `floor-${f}`, name: f === 0 ? 'Ground floor' : `Floor ${f}`, floor: f, y: f * fh, polygon: inner, origin: [0, 0], yaw: 0, height: fh }));
  const outside: Vec2 = [doorAt[front][0] * (1 + 1.2 / Math.max(hx, hz)), doorAt[front][1] * (1 + 1.2 / Math.max(hx, hz))];
  return {
    box: [w, height + (s(params.roof, 'gable') === 'flat' ? 0.3 : Math.min(w, d) * 0.35), d],
    colliders,
    surfaces: rooms.map((r) => ({ level: r.floor, y: r.y + 0.05, polygon: inner, tag: r.id })),
    openings,
    links: [],
    rooms,
    slots: [
      ...rooms.map((r) => ({ id: r.id, kind: 'room' as const, p: [r.origin[0], r.y + 0.05, r.origin[1]] as [number, number, number], yaw: r.yaw, floor: r.floor, polygon: r.polygon, accepts: {}, capacity: 64, label: r.name })),
      { id: 'front', kind: 'stand' as const, p: [outside[0], 0, outside[1]] as [number, number, number], yaw: doorYaw[front], accepts: {}, capacity: 8 },
    ],
    tris: 400 * floors,
    notes: ['placeholder shell (L2 replaces with planned rooms, stairs, windows, roofs)'],
  };
}

export const buildingGen: Generator = {
  id: 'building/1', form: 'point', owner: 'L2', params: buildingParams as never,
  doc: 'A building with floors, rooms, doors, windows, stairs and a roof. Rooms are slots (`in: {parent, slot: "kitchen"}`). Style presets plan the rooms; `plan` overrides.',
  physics({ params }) { return buildingPhysics(params); },
};

export const stairsGen: Generator = {
  id: 'stairs/1', form: 'point', owner: 'L2',
  doc: 'A straight flight of stairs from y=0 to `rise`, `run` long, `width` wide; a link between two levels.',
  params: { rise: { type: 'number', min: 0.3, max: 12, default: 2.8 }, run: { type: 'number', min: 0.5, max: 20, default: 4 }, width: { type: 'number', min: 0.6, max: 6, default: 1.1 }, material: { type: 'enum', values: ['wood', 'stone', 'metal'], default: 'wood' }, rail: { type: 'bool', default: true } },
  physics({ params }) {
    const rise = n(params.rise, 2.8), run = n(params.run, 4), width = n(params.width, 1.1);
    return { box: [width, rise, run], colliders: [{ c: [0, 0], half: [width / 2, run / 2], yaw: 0, y0: 0, y1: Math.min(rise, 0.3) }], links: [{ id: 'flight', kind: 'stairs', from: 0, to: 1, path: [[0, run / 2], [0, -run / 2]], width, y0: 0, y1: rise }], surfaces: [{ level: 1, y: rise, polygon: rectPoly(-width / 2, -run / 2 - 0.5, width / 2, -run / 2), tag: 'landing' }], slots: [], tris: 24 * Math.ceil(rise / 0.18) };
  },
};

// Eden camp: a plain ~44 × 44 m hypothetical camp for the live Mars world (eden4 plan 22 §5 phase 3.2).
// Three walled buildings with real door gaps (kitchen, living room + classroom corner, bunk house), a
// fire circle, a garden, four ground sleeping mats and a yard with raw material piles and a marked
// build site. Composed only from existing catalog fixtures, items, regions and construction
// components; every activity example below plans against this state with the ordinary registry.
//
// Deliberately absent: humans (Souls are seeded by the host at the four arrival points), any
// timetable, routine, schedule or driver, and the computer-workshop / library-reading composites.
// Examples are single activities with `$role` placeholders; hosts choose when to play them.
import type { Diagnostic } from '../actions/types.ts';
import { hashOf } from '../core/hash.ts';
import { heading, rot2, sub2, type Vec2 } from '../core/math.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Obstacle, SpatialScene } from '../spatial/types.ts';
import { def } from '../world/catalog.ts';
import { component, emptyWorld } from '../world/factory.ts';
import type { Entity, Provenance, Region, WorldState } from '../world/types.ts';
import { itemEntity, placeOnSlot, surfaceSlot } from '../items/model.ts';
import { entityFootprint } from '../spatial/service.ts';
import type { OBB2 } from '../core/math.ts';
import { gardenState, type GardenEntity } from '../objects/garden.ts';
import { plantingState, type PlantingEntity } from '../objects/planting.ts';
import { layTargetForStanding } from '../construction/lying.ts';
import { place, type Site } from './build-bay.ts';

export const EDEN_CAMP_CAMPUS = 'eden-camp';
export const EDEN_CAMP_SCHEMA = 'eden-camp-affordances/1';
const PROVENANCE: Provenance = { origin: 'design-edit', confidence: 'hypothetical', note: 'Eden camp: authored plain camp for the live Mars world; not a historical Mars placement' };
const prov = () => ({ ...PROVENANCE });

// ---------------------------------------------------------------------------------------------
// Static scene: ground, building walls with door gaps. Interior fixtures are entities.

export const WALL_HEIGHT = 2.6;
const WALL_T = 0.2;
type Side = 's' | 'n' | 'e' | 'w';
export type CampDoor = { id: string; building: string; side: Side; at: number; width: number };
export type CampBuilding = { id: string; label: string; rect: [x0: number, z0: number, x1: number, z1: number] };

export const CAMP_BUILDINGS: CampBuilding[] = [
  { id: 'kitchen', label: 'Kitchen', rect: [-20, -20, -8, -8] },
  { id: 'living-room', label: 'Living room and classroom corner', rect: [-6, -20, 10, -8] },
  { id: 'bunkhouse', label: 'Bunk house', rect: [12, -20, 21, -8] },
];
export const CAMP_DOORS: CampDoor[] = [
  { id: 'kitchen-door', building: 'kitchen', side: 's', at: -14, width: 1.4 },
  { id: 'living-door', building: 'living-room', side: 's', at: 2, width: 1.6 },
  { id: 'bunkhouse-door', building: 'bunkhouse', side: 's', at: 16.5, width: 1.4 },
];

/** Inside / outside standing points 1.2 m either side of a door's centre. */
export function doorPoints(door: CampDoor): { inside: Vec2; outside: Vec2; centre: Vec2 } {
  const b = CAMP_BUILDINGS.find((x) => x.id === door.building)!;
  const [x0, z0, x1, z1] = b.rect;
  const c: Vec2 = door.side === 's' ? [door.at, z1] : door.side === 'n' ? [door.at, z0] : door.side === 'e' ? [x1, door.at] : [x0, door.at];
  const out: Vec2 = door.side === 's' ? [0, 1] : door.side === 'n' ? [0, -1] : door.side === 'e' ? [1, 0] : [-1, 0];
  return { centre: c, inside: [c[0] - out[0] * 1.2, c[1] - out[1] * 1.2], outside: [c[0] + out[0] * 1.2, c[1] + out[1] * 1.2] };
}

function wallSegment(id: string, a: number, b: number, fixed: number, alongX: boolean, label: string): Obstacle {
  const half = (b - a) / 2 + WALL_T / 2, mid = (a + b) / 2;
  return { id, obb: { c: alongX ? [mid, fixed] : [fixed, mid], half: alongX ? [half, WALL_T / 2] : [WALL_T / 2, half], yaw: 0 }, y0: 0, y1: WALL_HEIGHT, kind: 'wall', label };
}

function buildingWalls(b: CampBuilding): Obstacle[] {
  const [x0, z0, x1, z1] = b.rect, out: Obstacle[] = [];
  const sides: [Side, number, number, number, boolean][] = [['n', x0, x1, z0, true], ['s', x0, x1, z1, true], ['w', z0, z1, x0, false], ['e', z0, z1, x1, false]];
  for (const [side, a, bEnd, fixed, alongX] of sides) {
    const gaps = CAMP_DOORS.filter((d) => d.building === b.id && d.side === side).map((d) => [d.at - d.width / 2 - WALL_T / 2, d.at + d.width / 2 + WALL_T / 2] as Vec2).sort((p, q) => p[0] - q[0]);
    // Segments are shortened by half a wall thickness at a gap so the clear opening is exactly `width`.
    let from = a, k = 0;
    for (const [g0, g1] of gaps) {
      out.push(wallSegment(`${b.id}-wall-${side}${k++}`, from, g0, fixed, alongX, `${b.label} ${side} wall`));
      from = g1;
    }
    out.push(wallSegment(`${b.id}-wall-${side}${k}`, from, bEnd, fixed, alongX, `${b.label} ${side} wall`));
  }
  return out;
}

export function edenCampScene(): SpatialScene {
  return {
    bounds: [-22, -22, 22, 22],
    levels: [{ id: 0, y: 0, label: 'camp ground' }],
    surfaces: [{ id: 'camp-ground', level: 0, y: 0, obb: { c: [0, 0], half: [22, 22], yaw: 0 }, label: 'camp ground' }],
    obstacles: CAMP_BUILDINGS.flatMap(buildingWalls),
    links: [],
  };
}
/** The scene a host registers under `world.base.campus` (servicesFor({ [EDEN_CAMP_CAMPUS]: EDEN_CAMP_SCENE })). */
export const EDEN_CAMP_SCENE: SpatialScene = edenCampScene();

// ---------------------------------------------------------------------------------------------
// Construction: the lookout bay blueprint (build-bay flagship geometry with 8 ft frames, so a
// crew of four can hold both frames and seat beams). Site-local frame: upright A stands at the
// origin, the bay runs along +z to B one 9 ft beam away.

export const CAMP_BUILD_SITE: Site = { origin: [-12, 8], yaw: 0 };
const UPRIGHT = 'upright-8ft', BEAM = 'beam-9ft', JOIST = '2x4-6ft', SHEET = 'plywood-4x6';
const L9 = def(BEAM).size[0], D8 = def(UPRIGHT).size[0], PANEL_Z = def(SHEET).size[2];
export const LOOKOUT_BEAMS: { id: string; column: 'l' | 'r'; height: number; stage: Vec2 }[] = [
  { id: 'beam-1', column: 'r', height: 0.5, stage: [-(D8 / 2 + 0.2), L9 / 2] },
  { id: 'beam-2', column: 'l', height: 0.5, stage: [D8 / 2 + 0.2, L9 / 2] },
  { id: 'beam-3', column: 'r', height: 1.8, stage: [-(D8 / 2 + 0.6), L9 / 2] },
  { id: 'beam-4', column: 'l', height: 1.8, stage: [D8 / 2 + 0.6, L9 / 2] },
];
export const LOOKOUT_JOISTS: { id: string; at: number }[] = [0.2, 0.8, 1.37, 1.95, 2.55].map((at, k) => ({ id: `joist-${k + 1}`, at }));
export const LOOKOUT_SHEETS: { id: string; z: number; stage: Vec2 }[] = [
  { id: 'sheet-1', z: 0.15 + PANEL_Z / 2, stage: [2.6, 0.15 + PANEL_Z / 2] },
  { id: 'sheet-2', z: 0.15 + PANEL_Z * 1.5, stage: [-2.6, 2.0] },
];
const STAIR_FOOT: Vec2 = [0.94 + def('stair-flight-10').size[0], 0.75];

function siteXZ(x: number, z: number, yaw = 0) {
  const q = place(CAMP_BUILD_SITE, x, z, yaw);
  return { x: round(q.x), z: round(q.z), yaw: round(q.yaw) };
}
const round = (v: number) => Math.round(v * 1e6) / 1e6;

// ---------------------------------------------------------------------------------------------
// World

export type CampSpot = { id: string; label: string; region: string; p: Vec2 };
/** Four clear arrival points by the south gate, each facing the fire. Souls are seeded here by the host. */
export const CAMP_ARRIVALS: { id: string; p: Vec2; yaw: number }[] = [-3, -1, 1, 3].map((x, i) => {
  const p: Vec2 = [x, 18];
  return { id: `arrival-${i + 1}`, p, yaw: round(heading(sub2([0, 4], p))) };
});

const FIRE: Vec2 = [0, 4];

function rect(id: string, label: string, kind: Region['kind'], x0: number, z0: number, x1: number, z1: number): Region {
  return { id, label, kind, polygon: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], level: 0, provenance: prov() };
}
const MAT_HALF: Vec2 = [1.6, 0.7];
export const CAMP_MATS: { id: string; c: Vec2 }[] = [
  { id: 'mat-1', c: [14.2, -17.6] }, { id: 'mat-2', c: [18.8, -17.6] },
  { id: 'mat-3', c: [14.2, -13.6] }, { id: 'mat-4', c: [18.8, -13.6] },
];

function regions(): Region[] {
  const out: Region[] = [
    rect('kitchen', 'Kitchen', 'place', -19.9, -19.9, -8.1, -8.1),
    rect('living-room', 'Living room', 'place', 0.2, -19.9, 9.9, -8.1),
    rect('classroom-corner', 'Classroom corner', 'place', -5.9, -19.9, 0.2, -8.1),
    rect('bunkhouse', 'Bunk house', 'place', 12.1, -19.9, 20.9, -8.1),
    rect('fire-circle', 'Fire circle', 'place', -4, 0, 4, 8),
    rect('garden', 'Garden', 'place', 9, -1, 19, 10),
    rect('yard', 'Open yard', 'walkable', -5, 9, 8, 20),
    rect('arrival', 'South gate arrival', 'staging', -4, 17, 4, 19),
    rect('rack-pile', 'Rack pile: uprights and beams', 'material-pile', -21, -4, -14.5, 3.5),
    rect('timber-pile', 'Timber pile: 2x4 joists', 'material-pile', -20.5, 12, -18, 16.5),
    rect('plywood-pile', 'Plywood pile', 'material-pile', -21, 17, -17, 21),
    rect('build-site', 'Marked build site: lookout bay', 'work-area', siteXZ(-3.3, -3).x, siteXZ(-3.3, -3).z, siteXZ(6.5, 6).x, siteXZ(6.5, 6).z),
  ];
  for (const m of CAMP_MATS) out.push(rect(m.id, `Sleeping mat ${m.id.slice(4)}`, 'work-area', m.c[0] - MAT_HALF[0], m.c[1] - MAT_HALF[1], m.c[0] + MAT_HALF[0], m.c[1] + MAT_HALF[1]));
  return out;
}

const fixture = (id: string, defId: string, x: number, z: number, yaw = 0, label?: string): Entity => ({
  id, def: defId, kind: 'fixture', label, pose: { p: [x, 0, z], yaw }, support: { kind: 'ground' }, provenance: prov(),
});

function fixtures(): Entity[] {
  const out: Entity[] = [
    // Kitchen: preparation counter, dining table with a bench.
    fixture('prep-table', 'table-6ft', -16, -16, 0, 'Kitchen preparation counter'),
    fixture('dining-table', 'table-6ft', -12.5, -12.5, 0, 'Kitchen dining table'),
    fixture('dining-bench', 'bench-6ft', -12.5, -11.55, Math.PI, 'Dining bench'),
    // Classroom corner (living-room west): display, lectern, six audience chairs facing it.
    fixture('class-display', 'standing-display', -3, -19.3, 0, 'Classroom display'),
    fixture('class-lectern', 'speaker-lectern', -3, -16.5, 0, 'Classroom lectern'),
    ...[-13.5, -11.5].flatMap((z, r) => [-4.5, -3, -1.5].map((x, c) => fixture(`class-seat-${r * 3 + c + 1}`, 'camp-chair', x, z, Math.PI, `Classroom seat ${r * 3 + c + 1}`))),
    // Living room: two computers, chess table, reading table, drawing table, sofa bench.
    fixture('computer-1', 'computer-workstation', 5, -19, Math.PI, 'Computer 1'),
    fixture('computer-1-chair', 'camp-chair', 5, -17.8, Math.PI, 'Computer 1 chair'),
    fixture('computer-2', 'computer-workstation', 8, -19, Math.PI, 'Computer 2'),
    fixture('computer-2-chair', 'camp-chair', 8, -17.8, Math.PI, 'Computer 2 chair'),
    fixture('chess-table', 'table-6ft', 4.5, -13.5, 0, 'Chess table'),
    fixture('reading-table', 'table-6ft', 7.5, -10, 0, 'Reading table'),
    fixture('reading-chair', 'camp-chair', 7.35, -10.85, 0, 'Reading chair'),
    fixture('drawing-table', 'table-6ft', 8.5, -14.6, 0, 'Drawing table'),
    fixture('living-bench', 'bench-6ft', 4.5, -8.75, Math.PI, 'Living-room sofa bench'),
    fixture('listening-chair', 'camp-chair', 6.5, -16.3, Math.PI, 'Listening chair'),
    // Yard: fire ring with two benches; garden table and four raised planters.
    fixture('campfire', 'campfire', FIRE[0], FIRE[1], 0, 'Camp fire'),
    fixture('fire-bench-north', 'bench-6ft', FIRE[0], FIRE[1] - 3.4, 0, 'Fire bench (north)'),
    fixture('fire-bench-south', 'bench-6ft', FIRE[0], FIRE[1] + 3.4, Math.PI, 'Fire bench (south)'),
    fixture('garden-table', 'table-6ft', 14, 1, 0, 'Garden table'),
  ];
  for (const [i, x, z] of [[1, 12, 4.5], [2, 16, 4.5], [3, 12, 8], [4, 16, 8]] as const) {
    const e = fixture(`planter-${i}`, 'garden-planter', x, z, 0, `Planter ${i}`) as GardenEntity & PlantingEntity;
    e.gardenCare = gardenState();
    e.planting = plantingState();
    out.push(e);
  }
  return out;
}

/** Small items: [id, def, table#slot, contents?]. */
const ITEMS: [string, string, string, { food: string; fraction: number }?][] = [
  ['supper-pot', 'pot', 'prep-table#r0c2', { food: 'hypothetical cold shared dish', fraction: 0 }],
  ['beans-bowl', 'bowl', 'prep-table#r0c1', { food: 'beans', fraction: 1 }],
  ['greens-bowl', 'bowl', 'prep-table#r0c3', { food: 'greens', fraction: 1 }],
  ['prep-spoon', 'spoon', 'prep-table#r1c0'],
  ['stew-pot', 'pot', 'dining-table#r0c2', { food: 'stew', fraction: 1 }],
  ['bowl-1', 'bowl', 'dining-table#r0c0', { food: 'stew', fraction: 0 }],
  ['spoon-1', 'spoon', 'dining-table#r0c1'],
  ['bowl-2', 'bowl', 'dining-table#r0c4', { food: 'stew', fraction: 0 }],
  ['spoon-2', 'spoon', 'dining-table#r0c5'],
  ['bowl-3', 'bowl', 'dining-table#r2c0', { food: 'stew', fraction: 0 }],
  ['spoon-3', 'spoon', 'dining-table#r2c1'],
  ['bowl-4', 'bowl', 'dining-table#r2c4', { food: 'stew', fraction: 0 }],
  ['spoon-4', 'spoon', 'dining-table#r2c5'],
  ['camp-book', 'reading-book', 'reading-table#r0c2'],
  ['sketch-pad', 'drawing-pad', 'drawing-table#r0c2'],
  ['sketch-pencil', 'drawing-pencil', 'drawing-table#r0c3'],
  ['water-bowl', 'bowl', 'garden-table#r0c1', { food: 'water', fraction: 1 }],
  ['seed-bowl', 'bowl', 'garden-table#r0c4', { food: 'seeds', fraction: 0.5 }],
];

function placeItems(w: WorldState) {
  const put = (e: Entity, slotId: string) => {
    const s = surfaceSlot(w, slotId);
    if ('code' in s) throw new Error(`eden-camp: ${s.code}: ${s.message}`);
    placeOnSlot(e, s, w.entities[slotId.slice(0, slotId.indexOf('#'))]?.pose.yaw ?? 0);
    w.entities[e.id] = e;
  };
  for (const [id, defId, slot, contents] of ITEMS) put(itemEntity(id, defId, [0, 0, 0], 0, { provenance: prov(), ...(contents ? { contents: { ...contents } } : {}) }), slot);
  // Chess: board and capture tray rest on the chess table as fixtures, pieces on their squares.
  put({ id: 'chess-board', def: 'chess-board', kind: 'fixture', pose: { p: [0, 0, 0], yaw: 0 }, provenance: prov(), support: { kind: 'ground' } }, 'chess-table#r1c2');
  put({ id: 'chess-tray', def: 'chess-tray', kind: 'fixture', pose: { p: [0, 0, 0], yaw: 0 }, provenance: prov(), support: { kind: 'ground' } }, 'chess-table#r1c4');
  const position = openingPosition();
  // Players are bound by the host after seeding (bindCampChess); unbound boards refuse chess.wrong-player.
  w.entities['chess-board'].equipment = { kind: 'chess-board', config: { position: JSON.stringify(position), white: '', black: '' } };
  for (const p of position.pieces) put(itemEntity(p.id, `chess-${p.color}-${p.kind}`, [0, 0, 0], 0, { provenance: prov() }), `chess-board#${p.square}`);
  w.entities['class-display'].equipment = { kind: 'display', config: { available: true, mode: 'off', content: 'Camp classroom' } };
}

function openingPosition() {
  const row = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'] as const;
  const pieces: { id: string; color: 'white' | 'black'; kind: string; square: string }[] = [];
  for (const color of ['white', 'black'] as const)
    for (let x = 0; x < 8; x++) {
      const file = String.fromCharCode(97 + x), back = file + (color === 'white' ? 1 : 8), front = file + (color === 'white' ? 2 : 7);
      pieces.push({ id: `${color}-${row[x]}-${back}`, color, kind: row[x], square: back }, { id: `${color}-pawn-${front}`, color, kind: 'pawn', square: front });
    }
  return { pieces, turn: 'white' as const, ply: 0 };
}

function constructionComponents(): Entity[] {
  const c = (id: string, defId: string, x: number, z: number, yaw: number, extra: Partial<Entity> = {}) =>
    component(id, defId, [x, 0, z], yaw, { phase: 'stored', provenance: prov(), ...extra });
  const out: Entity[] = [
    // Rack pile: two 8 ft uprights lying flat side by side (height axis along +z), four 9 ft beams.
    c('upright-a', UPRIGHT, -19.6, -3, 0, { label: 'Upright A (8 ft)' }),
    c('upright-b', UPRIGHT, -17.6, -3, 0, { label: 'Upright B (8 ft)' }),
    ...LOOKOUT_BEAMS.map((b, k) => c(b.id, BEAM, -15.4 - 0.35 * k, 0, Math.PI / 2, { label: `9 ft beam ${k + 1}` })),
    ...LOOKOUT_JOISTS.map((j, k) => c(j.id, JOIST, -20 + 0.25 * k, 14.2, Math.PI / 2, { label: `6 ft 2x4 joist ${k + 1}` })),
    ...LOOKOUT_SHEETS.map((s, k) => c(s.id, SHEET, -19, 18 + 1.6 * k, 0, { label: `4x6 plywood sheet ${k + 1}` })),
  ];
  for (const e of out) if (e.def === UPRIGHT) e.pose.pitch = Math.PI / 2;
  // The stair flight and its treads are delivered beside the site (carrying stair modules is not modelled).
  const st = siteXZ(5.0, STAIR_FOOT[1], Math.PI);
  out.push(c('lookout-stair', 'stair-flight-10', st.x, st.z, st.yaw, { phase: 'staged', label: 'Lookout stair flight' }));
  for (let i = 1; i <= 10; i++) {
    const t = siteXZ(0.94 + 1.25 - (-1.25 + (i - 0.5) * 0.25), 3.3, Math.PI / 2);
    out.push(c(`tread-${i}`, 'stair-tread', t.x, t.z, t.yaw, { phase: 'staged', label: `Stair tread ${i}` }));
  }
  return out;
}

/**
 * The camp at genesis: fixtures, items, construction stock and regions; no humans. `seed` only
 * changes the world RNG; ids, geometry and tick (0) are the same for every seed.
 */
export function edenCampWorld(seed = EDEN_CAMP_CAMPUS): WorldState {
  const w = emptyWorld(EDEN_CAMP_CAMPUS, EDEN_CAMP_SCENE, seed);
  for (const e of [...fixtures(), ...constructionComponents()]) w.entities[e.id] = e;
  placeItems(w);
  for (const r of regions()) w.regions[r.id] = r;
  return w;
}

/** Bind the two chess players (host seeding step; a board with no players refuses every move). */
export function bindCampChess(w: WorldState, white: string, black: string) {
  const c = w.entities['chess-board'].equipment!.config;
  c.white = white;
  c.black = black;
}

// ---------------------------------------------------------------------------------------------
// Affordance manifest

export type CampNeed = 'energy' | 'hunger' | 'company' | 'restlessness';
export type CampActivity = {
  id: string;
  label: string;
  verb: string;
  region: string;
  /** Placeholders `$<role>` in params (strings and object keys) are replaced by bindCampActivity. */
  roles: string[];
  params: Record<string, unknown>;
  /** Needs this activity tends to satisfy (+) or cost (-). */
  needs: Partial<Record<CampNeed, 1 | -1>>;
  tags: string[];
  /** Plain-language precondition beyond "the people are free"; absent = playable at genesis. */
  requires?: string;
  /** Example ids whose completed effects establish `requires` (validation fixtures, not a schedule). */
  after?: string[];
  /** What the activity changes permanently in the world. */
  effect?: string;
};

const wsSeat = (n: number) => `computer-${n}-chair#seat`;
const doorOf = (id: string) => doorPoints(CAMP_DOORS.find((d) => d.id === id)!);

export const CAMP_SPOTS: CampSpot[] = [
  ...CAMP_ARRIVALS.map((a) => ({ id: a.id, label: `Arrival ${a.id.slice(8)}`, region: 'arrival', p: a.p })),
  ...CAMP_DOORS.flatMap((d) => {
    const q = doorPoints(d);
    return [{ id: `${d.id}-inside`, label: `${d.id} (inside)`, region: d.building, p: q.inside }, { id: `${d.id}-outside`, label: `${d.id} (outside)`, region: 'yard', p: q.outside }];
  }),
  { id: 'kitchen-middle', label: 'Kitchen floor', region: 'kitchen', p: [-12.5, -15] },
  { id: 'kitchen-talk', label: 'By the dining table', region: 'kitchen', p: [-12.5, -9.6] },
  { id: 'classroom-floor', label: 'Classroom corner floor', region: 'classroom-corner', p: [-3, -9.5] },
  { id: 'living-middle', label: 'Living-room floor', region: 'living-room', p: [2, -12] },
  { id: 'bunkhouse-aisle', label: 'Bunk house aisle', region: 'bunkhouse', p: [16.5, -15.6] },
  { id: 'fire-side', label: 'Beside the fire benches', region: 'fire-circle', p: [3.5, 4] },
  { id: 'yard-talk', label: 'Yard conversation spot', region: 'yard', p: [4, 12] },
  { id: 'garden-path', label: 'Garden path', region: 'garden', p: [14, 6.25] },
  { id: 'build-site-edge', label: 'Edge of the build site', region: 'build-site', p: [-9, 5.5] },
  { id: 'rack-pile-edge', label: 'Rack pile', region: 'rack-pile', p: [-14, -5] },
  { id: 'timber-pile-edge', label: 'Timber pile', region: 'timber-pile', p: [-17, 15] },
];

function constructionActivities(): CampActivity[] {
  const tA = layTargetForStanding(UPRIGHT, [0, 0], -Math.PI / 2), tB = layTargetForStanding(UPRIGHT, [0, L9], Math.PI / 2);
  const build = { region: 'build-site', tags: ['build', 'outdoors', 'physical'], needs: { restlessness: 1, energy: -1 } as CampActivity['needs'] };
  const a: CampActivity[] = [
    { id: 'build.carry-upright-a', label: 'Carry upright A from the rack pile to its raise position', verb: 'carry', roles: ['actor'], params: { crew: ['$actor'], item: 'upright-a', to: siteXZ(tA.x, tA.z, tA.yaw) }, ...build, effect: 'upright-a lies at the build site' },
    { id: 'build.carry-upright-b', label: 'Carry upright B from the rack pile to its raise position', verb: 'carry', roles: ['actor'], params: { crew: ['$actor'], item: 'upright-b', to: siteXZ(tB.x, tB.z, tB.yaw) }, ...build, effect: 'upright-b lies at the build site', requires: 'beams staged beside the bay first (B lies across their carry path)', after: LOOKOUT_BEAMS.map((b) => `build.carry-${b.id}`) },
    ...LOOKOUT_BEAMS.map((b): CampActivity => ({ id: `build.carry-${b.id}`, label: `Carry ${b.id} to the bay`, verb: 'carry', roles: ['actor'], params: { crew: ['$actor'], item: b.id, to: siteXZ(b.stage[0], b.stage[1], Math.PI / 2) }, ...build, effect: `${b.id} staged beside the bay` })),
    { id: 'build.raise-upright-a', label: 'Raise and hold upright A', verb: 'raise_upright', roles: ['actor'], params: { crew: ['$actor'], item: 'upright-a', stand_at: { x: siteXZ(0, 0).x, z: siteXZ(0, 0).z } }, ...build, requires: 'upright-a lying at its raise position, beams staged', after: ['build.carry-upright-a', ...LOOKOUT_BEAMS.map((b) => `build.carry-${b.id}`)], effect: 'upright-a standing, held by the actor until released' },
    { id: 'build.raise-upright-b', label: 'Raise and hold upright B', verb: 'raise_upright', roles: ['actor'], params: { crew: ['$actor'], item: 'upright-b', stand_at: { x: siteXZ(0, L9).x, z: siteXZ(0, L9).z } }, ...build, requires: 'upright-b lying at its raise position', after: ['build.carry-upright-b'], effect: 'upright-b standing, held by the actor until released' },
    ...LOOKOUT_BEAMS.map((b, k): CampActivity => ({ id: `build.seat-${b.id}`, label: `Seat ${b.id} at ${b.height} m`, verb: 'connect_beam', roles: ['actor', 'partner'], params: { crew: ['$actor', '$partner'], beam: b.id, a: 'upright-a', b: 'upright-b', column: b.column, height: b.height }, ...build, requires: 'both uprights standing and held (or stable); beam staged', after: ['build.raise-upright-a', 'build.raise-upright-b', ...LOOKOUT_BEAMS.slice(0, k).map((x) => `build.seat-${x.id}`)], effect: `${b.id} installed` })),
    { id: 'build.release-upright-a', label: 'Let go of upright A', verb: 'release_support', roles: [], params: { item: 'upright-a' }, ...build, requires: 'all four beams seated (stability rule)', after: LOOKOUT_BEAMS.map((b) => `build.seat-${b.id}`), effect: 'upright-a installed and self-supporting' },
    { id: 'build.release-upright-b', label: 'Let go of upright B', verb: 'release_support', roles: [], params: { item: 'upright-b' }, ...build, requires: 'all four beams seated (stability rule)', after: LOOKOUT_BEAMS.map((b) => `build.seat-${b.id}`), effect: 'upright-b installed and self-supporting' },
    ...LOOKOUT_JOISTS.map((j, k): CampActivity => ({ id: `build.carry-${j.id}`, label: `Carry ${j.id} to the bay`, verb: 'carry', roles: ['actor'], params: { crew: ['$actor'], item: j.id, to: siteXZ(-1.6 - 0.12 * k, 1.37, Math.PI / 2) }, ...build, requires: 'frame released', after: ['build.release-upright-a', 'build.release-upright-b', ...LOOKOUT_JOISTS.slice(0, k).map((x) => `build.carry-${x.id}`)], effect: `${j.id} staged beside the bay` })),
    ...LOOKOUT_JOISTS.map((j, k): CampActivity => ({ id: `build.fix-${j.id}`, label: `Set ${j.id} across the upper beams`, verb: 'install_joist', roles: ['actor'], params: { crew: ['$actor'], joist: j.id, bay: { a: 'upright-a', b: 'upright-b' }, height: 1.8, at: j.at }, ...build, requires: 'joist staged; upper beams installed', after: [...LOOKOUT_JOISTS.map((x) => `build.carry-${x.id}`), 'build.carry-sheet-1', ...LOOKOUT_JOISTS.slice(0, k).map((x) => `build.fix-${x.id}`)], effect: `${j.id} installed` })),
    ...LOOKOUT_SHEETS.map((s, k): CampActivity => ({ id: `build.carry-${s.id}`, label: `Carry ${s.id} to the bay`, verb: 'carry', roles: ['actor', 'partner'], params: { crew: ['$actor', '$partner'], item: s.id, to: siteXZ(s.stage[0], s.stage[1], 0) }, ...build, requires: k === 0 ? 'frame released' : 'joists installed (the sheet is staged where the joists lay)', after: k === 0 ? ['build.release-upright-a', 'build.release-upright-b'] : LOOKOUT_JOISTS.map((x) => `build.fix-${x.id}`), effect: `${s.id} staged beside the bay` })),
    ...LOOKOUT_SHEETS.map((s, k): CampActivity => {
      const q = siteXZ(0, s.z, 0);
      return { id: `build.deck-${s.id}`, label: `Lay ${s.id} on the joists`, verb: 'install_plywood', roles: ['actor', 'partner'], params: { crew: ['$actor', '$partner'], sheet: s.id, x: q.x, z: q.z, yaw: q.yaw }, ...build, requires: 'sheet staged; joists installed', after: ['build.carry-sheet-1', 'build.carry-sheet-2', ...LOOKOUT_SHEETS.slice(0, k).map((x) => `build.deck-${x.id}`)], effect: `${s.id} installed as deck` };
    }),
  ];
  const sp = siteXZ(STAIR_FOOT[0], STAIR_FOOT[1], Math.PI);
  a.push({ id: 'build.set-stair', label: 'Set the stair flight against the deck', verb: 'install_stair_flight', roles: ['actor', 'partner'], params: { crew: ['$actor', '$partner'], stair: 'lookout-stair', x: sp.x, z: sp.z, heading: sp.yaw }, ...build, requires: 'deck laid; nobody standing on the stair footprint', after: LOOKOUT_SHEETS.map((s) => `build.deck-${s.id}`), effect: 'stair flight installed (treads still missing)' });
  for (let i = 1; i <= 10; i++)
    a.push({ id: `build.tread-${i}`, label: `Fit stair tread ${i}`, verb: 'install_tread', roles: ['actor'], params: { crew: ['$actor'], stair: 'lookout-stair', tread: `tread-${i}`, index: i }, ...build, requires: i === 1 ? 'stair flight installed' : `tread ${i - 1} fitted`, after: ['build.set-stair', ...Array.from({ length: i - 1 }, (_, k) => `build.tread-${k + 1}`)], effect: `tread-${i} installed` });
  const top = siteXZ(0, 1.37);
  a.push({ id: 'build.climb-lookout', label: 'Walk up onto the lookout deck', verb: 'walk_to', roles: ['actor'], params: { actor: '$actor', x: top.x, z: top.z, level: 4 }, ...build, tags: ['build', 'outdoors', 'view'], needs: { restlessness: 1 }, requires: 'stair complete (all ten treads)', after: Array.from({ length: 10 }, (_, k) => `build.tread-${k + 1}`) });
  return a;
}

export function edenCampActivities(): CampActivity[] {
  const kd = doorOf('kitchen-door'), ld = doorOf('living-door');
  return [
    // Movement and company anywhere.
    { id: 'camp.walk-to-fire', label: 'Walk over to the fire', verb: 'walk_to', region: 'fire-circle', roles: ['actor'], params: { actor: '$actor', x: 3.5, z: 4 }, needs: { restlessness: 1 }, tags: ['move', 'outdoors'] },
    { id: 'camp.walk-to-kitchen', label: 'Go into the kitchen', verb: 'walk_to', region: 'kitchen', roles: ['actor'], params: { actor: '$actor', x: kd.inside[0], z: kd.inside[1] - 2 }, needs: {}, tags: ['move', 'indoors'] },
    { id: 'camp.wander-yard', label: 'Stroll around the yard', verb: 'ambient_wander', region: 'yard', roles: ['actor'], params: { actors: ['$actor'], region: 'yard', duration: 120 }, needs: { restlessness: 1 }, tags: ['move', 'outdoors', 'alone'] },
    { id: 'camp.talk-yard', label: 'Talk in the yard', verb: 'converse', region: 'yard', roles: ['actor', 'partner'], params: { actors: ['$actor', '$partner'], at: [4, 12], duration: 90 }, needs: { company: 1 }, tags: ['talk', 'outdoors'] },
    { id: 'camp.warmup', label: 'Lead a standing warm-up in the yard', verb: 'group_warmup', region: 'yard', roles: ['instructor', 'f1', 'f2', 'f3'], params: { instructor: { actor: '$instructor', at: [3, 12], face: Math.PI }, followers: [[-1, 10.5], [-1, 12], [-1, 13.5]].map(([x, z], i) => ({ actor: `$f${i + 1}`, at: [x, z], face: round(heading(sub2([3, 12], [x, z]))), joinAfter: i * 1.2, lag: 0.2 + i * 0.2 })), phaseDuration: 2, cycles: 3 }, needs: { energy: 1, company: 1 }, tags: ['exercise', 'outdoors', 'group', 'morning'] },
    // Fire circle.
    { id: 'fire.circle', label: 'Gather around the fire', verb: 'campfire_circle', region: 'fire-circle', roles: ['actor', 'partner'], params: { actors: ['$actor', '$partner'], fire: 'campfire' }, needs: { company: 1 }, tags: ['fire', 'outdoors', 'group', 'evening'] },
    { id: 'fire.sit-bench', label: 'Sit on a fire bench', verb: 'sit', region: 'fire-circle', roles: ['actor'], params: { actor: '$actor', fixture: 'fire-bench-south' }, needs: { energy: 1 }, tags: ['rest', 'fire', 'outdoors'] },
    // Kitchen.
    { id: 'kitchen.prepare-supper', label: 'Prepare the supper pot from beans and greens', verb: 'prepare_food', region: 'kitchen', roles: ['actor'], params: { actor: '$actor', spoon: 'prep-spoon', pot: 'supper-pot', ingredients: ['beans-bowl', 'greens-bowl'] }, needs: { restlessness: 1 }, tags: ['cook', 'indoors', 'evening'], effect: 'beans-bowl and greens-bowl emptied into supper-pot (finite, once)' },
    { id: 'kitchen.return-prep-spoon', label: 'Put the cooking spoon back on the counter', verb: 'put_item', region: 'kitchen', roles: ['actor'], params: { actor: '$actor', item: 'prep-spoon', surfaceSlot: 'prep-table#r1c0' }, needs: {}, tags: ['tidy', 'cook', 'indoors'], requires: 'actor holds prep-spoon (prepare_food keeps it in hand)', after: ['kitchen.prepare-supper'] },
    // The first server takes the east place so the second, arriving from the west door, never passes them;
    // both then step north to eat, away from the door and without crossing each other's service place.
    { id: 'kitchen.shared-meal', label: 'Share a meal of stew at the dining table', verb: 'shared_food_break', region: 'kitchen', roles: ['actor', 'partner'], params: { pot: 'stew-pot', participants: [
      { actor: '$actor', bowl: 'bowl-2', spoon: 'spoon-2', service: [-12.05, -13.35], returns: [{ item: 'bowl-2', surfaceSlot: 'dining-table#r0c4' }, { item: 'spoon-2', surfaceSlot: 'dining-table#r0c5' }] },
      { actor: '$partner', bowl: 'bowl-1', spoon: 'spoon-1', service: [-12.95, -13.35], returns: [{ item: 'bowl-1', surfaceSlot: 'dining-table#r0c0' }, { item: 'spoon-1', surfaceSlot: 'dining-table#r0c1' }] },
    ], at: [-12.5, -15.2] }, needs: { hunger: 1, company: 1 }, tags: ['eat', 'indoors', 'group', 'evening'], effect: 'stew-pot drawn down by two servings of 0.25 (finite); utensils back in their own places' },
    { id: 'kitchen.take-bowl', label: 'Pick up a bowl', verb: 'take_item', region: 'kitchen', roles: ['actor'], params: { actor: '$actor', item: 'bowl-3', hand: 'left' }, needs: {}, tags: ['eat', 'indoors'] },
    { id: 'kitchen.stand-at-pot', label: 'Step up to the stew pot', verb: 'walk_to', region: 'kitchen', roles: ['actor'], params: { actor: '$actor', x: -12.5, z: -13.4, face: Math.PI / 2 }, needs: {}, tags: ['eat', 'indoors', 'move'] },
    { id: 'kitchen.serve', label: 'Serve stew into the held bowl', verb: 'serve', region: 'kitchen', roles: ['actor'], params: { actor: '$actor', pot: 'stew-pot', bowl: 'bowl-3' }, needs: {}, tags: ['eat', 'indoors'], requires: 'actor holds an empty bowl-3 and stands within 1.1 m of stew-pot', after: ['kitchen.take-bowl', 'kitchen.stand-at-pot'] },
    { id: 'kitchen.take-spoon', label: 'Pick up a spoon', verb: 'take_item', region: 'kitchen', roles: ['actor'], params: { actor: '$actor', item: 'spoon-3', hand: 'right' }, needs: {}, tags: ['eat', 'indoors'], requires: 'right hand free', after: ['kitchen.serve'] },
    { id: 'kitchen.sit-bench', label: 'Sit at the dining bench', verb: 'sit', region: 'kitchen', roles: ['actor'], params: { actor: '$actor', fixture: 'dining-bench' }, needs: { energy: 1 }, tags: ['rest', 'indoors'] },
    { id: 'kitchen.eat', label: 'Eat the served stew', verb: 'eat', region: 'kitchen', roles: ['actor'], params: { actor: '$actor', bowl: 'bowl-3', spoon: 'spoon-3', cycles: 6 }, needs: { hunger: 1 }, tags: ['eat', 'indoors'], requires: 'actor holds a served bowl-3 and spoon-3', after: ['kitchen.take-spoon'] },
    { id: 'kitchen.return-bowl', label: 'Put the bowl back on the table', verb: 'put_item', region: 'kitchen', roles: ['actor'], params: { actor: '$actor', item: 'bowl-3', surfaceSlot: 'dining-table#r2c0' }, needs: {}, tags: ['tidy', 'indoors'], requires: 'actor holds bowl-3', after: ['kitchen.eat'] },
    { id: 'kitchen.return-spoon', label: 'Put the spoon back on the table', verb: 'put_item', region: 'kitchen', roles: ['actor'], params: { actor: '$actor', item: 'spoon-3', surfaceSlot: 'dining-table#r2c1' }, needs: {}, tags: ['tidy', 'indoors'], requires: 'actor holds spoon-3', after: ['kitchen.eat'] },
    // Living room.
    { id: 'living.computer-work', label: 'Work at computer 1', verb: 'work_at', region: 'living-room', roles: ['actor'], params: { actor: '$actor', station: 'computer-1', seat: wsSeat(1), task: 'Project notes', duration: 240 }, needs: { restlessness: -1 }, tags: ['work', 'computer', 'indoors', 'alone'], effect: 'task progress on computer-1 retained for the same person and task' },
    { id: 'living.computer-music', label: 'Make music at computer 2', verb: 'computer_music', region: 'living-room', roles: ['actor', 'listener'], params: { performer: '$actor', station: 'computer-2', seat: wsSeat(2), listeners: [{ actor: '$listener', seat: 'listening-chair#seat' }], score: 'gentle', period: 0.5, duration: 120 }, needs: { company: 1, restlessness: 1 }, tags: ['music', 'computer', 'indoors'] },
    { id: 'living.read', label: 'Read the camp book', verb: 'read_book', region: 'living-room', roles: ['actor'], params: { actor: '$actor', book: 'camp-book', seat: 'reading-chair#seat', task: 'Quiet reading', duration: 240 }, needs: { energy: 1, restlessness: -1 }, tags: ['read', 'indoors', 'alone', 'quiet'], effect: 'bookmark retained for the same reader and task' },
    { id: 'living.chess-opening', label: 'Play the opening move at the chess table', verb: 'chess_move', region: 'living-room', roles: ['white'], params: { actor: '$white', board: 'chess-board', from: 'e2', to: 'e4', tray: 'chess-tray' }, needs: { company: 1 }, tags: ['game', 'chess', 'indoors'], requires: 'players bound with bindCampChess(world, white, black); it is white\'s turn', effect: 'board position advances one ply' },
    { id: 'living.draw', label: 'Draw a shelter study', verb: 'drawing_work', region: 'living-room', roles: ['actor'], params: { actor: '$actor', pad: 'sketch-pad', pencil: 'sketch-pencil', returnSlot: 'drawing-table#r0c3', task: 'Shelter study' }, needs: { restlessness: 1 }, tags: ['draw', 'art', 'indoors', 'alone'], effect: 'marks committed to sketch-pad' },
    { id: 'living.sit-sofa', label: 'Sit on the living-room bench', verb: 'sit', region: 'living-room', roles: ['actor'], params: { actor: '$actor', fixture: 'living-bench' }, needs: { energy: 1 }, tags: ['rest', 'indoors'] },
    { id: 'living.talk', label: 'Talk in the living room', verb: 'converse', region: 'living-room', roles: ['actor', 'partner'], params: { actors: ['$actor', '$partner'], at: [ld.inside[0], ld.inside[1] - 2.2], duration: 90 }, needs: { company: 1 }, tags: ['talk', 'indoors'] },
    // Classroom corner.
    { id: 'class.session', label: 'Give a class in the classroom corner', verb: 'classroom_session', region: 'classroom-corner', roles: ['host', 'presenter', 'a1', 'a2'], params: {
      host: '$host', presenters: ['$presenter'], audience: ['$a1', '$a2'],
      seats: Array.from({ length: 6 }, (_, i) => `class-seat-${i + 1}#seat`), presenterStation: 'class-lectern#presenter', displayId: 'class-display', requireDisplay: true,
      departure: { $host: [-4.5, -9.4], $presenter: [-3, -9.4], $a1: [-1.5, -9.4], $a2: [0, -9.4] },
      conversationPoints: [[-3, -9.6]], arrivalStaggerSeconds: 0.45, talkSeconds: 60, questionSeconds: 15, conversationSeconds: 30, maxPhaseSeconds: 180,
    }, needs: { company: 1, restlessness: -1 }, tags: ['teach', 'learn', 'indoors', 'group'] },
    { id: 'class.display', label: 'Put a title on the classroom display', verb: 'display_control', region: 'classroom-corner', roles: [], params: { display: 'class-display', mode: 'on', content: 'Tonight: how the lookout bay stands up' }, needs: {}, tags: ['teach', 'indoors'], effect: 'display text and mode' },
    // Bunk house.
    ...CAMP_MATS.map((m, i): CampActivity => ({ id: `bunk.sleep-${m.id}`, label: `Sleep on ${m.id}`, verb: 'sleep', region: 'bunkhouse', roles: ['actor'], params: { actor: '$actor', mat: m.id, duration: 600, returnTo: [i % 2 ? 17.1 : 15.9, -10] }, needs: { energy: 1 }, tags: ['sleep', 'indoors', 'night'] })),
    // Garden.
    { id: 'garden.water-1', label: 'Water planter 1', verb: 'garden_care', region: 'garden', roles: ['actor'], params: { actor: '$actor', plant: 'planter-1', water: 'water-bowl', returnSlot: 'garden-table#r0c1' }, needs: { restlessness: 1 }, tags: ['garden', 'outdoors', 'alone', 'morning'], effect: 'planter-1 care cycle; water-bowl drawn down 0.25 (finite)' },
    { id: 'garden.water-2', label: 'Water planter 2', verb: 'garden_care', region: 'garden', roles: ['actor'], params: { actor: '$actor', plant: 'planter-2', water: 'water-bowl', returnSlot: 'garden-table#r0c1' }, needs: { restlessness: 1 }, tags: ['garden', 'outdoors', 'alone'], effect: 'planter-2 care cycle; water-bowl drawn down 0.25 (finite)' },
    { id: 'garden.plant-3', label: 'Sow seeds in planter 3', verb: 'seed_planting', region: 'garden', roles: ['actor'], params: { actor: '$actor', plant: 'planter-3', seeds: 'seed-bowl', returnSlot: 'garden-table#r0c4' }, needs: { restlessness: 1 }, tags: ['garden', 'outdoors', 'alone'], effect: 'planter-3 sown; seed-bowl drawn down (finite)' },
    { id: 'garden.plant-4', label: 'Sow seeds in planter 4', verb: 'seed_planting', region: 'garden', roles: ['actor'], params: { actor: '$actor', plant: 'planter-4', seeds: 'seed-bowl', returnSlot: 'garden-table#r0c4' }, needs: { restlessness: 1 }, tags: ['garden', 'outdoors', 'alone'], effect: 'planter-4 sown; seed-bowl drawn down (finite)' },
    ...constructionActivities(),
  ];
}

export type CampManifest = {
  schema: typeof EDEN_CAMP_SCHEMA;
  campus: string;
  bounds: SpatialScene['bounds'];
  needs: CampNeed[];
  arrivals: typeof CAMP_ARRIVALS;
  buildings: (CampBuilding & { doors: (CampDoor & { inside: Vec2; outside: Vec2 })[] })[];
  regions: { id: string; label: string; kind: Region['kind'] }[];
  spots: CampSpot[];
  fixtures: { id: string; def: string; label?: string; region?: string; on?: string }[];
  items: { id: string; def: string; on: string; contents?: { food: string; fraction: number } }[];
  construction: {
    site: Site;
    blueprint: string;
    components: { id: string; def: string; phase?: string; region?: string }[];
    targets: Record<string, string>;
  };
  activities: CampActivity[];
};

function regionOf(w: WorldState, p: Vec2): string | undefined {
  const inside = (poly: Vec2[]) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  // Most specific first: mats and piles sit inside rooms / the yard.
  const order = ['material-pile', 'work-area', 'place', 'staging', 'walkable'];
  return Object.values(w.regions).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind)).find((r) => inside(r.polygon as Vec2[]))?.id;
}

/** The machine-readable affordance manifest (also written to worlds/mars/camp/manifest.json). */
export function edenCampManifest(): CampManifest {
  const w = edenCampWorld();
  const es = Object.values(w.entities);
  return {
    schema: EDEN_CAMP_SCHEMA,
    campus: EDEN_CAMP_CAMPUS,
    bounds: EDEN_CAMP_SCENE.bounds,
    needs: ['energy', 'hunger', 'company', 'restlessness'],
    arrivals: CAMP_ARRIVALS,
    buildings: CAMP_BUILDINGS.map((b) => ({ ...b, doors: CAMP_DOORS.filter((d) => d.building === b.id).map((d) => ({ ...d, inside: doorPoints(d).inside, outside: doorPoints(d).outside })) })),
    regions: Object.values(w.regions).map((r) => ({ id: r.id, label: r.label, kind: r.kind })),
    spots: CAMP_SPOTS,
    fixtures: es.filter((e) => e.kind === 'fixture').map((e) => ({ id: e.id, def: e.def, label: e.label, region: regionOf(w, [e.pose.p[0], e.pose.p[2]]), ...(e.support?.kind === 'resting-on' ? { on: `${e.support.on}#${e.support.slot}` } : {}) })),
    items: es.filter((e) => e.support?.kind === 'resting-on' && !e.def.startsWith('chess-')).map((e) => {
      const s = e.support as { on: string; slot?: string };
      return { id: e.id, def: e.def, on: `${s.on}#${s.slot}`, ...(e.contents ? { contents: { ...e.contents } } : {}) };
    }),
    construction: {
      site: CAMP_BUILD_SITE,
      blueprint: 'lookout-bay: two 8 ft uprights 9 ft apart, beams at 0.5 m and 1.8 m on both columns, five 6 ft joists and two 4x6 sheets as a deck at ~2 m, a 10-tread stair on the east side',
      components: es.filter((e) => e.kind === 'component' && def(e.def).category !== 'item').map((e) => ({ id: e.id, def: e.def, phase: e.phase, region: regionOf(w, [e.pose.p[0], e.pose.p[2]]) })),
      targets: {
        'upright-a': 'standing at the site origin, installed', 'upright-b': `standing ${L9.toFixed(3)} m along +z, installed`,
        ...Object.fromEntries(LOOKOUT_BEAMS.map((b) => [b.id, `installed, column ${b.column}, seat ${b.height} m`])),
        ...Object.fromEntries(LOOKOUT_JOISTS.map((j) => [j.id, `installed on the 1.8 m beams, ${j.at} m along the bay`])),
        ...Object.fromEntries(LOOKOUT_SHEETS.map((s) => [s.id, `installed deck sheet centred ${s.z.toFixed(3)} m along the bay`])),
        'lookout-stair': 'installed, foot east of the bay, ascending west', ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`tread-${i + 1}`, `installed as tread ${i + 1}`])),
      },
    },
    activities: edenCampActivities(),
  };
}

/** Top-down plan of the genesis camp (worlds/mars/camp/plan.svg): walls, fixtures, stock, regions, arrivals. */
export function edenCampPlanSvg(): string {
  const w = edenCampWorld(), [x0, z0, x1, z1] = EDEN_CAMP_SCENE.bounds, k = 20;
  const X = (x: number) => ((x - x0) * k).toFixed(1), Z = (z: number) => ((z - z0) * k).toFixed(1);
  const poly = (pts: Vec2[], style: string) => `<polygon points="${pts.map(([x, z]) => `${X(x)},${Z(z)}`).join(' ')}" ${style}/>`;
  const box = (o: OBB2) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => { const r = rot2([a * o.half[0], b * o.half[1]], o.yaw); return [o.c[0] + r[0], o.c[1] + r[1]] as Vec2; });
  const fill: Record<string, string> = { 'material-pile': '#efe2c8', 'work-area': '#f5efe0', place: '#f4f6f2', staging: '#e6eef6', walkable: '#fafaf7' };
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${(x1 - x0) * k} ${(z1 - z0) * k}" font-family="sans-serif" font-size="11">`, `<rect width="100%" height="100%" fill="#e9e4d8"/>`];
  const order = ['walkable', 'place', 'staging', 'material-pile', 'work-area'];
  for (const r of Object.values(w.regions).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))) out.push(poly(r.polygon as Vec2[], `fill="${fill[r.kind]}" stroke="#b9b2a2" stroke-dasharray="4 3"`));
  for (const e of Object.values(w.entities)) {
    if (e.support?.kind === 'resting-on' && e.def.startsWith('chess-') && e.kind !== 'fixture') continue;
    const colour = e.kind === 'component' && def(e.def).category !== 'item' ? '#c98a3a' : def(e.def).category === 'item' ? '#4f6d8f' : '#7d7466';
    out.push(poly(box(entityFootprint(e).obb), `fill="${colour}" fill-opacity="0.85" stroke="#3b362d" stroke-width="0.5"`));
  }
  for (const o of EDEN_CAMP_SCENE.obstacles) out.push(poly(box(o.obb), 'fill="#2f2b26"'));
  for (const a of CAMP_ARRIVALS) out.push(`<circle cx="${X(a.p[0])}" cy="${Z(a.p[1])}" r="5" fill="#c0392b"/>`);
  for (const r of Object.values(w.regions)) {
    if (r.id.startsWith('mat-')) continue;
    const c = r.polygon.reduce<Vec2>((s, p) => [s[0] + p[0] / r.polygon.length, s[1] + p[1] / r.polygon.length], [0, 0]);
    out.push(`<text x="${X(c[0])}" y="${Z(r.kind === 'place' && r.id !== 'fire-circle' && r.id !== 'garden' ? r.polygon[0][1] + 0.9 : c[1])}" text-anchor="middle" fill="#3b362d">${r.label}</text>`);
  }
  out.push('</svg>');
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------------------------------------
// Binding and playability

/** Replace `$role` strings and object keys with actor ids. Throws on a missing role. */
export function bindCampActivity(a: CampActivity, actors: Record<string, string>): unknown {
  const sub = (s: string) => {
    if (!s.startsWith('$')) return s;
    const v = actors[s.slice(1)];
    if (v === undefined) throw new Error(`eden-camp: ${a.id} needs role ${s.slice(1)}`);
    return v;
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return sub(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [sub(k), walk(x)]));
    return v;
  };
  return walk(structuredClone(a.params));
}

/**
 * Whether an activity could start now for these actors, without submitting it: schema, the verb's
 * own plan (all physical preconditions) and current reservation holders. Read-only.
 */
export function campActivityPlayable(rt: Runtime, a: CampActivity, actors: Record<string, string>): { ok: true } | { ok: false; diagnostic: Diagnostic } {
  const d = rt.registry.get(a.verb);
  if (!d) return { ok: false, diagnostic: { code: 'action.unknown-verb', message: `no action verb "${a.verb}"`, subjects: [] } };
  const parsed = d.schema.safeParse(bindCampActivity(a, actors));
  if (!parsed.success) return { ok: false, diagnostic: { code: 'action.invalid-params', message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), subjects: [] } };
  const before = hashOf(rt.world);
  const plan = d.plan(rt, parsed.data);
  if (hashOf(rt.world) !== before) throw new Error(`eden-camp: ${a.verb} plan mutated the world`);
  if (!plan.ok) return plan;
  for (const r of d.reservations(rt.world, parsed.data))
    if (rt.holder(r.resource).length) return { ok: false, diagnostic: { code: 'reservation.conflict', message: `${r.resource} is held by ${rt.holder(r.resource).join(', ')}`, subjects: [r.resource] } };
  return { ok: true };
}

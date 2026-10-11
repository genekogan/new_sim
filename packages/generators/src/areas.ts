// Area-form generators: plaza, lawn, pitch, parking, garden-bed, orchard (+ deck in bridge.ts,
// scatter/2 in scatter2.ts, shore/1 in river.ts, terrace/1 in landforms.ts). Owner: L3.
// Spec <eden4>/29 WP3, 33 §2 rows 5, 7. Surfaces drape on the ground (y above the terrain);
// surface priority for the viewer: road > plaza > pitch > lawn > ground.
import { bounds2, boxOfBounds, n, pointInPoly, rng } from './geom.ts';
import { scatter2Gen } from './scatter2.ts';
import { hyp } from './terrain-query.ts';
import type { Baked, Generator, LocalOBB, Shape, Vec2 } from './types.ts';

const areaOf = (shape: Shape | undefined): Vec2[] => shape?.area ?? [[-5, -5], [5, -5], [5, 5], [-5, 5]];
function surfaceArea(shape: Shape | undefined, y: number, material: string, tag: string, h = 0.1): Baked {
  const area = areaOf(shape);
  return { box: boxOfBounds(bounds2(area), h), colliders: [], surfaces: [{ level: 0, y, polygon: area, material, tag }], slots: [], tris: area.length * 2 };
}

/** An oriented frame for a roughly rectangular area: centre, unit axes (u along the longest side), half length and half width. */
export function areaFrame(area: Vec2[]): { c: Vec2; u: Vec2; v: Vec2; hl: number; hw: number } {
  let best = -1, u: Vec2 = [1, 0];
  for (let i = 0, j = area.length - 1; i < area.length; j = i++) { const dx = area[i][0] - area[j][0], dz = area[i][1] - area[j][1], l = hyp(dx, dz); if (l > best) { best = l; u = [dx / l, dz / l]; } }
  const v: Vec2 = [-u[1], u[0]];
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const [x, z] of area) { const a = x * u[0] + z * u[1], b = x * v[0] + z * v[1]; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
  const am = (a0 + a1) / 2, bm = (b0 + b1) / 2;
  return { c: [u[0] * am + v[0] * bm, u[1] * am + v[1] * bm], u, v, hl: (a1 - a0) / 2, hw: (b1 - b0) / 2 };
}

export const plazaGen: Generator = {
  id: 'plaza/1', form: 'area', owner: 'L3', doc: 'A paved square: material, pattern (grid, herringbone, radial, plain), base colour, a low kerb around it.',
  params: { material: { type: 'enum', values: ['cobble', 'stone', 'tile', 'brick', 'gravel', 'asphalt'], default: 'cobble' }, pattern: { type: 'enum', values: ['grid', 'herringbone', 'radial', 'plain'], default: 'grid' }, color: { type: 'color', default: '#b9b2a4' }, kerb: { type: 'bool', default: true }, size: { type: 'number', min: 0.2, max: 3, default: 0.8, doc: 'paving unit (m)' } },
  physics({ params, shape }) { const b = surfaceArea(shape, 0.05, String(params.material ?? 'cobble'), 'plaza'); return { ...b, tris: Math.min(12000, Math.round((b.box[0] * b.box[2]) / Math.max(0.04, n(params.size, 0.8) ** 2) * 2)) }; },
};
export const lawnGen: Generator = {
  id: 'lawn/1', form: 'area', owner: 'L3', doc: 'Paint the ground: a mown lawn or a ground material (grass, sand, gravel, moss, mud, rock, snow, dirt) draped over the terrain.',
  params: { material: { type: 'enum', values: ['grass', 'sand', 'gravel', 'moss', 'mud', 'rock', 'snow', 'dirt'], default: 'grass' }, color: { type: 'color', doc: 'override the material colour' }, edge: { type: 'number', min: 0, max: 10, default: 1, doc: 'ragged, softened border (m)' }, stripes: { type: 'bool', default: false, doc: 'mowing stripes (grass)' } },
  physics({ params, shape }) { return surfaceArea(shape, 0.015, String(params.material ?? 'grass'), 'lawn'); },
};

/** Pitch sizes (length × width, m) for line layouts scaled to the area. */
export const SPORTS: Record<string, { L: number; W: number; surface: string }> = {
  football: { L: 100, W: 64, surface: 'grass' }, tennis: { L: 23.77, W: 10.97, surface: 'court' }, basketball: { L: 28, W: 15, surface: 'court' },
  petanque: { L: 15, W: 4, surface: 'gravel' }, volleyball: { L: 16, W: 8, surface: 'sand' },
};
export const pitchGen: Generator = {
  id: 'pitch/1', form: 'area', owner: 'L3', doc: 'A sports pitch laid out in the area (longest side = length): line markings, goals/nets/hoops/borders as parts. football, tennis, basketball, petanque, volleyball.',
  params: { sport: { type: 'enum', values: ['football', 'tennis', 'basketball', 'petanque', 'volleyball'], default: 'football' }, color: { type: 'color', doc: 'surface colour override' }, fence: { type: 'bool', default: false } },
  physics({ params, shape }) {
    const area = areaOf(shape), sport = String(params.sport ?? 'football'), f = areaFrame(area), sp = SPORTS[sport] ?? SPORTS.football;
    const colliders: LocalOBB[] = [];
    const at = (a: number, b: number): Vec2 => [f.c[0] + f.u[0] * a + f.v[0] * b, f.c[1] + f.u[1] * a + f.v[1] * b];
    const yaw = Math.atan2(-f.u[1], f.u[0]);
    if (sport === 'football') { const gw = Math.min(7.32, f.hw * 0.4); for (const e of [-1, 1]) for (const side of [-1, 1]) colliders.push({ c: at(e * (f.hl - 0.3), side * gw / 2), half: [0.06, 0.06], yaw, y0: 0, y1: 2.44, tag: 'goal-post' }); }
    if (sport === 'tennis' || sport === 'volleyball') for (const side of [-1, 1]) colliders.push({ c: at(0, side * (f.hw + 0.3)), half: [0.06, 0.06], yaw, y0: 0, y1: sport === 'tennis' ? 1.07 : 2.43, tag: 'net-post' });
    if (sport === 'basketball') for (const e of [-1, 1]) colliders.push({ c: at(e * (f.hl - 0.4), 0), half: [0.12, 0.12], yaw, y0: 0, y1: 3.4, tag: 'hoop-post' });
    const fenceH = params.fence === true ? (sport === 'tennis' ? 3 : 1.2) : 0;
    if (fenceH) for (let i = 0, j = area.length - 1; i < area.length; j = i++) { const a = area[j], b = area[i], l = hyp(b[0] - a[0], b[1] - a[1]); colliders.push({ c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], half: [l / 2, 0.04], yaw: Math.atan2(-(b[1] - a[1]) / l, (b[0] - a[0]) / l), y0: 0, y1: fenceH, tag: 'fence' }); }
    return { box: boxOfBounds(bounds2(area), 3), colliders, surfaces: [{ level: 0, y: 0.03, polygon: area, material: sp.surface === 'court' ? 'asphalt' : sp.surface, tag: `pitch:${sport}` }], slots: [], tris: 1200, notes: [`${sport} pitch ${(2 * f.hl).toFixed(1)} × ${(2 * f.hw).toFixed(1)} m (regulation ${sp.L} × ${sp.W})`] };
  },
};
export const parkingGen: Generator = {
  id: 'parking/1', form: 'area', owner: 'L3', doc: 'A parking area with marked bays along its long sides.',
  params: { bay: { type: 'number', min: 2, max: 4, default: 2.5 } },
  physics({ shape }) { return surfaceArea(shape, 0.04, 'asphalt', 'parking'); },
};
export const gardenBedGen: Generator = {
  id: 'garden-bed/1', form: 'area', owner: 'L3', doc: 'A planted bed: rows of vegetables or flowers in soil, optional low border.',
  params: { crop: { type: 'enum', values: ['flowers', 'vegetables', 'herbs', 'wheat', 'pumpkins', 'mixed'], default: 'mixed' }, rows: { type: 'number', min: 0.3, max: 3, default: 0.7, doc: 'row spacing (m)' }, border: { type: 'bool', default: true } },
  physics({ shape }) { return surfaceArea(shape, 0.05, 'dirt', 'garden-bed', 0.6); },
};

/** Orchard trees on a grid aligned to the area's frame, with seeded jitter and age. */
export function orchardPoints(area: Vec2[], spacing: number, seed: number): { x: number; z: number; s: number }[] {
  const f = areaFrame(area), r = rng((seed | 0) ^ 0x0c4a), out: { x: number; z: number; s: number }[] = [];
  for (let a = -f.hl + spacing / 2; a <= f.hl; a += spacing) for (let b = -f.hw + spacing / 2; b <= f.hw; b += spacing) {
    const x = f.c[0] + f.u[0] * a + f.v[0] * b, z = f.c[1] + f.u[1] * a + f.v[1] * b, j1 = r(), j2 = r(), age = r();
    if (!pointInPoly(x, z, area)) continue;
    out.push({ x: x + (j1 - 0.5) * spacing * 0.12, z: z + (j2 - 0.5) * spacing * 0.12, s: 0.75 + age * 0.45 });
    if (out.length >= 2000) return out;
  }
  return out;
}
export const orchardGen: Generator = {
  id: 'orchard/1', form: 'area', owner: 'L3', doc: 'Trees in a grid (orchard, avenue block): species, spacing, height; age varies per tree.',
  params: { species: { type: 'enum', values: ['apple', 'pear', 'cherry', 'olive', 'lemon', 'oak', 'birch', 'pine', 'palm'], default: 'apple' }, spacing: { type: 'number', min: 2, max: 20, default: 5 }, height: { type: 'number', min: 2, max: 20, default: 4.5 } },
  physics({ params, shape, seed }) {
    const area = areaOf(shape), pts = orchardPoints(area, n(params.spacing, 5), seed);
    const h = n(params.height, 4.5);
    return { box: boxOfBounds(bounds2(area), h), colliders: pts.slice(0, 800).map((p) => ({ c: [p.x, p.z] as Vec2, half: [0.15 * p.s, 0.15 * p.s] as Vec2, yaw: 0, y0: 0, y1: h * 0.4 * p.s, tag: 'trunk' })), slots: [], tris: pts.length * 120, notes: [`${pts.length} ${params.species ?? 'apple'} trees`] };
  },
};

export const AREA_GENERATORS = [plazaGen, lawnGen, pitchGen, parkingGen, gardenBedGen, orchardGen, scatter2Gen];

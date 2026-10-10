// Area-form generators: plaza, lawn, pitch, deck, parking, garden-bed, orchard, scatter/2. Owner: L3.
// Spec <eden4>/29 WP3, 33 §2 rows 5, 7.
// CONTRACT STUB (L1): params are final; physics is a working placeholder (a surface over the
// area; a deck on posts; an orchard grid of trunk colliders). L3 adds paving patterns, line
// markings, kerbs, palettes, clustering, exclusions, slope/water rules.
import { bounds2, boxOfBounds, n } from './geom.ts';
import type { Baked, Generator, Shape, Vec2 } from './types.ts';

const areaOf = (shape: Shape | undefined): Vec2[] => shape?.area ?? [[-5, -5], [5, -5], [5, 5], [-5, 5]];
function surfaceArea(shape: Shape | undefined, y: number, material: string, tag: string, h = 0.1): Baked {
  const area = areaOf(shape);
  return { box: boxOfBounds(bounds2(area), h), colliders: [], surfaces: [{ level: 0, y, polygon: area, material, tag }], slots: [], tris: area.length * 2 };
}

export const plazaGen: Generator = {
  id: 'plaza/1', form: 'area', owner: 'L3', doc: 'A paved square with a pattern and an optional kerb.',
  params: { material: { type: 'enum', values: ['cobble', 'stone', 'tile', 'brick', 'gravel', 'asphalt'], default: 'cobble' }, pattern: { type: 'enum', values: ['grid', 'herringbone', 'radial', 'plain'], default: 'grid' }, color: { type: 'color', default: '#b9b2a4' }, kerb: { type: 'bool', default: true } },
  physics({ params, shape }) { return surfaceArea(shape, 0.03, String(params.material ?? 'cobble'), 'plaza'); },
};
export const lawnGen: Generator = {
  id: 'lawn/1', form: 'area', owner: 'L3', doc: 'A mown lawn or painted ground material (grass, sand, gravel, moss, mud, rock, snow).',
  params: { material: { type: 'enum', values: ['grass', 'sand', 'gravel', 'moss', 'mud', 'rock', 'snow', 'dirt'], default: 'grass' }, color: { type: 'color', default: '#6aa84f' }, edge: { type: 'number', min: 0, max: 10, default: 1, doc: 'soft blend into the ground (m)' } },
  physics({ params, shape }) { return surfaceArea(shape, 0.01, String(params.material ?? 'grass'), 'lawn'); },
};
export const pitchGen: Generator = {
  id: 'pitch/1', form: 'area', owner: 'L3', doc: 'A sports pitch with line markings and goals/nets: football, tennis, basketball, petanque, volleyball.',
  params: { sport: { type: 'enum', values: ['football', 'tennis', 'basketball', 'petanque', 'volleyball'], default: 'football' }, color: { type: 'color', default: '#4f8f3a' }, fence: { type: 'bool', default: false } },
  physics({ params, shape }) { return surfaceArea(shape, 0.02, 'grass', `pitch:${params.sport ?? 'football'}`); },
};
export const deckGen: Generator = {
  id: 'deck/1', form: 'area', owner: 'L3', doc: 'A raised platform on posts (deck, terrace, pier when narrow) over ground or water; walkable surface with rails.',
  params: { height: { type: 'number', min: 0, max: 12, default: 0.6 }, material: { type: 'enum', values: ['wood', 'stone', 'metal'], default: 'wood' }, rails: { type: 'bool', default: true }, color: { type: 'color', default: '#a07a4f' } },
  physics({ params, shape }) { const area = areaOf(shape), h = n(params.height, 0.6); return { box: boxOfBounds(bounds2(area), h + 1), colliders: [], surfaces: [{ level: 0, y: h, polygon: area, material: 'wood', tag: 'deck' }], slots: [], tris: area.length * 40 }; },
};
export const parkingGen: Generator = {
  id: 'parking/1', form: 'area', owner: 'L3', doc: 'A parking area with marked bays.',
  params: { bay: { type: 'number', min: 2, max: 4, default: 2.5 } },
  physics({ shape }) { return surfaceArea(shape, 0.02, 'asphalt', 'parking'); },
};
export const gardenBedGen: Generator = {
  id: 'garden-bed/1', form: 'area', owner: 'L3', doc: 'A planted bed: rows of vegetables or flowers in soil, optional low border.',
  params: { crop: { type: 'enum', values: ['flowers', 'vegetables', 'herbs', 'wheat', 'pumpkins', 'mixed'], default: 'mixed' }, rows: { type: 'number', min: 0.3, max: 3, default: 0.7, doc: 'row spacing (m)' }, border: { type: 'bool', default: true } },
  physics({ shape }) { return surfaceArea(shape, 0.05, 'dirt', 'garden-bed', 0.6); },
};
export const orchardGen: Generator = {
  id: 'orchard/1', form: 'area', owner: 'L3', doc: 'Trees in a grid (orchard, avenue block): species, spacing, age variation.',
  params: { species: { type: 'enum', values: ['apple', 'pear', 'cherry', 'olive', 'lemon', 'oak', 'birch', 'pine', 'palm'], default: 'apple' }, spacing: { type: 'number', min: 2, max: 20, default: 5 }, height: { type: 'number', min: 2, max: 20, default: 4.5 } },
  physics({ params, shape }) { const area = areaOf(shape); return { box: boxOfBounds(bounds2(area), n(params.height, 4.5)), colliders: [], slots: [], tris: 0 }; },
};
export const scatter2Gen: Generator = {
  id: 'scatter/2', form: 'area', owner: 'L3', doc: 'Ecological scatter: a species palette with weights, clustering, auto-exclusion of solids/roads/water, slope and water-distance rules, age/size variation from the seed.',
  params: {
    palette: { type: 'json', doc: '[{def, weight, nearWater?: m, minSlope?, maxSlope?, scale?: [min,max]}]' },
    density: { type: 'number', min: 0.0005, max: 8, default: 0.03 },
    cluster: { type: 'number', min: 0, max: 1, default: 0.4, doc: '0 uniform … 1 tight clumps' },
    minSpacing: { type: 'number', min: 0.2, max: 30, default: 2 },
    avoid: { type: 'json', doc: 'tags or layers to avoid (default: solid, road, water)' },
  },
  physics({ shape }) { const area = areaOf(shape); return { box: boxOfBounds(bounds2(area), 10), colliders: [], slots: [], tris: 0 }; },
};

export const AREA_GENERATORS = [plazaGen, lawnGen, pitchGen, deckGen, parkingGen, gardenBedGen, orchardGen, scatter2Gen];

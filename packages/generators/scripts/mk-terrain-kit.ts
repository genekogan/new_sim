import { writeFileSync } from 'node:fs';
// Regenerate packages/world-compiler/src/core-kit/terrain.json from the generator params (L3):
//   node packages/generators/scripts/mk-terrain-kit.ts packages/world-compiler/src/core-kit/terrain.json
import { GENERATORS } from '../src/index.ts';
type D = Record<string, unknown>;
const P = (gen: string, over: Record<string, unknown> = {}, drop: string[] = []) => {
  const base = structuredClone(GENERATORS[gen].params) as Record<string, Record<string, unknown>>;
  for (const k of drop) delete base[k];
  for (const [k, v] of Object.entries(over)) base[k] = { ...(base[k] ?? {}), ...(v as object) };
  return base;
};
const def = (name: string, gen: string, form: string, layer: string, tags: string[], description: string, box: number[], extra: D = {}): D => ({ schema: 'def/1', name: `core-${name}`, version: 1, description, tags, form, layer, make: { kind: 'gen', gen }, size: { box }, ...extra });
const defs: D[] = [
  // --- roads and paths
  def('road', 'road/1', 'path', 'surface', ['road', 'path-network', 'terrain'], 'A road along a path: cobble/asphalt/gravel/dirt, kerbs, verges; graded to ≤ maxGrade on hills (prepareRoad) and bridged over water automatically. T and X junctions merge.', [10, 0.2, 10], { params: P('road/1') }),
  def('street', 'road/1', 'path', 'surface', ['road', 'path-network', 'terrain'], 'An asphalt street with a dashed centre line and kerbs.', [10, 0.2, 10], { params: P('road/1', { material: { default: 'asphalt' }, lines: { default: true }, width: { default: 7 } }) }),
  def('track', 'road/1', 'path', 'surface', ['road', 'path-network', 'terrain'], 'A dirt or gravel track: no kerbs, follows the ground closely.', [10, 0.2, 10], { params: P('road/1', { material: { default: 'dirt' }, kerb: { default: false }, width: { default: 3.5 }, shoulder: { default: 0.3 }, maxGrade: { default: 0.14 } }) }),
  def('footpath', 'path/1', 'path', 'surface', ['path', 'path-network', 'terrain'], 'A footpath: gravel, dirt, cobble, stone flags or boardwalk; follows the ground; bridges water.', [4, 0.1, 4], { params: P('path/1') }),
  // --- water
  def('river', 'river/1', 'path', 'volume', ['water', 'river', 'terrain'], 'A river: carves its bed, flows from the first point to the last; snapRiver snaps the ends into lakes and ponds and freezes the flow; waterfalls where the ground steps; shores.', [20, 2, 20], { params: P('river/1'), components: { water: { level: -0.3 } } }),
  def('stream', 'river/1', 'path', 'volume', ['water', 'river', 'terrain'], 'A narrow stream with pebble banks.', [10, 1, 10], { params: P('river/1', { width: { default: 2.5 }, depth: { default: 0.6 }, banks: { default: 'pebble' }, bankWidth: { default: 1.2 } }) }),
  def('shore', 'shore/1', 'area', 'surface', ['water', 'shore', 'terrain'], 'A beach or stone edge around a lake or pond: give the water outline as the area.', [20, 0.3, 20], { params: P('shore/1') }),
  def('bridge', 'bridge/1', 'path', 'surface', ['bridge', 'path-network', 'structure'], 'A bridge over a stream or gap along a short path: humped deck, rails, posts or a stone arch to the bed.', [10, 3, 4], { params: P('bridge/1'), components: { floor: { level: 0, y: 0 } } }),
  def('footbridge', 'bridge/1', 'path', 'surface', ['bridge', 'path-network', 'structure'], 'A narrow wooden garden footbridge.', [6, 2, 2], { params: P('bridge/1', { width: { default: 1.8 }, deck: { default: 0.5 } }) }),
  def('pier', 'pier/1', 'path', 'surface', ['pier', 'water', 'structure'], 'A pier or jetty on posts from the shore out over the water, with rails and an end platform.', [20, 2, 4], { params: P('pier/1'), components: { floor: { level: 0, y: 0 }, place: { kind: 'pier', enclosed: false } } }),
  def('deck', 'deck/1', 'area', 'surface', ['deck', 'structure'], 'A raised wooden deck or terrace on posts, over ground or water, with rails on the open edges.', [8, 1.6, 8], { params: P('deck/1'), components: { floor: { level: 0, y: 0 }, place: { kind: 'deck', enclosed: false } } }),
  // --- boundaries
  def('garden-wall', 'wall/1', 'path', 'solid', ['wall', 'boundary', 'structure'], 'A freestanding wall along a path (stone, brick, plaster) with a cap and optional gates [{at, width}].', [10, 1.8, 1], { params: P('wall/1') }),
  def('fence', 'fence/1', 'path', 'solid', ['fence', 'boundary'], 'A fence: picket, rail, wire or iron railings; gates [{at, width}]. Blocks walking, not sight.', [10, 1.1, 0.2], { params: P('fence/1') }),
  def('hedge', 'hedge/1', 'path', 'solid', ['hedge', 'boundary', 'plant'], 'A clipped, rounded hedge along a path; optional flowers; gaps [{at, width}].', [10, 1.2, 1], { params: P('hedge/1') }),
  def('power-line', 'power-line/1', 'path', 'decor', ['power', 'infrastructure'], 'Wooden poles along a path with drooping wires.', [30, 8, 1], { params: P('power-line/1') }),
  // --- areas
  def('plaza', 'plaza/1', 'area', 'surface', ['plaza', 'paving', 'place'], 'A paved square: cobble/stone/tile/brick, grid/herringbone/radial pattern, a low kerb.', [20, 0.2, 20], { params: P('plaza/1'), components: { place: { kind: 'plaza', enclosed: false } } }),
  def('lawn', 'lawn/1', 'area', 'surface', ['lawn', 'ground-paint', 'terrain'], 'A mown lawn (optional stripes) draped on the ground.', [20, 0.1, 20], { params: P('lawn/1') }),
  def('ground-paint', 'lawn/1', 'area', 'surface', ['ground-paint', 'terrain'], 'Paint the ground with a material: sand, gravel, moss, mud, rock, snow, dirt.', [20, 0.1, 20], { params: P('lawn/1', { material: { default: 'sand' } }) }),
  def('pitch', 'pitch/1', 'area', 'surface', ['pitch', 'sport', 'place'], 'A sports pitch in the area (long side = length): football, tennis, basketball, petanque, volleyball — lines, goals, nets, hoops.', [100, 3, 64], { params: P('pitch/1'), components: { place: { kind: 'pitch', enclosed: false } } }),
  def('football-pitch', 'pitch/1', 'area', 'surface', ['pitch', 'sport', 'place'], 'A football pitch with goals and mowing stripes.', [100, 3, 64], { params: P('pitch/1', { sport: { default: 'football' } }), components: { place: { kind: 'pitch', enclosed: false } } }),
  def('tennis-court', 'pitch/1', 'area', 'surface', ['pitch', 'sport', 'place'], 'A hard tennis court with a net and a high fence.', [36, 3, 18], { params: P('pitch/1', { sport: { default: 'tennis' }, fence: { default: true } }), components: { place: { kind: 'court', enclosed: false } } }),
  def('parking', 'parking/1', 'area', 'surface', ['parking', 'road'], 'A car park with marked bays.', [20, 0.1, 20], { params: P('parking/1') }),
  def('garden-bed', 'garden-bed/1', 'area', 'surface', ['garden', 'plant'], 'A planted bed in rows: flowers, vegetables, herbs, wheat, pumpkins.', [6, 0.6, 3], { params: P('garden-bed/1'), components: { plant: { stages: 3, daysPerStage: 1 } } }),
  def('orchard', 'orchard/1', 'area', 'solid', ['orchard', 'tree', 'plant'], 'Fruit or shade trees in a grid with age variation.', [20, 5, 20], { params: P('orchard/1') }),
  def('woodland', 'scatter/2', 'area', 'decor', ['cover', 'forest', 'plant', 'ecology'], 'A mixed wood: oaks, pines, birches, bushes and ferns in groves, reeds by any water, rocks on the steep, saplings at the edge; keeps off roads and buildings.', [100, 14, 100], { params: P('scatter/2') }),
  def('reedbed', 'scatter/2', 'area', 'decor', ['cover', 'water', 'plant', 'ecology'], 'Reeds and rushes along a shore (only within 4 m of water, standing in the shallows).', [20, 2, 20], { params: P('scatter/2', { density: { default: 0.6 }, minSpacing: { default: 0.5 }, palette: { default: [{ kind: 'reed', weight: 6, nearWater: 4, wet: 0.5 }, { kind: 'grass', weight: 2, nearWater: 6 }, { kind: 'flower', weight: 0.5, nearWater: 6, farWater: 1 }] } }) }),
  def('rock-field', 'scatter/2', 'area', 'decor', ['cover', 'rock', 'ecology'], 'Rocks and boulders, thickest on steep ground.', [40, 3, 40], { params: P('scatter/2', { density: { default: 0.04 }, cluster: { default: 0.6 }, palette: { default: [{ kind: 'rock', weight: 4, scale: [0.5, 1.6] }, { kind: 'boulder', weight: 1, minSlope: 0.3, scale: [0.8, 2] }, { kind: 'grass', weight: 2, maxSlope: 0.4 }] } }) }),
  def('wildflowers', 'scatter/2', 'area', 'decor', ['cover', 'meadow', 'plant', 'ecology'], 'A wildflower meadow: grasses and flowers in drifts.', [40, 1, 40], { params: P('scatter/2', { density: { default: 0.8 }, minSpacing: { default: 0.5 }, cluster: { default: 0.6 }, palette: { default: [{ kind: 'grass', weight: 4 }, { kind: 'flower', weight: 3, maxSlope: 0.6 }] } }) }),
  // --- landforms
  def('cliff', 'cliff/1', 'path', 'decor', ['landform', 'terrain'], 'A cliff or escarpment along a path: one side rises over a steep face, optionally in ledges.', [60, 10, 60], { params: P('cliff/1') }),
  def('terrace', 'terrace/1', 'area', 'decor', ['landform', 'terrain'], 'Flatten an area to a named level, or cut a hillside into terraces (step).', [30, 2, 30], { params: P('terrace/1') }),
  def('channel', 'channel/1', 'path', 'decor', ['landform', 'terrain'], 'A ditch, cutting or embankment along a path to levels.', [30, 2, 30], { params: P('channel/1') }),
  def('brush', 'brush/1', 'point', 'decor', ['landform', 'terrain', 'brush'], 'A terrain brush stroke: raise, lower, flatten or smooth around a point.', [16, 1, 16], { params: P('brush/1'), anchor: 'center' }),
];
writeFileSync(process.argv[2], JSON.stringify(defs, null, 1) + '\n');
console.log(defs.length, 'defs');

// Eden 2026 architecture: original places/centres and district compositions,
// rebuilt as editable core-kit buildings. No viewer-only building meshes.
// Sources: worlds/eden/places.v1.json, eden-regions/{north,south,canal-quarter,
// hill-village,suburb,cliff-village,resort-lake,abbey-yard,alpine}.ts and
// eden-interiors/buildings.ts. Import only; the template owner applies/furnishes.
import { readFileSync } from 'node:fs';
import { oneRoom } from './interiors.mjs';

const source = (path) => JSON.parse(readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8'));
const places = source('worlds/eden/places.v1.json').places;
const byPlace = new Map(places.map(p => [p.id, p]));
// Search the established FAMILY_KITS before authoring. Generic building/1 defs
// preserve source dimensions; furnished types keep their baked default plans.
const defs = new Map(['structures', 'vocab', 'vocab-2', 'vocab-w1', 'vocab-w2', 'vocab-w3', 'mars']
  .flatMap(f => source(`packages/world-compiler/src/core-kit/${f}.json`))
  .map(d => [`core/${d.name.replace(/^core-/, '')}@${d.version ?? 1}`, d]));
const r3 = n => Math.round(n * 1000) / 1000;
const pick = (r, a) => a[Math.floor(r() * a.length)];
function rng(seed) { let s = Math.imul((seed ^ 0x9e3779b9) >>> 0, 2654435761) >>> 0; s = (s ^ (s >>> 15)) >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const PLASTER = ['#e8d8b8', '#d9a85e', '#c96f4a', '#e6c86e', '#a9c3b0', '#9db8c9', '#d49a8c', '#efe9dc', '#c7b6d6', '#b9cf8c', '#e9b07a', '#8fb3a8', '#f0d9a8', '#cf8b6a'];
const ROOFS = ['#a8553a', '#b86a45', '#5a5f66', '#3f4448', '#6f7f5a', '#8a3a2a', '#4f5d6b', '#9c6b4a', '#5d4a3f'];
const bbox = p => { const xs = p.polygon.map(q => q[0]), zs = p.polygon.map(q => q[1]); return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]; };
const bounds = id => { const p = byPlace.get(id); if (!p) throw Error(`missing original Eden place ${id}`); return bbox(p); };
const center = id => { const [x0, z0, x1, z1] = bounds(id); return [r3((x0 + x1) / 2), r3((z0 + z1) / 2)]; };
const title = s => s.replace(/^.*[.]/, '').replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());

export const BUILDINGS = [];
export const COURTYARDS = [];
export const BUILDING_BATCHES = [];
const ops = [];
const room = (id, rect, name = title(id)) => ({ id, name, rect });
// Explicit plans use 0..W / 0..D. Both street and court doors in one room
// permit walking through the entry wing; there is never a painted door.
function openPlan(w, d, kind = 'hall', floors = 1) {
  return {
    floors: Array.from({ length: floors }, (_, k) => ({
      rooms: [room(k ? `${kind}-${k}` : kind, [0, 0, w, d], k ? `${title(kind)} upstairs ${k}` : title(kind))],
      exterior: k ? [] : [{ room: kind, wall: 's', kind: 'door', at: 0.5, width: 1.5 }, { room: kind, wall: 'n', kind: 'door', at: 0.5, width: 1.5 }],
    })),
    stairs: Array.from({ length: floors - 1 }, (_, k) => ({ from: k, to: k + 1, room: k ? `${kind}-${k}` : kind, wall: w >= d ? 'n' : 'w', at: 0.5 })),
  };
}
function twoRooms(w, d, frontKind, backKind, floors = 1) {
  const cut = r3(d * 0.36);
  const plan = openPlan(w, d, frontKind, floors);
  plan.floors[0] = {
    rooms: [room(frontKind, [0, cut, w, d]), room(backKind, [0, 0, w, cut])],
    doors: [{ between: [frontKind, backKind], at: 0.7, width: 1.2 }],
    exterior: [{ room: frontKind, wall: 's', kind: 'door', at: 0.5, width: 1.5 }, { room: backKind, wall: 'n', kind: 'door', at: 0.5, width: 1.2 }],
  };
  if (floors > 1) plan.stairs[0].room = frontKind;
  return plan;
}
function aabb(b, margin = 0) {
  const c = Math.abs(Math.cos(b.r)), s = Math.abs(Math.sin(b.r));
  const hw = (c * b.w + s * b.d) / 2 + margin, hd = (s * b.w + c * b.d) / 2 + margin;
  return [b.coords[0] - hw, b.coords[1] - hd, b.coords[0] + hw, b.coords[1] + hd];
}
function add(id, defName, coords, params = {}, options = {}) {
  const name = options.name ?? id.replace(/[^a-z0-9_-]/g, '-').slice(0, 48);
  if (BUILDINGS.some(b => b.name === name)) throw Error(`duplicate Eden building ${name}`);
  const def = `core/${defName}@1`, d = defs.get(def);
  if (!d) throw Error(`use existing FAMILY_KITS def: ${def}`);
  const autoFurnished = !!d.contents?.length;
  const defaults = Object.fromEntries(Object.entries(d.params ?? {}).map(([k, v]) => [k, v.default]));
  const building = d.make?.gen === 'building/1';
  const p = building && !autoFurnished ? { wall: '#efe4cf', trim: '#6b4a2b', roofColor: '#8a3b2a', ...params } : { ...params };
  // Keep spiral flights above the native minimum clear width.
  if (defName === 'tower') { p.w = Math.max(5, p.w ?? defaults.w); p.d = Math.max(5, p.d ?? defaults.d); }
  const w = Number(p.w ?? defaults.w ?? d.size?.box?.[0] ?? 6), depth = Number(p.d ?? defaults.d ?? d.size?.box?.[2] ?? 6);
  // Explicit room/door plans preserve entry on the smallest domed landmarks.
  if (['roundhouse', 'lighthouse'].includes(defName) && !p.plan) p.plan = openPlan(w, depth, 'living', p.floors ?? 1);
  const metadata = {
    name, displayName: options.displayName ?? byPlace.get(id)?.name ?? title(id), def, originalPlaceId: options.originalPlaceId ?? id,
    coords: coords.map(r3), furnishStyle: Object.hasOwn(options, 'furnishStyle') ? options.furnishStyle : d.make?.args?.furnish ?? d.make?.args?.style ?? null,
    autoFurnished, w, d: depth, floors: p.floors ?? defaults.floors ?? 1, r: r3(options.r ?? 0),
    district: options.district ?? byPlace.get(id)?.parent ?? id.split('.')[0], ...options.metadata,
  };
  if (options.avoidOverlap) {
    const [a, b, c, e] = aabb(metadata, 0.3);
    if (BUILDINGS.some(q => { const [x, z, xx, zz] = aabb(q); return a < xx && c > x && b < zz && e > z; })) return null;
  }
  ops.push({ op: 'place', def, name, p: metadata.coords, ...(metadata.r ? { r: metadata.r } : {}), ...(Object.keys(p).length ? { params: p } : {}) });
  BUILDINGS.push(metadata);
  return metadata;
}
function named(id, def, params = {}, options = {}) {
  return add(id, def, options.coords ?? center(id), params, options);
}

// The four little east-side houses and four Mediterranean-quarter houses all
// have real open-sky courts. A single building/1 ring plan would draw its roof
// over the hole, so four independently roofed, entered wings are intentional.
function courtyard(id, coords, w, d, palette, { floors = 1, r = 0, roofTerrace = false } = {}) {
  const wing = 3.2, gap = 0.4, middle = Math.max(3.2, d - 2 * wing - gap * 2);
  const label = byPlace.get(id)?.name ?? title(id), c = Math.cos(r), s = Math.sin(r);
  const turn = (x, z) => [coords[0] + x * c + z * s, coords[1] - x * s + z * c];
  const group = { originalPlaceId: id, name: id.replace(/[^a-z0-9_-]/g, '-').slice(0, 48), displayName: label, coords, w, d, r, court: { center: coords, w: w - 2 * wing, d: d - 2 * wing }, wings: [] };
  for (const [side, x, z, ww, dd, kind] of [
    ['entry', 0, d / 2 - wing / 2, w, wing, 'living'],
    ['kitchen', 0, -d / 2 + wing / 2, w, wing, 'kitchen'],
    ['bedroom', -w / 2 + wing / 2, 0, wing, middle, 'bedroom'],
    ['study', w / 2 - wing / 2, 0, wing, middle, 'parlour'],
  ]) {
    const levels = side === 'kitchen' ? floors : 1;
    const p = { w: ww, d: dd, floors: levels, floorHeight: 2.8, material: palette.material, wall: palette.wall, trim: palette.trim, roofColor: palette.roof,
      roof: roofTerrace || side === 'study' ? 'flat' : 'shed', roofPitch: 20, windows: 0.45, plan: openPlan(ww, dd, kind, levels) };
    if (side === 'bedroom' || side === 'study') p.plan.floors[0].exterior.push({ room: kind, wall: side === 'bedroom' ? 'e' : 'w', kind: 'door', at: 0.5, width: 1.3 });
    const b = add(id, 'hall', turn(x, z), p, { name: side === 'entry' ? group.name : `${group.name}-${side}`.slice(0, 48), displayName: `${label} — ${side === 'entry' ? 'entry and living room' : side} wing`, originalPlaceId: id, r, furnishStyle: 'cottage',
      metadata: { courtyardGroup: group.name, courtyardCenter: coords, courtyard: group.court, entry: side === 'entry', roomPurpose: kind, ...(roofTerrace && side === 'bedroom' ? { roofTerrace: true, terraceHeight: 2.82 } : {}) } });
    group.wings.push(b.name);
  }
  if (roofTerrace) {
    // Existing stairs/1 def, despite its historical Mars name. The flight climbs
    // from the west garden onto the lower west-wing roof, with a real landing.
    const p = turn(-w / 2 - 2.1, 0);
    const stair = add(id, 'mars-tool-library-stair', p, { rise: 2.82, run: 4.2, width: 1.4, material: 'stone' }, {
      name: `${group.name}-roof-stairs`, displayName: `${label} — roof terrace stairs`, originalPlaceId: id, r: r - Math.PI / 2,
      metadata: { courtyardGroup: group.name, circulation: true, w: 1.4, d: 4.2, roofAccessFor: `${group.name}-bedroom` },
    });
    group.roofStairs = stair.name;
  }
  COURTYARDS.push(group);
}
courtyard('eden-house-1', [34, 15], 11, 10.4, { material: 'brick', wall: '#a85a42', roof: '#8a3b2a', trim: '#e9dfcc' });
courtyard('eden-house-2', [52, 15], 11, 10.4, { material: 'plaster', wall: '#d5d5cd', roof: '#5d6567', trim: '#45616c' }, { floors: 2 });
courtyard('eden-house-3', [34, 30], 12, 11, { material: 'wood', wall: '#d7ba91', roof: '#776d5b', trim: '#8a603e' }, { floors: 2, roofTerrace: true });
courtyard('eden-house-4', [54, 30], 12, 11, { material: 'stone', wall: '#d9d7c9', roof: '#696f68', trim: '#78725e' }, { floors: 2, roofTerrace: true });
for (const [i, x, z, w, r] of [[1, -116, 60, 16, 0], [2, -136, 60, 14, 0], [3, -116, 80, 16, Math.PI], [4, -138, 80, 18, Math.PI]]) {
  const rr = rng(5300 + (i - 1) * 17), floors = 1 + (rr() < 0.5 ? 1 : 0);
  courtyard(`region-courtyard-quarter.house-${i}`, [x, z], w, 13, { material: 'plaster', wall: pick(rr, ['#efe4cf', '#e6c86e', '#e9b07a', '#d49a8c', '#f0d9a8', '#c96f4a', '#efe9dc']), roof: pick(rr, ['#a8553a', '#b86a45', '#c27a52']), trim: '#3a5a4a' }, { floors, r });
}
courtyard('region-abbey.cloister', center('region-abbey.cloister'), 18, 16, { material: 'stone', wall: '#d8c9a8', roof: '#a8553a', trim: '#efe9dc' }, { floors: 2 });

// Close-up east-side public quarter, with room ids matching furnish recipes.
named('eden-library-1', 'hall', { w: 10.4, d: 8.4, floorHeight: 3.3, material: 'stone', wall: '#b3a487', roof: 'flat', roofColor: '#5f5a50', windows: 0.75, plan: oneRoom(10.4, 8.4, 'reading') }, { furnishStyle: null }); // furnished piece by piece like old Eden (interiors.mjs)
named('eden-office-1', 'hall', { w: 12, d: 8, floors: 3, floorHeight: 3, material: 'plaster', wall: '#d6d9d8', roof: 'flat', trim: '#52636a', plan: { floors: [
  { rooms: [room('reception', [0, 0, 12, 8])], exterior: [{ room: 'reception', wall: 's', kind: 'door', width: 1.6 }] },
  { rooms: [room('office', [0, 0, 12, 8])] }, { rooms: [room('meeting', [0, 0, 12, 8])] },
], stairs: [{ from: 0, to: 1, room: 'reception', wall: 'n', at: 0 }, { from: 1, to: 2, room: 'office', wall: 'n', at: 1 }] } }, { furnishStyle: 'office-block' });
named('eden-barn-1', 'barn', { w: 12.4, d: 8.4, floorHeight: 4.2, material: 'wood', wall: '#8b4735', trim: '#d8c7a0', roof: 'gable', roofColor: '#5a5650' }, { furnishStyle: 'barn' });
named('eden-market-1', 'pavilion', { w: 12, d: 6, floorHeight: 3.5, material: 'wood', wall: '#b08a5f', trim: '#6b4a2b', roof: 'gable', roofColor: '#6d735e' }, { furnishStyle: null });
named('eden-classroom-1', 'hall', { w: 16, d: 19, floorHeight: 4, wall: '#dfd6bf', trim: '#6a7770', roof: 'hip', roofColor: '#63736a', plan: openPlan(16, 19, 'classroom') }, { coords: [42, -8.5], furnishStyle: 'school' });
for (const [id, x, z, w, d, r, wall, roof, trim, front, back, style] of [
  ['int-cafe', 101.5, 25, 8, 6, -Math.PI / 2, '#e7d2b0', '#9b4a35', '#3f5f57', 'cafe', 'kitchen', 'cafe'],
  ['int-music-room', 101.1, 59, 7, 5, -Math.PI / 2, '#cfd8dc', '#4b5258', '#7a4a6a', 'hall', 'gallery', 'hall'],
  ['int-games-room', 86.5, -19.5, 5, 4, 0, '#d49a8c', '#5a5f66', '#3b5a7a', 'hall', null, 'hall'],
  ['int-bakery', 77.5, -15.5, 5, 4, Math.PI / 2, '#f0e2c4', '#b5603c', '#8c5a2c', 'shop', 'storeroom', 'shop'],
  ['int-chapel', 86.5, 82, 4.4, 5.4, -Math.PI / 2, '#f1ede4', '#4d5560', '#6b4f3a', 'nave', null, 'church'],
  ['int-clinic', 64.5, -8.5, 4.4, 5.4, 0, '#e8eef0', '#5d6b73', '#3f8a6a', 'ward', null, 'hospital'],
  ['int-bathhouse', 83.5, -10.5, 4.4, 5.4, 0, '#cfe3e6', '#6e7c86', '#2f6f8a', 'bath', null, 'cottage'],
  ['int-potting-shed', 44, 82.5, 4.4, 4.4, Math.PI, '#7f8f5a', '#8a5a3c', '#e9e2cf', 'workshop', null, 'garage'],
]) add(id, 'hall', [x, z], { w, d, floorHeight: 3, wall, roofColor: roof, trim, roof: 'gable', plan: id === 'int-cafe' ? oneRoom(w, d, 'cafe') : back ? twoRooms(w, d, front, back) : openPlan(w, d, front) }, { r, furnishStyle: id === 'int-cafe' ? null : style }); // café furnished piece by piece (interiors.mjs)

// Named buildings and major skyline landmarks. Enterable counterparts use
// building/1; windmills retain the existing animated sail kit as in old Eden.
const NAMED = [
  ['eden-observatory', 'roundhouse', 5, 5, 1, 3.2, '#d6d2c3', '#5c6d78', 'dome', 'stone', 0, 'cottage'],
  ['eden-windmill', 'windmill'],
  ['eden-greenhouse', 'greenhouse', 10.4, 5, 1, 2.8, '#cfe6df', '#7a948b', 'gable', 'glass', 0, null],
  ['eden-a-frame', 'cottage', 5, 6, 1, 2.6, '#a4774f', '#5d4a3f', 'gable', 'wood', 0, 'cottage'],
  ['eden-yurt', 'roundhouse', 6, 6, 1, 2.5, '#e8d8b8', '#a97951', 'dome', 'plaster', 0, 'cottage'],
  ['eden-tower-house', 'tower', 4, 4, 3, 2.8, '#d8c5a5', '#6b6154', 'hip', 'stone', 0, 'cottage'],
  ['region-old-town.domed-hall', 'hall', 11, 13, 2, 4, '#efe9dc', '#5f8a7a', 'dome', 'plaster', -Math.PI / 2, 'hall'],
  ['region-old-town.bell-tower', 'tower', 4.4, 4.4, 5, 3, '#d9a85e', '#5a5f66', 'hip', 'stone', 0, 'hall'],
  ['region-sports-ground.clubhouse', 'hall', 10, 6, 1, 3, '#efe9dc', '#3f6a3c', 'gable', 'plaster', Math.PI / 2, 'hall'],
  ['region-farm-hamlet.barn', 'barn', 12, 9, 2, 3.2, '#8e3326', '#4a4440', 'gable', 'wood', 0, 'barn'],
  ['region-farm-hamlet.farmhouse', 'cottage', 8, 7, 2, 2.9, '#efe4cf', '#5a5f66', 'hip', 'plaster', -Math.PI / 2, 'cottage'],
  ['region-farm-hamlet.windmill', 'windmill'],
  ['region-harbour.lighthouse', 'lighthouse', 5, 5, 5, 2.6, '#efe9dc', '#c43a2a', 'dome', 'plaster', 0, null],
  ['region-harbour.fish-market', 'hall', 14, 6, 1, 4, '#5f7f8f', '#3f4448', 'gable', 'wood', 0, 'shop'],
  ['region-vineyard.villa', 'cottage', 16, 10, 2, 3, '#e6c86e', '#b86a45', 'hip', 'plaster', 0, 'cottage'],
  ['region-vineyard.villa-tower', 'tower', 4.8, 4.8, 4, 3, '#e6c86e', '#b86a45', 'hip', 'stone', 0, 'hall'],
  ['region-vineyard.wine-cellar', 'barn', 9, 7, 1, 3.6, '#c4b9a2', '#a8553a', 'gable', 'stone', -Math.PI / 2, 'barn'],
  ['region-artists-village.warehouse-studio', 'hall', 20, 12, 1, 5, '#9a4a36', '#3f4448', 'shed', 'brick', 0, 'hall'],
  ['region-west-lake.inn', 'cottage', 16, 9, 2, 2.9, '#efe4cf', '#3f4448', 'gable', 'wood', Math.atan2(-8, 54), 'cottage'],
  ['region-campsite.lodge', 'cottage', 14, 9, 2, 3, '#8a5a36', '#3f4a3a', 'gable', 'wood', Math.PI * 0.85, 'cottage'],
  ['region-railway-station.station-building', 'hall', 18, 6, 2, 3.4, '#b9785a', '#5a5f66', 'hip', 'stone', Math.PI, 'hall'],
  ['region-makers-yard.workshop-1', 'barn', 13, 9, 1, 5, '#5f6b73', '#5a5f66', 'gable', 'wood', Math.PI, 'garage'],
  ['region-makers-yard.workshop-2', 'barn', 13, 9, 1, 5, '#8a5a36', '#5a5f66', 'gable', 'wood', Math.PI, 'garage'],
  ['region-makers-yard.workshop-3', 'barn', 13, 9, 1, 5, '#3f5a6a', '#5a5f66', 'gable', 'wood', Math.PI, 'garage'],
  ['region-abbey.church', 'church', 14, 26, 1, 5, '#c9bfa8', '#5a5f66', 'gable', 'stone', Math.PI / 2, 'church'],
  ['region-botanic-garden.pagoda', 'tower', 5, 5, 5, 2.6, '#efe4cf', '#3f4448', 'hip', 'wood', 0.3, 'hall'],
  ['region-botanic-garden.tea-house', 'pavilion', 8, 6, 1, 2.8, '#b98c5d', '#5d4a3f', 'hip', 'wood', Math.PI / 2, 'hall'],
  ['region-botanic-garden.palm-house', 'greenhouse', 16, 9, 1, 4.2, '#cfe6df', '#4e6f65', 'dome', 'glass', 0, null],
  ['region-observatory.dome', 'hall', 9, 9, 2, 3.6, '#d8d6ca', '#708087', 'dome', 'stone', 0, 'cottage'],
  ['region-west-river.watermill', 'cottage', 9, 7, 2, 3, '#b9ae96', '#5d4a3f', 'gable', 'stone', -Math.PI / 2, 'cottage'],
  ['region-cliff-village.chapel', 'chapel', 6, 9, 1, 4.2, '#faf8f2', '#1f5fa8', 'dome', 'plaster', 0, 'church'],
  ['region-cliff-village.windmill-east', 'windmill'], ['region-cliff-village.windmill-west', 'windmill'],
  ['region-east-crossroads.petrol-station', 'shop', 7, 5, 1, 3, '#f3eee2', '#c43a2a', 'flat', 'plaster', 0, 'shop'],
  ['region-east-crossroads.pub', 'hall', 12, 8, 2, 2.9, '#b9ae96', '#3f4a3a', 'gable', 'stone', Math.PI / 2, 'bar'],
  ['region-golf-course.clubhouse', 'hall', 12, 7, 1, 3.4, '#efe9dc', '#3f5a4a', 'hip', 'plaster', Math.PI / 2, 'hall'],
  ['region-festival-meadow.big-top', 'hall', 22, 22, 1, 5, '#efe9dc', '#c44a45', 'hip', 'plaster', 0, 'hall'],
  ['region-alpine.valley-station', 'hall', 7, 6, 1, 4, '#8a5a36', '#5a5f66', 'flat', 'wood', 0, 'hall'],
  ['region-alpine.mountain-station', 'hall', 8, 7, 1, 4, '#6e4a30', '#5a5f66', 'flat', 'wood', 0, 'hall'],
  ['region-alpine.mountain-restaurant', 'cottage', 12, 8, 2, 2.8, '#7a4a2a', '#4a4440', 'gable', 'wood', Math.PI, 'cafe'],
];
for (const [id, def, w, d, floors, floorHeight, wall, roofColor, roof, material, r = 0, furnishStyle] of NAMED) {
  if (def === 'windmill') { named(id, def, { paint: '#f4f2ec', sail: '#e2cfa8', vary: 0.1 }, { furnishStyle: null, metadata: { architecturalDecor: true } }); continue; }
  const params = { w, d, floors, floorHeight, wall, roofColor, roof, material, trim: id.includes('cliff-village') ? '#1f5fa8' : '#e9dfcc', windows: 0.6 };
  if (def === 'hall' && ['bar', 'hall', 'shop', 'cafe', 'garage'].includes(furnishStyle)) params.plan = openPlan(w, d, furnishStyle === 'garage' ? 'workshop' : furnishStyle === 'bar' ? 'bar' : furnishStyle === 'cafe' ? 'cafe' : furnishStyle, floors);
  named(id, def, params, { r, furnishStyle, ...(def === 'cottage' && floors > 1 ? { metadata: { balconyPreferred: true } } : {}) });
}

// Campus quad: the annex and two long lecture halls retain their distinctive
// enclosing proportions and outward street entrances as well as quad entries.
named('region-campus.library-annex', 'hall', { w: 24, d: 11, floors: 2, floorHeight: 3.6, material: 'stone', wall: '#efe4cf', trim: '#e8e2d2', roof: 'flat', roofColor: '#7a8a8f', plan: twoRooms(24, 11, 'reading', 'stacks', 2) }, { furnishStyle: 'library' });
for (const [side, x, r] of [['east', 13, -Math.PI / 2], ['west', -37, Math.PI / 2]]) named(`region-campus.${side}-hall`, 'hall', { w: 24, d: 10, floors: 2, floorHeight: 3.6, material: 'brick', wall: side === 'east' ? '#b9785a' : '#a0563f', trim: '#efe9dc', roof: 'gable', roofColor: '#5a5f66', plan: openPlan(24, 10, 'classroom', 2) }, { coords: [x, -97], r, furnishStyle: 'school' });
named('region-campus.clock-tower', 'tower', { w: 4, d: 4, floors: 5, floorHeight: 3, material: 'stone', wall: '#b9785a', trim: '#efe9dc', roof: 'hip', roofColor: '#5a5f66' }, { furnishStyle: 'hall', metadata: { clockFacePreferred: true } });
for (const [x, i] of [[-36, 1], [12, 2]]) add(`campus-residence-${i}`, 'cottage', [x, -119], { w: 9, d: 7, floors: 3, roof: 'flat', wall: i === 1 ? '#efe4cf' : '#a9c3b0', trim: '#3a5a4a', balcony: true }, { r: Math.PI / 2, district: 'region-campus', originalPlaceId: 'region-campus', furnishStyle: 'cottage' });

// Covered pavilions and landmarks outside the commons are architecture, not
// landscaping. Existing open generator/kit types retain through-access.
for (const [id, def, params] of [
  ['eden-dome', 'roundhouse', { w: 9, d: 9, roof: 'dome', wall: '#e8e2d2', roofColor: '#b7c8c7', material: 'glass' }],
  ['eden-pergola-court', 'pavilion', { w: 6.5, d: 6, roof: 'flat', wall: '#9a7753', trim: '#7d674b' }],
  ['eden-hex-pavilion', 'pavilion', { w: 6, d: 6, roof: 'hip', wall: '#b89c73', roofColor: '#698477' }],
  ['eden-bandstand', 'pavilion', { w: 7, d: 5, roof: 'hip', wall: '#efe9dc', roofColor: '#56766d' }],
  ['eden-tea-house', 'pavilion', { w: 6, d: 4, roof: 'hip', wall: '#a17a50', roofColor: '#5c6c50' }],
  ['region-hillside-village.lookout-temple', 'pavilion', { w: 9, d: 9, roof: 'dome', material: 'stone', wall: '#efe9dc', trim: '#c9c0ae', roofColor: '#b08a5f', floorHeight: 4.2 }],
  ['region-park.gazebo', 'pavilion', { w: 6.4, d: 6.4, roof: 'hip', wall: '#efe9dc', roofColor: '#5f8a7a' }],
]) named(id, def, params, { furnishStyle: null });

// District rows: narrow canal townhouses, market shops and waterfront hotels.
// Small gaps avoid shared-wall collider duplication while retaining the rows.
for (const [side, x, r] of [['west', 121, Math.PI / 2], ['east', 152, -Math.PI / 2]]) {
  let i = 0;
  for (const [a, b] of [[-30, 0], [4, 27], [31, 53]]) for (let z = a; z + 5.3 <= b; z += 5.7) {
    const rr = rng(9101 + ++i * 37 + (side === 'east' ? 700 : 0));
    add(`canal-${side}-home-${i}`, 'townhouse', [x, z + 2.65], { w: 5.2, d: 8.2, floors: 2 + Math.floor(rr() * 2), floorHeight: 2.9, wall: pick(rr, PLASTER), roof: pick(rr, ['gable', 'hip', 'flat']), roofColor: pick(rr, ROOFS), trim: '#e9dfcc', windows: 0.65 }, { r, district: 'region-canal-quarter', originalPlaceId: `region-canal-quarter.${side}-row`, furnishStyle: 'shop', avoidOverlap: true });
  }
}
for (let i = 0; i < 9; i++) add(`market-street-shop-${i + 1}`, 'shop', [113.1 + i * 6.3, 105.5], { w: 5.7, d: 8, floors: 2 + (i % 3 === 0 ? 1 : 0), material: 'plaster', wall: PLASTER[(i * 3) % PLASTER.length], roof: ['gable', 'hip', 'flat'][i % 3], roofColor: ROOFS[i % ROOFS.length], trim: ['#2f4f5f', '#7a2f2a', '#355e3b'][i % 3] }, { r: Math.PI, district: 'region-old-town', originalPlaceId: 'region-old-town.shops', furnishStyle: 'shop', avoidOverlap: true });
for (const [side, z, r] of [['north', 56.5, 0], ['south', 89.5, Math.PI]]) for (let i = 0; i < 4; i++) add(`old-town-${side}-arcade-${i + 1}`, 'shop', [124.5 + i * 9.6, z], { w: 9, d: 6, floors: 2, wall: side === 'north' ? '#e6c86e' : '#e9b07a', trim: '#e8e2d2', roof: 'gable', roofColor: '#8a3a2a', porch: 1.6 }, { r, originalPlaceId: `region-old-town.${side}-arcade`, district: 'region-old-town', furnishStyle: 'shop', avoidOverlap: true });
for (let i = 0; i < 4; i++) add(`seafront-hotel-${i + 1}`, 'hall', [120 + i * 14.5, 121], { w: 12.5, d: 10, floors: 3, floorHeight: 3.1, wall: ['#efe9dc', '#e6c86e', '#a9c3b0', '#9db8c9'][i], trim: ['#2f6f8f', '#3d5a80', '#c45a4a', '#5a8a6a'][i], roof: 'flat', balcony: true }, { originalPlaceId: 'region-seaside-resort.hotels', district: 'region-seaside-resort', furnishStyle: 'cottage', avoidOverlap: true });
for (let i = 0; i < 3; i++) add(`makers-greenhouse-${i + 1}`, 'greenhouse', [148 + i * 9, -98], { w: 7, d: 14, floorHeight: 2.8, material: 'glass', wall: '#cfe6ea', roofColor: '#dff0f2', roof: 'gable' }, { originalPlaceId: 'region-makers-yard.greenhouses', district: 'region-makers-yard', furnishStyle: null });

// The ruined keep and corner towers remain the north-west skyline landmark;
// roofs omitted on two towers, preserving a readable ruined silhouette.
add('castle-keep', 'tower', [-165, -185], { w: 7, d: 7, floors: 4, floorHeight: 3, material: 'stone', wall: '#9a9284', trim: '#c4b9a2', roof: 'none', windows: 0.35 }, { r: 0.5, originalPlaceId: 'region-castle-ruin', district: 'region-castle-ruin', furnishStyle: 'hall', metadata: { ruin: true } });
for (const [i, [dx, dz]] of [[-10, -10], [10, -10], [-10, 10], [10, 10]].entries()) {
  const c = Math.cos(0.5), s = Math.sin(0.5);
  add(`castle-tower-${i + 1}`, 'tower', [-165 + dx * c + dz * s, -185 - dx * s + dz * c], { w: 4.6, d: 4.6, floors: i === 3 ? 2 : 3, floorHeight: 3, material: 'stone', wall: '#9a9284', trim: '#b9b0a0', roof: i % 2 ? 'none' : 'hip', roofColor: '#5a5f66', windows: 0.25 }, { r: 0.5, originalPlaceId: 'region-castle-ruin', district: 'region-castle-ruin', furnishStyle: 'hall', metadata: { ruin: true } });
}
for (let i = 0; i < 13; i++) add(`beach-hut-${i + 1}`, 'shed', [-98 + i * 4.2, 134.5], { w: 3, d: 3, floorHeight: 2.4, material: 'wood', wall: ['#e05a3a', '#3d8ab0', '#f0c040', '#5aa070', '#e88aa0', '#efe9dc'][i % 6], roof: 'gable', roofColor: '#efe9dc', windows: 0.2 }, { r: Math.PI, originalPlaceId: 'region-harbour.beach', district: 'region-harbour', furnishStyle: 'hall', avoidOverlap: true });

// Leafy suburb: the exact deterministic lot centres from suburb.ts, using the
// library's fully furnished house at its supported original size.
const STREETS = [[[172, 34], [244, 34]], [[172, 74], [244, 74]], [[172, 112], [244, 112]], [[206, 34], [206, 112]]];
const suburbLots = [];
for (const [[ax, az], [bx, bz]] of STREETS) {
  const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
  for (let k = 8; k < len - 6; k += 13) for (const side of [1, -1]) {
    const x = ax + ux * k - uz * 12 * side, z = az + uz * k + ux * 12 * side;
    if (x < 174 || x > 248 || z < 40 || z > 106 || suburbLots.some(l => Math.hypot(l.x - x, l.z - z) < 12)) continue;
    if (STREETS.some(([[sx, sz], [ex, ez]]) => { const dx = ex - sx, dz = ez - sz, u = Math.max(0, Math.min(1, ((x - sx) * dx + (z - sz) * dz) / (dx * dx + dz * dz))); return Math.hypot(x - sx - dx * u, z - sz - dz * u) < 8.4; })) continue;
    suburbLots.push({ x, z, r: Math.atan2(ax + ux * k - x, az + uz * k - z) });
  }
}
suburbLots.forEach((l, i) => add(`suburb-house-${i + 1}`, 'house', [l.x, l.z], { wall: PLASTER[(i * 5) % PLASTER.length], roofColor: ROOFS[i % ROOFS.length], trim: ['#f3eee2', '#2f4f5f', '#7a2f2a', '#355e3b'][i % 4] }, { r: l.r, originalPlaceId: 'region-east-suburb', district: 'region-east-suburb', furnishStyle: 'house', avoidOverlap: true }));

// Lakeside hamlet, alpine chalets and the artists' ring use their authored lots.
for (const [i, [x, z]] of [[-120, -58], [-156, -58], [-168, -55], [-180, -50], [-192, -40], [-198, -26]].entries()) add(`lake-cabin-${i + 1}`, 'cabin', [x, z], { wall: ['#7a2f2a', '#5a6a3a', '#2f4f5f', '#8a5a36', '#b08a5f', '#d9a85e'][i], roofColor: '#3f4448' }, { r: Math.atan2(-148 - x, 2 - z), originalPlaceId: 'region-west-lake', district: 'region-west-lake', furnishStyle: 'cabin', avoidOverlap: true });
for (const [i, [x, z]] of [[-40, -236], [-28, -246], [-46, -252], [-20, -232], [-34, -262], [20, -238], [30, -250]].entries()) add(`alpine-chalet-${i + 1}`, 'cottage', [x, z], { w: 8, d: 7, floors: 2, floorHeight: 2.8, material: 'wood', wall: ['#7a4a2a', '#8a5a36', '#6e4a30'][i % 3], roof: 'gable', roofPitch: 40, roofColor: '#4a4440', trim: '#f3eee2', balcony: true }, { r: Math.PI, originalPlaceId: 'region-alpine', district: 'region-alpine', furnishStyle: 'cottage', avoidOverlap: true });
for (let i = 0; i < 9; i++) {
  const a = i / 9 * Math.PI * 2 + 0.2, x = -74 + Math.cos(a) * 21, z = -98 + Math.sin(a) * 21;
  if (x > -50 || z < -130) continue;
  add(`artists-studio-${i + 1}`, 'cottage', [x, z], { w: 7, d: 6.5, floors: 1 + (i % 2), floorHeight: 3.4, material: i % 4 === 1 ? 'wood' : 'plaster', wall: ['#e05a3a', '#3d8ab0', '#f0c040', '#5aa070', '#e88aa0', '#7a4a8a', '#2f6f6f', '#d9a85e'][i % 8], roof: ['shed', 'gable', 'flat'][i % 3], roofColor: '#3f4448', trim: '#f3eee2' }, { r: Math.atan2(-74 - x, -98 - z), originalPlaceId: 'region-artists-village', district: 'region-artists-village', furnishStyle: 'cottage', avoidOverlap: true });
}

// White cliff village: deterministic source lots, preserving the chapel/mills'
// open spaces and the white/blue identity. All roofs are usable flat terraces.
{
  const r = rng(9401); let i = 0;
  for (let gx = 256; gx < 304; gx += 7) for (let gz = 94; gz < 128; gz += 6.5) {
    const x = gx + (r() - 0.5) * 2, z = gz + (r() - 0.5) * 1.6;
    if (Math.hypot(x - 279, z - 104) < 10 || [[296, 92], [262, 90]].some(([xx, zz]) => Math.hypot(x - xx, z - zz) < 7) || r() < 0.15) continue;
    const w = 4.5 + r() * 2, d = 4 + r() * 1.5, rr = rng(Math.round(x * 13 + z * 7));
    add(`cliff-house-${++i}`, 'cottage', [x, z], { w: r3(w), d: r3(d), floors: rr() < 0.35 ? 2 : 1, floorHeight: 2.7, material: 'plaster', wall: pick(rr, ['#f6f4ee', '#f2efe6', '#faf8f2', '#efe9dc']), roof: 'flat', trim: pick(rr, ['#1f5fa8', '#2a6fb8', '#16508f', '#3d8ab0']), windows: 0.5 }, { originalPlaceId: 'region-cliff-village', district: 'region-cliff-village', furnishStyle: 'cottage', avoidOverlap: true });
  }
}

// Hillside village: original seed, nearest-lane facing, railway setback and
// summit exclusion. This is geometry authoring only, never a navigation edit.
const HILL_ROAD = [[160, -8], [170, -9], [180, -14], [188, -26], [192, -40], [200, -52], [212, -55], [220, -46], [214, -34], [204, -26], [202, -14], [210, -4], [222, -2], [234, -8], [238, -20], [232, -28], [226, -24]];
const RAIL = [[112, -49], [150, -49], [176, -50], [200, -56], [226, -74], [246, -98]];
function nearest(x, z, line) {
  let hit = { d: Infinity, x: 0, z: 0 };
  for (let i = 1; i < line.length; i++) { const [ax, az] = line[i - 1], [bx, bz] = line[i], dx = bx - ax, dz = bz - az, u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz))), xx = ax + dx * u, zz = az + dz * u, d = Math.hypot(x - xx, z - zz); if (d < hit.d) hit = { d, x: xx, z: zz }; }
  return hit;
}
{
  const r = rng(31337), lots = [];
  for (let gx = 180; gx < 258; gx += 10) for (let gz = -70; gz < 24; gz += 10) {
    const x = gx + (r() - 0.5) * 4, z = gz + (r() - 0.5) * 4, n = nearest(x, z, HILL_ROAD);
    if (n.d < 10 || n.d > 30 || nearest(x, z, RAIL).d < 12 || Math.hypot(x - 226, z + 22) < 15 || r() < 0.12 || lots.some(l => Math.hypot(l.x - x, l.z - z) < 10.5)) continue;
    lots.push({ x, z, r: Math.atan2(n.x - x, n.z - z), w: 6 + r() * 3, d: 5.5 + r() * 2.5 });
  }
  lots.forEach((l, i) => { const rr = rng(900 + i); add(`hillside-home-${i + 1}`, 'cottage', [l.x, l.z], { w: r3(l.w), d: r3(l.d), floors: rr() < 0.45 ? 2 : 1, material: 'plaster', wall: pick(rr, PLASTER), roof: pick(rr, ['gable', 'hip', 'flat', 'shed']), roofColor: pick(rr, ['#a8553a', '#b86a45', '#9c4a32', '#c27a52', '#8a3a2a']), trim: pick(rr, ['#2f4f5f', '#355e3b', '#7a2f2a', '#efe9dc', '#3d5a80']) }, { r: l.r, originalPlaceId: 'region-hillside-village', district: 'region-hillside-village', furnishStyle: 'cottage', avoidOverlap: true }); });
}

// No execution, writes, services or credentials on import. Stable small edit
// batches keep refusals attributable to one district during root validation.
for (let i = 0; i < ops.length; i += 8) BUILDING_BATCHES.push({ label: `Eden architecture ${i / 8 + 1}`, ops: ops.slice(i, i + 8) });

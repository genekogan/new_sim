// Old Eden's office (eden-office-1) upper floors as an upper-floors/1 fact, plus the upstairs activity spots (lane L4b,
// 2026-10-17; Gene's decision #5). Geometry: the office the viewer draws (mars/viewer/app/engine-view/content/assets/
// office-building-proposal/office.ts at centre (92, 15), yaw 0; eden-interiors/existing.ts draws its rooms): interior
// 86.2..97.8 x 11.2..18.8, floors at y 0.1 / 3.1 / 6.1, stair well x 87.2..89 z 13.5..16.5 with a dog-leg flight per storey
// (lower flight x 87.2..88 going north, turn landing, upper flight x 88.2..89 going south, exit landing onto the floor).
// The live stair-well guards (office-stair-guards/1) already fence the well on the upper floors.
// Pure and deterministic: node tools/upper-floors/old-eden-office.mjs <out-dir> writes office.fact.json + office.spots.json.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const r3 = (v) => Math.round(v * 1000) / 1000;
const BUILDING = 'eden-office-1';
/** Engine levels 11/12 (level 1 is the commons deck); placeLevel = the floor numbers places.v1 uses. */
export const OFFICE_LEVELS = [{ id: 11, y: 3.1, label: 'Office first floor', placeLevel: 1 }, { id: 12, y: 6.1, label: 'Office second floor', placeLevel: 2 }];
const box = (id, x0, z0, x1, z1, y0, y1, label, kind = 'fixture') => ({ id, obb: { c: [r3((x0 + x1) / 2), r3((z0 + z1) / 2)], half: [r3((x1 - x0) / 2), r3((z1 - z0) / 2)], yaw: 0 }, y0, y1, kind, label });
const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

/** One storey's dog-leg flight from floor height `base` (0.1 ground, 3.1 first floor) as tread-centre points. */
function flight(base) {
  const pts = [];
  for (let i = 0; i < 8; i++) pts.push([87.6, r3(base + (i + 1) * 0.2), r3(16.2 - i * 0.28)]);          // lower flight, northwards
  pts.push([87.6, r3(base + 1.6), 13.8], [88.6, r3(base + 1.6), 13.8]);                                    // turn landing
  for (let i = 0; i < 7; i++) pts.push([88.6, r3(base + 1.6 + (i + 1) * 0.2), r3(14.24 + i * 0.28)]);   // upper flight, southwards
  pts.push([88.6, r3(base + 3), 16.28]);                                                                   // exit landing
  return pts;
}

export function officeFact() {
  const surfaces = [], solids = [];
  for (const l of OFFICE_LEVELS) {
    const s = (id, x0, z0, x1, z1) => surfaces.push({ id: `f${l.id}-${id}`, level: l.id, y: l.y, obb: { c: [r3((x0 + x1) / 2), r3((z0 + z1) / 2)], half: [r3((x1 - x0) / 2), r3((z1 - z0) / 2)], yaw: 0 }, label: `${l.label} (${id})` });
    // the floor slab round the stair well (the well itself stays open; its guards are the live office-stair-guards/1)
    s('north', 86.2, 11.2, 97.8, 13.5); s('south', 86.2, 16.5, 97.8, 18.8); s('west', 86.2, 13.5, 87.2, 16.5); s('east', 89, 13.5, 97.8, 16.5);
    const y = l.y;
    // the two desks every floor has (eden-interiors existing.ts: a desk top with its lamp and the cabinet at its east end;
    // the chairs south of them stay free: they are the workstation seats)
    solids.push(box(`desk-a-${l.id}`, 90.2, 14.8, 93.1, 15.4, y, y + 1.5, 'Desk'), box(`desk-b-${l.id}`, 93.3, 14.8, 96.2, 15.4, y, y + 1.5, 'Desk'));
    if (l.id === 11) {
      // the artists' studio: four easels on the north side, a plan chest on the east wall, a paint trolley; plants
      for (const [k, x] of [90.6, 92.4, 94.2, 96].entries()) solids.push(box(`easel-${k + 1}`, x - 0.35, 12.1, x + 0.35, 12.65, y, y + 1.8, 'Easel'));
      solids.push(box('plan-chest', 97.15, 13.8, 97.8, 16.2, y, y + 0.8, 'Plan chest'), box('paint-trolley', 95.5, 13.35, 96.1, 13.85, y, y + 0.9, 'Paint trolley'),
        box('plant-n-11', 97.05, 11.25, 97.75, 11.95, y, y + 1.6, 'Plant'), box('plant-s-11', 97.07, 18.07, 97.75, 18.73, y, y + 1.2, 'Plant'));
    } else {
      // the top floor's corner lounge: a sofa against the south wall, an armchair beside it (their seats stay free to sit on)
      solids.push(box('sofa-back', 95.7, 18.45, 97.5, 18.8, y, y + 0.9, 'Sofa'), box('armchair-back', 94.2, 18.5, 95.0, 18.8, y, y + 0.9, 'Armchair'));
    }
    // the stair well's flight from this floor up, below the next floor (nothing walks through it; the floor above has no well floor)
    if (l.id === 11) solids.push(box('stair-well-11', 87.2, 13.5, 89, 16.4, y, y + 2.9, 'Stair flight', 'solid'));
  }
  // the ground floor's flight: solid for walking on the ground floor (heads hit its underside)
  solids.push(box('stair-well-0', 87.2, 13.5, 89, 16.4, 0, 3.0, 'Stair flight', 'solid'));
  const link = (id, fromLevel, fromY, toLevel, toY, base) => ({
    id, kind: 'stairs', from: { level: fromLevel, p: [87.6, 16.9], y: fromY }, to: { level: toLevel, p: [88.6, 16.9], y: toY }, width: 0.8,
    heading: -Math.PI / 2, path: flight(base), usable: true, faceAlong: true,
    // both ends are entered heading north into the well (a dog-leg): the top is approached from the south, not the heading's back
    approach: { from: [87.6, 17.6], to: [88.6, 17.6] },
  });
  return {
    version: 'upper-floors/1',
    building: {
      id: BUILDING, label: 'Office building', crop: [86, 11, 98, 19], levels: OFFICE_LEVELS, surfaces, solids,
      links: [link('stairs-ground-first', 0, 0, 11, 3.1, 0.1), link('stairs-first-second', 11, 3.1, 12, 6.1, 3.1)],
      // the rooms, with the ids and outlines places.v1 gives them (their floors there are 1 and 2)
      regions: [
        { id: 'eden-office-1-floor-1', label: 'Office first floor', level: 11, polygon: rect(86, 11, 98, 19) },
        { id: 'eden-office-1-floor-2', label: 'Office second floor', level: 12, polygon: rect(86, 11, 98, 19) },
        { id: 'int-office-studio', label: 'Artists’ studio', level: 11, polygon: rect(89.6, 11.2, 97.8, 14.6) },
        { id: 'int-office-upper-lounge', label: 'Upper lounge', level: 12, polygon: rect(93.6, 16.6, 97.8, 18.8) },
      ],
    },
  };
}

/** Upstairs activity spots (activity-spots/1 entries with `level`): paint at the studio easels, use the computers on both
 *  upper floors, read on the top-floor lounge sofa and armchair. */
export function officeSpots() {
  const spots = [];
  // (the fourth painter stands a little east: the paint trolley stands south of that easel)
  for (const [k, x] of [90.6, 92.4, 94.2, 96].entries()) spots.push({ id: `office-studio-easel-${k + 1}`, place: 'int-office-studio', activity: 'paint', base: 'idle', at: k === 3 ? [96.55, 13.1] : [x, 13.25], faceTo: [x, 12.4], level: 11, label: `Studio easel ${k + 1} (office first floor)` });
  for (const l of OFFICE_LEVELS) for (const [k, x] of [91.15, 94.25].entries())
    spots.push({ id: `pc-office-${l.placeLevel}-${k + 1}`, place: `eden-office-1-floor-${l.placeLevel}`, activity: 'use-computer', base: 'sit', at: [x, 15.95], faceTo: [x, 15.1], seatHeight: 0.57, level: l.id, label: `Office workstation ${k + 1} (${l.label.toLowerCase().replace('office ', '')})` });
  spots.push({ id: 'office-upper-sofa', place: 'int-office-upper-lounge', activity: 'read', base: 'sit', at: [96.6, 18.0], faceTo: [96.6, 17.0], seatHeight: 0.45, level: 12, label: 'Upper lounge sofa' },
    { id: 'office-upper-armchair', place: 'int-office-upper-lounge', activity: 'read', base: 'sit', at: [94.6, 18.05], faceTo: [94.6, 17.0], seatHeight: 0.45, level: 12, label: 'Upper lounge armchair' });
  return spots;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2]; if (!out) { console.error('usage: old-eden-office.mjs <out-dir>'); process.exit(2); }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'office.fact.json'), JSON.stringify(officeFact(), null, 1) + '\n');
  writeFileSync(join(out, 'office.spots.json'), JSON.stringify(officeSpots(), null, 1) + '\n');
  console.log(join(out, 'office.fact.json'), join(out, 'office.spots.json'));
}

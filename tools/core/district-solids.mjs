#!/usr/bin/env node
// CN5 (Core, provisional until World publishes them in activity-spots `solids`): obstacle boxes for the districts CN5 makes
// walkable (harbour strip/boardwalk/piers/beach, artists' village, old-town plaza and market street). Building bodies come
// from World's own eden-regions FOOTPRINTS (built headlessly from a World checkout); the large props (mural wall, fountain,
// arcade columns, stalls, kiosks, huts, cafe tables, planters, benches) are surveyed from the same builder source.
// Usage: node tools/core/district-solids.mjs <world-checkout> > tools/core/eden-district-solids.v1.json
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const root = resolve(process.argv[2] ?? '.'), dir = resolve(root, 'mars/viewer/app/engine-view/content/assets/eden-regions');
const regions = await import(resolve(dir, 'index.ts'));
regions.createEdenRegions(() => 0);
const r3 = n => Math.round(n * 1000) / 1000;
/** The district ground CN5 admits (must match apps/server/src/edge/ledger/districts.ts CN5_DISTRICT_GROUND). */
const AREAS = [[-29.5, 126, 106, 137], [-40, 136.4, 100, 141.3], [8.4, 141.3, 11.6, 167.5], [60.4, 141.3, 63.6, 175.5], [-100, 134, -29.5, 139], [-104, -74, 30, -64], [-104, -128, -46, -72], [104, 57.8, 172, 112], [84, -34, 100, -29.5]];
const near = (c, half) => AREAS.some(([x0, z0, x1, z1]) => c[0] + half < x1 + 0.5 && c[0] - half > x0 - 0.5 && c[1] + half < z1 + 0.5 && c[1] - half > z0 - 0.5) || AREAS.some(([x0, z0, x1, z1]) => c[0] > x0 - half && c[0] < x1 + half && c[1] > z0 - half && c[1] < z1 + half);
const solids = [], add = (id, label, c, half, yaw = 0, height = 2) => {if (near(c, Math.max(...half))) solids.push({id, label, c: [r3(c[0]), r3(c[1])], half: [r3(half[0]), r3(half[1])], yaw: r3(yaw), height});};

// building bodies (houses, A-frames, towers) as World built them: oriented boxes from their four corners
regions.FOOTPRINTS.forEach((f, i) => {
  const [a, b, c] = f.corners, cx = (f.corners[0][0] + f.corners[2][0]) / 2, cz = (f.corners[0][1] + f.corners[2][1]) / 2;
  add(`district-building-${i}`, `District building (${f.kind})`, [cx, cz], [Math.hypot(b[0] - a[0], b[1] - a[1]) / 2, Math.hypot(c[0] - b[0], c[1] - b[1]) / 2], Math.atan2(b[1] - a[1], b[0] - a[0]), 6);
});
// artists' village (north.ts buildArtists)
add('arts-mural-wall', 'Mural wall along the avenue', [-76, -72.8], [26, 0.2], 0, 2.6);
add('arts-sculpture', 'Village green sculpture', [-74, -98], [1.6, 1.6], 0, 4);
for (let i = 0; i < 4; i++) add(`arts-craft-stall-${i + 1}`, 'Craft market stall', [-80 + i * 4, -85.5], [1.5, 1], 0, 2.4);
for (let i = 0; i < 3; i++) add(`arts-picnic-table-${i + 1}`, 'Picnic table', [-78 + i * 4, -103.5], [0.9, 0.8], 0, 0.8);
// harbour (south.ts buildHarbour)
for (let x = -98, i = 0; x < -46; x += 4.2, i++) add(`harbour-beach-hut-${i + 1}`, 'Bathing hut', [x, 134.5], [1.2, 1.1], 0, 2.6);
for (const [x, n] of [[-30, 1], [44, 2], [84, 3]]) add(`harbour-kiosk-${n}`, 'Seafront kiosk', [x, 133.2], [1.5, 1], 0, 2.4);
for (let x = -36, i = 0; x < 100; x += 12, i++) add(`harbour-boardwalk-bench-${i + 1}`, 'Boardwalk bench', [x, 137.3], [0.8, 0.22], 0, 0.9);
// old town (canal-quarter.ts buildOldTown, country.ts buildTownLife)
const bays = Math.round((158 - 120) / 3.6), bw = (158 - 120) / bays;
for (let i = 0; i <= bays; i++) {add(`oldtown-north-arcade-column-${i}`, 'North arcade column', [120 + i * bw, 60.5], [0.28, 0.28], 0, 3.4); add(`oldtown-south-arcade-column-${i}`, 'South arcade column', [120 + i * bw, 85.5], [0.28, 0.28], 0, 3.4);}
add('oldtown-south-arcade', 'South arcade building', [139, 89.5], [19, 1.2], 0, 7.2);
add('oldtown-fountain-a', 'Plaza fountain', [139, 73], [2.96, 2.96], 0, 0.6); add('oldtown-fountain-b', 'Plaza fountain', [139, 73], [2.96, 2.96], Math.PI / 4, 0.6);
for (const [x, z] of [[125, 66], [125, 80], [153, 66], [153, 80]]) add(`oldtown-planter-${x}-${z}`, 'Tree planter', [x, z], [1.05, 1.05], 0, 0.7);
for (const [x, z] of [[133, 68], [145, 68], [133, 78], [145, 78]]) add(`oldtown-bench-${x}-${z}`, 'Plaza bench', [x, z], [0.8, 0.22], 0, 0.9);
for (let x = 114, i = 0; x < 166; x += 4.4, i++) add(`oldtown-market-stall-${i + 1}`, 'Market street stall', [x, 93.6], [1.7, 1], 0, 2.4);
add('oldtown-domed-hall', 'Domed hall (plinth and walls)', [166, 73], [7.5, 6.5], 0, 8);
add('oldtown-domed-hall-front', 'Domed hall front wall', [158.4, 73], [0.25, 6], 0, 7.4);
for (const z of [68.5, 71.5, 74.5, 77.5]) add(`oldtown-domed-hall-column-${z}`, 'Domed hall portico column', [157.3, z], [0.38, 0.38], 0, 6.6);
for (let i = 0; i < 6; i++) for (const z of [65, 81]) add(`oldtown-cafe-table-${i + 1}-${z}`, 'Cafe table and chairs', [128 + i * 4.4, z], [0.95, 0.95], 0, 0.9);
for (let x = 122; x < 158; x += 6) for (const z of [62.6, 83.4]) add(`oldtown-flower-planter-${x}-${z}`, 'Flower planter', [x, z], [0.5, 0.25], 0, 0.7);

const src = ['index.ts', 'north.ts', 'south.ts', 'canal-quarter.ts', 'country.ts', 'buildings.ts'].map(f => readFileSync(resolve(dir, f)));
process.stdout.write(JSON.stringify({contract: 'activity-spots/1', world: 'eden',
  note: `Core CN5 provisional district solids (descriptor nav.extraSolids) until World adds them to its activity-spots solids: building bodies from eden-regions FOOTPRINTS plus props surveyed from the builders. Source sha256 ${createHash('sha256').update(Buffer.concat(src)).digest('hex').slice(0, 16)}. Regenerate: node tools/core/district-solids.mjs <world checkout>.`,
  spots: [], shelves: [], interiors: [], rings: [], solids}, null, 1) + '\n');

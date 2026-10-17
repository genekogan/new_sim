#!/usr/bin/env node
// One-off source extraction (lane E-look, 2026-10-17): old /w/eden's night lights and street clutter, viewer-only scenery
// there — eden-regions LIGHTS (district lamps, window and door lights), eden-street-details lamps and lanterns, and
// eden-street-props placements — written to old-props.json for the eden-2026 genesis (gaps V9, V3).
// Run: node tools/god-skill/scripts/eden-2026/extract-old-props.mts
import { writeFileSync } from 'node:fs';
const C = new URL('../../../../mars/viewer/app/engine-view/content/assets/', import.meta.url).pathname;
const { createEdenRegions } = await import(C + 'eden-regions/index.ts');
const { LIGHTS } = await import(C + 'eden-regions/buildings.ts');
const { EDEN_STREET_DETAILS_PLAN: D } = await import(C + 'eden-expansion-assets/eden-street-details.ts');
const { STREET_PROP_PLACEMENTS } = await import(C + 'eden-street-props/placements.ts');
createEdenRegions(() => 0);
const kinds: Record<string, number> = {};
for (const l of LIGHTS) kinds[l[3]] = (kinds[l[3]] ?? 0) + 1;
const out = {
  source: 'eden-regions LIGHTS, eden-street-details plan, eden-street-props placements (old /w/eden viewer scenery)',
  regionLights: LIGHTS.map(([x, y, z, k, s]: any) => [k, x, y, z, s]),
  streetLamps: D.lamps, parkLamps: D.parkLamps, parkLanterns: D.parkLanterns,
  props: Object.fromEntries(Object.entries(STREET_PROP_PLACEMENTS).map(([k, v]: any) => [k, v.map((p: any) => [p[0], p[1], +(p[2] ?? 0).toFixed(3)])])),
};
writeFileSync(new URL('./old-props.json', import.meta.url), JSON.stringify(out) + '\n');
console.log('region lights', LIGHTS.length, kinds, 'street lamps', D.lamps.length, 'park', D.parkLamps.length, D.parkLanterns.length);

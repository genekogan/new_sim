#!/usr/bin/env node
// Fork descriptors (lane FORKS) from Codex's old-world descriptors (eden2 /srv/sim-old/current/descriptors/<world>.json):
// drop the per-process fields the launcher supplies, point the sealed artifacts at <artifacts>/, and use this release's
// edge skill and instructions. Writes <out>/<world>.json for eden, mars, littlemartians.
//   node tools/world-launcher/deploy/forks/descriptors.mjs <codex-descriptors-dir> <artifacts-dir> <out-dir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
const [src, art, out] = process.argv.slice(2);
if (!src || !art?.startsWith('/') || !out) { console.error('usage: descriptors.mjs <codex-dir> <abs artifacts-dir> <out-dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });
const DROP = ['input', 'dataDir', 'port', 'build', 'webDir', 'publicOrigin', 'inputManifestSHA256', 'accountRegistryPath', 'cliFile'];
for (const w of ['eden', 'mars', 'littlemartians']) {
  const d = JSON.parse(readFileSync(join(src, `${w}.json`), 'utf8'));
  for (const k of DROP) delete d[k];
  d.worldKey = w;
  for (const k of ['placeData', 'marsWebDir', 'authoredBoundariesFile', 'activitySpots']) if (d[k]) d[k] = join(art, basename(d[k]));
  d.skillFile = 'tools/edge-skill/SKILL.md'; d.instructionsFile = 'tools/edge-skill/INSTRUCTIONS.md';
  writeFileSync(join(out, `${w}.json`), JSON.stringify(d, null, 2) + '\n');
  console.log(`${w}: ${join(out, `${w}.json`)} (worldId ${d.worldId})`);
}

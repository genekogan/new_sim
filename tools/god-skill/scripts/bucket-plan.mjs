#!/usr/bin/env node
// VOCAB-MECH: the storage-bucket plan for catalogue assets (R2 or S3). DRY RUN ONLY: it reads the asset indexes and
// prints/writes the layout, headers and the commands an operator would run; it never uploads, never reads credentials.
//
//   node tools/god-skill/scripts/bucket-plan.mjs [--bucket eden-assets] [--asset-dir <ASSET_DIR>] [--out .lane/bucket-plan.json]
//
// Layout (content-addressed, so every object is immutable and shared by every world and box):
//   assets/<sha[0:2]>/<sha>.<ext>     GLB / PNG / JPG / footprint JSON   Cache-Control: public, max-age=31536000, immutable
//   thumbs/<defhash>.png              def thumbnails                     same
//   meta/<sha>.json                   the store's measured facts (tris, bytes, box, clips) — what /v1/god/assets/<sha> serves
// The viewer would then fetch `${ASSET_BASE_URL}/assets/<sha[0:2]>/<sha>.glb` (one env var on the server, echoed in
// /v1/config; gltf-assets.ts assetUrl) with the box's /assets/<sha>.<ext> as the fallback. Nothing in a def changes:
// defs name assets by sha only.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const bucket = String(args.bucket ?? 'eden-assets');
const TYPES = { glb: 'model/gltf-binary', png: 'image/png', jpg: 'image/jpeg', json: 'application/json' };
const IMMUTABLE = 'public, max-age=31536000, immutable';
const objects = [];
const add = (key, file, ext, bytes, source) => objects.push({ key, file, contentType: TYPES[ext] ?? 'application/octet-stream', cacheControl: IMMUTABLE, bytes, source });

// core assets (repo files, every box)
for (const idx of ['worlds/core-assets/index.json', 'worlds/core-assets/littlemartians-two.index.json']) {
  const f = join(root, idx); if (!existsSync(f)) continue;
  for (const [sha, m] of Object.entries(JSON.parse(readFileSync(f, 'utf8')).assets ?? {})) {
    const file = m.path ? join(root, m.path) : null;
    add(`assets/${sha.slice(0, 2)}/${sha}.${m.ext}`, file, m.ext, m.bytes ?? (file && existsSync(file) ? statSync(file).size : 0), idx);
  }
}
for (const t of existsSync(join(root, 'worlds/core-assets/thumbs')) ? readdirSync(join(root, 'worlds/core-assets/thumbs')) : []) if (/^[0-9a-f]{64}\.png$/.test(t)) add(`thumbs/${t}`, join(root, 'worlds/core-assets/thumbs', t), 'png', statSync(join(root, 'worlds/core-assets/thumbs', t)).size, 'core thumbs');
// a box's uploaded assets (ASSET_DIR: <sha>.<ext> + <sha>.meta.json), when given
if (args['asset-dir']) {
  const dir = resolve(String(args['asset-dir']));
  for (const f of readdirSync(dir)) {
    const m = /^([0-9a-f]{64})\.(glb|png|jpg|json)$/.exec(f); if (!m) continue;
    add(`assets/${m[1].slice(0, 2)}/${f}`, join(dir, f), m[2], statSync(join(dir, f)).size, 'asset dir');
    if (existsSync(join(dir, `${m[1]}.meta.json`))) add(`meta/${m[1]}.json`, join(dir, `${m[1]}.meta.json`), 'json', statSync(join(dir, `${m[1]}.meta.json`)).size, 'asset dir');
  }
}
const seen = new Set(), unique = objects.filter((o) => !seen.has(o.key) && seen.add(o.key));
const bytes = unique.reduce((a, o) => a + (o.bytes || 0), 0);
const plan = {
  dryRun: true, bucket, objects: unique.length, bytes, mb: +(bytes / 1e6).toFixed(1),
  headers: { 'Cache-Control': IMMUTABLE, 'Content-Type': 'per extension', 'Access-Control-Allow-Origin': '*' },
  // what an operator would run (rclone or aws-cli; R2 is S3-compatible). Shown, never executed.
  commands: unique.slice(0, 3).map((o) => `aws s3 cp ${o.file ?? '<file>'} s3://${bucket}/${o.key} --content-type ${o.contentType} --cache-control '${IMMUTABLE}' --endpoint-url $R2_ENDPOINT   # ${o.bytes} bytes`).concat(unique.length > 3 ? [`… ${unique.length - 3} more (same form)`] : []),
  skipExisting: 'keys are content hashes: HEAD the key and skip when it exists (never overwrite, never delete)',
  server: 'ASSET_BASE_URL=https://<bucket-domain> → /v1/config.assetBase → gltf-assets.ts assetUrl(sha) = `${assetBase}/assets/${sha.slice(0,2)}/${sha}.glb`, falling back to /assets/<sha>.glb on error',
  sample: unique.slice(0, 5).map(({ key, contentType, bytes: b }) => ({ key, contentType, bytes: b })),
};
console.log(JSON.stringify({ ...plan, commands: plan.commands }, null, 1));
if (args.out) writeFileSync(resolve(String(args.out)), JSON.stringify({ ...plan, all: unique.map(({ key, bytes: b, contentType, source }) => ({ key, bytes: b, contentType, source })) }, null, 1));

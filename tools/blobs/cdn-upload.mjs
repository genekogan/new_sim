#!/usr/bin/env node
// Lane BLOBS: upload the content-addressed blob store to a CDN bucket (Cloudflare R2, S3 API) — DRY RUN by default.
//   node tools/blobs/cdn-upload.mjs <storeDir e.g. /srv/sim-blobs> [--bucket eden-assets] [--remote r2] [--apply]
// Plans one object per store file: key = assets/<sha[0:2]>/<sha>.<ext> (the CATALOG-PROGRAM bucket layout, the same
// relative path as on eden2), Content-Type by extension, Cache-Control immutable. Precompressed sidecars (.br/.zst/.gz)
// are NOT uploaded: the CDN compresses at the edge (see docs/god/CDN.md). Every file is re-hashed and must equal its
// name. --apply runs `rclone copyto` per object against an rclone remote that Gene configures (credentials live only in
// rclone's own config / env, never in this repo); objects already present with the same size are skipped by rclone.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const store = args.find((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--'));
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const bucket = opt('bucket', 'eden-assets'), remote = opt('remote', 'r2'), apply = args.includes('--apply');
if (!store) { console.error('usage: cdn-upload.mjs <storeDir> [--bucket b] [--remote r] [--apply]'); process.exit(2); }
const TYPES = { '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.wasm': 'application/wasm', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ktx2': 'image/ktx2' };
const CACHE = 'public, max-age=31536000, immutable';
const plan = [];
for (const dir of readdirSync(join(store, 'assets')).filter((d) => /^[0-9a-f]{2}$/.test(d)).sort()) {
  for (const name of readdirSync(join(store, 'assets', dir)).sort()) {
    const m = name.match(/^([0-9a-f]{64})(\.[a-z0-9]+)$/); if (!m) continue;             // skips .br/.zst/.gz sidecars
    const file = join(store, 'assets', dir, name), sha = createHash('sha256').update(readFileSync(file)).digest('hex');
    if (sha !== m[1] || dir !== sha.slice(0, 2)) throw Error('store file does not match its name: ' + file);
    plan.push({ key: `assets/${dir}/${name}`, file, bytes: statSync(file).size, contentType: TYPES[m[2]] || 'application/octet-stream', cacheControl: CACHE });
  }
}
const total = plan.reduce((n, p) => n + p.bytes, 0);
const out = { bucket, remote, apply, objects: plan.length, bytes: total, plan };
writeFileSync(join(process.cwd(), `cdn-plan-${Date.now()}.json`), JSON.stringify(out, null, 1));
for (const p of plan) {
  const cmd = ['copyto', p.file, `${remote}:${bucket}/${p.key}`, '--header-upload', `Content-Type: ${p.contentType}`, '--header-upload', `Cache-Control: ${p.cacheControl}`, '--s3-no-check-bucket'];
  if (apply) execFileSync('rclone', cmd, { stdio: 'inherit' }); else console.log('DRY rclone ' + cmd.map((c) => (/\s/.test(c) ? JSON.stringify(c) : c)).join(' '));
}
console.log(JSON.stringify({ bucket, objects: plan.length, MB: +(total / 1e6).toFixed(1), apply }));

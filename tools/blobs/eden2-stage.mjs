#!/usr/bin/env node
// Lane BLOBS, runs ON eden2 (node 22, no deps): stage verified static blobs into the content-addressed store
// that Caddy serves. Input (stdin): TSV lines `<sha256>\t<publicPath>\t<srcFile>`; each srcFile must hash to sha256.
//   /srv/sim-blobs/assets/<sha[0:2]>/<sha>.<ext>            the bytes (immutable; the CATALOG-PROGRAM bucket layout)
//   /srv/sim-blobs/assets/<sha[0:2]>/<sha>.<ext>.{br,zst,gz} precompressed sidecars for compressible types
//   /srv/sim-blobs/legacy/<publicPath>(+sidecars)           hardlinks: un-hashed public names, short max-age + ETag
// Idempotent: an existing store file is re-hashed and kept; never deletes anything.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, linkSync, unlinkSync, statSync, chmodSync, renameSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const ROOT = process.env.BLOBS_ROOT || '/srv/sim-blobs';
const COMPRESSIBLE = new Set(['.glb', '.gltf', '.bin', '.wasm', '.js', '.json', '.svg']);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const put = (path, bytes) => { mkdirSync(dirname(path), { recursive: true, mode: 0o755 }); const tmp = path + '.tmp' + process.pid; writeFileSync(tmp, bytes, { mode: 0o644 }); renameSync(tmp, path); };
const link = (from, to) => { mkdirSync(dirname(to), { recursive: true, mode: 0o755 }); if (existsSync(to)) { if (statSync(to).ino === statSync(from).ino) return; unlinkSync(to); } linkSync(from, to); };
const rows = readFileSync(0, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t'));
const out = [];
for (const [want, pub, src] of rows) {
  const storeOnly = pub.startsWith('-.'); // `-.glb`: content-addressed store only, no legacy name
  if (!/^[a-f0-9]{64}$/.test(want) || !(storeOnly || /^\/[A-Za-z0-9_./-]+$/.test(pub)) || pub.includes('..')) throw Error('bad row ' + pub);
  const ext = extname(storeOnly ? 'x' + pub.slice(1) : pub).toLowerCase(); const store = join(ROOT, 'assets', want.slice(0, 2), want + ext);
  if (!existsSync(store)) { const b = readFileSync(src); if (sha(b) !== want) throw Error('source hash differs: ' + src); put(store, b); }
  else if (sha(readFileSync(store)) !== want) throw Error('store hash differs: ' + store);
  const side = [];
  if (COMPRESSIBLE.has(ext) && statSync(store).size >= 1024) {
    const b = readFileSync(store);
    if (!existsSync(store + '.br')) put(store + '.br', brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: b.length } }));
    if (!existsSync(store + '.gz')) put(store + '.gz', gzipSync(b, { level: 9 }));
    if (!existsSync(store + '.zst')) execFileSync('zstd', ['-19', '-T4', '-q', '-f', store, '-o', store + '.zst']), chmodSync(store + '.zst', 0o644);
    side.push('.br', '.gz', '.zst');
  }
  if (!storeOnly) { link(store, join(ROOT, 'legacy', pub)); for (const s of side) link(store + s, join(ROOT, 'legacy', pub) + s); }
  out.push({ pub, store: store.slice(ROOT.length), bytes: statSync(store).size, ...Object.fromEntries(side.map((s) => [s.slice(1), statSync(store + s).size])) });
}
writeFileSync(join(ROOT, `STAGED-${Date.now()}.json`), JSON.stringify({ at: new Date().toISOString(), files: out }, null, 1));
console.log(JSON.stringify({ staged: out.length, bytes: out.reduce((n, r) => n + r.bytes, 0), big: out.filter((r) => r.bytes > 1e6).map((r) => [r.pub, r.bytes, r.br, r.zst, r.gz]) }));

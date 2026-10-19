#!/usr/bin/env node
// P1 phones (2026-10-19): precompress the web build's hashed assets once, at release time, so the launcher serves them as
// brotli q11 (.br) or gzip 9 (.gz) without compressing on the request path. Before: Caddy gzip on the fly (Shell 715 KB),
// re-encoded by Cloudflare to br (680 KB); q11 is 551 KB. On a Slow 4G phone (~180 KB/s) that is ~1 s per load.
//   node tools/world-launcher/deploy/precompress.mjs <dist/assets dir>
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

const br = promisify(brotliCompress), gz = promisify(gzip);
export const PRECOMPRESSED = /\.(js|mjs|css|wasm|svg|json|map)$/i;
const dir = process.argv[2];
if (!dir) { console.error('usage: precompress.mjs <assets dir>'); process.exit(2); }
const files = readdirSync(dir).filter((f) => PRECOMPRESSED.test(f) && !/\.map$/i.test(f) && statSync(join(dir, f)).isFile() && statSync(join(dir, f)).size >= 1024);
let raw = 0, brBytes = 0;
await Promise.all(files.map(async (f) => {
  const p = join(dir, f), body = readFileSync(p);
  const [b, g] = await Promise.all([br(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: body.length } }), gz(body, { level: 9 })]);
  if (b.length < body.length) writeFileSync(p + '.br', b);
  if (g.length < body.length) writeFileSync(p + '.gz', g);
  raw += body.length; brBytes += Math.min(b.length, body.length);
}));
console.log(`precompressed ${files.length} files: ${(raw / 1e6).toFixed(1)} MB -> br ${(brBytes / 1e6).toFixed(1)} MB`);

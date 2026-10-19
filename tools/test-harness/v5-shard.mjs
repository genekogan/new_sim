#!/usr/bin/env node
// V5 server-suite shard picker for the fanned-out release gate (modal_suite.py).
//   node v5-shard.mjs <i>/<n> <v5-durations.json>  < all-files.txt  > shard-files.txt
// Splits the sorted file list (stdin, one path per line, relative to apps/server) into n CONTIGUOUS, non-empty slices
// balanced by recorded seconds per file, and prints slice i (1-based). Contiguous slices keep the serial file order, so
// concatenating the n TAP logs in shard order reproduces the serial run's test order (and its duplicate-title ordinals).
// Unknown files weigh the median. Every shard computes the same partition from the same inputs.
// Rebuild the weights from a run:  node v5-shard.mjs --durations <out>/out/groups/v5-*/V5-server-full-files.jsonl > v5-durations.json
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function partition(files, seconds, n) {
  if (!Number.isInteger(n) || n < 1) throw Error(`invalid shard count ${n}`);
  const known = files.map(f => seconds[f]).filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  const fallback = known.length ? known[Math.floor(known.length / 2)] : 1;
  const w = files.map(f => Math.max(Number.isFinite(seconds[f]) ? seconds[f] : fallback, 0.001));
  const k = Math.min(n, files.length);
  const cut = cap => {  // greedy contiguous fill under cap; also cut when the rest is needed to keep every shard non-empty
    const out = [[]]; let sum = 0;
    for (let i = 0; i < files.length; i++) {
      const cur = out.at(-1), left = files.length - i, need = k - out.length;
      if (cur.length && (sum + w[i] > cap || left === need)) { out.push([]); sum = 0; }
      out.at(-1).push(files[i]); sum += w[i];
    }
    return out;
  };
  let lo = Math.max(...w), hi = w.reduce((a, b) => a + b, 0);
  for (let it = 0; it < 60; it++) { const mid = (lo + hi) / 2; if (cut(mid).length <= k) hi = mid; else lo = mid; }
  const shards = cut(hi);
  while (shards.length < n) shards.push([]);
  return shards;
}

/** Seconds per apps/server-relative test file: the sum of its top-level tests' durations (file-reporter events). */
export function durationsFrom(jsonlTexts) {
  const files = {};
  for (const text of jsonlTexts) for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const e = JSON.parse(line);
    if (e.nesting !== 0 || !e.file || typeof e.ms !== 'number') continue;
    const f = e.file.replace(/^file:\/\//, '').replace(/^.*\/apps\/server\//, '');
    files[f] = +((files[f] || 0) + e.ms / 1000).toFixed(2);
  }
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === '--durations') {
  const paths = process.argv.slice(3);
  const files = durationsFrom(paths.map(p => readFileSync(p, 'utf8')));
  process.stdout.write(JSON.stringify({ schemaVersion: 1, source: `${paths.length} shard logs, ${new Date().toISOString().slice(0, 10)}`, files }, null, 2) + '\n');
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [spec, durations] = process.argv.slice(2);
  const m = /^(\d+)\/(\d+)$/.exec(spec || '');
  if (!m || +m[1] < 1 || +m[1] > +m[2]) { console.error('usage: v5-shard.mjs <i>/<n> <v5-durations.json> < files'); process.exit(2); }
  const files = readFileSync(0, 'utf8').split('\n').filter(Boolean);
  const seconds = JSON.parse(readFileSync(durations, 'utf8')).files || {};
  const slice = partition(files, seconds, +m[2])[+m[1] - 1];
  if (!slice.length) { console.error(`shard ${spec} is empty`); process.exit(1); }
  process.stdout.write(slice.join('\n') + '\n');
}

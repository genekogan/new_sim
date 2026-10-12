#!/usr/bin/env node
// CATRUN: retrieval eval for the catalogue (P0 prototype of the hot/cold + embedding design).
//   node tools/catalog/retrieval-eval.mjs [--registry .lane/registry] [--json out.json]
// Scores each paraphrase intent in packages/catalog/eval/intents.json with four retrievers and prints recall@1/@3/@10
// and latency: the server's current lexical `searchDefs` (production today), BM25 over item text, the lsa-1 embedding
// alone, and BM25 + lsa-1 fused by reciprocal rank (what `catalog find` serves).
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { coreLibrary } from '../../packages/world-compiler/src/index.ts';
import { searchDefs, publicRef } from '../../apps/server/src/god/assets.ts';
import { Registry } from '../../packages/catalog/src/registry.ts';
import { buildIndex, docsOf, search, vectorIndex, nearest, rrf, embedText } from '../../packages/catalog/src/embed.ts';
import { execFileSync } from 'node:child_process';
import { idOf } from '../../packages/catalog/src/ids.ts';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : null)).filter(Boolean));
const here = new URL('.', import.meta.url).pathname;
const evalSet = JSON.parse(readFileSync(resolve(here, '../../packages/catalog/eval/intents.json'), 'utf8')).intents;
const reg = new Registry(resolve(args.registry ?? '.lane/registry'));
const docs = docsOf(reg);
const have = new Set(docs.map((d) => d.id.replace(/@\d+$/, '')));
const missing = evalSet.flatMap((e) => e.any.filter((id) => !have.has(id)).map((id) => `${e.q} → ${id}`));
const usable = evalSet.filter((e) => e.any.some((id) => have.has(id)));
const t0 = performance.now(); const idx = buildIndex(docs); const buildMs = performance.now() - t0;
const lib = coreLibrary().all();
const retrievers = {
  'server searchDefs (today)': (q) => searchDefs(lib, q, { limit: 10 }).map((h) => idOf(h.def.name)),
  'bm25': (q) => search(idx, q, { k: 10, mode: 'lexical' }).map((h) => h.id.replace(/@\d+$/, '')),
  'lsa-1 embedding': (q) => search(idx, q, { k: 10, mode: 'semantic' }).map((h) => h.id.replace(/@\d+$/, '')),
  'fused (bm25 + lsa-1)': (q) => search(idx, q, { k: 10, mode: 'fused' }).map((h) => h.id.replace(/@\d+$/, '')),
};
// --nl: macOS's built-in sentence embedding (NLEmbedding, 512-d; no download): what a pretrained model adds
if (args.nl) {
  const swift = resolve(here, 'embed/nl-embed.swift');
  const embed = (texts) => JSON.parse(execFileSync('swift', [swift], { input: JSON.stringify(texts), maxBuffer: 1 << 28 }).toString()).vectors;
  const t1 = performance.now();
  const vi = vectorIndex('nl-sentence-en', docs.map((d) => d.id.replace(/@\d+$/, '')), embed(docs.map(embedText)));
  const qv = new Map(usable.map((e, i) => [e.q, i])); const qvecs = embed(usable.map((e) => e.q));
  console.log(`nl index: ${docs.length} items x ${vi.dim}-d in ${Math.round(performance.now() - t1)} ms`);
  retrievers['nl sentence embedding'] = (q) => nearest(vi, qvecs[qv.get(q)], 10).map((h) => vi.ids[h.i]);
  retrievers['fused (bm25 + nl)'] = (q) => rrf([{ ids: search(idx, q, { k: 200, mode: 'lexical' }).map((h) => h.id.replace(/@\d+$/, '')) }, { ids: nearest(vi, qvecs[qv.get(q)], 200).map((h) => vi.ids[h.i]) }]);
}
const out = { items: docs.length, intents: usable.length, missingIds: missing, index: { model: idx.model, dim: idx.dim, features: idx.feats.length, bytes: idx.bytes, buildMs: Math.round(buildMs) }, results: {} };
for (const [name, fn] of Object.entries(retrievers)) {
  let r1 = 0, r3 = 0, r10 = 0; const ms = []; const misses = [];
  for (const e of usable) { const t = performance.now(); const got = fn(e.q); ms.push(performance.now() - t); const rank = got.findIndex((id) => e.any.includes(id)); if (rank === 0) r1++; if (rank >= 0 && rank < 3) r3++; if (rank >= 0) r10++; else misses.push(`${e.q} → ${got.slice(0, 3).join(', ')}`); }
  ms.sort((a, b) => a - b);
  out.results[name] = { 'recall@1': +(r1 / usable.length).toFixed(3), 'recall@3': +(r3 / usable.length).toFixed(3), 'recall@10': +(r10 / usable.length).toFixed(3), p50ms: +ms[Math.floor(ms.length / 2)].toFixed(2), p95ms: +ms[Math.floor(ms.length * 0.95)].toFixed(2), misses: misses.slice(0, 12) };
}
console.log(`items ${out.items}, intents ${out.intents} (${missing.length} listed ids absent), index ${idx.model} ${idx.dim}-d ${idx.feats.length} features ${(idx.bytes / 1e6).toFixed(2)} MB built in ${out.index.buildMs} ms`);
for (const [name, r] of Object.entries(out.results)) console.log(`${name.padEnd(28)} R@1 ${r['recall@1'].toFixed(2)}  R@3 ${r['recall@3'].toFixed(2)}  R@10 ${r['recall@10'].toFixed(2)}  p50 ${r.p50ms} ms  p95 ${r.p95ms} ms`);
if (args.json) writeFileSync(args.json, JSON.stringify(out, null, 1));

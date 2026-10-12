#!/usr/bin/env node
// Focused synthetic retrieval probe, not a GPU/world benchmark. No registry writes or model calls.
import { writeFileSync } from 'node:fs';
import { buildLexicalIndex, lexical } from '../../packages/catalog/src/embed.ts';
const count = Number(process.argv[2] ?? 10000), out = process.argv[3] ?? '.lane/retrieval-scale.json';
const nouns = ['bench', 'chair', 'lamp', 'boat', 'tree', 'fountain', 'table', 'bicycle', 'basket', 'sign'];
const docs = Array.from({ length: count }, (_, i) => ({ id: `eden/fixture-${i}@1`, title: `Garden ${nouns[i % nouns.length]} item${i}`,
  synonyms: [`wooden ${nouns[i % nouns.length]}`, `outdoor ${nouns[i % nouns.length]}`, `fixture${i}`], category: i % 2 ? 'object.decor' : 'furniture.seat',
  affords: i % 10 === 0 ? ['sit'] : [], first: `A small ${nouns[i % nouns.length]} for a public garden.`, description: 'Synthetic catalogue-scale fixture, never published.' }));
const start = performance.now(), index = buildLexicalIndex(docs), buildMs = performance.now() - start;
const queries = ['garden bench', 'wooden chair', 'outdoor boat', 'public garden', 'sit', ...Array.from({ length: 30 }, (_, i) => `fixture${i * 317}`)];
const times = [];
for (let repeat = 0; repeat < 5; repeat++) for (const query of queries) {
  const before = performance.now(); lexical(index, query).slice(0, 10); times.push(performance.now() - before);
}
times.sort((a, b) => a - b);
const report = { synthetic: true, count, noModelCalls: true, buildMs, queries: times.length, p50Ms: times[Math.floor(times.length * 0.5)], p95Ms: times[Math.floor(times.length * 0.95)], maxMs: times.at(-1), searchVectors: index.V.length };
writeFileSync(out, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));

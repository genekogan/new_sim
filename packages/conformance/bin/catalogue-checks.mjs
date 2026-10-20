#!/usr/bin/env node
// The catalogue's G2 (budgets) and G3 (placement) checks over the whole core library (src/catalogue-checks.ts).
//   node packages/conformance/bin/catalogue-checks.mjs [--out report.json] [--tsv fails.tsv]
// Prints the counts; exits 1 when a failure is not in src/catalogue-holds.json (the recorded, reasoned holds).
import { readFileSync, writeFileSync } from 'node:fs';
import { catalogueChecks } from '../src/catalogue-checks.ts';
const args = process.argv.slice(2), flag = (k) => { const i = args.indexOf(`--${k}`); return i < 0 ? undefined : args[i + 1]; };
const rows = await catalogueChecks();
const holds = JSON.parse(readFileSync(new URL('../src/catalogue-holds.json', import.meta.url), 'utf8')).G2;
const g2 = rows.filter((r) => !r.g2.ok), g3 = rows.filter((r) => !r.g3.ok);
const unheld = g2.filter((r) => !holds[r.ref]);
const fixed = Object.keys(holds).filter((ref) => !g2.some((r) => r.ref === ref));
const out = flag('out'), tsv = flag('tsv');
if (out) writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), items: rows.length, g2: g2.length, g3: g3.length, rows }, null, 1));
if (tsv) writeFileSync(tsv, [...g2.map((r) => `G2\t${r.ref}\t${r.how}\t${r.g2.numbers.drawnFar}\t${r.g2.numbers.triCap}\t${r.g2.numbers.draws}\t${holds[r.ref]?.why ?? 'NOT HELD'}\t${r.g2.errors.join('; ')}`), ...g3.map((r) => `G3\t${r.ref}\t${r.how}\t\t\t\t\t${r.g3.errors.join('; ')}`)].join('\n') + '\n');
console.log(JSON.stringify({ items: rows.length, g2: g2.length, g2Held: g2.length - unheld.length, g2Unheld: unheld.map((r) => r.ref), holdsNowPassing: fixed, g3: g3.length, g3Refs: g3.map((r) => r.ref) }));
process.exit(unheld.length || g3.length ? 1 : 0);

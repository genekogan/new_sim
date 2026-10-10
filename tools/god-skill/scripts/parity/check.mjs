#!/usr/bin/env node
// Apply a genesis/1 template batch by batch through /v1/god/act on a fresh scratch world and report
// each batch's verdict (the first refusal with its detail), entity counts and warnings.
//
//   node tools/god-skill/scripts/parity/check.mjs <template.json> <port> [--keep]
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const [file, port] = process.argv.slice(2);
const t = JSON.parse(readFileSync(resolve(file), 'utf8'));
const { startWorld } = await import(resolve(root, 'tools/god-skill/dev-world.mjs'));
const { child, base } = await startWorld({ slug: 'parity-check', port: Number(port), fresh: true, log: resolve(root, '.lane/parity/check.log') });
let bad = 0;
try {
  const post = async (path, body, token = 'dev:admin') => (await fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  const token = (await post('/v1/god/mint', { label: 'check' })).token;
  if (t.constants) { const r = await post('/v1/god/act', { ops: [{ op: 'expand', extent: t.constants.extent }] }, token); if (!r.accepted) console.log('expand:', JSON.stringify(r.failures)); }
  if (t.state) { const r = await post('/v1/god/act', { ops: [{ op: 'world', state: t.state }] }, token); console.log(`state: ${r.accepted ? 'ok' : JSON.stringify(r.failures)}`); }
  for (const [i, b] of t.batches.entries()) {
    const r = await post('/v1/god/act', { ops: b.ops, group: b.group, note: b.note }, token);
    if (r.accepted) console.log(`✔ ${i + 1} ${b.group}: ${b.ops.length} ops${r.warnings?.length ? ` (${r.warnings.length} warnings: ${JSON.stringify(r.warnings).slice(0, 300)})` : ''}`);
    else { bad++; const f = r.failures?.[0]; console.log(`✖ ${i + 1} ${b.group}: op ${f?.op} ${JSON.stringify(b.ops[f?.op] ?? {}).slice(0, 160)}\n    ${JSON.stringify(r.failures ?? r).slice(0, 700)}`); }
  }
} finally { if (!process.argv.includes('--keep')) child.kill(); else child.unref(); }
process.exit(bad ? 1 : 0);

// Offline re-score (no model): recompute oracles.jsonl and metrics.json for existing run folders with the current
// oracles and metrics (2026-10-25 harness fixes B3/B4: in-window arrival targets, chat replies in truthfulness and
// result-sent, turn↔request cost join). The first re-score keeps the originals as oracles.jsonl.v1 / metrics.json.v1.
// The ledger (Reviewer verdicts and their oracle vetoes) is not re-scored.
// node tools/playtest/review/rescore-oracles.mjs <run-dir> [<run-dir> …] [--all <runs-root>]
import { copyFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from '../lib/jsonl.mjs';
import { loadRun } from './run.mjs';
import { runOracles } from './oracles.mjs';
import { computeMetrics, readLedger } from './metrics.mjs';

const keep = (f) => { if (existsSync(f) && !existsSync(`${f}.v1`)) copyFileSync(f, `${f}.v1`); };

export function rescoreRun(runDir) {
  const run = loadRun(runDir);
  const rows = run.evidence.flatMap((ev) => runOracles(ev, { run }));
  keep(join(runDir, 'oracles.jsonl')); keep(join(runDir, 'metrics.json'));
  writeFileSync(join(runDir, 'oracles.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  const metrics = { ...computeMetrics(run, { ledger: readLedger(join(runDir, 'ledger.tsv')), oracles: rows, emergence: readJson(join(runDir, 'emergence.json'), null) }), rescoredAt: new Date().toISOString(), rescoredBy: 'review/rescore-oracles.mjs' };
  writeFileSync(join(runDir, 'metrics.json'), JSON.stringify(metrics, null, 1) + '\n');
  return { run: basename(runDir), requests: run.evidence.length, inferredLinks: run.evidence.filter((e) => e.chatTurnsInferred).length, basics: metrics.basics, truth: metrics.fidelity.truthfulnessPassRate };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2); const i = a.indexOf('--all');
  const dirs = i >= 0 ? readdirSync(resolve(a[i + 1])).map((d) => join(resolve(a[i + 1]), d)).filter((d) => existsSync(join(d, 'oracles.jsonl')) || existsSync(join(d, 'oracles.jsonl.v1'))) : a.map((d) => resolve(d));
  if (!dirs.length) { process.stderr.write('usage: rescore-oracles.mjs <run-dir> [...] | --all <runs-root>\n'); process.exit(2); }
  for (const d of dirs) { const r = rescoreRun(d); process.stdout.write(`${r.run}: walks ${r.basics.walksArrived}/${r.basics.walksArrivalKnown} arrived (asked ${r.basics.walkRequests}), body moved ${r.basics.bodyMovedInBudget}/${r.requests}, truth ${r.truth == null ? '—' : r.truth.toFixed(2)}, links inferred ${r.inferredLinks}\n`); }
}

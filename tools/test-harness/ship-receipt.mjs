#!/usr/bin/env node
// Combine the two release receipts into the one a ship attaches.
//   node tools/test-harness/ship-receipt.mjs <gate receipt.json> <v7-receipt.json> [--out <ship-receipt.json>]
// The CPU gate (release-gate.sh, Modal) excludes V7; the V7 walk (v7-walks.sh, real Chrome on 5870-5879) covers it.
// They combine only when both judged the SAME candidate commit: the V7 source sha must equal the gate's candidate sha,
// the V7 checkout must have been clean, the V7 walk must pass and the gate must not be blocked. Anything else is blocked.
// Status = the gate's status (pass | quarantined) when they combine; remaining exclusions are the gate's minus V7 (V8).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function combineReceipts(gate, v7) {
  const blockers = [];
  const candidate = gate?.refs?.candidate?.sha;
  if (gate?.schemaVersion !== 1) blockers.push('gate receipt: unknown schema');
  if (!candidate) blockers.push('gate receipt: no candidate sha');
  if (!['pass', 'quarantined'].includes(gate?.status)) blockers.push(`gate status ${gate?.status}`);
  if (gate?.blockers?.length) blockers.push(`gate has ${gate.blockers.length} blocker(s)`);
  // a scoped candidate gate (release-gate.sh --scope auto) proves a subset of steps; only the full contract ships
  if (gate?.scope && gate.scope.resolved !== 'full') blockers.push(`gate scope ${gate.scope.resolved} is not the full contract`);
  if (!gate?.exclusions?.includes('V7')) blockers.push('gate receipt does not list V7 as excluded (unexpected harness)');
  if (v7?.schemaVersion !== 1 || v7?.step !== 'V7') blockers.push('v7 receipt: unknown schema');
  if (v7?.status !== 'pass') blockers.push(`V7 status ${v7?.status} (failed: ${(v7?.failed || []).join(', ')})`);
  if (v7?.dirty !== false) blockers.push('V7 ran on a dirty checkout');
  if (candidate && v7?.source !== candidate) blockers.push(`V7 source ${v7?.source} != gate candidate ${candidate}`);
  if (!Array.isArray(v7?.checks) || !v7.checks.length || v7.checks.some(c => !c.ok)) blockers.push('V7 checks missing or failing');
  return {
    status: blockers.length ? 'blocked' : gate.status,
    blockers,
    candidate: candidate || null,
    baseline: gate?.refs?.baseline?.sha || null,
    remainingExclusions: (gate?.exclusions || []).filter(s => s !== 'V7'),
    newFailures: gate?.newFailures?.length ?? null,
    quarantined: gate?.quarantined?.length ?? null,
    v7Checks: v7?.checks?.length ?? 0,
  };
}

export function main(args = process.argv.slice(2)) {
  const [gatePath, v7Path, flag, outArg] = args;
  if (!gatePath || !v7Path || (flag && flag !== '--out') || (flag && !outArg)) {
    console.error('usage: ship-receipt.mjs <gate receipt.json> <v7-receipt.json> [--out <ship-receipt.json>]'); return 2;
  }
  const load = p => { const bytes = readFileSync(resolve(p)); return { path: resolve(p), sha256: createHash('sha256').update(bytes).digest('hex'), json: JSON.parse(bytes) }; };
  const gate = load(gatePath), v7 = load(v7Path);
  const combined = combineReceipts(gate.json, v7.json);
  const out = resolve(outArg || join(dirname(gate.path), 'ship-receipt.json'));
  const receipt = { schemaVersion: 1, kind: 'ship-receipt', at: new Date().toISOString(), ...combined,
    gate: { path: gate.path, sha256: gate.sha256, status: gate.json.status }, v7: { path: v7.path, sha256: v7.sha256, status: v7.json.status, at: v7.json.at } };
  writeFileSync(out, JSON.stringify(receipt, null, 2) + '\n');
  console.log(`RELEASE_SHIP ${receipt.status.toUpperCase()} candidate=${receipt.candidate || '?'} gate=${gate.json.status} v7=${v7.json.status} remaining=${receipt.remainingExclusions.join(',') || 'none'} blockers=${receipt.blockers.length} receipt=${out}`);
  return receipt.status === 'blocked' ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();

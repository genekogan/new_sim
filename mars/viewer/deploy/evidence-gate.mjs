// Gate-backed external evidence. Files existing on disk are references, not executed proofs.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';

export function latestGate(viewer, explicitPath, git = (...args) => execFileSync('git', args, { cwd: viewer, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()) {
  const directory = join(viewer, '.cloudflare/gate');
  const candidates = explicitPath ? [resolve(explicitPath)] : existsSync(directory)
    ? readdirSync(directory, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort().reverse().map((d) => join(directory, d, 'report.json')) : [];
  if (!candidates.length) return { path: null, report: null, reason: 'no gate report found' };
  // Never fall back to an older green gate when the latest attempt is red, malformed, or interrupted before writing its report.
  const path = candidates[0];
  try {
    const report = JSON.parse(readFileSync(path, 'utf8'));
    if (!report.finishedAt || !Array.isArray(report.steps)) throw new Error('missing completion time or steps');
    let reason = '';
    if (!report.gitHead) reason = 'gate has no revision';
    else if (report.gitDirty !== false) reason = 'gate ran on an unverified dirty tree';
    else if (git('rev-parse', `${report.gitHead}^{commit}`) !== git('rev-parse', 'HEAD')) reason = 'gate revision differs from current HEAD';
    else if (git('status', '--porcelain', '--', '.', ':(exclude).pw-browsers')) reason = 'viewer has uncommitted changes since the gate';
    return { path: relative(viewer, path), report, reason };
  } catch (error) { return { path: relative(viewer, path), report: null, reason: `unreadable gate report: ${error.message}` }; }
}

export function externalProof(path, { gate, exists = true, readLog = () => '' }) {
  const proof = { path, exists };
  let stepName;
  if (path === 'viewer/deploy/simulation-integration.mjs') stepName = 'simulation-integration';
  else if (path === 'viewer/deploy/determinism-probe.mjs') stepName = 'determinism-probe';
  else if (/^viewer\/deploy\/[^/]+\.test\.mjs$/.test(path)) stepName = 'test';
  else if (/^viewer\/e2e\/[^/]+\.spec\.ts$/.test(path)) stepName = 'e2e';
  else if (path === 'viewer/deploy/record-campus-take.mjs') stepName = 'record-campus-take';
  else return { ...proof, result: 'reference', reason: 'supporting reference; not an executable proof' };
  if (!exists) return { ...proof, step: stepName, result: 'missing', reason: 'cited proof file is missing' };
  if (!gate.report) return { ...proof, step: stepName, result: 'missing', reason: gate.reason };
  if (gate.reason) return { ...proof, step: stepName, result: 'stale', reason: gate.reason, gate: gate.path };
  const step = gate.report.steps.find((s) => stepName === 'record-campus-take' ? /record-campus-take\.mjs\s+--check(?:\s|$)/.test(s.command ?? '') : s.step === stepName);
  if (!step) return { ...proof, step: stepName, result: 'missing', reason: 'gate did not run this proof', gate: gate.path };
  const common = { ...proof, step: step.step, gate: gate.path, log: step.log, durationMs: step.durationMs };
  if (step.status !== 'pass' || step.timedOut) return { ...common, result: 'fail', reason: 'gate step failed or timed out' };
  const log = stripVTControlCharacters(readLog(step.log));
  const unverified = (reason) => ({ ...common, result: 'unverified', reason });
  if (!log.trim()) return unverified('gate execution log is missing or empty');
  if (stepName === 'simulation-integration' && (!/^PASS: MCP handshake .*engine tools, each called/m.test(log) || !/^PASS: authenticate before body parsing/m.test(log)))
    return unverified('integration completion evidence is absent from the gate log');
  if (stepName === 'determinism-probe' && (!/^status\s+completed\s*$/m.test(log) || !/^finalStateHash\s+[a-f0-9]{64}\s*$/m.test(log)))
    return unverified('completed determinism probe and final hash are absent from the gate log');
  if (stepName === 'test') {
    const count = (name) => log.match(new RegExp(`^(?:# |ℹ )${name} (\\d+)`, 'm'))?.[1];
    if (!(Number(count('pass')) > 0) || ['fail', 'skipped', 'todo'].some((name) => count(name) !== '0'))
      return unverified('unit log does not confirm passing tests with zero failures/skips/TODOs');
  }
  if (stepName === 'record-campus-take' && (!/^check\s+.+ OK \(/m.test(log) || /^check\s+.+ MISMATCH/m.test(log)))
    return unverified('take check completion evidence is absent or mismatched');
  if (stepName === 'test' && !/^(?:npm test|npm run test)(?:$|\s+--\s*$)|node --test deploy\/\*\.test\.mjs/.test(step.command ?? ''))
    return { ...common, result: 'unverified', reason: 'unit command does not establish execution of every deploy test file' };
  if (stepName === 'test' && (Number(step.skipped ?? 0) || Number(step.todo ?? 0)))
    return { ...common, result: 'unverified', reason: 'unit step contains skipped/TODO tests; per-file execution is unverified' };
  if (stepName === 'e2e') {
    // The aggregate can pass with skipped specs. Require this cited spec to have passed entries.
    const spec = path.slice('viewer/'.length);
    const records = log.split('\n').map((line) => /^\s*(✓|✔|-|✘|×|x)\s+\d+\s+(?:\[[^\]]+\]\s+›\s+)?(e2e\/[^:]+):\d+:\d+\s+›/.exec(line)).filter(Boolean);
    const lines = records.filter((record) => record[2] === spec);
    if (!lines.some((record) => record[1] === '✓' || record[1] === '✔')) return { ...common, result: 'unverified', reason: 'no passing execution for this spec in the gate log' };
    if (lines.some((record) => record[1] !== '✓' && record[1] !== '✔')) return { ...common, result: 'unverified', reason: 'this spec includes skipped or failing cases' };
  }
  return { ...common, result: 'pass', reason: 'executed by the cited gate step' };
}

export function gateLogReader(viewer) {
  return (path) => {
    if (!path) return '';
    const full = resolve(viewer, path), base = resolve(viewer, '.cloudflare/gate') + sep;
    if (!full.startsWith(base)) return ''; // reports may only name local gate logs
    try { return readFileSync(full, 'utf8'); } catch { return ''; }
  };
}

export function evidenceStatus(tests, outsideSuite = []) {
  const proofs = [...tests, ...outsideSuite.filter((p) => p.result !== 'reference')];
  const passed = proofs.filter((p) => p.result === 'pass').length;
  return { passed, total: proofs.length, status: !passed ? 'UNPROVEN' : passed === proofs.length ? 'PROVEN' : 'PARTIAL' };
}

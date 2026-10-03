#!/usr/bin/env node
// Release gate: runs every pre-deploy check in order and writes a report.
//   npm run gate               stop at the first failure
//   npm run gate -- --continue run every step regardless
// Output: .cloudflare/gate/<timestamp>/{<step>.log,report.json}. Exits non-zero on any failure.
// simulation-integration always runs; SIM_BASE overrides the isolated local server.
import { GateProcesses, nodeTestSummary, startLocalSimulation } from './gate-runtime.mjs';
import { engineCommand, hash, sourceIdentity, validatePayload } from './engine-proof.mjs';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIN = 60_000;
const keepGoing = process.argv.includes('--continue');

const nodeTest = nodeTestSummary;
const playwright = (out) => {
  // oxlint-disable-next-line no-control-regex -- strips Playwright's ANSI colour escapes (ESC [ … m) on purpose
  const plain = out.replace(/\x1b\[[0-9;]*m/g, '');
  const get = (k) => plain.match(new RegExp(`^\\s*(\\d+) ${k}\\b`, 'm'))?.[1];
  const [passed, failed, flaky, skipped] = ['passed', 'failed', 'flaky', 'skipped'].map(get);
  const parts = [passed && `${passed} passed`, failed && `${failed} failed`, flaky && `${flaky} flaky`, skipped && `${skipped} skipped`].filter(Boolean);
  return { passed, failed, flaky, skipped, summary: parts.join(', ') };
};
const probe = (out) => {
  const finalStateHash = out.match(/^finalStateHash\s+(\S+)/m)?.[1];
  const probeStatus = out.match(/^status\s+(\S+)/m)?.[1];
  return { finalStateHash, probeStatus, summary: finalStateHash ? `hash ${finalStateHash.slice(0, 12)}… (${probeStatus})` : '' };
};
const tsc = (out) => {
  const errors = (out.match(/error TS\d+/g) ?? []).length;
  return { errors, summary: errors ? `${errors} error(s)` : 'clean' };
};
const simulation = (out) => ({ summary: out.trim().split('\n').filter(Boolean).at(-1)?.slice(0, 80) ?? '' });

const steps = [
  { name: 'lint', cmd: ['npm', 'run', 'lint', '--', '--max-warnings=0'], timeout: 5 * MIN, parse: (out) => ({ summary: /\b(?:error|warning)\b/.test(out) ? 'lint findings' : 'clean' }) },
  { name: 'test', cmd: ['npm', 'test'], timeout: 5 * MIN, parse: nodeTest },
  { name: 'test-engine', cmd: engineCommand(root), timeout: 15 * MIN, parse: nodeTest },
  { name: 'tsc', cmd: ['npx', 'tsc', '--noEmit', '-p', '.'], timeout: 5 * MIN, parse: tsc },
  { name: 'tsc-camera', cmd: ['npx', 'tsc', '--noEmit', '-p', 'cinematography/tsconfig.json'], timeout: 5 * MIN, parse: tsc },
  // The prior 140-pass suite took 1293.529s; required current build proofs now
  // add ~258s plus actual access/foot-side/current-camera cases. Give the entire
  // serialized suite capacity; per-test and performance limits stay unchanged.
  // Release29 serialized browser proof took1766s; required music adds39.6s.
  // Capacity for the complete suite only: per-test deadlines/assertions are unchanged.
  // Release34 took2322.5s; supported sleep adds52.1s and prepared-day adds43.2s.
  // Their measured2417.8s sum exceeds the old2400s aggregate capacity. Allow
  // the complete serialized suite42min; all individual deadlines remain fixed.
  // Living-world required additions: selector audit198.9s, day110s, music52s,
  // garden32s + prior release35 suite2255.4s already total2748.3s (>42min),
  // before the two full camera runs. Allow60min aggregate serialized capacity;
  // individual deadlines, runtime/performance ceilings and assertions unchanged.
  // Release38 ran3505.271s. Measured required room/supper/circuit journeys add
  // 259.2s, plus7.9s camera entry and three startup audits: already >60min.
  // The release39 allowance was70min; keep every per-test
  // deadline, assertion, performance ceiling and golden baseline unchanged.
  // Verified40 used3696.213s.37 additional alpha cases actually passed in
  // 1254.995s:4951.208s before remaining solar/garden/gallery/quarantine cases.
  // Give the expanded serialized cohort95min; individual test deadlines,
  // performance ceilings, assertions and golden outcomes remain unchanged.
  { name: 'e2e', cmd: ['npm', 'run', 'e2e', '--', '--workers=1'], timeout: 95 * MIN, parse: playwright },
  { name: 'record-campus-take', cmd: ['node', 'deploy/record-campus-take.mjs', '--check'], timeout: 5 * MIN, parse: simulation },
  { name: 'determinism-probe', cmd: ['node', 'deploy/determinism-probe.mjs'], timeout: 5 * MIN, parse: probe },
];
steps.push({ name: 'simulation-integration', cmd: ['node', 'deploy/simulation-integration.mjs'], timeout: 5 * MIN, parse: simulation });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(root, '.cloudflare', 'gate', stamp);
mkdirSync(outDir, { recursive: true });

const processes = new GateProcesses();
let interrupted;
let cleanupError;
let interruption = Promise.resolve();
let interruptionStarted = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  interrupted = signal;
  if (!interruptionStarted) {
    interruptionStarted = true;
    interruption = processes.interrupt().catch((error) => { cleanupError = error.message; });
  }
});
process.on('exit', () => { try { processes.cleanup(); } catch (error) { console.error(`[gate] cleanup failed: ${error.message}`); } });

function run(step, env = process.env) {
  return new Promise((resolve) => {
    const logPath = join(outDir, `${step.name}.log`);
    const started = Date.now();
    let out = '';
    let timedOut = false;
    const proofPath = join(outDir, 'engine-proof.json');
    if (step.name === 'test-engine') {
      writeFileSync(`${proofPath}.identity.json`, JSON.stringify(report.sourceIdentity));
      env = { ...env, MARS_ENGINE_PROOF: proofPath };
    }
    const child = processes.spawn(step.cmd[0], step.cmd.slice(1), { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const log = createWriteStream(logPath);
    log.write(`$ ${step.cmd.join(' ')}\n\n`);
    const onData = (d) => { out += d; log.write(d); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => {
      timedOut = true;
      try { processes.kill(child); } catch (error) { finish(null, error); }
    }, step.timeout);
    let finished = false;
    const finish = (code, error) => {
      if (finished) return;
      finished = true;
      try { processes.kill(child); } catch (cleanup) { cleanupError = cleanup.message; error ??= cleanup; } // clean descendants even after a parent exits normally
      processes.children.delete(child);
      clearTimeout(timer);
      const durationMs = Date.now() - started;
      if (error) log.write(`\n[gate] spawn error: ${error.message}\n`);
      if (timedOut) log.write(`\n[gate] timed out after ${step.timeout / 1000}s\n`);
      log.end(() => {
        const parsed = step.parse(out);
        let ok = code === 0 && !timedOut && !error && !interrupted && (step.name !== 'determinism-probe' || Boolean(parsed.finalStateHash));
        let engineProof;
        if (ok && step.name === 'test-engine') {
          try {
            const bytes = readFileSync(proofPath);
            const proof = validatePayload(JSON.parse(bytes), sourceIdentity(root));
            if (JSON.stringify(proof.identity) !== JSON.stringify(report.sourceIdentity)) throw new Error('source changed during engine execution');
            for (const [key, field] of [['tests', 'tests'], ['pass', 'pass'], ['fail', 'fail'], ['skip', 'skipped'], ['todo', 'todo']]) if (Number(parsed[field]) !== proof.suite[key]) throw new Error('structured engine counts differ from native TAP');
            engineProof = { path: relative(root, proofPath), sha256: hash(bytes) };
          } catch (proofError) { ok = false; parsed.summary = `engine proof refused: ${proofError.message}`; }
        }
        resolve({ step: step.name, command: step.cmd.join(" "), ...parsed, ...(engineProof ? { engineProof } : {}), status: ok ? "pass" : "fail", exitCode: code, timedOut, durationMs, log: relative(root, logPath) });
      });
    };
    child.on('error', (e) => finish(null, e));
    child.on('close', (code) => finish(code));
  });
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const report = { startedAt: new Date().toISOString(), node: process.version, package: `${pkg.name}@${pkg.version ?? ''}`, simBase: process.env.SIM_BASE ?? null, continue: keepGoing, steps: [] };
report.sourceIdentity = sourceIdentity(root);
try {
  const { execFileSync } = await import('node:child_process');
  report.gitHead = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  report.gitDirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() !== '';
} catch {}

for (const step of steps) {
  process.stdout.write(`[gate] ${step.name} … `);
  let server;
  let r;
  const started = Date.now();
  try {
    if (step.name === 'simulation-integration' && !process.env.SIM_BASE) {
      server = await startLocalSimulation({ root, outDir, processes });
      report.simBase = server.base;
      report.simulationMode = 'isolated-local';
    }
    r = await run(step, server ? { ...process.env, SIM_BASE: server.base } : process.env);
  } catch (error) {
    const logPath = join(outDir, `${step.name}.log`);
    writeFileSync(logPath, `${error.stack}\n`);
    r = { step: step.name, status: 'fail', summary: error.message, durationMs: Date.now() - started, log: relative(root, logPath) };
  } finally {
    try { await server?.stop(); } catch (error) { cleanupError = error.message; }
  }
  report.steps.push(r);
  console.log(`${r.status} (${(r.durationMs / 1000).toFixed(1)}s)`);
  if (interrupted || (r.status === 'fail' && !keepGoing)) break;
}
await interruption;
const skipped = steps.slice(report.steps.length).map((s) => s.name);
report.skipped = skipped;
report.finishedAt = new Date().toISOString();
report.interrupted = interrupted ?? null;
report.cleanupError = cleanupError ?? null;
report.sourceChanged = JSON.stringify(report.sourceIdentity) !== JSON.stringify(sourceIdentity(root));
report.ok = !interrupted && !cleanupError && !report.sourceChanged && report.steps.every((s) => s.status === 'pass') && skipped.length === 0;
report.finalStateHash = report.steps.find((s) => s.step === 'determinism-probe')?.finalStateHash ?? null;
const reportPath = join(outDir, 'report.json');
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');

const rows = [['step', 'result', 'time', 'summary'], ...report.steps.map((s) => [s.step, s.timedOut ? 'TIMEOUT' : s.status.toUpperCase(), `${(s.durationMs / 1000).toFixed(1)}s`, s.summary || `exit ${s.exitCode}`]), ...skipped.map((n) => [n, 'SKIP', '-', 'not run'])];
const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
console.log('');
for (const [i, r] of rows.entries()) {
  console.log(r.map((c, j) => c.padEnd(widths[j])).join('  '));
  if (i === 0) console.log(widths.map((w) => '-'.repeat(w)).join('  '));
}
console.log(`\n${report.ok ? 'GATE GREEN' : 'GATE RED'}  report: ${relative(root, reportPath)}`);
process.exit(report.ok ? 0 : 1);

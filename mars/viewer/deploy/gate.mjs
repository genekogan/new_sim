#!/usr/bin/env node
// Release gate: runs every pre-deploy check in order and writes a report.
//   npm run gate               stop at the first failure
//   npm run gate -- --continue run every step regardless
// Output: .cloudflare/gate/<timestamp>/{<step>.log,report.json}. Exits non-zero on any failure.
// simulation-integration runs only when SIM_BASE is set.
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIN = 60_000;
const keepGoing = process.argv.includes('--continue');

const nodeTest = (out) => {
  const pick = (k) => out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm'))?.[1];
  const [tests, pass, fail, skipped] = ['tests', 'pass', 'fail', 'skipped'].map(pick);
  return { tests, pass, fail, skipped, summary: pass === undefined ? '' : `${pass} pass / ${fail} fail${Number(skipped) ? ` / ${skipped} skip` : ''}` };
};
const playwright = (out) => {
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
  { name: 'test', cmd: ['npm', 'test'], timeout: 5 * MIN, parse: nodeTest },
  { name: 'test-engine', cmd: ['npm', 'run', 'test:engine'], timeout: 15 * MIN, parse: nodeTest },
  { name: 'tsc', cmd: ['npx', 'tsc', '--noEmit', '-p', '.'], timeout: 5 * MIN, parse: tsc },
  { name: 'e2e', cmd: ['npm', 'run', 'e2e', '--', '--workers=1'], timeout: 20 * MIN, parse: playwright },
  { name: 'determinism-probe', cmd: ['node', 'deploy/determinism-probe.mjs'], timeout: 5 * MIN, parse: probe },
];
if (process.env.SIM_BASE) steps.push({ name: 'simulation-integration', cmd: ['node', 'deploy/simulation-integration.mjs'], timeout: 5 * MIN, parse: simulation });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(root, '.cloudflare', 'gate', stamp);
mkdirSync(outDir, { recursive: true });

function run(step) {
  return new Promise((resolve) => {
    const logPath = join(outDir, `${step.name}.log`);
    const log = createWriteStream(logPath);
    log.write(`$ ${step.cmd.join(' ')}\n\n`);
    const started = Date.now();
    let out = '';
    let timedOut = false;
    const child = spawn(step.cmd[0], step.cmd.slice(1), { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const onData = (d) => { out += d; log.write(d); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }, step.timeout);
    const finish = (code, error) => {
      clearTimeout(timer);
      const durationMs = Date.now() - started;
      if (error) log.write(`\n[gate] spawn error: ${error.message}\n`);
      if (timedOut) log.write(`\n[gate] timed out after ${step.timeout / 1000}s\n`);
      log.end(() => {
        const parsed = step.parse(out);
        const ok = code === 0 && !timedOut && !error && (step.name !== 'determinism-probe' || Boolean(parsed.finalStateHash));
        resolve({ step: step.name, command: step.cmd.join(" "), ...parsed, status: ok ? "pass" : "fail", exitCode: code, timedOut, durationMs, log: relative(root, logPath) });
      });
    };
    child.on('error', (e) => finish(null, e));
    child.on('close', (code) => finish(code));
  });
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const report = { startedAt: new Date().toISOString(), node: process.version, package: `${pkg.name}@${pkg.version ?? ''}`, simBase: process.env.SIM_BASE ?? null, continue: keepGoing, steps: [] };
try {
  const { execFileSync } = await import('node:child_process');
  report.gitHead = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  report.gitDirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() !== '';
} catch {}

for (const step of steps) {
  process.stdout.write(`[gate] ${step.name} … `);
  const r = await run(step);
  report.steps.push(r);
  console.log(`${r.status} (${(r.durationMs / 1000).toFixed(1)}s)`);
  if (r.status === 'fail' && !keepGoing) break;
}
const skipped = steps.slice(report.steps.length).map((s) => s.name);
report.skipped = skipped;
report.finishedAt = new Date().toISOString();
report.ok = report.steps.every((s) => s.status === 'pass') && skipped.length === 0;
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

#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This is the CPU-only contract, not a discovery list supplied by a candidate.
export const REQUIRED_STEPS = [
  'V1-types', 'V2-build-root', 'V2-build-worlds', 'V3-packages',
  'V3-mars-engine', 'V3-client-cli', 'V3-launcher-unit', 'V3-harness', 'V3-walk', 'V4-web',
  'V5-server-full', 'V6-scenarios', 'V6-party', 'V6-souls-r2',
  'V6-join-clerk', 'V6-join-dev', 'V6-mars-two', 'V6-lm-two',
];
// The launcher e2e (tools/god-skill/e2e/launcher.mjs) is not a CPU gate step: Z3 (2026-10-20) took the stale V6-launcher out;
// GT (B8, 2026-10-20) rewrote it against the one-view God modal and it runs in V7 (v7-walks.sh), in real Chrome.
// V3-walk (lane WALK, 2026-10-21): walkability of fixed world fixtures + a fresh Eden 2026 genesis against tools/test-harness/walk/baseline.
const TAP_STEPS = new Set(['V3-packages', 'V3-mars-engine', 'V3-client-cli', 'V3-launcher-unit', 'V3-harness', 'V3-walk', 'V4-web', 'V5-server-full']);
const REQUIRED_PACKAGES = ['engine-mars', 'world-compiler', 'generators', 'ground', 'kernel', 'brain', 'engine-toy', 'engine-contract', 'protocol', 'engine-native', 'conformance'];
/** Runs made before 2026-10-16 name the EF4 conformance package by its old directory, packages/catalog. */
const PACKAGE_ALIASES = { catalog: 'conformance' };
const STEP_EXCLUSIONS = new Set(); // No step is excluded whole any more (the launcher e2e moved to V7, see above).
const CASE_STEPS = new Set(REQUIRED_STEPS.filter(step => step.startsWith('V6-')));
const EXPECTED_SKIP = ['V7', 'V8'];
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const key = (step, id) => `${step}\u0000${id}`;
const unquote = s => s?.replace(/^['"]|['"]$/g, '').replace(/''/g, "'");
const sourceFile = s => unquote(s)?.replace(/^file:\/\//, '').replace(/^.*\/work\/(?:head|base)\//, '').replace(/:\d+(?::\d+)?$/, '');

/** Parse Node's raw TAP, retaining every assertion rather than failed-file names.
 * An enclosing suite's subtestsFailed result is coverage, never a blanket waiver.
 * Missing final plans/counters, loader failures and cancellations fail closed.
 */
export function parseTap(raw, label = 'TAP') {
  const lines = raw.replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/);
  const documents = [], errors = [], tests = [], packageExits = {};
  let doc, stack = [], diagnostic, packageName = '';
  const finish = () => {
    if (!doc) return;
    if (!doc.ended || doc.plan === undefined) errors.push(`${label}: incomplete TAP (${doc.prefix || 'root'})`);
    if (doc.plan !== doc.nodes.filter(n => n.indent === 0).length) errors.push(`${label}: root plan/result mismatch`);
    for (const n of doc.nodes) if (!n.status) errors.push(`${label}: missing result for ${n.name}`);
    const c = doc.counts;
    for (const k of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
      if (!Number.isInteger(c[k])) errors.push(`${label}: missing TAP ${k} counter`);
    }
    if (doc.nodes.length !== c.tests + (c.suites || 0)) errors.push(`${label}: incomplete assertion inventory`);
    if (c.tests !== c.pass + c.fail + c.cancelled + c.skipped + c.todo) errors.push(`${label}: inconsistent TAP counters`);
    if (c.cancelled) errors.push(`${label}: cancelled tests (${c.cancelled})`);
    documents.push(doc);
    doc = undefined; stack = []; diagnostic = undefined;
  };
  for (const line of lines) {
    const pkgExit = /^## ([\w-]+) exit=(\d+)$/.exec(line);
    if (pkgExit) { packageExits[pkgExit[1]] = Number(pkgExit[2]); continue; }
    const pkg = /^## ([\w-]+)$/.exec(line);
    if (pkg) { finish(); packageName = pkg[1]; continue; }
    if (line === 'TAP version 13') {
      finish(); doc = { prefix: packageName, nodes: [], counts: {}, ended: false }; continue;
    }
    if (/^\s*Bail out!/.test(line)) errors.push(`${label}: TAP bailout`);
    if (!doc) continue;
    if (diagnostic) {
      if (/^\s*\.\.\.\s*$/.test(line)) { diagnostic = undefined; continue; }
      const field = /^(\s*)(type|location|failureType|exitCode|code):\s*(.*)$/.exec(line);
      if (field && field[1].length === diagnostic.indent + 2) diagnostic[field[2]] = unquote(field[3]);
      continue;
    }
    const sub = /^( *)# Subtest: (.*)$/.exec(line);
    if (sub) {
      const indent = sub[1].length;
      while (stack.length && stack.at(-1).indent >= indent) stack.pop();
      const parent = stack.at(-1);
      const n = { indent, name: sub[2], ancestors: parent ? [...parent.ancestors, parent.name] : [], children: [] };
      if (parent) parent.children.push(n);
      doc.nodes.push(n); stack.push(n); continue;
    }
    const result = /^( *)(not ok|ok) \d+ - (.*?)(?:\s+# (SKIP|TODO)(?:\s+(.*))?)?$/.exec(line);
    if (result) {
      const indent = result[1].length;
      const n = [...stack].reverse().find(n => n.indent === indent && !n.status);
      if (!n || n.name !== result[3]) { errors.push(`${label}: unmatched TAP assertion ${result[3]}`); continue; }
      n.status = result[4]?.toLowerCase() || (result[2] === 'ok' ? 'pass' : 'fail');
      n.directive = result[5] || '';
      diagnostic = n;
      continue;
    }
    const plan = /^1\.\.(\d+)$/.exec(line);
    if (plan) { if (doc.plan !== undefined) errors.push(`${label}: duplicate root plan`); doc.plan = Number(plan[1]); }
    const count = /^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$/.exec(line);
    if (count) {
      if (doc.counts[count[1]] !== undefined) errors.push(`${label}: duplicate TAP counter`);
      doc.counts[count[1]] = Number(count[2]);
    }
    if (/^# duration_ms [\d.]+$/.test(line)) doc.ended = true;
  }
  finish();
  if (!documents.length) errors.push(`${label}: no complete Node TAP output`);
  const occurrences = new Map();
  for (const d of documents) for (const n of d.nodes) {
    const title = [...(d.prefix ? [d.prefix] : []), ...n.ancestors, n.name].join(' > ');
    const ordinal = (occurrences.get(title) || 0) + 1;
    occurrences.set(title, ordinal);
    const id = title + (ordinal > 1 ? ` [duplicate ${ordinal}]` : '');
    const aggregate = n.failureType === 'subtestsFailed';
    // A file that never loaded hides its test inventory, so cannot be quarantined.
    const loader = n.status === 'fail' && /(?:^|\/)\S+\.test\.(?:[cm]?[jt]sx?)$/.test(n.name) && (n.exitCode !== undefined || !n.children.length);
    if (n.failureType === 'cancelledByParent' || n.failureType === 'testTimeoutFailure') errors.push(`${label}: cancelled/timed-out test ${id}`);
    if (n.status === 'fail' && ['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'EADDRINUSE', 'ENOSPC', 'ENOMEM', 'EMFILE', 'ENFILE', 'ECONNREFUSED', 'ERR_WORKER_OUT_OF_MEMORY'].includes(n.code)) errors.push(`${label}: infrastructure error ${n.code}: ${id}`);
    tests.push({ id, status: n.status, aggregate, loader, source: sourceFile(loader ? n.name : n.location), directive: n.directive });
  }
  const counts = { tests: 0, suites: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0, topLevel: 0 };
  for (const d of documents) {
    for (const k of Object.keys(counts)) counts[k] += k === 'topLevel' ? d.plan || 0 : d.counts[k] || 0;
  }
  return { tests, errors, counts, documents: documents.length, packages: documents.map(d => d.prefix), packageExits };
}

export function validateQuarantine(manifest) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.entries)) throw Error('quarantine.json must use schemaVersion 1 and entries[]');
  if (!Array.isArray(manifest.scopeExclusions) || JSON.stringify(manifest.scopeExclusions.map(e => e.step).sort()) !== JSON.stringify([...EXPECTED_SKIP].sort()) || !manifest.scopeExclusions.every(e => [e.owner, e.reason].every(v => typeof v === 'string' && v.trim()))) throw Error('scopeExclusions must document exactly V7 and V8 with owner and reason');
  const seen = new Set();
  for (const e of manifest.entries) {
    if (![e.step, e.id, e.reason, e.owner].every(v => typeof v === 'string' && v.trim())) throw Error('every quarantine needs step, id, reason and owner');
    if (!REQUIRED_STEPS.includes(e.step)) throw Error(`unknown quarantine step ${e.step}`);
    if (CASE_STEPS.has(e.step)) throw Error(`V6 scenario failures cannot be quarantined: ${e.step}`);
    if (!['fail', 'skip', 'todo'].includes(e.status || 'fail')) throw Error(`invalid quarantine status ${e.status}`);
    if (e.kind === 'step' ? (!STEP_EXCLUSIONS.has(e.step) || e.id !== '*') : (e.id === '*' || e.kind && e.kind !== 'test')) throw Error(`invalid broad quarantine ${e.step}/${e.id}`);
    const k = key(e.step, e.id);
    if (seen.has(k)) throw Error(`duplicate quarantine ${e.step}/${e.id}`);
    seen.add(k);
  }
  return new Map(manifest.entries.map(e => [key(e.step, e.id), e]));
}

/** Validate a returned Modal directory; exported for synthetic, port-free proof. */
export function readRun(dir, expected, manifest, requiredSteps = REQUIRED_STEPS) {
  const errors = [], steps = {}, evidence = {};
  const q = validateQuarantine(manifest);
  const read = path => { const b = readFileSync(path); evidence[path] = sha256(b); return b.toString(); };
  let metadata;
  try {
    metadata = JSON.parse(read(join(dir, 'out/RUN-METADATA.json')));
    for (const [field, value] of Object.entries(expected)) {
      if (JSON.stringify(metadata[field]) !== JSON.stringify(value)) errors.push(`metadata mismatch: ${field}`);
    }
    if (metadata.suiteCompleted !== true) errors.push('Modal suite did not complete');
    if (metadata.baselineSha !== null) errors.push('unexpected embedded baseline');
    if (JSON.stringify(metadata.skip) !== JSON.stringify(EXPECTED_SKIP)) errors.push('unexpected suite skips');
    if (!Array.isArray(metadata.serverFiles) || metadata.serverFiles.length) errors.push('bounded server suite is not a release gate');
    if (typeof metadata.nodeVersion !== 'string' || !metadata.nodeVersion.startsWith(`v${metadata.node}.`)) errors.push('missing/mismatched actual Node version');
    if (metadata.pnpmVersion !== '10.27.0') errors.push('missing/mismatched actual pnpm version');
  } catch (e) { errors.push(`missing/invalid run metadata: ${e.message}`); }
  try {
    const summaryPath = join(dir, 'out/suite/SUMMARY.tsv');
    const lines = read(summaryPath).trim().split(/\r?\n/);
    if (lines.shift() !== 'step\texit\tseconds\tlog') errors.push('invalid SUMMARY.tsv header');
    for (const line of lines) {
      const fields = line.split('\t');
      if (fields.length !== 4) { errors.push(`malformed summary row: ${line}`); continue; }
      const [step, exit, seconds, remoteLog] = fields;
      if (step === 'V8-history-boot' && exit === 'SKIP') continue;
      if (!requiredSteps.includes(step) || steps[step]) { errors.push(`unexpected/duplicate step: ${step}`); continue; }
      if (!/^\d+$/.test(seconds)) errors.push(`${step}: invalid elapsed time`);
      const item = steps[step] = { exit, tests: [], log: remoteLog === '-' ? null : join(dir, 'out/suite', basename(remoteLog)) };
      const excluded = q.get(key(step, '*'));
      if (exit === 'QUARANTINE' && excluded?.kind === 'step') {
        try { if (!read(item.log).includes(excluded.reason)) errors.push(`${step}: exclusion reason not in log`); }
        catch { errors.push(`${step}: missing quarantine explanation log`); }
        continue;
      }
      if (!/^\d+$/.test(exit)) { errors.push(`${step}: unexpected status ${exit}`); continue; }
      if ([124, 137, 142, 143].includes(Number(exit)) || Number(exit) >= 128) errors.push(`${step}: timeout/signal/infrastructure exit ${exit}`);
      let raw;
      try { raw = read(item.log); if (!raw.trim() && step !== 'V1-types') errors.push(`${step}: empty log`); }
      catch { errors.push(`${step}: missing log`); continue; }
      if (CASE_STEPS.has(step)) {
        try {
          const cases = JSON.parse(read(join(dir, `out/suite/${step}-cases.json`)));
          if (cases.schemaVersion !== 1 || cases.completed !== true || !Array.isArray(cases.steps) || !cases.steps.length || !Array.isArray(cases.harnessFailures) || typeof cases.sourceReport !== 'string' || !cases.sourceReport) errors.push(`${step}: missing/incomplete scenario case inventory`);
          else {
            const seen = new Set();
            for (const c of cases.steps) {
              if (typeof c.id !== 'string' || !c.id || !['pass', 'fail'].includes(c.status) || seen.has(c.id)) { errors.push(`${step}: malformed/duplicate scenario case`); continue; }
              seen.add(c.id); item.tests.push({ id: c.id, status: c.status, aggregate: false, directive: '' });
            }
            if (cases.harnessFailures.length) errors.push(`${step}: scenario harness failures: ${cases.harnessFailures.join(', ')}`);
            const failures = item.tests.filter(t => t.status === 'fail');
            if (Number(exit) === 0 && failures.length) errors.push(`${step}: scenario failures hidden by zero exit`);
            if (Number(exit) !== 0 && !failures.length && !cases.harnessFailures.length) errors.push(`${step}: nonzero exit without scenario failure evidence`);
          }
        } catch (e) { errors.push(`${step}: missing/invalid scenario case inventory: ${e.message}`); }
      } else if (TAP_STEPS.has(step)) {
        const tap = parseTap(raw, step); item.tests = tap.tests; errors.push(...tap.errors);
        if (step === 'V3-packages') {
          const alias = (p) => PACKAGE_ALIASES[p] ?? p;
          tap.packages = tap.packages.map(alias); tap.packageExits = Object.fromEntries(Object.entries(tap.packageExits).map(([p, x]) => [alias(p), x]));
          for (const t of tap.tests) { const [p, ...rest] = t.id.split(' > '); if (rest.length && PACKAGE_ALIASES[p]) t.id = [PACKAGE_ALIASES[p], ...rest].join(' > '); }
          if (JSON.stringify([...tap.packages].sort()) !== JSON.stringify([...REQUIRED_PACKAGES].sort())) errors.push(`${step}: missing/duplicate package test output`);
          for (const p of REQUIRED_PACKAGES) {
            if (!Number.isInteger(tap.packageExits[p])) errors.push(`${step}: missing package exit for ${p}`);
            else if (tap.packageExits[p] !== 0 && !tap.tests.some(t => t.id.startsWith(`${p} > `) && t.status === 'fail')) errors.push(`${step}: package ${p} failed without assertion evidence`);
          }
        }
        const failures = tap.tests.filter(t => t.status === 'fail' && !t.aggregate);
        if (Number(exit) === 0 && failures.length) errors.push(`${step}: failure hidden by zero exit`);
        if (Number(exit) !== 0 && !failures.length) errors.push(`${step}: nonzero exit without test failure evidence`);
        if (step === 'V4-web') {
          try {
            const attributionPath = join(dir, 'out/suite/V4-web-files.jsonl');
            const events = read(attributionPath).trim().split(/\r?\n/).map(line => JSON.parse(line));
            if (events.at(-1)?.event !== 'test:summary') errors.push(`${step}: incomplete executed-files attribution`);
            const finalCounts = events.at(-1)?.counts;
            const countNames = { tests: 'tests', suites: 'suites', pass: 'passed', fail: 'failed', cancelled: 'cancelled', skipped: 'skipped', todo: 'todo', topLevel: 'topLevel' };
            for (const [tapName, reporterName] of Object.entries(countNames)) {
              if (finalCounts?.[reporterName] !== tap.counts[tapName]) errors.push(`${step}: executed-files/TAP ${tapName} count mismatch`);
            }
            const executed = new Set();
            for (const event of events) {
              if (event.event === 'test:summary') continue;
              if (!['test:pass', 'test:fail'].includes(event.event) || typeof event.file !== 'string' || typeof event.name !== 'string' || !['test', 'suite'].includes(event.type)) {
                errors.push(`${step}: malformed executed-files attribution`); continue;
              }
              const file = sourceFile(event.file);
              if (event.type === 'test' && !event.skip && !event.todo && sourceFile(event.name) !== file) executed.add(file);
            }
            item.executedFiles = [...executed];
          } catch (e) { errors.push(`${step}: missing/invalid executed-files attribution: ${e.message}`); }
        }
      } else if (Number(exit) !== 0) errors.push(`${step}: non-test/infrastructure failure (exit ${exit})`);
    }
    for (const step of requiredSteps) if (!steps[step]) errors.push(`missing mandatory step: ${step}`);
  } catch (e) { errors.push(`missing/invalid summary: ${e.message}`); }
  return { dir: resolve(dir), metadata, steps, evidence, errors };
}

export function compareRuns(baseline, candidate, manifest, candidateSourceFiles = new Set()) {
  const q = validateQuarantine(manifest);
  const blockers = [...baseline.errors.map(e => `baseline: ${e}`), ...candidate.errors.map(e => `candidate: ${e}`)];
  if (baseline.metadata && candidate.metadata) for (const field of ['nodeVersion', 'pnpmVersion']) {
    if (baseline.metadata[field] !== candidate.metadata[field]) blockers.push(`baseline/candidate runtime mismatch: ${field}`);
  }
  const fixed = [], quarantined = [], newFailures = [], removed = [], unexpectedSkips = [], added = [];
  for (const [step, b] of Object.entries(baseline.steps)) {
    const c = candidate.steps[step]; if (!c) continue;
    if (b.exit === 'QUARANTINE' || c.exit === 'QUARANTINE') {
      if (b.exit !== c.exit) blockers.push(`${step}: step exclusion changed between runs`);
      else quarantined.push({ step, id: '*', ...q.get(key(step, '*')) });
      continue;
    }
    const bt = new Map(b.tests.map(t => [t.id, t]));
    const ct = new Map(c.tests.map(t => [t.id, t]));
    for (const t of b.tests) {
      const now = ct.get(t.id);
      if (t.loader) {
        const stillBroken = c.tests.some(n => n.loader && n.source === t.source);
        if (!candidateSourceFiles.has(t.source)) removed.push({ step, id: t.id, source: t.source });
        else if (!stillBroken && c.executedFiles?.includes(t.source)) fixed.push({ step, id: t.id, source: t.source, kind: 'repaired-loader' });
        else if (!stillBroken) blockers.push(`${step}: no executed test attribution for baseline loader ${t.source}`);
        continue;
      }
      if (!now) { removed.push({ step, id: t.id }); continue; }
      if (t.status === 'fail' && !t.aggregate) {
        const entry = q.get(key(step, t.id));
        if (now.status !== 'pass' && (!entry || (entry.status || 'fail') !== 'fail')) blockers.push(`${step}: baseline failure has no quarantine: ${t.id}`);
        if (now.status === 'pass') fixed.push({ step, id: t.id });
      }
    }
    for (const t of c.tests) {
      const before = bt.get(t.id);
      if (!before) added.push({ step, id: t.id });
      if (t.loader) { blockers.push(`${step}: candidate test file did not load: ${t.id}`); continue; }
      if (t.status === 'fail' && !t.aggregate) {
        const entry = q.get(key(step, t.id));
        if (before?.status !== 'fail' || before.source !== t.source) newFailures.push({ step, id: t.id, source: t.source });
        else if (!entry || (entry.status || 'fail') !== 'fail') blockers.push(`${step}: unquarantined failure: ${t.id}`);
        else quarantined.push({ step, id: t.id, reason: entry.reason, owner: entry.owner, status: 'fail' });
      }
      if (t.status === 'skip' || t.status === 'todo') {
        const entry = q.get(key(step, t.id));
        if (before?.status !== t.status || before.directive !== t.directive || !entry || entry.status !== t.status) unexpectedSkips.push({ step, id: t.id, status: t.status });
        else quarantined.push({ step, id: t.id, reason: entry.reason, owner: entry.owner, status: t.status });
      }
    }
    // Baseline skips also need an explicit reason even when a candidate fixes them.
    for (const t of b.tests.filter(t => ['skip', 'todo'].includes(t.status))) {
      if (q.get(key(step, t.id))?.status !== t.status) blockers.push(`${step}: undocumented baseline ${t.status}: ${t.id}`);
    }
  }
  if (newFailures.length) blockers.push(`${newFailures.length} new test failure(s)`);
  if (removed.length) blockers.push(`${removed.length} baseline assertions removed`);
  if (unexpectedSkips.length) blockers.push(`${unexpectedSkips.length} unexpected test skip(s)/TODO(s)`);
  return { status: blockers.length ? 'blocked' : quarantined.length ? 'quarantined' : 'pass', blockers, fixed, quarantined, newFailures, removed, unexpectedSkips, added };
}

function git(...args) { return execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim(); }
async function remoteRun(out, sourceSha, harnessRef, node) {
  mkdirSync(out, { recursive: true });
  const logPath = join(out, 'gate-driver.log');
  const logFd = openSync(logPath, 'w');
  const child = spawn('bash', [join(ROOT, 'tools/test-harness/remote-suite.sh'), out, '--ref', sourceSha, '--baseline-ref', 'none', '--harness-ref', harnessRef, '--node', node], {
    cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MODAL_PROFILE: 'edenartlab' },
  });
  child.stdout.on('data', b => writeSync(logFd, b)); child.stderr.on('data', b => writeSync(logFd, b));
  let timedOut = false;
  let killTimeout;
  const timeout = setTimeout(() => {
    timedOut = true; try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    killTimeout = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 5000);
  }, (4 * 3600 + 600) * 1000);
  const rc = await new Promise(resolve => {
    child.once('error', e => { writeSync(logFd, e.message); resolve(127); });
    child.once('close', (code, signal) => resolve(code ?? `signal:${signal}`));
  });
  clearTimeout(timeout); clearTimeout(killTimeout); closeSync(logFd);
  return { exit: rc, timedOut, log: logPath, logSha256: sha256(readFileSync(logPath)) };
}

export async function main(args = process.argv.slice(2)) {
  let receipt = { schemaVersion: 1, startedAt: new Date().toISOString(), status: 'blocked', blockers: [] };
  let out = join(ROOT, '.lane/release-gate', new Date().toISOString().replace(/[:.]/g, '-'));
  try {
    const candidateRef = args.shift();
    if (!candidateRef || candidateRef.startsWith('-')) throw Error('usage: release-gate.sh <candidate-ref> [--baseline <ref>] [--out <dir>] [--baseline-results <dir> --candidate-results <dir>]');
    const options = {};
    while (args.length) {
      const option = args.shift();
      if (!['--out', '--baseline', '--baseline-results', '--candidate-results', '--node'].includes(option) || !args.length) throw Error(`invalid option ${option}`);
      if (options[option]) throw Error(`duplicate option ${option}`);
      options[option] = args.shift();
    }
    if (options['--out']) out = resolve(options['--out']);
    if (existsSync(join(out, 'receipt.json'))) { const previous = out; out = join(out, `rejected-attempt-${Date.now()}`); throw Error(`output already has a receipt: ${previous}`); }
    mkdirSync(out, { recursive: true });
    // the baseline is what is live: main by default; a release line compares with its live release (e.g. --baseline 19d17c90)
    const baselineRef = options['--baseline'] || 'main';
    const baselineSha = git('rev-parse', '--verify', `${baselineRef}^{commit}`);
    const candidateSha = git('rev-parse', '--verify', `${candidateRef}^{commit}`);
    const harnessRef = git('rev-parse', 'HEAD');
    const harnessTree = git('rev-parse', `${harnessRef}:tools/test-harness`);
    if (git('status', '--porcelain', '--', 'tools/test-harness')) throw Error('commit the trusted harness and quarantine before running the gate');
    const harnessArchive = execFileSync('git', ['-C', ROOT, 'archive', '--format=tar.gz', harnessRef, 'tools/test-harness'], { maxBuffer: 64 * 1024 * 1024 });
    const manifestBytes = execFileSync('git', ['-C', ROOT, 'show', `${harnessRef}:tools/test-harness/quarantine.json`]);
    const manifest = JSON.parse(manifestBytes);
    validateQuarantine(manifest);
    const node = options['--node'] || '22';
    if (!['22', '26'].includes(node)) throw Error('supported Node versions: 22, 26');
    receipt = { ...receipt, refs: { baseline: { ref: baselineRef, sha: baselineSha }, candidate: { ref: candidateRef, sha: candidateSha } },
      harness: { ref: harnessRef, tree: harnessTree, archiveSha256: sha256(harnessArchive) }, quarantineSha256: sha256(manifestBytes), node, exclusions: EXPECTED_SKIP, scopeExclusions: manifest.scopeExclusions };
    const imported = Boolean(options['--baseline-results'] || options['--candidate-results']);
    if (imported && !(options['--baseline-results'] && options['--candidate-results'])) throw Error('provide both audited result directories or neither');
    const baselineDir = imported ? resolve(options['--baseline-results']) : join(out, 'baseline');
    const candidateDir = imported ? resolve(options['--candidate-results']) : join(out, 'candidate');
    receipt.importedResults = imported;
    const drivers = {};
    if (!imported) {
      [drivers.baseline, drivers.candidate] = await Promise.all([
        remoteRun(baselineDir, baselineSha, harnessRef, node),
        remoteRun(candidateDir, candidateSha, harnessRef, node),
      ]);
    }
    const identity = { schemaVersion: 1, harnessRef, harnessTree, harnessArchiveSha256: sha256(harnessArchive), node };
    const baseline = readRun(baselineDir, { ...identity, sourceSha: baselineSha }, manifest);
    const candidate = readRun(candidateDir, { ...identity, sourceSha: candidateSha }, manifest);
    for (const [label, driver] of Object.entries(drivers)) {
      if (driver.exit !== 0 || driver.timedOut) (label === 'baseline' ? baseline : candidate).errors.push(`Modal driver failed (${driver.timedOut ? 'timeout' : driver.exit})`);
    }
    const candidateSourceFiles = new Set(git('ls-tree', '-r', '--name-only', candidateSha).split('\n'));
    receipt = { ...receipt, ...compareRuns(baseline, candidate, manifest, candidateSourceFiles), drivers,
      runs: { baseline, candidate }, endedAt: new Date().toISOString() };
  } catch (e) { receipt.blockers.push(e.message); receipt.endedAt = new Date().toISOString(); }
  mkdirSync(out, { recursive: true });
  const receiptPath = join(out, 'receipt.json');
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  console.log(`RELEASE_GATE ${receipt.status.toUpperCase()} baseline=${receipt.refs?.baseline.sha || '?'} candidate=${receipt.refs?.candidate.sha || '?'} fixed=${receipt.fixed?.length || 0} quarantined=${receipt.quarantined?.length || 0} new=${receipt.newFailures?.length || 0} blockers=${receipt.blockers.length} receipt=${receiptPath}`);
  return receipt.status === 'blocked' ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();

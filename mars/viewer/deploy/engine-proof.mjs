// Exact-source, local gate receipts. Hashes detect stale/edited receipts; they are
// not signatures against someone replacing both the receipt and its gate report.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const engineFiles = (viewer) => readdirSync(join(viewer, 'engine/test')).filter((f) => f.endsWith('.test.ts')).sort();

export function sourceIdentity(viewer) {
  if (/--test(?:[=\s-]|$)/.test(process.env.NODE_OPTIONS ?? '')) throw new Error('engine proof refuses test selection/runner overrides in NODE_OPTIONS');
  const repo = dirname(viewer);
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const names = git('ls-files', '-z').split('\0').filter(Boolean).sort();
  const files = names.map((name) => {
    const path = join(repo, name), stat = lstatSync(path);
    // Track symlink identity, not an unrelated external directory crawl.
    return [name, stat.mode, hash(stat.isSymbolicLink() ? readlinkSync(path) : readFileSync(path))];
  });
  return { head: git('rev-parse', 'HEAD'), clean: git('status', '--porcelain') === '', node: process.version, fingerprint: hash(JSON.stringify(files)), files: engineFiles(viewer), options: hash(JSON.stringify({ NODE_OPTIONS: process.env.NODE_OPTIONS ?? '', CAMPUS_FULL: process.env.CAMPUS_FULL ?? '', YEAR_BUILD_FULL: process.env.YEAR_BUILD_FULL ?? '', CAMERA_IDENTITY_UPDATE: process.env.CAMERA_IDENTITY_UPDATE ?? '' })) };
}

export function engineCommand(viewer) {
  const pkg = JSON.parse(readFileSync(join(viewer, 'package.json'), 'utf8'));
  if (pkg.scripts['test:engine'] !== 'node --test engine/test/*.test.ts') throw new Error('engine proof requires review of the changed test:engine command');
  // Same Node CLI, complete shell-glob file set, default concurrency/isolation.
  // Only reporting changes; npm run test:engine remains the real suite unchanged.
  return ['node', '--test', '--test-reporter=./deploy/engine-proof-reporter.mjs', ...engineFiles(viewer).map((f) => `engine/test/${f}`)];
}

export function eventCollector(files) {
  const results = [], stdout = [], fileErrors = [], seen = new Set();
  return {
    results, stdout, fileErrors,
    accept({ type, data: d }) {
      if (d.file && files.includes(basename(d.file))) seen.add(basename(d.file));
      if (type === 'test:stdout') { stdout.push({ file: d.file ? basename(d.file) : '', message: d.message }); return; }
      if (!['test:pass', 'test:fail'].includes(type) || d.details?.type === 'suite') return;
      const file = d.file ? basename(d.file) : '';
      if (d.nesting === 0 && d.file && d.name === d.file) {
        if (type === 'test:fail') fileErrors.push({ file, error: String(d.details?.error?.message ?? d.details?.error ?? '') });
        return;
      }
      results.push({ file, name: d.name, nesting: d.nesting, result: d.skip ? 'skip' : d.todo ? 'todo' : type === 'test:pass' ? 'pass' : 'fail', durationMs: Math.round(d.details?.duration_ms ?? 0), ...(type === 'test:fail' ? { error: String(d.details?.error?.cause?.message ?? d.details?.error?.message ?? '').split('\n')[0].slice(0, 300) } : {}) });
    },
    finish(wallMs) {
      const top = results.filter((r) => r.nesting === 0);
      const count = (kind) => top.filter((r) => r.result === kind).length;
      return { results, stdout, fileErrors, seenFiles: [...seen].sort((a, b) => a < b ? -1 : a > b ? 1 : 0), suite: { files: files.length, tests: top.length, pass: count('pass'), fail: count('fail'), skip: count('skip'), todo: count('todo'), fileErrors: fileErrors.length, wallMs } };
    },
  };
}

export function validatePayload(payload, identity) {
  if (payload.schema !== 1 || payload.completed !== true || payload.node !== identity.node) throw new Error('incomplete engine proof or different Node runner');
  if (JSON.stringify(payload.identity) !== JSON.stringify(identity) || !identity.clean) throw new Error('engine proof source/test/options identity differs or tree is dirty');
  if (JSON.stringify(payload.seenFiles) !== JSON.stringify(identity.files)) throw new Error('engine proof did not execute every engine file');
  if (!Array.isArray(payload.results) || !Array.isArray(payload.stdout) || !Array.isArray(payload.fileErrors)) throw new Error('malformed engine events');
  for (const output of payload.stdout) if (typeof output.file !== 'string' || typeof output.message !== 'string') throw new Error('malformed engine stdout');
  for (const r of payload.results) if (!identity.files.includes(r.file) || typeof r.name !== 'string' || !Number.isInteger(r.nesting) || !['pass', 'fail', 'skip', 'todo'].includes(r.result) || !Number.isFinite(r.durationMs)) throw new Error('malformed engine test identity/result');
  const top = payload.results.filter((r) => r.nesting === 0);
  const suite = payload.suite;
  if (!suite || suite.tests !== top.length || suite.files !== identity.files.length || suite.fileErrors !== payload.fileErrors.length || !Number.isFinite(suite.wallMs)) throw new Error('engine proof summary differs from events');
  for (const [result, field] of [['pass', 'pass'], ['fail', 'fail'], ['skip', 'skip'], ['todo', 'todo']]) if (suite[field] !== top.filter((r) => r.result === result).length) throw new Error('engine proof counts differ from events');
  if (!suite.tests || suite.fail || suite.fileErrors) throw new Error('engine proof has failing or missing tests');
  return payload;
}

export function readEngineProof(viewer, gate, getIdentity = sourceIdentity, getCommand = engineCommand) {
  if (gate.reason || !gate.report || gate.report.ok !== true || !gate.report.finishedAt || gate.report.interrupted !== null || gate.report.cleanupError !== null || gate.report.gitDirty !== false || gate.report.steps.some((s) => s.status !== 'pass' || s.timedOut)) throw new Error(`engine proof requires a complete clean green gate: ${gate.reason || 'gate not green'}`);
  const step = gate.report.steps.find((s) => s.step === 'test-engine');
  if (!step?.engineProof || step.exitCode !== 0) throw new Error('gate has no successful structured engine proof; run a new full gate or standalone evidence');
  if (step.command !== getCommand(viewer).join(' ')) throw new Error('gate engine command differs from the complete native CLI suite');
  const reportPath = resolve(viewer, gate.path);
  if (!reportPath.startsWith(resolve(viewer, '.cloudflare/gate') + sep) || basename(reportPath) !== 'report.json') throw new Error('engine proof report must be a local gate report');
  const proofPath = resolve(viewer, step.engineProof.path);
  if (proofPath !== join(dirname(reportPath), 'engine-proof.json')) throw new Error('engine proof must belong to the cited gate directory');
  const bytes = readFileSync(proofPath);
  if (hash(bytes) !== step.engineProof.sha256) throw new Error('engine proof checksum differs from gate');
  const identity = getIdentity(viewer);
  if (gate.report.sourceIdentity?.head !== identity.head || JSON.stringify(gate.report.sourceIdentity) !== JSON.stringify(identity)) throw new Error('gate source fingerprint differs');
  const payload = validatePayload(JSON.parse(bytes), identity);
  for (const [key, field] of [['tests', 'tests'], ['pass', 'pass'], ['fail', 'fail'], ['skip', 'skipped'], ['todo', 'todo']]) if (Number(step[field]) !== payload.suite[key]) throw new Error('engine proof counters differ from gate execution log');
  return { ...payload, path: relative(viewer, proofPath), sha256: hash(bytes) };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, renameSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { cacheAdd, cacheKey, compareRuns, lookupCache, main, parseArgs, parseTap, readRun, scopeFor, storeCache, validateQuarantine, REQUIRED_PACKAGES, REQUIRED_STEPS } from './release-gate.mjs';

// Preserve fixture artifacts under the same no-delete rule as release work.
const retireFixture = dir => { const trash = join(homedir(), '.Trash'); mkdirSync(trash, { recursive: true }); renameSync(dir, join(trash, dir.split('/').at(-1) + '-' + Date.now())); };
const manifest = (entries = []) => ({ schemaVersion: 1, entries, scopeExclusions: ['V7', 'V8'].map(step => ({ step, owner: 'gate test fixture', reason: 'Separately owned explicit scope exclusion' })) });
const entry = (id, extra = {}) => ({ step: 'V4-web', id, owner: 'gate test fixture', reason: 'Known fixture failure, isolated by exact assertion', ...extra });
function tap(nodes, { prefix = '', omitEnd = false } = {}) {
  const lines = [prefix, 'TAP version 13'].filter(Boolean), counts = { tests: 0, suites: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0 };
  function render(n, i, depth) {
    const indent = ' '.repeat(depth * 4), status = n.status || 'pass';
    lines.push(`${indent}# Subtest: ${n.name}`);
    if (n.children) { n.children.forEach((c, j) => render(c, j + 1, depth + 1)); lines.push(`${indent}    1..${n.children.length}`); }
    const failure = status === 'fail';
    lines.push(`${indent}${failure ? 'not ok' : 'ok'} ${i} - ${n.name}${['skip', 'todo'].includes(status) ? ` # ${status.toUpperCase()}${n.directive ? ` ${n.directive}` : ''}` : ''}`);
    lines.push(`${indent}  ---`, `${indent}  duration_ms: 1`, `${indent}  type: '${n.suite ? 'suite' : 'test'}'`);
    if (n.source) lines.push(`${indent}  location: '/work/head/${n.source}:4:2'`);
    if (failure) lines.push(`${indent}  failureType: '${n.children ? 'subtestsFailed' : 'testCodeFailure'}'`, `${indent}  error: 'fixture assertion failed'`);
    if (n.loader) lines.push(`${indent}  exitCode: 1`, `${indent}  code: 'ERR_TEST_FAILURE'`);
    lines.push(`${indent}  ...`);
    if (n.suite) counts.suites++;
    else { counts.tests++; counts[status === 'skip' ? 'skipped' : status]++; }
  }
  nodes.forEach((n, i) => render(n, i + 1, 0));
  lines.push(`1..${nodes.length}`);
  if (!omitEnd) { for (const [k, v] of Object.entries(counts)) lines.push(`# ${k} ${v}`); lines.push('# duration_ms 2'); }
  return lines.join('\n') + '\n';
}
function run(raw, step = 'V4-web') {
  const parsed = parseTap(raw, step);
  return { errors: parsed.errors, steps: { [step]: { exit: parsed.tests.some(t => t.status === 'fail') ? '1' : '0', tests: parsed.tests } } };
}
function pair(baselineNodes, candidateNodes, entries = [], sourceFiles = [], executedFiles = []) {
  const candidate = run(tap(candidateNodes)); candidate.steps['V4-web'].executedFiles = executedFiles;
  return compareRuns(run(tap(baselineNodes)), candidate, manifest(entries), new Set(sourceFiles));
}

test('complete passing proof is green', () => {
  const r = pair([{ name: 'passes' }], [{ name: 'passes' }, { name: 'new passing assertion' }]);
  assert.equal(r.status, 'pass'); assert.equal(r.added.length, 1); assert.deepEqual(r.blockers, []);
});
test('an unchanged failure needs exact owner/reason quarantine and is honestly labelled', () => {
  const bad = [{ name: 'known failure', status: 'fail', source: 'apps/web/src/widget.test.ts' }];
  assert.equal(pair(bad, bad).status, 'blocked');
  const r = pair(bad, bad, [entry('known failure')]);
  assert.equal(r.status, 'quarantined'); assert.equal(r.quarantined.length, 1); assert.equal(r.newFailures.length, 0);
});
test('repairing a baseline failure is fixed without adding an obsolete quarantine', () => {
  const r = pair([{ name: 'fixed now', status: 'fail' }], [{ name: 'fixed now' }]);
  assert.equal(r.status, 'pass'); assert.equal(r.fixed.length, 1);
});
test('a newly failing test fails even if someone pre-added it to quarantine', () => {
  const r = pair([{ name: 'old' }], [{ name: 'old' }, { name: 'regression', status: 'fail' }], [entry('regression')]);
  assert.equal(r.status, 'blocked'); assert.equal(r.newFailures[0].id, 'regression');
});
test('an extra failed assertion inside the same already failing suite cannot hide', () => {
  const before = [{ name: 'same failed suite', suite: true, status: 'fail', children: [{ name: 'known', status: 'fail' }, { name: 'previous pass' }] }];
  const after = [{ name: 'same failed suite', suite: true, status: 'fail', children: [{ name: 'known', status: 'fail' }, { name: 'previous pass', status: 'fail' }] }];
  const r = pair(before, after, [entry('same failed suite > known')]);
  assert.equal(r.status, 'blocked'); assert.deepEqual(r.newFailures.map(t => t.id), ['same failed suite > previous pass']);
  assert.equal(r.quarantined.length, 1);
});
test('same failing title moved to a different file is a new failure', () => {
  const r = pair([{ name: 'same title', status: 'fail', source: 'src/old.test.ts' }], [{ name: 'same title', status: 'fail', source: 'src/new.test.ts' }], [entry('same title')]);
  assert.equal(r.status, 'blocked'); assert.equal(r.newFailures.length, 1);
});
test('removing either a passing or a failing baseline assertion blocks coverage loss', () => {
  for (const status of ['pass', 'fail']) {
    const r = pair([{ name: 'keep' }, { name: 'deleted', status }], [{ name: 'keep' }], [entry('deleted')]);
    assert.equal(r.status, 'blocked'); assert.equal(r.removed[0].id, 'deleted'); assert.equal(r.fixed.length, 0);
  }
});
test('skip and TODO changes cannot turn failures into success', () => {
  for (const status of ['skip', 'todo']) {
    const r = pair([{ name: 'working' }], [{ name: 'working', status }], [entry('working', { status })]);
    assert.equal(r.status, 'blocked'); assert.equal(r.unexpectedSkips.length, 1);
  }
});
test('unchanged documented skip is quarantined; missing reason/owner never accepted', () => {
  const nodes = [{ name: 'explicit skip', status: 'skip', directive: 'CPU test cannot exercise Metal GPU' }];
  assert.equal(pair(nodes, nodes).status, 'blocked');
  assert.equal(pair(nodes, nodes, [entry('explicit skip', { status: 'skip' })]).status, 'quarantined');
  assert.throws(() => validateQuarantine(manifest([entry('explicit skip', { reason: '' })])), /reason and owner/);
});
test('changing a known skip reason also requires review', () => {
  const r = pair([{ name: 'skipped', status: 'skip', directive: 'old reason' }], [{ name: 'skipped', status: 'skip', directive: 'different reason' }], [entry('skipped', { status: 'skip' })]);
  assert.equal(r.status, 'blocked');
});
test('truncated TAP fails closed even when the last visible assertion passes', () => {
  const broken = run(tap([{ name: 'passes' }], { omitEnd: true }));
  assert.match(broken.errors.join('\n'), /incomplete TAP/);
  assert.equal(compareRuns(run(tap([{ name: 'passes' }])), broken, manifest()).status, 'blocked');
});
test('Node TAP nested cancellation and bailout are infrastructure failures', () => {
  assert.match(parseTap(tap([{ name: 'cancelled', status: 'fail' }]).replace("failureType: 'testCodeFailure'", "failureType: 'cancelledByParent'")).errors.join('\n'), /cancelled/);
  assert.match(parseTap('TAP version 13\nBail out! process died\n').errors.join('\n'), /bailout/);
});
test('failed file loaders cannot be quarantined or mask a candidate regression', () => {
  const loader = [{ name: '/work/head/apps/web/src/widget.test.ts', status: 'fail', loader: true }];
  const r = pair(loader, loader, [entry('/work/head/apps/web/src/widget.test.ts')], ['apps/web/src/widget.test.ts']);
  assert.equal(r.status, 'blocked'); assert.match(r.blockers.join('\n'), /did not load/);
});
test('a baseline loader repair is fixed only while the source test file still exists', () => {
  const loader = [{ name: '/work/head/apps/web/src/widget.test.ts', status: 'fail', loader: true }];
  assert.equal(pair(loader, [{ name: 'widget works' }], [], ['apps/web/src/widget.test.ts'], ['apps/web/src/widget.test.ts']).status, 'pass');
  const r = pair(loader, [{ name: 'unrelated' }]);
  assert.equal(r.status, 'blocked'); assert.equal(r.removed.length, 1);
});
test('empty-but-present and undiscovered test files cannot masquerade as baseline loader repairs', () => {
  const loader = [{ name: '/work/head/apps/web/src/widget.test.ts', status: 'fail', loader: true }];
  for (const nodes of [[{ name: '/work/head/apps/web/src/widget.test.ts' }], [{ name: 'unrelated passed' }]]) {
    const r = pair(loader, nodes, [], ['apps/web/src/widget.test.ts']);
    assert.equal(r.status, 'blocked'); assert.match(r.blockers.join('\n'), /no executed test attribution/);
  }
});
test('duplicate assertion names keep separate identities', () => {
  const before = [{ name: 'same', status: 'fail' }, { name: 'same' }];
  const after = [{ name: 'same', status: 'fail' }, { name: 'same', status: 'fail' }];
  const r = pair(before, after, [entry('same')]);
  assert.equal(r.status, 'blocked'); assert.equal(r.newFailures[0].id, 'same [duplicate 2]');
});
test('package names prevent equal test names in different packages from colliding', () => {
  const p = parseTap(tap([{ name: 'same', status: 'fail' }], { prefix: '## engine-mars' }) + '## engine-mars exit=1\n' + tap([{ name: 'same' }], { prefix: '## kernel' }) + '## kernel exit=0\n');
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.tests.map(t => t.id), ['engine-mars > same', 'kernel > same']);
  assert.equal(p.packageExits['engine-mars'], 1);
});
test('actual Node TAP catches an additional failure in the same already failing file', t => {
  const dir = mkdtempSync(join(process.env.GATE_TEST_TMPDIR || tmpdir(), 'sim-release-tap-real-'));
  t.after(() => retireFixture(dir));
  const path = join(dir, 'real.test.mjs');
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const execute = extra => {
    writeFileSync(path, `import {describe,it} from 'node:test'; describe('real suite',()=>{it('known',()=>{throw Error('known')});it('second',()=>{${extra ? "throw Error('regression')" : ''}});});\n`);
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path], { encoding: 'utf8', env });
    assert.equal(result.status, 1); assert.equal(result.stderr, '');
    const parsed = run(result.stdout); assert.deepEqual(parsed.errors, []); return parsed;
  };
  const before = execute(false), after = execute(true);
  const proof = compareRuns(before, after, manifest([entry('real suite > known')]));
  assert.equal(proof.status, 'blocked');
  assert.deepEqual(proof.newFailures.map(t => t.id), ['real suite > second']);
});

const expected = { schemaVersion: 1, sourceSha: 'a'.repeat(40), harnessRef: 'b'.repeat(40), harnessTree: 'c'.repeat(40), harnessArchiveSha256: 'd'.repeat(64), node: '22' };
function fixture(t, { exit = '0', step = 'V4-web', metadata = {}, log = tap([{ name: 'works' }]), summary = true, attribution = [{ event: 'test:pass', file: '/work/head/apps/web/src/widget.test.ts', name: 'works', type: 'test' }, { event: 'test:summary' }] } = {}) {
  const dir = mkdtempSync(join(process.env.GATE_TEST_TMPDIR || tmpdir(), 'sim-release-gate-'));
  t.after(() => retireFixture(dir));
  mkdirSync(join(dir, 'out/suite'), { recursive: true });
  writeFileSync(join(dir, 'out/RUN-METADATA.json'), JSON.stringify({ ...expected, baselineSha: null, suiteCompleted: true, skip: ['V7', 'V8'], serverFiles: [], nodeVersion: 'v22.23.0', pnpmVersion: '10.27.0', ...metadata }));
  if (summary) writeFileSync(join(dir, 'out/suite/SUMMARY.tsv'), `step\texit\tseconds\tlog\n${step}\t${exit}\t2\t/out/suite/${step}.log\nV8-history-boot\tSKIP\t0\t-\n`);
  if (log !== null) writeFileSync(join(dir, `out/suite/${step}.log`), log);
  if (attribution) {
    const c = parseTap(log || '').counts;
    const counts = { tests: c.tests, suites: c.suites, passed: c.pass, failed: c.fail, cancelled: c.cancelled, skipped: c.skipped, todo: c.todo, topLevel: c.topLevel };
    writeFileSync(join(dir, `out/suite/${step}-files.jsonl`), attribution.map(e => JSON.stringify(e.event === 'test:summary' && e.counts === undefined ? { ...e, counts } : e)).join('\n') + '\n');
  }
  return dir;
}
test('missing summaries or logs fail closed', t => {
  const missingSummary = readRun(fixture(t, { summary: false }), expected, manifest(), ['V4-web']);
  const missingLog = readRun(fixture(t, { log: null }), expected, manifest(), ['V4-web']);
  assert.match(missingSummary.errors.join('\n'), /summary/);
  assert.match(missingLog.errors.join('\n'), /missing log/);
});
test('all package TAP documents and explicit package exits are mandatory', t => {
  const dir = fixture(t, { step: 'V3-packages', log: tap([{ name: 'one package passed' }], { prefix: '## engine-mars' }) });
  const r = readRun(dir, expected, manifest(), ['V3-packages']);
  assert.match(r.errors.join('\n'), /missing\/duplicate package test output/);
  assert.match(r.errors.join('\n'), /missing package exit/);
});
test('package output: the EF4 package counts as conformance under its old name catalog (runs before 2026-10-16), never twice', t => {
  const all = (last) => ['engine-mars', 'world-compiler', 'generators', 'ground', 'kernel', 'brain', 'engine-toy', 'engine-contract', 'protocol', 'engine-native', last]
    .map(p => tap([{ name: 'ok' }], { prefix: `## ${p}` }) + `## ${p} exit=0\n`).join('');
  for (const last of ['conformance', 'catalog']) {
    const r = readRun(fixture(t, { step: 'V3-packages', log: all(last) }), expected, manifest(), ['V3-packages']);
    assert.doesNotMatch(r.errors.join('\n'), /package/, last);
  }
  const twice = readRun(fixture(t, { step: 'V3-packages', log: all('catalog') + tap([{ name: 'ok' }], { prefix: '## conformance' }) + '## conformance exit=0\n' }), expected, manifest(), ['V3-packages']);
  assert.match(twice.errors.join('\n'), /missing\/duplicate package test output/);
});
test('a timeout cannot be waived by the same failing test identity', t => {
  const dir = fixture(t, { exit: '142', log: tap([{ name: 'known', status: 'fail' }]) });
  assert.match(readRun(dir, expected, manifest([entry('known')]), ['V4-web']).errors.join('\n'), /timeout/);
});
test('missing/truncated executed-file evidence blocks a loader-repair claim', t => {
  for (const attribution of [null, [{ event: 'test:pass', file: '/work/head/foo.test.ts', name: 'foo', type: 'test' }]]) {
    const dir = fixture(t, { attribution });
    assert.match(readRun(dir, expected, manifest(), ['V4-web']).errors.join('\n'), /executed-files attribution/);
  }
});
test('harness loader repair requires real executed-file reporter evidence', t => {
  const step = 'V3-harness', source = 'tools/test-harness/repaired.test.mjs';
  const dir = fixture(t, { step, attribution: null });
  const folder = join(dir, 'work/head/tools/test-harness'); mkdirSync(folder, { recursive: true });
  const file = join(dir, 'work/head', source); writeFileSync(file, "import test from 'node:test'; test('real harness assertion', () => {});\n");
  const attribution = join(dir, 'out/suite', `${step}-files.jsonl`);
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const actual = spawnSync(process.execPath, ['--test', '--test-reporter=tap', `--test-reporter=${new URL('./file-reporter.mjs', import.meta.url).href}`, '--test-reporter-destination=stdout', `--test-reporter-destination=${attribution}`, file], { encoding: 'utf8', env });
  assert.equal(actual.status, 0, actual.stderr); writeFileSync(join(dir, 'out/suite', `${step}.log`), actual.stdout);
  const candidate = readRun(dir, expected, manifest(), [step]);
  assert.deepEqual(candidate.errors, []); assert.deepEqual(candidate.steps[step].executedFiles, [source]);
  const baseline = run(tap([{ name: '/work/base/' + source, status: 'fail', loader: true }]), step);
  const result = compareRuns(baseline, candidate, manifest(), new Set([source]));
  assert.equal(result.status, 'pass'); assert.equal(result.fixed[0].kind, 'repaired-loader');
  renameSync(attribution, attribution + '.retained');
  assert.match(readRun(dir, expected, manifest(), [step]).errors.join('\n'), /executed-files attribution/);
});
test('a passing empty-file wrapper and skipped tests do not prove test execution', t => {
  const file = '/work/head/apps/web/src/widget.test.ts';
  const attribution = [{ event: 'test:pass', file, name: file, type: 'test' }, { event: 'test:pass', file, name: 'skipped', type: 'test', skip: true }, { event: 'test:summary' }];
  const dir = fixture(t, { attribution });
  const r = readRun(dir, expected, manifest(), ['V4-web']);
  assert.deepEqual(r.errors, []); assert.deepEqual(r.steps['V4-web'].executedFiles, []);
});
test('different runtime patch versions cannot be compared as the same runner', t => {
  const b = readRun(fixture(t), expected, manifest(), ['V4-web']);
  const c = readRun(fixture(t, { metadata: { nodeVersion: 'v22.24.0' } }), expected, manifest(), ['V4-web']);
  assert.match(compareRuns(b, c, manifest()).blockers.join('\n'), /runtime mismatch/);
});
test('missing step output and unexpected suite skips fail closed', t => {
  const dir = fixture(t, { metadata: { skip: ['V7', 'V8', 'V5'] } });
  const r = readRun(dir, expected, manifest(), ['V4-web', 'V5-server-full']);
  assert.match(r.errors.join('\n'), /missing mandatory step/); assert.match(r.errors.join('\n'), /unexpected suite skips/);
});
test('strong source and runner identities are mandatory for imported results', t => {
  for (const field of Object.keys(expected)) {
    const dir = fixture(t, { metadata: { [field]: 'wrong' } });
    assert.match(readRun(dir, expected, manifest(), ['V4-web']).errors.join('\n'), new RegExp(`metadata mismatch: ${field}`));
  }
  const incomplete = fixture(t, { metadata: { suiteCompleted: false } });
  assert.match(readRun(incomplete, expected, manifest(), ['V4-web']).errors.join('\n'), /did not complete/);
});
test('zero process exit cannot hide failed TAP assertions', t => {
  const dir = fixture(t, { log: tap([{ name: 'bad', status: 'fail' }]) });
  assert.match(readRun(dir, expected, manifest(), ['V4-web']).errors.join('\n'), /hidden by zero exit/);
});
test('no step may be excluded whole: V6-launcher left the CPU gate for V7, and a row for it is unexpected', t => {
  const reason = 'Metal GPU proof belongs to the V7 owner';
  assert.equal(REQUIRED_STEPS.includes('V6-launcher'), false);
  assert.throws(() => validateQuarantine(manifest([{ step: 'V6-launcher', kind: 'step', id: '*', owner: 'L1', reason }])));
  const dir = fixture(t, { step: 'V6-launcher', exit: 'QUARANTINE', log: reason });
  assert.match(readRun(dir, expected, manifest(), ['V4-web']).errors.join('\n'), /unexpected\/duplicate step: V6-launcher/);
  assert.throws(() => validateQuarantine(manifest([{ ...entry('*'), kind: 'step' }])));
  assert.throws(() => validateQuarantine(manifest([entry('*')])));
});
test('a non-TAP infrastructure failure cannot be quarantined at step granularity', t => {
  const dir = fixture(t, { step: 'V1-types', exit: '1', log: 'compiler crashed' });
  assert.match(readRun(dir, expected, manifest(), ['V1-types']).errors.join('\n'), /infrastructure failure/);
});
function scenarioFixture(t, cases, exit = '0') {
  const dir = fixture(t, { step: 'V6-party', exit, log: 'scenario finished' });
  if (cases !== null) writeFileSync(join(dir, 'out/suite/V6-party-cases.json'), JSON.stringify({ schemaVersion: 1, completed: true, steps: cases, harnessFailures: [], sourceReport: '.lane/e2e-party/fixture/report.json' }));
  return readRun(dir, expected, manifest(), ['V6-party']);
}
test('removed scenario checks cannot hide behind the same zero exit code', t => {
  const b = scenarioFixture(t, [{ id: 'scenario 1', status: 'pass' }, { id: 'scenario 2', status: 'pass' }]);
  const c = scenarioFixture(t, [{ id: 'scenario 1', status: 'pass' }]);
  const r = compareRuns(b, c, manifest());
  assert.equal(r.status, 'blocked'); assert.equal(r.removed[0].id, 'scenario 2');
});
test('missing or empty scenario reports fail closed even with a zero exit', t => {
  for (const cases of [null, []]) assert.match(scenarioFixture(t, cases).errors.join('\n'), /scenario case inventory/);
});
test('a represented baseline scenario failure can be fixed, but never quarantined', t => {
  const b = scenarioFixture(t, [{ id: 'scenario 1', status: 'fail' }], '1');
  const c = scenarioFixture(t, [{ id: 'scenario 1', status: 'pass' }]);
  assert.deepEqual(b.errors, []);
  const r = compareRuns(b, c, manifest());
  assert.equal(r.status, 'pass'); assert.equal(r.fixed.length, 1);
  assert.throws(() => validateQuarantine(manifest([entry('scenario 1', { step: 'V6-party' })])), /cannot be quarantined/);
  assert.equal(compareRuns(b, b, manifest()).status, 'blocked');
});
test('opaque V6 script failures without represented cases remain infrastructure blockers', t => {
  const r = scenarioFixture(t, [{ id: 'scenario 1', status: 'pass' }], '1');
  assert.match(r.errors.join('\n'), /without scenario failure evidence/);
});
test('the manifest must explain exactly the two separately owned scope exclusions', () => {
  assert.throws(() => validateQuarantine({ ...manifest(), scopeExclusions: [] }), /scopeExclusions/);
  assert.throws(() => validateQuarantine({ ...manifest(), scopeExclusions: [...manifest().scopeExclusions, { step: 'V5', reason: 'bad', owner: 'bad' }] }), /scopeExclusions/);
});
test('receipt evidence hashes change when returned log contents change', t => {
  const dir = fixture(t);
  const before = readRun(dir, expected, manifest(), ['V4-web']);
  const path = join(dir, 'out/suite/V4-web.log');
  writeFileSync(path, readFileSync(path, 'utf8') + '# extra diagnostic\n');
  const after = readRun(dir, expected, manifest(), ['V4-web']);
  assert.notEqual(before.evidence[path], after.evidence[path]);
});
test('the fixed release contract includes every package/server/web/harness step', () => {
  for (const s of ['V3-packages', 'V3-harness', 'V3-walk', 'V3-bundle', 'V4-web', 'V5-server-full', 'V6-mars-two', 'V6-lm-two']) assert.ok(REQUIRED_STEPS.includes(s));
});

// ── Baseline cache (MODAL-POLICY rule 1): fake Modal runs in a throwaway git repository ────────────────────────────
const shaOf = b => createHash('sha256').update(b).digest('hex');
const gitIn = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();
function gateRepo(t) {
  const dir = mkdtempSync(join(process.env.GATE_TEST_TMPDIR || tmpdir(), 'sim-gate-repo-'));
  t.after(() => retireFixture(dir));
  gitIn(dir, 'init', '-q', '-b', 'main');
  const commit = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text);
    gitIn(dir, 'add', '-A'); gitIn(dir, '-c', 'user.email=gate@test', '-c', 'user.name=gate test', 'commit', '-qm', path);
    return gitIn(dir, 'rev-parse', 'HEAD');
  };
  commit('.gitignore', '.lane/\n');
  commit('tools/test-harness/quarantine.json', JSON.stringify(manifest()));
  return { dir, commit, base: commit('README.md', 'base\n') };
}
/** A complete, passing run of every REQUIRED_STEPS row, shaped like a merged Modal run. */
function writeFullRun(dir, meta, { nodeVersion = 'v22.23.0', steps = REQUIRED_STEPS } = {}) {
  mkdirSync(join(dir, 'out/suite'), { recursive: true });
  writeFileSync(join(dir, 'out/RUN-METADATA.json'), JSON.stringify({ baselineSha: null, suiteCompleted: true, skip: ['V7', 'V8'], serverFiles: [], nodeVersion, pnpmVersion: '10.27.0', ...meta }));
  const rows = ['step\texit\tseconds\tlog'];
  for (const step of steps) {
    let log = tap([{ name: 'works', source: 'apps/web/src/widget.test.ts' }]);
    if (['V1-types', 'V2-build-root', 'V2-build-worlds'].includes(step)) log = 'built\n';
    if (step === 'V3-packages') log = REQUIRED_PACKAGES.map(p => tap([{ name: 'works' }], { prefix: `## ${p}` }) + `## ${p} exit=0\n`).join('');
    if (step.startsWith('V6-')) { log = 'scenario ok\n'; writeFileSync(join(dir, `out/suite/${step}-cases.json`), JSON.stringify({ schemaVersion: 1, completed: true, steps: [{ id: 'case', status: 'pass' }], harnessFailures: [], sourceReport: 'report.json' })); }
    if (step === 'V4-web' || step === 'V3-harness') {
      const c = parseTap(log).counts;
      writeFileSync(join(dir, `out/suite/${step}-files.jsonl`), [{ event: 'test:pass', file: '/work/head/apps/web/src/widget.test.ts', name: 'works', type: 'test' },
        { event: 'test:summary', counts: { tests: c.tests, suites: c.suites, passed: c.pass, failed: c.fail, cancelled: c.cancelled, skipped: c.skipped, todo: c.todo, topLevel: c.topLevel } }].map(e => JSON.stringify(e)).join('\n') + '\n');
    }
    writeFileSync(join(dir, `out/suite/${step}.log`), log); rows.push(`${step}\t0\t1\t/out/suite/${step}.log`);
  }
  rows.push('V8-history-boot\tSKIP\t0\t-');
  writeFileSync(join(dir, 'out/suite/SUMMARY.tsv'), rows.join('\n') + '\n');
}
function fakeModal(calls, nodeVersionFor = () => 'v22.23.0', onlys = []) {
  return async (out, sourceSha, harnessRef, node, root, only = []) => {
    calls.push(sourceSha); onlys.push(only);
    const archive = execFileSync('git', ['-C', root, 'archive', '--format=tar.gz', harnessRef, 'tools/test-harness']);
    writeFullRun(out, { schemaVersion: 1, sourceSha, harnessRef, harnessTree: gitIn(root, 'rev-parse', `${harnessRef}:tools/test-harness`), harnessArchiveSha256: shaOf(archive), node, ...(only.length ? { only } : {}) },
      { nodeVersion: nodeVersionFor(sourceSha), steps: only.length ? only : REQUIRED_STEPS });
    return { exit: 0, timedOut: false, log: join(out, 'gate-driver.log'), logSha256: '' };
  };
}
const gate = async (repo, args, remoteRun, lines = []) => ({ rc: await main(args, { root: repo.dir, remoteRun, log: l => lines.push(l) }), lines });
const receiptOf = out => JSON.parse(readFileSync(join(out, 'receipt.json'), 'utf8'));

test('baseline reuse: a miss runs main once and caches it; the next gate on the same harness tree runs only the candidate', async t => {
  const repo = gateRepo(t), tmp = dirname(repo.dir), cache = mkdtempSync(join(tmp, 'sim-gate-cache-')); t.after(() => retireFixture(cache));
  const c1 = repo.commit('apps/web/src/a.ts', 'one\n'), calls = [];
  const out1 = join(repo.dir, '.lane/g1');
  const first = await gate(repo, [c1, '--baseline', repo.base, '--out', out1, '--cache', cache], fakeModal(calls));
  const r1 = receiptOf(out1);
  assert.equal(first.rc, 0, r1.blockers.join('\n')); assert.deepEqual(calls.sort(), [c1, repo.base].sort());
  assert.equal(r1.baseline.source, 'run'); assert.match(r1.baseline.cacheMiss, /no cached run/);
  assert.deepEqual(r1.cache.stored.map(s => s.label), ['baseline', 'candidate']);
  assert.match(first.lines.at(-1), /baseline_source=run/);
  // a later commit with the identical harness tree: other harness commit and archive bytes, same suite
  const c2 = repo.commit('apps/web/src/b.ts', 'two\n'); calls.length = 0;
  const out2 = join(repo.dir, '.lane/g2');
  const second = await gate(repo, [c2, '--baseline', c1, '--out', out2, '--cache', cache], fakeModal(calls));
  const r2 = receiptOf(out2);
  assert.equal(second.rc, 0, r2.blockers.join('\n')); assert.deepEqual(calls, [c2]);
  assert.equal(r2.baseline.source, 'cached'); assert.equal(r2.baseline.dir, join(cache, `${c1}-${r2.harness.tree}-node22`));
  assert.equal(r2.runs.baseline.metadata.harnessRef, c1); assert.notEqual(r2.runs.baseline.metadata.harnessArchiveSha256, r2.harness.archiveSha256);
  assert.deepEqual(r2.cache.stored.map(s => s.label), ['candidate']); assert.equal(r2.status, 'pass');
  assert.ok(existsSync(join(cache, `${c2}-${r2.harness.tree}-node22/CACHE.json`)));
});
test('a modified cache entry or another harness tree is a miss, never a silent reuse', async t => {
  const repo = gateRepo(t), cache = mkdtempSync(join(dirname(repo.dir), 'sim-gate-cache-')); t.after(() => retireFixture(cache));
  const c1 = repo.commit('apps/web/src/a.ts', 'one\n'), calls = [];
  await gate(repo, [c1, '--baseline', repo.base, '--out', join(repo.dir, '.lane/g1'), '--cache', cache], fakeModal(calls));
  const tree = gitIn(repo.dir, 'rev-parse', 'HEAD:tools/test-harness'), m = manifest();
  assert.equal(lookupCache(cache, { sourceSha: c1, harnessTree: tree, node: '22' }, m).hit, true);
  const log = join(cache, cacheKey({ sourceSha: c1, harnessTree: tree, node: '22' }), 'out/suite/V5-server-full.log');
  writeFileSync(log, readFileSync(log, 'utf8').replace('ok 1 - works', 'ok 1 - works # edited'));
  assert.match(lookupCache(cache, { sourceSha: c1, harnessTree: tree, node: '22' }, m).reason, /changed since it was stored: suite\/V5-server-full.log/);
  assert.match(lookupCache(cache, { sourceSha: c1, harnessTree: 'f'.repeat(40), node: '22' }, m).reason, /no cached run/);
  assert.match(lookupCache(cache, { sourceSha: c1, harnessTree: tree, node: '26' }, m).reason, /no cached run/);
  // the tampered entry is not reused: the gate runs the baseline again and keeps the existing entry untouched
  const c2 = repo.commit('apps/web/src/b.ts', 'two\n'); calls.length = 0;
  const out = join(repo.dir, '.lane/g2');
  await gate(repo, [c2, '--baseline', c1, '--out', out, '--cache', cache], fakeModal(calls));
  const r = receiptOf(out);
  assert.equal(r.baseline.source, 'run'); assert.match(r.baseline.cacheMiss, /changed since/); assert.deepEqual(calls.sort(), [c1, c2].sort());
  assert.equal(r.cache.notStored.find(s => s.label === 'baseline').reason, 'already cached');
});
test('a cached baseline on another Node patch is run again, never compared across runtimes', async t => {
  const repo = gateRepo(t), cache = mkdtempSync(join(dirname(repo.dir), 'sim-gate-cache-')); t.after(() => retireFixture(cache));
  const c1 = repo.commit('apps/web/src/a.ts', 'one\n'), calls = [];
  await gate(repo, [c1, '--baseline', repo.base, '--out', join(repo.dir, '.lane/g1'), '--cache', cache], fakeModal(calls));
  const c2 = repo.commit('apps/web/src/b.ts', 'two\n'); calls.length = 0;
  const out = join(repo.dir, '.lane/g2');
  const { rc } = await gate(repo, [c2, '--baseline', c1, '--out', out, '--cache', cache], fakeModal(calls, () => 'v22.24.0'));
  const r = receiptOf(out);
  assert.equal(rc, 0, r.blockers.join('\n')); assert.deepEqual(calls, [c2, c1]);
  assert.equal(r.baseline.source, 'run'); assert.match(r.baseline.cacheRejected, /runtime v22.23.0\/10.27.0 differs/);
  assert.equal(r.runs.baseline.metadata.nodeVersion, 'v22.24.0');
});
test('--baseline-results alone imports the baseline and runs only the candidate; --candidate-results alone is refused', async t => {
  assert.throws(() => parseArgs(['abc', '--candidate-results', '/x']), /needs --baseline-results/);
  assert.throws(() => parseArgs(['abc', '--dry-run', '--dry-run']), /duplicate option/);
  const repo = gateRepo(t), c1 = repo.commit('apps/web/src/a.ts', 'one\n'), calls = [];
  const first = join(repo.dir, '.lane/g1');
  await gate(repo, [c1, '--baseline', repo.base, '--out', first, '--no-cache'], fakeModal(calls));
  assert.equal(receiptOf(first).cache, undefined);
  const c2 = repo.commit('apps/web/src/b.ts', 'two\n'); calls.length = 0;
  const out = join(repo.dir, '.lane/g2');
  const { rc } = await gate(repo, [c2, '--baseline', c1, '--baseline-results', join(first, 'candidate'), '--out', out, '--no-cache'], fakeModal(calls));
  const r = receiptOf(out);
  assert.equal(rc, 0, r.blockers.join('\n')); assert.deepEqual(calls, [c2]); assert.equal(r.baseline.source, 'imported');
  // the import must be a run of the named baseline
  const wrong = join(repo.dir, '.lane/g3');
  assert.equal((await gate(repo, [c2, '--baseline', repo.base, '--baseline-results', join(first, 'candidate'), '--out', wrong, '--no-cache'], fakeModal([]))).rc, 1);
  assert.match(receiptOf(wrong).blockers.join('\n'), /baseline: metadata mismatch: sourceSha/);
});
test('cache-add stores only a validated run named by a passing gate receipt', async t => {
  const repo = gateRepo(t), cache = mkdtempSync(join(dirname(repo.dir), 'sim-gate-cache-')); t.after(() => retireFixture(cache));
  const c1 = repo.commit('apps/web/src/a.ts', 'one\n');
  const out = join(repo.dir, '.lane/g1');
  await gate(repo, [c1, '--baseline', repo.base, '--out', out, '--no-cache'], fakeModal([]));
  const added = cacheAdd(join(out, 'candidate'), { root: repo.dir, cacheDir: cache });
  assert.equal(added.stored, true, added.reason); assert.equal(cacheAdd(join(out, 'candidate'), { root: repo.dir, cacheDir: cache }).reason, 'already cached');
  const entry = JSON.parse(readFileSync(join(added.dir, 'CACHE.json'), 'utf8'));
  assert.equal(entry.provenance.label, 'candidate'); assert.equal(entry.provenance.receiptSha256, shaOf(readFileSync(join(out, 'receipt.json'))));
  // a blocked gate's run, or a run whose metadata no longer matches its harness, is refused
  const receipt = receiptOf(out); writeFileSync(join(out, 'receipt.json'), JSON.stringify({ ...receipt, status: 'blocked' }));
  assert.match(cacheAdd(join(out, 'baseline'), { root: repo.dir, cacheDir: mkdtempSync(join(dirname(repo.dir), 'sim-gate-cache-')) }).reason, /status blocked/);
  writeFileSync(join(out, 'receipt.json'), JSON.stringify(receipt));
  const meta = join(out, 'baseline/out/RUN-METADATA.json'), m = JSON.parse(readFileSync(meta, 'utf8'));
  writeFileSync(meta, JSON.stringify({ ...m, harnessArchiveSha256: 'e'.repeat(64) }));
  assert.match(cacheAdd(join(out, 'baseline'), { root: repo.dir, cacheDir: cache }).reason, /metadata mismatch: harnessArchiveSha256/);
});
test('a dry run prints the plan without Modal and without writing an output directory', async t => {
  const repo = gateRepo(t), cache = mkdtempSync(join(dirname(repo.dir), 'sim-gate-cache-')); t.after(() => retireFixture(cache));
  const c1 = repo.commit('apps/web/src/a.ts', 'one\n');
  const never = async () => { throw Error('Modal contacted'); };
  const out = join(repo.dir, '.lane/dry');
  const miss = await gate(repo, [c1, '--baseline', repo.base, '--out', out, '--cache', cache, '--dry-run'], never);
  assert.equal(miss.rc, 0); assert.ok(!existsSync(out));
  assert.match(miss.lines.at(-1), /RELEASE_GATE_PLAN .*baseline_source=run modal_runs=2/);
  assert.deepEqual(JSON.parse(miss.lines[0]).modalRuns, ['candidate', 'baseline']);
  await gate(repo, [c1, '--baseline', repo.base, '--out', join(repo.dir, '.lane/g1'), '--cache', cache], fakeModal([]));
  const hit = await gate(repo, ['HEAD', '--baseline', c1, '--out', out, '--cache', cache, '--dry-run'], never);
  assert.match(hit.lines.at(-1), /baseline_source=cached modal_runs=1/); assert.ok(!existsSync(out));
  const help = await gate(repo, ['--help'], never);
  assert.equal(help.rc, 0); assert.match(help.lines[0], /usage: release-gate.sh/);
});

// ── Scoped candidate gates (MODAL-POLICY rule 4) ──────────────────────────────────────────────────────────────────
test('scope: steps follow the changed areas; docs/tools never gate; anything unnamed takes the full contract', () => {
  const V6 = REQUIRED_STEPS.filter(s => s.startsWith('V6-'));
  assert.deepEqual(scopeFor(['apps/web/src/a.ts']).steps, ['V1-types', 'V2-build-root', 'V2-build-worlds', 'V3-bundle', 'V4-web']);
  assert.deepEqual(scopeFor(['apps/server/src/a.ts']).steps, ['V1-types', 'V3-packages', 'V3-walk', 'V5-server-full', ...V6]);
  assert.deepEqual(scopeFor(['packages/kernel/src/a.ts']).steps, ['V1-types', 'V3-packages', 'V3-mars-engine', 'V3-walk', 'V5-server-full']);
  assert.deepEqual(scopeFor(['tools/world-launcher/launcher.mjs']).steps, ['V3-launcher-unit', ...V6]);
  assert.deepEqual(scopeFor(['tools/edge-skill/a.mjs', 'tools/client-eval/b.mjs']).steps, ['V3-client-cli']);
  const none = scopeFor(['docs/a.md', 'tools/test-harness/x.mjs', 'tools/ops/y.sh', 'README.md', '']);
  assert.equal(none.resolved, 'none'); assert.deepEqual(none.steps, []); assert.deepEqual(none.diff.byArea, { 'docs/': 2, 'tools/': 2 });
  for (const f of ['pnpm-lock.yaml', 'package.json', 'mars/viewer/engine/x.ts', 'worlds/eden/a.json', 'vendor/x.js', '.github/workflows/ci.yml']) {
    const r = scopeFor(['apps/web/src/a.ts', f]);
    assert.equal(r.resolved, 'full', f); assert.deepEqual(r.steps, REQUIRED_STEPS); assert.deepEqual(r.diff.unmapped, [f]);
  }
  // all three product areas: everything but the client CLI, launcher and harness self-tests
  assert.deepEqual(REQUIRED_STEPS.filter(s => !scopeFor(['apps/web/a.ts', 'apps/server/b.ts', 'packages/c/d.ts']).steps.includes(s)), ['V3-client-cli', 'V3-launcher-unit', 'V3-harness']);
  assert.throws(() => parseArgs(['abc', '--scope', 'some']), /--scope is full or auto/);
});
test('scope auto: a web-only candidate runs only its steps against the cached full baseline and is never cached', async t => {
  const repo = gateRepo(t), cache = mkdtempSync(join(dirname(repo.dir), 'sim-gate-cache-')); t.after(() => retireFixture(cache));
  const c1 = repo.commit('apps/server/src/a.ts', 'one\n'), calls = [];
  await gate(repo, [c1, '--baseline', repo.base, '--out', join(repo.dir, '.lane/g1'), '--cache', cache], fakeModal(calls));
  const c2 = repo.commit('apps/web/src/b.ts', 'two\n'); calls.length = 0; const onlys = [];
  const out = join(repo.dir, '.lane/g2');
  const { rc, lines } = await gate(repo, [c2, '--baseline', c1, '--out', out, '--cache', cache, '--scope', 'auto'], fakeModal(calls, undefined, onlys));
  const r = receiptOf(out);
  assert.equal(rc, 0, r.blockers.join('\n')); assert.deepEqual(calls, [c2]);
  assert.deepEqual(onlys, [['V1-types', 'V2-build-root', 'V2-build-worlds', 'V3-bundle', 'V4-web']]);
  assert.equal(r.scope.mode, 'auto'); assert.equal(r.scope.resolved, 'scoped'); assert.deepEqual(r.scope.diff.byArea, { 'apps/web/': 1 });
  assert.equal(r.scope.diff.range, `${c1}..${c2}`); assert.equal(r.baseline.source, 'cached'); assert.equal(r.status, 'pass');
  assert.deepEqual(r.cache.stored, []); assert.match(lines.at(-1), /scope=scoped/);
  // a scoped run is never a full-gate run: not as a baseline, not in the cache
  const full = readRun(join(out, 'candidate'), { schemaVersion: 1, sourceSha: c2, harnessTree: r.harness.tree, node: '22' }, manifest());
  assert.match(full.errors.join('\n'), /scoped run .* is not a full gate run/);
  assert.match(storeCache(cache, { ...full, errors: [] }).reason, /scoped run/);
  // the full default on the same head runs every step again
  onlys.length = 0;
  const fullOut = join(repo.dir, '.lane/g3');
  await gate(repo, [c2, '--baseline', c1, '--out', fullOut, '--cache', cache], fakeModal([], undefined, onlys));
  assert.deepEqual(onlys, [[]]); assert.equal(receiptOf(fullOut).scope.resolved, 'full'); assert.equal(receiptOf(fullOut).cache.stored[0].label, 'candidate');
});
test('scope auto: docs/tools-only candidates are not gated (exit 0, no Modal); an unnamed path runs the full contract', async t => {
  const repo = gateRepo(t), cache = mkdtempSync(join(dirname(repo.dir), 'sim-gate-cache-')); t.after(() => retireFixture(cache));
  const c1 = repo.commit('docs/notes.md', 'notes\n');
  const c2 = repo.commit('tools/ops/tool.sh', 'echo\n');
  const out = join(repo.dir, '.lane/none'), never = async () => { throw Error('Modal contacted'); };
  const { rc, lines } = await gate(repo, [c2, '--baseline', repo.base, '--out', out, '--cache', cache, '--scope', 'auto'], never);
  const r = receiptOf(out);
  assert.equal(rc, 0); assert.equal(r.status, 'not-gated'); assert.equal(r.scope.resolved, 'none'); assert.deepEqual(r.blockers, []);
  assert.deepEqual(r.scope.diff.byArea, { 'docs/': 1, 'tools/': 1 }); assert.match(lines.at(-1), /RELEASE_GATE NOT-GATED .*scope=none/);
  const dry = await gate(repo, [c2, '--baseline', repo.base, '--cache', cache, '--scope', 'auto', '--dry-run'], never);
  assert.match(dry.lines.at(-1), /scope=none modal_runs=0/);
  const c3 = repo.commit('pnpm-lock.yaml', 'lock\n'), onlys = [];
  const fullOut = join(repo.dir, '.lane/full');
  await gate(repo, [c3, '--baseline', c1, '--out', fullOut, '--cache', cache, '--scope', 'auto'], fakeModal([], undefined, onlys));
  const f = receiptOf(fullOut);
  assert.equal(f.scope.resolved, 'full'); assert.deepEqual(f.scope.diff.unmapped, ['pnpm-lock.yaml']); assert.deepEqual(onlys, [[], []]);
});
test('cache-add stores a bare remote-suite run (no gate receipt) only when it passes on its own quarantine', async t => {
  const repo = gateRepo(t), cache = mkdtempSync(join(dirname(repo.dir), 'sim-gate-cache-')); t.after(() => retireFixture(cache));
  const c1 = repo.commit('apps/web/src/a.ts', 'one\n'), head = gitIn(repo.dir, 'rev-parse', 'HEAD');
  const runs = join(repo.dir, '.lane/runs'), bare = join(runs, 'bare'), failing = join(runs, 'failing');
  await fakeModal([])(bare, c1, head, '22', repo.dir);
  await fakeModal([])(failing, c1, head, '22', repo.dir);
  assert.ok(!existsSync(join(runs, 'receipt.json')));
  // an unquarantined test failure in an otherwise complete run is refused
  writeFileSync(join(failing, 'out/suite/V5-server-full.log'), tap([{ name: 'works', status: 'fail', source: 'apps/server/src/a.test.ts' }]));
  writeFileSync(join(failing, 'out/suite/SUMMARY.tsv'), readFileSync(join(failing, 'out/suite/SUMMARY.tsv'), 'utf8').replace('V5-server-full\t0', 'V5-server-full\t1'));
  const refused = cacheAdd(failing, { root: repo.dir, cacheDir: cache });
  assert.equal(refused.stored, false); assert.match(refused.reason, /run: V5-server-full: baseline failure has no quarantine: works/);
  const added = cacheAdd(bare, { root: repo.dir, cacheDir: cache });
  assert.equal(added.stored, true, added.reason);
  assert.equal(added.key, `${c1}-${gitIn(repo.dir, 'rev-parse', 'HEAD:tools/test-harness')}-node22`);
  const entry = JSON.parse(readFileSync(join(added.dir, 'CACHE.json'), 'utf8'));
  assert.deepEqual(entry.provenance, { via: 'cache-add-bare', receipt: null });
  assert.equal(lookupCache(cache, { sourceSha: c1, harnessTree: entry.harnessTree, node: '22' }, manifest()).hit, true);
  // a wrong harness identity is still refused without a receipt
  const meta = join(failing, 'out/RUN-METADATA.json'), m = JSON.parse(readFileSync(meta, 'utf8'));
  writeFileSync(meta, JSON.stringify({ ...m, harnessTree: 'a'.repeat(40) }));
  assert.match(cacheAdd(failing, { root: repo.dir, cacheDir: cache }).reason, /metadata mismatch: harnessTree/);
});

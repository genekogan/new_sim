import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compareRuns, parseTap, readRun, validateQuarantine, REQUIRED_STEPS } from './release-gate.mjs';

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
  t.after(() => rmSync(dir, { recursive: true, force: true }));
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
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'out/suite'), { recursive: true });
  writeFileSync(join(dir, 'out/RUN-METADATA.json'), JSON.stringify({ ...expected, baselineSha: null, suiteCompleted: true, skip: ['V7', 'V8'], serverFiles: [], nodeVersion: 'v22.23.0', pnpmVersion: '10.27.0', ...metadata }));
  if (summary) writeFileSync(join(dir, 'out/suite/SUMMARY.tsv'), `step\texit\tseconds\tlog\n${step}\t${exit}\t2\t/out/suite/${step}.log\nV8-history-boot\tSKIP\t0\t-\n`);
  if (log !== null) writeFileSync(join(dir, `out/suite/${step}.log`), log);
  if (attribution) {
    const c = parseTap(log || '').counts;
    const counts = { tests: c.tests, suites: c.suites, passed: c.pass, failed: c.fail, cancelled: c.cancelled, skipped: c.skipped, todo: c.todo, topLevel: c.topLevel };
    writeFileSync(join(dir, 'out/suite/V4-web-files.jsonl'), attribution.map(e => JSON.stringify(e.event === 'test:summary' && e.counts === undefined ? { ...e, counts } : e)).join('\n') + '\n');
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
  for (const s of ['V3-packages', 'V3-harness', 'V3-walk', 'V4-web', 'V5-server-full', 'V6-mars-two', 'V6-lm-two']) assert.ok(REQUIRED_STEPS.includes(s));
});

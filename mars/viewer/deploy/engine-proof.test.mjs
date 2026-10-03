import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { engineCommand, eventCollector, hash, readEngineProof, validatePayload } from './engine-proof.mjs';
import { nodeTestSummary } from './gate-runtime.mjs';

const identity = { head: 'a'.repeat(40), clean: true, node: process.version, fingerprint: 'b'.repeat(64), files: ['one.test.ts', 'two.test.ts'], options: 'c'.repeat(64) };
const event = (file, name, extra = {}) => ({ type: 'test:pass', data: { file: `/fixture/${file}`, name, nesting: 0, details: { duration_ms: 3 }, ...extra } });
function payload() {
  const collector = eventCollector(identity.files);
  collector.accept(event('one.test.ts', 'same title'));
  collector.accept(event('two.test.ts', 'same title', { skip: 'parked' }));
  collector.accept(event('two.test.ts', 'pending regression', { todo: 'W51' }));
  collector.accept({ type: 'test:stdout', data: { file: '/fixture/one.test.ts', message: 'flagship numbers\n' } });
  return { schema: 1, completed: true, node: process.version, identity, ...collector.finish(9) };
}

test('structured events retain file identity, skipped/TODO meaning and failures', () => {
  const good = payload();
  assert.equal(validatePayload(good, identity), good);
  assert.deepEqual(good.results.map((r) => [r.file, r.name, r.result]), [['one.test.ts', 'same title', 'pass'], ['two.test.ts', 'same title', 'skip'], ['two.test.ts', 'pending regression', 'todo']]);
  const collector = eventCollector(['one.test.ts']);
  collector.accept({ ...event('one.test.ts', 'failed'), type: 'test:fail' });
  const failed = { schema: 1, completed: true, node: process.version, identity: { ...identity, files: ['one.test.ts'] }, ...collector.finish(1) };
  assert.throws(() => validatePayload(failed, failed.identity), /failing/);
  collector.accept({ type: 'test:fail', data: { file: '/fixture/one.test.ts', name: '/fixture/one.test.ts', nesting: 0, details: { error: new Error('load failed') } } });
  assert.equal(collector.fileErrors[0].error, 'load failed');
});

test('incomplete, stale, dirty, missing-file and altered-count receipts refuse', () => {
  for (const mutate of [p => { p.completed = false; }, p => { p.node = 'different'; }, p => { p.identity = { ...identity, head: 'd'.repeat(40) }; }, p => { p.seenFiles.pop(); }, p => { p.suite.pass++; }, p => { p.results[0].file = 'foreign.test.ts'; }]) {
    const p = structuredClone(payload()); mutate(p);
    assert.throws(() => validatePayload(p, identity));
  }
  assert.throws(() => validatePayload(payload(), { ...identity, clean: false }), /dirty/);
});

test('gate binding rejects checksum edits, stale source, red/interrupted gates and path escape', () => {
  const viewer = mkdtempSync(join(tmpdir(), 'mars-engine-proof-'));
  try {
    const dir = join(viewer, '.cloudflare/gate/001'); mkdirSync(dir, { recursive: true });
    const bytes = JSON.stringify(payload()); writeFileSync(join(dir, 'engine-proof.json'), bytes);
    const step = { step: 'test-engine', command: 'node --test fixture', status: 'pass', exitCode: 0, timedOut: false, tests: 3, pass: 1, fail: 0, skipped: 1, todo: 1, engineProof: { path: '.cloudflare/gate/001/engine-proof.json', sha256: hash(bytes) } };
    const gate = { path: '.cloudflare/gate/001/report.json', reason: '', report: { ok: true, finishedAt: '2026-10-01', gitDirty: false, interrupted: null, cleanupError: null, sourceIdentity: identity, steps: [step] } };
    const read = (g, id = identity) => readEngineProof(viewer, g, () => id, () => ['node', '--test', 'fixture']);
    assert.equal(read(gate).suite.pass, 1);
    assert.throws(() => read(gate, { ...identity, fingerprint: 'e'.repeat(64) }), /fingerprint/);
    for (const patch of [{ ok: false }, { interrupted: 'SIGINT' }, { cleanupError: 'owned process remained' }, { gitDirty: true }]) assert.throws(() => read({ ...gate, report: { ...gate.report, ...patch } }), /green/);
    assert.throws(() => read({ ...gate, report: { ...gate.report, steps: [{ ...step, command: 'node --test filtered' }] } }), /command/);
    assert.throws(() => read({ ...gate, report: { ...gate.report, steps: [{ ...step, pass: 2 }] } }), /counters/);
    assert.throws(() => read({ ...gate, report: { ...gate.report, steps: [{ ...step, engineProof: { ...step.engineProof, path: '../foreign.json' } }] } }), /directory/);
    writeFileSync(join(dir, 'engine-proof.json'), bytes + ' ');
    assert.throws(() => read(gate), /checksum/);
    assert.throws(() => read({ ...gate, report: { ...gate.report, steps: [] } }), /new full gate or standalone/);
  } finally { rmSync(viewer, { recursive: true, force: true }); }
});

test('native CLI custom reporter runs the same fixture suite, TAP counts and nonzero failure exit', () => {
  const viewer = mkdtempSync(join(tmpdir(), 'mars-engine-reporter-'));
  const reporter = join(dirname(fileURLToPath(import.meta.url)), 'engine-proof-reporter.mjs');
  try {
    mkdirSync(join(viewer, 'engine/test'), { recursive: true });
    writeFileSync(join(viewer, 'package.json'), JSON.stringify({ scripts: { 'test:engine': 'node --test engine/test/*.test.ts' } }));
    writeFileSync(join(viewer, 'engine/test/one.test.ts'), "import test from 'node:test'; import assert from 'node:assert/strict'; test('same title',()=>assert.equal(1,1));\n");
    writeFileSync(join(viewer, 'engine/test/two.test.ts'), "import test from 'node:test'; test('parked',{skip:'parked'},()=>{});test('pending',{todo:'W51'},()=>{throw Error('pending')});\n");
    assert.deepEqual(engineCommand(viewer).slice(3), ['engine/test/one.test.ts', 'engine/test/two.test.ts']);
    const proof = join(viewer, 'engine-proof.json'); writeFileSync(`${proof}.identity.json`, JSON.stringify(identity));
    const files = identity.files.map((f) => join(viewer, 'engine/test', f));
    // A child of node:test inherits its internal child marker. These fixtures
    // intentionally start a new CLI runner, just as gate.mjs does outside tests.
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const baseline = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], { encoding: 'utf8', env });
    const observed = spawnSync(process.execPath, ['--test', `--test-reporter=${reporter}`, ...files], { encoding: 'utf8', env: { ...env, MARS_ENGINE_PROOF: proof } });
    assert.equal(observed.status, baseline.status, observed.stderr);
    assert.deepEqual(nodeTestSummary(observed.stdout), nodeTestSummary(baseline.stdout));
    const p = validatePayload(JSON.parse(readFileSync(proof, 'utf8')), identity);
    assert.equal(p.suite.pass, 1); assert.equal(p.suite.skip, 1); assert.equal(p.suite.todo, 1);
    writeFileSync(files[0], "import test from 'node:test';test('real failure',()=>{throw Error('real failure')});\n");
    const failed = spawnSync(process.execPath, ['--test', `--test-reporter=${reporter}`, ...files], { encoding: 'utf8', env: { ...env, MARS_ENGINE_PROOF: proof } });
    assert.equal(failed.status, 1);
    assert.throws(() => validatePayload(JSON.parse(readFileSync(proof, 'utf8')), identity), /failing/);
  } finally { rmSync(viewer, { recursive: true, force: true }); }
});

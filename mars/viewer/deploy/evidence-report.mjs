#!/usr/bin/env node
// Milestone evidence report (SPEC.md §30): runs the engine suite, checks every
// test cited by engine/test/evidence-map.json, and writes
// docs/engineering/EVIDENCE.md (human) + docs/engineering/evidence.json (machine).
//   npm run evidence          (~1–4 min; the campus flagship dominates)
// Status per §28 row / capability beyond §28 / §30 milestone: PROVEN = every mapped test passed;
// PARTIAL = some passed; UNPROVEN = no mapped tests, or none passed.
// Exits 1 if a mapped title matches no test (renamed/removed) or several tests,
// or if any test in the suite fails. The report is written either way.
//
// Tests run through node:test's run() (same runner and per-file process
// isolation as `node --test`), because its events carry the source file of
// every test; the TAP stream does not.
import { run } from 'node:test';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const viewer = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(viewer, '..');
const testDir = join(viewer, 'engine/test');
const mapPath = join(testDir, 'evidence-map.json');
const outMd = join(repo, 'docs/engineering/EVIDENCE.md');
const outJson = join(repo, 'docs/engineering/evidence.json');
const map = JSON.parse(readFileSync(mapPath, 'utf8'));

// ---- 1. run the suite ------------------------------------------------------
const files = readdirSync(testDir).filter((f) => f.endsWith('.test.ts')).sort().map((f) => join(testDir, f));
const results = []; // { file, name, result: pass|fail|skip, durationMs, error? }
const stdout = [];
const fileErrors = [];
const t0 = Date.now();
console.error(`evidence: running ${files.length} engine test files…`);
await new Promise((resolve, reject) => {
  const stream = run({ files, concurrency: true });
  const record = (result) => (d) => {
    if (d.details?.type === 'suite') return;
    const file = d.file ? basename(d.file) : '';
    // a file that fails to load is reported as a failing test named after the file
    if (d.nesting === 0 && d.file && d.name === d.file) { if (result === 'fail') fileErrors.push({ file, error: String(d.details?.error?.message ?? d.details?.error ?? '') }); return; }
    const r = d.skip ? 'skip' : d.todo ? 'todo' : result;
    results.push({ file, name: d.name, nesting: d.nesting, result: r, durationMs: Math.round(d.details?.duration_ms ?? 0), ...(result === 'fail' ? { error: String(d.details?.error?.cause?.message ?? d.details?.error?.message ?? '').split('\n')[0].slice(0, 300) } : {}) });
  };
  stream.on('test:pass', record('pass'));
  stream.on('test:fail', record('fail'));
  stream.on('test:stdout', (d) => stdout.push({ file: d.file ? basename(d.file) : '', message: d.message }));
  stream.on('test:stderr', () => {});
  stream.on('error', reject);
  stream.on('end', resolve);
  stream.resume?.();
});
const suiteMs = Date.now() - t0;
const top = results.filter((r) => r.nesting === 0);
const count = (k) => top.filter((r) => r.result === k).length;
const suite = { files: files.length, tests: top.length, pass: count('pass'), fail: count('fail'), skip: count('skip') + count('todo'), fileErrors: fileErrors.length, wallMs: suiteMs };
console.error(`evidence: ${suite.tests} tests, ${suite.pass} pass, ${suite.fail} fail, ${suite.skip} skip (${(suiteMs / 1000).toFixed(1)} s)`);

// ---- 2. flagship numbers + determinism probe --------------------------------
const allOut = stdout.map((s) => s.message).join('');
const parseFlagship = (re) => {
  const m = allOut.match(re);
  return m ? { line: m[0].trim(), steps: +m[1], simulatedS: +m[2], computeMs: +m[3], ...(m[4] ? { takeBytes: +m[4] } : {}) } : null;
};
const flagship = {
  provingGround: parseFlagship(/flagship rehearsal: (\d+) steps, ([\d.]+) s simulated, (\d+) ms compute/),
  campus: parseFlagship(/campus flagship: (\d+) steps, ([\d.]+) s simulated, (\d+) ms compute, take (\d+) bytes/),
  campusFull: parseFlagship(/campus full: (\d+) steps, ([\d.]+) s simulated, (\d+) ms compute/),
};
{
  const h = (re) => allOut.match(re)?.[1] ?? null;
  if (flagship.campusFull) Object.assign(flagship.campusFull, { finalStateHash: h(/campus full: \d+ steps.*final ([0-9a-f]{64})/), croppedComputeMs: +(h(/campus crop: \d+ steps, [\d.]+ s simulated, (\d+) ms compute/) ?? NaN), croppedFinalStateHash: h(/campus crop: \d+ steps.*final ([0-9a-f]{64})/) });
}
let probe;
{
  const p = spawnSync(process.execPath, [join(viewer, 'deploy/determinism-probe.mjs'), '--json'], { cwd: viewer, encoding: 'utf8', timeout: 300_000 });
  const line = (p.stdout ?? '').trim().split('\n').pop();
  try { probe = JSON.parse(line); } catch { probe = { error: `determinism probe failed (exit ${p.status}): ${(p.stderr || p.stdout || '').trim().split('\n').slice(-3).join(' | ').slice(0, 400)}` }; }
}

// ---- 3. match the map against the run -----------------------------------------
const missing = [], ambiguous = [];
const cited = new Set();
const key = (r) => `${r.file}\u0000${r.name}`;
function evaluate(entry, where) {
  const tests = entry.tests.map((t) => {
    const hits = top.filter((r) => r.file === t.file && r.name.includes(t.title));
    if (hits.length === 0) { missing.push(`${where}: ${t.file} :: "${t.title}"`); return { ...t, result: 'missing' }; }
    if (hits.length > 1) { ambiguous.push(`${where}: ${t.file} :: "${t.title}" matches ${hits.length} tests`); }
    hits.forEach((h) => cited.add(key(h)));
    const h = hits[0];
    return { ...t, name: h.name, result: h.result, durationMs: h.durationMs, ...(h.error ? { error: h.error } : {}) };
  });
  const passed = tests.filter((t) => t.result === 'pass').length;
  const status = tests.length === 0 || passed === 0 ? 'UNPROVEN' : passed === tests.length ? 'PROVEN' : 'PARTIAL';
  const extra = {};
  if (entry.outsideSuite) extra.outsideSuite = entry.outsideSuite.map((p) => ({ path: p, exists: existsSync(join(repo, p)) }));
  return { id: entry.id, name: entry.name, status, passed, total: tests.length, required: entry.required ?? entry.demonstration, approximate: entry.approximate, ...(entry.untested ? { untested: entry.untested } : {}), ...extra, tests };
}
const rows = map.rows.map((r) => evaluate(r, `§28 ${r.name}`));
const capabilities = (map.capabilities ?? []).map((r) => evaluate(r, `capability ${r.name}`));
const milestones = map.milestones.map((m) => evaluate(m, `§30 ${m.id}`));
const tally = (xs) => Object.fromEntries(['PROVEN', 'PARTIAL', 'UNPROVEN'].map((s) => [s, xs.filter((x) => x.status === s).length]));
const unmapped = top.filter((r) => !cited.has(key(r))).map((r) => ({ file: r.file, name: r.name, result: r.result }));

// ---- 4. provenance + diff against the previous report -----------------------
const git = (...a) => { try { return execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim(); } catch { return null; } };
const head = git('rev-parse', '--short', 'HEAD');
const dirty = (git('status', '--porcelain', '--', 'viewer/engine') ?? '').split('\n').filter(Boolean);
let since = null;
if (existsSync(outJson)) {
  try {
    const prev = JSON.parse(readFileSync(outJson, 'utf8'));
    const names = (list) => new Set(list.map((t) => `${t.file} :: ${t.name}`));
    const before = names(prev.allTests ?? []), now = names(top);
    since = { previousHead: prev.git?.head ?? null, previousDate: prev.generatedAt ?? null, added: [...now].filter((n) => !before.has(n)).sort(), removed: [...before].filter((n) => !now.has(n)).sort() };
  } catch { since = null; }
}

const report = {
  generatedBy: 'viewer/deploy/evidence-report.mjs',
  map: relative(repo, mapPath),
  generatedAt: new Date().toISOString(),
  git: { head, dirtyEngineFiles: dirty.length },
  node: process.version,
  suite,
  flagship: { ...flagship, determinismProbe: probe },
  statusCounts: { rows: tally(rows), capabilities: tally(capabilities), milestones: tally(milestones) },
  problems: { missing, ambiguous, fileErrors, failingTests: top.filter((r) => r.result === 'fail').map((r) => ({ file: r.file, name: r.name, error: r.error })) },
  rows,
  capabilities,
  milestones,
  unmapped,
  sinceLastReport: since,
  allTests: top.map(({ file, name, result, durationMs }) => ({ file, name, result, durationMs })),
};
writeFileSync(outJson, JSON.stringify(report, null, 2) + '\n');

// ---- 5. markdown ---------------------------------------------------------------
const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const RES = { pass: 'pass', fail: '**FAIL**', skip: 'skip', todo: 'todo', missing: '**MISSING**' };
const md = [];
const c = report.statusCounts;
md.push('# Engine evidence report', '');
md.push('Generated by `node deploy/evidence-report.mjs` (in `viewer/`, or `npm run evidence`). Do not edit by hand:',
  'change the hand-curated map `viewer/engine/test/evidence-map.json` and regenerate. Machine-readable copy:',
  '`docs/engineering/evidence.json`. This is the evidence report that SPEC.md §30 asks for: what each §28 row and',
  '§30 milestone has proven, what remains approximate, and which regressions are new. Engine capabilities added beyond',
  'the §28 table are reported the same way in their own section.', '');
md.push('| | |', '| --- | --- |');
md.push(`| Git HEAD | \`${head ?? 'unknown'}\`${dirty.length ? ` (${dirty.length} uncommitted file(s) under \`viewer/engine\` at run time)` : ' (engine tree clean)'} |`);
md.push(`| Generated | ${report.generatedAt} · Node ${process.version} |`);
md.push(`| Engine suite | ${suite.tests} tests in ${suite.files} files: ${suite.pass} pass, ${suite.fail} fail, ${suite.skip} skipped${suite.fileErrors ? `, ${suite.fileErrors} file(s) failed to load` : ''} · ${(suiteMs / 1000).toFixed(1)} s wall |`);
md.push(`| §28 rows | ${c.rows.PROVEN} PROVEN · ${c.rows.PARTIAL} PARTIAL · ${c.rows.UNPROVEN} UNPROVEN (of ${rows.length}) |`);
md.push(`| Capabilities beyond §28 | ${c.capabilities.PROVEN} PROVEN · ${c.capabilities.PARTIAL} PARTIAL · ${c.capabilities.UNPROVEN} UNPROVEN (of ${capabilities.length}) |`);
md.push(`| §30 milestones | ${c.milestones.PROVEN} PROVEN · ${c.milestones.PARTIAL} PARTIAL · ${c.milestones.UNPROVEN} UNPROVEN (of ${milestones.length}) |`);
const fl = (f) => (f ? `${f.steps} steps, ${f.simulatedS} s simulated, ${f.computeMs} ms compute${f.takeBytes ? `, take ${f.takeBytes} B` : ''}` : 'not found in test output');
md.push(`| Flagship, proving ground | ${fl(flagship.provingGround)} (\`build-bay.test.ts\`) |`);
md.push(`| Flagship, 2026 campus | ${fl(flagship.campus)} (\`campus-flagship.test.ts\`) |`);
{
  const f = flagship.campusFull;
  md.push(`| Flagship, full uncropped campus | ${f ? `${fl(f)} (cropped ${f.croppedComputeMs} ms in the same test) · final \`${f.finalStateHash?.slice(0, 8)}…\` ${f.finalStateHash === f.croppedFinalStateHash ? '=' : '≠'} cropped \`${f.croppedFinalStateHash?.slice(0, 8)}…\`` : 'not found in test output'} (\`campus-full.test.ts\`) |`);
}
md.push(probe.error
  ? `| Determinism probe | ${esc(probe.error)} |`
  : `| Determinism probe | \`${probe.scenario}\` ${probe.status}, ${probe.ticks} ticks · final state \`${probe.finalStateHash}\` · take \`${probe.takeId}\` · engine math \`${probe.engineMath}\` (\`deploy/determinism-probe.mjs\`) |`);
md.push('');
md.push('**Status.** PROVEN = every mapped test passed in this run. PARTIAL = some did. UNPROVEN = no mapped test, or none passed.',
  'PROVEN means only that the listed tests pass; the approximation notes say what they do not show.', '');
if (missing.length || ambiguous.length || suite.fail || fileErrors.length) {
  md.push('## Problems in this run', '');
  for (const m of missing) md.push(`- Mapped test not found (renamed or removed?): ${esc(m)}`);
  for (const m of ambiguous) md.push(`- Ambiguous mapping: ${esc(m)}`);
  for (const f of report.problems.failingTests) md.push(`- Failing: \`${f.file}\` — ${esc(f.name)}${f.error ? ` — ${esc(f.error)}` : ''}`);
  for (const f of fileErrors) md.push(`- File failed to load: \`${f.file}\` ${esc(f.error)}`);
  md.push('');
}
function section(title, entries, label) {
  md.push(`## ${title}`, '');
  md.push(`| ${label} | Status | Tests passed | What remains approximate |`, '| --- | --- | ---: | --- |');
  for (const e of entries) md.push(`| ${label === 'Milestone' ? `${e.id}. ` : ''}${esc(e.name)} | ${e.status} | ${e.passed}/${e.total} | ${esc(e.approximate)} |`);
  md.push('');
  for (const e of entries) {
    md.push(`### ${label === 'Milestone' ? `${e.id}. ` : ''}${e.name} — ${e.status}`, '');
    md.push(`*Required:* ${e.required}`, '');
    if (e.tests.length === 0) md.push(`**No test.** ${e.untested ?? 'Nothing in engine/test proves this yet.'}`, '');
    else {
      md.push('| Result | File | Test |', '| --- | --- | --- |');
      for (const t of e.tests) md.push(`| ${RES[t.result] ?? t.result} | \`${t.file}\` | ${esc(t.name ?? t.title)}${t.error ? ` — ${esc(t.error)}` : ''} |`);
      md.push('');
    }
    if (e.outsideSuite) md.push(`*Evidence outside this suite (not run here):* ${e.outsideSuite.map((o) => `\`${o.path}\`${o.exists ? '' : ' (missing)'}`).join(', ')}`, '');
    md.push(`*Approximate:* ${e.approximate}`, '');
  }
}
section('SPEC §28 behavioural regressions', rows, 'Row');
if (capabilities.length) section('Capabilities beyond §28', capabilities, 'Capability');
section('SPEC §30 milestones', milestones, 'Milestone');
md.push('## New regressions since the previous report', '');
if (!since) md.push('No previous `evidence.json`; this run is the baseline. Future runs list tests added or removed since it.', '');
else {
  md.push(`Compared with the report at \`${since.previousHead ?? '?'}\` (${since.previousDate ?? '?'}): ${since.added.length} added, ${since.removed.length} removed.`, '');
  for (const a of since.added) md.push(`- added: ${esc(a)}`);
  for (const r of since.removed) md.push(`- removed: ${esc(r)}`);
  md.push('');
}
md.push('## Tests not cited by any row or milestone', '');
md.push(`${unmapped.length} of ${top.length} tests are not in the map (unit, perf, API, sun, campus-extraction and other supporting tests). They run and must pass, but no row or milestone claims them.`, '');
md.push('<details><summary>List</summary>', '');
for (const u of unmapped) md.push(`- \`${u.file}\` ${RES[u.result] ?? u.result}: ${esc(u.name)}`);
md.push('', '</details>', '');
writeFileSync(outMd, md.join('\n'));

// ---- 6. verdict --------------------------------------------------------------------
console.log(`evidence: rows ${c.rows.PROVEN} PROVEN / ${c.rows.PARTIAL} PARTIAL / ${c.rows.UNPROVEN} UNPROVEN; capabilities ${c.capabilities.PROVEN} / ${c.capabilities.PARTIAL} / ${c.capabilities.UNPROVEN}; milestones ${c.milestones.PROVEN} / ${c.milestones.PARTIAL} / ${c.milestones.UNPROVEN}`);
console.log(`evidence: wrote ${relative(process.cwd(), outMd)} and ${relative(process.cwd(), outJson)}`);
let bad = false;
if (missing.length) { bad = true; console.error(`evidence: ${missing.length} mapped test title(s) not found in the run:\n  ${missing.join('\n  ')}`); }
if (ambiguous.length) { bad = true; console.error(`evidence: ${ambiguous.length} ambiguous mapping(s):\n  ${ambiguous.join('\n  ')}`); }
if (suite.fail || fileErrors.length) { bad = true; console.error(`evidence: ${suite.fail} failing test(s), ${fileErrors.length} file load error(s)`); }
process.exit(bad ? 1 : 0);

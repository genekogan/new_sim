#!/usr/bin/env node
// RL6 replay corpus: replay recorded god CLI transcripts against a pinned genesis + this source's library, in process
// (no ports, no network, no browser), and compare outcome classes — accepted / refusal code / CLI refusal / error —
// never coordinates. Divergence is expected where a run used files that changed later, scripts that bypassed the CLI,
// browsers, or the engine; the report says which rows were comparable.
//
//   node tools/god-skill/scripts/replay-corpus.mjs <runs-dir|transcript.jsonl>… [--genesis worlds/templates/eden-district.json]
//        [--run <name>] [--cli-only] [--json out.json] [--write-subset <dir> [--reasons reasons.json]]
//   node tools/god-skill/scripts/replay-corpus.mjs --check tools/god-skill/replay   (the in-repo gate subset)
//
// <runs-dir> holds <run>/transcript*.jsonl and <run>/op/transcript*.jsonl (the review folder's runs/); a run's op/
// folder supplies the files its commands read (final versions only). --cli-only checks every row against the CLI's
// own reading (parseFlags + checkArgs) without a world: a recorded accepted command the CLI now refuses is a
// regression; a recorded CLI refusal the CLI now sends is a loosening.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILE_COMMANDS, argvCandidates, chooseArgv, cliRefusal, outcomeOf, runArgv, unreplayable } from '../lib/replay.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const DEFAULT_GENESIS = join(ROOT, 'worlds/templates/eden-district.json');

/** Transcript files of one runs folder, grouped per run (lead first, then helpers), or a single file. */
export function transcriptsOf(path) {
  if (statSync(path).isFile()) return [{ run: basename(dirname(path)), files: [path], op: join(dirname(path), 'op') }];
  const runs = [];
  for (const run of readdirSync(path).sort()) {
    const dir = join(path, run); if (!statSync(dir).isDirectory()) continue;
    const files = [dir, join(dir, 'op')].filter(existsSync).flatMap(d => readdirSync(d).filter(f => /^transcript.*\.jsonl$/.test(f)).sort().map(f => join(d, f)));
    if (files.length) runs.push({ run, files, op: join(dir, 'op') });
  }
  return runs;
}
export const readRows = file => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line, i) => ({ ...JSON.parse(line), file: basename(file), line: i + 1 }));

/** CLI-only pass: what the CLI's reader says about every row today. */
export function cliPass(rows) {
  const out = { rows: 0, kept: 0, regressions: [], loosened: [], skipped: 0 };
  for (const row of rows) {
    if (row.phase) continue; out.rows++;
    const candidates = argvCandidates(row), why = unreplayable(row, candidates[0]);
    if (why && why !== 'browser' && why !== 'engine' && why !== 'engine clock' && why !== 'setup' && why !== 'local locks' && why !== 'stream' && why !== 'waits for other agents') { out.skipped++; continue; }
    const recorded = outcomeOf(row), argv = chooseArgv(row), refusal = cliRefusal(argv);
    if (recorded === 'cli' && refusal) out.kept++;
    else if (recorded === 'cli') out.loosened.push({ file: row.file, line: row.line, argv });
    else if (refusal) out.regressions.push({ file: row.file, line: row.line, argv, refusal });
    else out.kept++;
  }
  return out;
}

/** Files a run's commands may read (kits, defs, batches, briefs): small text files of its op folder, final versions. */
function stageFiles(op, dir) {
  if (!existsSync(op)) return 0; let n = 0;
  const walk = (from) => { for (const f of readdirSync(from)) {
    const p = join(from, f), st = statSync(p), rel = relative(op, p);
    if (st.isDirectory()) { if (!['looks', 'shots', 'node_modules', 'examples'].includes(f)) walk(p); continue; }
    if (!/\.(json|md|txt|mjs)$/.test(f) || f.startsWith('.eden-god') || f === 'eden-god.mjs' || st.size > 512 * 1024) continue;
    mkdirSync(dirname(join(dir, rel)), { recursive: true }); copyFileSync(p, join(dir, rel)); n++;
  } };
  walk(op); return n;
}

/**
 * Replay rows (one run, in recorded order) against a fresh in-process world. `files` maps relative paths to text
 * (in-repo subsets); `op` is a folder to stage files from. Date.now follows each row's recorded `at`, so build
 * pauses and rate windows see the recorded pacing.
 */
export async function replayRows(rows, { genesis = DEFAULT_GENESIS, op, files, quiet = true } = {}) {
  const { replayWorld, REPLAY_ORIGIN } = await import('../../../apps/server/src/god/replay-world.ts');
  const world = replayWorld(genesis), dir = mkdtempSync(join(tmpdir(), 'god-replay-')), cwd = process.cwd();
  const realNow = Date.now, realFetch = globalThis.fetch, log = console.log, err = console.error, warn = console.warn;
  let base = realNow(), started = realNow();
  const results = [];
  try {
    if (op) stageFiles(op, dir);
    for (const [rel, text] of Object.entries(files ?? {})) { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); }
    writeFileSync(join(dir, '.eden-god.json'), JSON.stringify({ world: REPLAY_ORIGIN, token: world.token }), { mode: 0o600 });
    process.chdir(dir); globalThis.fetch = world.fetch;
    Date.now = () => base + (realNow() - started);
    if (quiet) console.log = console.error = console.warn = () => {};
    const claims = {}; // helper part -> claim id made by the replayed lead
    for (const row of rows) {
      if (row.phase) continue;
      const argv = chooseArgv(row), recorded = row.recorded ?? outcomeOf(row), part = /^transcript-helper-(.+)\.jsonl$/.exec(row.file)?.[1];
      const arg = FILE_COMMANDS.has(argv[0]) ? argv[argv[0] === 'kit' ? 2 : 1] : undefined, brief = argv.includes('--brief') ? argv[argv.indexOf('--brief') + 1] : undefined;
      const looksLikePath = (w) => typeof w === 'string' && !/^\s*[{[]/.test(w) && /^[\w./-]+\.\w+$/.test(w);
      const why = unreplayable(row, argv) ?? (looksLikePath(arg) && !existsSync(arg) ? 'file missing' : null) ?? (part && !claims[part] ? 'helper claim not made' : null);
      if (why) { results.push({ file: row.file, line: row.line, argv, recorded, skipped: why }); continue; }
      const usesFile = (looksLikePath(arg) && existsSync(arg)) || (looksLikePath(brief) && existsSync(brief));
      const at = Date.parse(row.at); if (Number.isFinite(at) && at > Date.now()) { base = at; started = realNow(); }
      if (part) process.env.EDEN_GOD_CLAIM = claims[part]; else delete process.env.EDEN_GOD_CLAIM;
      const t0 = performance.now(), answer = await runArgv(argv), replayed = outcomeOf(answer);
      const made = argv[0] === 'build' && argv[1] === 'claim' && typeof answer.out === 'string' ? /^(c_[0-9a-f]{8}): ([a-z0-9-]+)/.exec(answer.out) : null;
      if (made) claims[made[2]] = made[1];
      results.push({ file: row.file, line: row.line, argv, recorded, replayed, match: recorded === replayed, ...(row.expected ? { expected: row.expected } : {}), ms: Math.round(performance.now() - t0), ...(usesFile ? { usesFile: true } : {}), ...(recorded === replayed && !row.expected ? {} : { detail: String(answer.error ?? (typeof answer.out === 'string' ? answer.out : JSON.stringify(answer.out))).slice(0, 240) }) });
    }
  } finally {
    console.log = log; console.error = err; console.warn = warn; delete process.env.EDEN_GOD_CLAIM;
    Date.now = realNow; globalThis.fetch = realFetch; process.chdir(cwd);
    world.close(); rmSync(dir, { recursive: true, force: true });
  }
  return results;
}

export function summarize(results) {
  const compared = results.filter(r => !r.skipped), matched = compared.filter(r => r.match), fileFree = compared.filter(r => !r.usesFile);
  const classes = {}; for (const r of compared) { const k = `${r.recorded} -> ${r.replayed}`; if (!r.match) classes[k] = (classes[k] ?? 0) + 1; }
  const skipped = {}; for (const r of results.filter(r => r.skipped)) skipped[r.skipped] = (skipped[r.skipped] ?? 0) + 1;
  const ratio = (a, b) => b ? Math.round(1000 * a / b) / 1000 : null;
  return { rows: results.length, compared: compared.length, matched: matched.length, agreement: ratio(matched.length, compared.length), fileFree: { compared: fileFree.length, agreement: ratio(fileFree.filter(r => r.match).length, fileFree.length) }, mismatches: classes, skipped };
}

/** Merge a run's transcripts (lead + helpers) by time. */
export const runRows = run => run.files.flatMap(readRows).sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.file === b.file ? a.line - b.line : 0));

/**
 * The in-repo gate subset: whole runs (state carries from row to row), the recorded class of every row, the files the
 * rows read, and — where today's replay differs from the recording — the class expected today with a reason.
 */
export async function writeSubset(run, results, dir, reasons = {}) {
  const rows = runRows(run), byLine = new Map(results.map(r => [`${r.file}:${r.line}`, r])), files = {};
  const out = rows.filter(r => !r.phase).map(row => {
    const r = byLine.get(`${row.file}:${row.line}`), argv = r?.argv ?? chooseArgv(row);
    for (const w of [FILE_COMMANDS.has(argv[0]) ? argv[argv[0] === 'kit' ? 2 : 1] : undefined, argv.includes('--brief') ? argv[argv.indexOf('--brief') + 1] : undefined]) {
      const p = typeof w === 'string' && /^[\w./-]+\.\w+$/.test(w) ? join(run.op, w) : null;
      if (p && existsSync(p) && statSync(p).size < 256 * 1024) files[w] = readFileSync(p, 'utf8');
    }
    const keep = { at: row.at, ...(row.argv ? { argv: row.argv } : { cmd: row.cmd }), file: row.file, line: row.line, recorded: outcomeOf(row), ...(row.error ? { error: String(row.error).slice(0, 300) } : {}) };
    if (r && !r.skipped && !r.match) Object.assign(keep, { expected: r.replayed, reason: reasons[`${row.file}:${row.line}`] ?? (r.usesFile ? 'the file this command read changed later in the run; the corpus holds its final version' : 'behaviour changed since the run (record why)') });
    return keep;
  });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${run.run}.json`), JSON.stringify({ run: run.run, genesis: 'worlds/templates/eden-district.json', files, rows: out }, null, 1) + '\n');
  return out.filter(r => r.expected).length;
}

/** Replay one in-repo subset file; every comparable row must give `expected ?? recorded`. */
export async function checkSubset(path) {
  const subset = JSON.parse(readFileSync(path, 'utf8')), results = await replayRows(subset.rows, { genesis: join(ROOT, subset.genesis), files: subset.files });
  const wrong = results.filter(r => !r.skipped && r.replayed !== (r.expected ?? r.recorded));
  return { run: subset.run, results, summary: summarize(results), wrong };
}

async function main(argv) {
  const flag = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  if (flag('check')) {
    let bad = 0;
    for (const f of readdirSync(resolve(flag('check'))).filter(f => f.endsWith('.json')).sort()) {
      const r = await checkSubset(join(resolve(flag('check')), f)); bad += r.wrong.length;
      console.log(`${r.run}: ${r.summary.compared}/${r.summary.rows} compared, ${r.wrong.length} differ from expectation; agreement with the recording ${r.summary.agreement}`);
      for (const w of r.wrong) console.log(`  ${w.file}:${w.line} ${w.argv.join(' ').slice(0, 100)} — expected ${w.expected ?? w.recorded}, got ${w.replayed}: ${w.detail ?? ''}`);
    }
    process.exitCode = bad ? 1 : 0; return;
  }
  const paths = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
  if (!paths.length) throw new Error('usage: replay-corpus.mjs <runs-dir|transcript.jsonl>… [--cli-only] [--json out] [--genesis file]');
  const runs = paths.flatMap(p => transcriptsOf(resolve(p))).filter(r => !flag('run') || r.run === flag('run'));
  const report = { genesis: relative(ROOT, resolve(flag('genesis') ?? DEFAULT_GENESIS)), runs: [] };
  for (const run of runs) {
    const rows = runRows(run);
    if (argv.includes('--cli-only')) { const c = cliPass(rows); report.runs.push({ run: run.run, ...c }); console.log(`${run.run}: ${c.rows} rows; CLI regressions ${c.regressions.length}, loosened ${c.loosened.length}`); for (const r of c.regressions) console.log(`  REGRESSION ${r.file}:${r.line} ${r.argv.join(' ').slice(0, 120)} — ${r.refusal.slice(0, 120)}`); continue; }
    const t0 = Date.now(), results = await replayRows(rows, { genesis: flag('genesis') ? resolve(flag('genesis')) : DEFAULT_GENESIS, op: run.op });
    if (flag('write-subset')) { const reasons = flag('reasons') ? JSON.parse(readFileSync(resolve(flag('reasons')), 'utf8')) : {}; console.log(`${run.run}: subset written, ${await writeSubset(run, results, resolve(flag('write-subset')), reasons[run.run] ?? {})} rows expect a changed class`); }
    const s = summarize(results); report.runs.push({ run: run.run, ...s, ms: Date.now() - t0, results });
    console.log(`${run.run}: ${s.compared}/${s.rows} compared, agreement ${s.agreement} (without files ${s.fileFree.agreement}) (${Date.now() - t0} ms); mismatches ${JSON.stringify(s.mismatches)}; skipped ${JSON.stringify(s.skipped)}`);
  }
  if (!argv.includes('--cli-only')) {
    const all = report.runs.flatMap(r => r.results ?? []), s = summarize(all);
    report.total = s; console.log(`TOTAL ${s.compared}/${s.rows} compared, agreement ${s.agreement}; rows reading no file: ${s.fileFree.compared}, agreement ${s.fileFree.agreement}`);
  }
  if (flag('json')) writeFileSync(resolve(flag('json')), JSON.stringify(report, null, 1) + '\n');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));

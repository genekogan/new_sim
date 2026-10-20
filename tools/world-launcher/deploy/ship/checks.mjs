#!/usr/bin/env node
// Verdicts for ship.sh's post-release steps (lane RR, 2026-10-20). Each reads what the step wrote, prints the lines the
// release owner used to read by eye (the old walks.sh summary) and exits 1 when the step did not meet its bar:
//   node checks.mjs quick-check <qc.txt>                      every db "ok" (PRAGMA quick_check on each compact backup)
//   node checks.mjs walks <expected entries> <walk.json>...   every page arrived, 0 errors, 0 resync, every Explore pick ok
//   node checks.mjs poster <poster.log> <poster-count.txt>    every run reached a world frame and never went blank after it, 0 page errors
//   node checks.mjs stall <stall.log> [runs]                  every run reported, no frame gap over 1 s, 0 page errors
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** qc.txt lines are "<result> <path>" (quick-check.mjs). */
export function checkQuickCheck(text) {
  const rows = text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf(' '); return i < 0 ? [l, ''] : [l.slice(0, i), l.slice(i + 1)]; });
  const counts = {}; for (const [r] of rows) counts[r] = (counts[r] ?? 0) + 1;
  const problems = rows.filter(([r]) => r !== 'ok').map(([r, f]) => `${f}: ${r}`);
  if (!rows.length) problems.push('no database was checked');
  return { ok: !problems.length, lines: Object.entries(counts).map(([r, n]) => `${String(n).padStart(7)} ${r}`), problems };
}

/** walk.json entries (walk.mjs). */
export function checkWalks(logs, expected) {
  const lines = [], problems = []; let n = 0;
  for (const { name, entries } of logs) for (const x of entries) {
    n++;
    const errs = x.errors ?? [];
    lines.push(`${name} ${x.slug} dpr ${x.dpr} arr ${x.arrivalMs ?? null} errs ${errs.length} ${JSON.stringify(errs.slice(0, 2))} sockets ${x.sockets?.length ?? 0} resync ${x.resync ?? 0}` +
      ` picks ${JSON.stringify((x.picks ?? []).map((p) => `${p.pick}:${p.ok ? 'ok' : 'FAIL'}`))}` +
      (x.orbit ? ` orbit ${x.orbit.blind ? 'blind ' : ''}${x.orbit.in}in/${x.orbit.out}out d=${x.orbit.end?.d ?? '?'} h=${x.orbit.end?.h ?? '?'}${x.orbit.open === false ? ' NOT-OPEN' : ''}` : ''));
    const where = `${name} ${x.slug} dpr ${x.dpr}`;
    if (x.arrivalMs == null) problems.push(`${where}: never arrived (${x.arrivalErr ?? 'no arrival time'})`);
    if (errs.length) problems.push(`${where}: ${errs.length} error(s): ${errs.slice(0, 2).join(' | ')}`);
    if (x.resync) problems.push(`${where}: ${x.resync} resync`);
    for (const p of x.picks ?? []) if (!p.ok) problems.push(`${where}: Explore pick ${p.pick} failed (${p.err ?? '?'})`);
  }
  if (n !== expected) problems.push(`${n} walk entries, expected ${expected}`);
  return { ok: !problems.length, lines, problems, entries: n };
}

/** poster.log: one JSON line per run (poster.mjs); poster-count.txt: "<k> firstWorld <ms|None> frames <n> blank-after-world <0|[..]> ..." */
export function checkPoster(logText, countText, runs) {
  const lines = [], problems = [];
  const json = logText.split('\n').filter((l) => l.startsWith('{')).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  for (const r of json) { lines.push(`run ${r.k}: marks ${(r.marks ?? []).filter((m) => /early-poster|card-done|ws-welcome/.test(m)).join(' ')} errs ${r.errs?.length ?? 0}`); if (r.errs?.length) problems.push(`poster run ${r.k}: page errors ${r.errs.slice(0, 2).join(' | ')}`); }
  const counted = countText.split('\n').filter((l) => /^\d+ firstWorld /.test(l));
  for (const l of counted) {
    lines.push(l.slice(0, 160));
    const [, k, first, blank] = l.match(/^(\d+) firstWorld (\S+) frames \d+ blank-after-world (0|\[.*?\])/) ?? [];
    if (!k) { problems.push(`unreadable poster count: ${l.slice(0, 80)}`); continue; }
    if (first === 'None') problems.push(`poster run ${k}: never drew a world frame`);
    if (blank !== '0') problems.push(`poster run ${k}: blank after the first world frame ${blank}`);
  }
  if (json.length !== runs) problems.push(`${json.length} poster runs reported, expected ${runs}`);
  if (counted.length !== runs) problems.push(`${counted.length} poster runs counted, expected ${runs}`);
  return { ok: !problems.length, lines, problems };
}

/** stall.log: one JSON line per run (stall.mjs). */
export function checkStall(logText, runs) {
  const lines = [], problems = [];
  const json = logText.split('\n').filter((l) => l.startsWith('{')).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  for (const r of json) {
    lines.push(`run ${r.k}: card ${r.card} ms, frames ${r.frames}, max gap ${r.maxGap} ms, gaps >1 s ${JSON.stringify(r.gapsOver1s ?? [])}, shots ${JSON.stringify(r.shotsMs ?? [])}`);
    if (r.gapsOver1s?.length) problems.push(`stall run ${r.k}: ${r.gapsOver1s.length} frame gap(s) over 1 s (max ${r.maxGap} ms)`);
    if (r.errs?.length) problems.push(`stall run ${r.k}: page errors ${r.errs.slice(0, 2).join(' | ')}`);
  }
  if (json.length !== runs) problems.push(`${json.length} stall runs reported, expected ${runs}`);
  return { ok: !problems.length, lines, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [kind, ...a] = process.argv.slice(2), read = (f) => readFileSync(f, 'utf8');
  let r;
  if (kind === 'quick-check') r = checkQuickCheck(read(a[0]));
  else if (kind === 'walks') r = checkWalks(a.slice(1).map((f) => ({ name: f.split('/').slice(-2, -1)[0], entries: JSON.parse(read(f)) })), Number(a[0]));
  else if (kind === 'poster') r = checkPoster(read(a[0]), read(a[1]), Number(a[2] ?? 3));
  else if (kind === 'stall') r = checkStall(read(a[0]), Number(a[1] ?? 4));
  else { console.error('usage: checks.mjs quick-check|walks|poster|stall …'); process.exit(2); }
  for (const l of r.lines) console.log(l);
  for (const p of r.problems) console.log(`PROBLEM ${p}`);
  console.log(r.ok ? `PASS ${kind}` : `FAIL ${kind}: ${r.problems.length} problem(s)`);
  process.exit(r.ok ? 0 : 1);
}

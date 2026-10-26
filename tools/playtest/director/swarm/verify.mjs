// The cast's success condition, checked from world truth only: the presence log (public Soul placePath) and the speech
// log (public Soul speech events) the orchestrator recorded, against the directions it sent. Plus per-seat cost.
// node tools/playtest/director/swarm/verify.mjs <run-dir>   → director/verdict.json + director/VERDICT.md
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, readJsonl, writeJson } from '../../lib/jsonl.mjs';
import { normalizeCast } from './cast.mjs';

const clip = (s, n = 140) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

/** Presence intervals per seat from presence.jsonl → max number present at once, and when everyone was. */
export function presenceStats(presence, seats) {
  const evs = presence.map((p) => ({ ms: Date.parse(p.t), seat: p.seat, present: !!p.present })).filter((e) => Number.isFinite(e.ms)).sort((a, b) => a.ms - b.ms);
  const cur = new Set(); let max = 0, allAt = null;
  for (const e of evs) { if (e.present) cur.add(e.seat); else cur.delete(e.seat); const n = seats.filter((s) => cur.has(s)).length; if (n > max) max = n; if (n === seats.length && allAt == null) allAt = new Date(e.ms).toISOString(); }
  const ever = Object.fromEntries(seats.map((s) => [s, evs.some((e) => e.seat === s && e.present)]));
  return { maxTogether: max, allTogetherAt: allAt, everPresent: ever };
}

export function verifySession({ cast, directions, speech, presence, state = null }) {
  const order = cast.order, minChars = cast.success.minChars;
  const goOf = (id) => directions.find((d) => d.seat === id && d.kind === 'go' && !d.error) ?? null;
  const goes = order.map((id) => ({ id, go: goOf(id) }));
  const goMs = (g) => (g?.go ? Date.parse(g.go.t) : null);
  const endMs = Math.max(0, ...speech.map((s) => s.atMs ?? 0), ...directions.map((d) => Date.parse(d.t) || 0)) + 1;
  const sorted = goes.filter((g) => g.go).sort((a, b) => goMs(a) - goMs(b));
  const windowOf = (id) => { const i = sorted.findIndex((g) => g.id === id); if (i < 0) return null; return [goMs(sorted[i]) - 2000, i + 1 < sorted.length ? goMs(sorted[i + 1]) - 2000 : endMs]; };
  const turnsFrom = sorted.length ? goMs(sorted[0]) - 2000 : Infinity;
  const per = {};
  for (const id of order) {
    const w = windowOf(id);
    const lines = w ? speech.filter((s) => s.seat === id && s.atMs != null && s.atMs >= w[0] && s.atMs < w[1]) : [];
    const chars = lines.reduce((n, s) => n + s.text.length, 0);
    const outside = speech.filter((s) => s.seat === id && s.atMs != null && s.atMs >= turnsFrom && s.text.length >= minChars && !(w && s.atMs >= w[0] && s.atMs < w[1]));
    const before = speech.filter((s) => s.seat === id && s.atMs != null && s.atMs < turnsFrom);
    per[id] = { go: goes.find((g) => g.id === id).go?.t ?? null, presented: chars >= minChars, lines: lines.length, chars, firstAt: lines[0]?.at ?? null, text: lines.map((s) => s.text).join(' '),
      inRoomWhenSpeaking: lines.length ? lines.every((s) => s.present !== false) : null, outOfTurn: outside.map((s) => ({ at: s.at, text: clip(s.text) })), beforeTurns: before.length };
  }
  const firsts = order.filter((id) => per[id].presented).map((id) => ({ id, ms: Date.parse(per[id].firstAt) }));
  const byTime = [...firsts].sort((a, b) => a.ms - b.ms).map((x) => x.id);
  const inOrder = firsts.length > 0 && byTime.join(',') === firsts.map((x) => x.id).join(',');
  const ps = presenceStats(presence, order);
  const redirects = (state?.redirects ?? []).map((r) => {
    const after = speech.filter((s) => s.seat === r.seat && s.atMs != null && s.atMs >= r.atMs).map((s) => s.text).join(' ');
    const hit = r.expect?.length ? r.expect.some((k) => after.toLowerCase().includes(String(k).toLowerCase())) : null;
    return { seat: r.seat, text: r.text, at: r.t, beforeTurn: r.beforeTurn, expect: r.expect ?? null, observed: hit, spokeAfter: clip(after, 300) };
  });
  const checks = {
    allPresent: { pass: ps.maxTogether === order.length, detail: `${ps.maxTogether}/${order.length} in ${cast.room.label} at once${ps.allTogetherAt ? ` (first at ${ps.allTogetherAt})` : ''}` },
    eachPresented: { pass: order.every((id) => per[id].presented), detail: `${order.filter((id) => per[id].presented).length}/${order.length} gave a talk of ≥ ${minChars} characters in their turn` },
    inOrder: { pass: inOrder && firsts.length === order.length, detail: `spoken order ${byTime.join(' → ') || '(none)'}` },
    eachOnce: { pass: order.every((id) => per[id].outOfTurn.length === 0), detail: `${order.reduce((n, id) => n + per[id].outOfTurn.length, 0)} long lines outside the speaker's own turn` },
    redirect: { pass: redirects.every((r) => r.observed !== false), detail: redirects.length ? redirects.map((r) => `${r.seat}: ${r.observed == null ? 'no expectation' : r.observed ? 'observed' : 'NOT observed'}`).join('; ') : 'none' },
  };
  const want = Object.entries(cast.success).filter(([, v]) => v === true).map(([k]) => ({ allPresent: 'allPresent', inOrder: 'inOrder', eachOnce: 'eachOnce' }[k])).filter(Boolean);
  const pass = ['eachPresented', 'redirect', ...want].every((k) => checks[k].pass);
  return { pass, checks, seats: per, presence: ps, redirects, spokenOrder: byTime };
}

/** Per-seat cost from seats/<id>/cost.jsonl (+ the planner call from director/plan.json). */
export function costOf(runDir) {
  const out = {}; const tot = { inputTokens: 0, cachedTokens: 0, cacheCreationTokens: 0, outputTokens: 0, costUsd: 0, turns: 0, unknownTurns: 0 };
  const dir = join(runDir, 'seats');
  for (const id of existsSync(dir) ? readdirSync(dir) : []) {
    const rows = readJsonl(join(dir, id, 'cost.jsonl'));
    const c = { inputTokens: 0, cachedTokens: 0, cacheCreationTokens: 0, outputTokens: 0, costUsd: 0, turns: rows.length, unknownTurns: 0 };
    for (const r of rows) { if (r.inputTokens == null && r.outputTokens == null) c.unknownTurns += 1; for (const k of ['inputTokens', 'cachedTokens', 'cacheCreationTokens', 'outputTokens', 'costUsd']) c[k] += Number(r[k] ?? 0); }
    c.costUsd = Math.round(c.costUsd * 10000) / 10000; out[id] = c;
    for (const k of Object.keys(tot)) tot[k] += c[k];
  }
  const planner = readJson(join(runDir, 'director', 'plan.json'), null);
  tot.costUsd = Math.round((tot.costUsd + Number(planner?.costUsd ?? 0)) * 10000) / 10000;
  return { seats: out, planner: planner?.model ? { model: planner.model, costUsd: planner.costUsd ?? null, usage: planner.usage ?? null } : null, total: tot };
}

export function renderVerdictMd(cast, v, cost) {
  const L = [`# ${cast.name}: ${v.pass ? 'PASS' : 'FAIL'}`, '', `Room: ${cast.room.label} · order: ${cast.order.join(' → ')}`, '', '| check | result | detail |', '|---|---|---|'];
  for (const [k, c] of Object.entries(v.checks)) L.push(`| ${k} | ${c.pass ? 'pass' : 'FAIL'} | ${c.detail} |`);
  L.push('', '## Talks (world speech in each turn)', '', '| seat | turn began | lines | chars | in room | out of turn | talk |', '|---|---|---:|---:|---|---:|---|');
  for (const id of cast.order) { const s = v.seats[id]; L.push(`| ${id} | ${s.go ?? '—'} | ${s.lines} | ${s.chars} | ${s.inRoomWhenSpeaking ?? '—'} | ${s.outOfTurn.length} | ${clip(s.text, 160).replace(/\|/g, '/')} |`); }
  if (v.redirects.length) { L.push('', '## Redirects', ''); for (const r of v.redirects) L.push(`- ${r.seat} at ${r.at} (${r.beforeTurn ? 'before' : 'during'} its turn): "${clip(r.text, 120)}" · expect ${JSON.stringify(r.expect)} → ${r.observed == null ? 'no expectation' : r.observed ? 'observed' : 'NOT observed'}; spoke after: "${clip(r.spokeAfter, 200)}"`); }
  L.push('', '## Cost (seats/*/cost.jsonl)', '', '| seat | turns | input | cached | cache-write | output | USD |', '|---|---:|---:|---:|---:|---:|---:|');
  for (const [id, c] of Object.entries(cost.seats)) L.push(`| ${id} | ${c.turns}${c.unknownTurns ? ` (${c.unknownTurns} unknown)` : ''} | ${c.inputTokens} | ${c.cachedTokens} | ${c.cacheCreationTokens} | ${c.outputTokens} | ${c.costUsd} |`);
  if (cost.planner) L.push(`| planner (${cost.planner.model}) | 1 | | | | | ${cost.planner.costUsd ?? '?'} |`);
  L.push(`| **total** | ${cost.total.turns} | ${cost.total.inputTokens} | ${cost.total.cachedTokens} | ${cost.total.cacheCreationTokens} | ${cost.total.outputTokens} | ${cost.total.costUsd} |`, '');
  return L.join('\n');
}

export function verifyRun(runDir, cast = null) {
  cast = cast ?? normalizeCast(readJson(join(runDir, 'cast.json')));
  const d = join(runDir, 'director');
  const v = verifySession({ cast, directions: readJsonl(join(d, 'directions.jsonl')), speech: readJsonl(join(d, 'speech.jsonl')), presence: readJsonl(join(d, 'presence.jsonl')), state: readJson(join(d, 'state.json'), null) });
  const cost = costOf(runDir);
  writeJson(join(d, 'verdict.json'), { ...v, cost });
  writeFileSync(join(d, 'VERDICT.md'), renderVerdictMd(cast, v, cost));
  return { ...v, cost };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = verifyRun(resolve(process.argv[2]));
  process.stdout.write(JSON.stringify({ pass: r.pass, checks: r.checks, costUsd: r.cost.total.costUsd }) + '\n');
}

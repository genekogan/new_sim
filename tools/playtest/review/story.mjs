// story: the whole session as 10–30 important moments, each with the director's view (the persona's own screenshot)
// at that moment, what the player said, what the agent did and said, the card and the body, and the verdict.
// Read-only over a run folder; story.html / story.json are the only outputs (writeStory, CLI below).
// node tools/playtest/review/story.mjs <run-dir> [--out story.html] [--max 30]
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, readJsonl } from '../lib/jsonl.mjs';
import { loadRun } from './run.mjs';
import { renderStoryHtml, storyPage, storyLines, writeStory } from './story-html.mjs';
export { renderStoryHtml, storyPage, storyLines, writeStory };

const PHYS = new Set(['inside-solid', 'no-progress', 'stuck-receipt']);
const OK_PHASES = new Set(['started', 'completed', 'accepted', 'running', 'queued']);
const fidSev = { W: 3, P: 2, M: 2, H: 0 };

export const fmtClock = (sec) => { if (sec == null || !Number.isFinite(sec)) return '?'; const neg = sec < 0; const s = Math.round(Math.abs(sec)); return `${neg ? '−' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const clip = (s, n = 280) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const uniq = (xs) => [...new Set(xs.filter((x) => x != null && x !== ''))];

/** Ledger rows (TSV with a header line), read here so the story never depends on a module mid-edit. */
export function readLedgerTsv(file) {
  if (!existsSync(file)) return [];
  const [head, ...rows] = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const keys = head.split('\t');
  return rows.map((r) => Object.fromEntries(r.split('\t').map((v, i) => [keys[i], v])));
}

/** Short, readable form of an agent tool call. */
export function summarizeCall(cmd, tool) {
  let s = String(cmd ?? '').replace(/\s+/g, ' ').trim();
  s = s.replace(/\bnode eden\.mjs\b/g, 'eden').replace(/(msg_[0-9a-f]{8})[0-9a-f-]{20,}/g, '$1…');
  if (/^\{/.test(s)) { try { const o = JSON.parse(cmd); s = `${tool ?? 'tool'} ${o.file_path ?? o.path ?? o.pattern ?? o.url ?? ''}`.trim(); } catch { /* keep */ } }
  if (/^\/(private|tmp|Users)\//.test(s)) s = `${tool ?? 'file'} …/${s.split(/[\s/]/).filter(Boolean).slice(-1)[0]}`;
  return clip(s, 120);
}

function sideData(runDir) {
  const ledger = readLedgerTsv(join(runDir, 'ledger.tsv'));
  const reviews = readJsonl(join(runDir, 'reviews.jsonl'));
  const oracles = readJsonl(join(runDir, 'oracles.jsonl'));
  const issues = readJson(join(runDir, 'issues.json'), []) ?? [];
  return { ledger, reviews, oracles, issues: Array.isArray(issues) ? issues : [] };
}

/** Everything timed for one seat, in ms since play start. */
function seatStreams(run, seat) {
  const ms = (iso) => (iso ? Date.parse(iso) - run.anchorMs : null);
  const rel = (p) => { if (!p) return null; const abs = isAbsolute(p) ? p : join(run.runDir, p); return existsSync(abs) ? relative(run.runDir, abs).split(sep).join('/') : null; };
  const persona = run.personas[seat];
  const glances = []; const turns = [];
  for (const t of persona?.turns ?? []) {
    if (!t.t) continue;
    const n = t.n ?? t.turn; const pdir = join('personas', seat);
    const json = t.shownFile ?? (t.shown ? join(pdir, t.shown) : join(pdir, 'shown', `${n}.json`));
    const png = rel(t.png) ?? rel(t.shown ? join(pdir, t.shown.replace(/\.json$/, '.png')) : null) ?? rel(join(pdir, 'shown', `${n}.png`));
    const g = { ms: ms(t.t), n, kind: t.kind ?? 'step', png, json, decision: t.decision ?? {}, requestId: t.requestId ?? null };
    turns.push(g); if (png) glances.push(g);
  }
  const shown = (g) => { if (g._legible !== undefined) return g._legible; const j = readJson(isAbsolute(g.json) ? g.json : join(run.runDir, g.json), null); g._legible = j?.legible ?? null; return g._legible; };
  const cam = seat === 'god' ? 'god' : seat;
  const camShots = run.shotsIndex.filter((s) => s.cam === cam && s.t).map((s) => ({ ms: ms(s.t), path: rel(s.path) })).filter((s) => s.path).sort((a, b) => a.ms - b.ms);
  const evs = run.evidence.filter((e) => e.seat === seat);
  const dedupe = (xs) => { const seen = new Set(); return xs.filter((x) => (x.t && !seen.has(x.t) ? seen.add(x.t) : false)).map((x) => ({ ...x, ms: ms(x.t) })).sort((a, b) => a.ms - b.ms); };
  const samples = dedupe(evs.flatMap((e) => e.samples ?? []));
  const legible = dedupe([...evs.flatMap((e) => e.legible ?? []), ...glances.map((g) => ({ t: new Date(g.ms + run.anchorMs).toISOString(), card: shown(g)?.card ?? null, fromGlance: g }))]).filter((l) => l.card);
  return { ms, glances, turns, shown, camShots, evs, samples, legible };
}

/** Agent tool calls with times: transcript `_rx` when the adapter stamped it, else spread over the turn by call ms. */
function agentCalls(run, seat) {
  const s = run.seats[seat]; if (!s) return [];
  const out = []; const pending = new Map();
  for (const ev of s.transcript ?? []) {
    const at = typeof ev._rx === 'number' ? ev._rx - run.anchorMs : null;
    for (const c of ev.message?.content ?? []) {
      if (c.type === 'tool_use' && at != null) { const a = { ms: at, cmd: c.input?.command ?? JSON.stringify(c.input ?? {}), tool: c.name, err: false }; pending.set(c.id, a); out.push(a); }
      if (c.type === 'tool_result' && c.is_error && pending.has(c.tool_use_id)) pending.get(c.tool_use_id).err = true;
    }
    if (ev.type === 'item.completed' && ev.item?.type === 'command_execution' && at != null) out.push({ ms: at, cmd: ev.item.command, tool: 'shell', err: ev.item.exit_code ? true : false });
  }
  if (out.length) return out;
  for (const t of s.turns ?? []) {
    let cur = Date.parse(t.startedAt) - run.anchorMs; if (!Number.isFinite(cur)) continue;
    for (const c of t.toolCalls ?? []) { out.push({ ms: cur, cmd: c.cmd, tool: c.tool ?? 'shell', err: !!c.isError }); cur += c.ms ?? 0; }
  }
  return out;
}

const placeName = (x) => (x?.placePath?.[0] ?? x?.place ?? null);

function candidates(run, seat, S, side) {
  const C = []; const add = (c) => C.push({ seat, imp: 0, sev: 0, protect: false, requestIds: [], ...c });
  const reqOf = (text, atMs) => S.evs.filter((e) => e.text === text).sort((a, b) => Math.abs(S.ms(a.sentAt) - atMs) - Math.abs(S.ms(b.sentAt) - atMs))[0] ?? null;
  const finalRating = run.personas[seat]?.ratings?.final ?? null; const usedWish = new Set();
  for (const g of S.turns) {
    const d = g.decision ?? {}; const base = { ms: g.ms, shot: g.png, persona: { thought: d.thought ?? null, rating: d.rating ?? null } };
    const wishes = [...(d.desires ?? []).map((x) => `wished: ${x}`), ...(d.complaints ?? []).map((x) => `complained: ${x}`)];
    if (g.kind === 'final') { add({ ...base, kind: 'final', imp: 2, protect: true, title: 'final verdict from the player', persona: { ...base.persona, rating: finalRating ?? d.rating ?? null }, lines: wishes.map((w) => clip(w, 200)) }); continue; }
    if (d.say?.text) {
      const ev = reqOf(d.say.text, g.ms);
      add({ ...base, kind: 'say', imp: 2, protect: true, title: d.say.channel === 'chat' ? 'typed to the assistant' : 'wrote on the card', persona: { ...base.persona, said: d.say.text, channel: d.say.channel }, requestIds: ev ? [ev.requestId] : [], lines: wishes.map((w) => clip(w, 200)) });
    } else if (d.rating || (d.complaints ?? []).length) add({ ...base, kind: 'rating', imp: 1, sev: (d.complaints ?? []).length ? 1 : 0, title: d.rating ? `rated fun ${d.rating.fun}/5, alive ${d.rating.alive}/5` : 'complained', lines: wishes.map((w) => clip(w, 200)) });
    else add({ ...base, kind: 'glance', imp: 0, title: 'watching' });
  }
  for (const ev of S.evs) {
    const rid = [ev.requestId]; const chat = ev.channel === 'chat'; const sent = S.ms(ev.sentAt); const cut = ev.cutoffAt ? S.ms(ev.cutoffAt) : null;
    if (ev.ackAt) add({ ms: S.ms(ev.ackAt), kind: 'ack', imp: 2, title: chat ? 'assistant acknowledged' : 'card acknowledged', said: ev.ackText, requestIds: rid, lines: [`after ${((S.ms(ev.ackAt) - sent) / 1000).toFixed(0)} s`] });
    if (ev.resultAt) add({ ms: S.ms(ev.resultAt), kind: 'result', imp: 2, title: chat ? 'assistant replied' : `card result${ev.resultState ? ` (${ev.resultState})` : ''}`, said: ev.resultText, requestIds: rid, lines: [`after ${((S.ms(ev.resultAt) - sent) / 1000).toFixed(0)} s`] });
    if (ev.firstBodyChangeAt && (cut == null || S.ms(ev.firstBodyChangeAt) <= cut)) add({ ms: S.ms(ev.firstBodyChangeAt), kind: 'body', imp: 1, bodyChanged: true, title: 'body started to change', requestIds: rid, lines: [`${((S.ms(ev.firstBodyChangeAt) - sent) / 1000).toFixed(0)} s after the ask`] });
    if (cut != null) {
      const v = side.ledger.find((r) => r.requestId === ev.requestId) ?? side.reviews.find((r) => r.requestId === ev.requestId) ?? null;
      const fails = side.oracles.filter((o) => o.requestId === ev.requestId && o.status === 'fail').map((o) => ({ id: o.id, detail: clip(o.detail, 160) }));
      const issue = side.issues.find((i) => (i.requestIds ?? []).includes(ev.requestId)) ?? null;
      const fid = v?.fidelity || null; const phys = fails.some((f) => PHYS.has(f.id));
      const verdict = { requestId: ev.requestId, asked: ev.text, fidelity: fid, class: v?.class || null, reason: v?.reason ? clip(v.reason, 420) : null, issueId: issue?.id ?? null, issueTitle: issue?.title ?? null, oracleFails: fails };
      const noAnswer = !ev.ackAt && !ev.resultAt;
      add({ ms: cut, kind: 'close', imp: fid === 'W' || fails.length ? 3 : 2, protect: fid === 'W', sev: Math.max(fidSev[fid] ?? 0, phys ? 3 : fails.length ? 1 : 0, noAnswer ? 2 : 0), title: `${ev.requestId} closed${noAnswer ? ' with no answer' : ''}`, verdict, requestIds: rid, lines: [`"${clip(ev.text, 90)}" (${ev.cutoffReason ?? 'closed'})`] });
      if (fid === 'M' || v?.class === 'O4') {
        for (const w of run.personas[seat]?.desires ?? []) { const t = S.ms(w.t); const k = `${w.t}|${w.text}`; if (t >= sent && t <= cut + 20000 && !usedWish.has(k) && usedWish.add(k)) add({ ms: t, kind: 'pink', imp: 2, sev: 2, title: 'wish the world could not meet', requestIds: rid, lines: [clip(w.text, 220)] }); }
      }
    }
  }
  let prev = null;
  for (const s of S.samples) {
    if (prev && (s.place !== prev.place || s.posture !== prev.posture)) add({ ms: s.ms, kind: 'move', imp: 1, bodyChanged: true, title: s.place !== prev.place ? `moved to ${placeName(s) ?? 'somewhere'}` : `now ${s.posture ?? 'changed posture'}`, lines: [] });
    prev = s;
  }
  if (!S.samples.length) {
    let doing = null;
    for (const g of S.glances) { const d = S.shown(g)?.card?.doing ?? null; if (doing != null && d && d !== doing) add({ ms: g.ms, shot: g.png, kind: 'move', imp: 1, bodyChanged: true, title: `card now says "${clip(d, 60)}"`, lines: [] }); if (d) doing = d; }
  }
  // Receipts already on the first sample happened before this stretch of evidence; only later phases are moments.
  const seenR = new Set((S.samples[0]?.receipts ?? []).map((r) => `${r.id}:${r.phase}`));
  for (const s of S.samples) for (const r of s.receipts ?? []) {
    const k = `${r.id}:${r.phase}`; if (seenR.has(k)) continue; seenR.add(k);
    if (r.phase === 'completed') add({ ms: s.ms, kind: 'receipt', imp: 1, title: `${r.capability} completed`, lines: [] });
    else if (!OK_PHASES.has(r.phase) || r.code) add({ ms: s.ms, kind: 'receipt-fail', imp: 2, sev: 2, title: `${r.capability} ${r.phase}${r.code ? ` (${r.code})` : ''}`, lines: r.reason ? [clip(r.reason, 160)] : [] });
  }
  let pres = null;
  for (const l of S.legible) {
    const p = l.card.presenceState ?? null;
    // listening ↔ working flips on every request; only a flip out of both (gone, offline, error) is a moment.
    const ok = (x) => /listen|work/.test(x ?? '');
    if (pres && p && p !== pres && ok(pres) !== ok(p)) add({ ms: l.ms, kind: 'presence', imp: ok(p) ? 1 : 2, sev: ok(p) ? 0 : 2, title: `agent ${p}`, lines: l.card.presence ? [clip(l.card.presence, 120)] : [] });
    if (p) pres = p;
  }
  for (const t of run.seats[seat]?.turns ?? []) if (t.reason === 'chat' && t.finalText && t.endedAt) add({ ms: S.ms(t.endedAt), kind: 'reply', imp: 2, title: 'assistant replied in chat', said: t.finalText, lines: [] });
  return C.filter((c) => Number.isFinite(c.ms) && c.ms >= -2000);
}

const RANK = ['say', 'final', 'close', 'result', 'reply', 'ack', 'pink', 'receipt-fail', 'presence', 'body', 'rating', 'receipt', 'move', 'glance'];
const rank = (c) => c.imp * 100 - (RANK.indexOf(c.kind) + 1);
/** Titles: the leading member first; walks collapse to one "moved a → b" line; idle glances only when alone. */
function titleOf(cluster, top) {
  const rest = cluster.filter((c) => c !== top && c.kind !== 'glance');
  const moves = rest.filter((c) => c.kind === 'move' && c.title.startsWith('moved to ')).map((c) => c.title.slice(9));
  const others = rest.filter((c) => !(c.kind === 'move' && c.title.startsWith('moved to '))).map((c) => c.title);
  const walk = moves.length ? [`moved to ${moves.join(' → ')}`] : [];
  return uniq([top.title, ...(top.kind === 'move' ? [] : walk), ...others]).join(' · ').replace(/^moved to (.*?) · moved to /, 'moved to $1 → ');
}

function toMoment(cluster, seat) {
  const top = cluster.reduce((a, b) => (rank(b) > rank(a) ? b : a));
  const said = uniq(cluster.map((c) => c.persona?.said)); const ch = cluster.find((c) => c.persona?.said)?.persona.channel ?? null;
  const thought = uniq(cluster.map((c) => c.persona?.thought)).slice(-1)[0] ?? null;
  const rating = cluster.map((c) => c.persona?.rating).filter(Boolean).slice(-1)[0] ?? null;
  const verdicts = cluster.map((c) => c.verdict).filter(Boolean);
  return {
    ms: top.ms, seat, kind: top.kind, kinds: uniq(cluster.map((c) => c.kind)), imp: Math.max(...cluster.map((c) => c.imp)), protect: cluster.some((c) => c.protect),
    severity: Math.max(...cluster.map((c) => c.sev)), title: titleOf(cluster, top),
    text: uniq(cluster.flatMap((c) => c.lines ?? [])).join(' · '), requestIds: uniq(cluster.flatMap((c) => c.requestIds)),
    shotPref: cluster.find((c) => c.kind === 'say' && c.shot)?.shot ?? cluster.find((c) => c.shot)?.shot ?? null,
    persona: { said: said.join(' / ') || null, channel: ch, thought, rating }, saidList: uniq(cluster.map((c) => c.said)), bodyChanged: cluster.some((c) => c.bodyChanged), verdicts,
  };
}

function cluster(C, seat, minGapMs) {
  C.sort((a, b) => a.ms - b.ms || b.imp - a.imp);
  const out = []; let cur = [];
  for (const c of C) {
    if (cur.length && c.ms - cur.at(-1).ms <= minGapMs && c.ms - cur[0].ms <= minGapMs * 3) cur.push(c);
    else { if (cur.length) out.push(toMoment(cur, seat)); cur = [c]; }
  }
  if (cur.length) out.push(toMoment(cur, seat));
  return out;
}

function select(ms, max) {
  const kept = [...ms];
  const gapAround = (i) => Math.min(i > 0 ? kept[i].ms - kept[i - 1].ms : Infinity, i < kept.length - 1 ? kept[i + 1].ms - kept[i].ms : Infinity);
  while (kept.length > max) {
    let best = -1;
    for (let i = 0; i < kept.length; i++) {
      if (kept[i].protect) continue;
      if (best < 0 || kept[i].imp < kept[best].imp || (kept[i].imp === kept[best].imp && gapAround(i) < gapAround(best))) best = i;
    }
    if (best < 0) break;
    kept.splice(best, 1);
  }
  return kept;
}

function shotFor(ms, S, pref) {
  if (pref) { const g = S.glances.find((x) => x.png === pref); return { path: pref, ms: g?.ms ?? ms, source: 'director' }; }
  const after = S.glances.find((g) => g.ms >= ms && g.ms - ms <= 12000);
  const near = after ?? S.glances.reduce((a, g) => (!a || Math.abs(g.ms - ms) < Math.abs(a.ms - ms) ? g : a), null);
  if (near && Math.abs(near.ms - ms) <= 20000) return { path: near.png, ms: near.ms, source: 'director' };
  const cam = S.camShots.reduce((a, s) => (!a || Math.abs(s.ms - ms) < Math.abs(a.ms - ms) ? s : a), null);
  if (cam && Math.abs(cam.ms - ms) <= 15000) return { path: cam.path, ms: cam.ms, source: 'camera' };
  if (near) return { path: near.png, ms: near.ms, source: 'director' };
  return null;
}

const lastAt = (xs, ms, slack = 2000) => { let r = null; for (const x of xs) { if (x.ms <= ms + slack) r = x; else break; } return r; };

/** buildStory(run) → { seats: { [seat]: { moments } }, merged }. See the file header. */
export function buildStory(run, { maxMoments = 30, minGapSec = 4, gapSec = 90, side = null } = {}) {
  side = side ?? sideData(run.runDir);
  const seatIds = uniq([...Object.keys(run.personas), ...Object.keys(run.seats), ...run.evidence.map((e) => e.seat)]);
  const endMs = Math.max(0, ...Object.values(run.personas).flatMap((p) => p.turns).map((t) => Date.parse(t.t) - run.anchorMs).filter(Number.isFinite), ...run.evidence.map((e) => Date.parse(e.cutoffAt ?? '') - run.anchorMs).filter(Number.isFinite));
  // Several seats share the screen-time budget: each column gets a proportional share (never under 10).
  const perSeat = seatIds.length > 1 ? Math.max(10, Math.ceil((maxMoments * 1.6) / seatIds.length)) : maxMoments;
  const seats = {};
  for (const seat of seatIds) {
    const S = seatStreams(run, seat);
    const all = cluster(candidates(run, seat, S, side), seat, minGapSec * 1000);
    let kept = select(all, perSeat);
    // A verdict whose close moment was dropped rides on the request's send moment; nothing about a request is lost.
    for (const m of all) for (const v of m.verdicts) {
      if (kept.some((k) => k.verdicts.some((x) => x.requestId === v.requestId))) continue;
      const host = kept.find((k) => k.kinds.includes('say') && k.requestIds.includes(v.requestId)) ?? kept.filter((k) => k.ms <= m.ms).at(-1) ?? kept[0];
      if (host) { host.verdicts.push(v); host.severity = Math.max(host.severity, fidSev[v.fidelity] ?? 0); }
    }
    // Long stretches with nothing kept get one quiet frame from their middle.
    const gaps = []; const bounds = [0, ...kept.map((k) => k.ms), endMs];
    const first = S.turns[0]?.ms ?? 0;
    for (let i = 1; i < bounds.length; i++) {
      const a = Math.max(bounds[i - 1], i === 1 ? first : -Infinity), b = bounds[i];
      if (b - a > gapSec * 1000 && (S.turns.length || S.evs.length)) {
        const mid = (a + b) / 2; const g = S.glances.reduce((x, y) => (!x || Math.abs(y.ms - mid) < Math.abs(x.ms - mid) ? y : x), null);
        gaps.push({ ms: mid, seat, kind: 'gap', kinds: ['gap'], imp: 0, protect: false, severity: 0, title: `nothing visible happened for ${Math.round((b - a) / 1000)} s`, text: '', requestIds: [], shotPref: g?.png ?? null, persona: { said: null, channel: null, thought: g?.decision?.thought ?? null, rating: null }, saidList: [], bodyChanged: false, verdicts: [] });
      }
    }
    kept = [...kept, ...gaps].sort((a, b) => a.ms - b.ms);
    const calls = agentCalls(run, seat);
    const moments = kept.map((k) => finish(k, S, run));
    for (const c of calls.filter((x) => x.ms >= 0)) { // setup (onboarding) calls belong to the setup section
      let i = -1; for (let j = 0; j < kept.length; j++) if (kept[j].ms <= c.ms + 1000) i = j;
      const m = moments[Math.max(0, i)]; if (m) m.agent.did.push(`${c.err ? '✗ ' : ''}${summarizeCall(c.cmd, c.tool)}`);
    }
    seats[seat] = { moments };
  }
  const merged = Object.values(seats).flatMap((s) => s.moments).sort((a, b) => a.mono - b.mono || String(a.seat).localeCompare(String(b.seat)));
  return { run: run.runDir.split(sep).pop(), scenario: run.scenario?.name ?? null, durationSec: Math.round(endMs / 1000), seats, merged };
}

function finish(k, S, run) {
  const shot = shotFor(k.ms, S, k.shotPref);
  // The card line is what the pictured screen showed; the body line is the world's record at the moment itself.
  const card = (shot?.source === 'director' ? lastAt(S.legible, Math.max(k.ms, shot.ms), 300) : lastAt(S.legible, k.ms))?.card ?? null; const smp = lastAt(S.samples, k.ms);
  const glanceDoing = !smp ? S.shown(lastAt(S.glances, k.ms) ?? {}) ?? null : null;
  const v = k.verdicts.reduce((a, b) => (!a || (fidSev[b.fidelity] ?? -1) > (fidSev[a.fidelity] ?? -1) ? b : a), null);
  return {
    t: Math.round(k.ms / 100) / 10, mono: Math.round(k.ms), seat: k.seat, kind: k.kind, kinds: k.kinds, title: k.title, text: k.text,
    shot: shot?.path ?? null, shotT: shot ? Math.round(shot.ms / 100) / 10 : null, shotSource: shot?.source ?? null,
    persona: k.persona, agent: { did: [], said: k.saidList.map((s) => clip(s, 500)).join('\n\n') || null },
    card: card ? { state: card.stateText ?? card.messageState ?? null, ack: card.ack ?? null, result: card.result ?? null, presence: card.presenceState ?? card.chip ?? null } : null,
    body: smp ? { place: placeName(smp), posture: smp.posture ?? null, activity: smp.doing ?? smp.activity ?? null, changed: k.bodyChanged } : glanceDoing?.card ? { place: null, posture: null, activity: glanceDoing.card.doing ?? null, changed: k.bodyChanged } : null,
    verdict: v ? { ...v } : null, verdicts: k.verdicts.length > 1 ? k.verdicts : undefined, requestIds: k.requestIds, severity: k.severity, importance: k.imp,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2); const opt = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const dir = a.find((x, i) => !x.startsWith('--') && !['--out', '--max'].includes(a[i - 1]));
  if (!dir) { process.stderr.write('usage: story.mjs <run-dir> [--out story.html] [--max 30]\n'); process.exit(2); }
  const r = writeStory(resolve(dir), { out: opt('--out'), maxMoments: Number(opt('--max')) || 30 });
  process.stdout.write(JSON.stringify({ ok: true, ...r }) + '\n');
}

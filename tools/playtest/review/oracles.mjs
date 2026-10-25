// Deterministic oracles over one request's evidence pack (DESIGN §4.4, spec §2.4). Code only: pass | fail | unknown
// with pointers, never a score. Facts after the request's cutoff are excluded (late diagnostics never grant hits).
import { seatActs, xz } from './run.mjs';

export const ORACLE_IDS = ['ack-latency', 'result-sent', 'listen-open', 'arrival', 'posture', 'duration-held', 'inside-solid', 'no-progress', 'oscillation', 'stuck-receipt', 'truthfulness-basic', 'vocabulary', 'duplicate-acts', 'server-errors', 'first-body-change'];
export const PHYSICAL = ['arrival', 'posture', 'truthfulness-basic', 'inside-solid', 'no-progress'];
export const ACK_BOUND_SEC = 10;
const WALK = /^(go|walk|visit|goto|stroll|wander|run|follow)[:.]/i;
const ms = (iso) => (iso ? Date.parse(iso) : null);
const secs = (a, b) => Math.round((b - a) / 100) / 10;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const norm = (s) => String(s ?? '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '');
const o = (id, status, detail, pointers = []) => ({ id, status, detail, pointers });

function postureWanted(text) {
  const t = String(text).toLowerCase();
  if (/\b(sit|seat|have a seat)\b/.test(t)) return 'sitting';
  if (/\b(lie|lay|nap|sleep|rest on)\b/.test(t)) return 'lying';
  if (/\bstand( up)?\b|\bget up\b/.test(t)) return 'standing';
  return null;
}
const postureIs = (p, want) => ({ sitting: /sit|seated/i, lying: /lying|lie|asleep|sleep|nap/i, standing: /stand/i })[want]?.test(String(p ?? '')) ?? false;

function inside(fp, p) {
  if (!fp || !p) return false;
  if (Array.isArray(fp)) { let c = false; for (let i = 0, j = fp.length - 1; i < fp.length; j = i++) { const [xi, zi] = fp[i], [xj, zj] = fp[j]; if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) c = !c; } return c; }
  if (fp.minX != null) return p[0] >= fp.minX && p[0] <= fp.maxX && p[1] >= fp.minZ && p[1] <= fp.maxZ;
  if (fp.radius != null) return dist(xz(fp.center ?? [fp.x, fp.z]), p) <= fp.radius;
  if (fp.w != null) return Math.abs(p[0] - fp.x) <= fp.w / 2 && Math.abs(p[1] - fp.z) <= (fp.d ?? fp.w) / 2;
  return false;
}

/** The place the seat's own act output resolved to (Reviewer-free): resolved.to / receipt.capability / chosen / receipt target. */
export function placeTarget(ev, acts) {
  for (const a of acts) {
    const out = a.output; if (!out || typeof out !== 'object') continue;
    for (const c of [out.resolved?.to, out.receipt?.capability, out.chosen?.id, out.chosen]) if (typeof c === 'string' && WALK.test(c)) return { place: c.split(/[:.]/).slice(1).join(':'), source: 'act' };
  }
  const r = (ev.receipts ?? []).find((x) => x.target?.place || WALK.test(x.capability ?? ''));
  if (r) return { place: r.target?.place ?? r.capability.split(/[:.]/).slice(1).join(':'), pos: r.target?.pos ? xz(r.target.pos) : null, source: `receipt ${r.id}` };
  return null;
}

/** runOracles(evidence, ctx) — ctx: {acts?: seat tool calls with outputs, godSlice?, run?} (acts are read from the run when absent). */
export function runOracles(ev, ctx = {}) {
  const P = `evidence/${ev.requestId}.json`;
  const acts = ctx.acts ?? (ctx.run ? seatActs(ctx.run, ev.seat, ev.chatTurns) : []);
  const sent = ms(ev.sentAt), cutoff = ms(ev.cutoffAt) ?? Infinity;
  const all = (ev.samples ?? []).map((s, i) => ({ ...s, i, ms: ms(s.t), p: xz(s.pos) }));
  const timely = all.filter((s) => s.ms <= cutoff);
  const late = all.length - timely.length;
  const last = timely.at(-1);
  const sp = (s) => `${P}#samples[${s.i}]`;
  const receipts = ev.receipts ?? [];
  const acted = acts.filter((a) => /\beden(-agent)?\.mjs act\b/.test(a.cmd));
  const accepted = acted.some((a) => a.output?.accepted) || receipts.length > 0;
  const out = [];

  // protocol
  if (ev.channel === 'card') out.push(ev.ackAt && ms(ev.ackAt) <= cutoff ? o('ack-latency', secs(sent, ms(ev.ackAt)) <= ACK_BOUND_SEC ? 'pass' : 'fail', `ack after ${secs(sent, ms(ev.ackAt))} s (bound ${ACK_BOUND_SEC} s)`, [`${P}#ackAt`]) : o('ack-latency', 'fail', 'no ack before cutoff', [`${P}#ackAt`]));
  else out.push(o('ack-latency', 'unknown', ev.resultAt ? `chat channel: no card ack; chat reply after ${secs(sent, ms(ev.resultAt))} s` : 'chat channel: no card ack and no reply', [`${P}#resultAt`]));
  out.push(!ev.resultAt ? o('result-sent', 'fail', 'no result before cutoff', [`${P}#resultAt`]) : ms(ev.resultAt) > cutoff ? o('result-sent', 'fail', `result arrived ${secs(cutoff, ms(ev.resultAt))} s after cutoff`, [`${P}#resultAt`]) : o('result-sent', 'pass', `result after ${secs(sent, ms(ev.resultAt))} s`, [`${P}#resultAt`]));
  const pres = [...timely.filter((s) => s.presence).map((s) => ({ v: s.presence, ptr: sp(s) })), ...(ev.legible ?? []).map((l, i) => ({ v: l.card?.presence, ptr: `${P}#legible[${i}].card.presence`, ms: ms(l.t) })).filter((x) => x.v && (x.ms ?? 0) <= cutoff)];
  const gaps = pres.filter((x) => /offline|away|asleep|not listening|disconnected|idle/i.test(x.v));
  out.push(!pres.length ? o('listen-open', 'unknown', 'no presence observed') : gaps.length ? o('listen-open', 'fail', `not listening in ${gaps.length}/${pres.length} observations (${gaps[0].v})`, gaps.map((g) => g.ptr)) : o('listen-open', 'pass', `listening/working in ${pres.length}/${pres.length} observations`, pres.slice(0, 2).map((g) => g.ptr)));

  // physical
  const tgt = placeTarget(ev, acts);
  if (!tgt) out.push(o('arrival', 'unknown', 'no place target in the seat\'s act output or receipts'));
  else if (!last) out.push(o('arrival', 'unknown', `target ${tgt.place}; no timely samples`));
  else {
    const at = norm(last.place).includes(norm(tgt.place)) || (last.placePath ?? []).some((x) => norm(x).includes(norm(tgt.place))) || (tgt.pos && last.p && dist(tgt.pos, last.p) <= 3);
    out.push(o('arrival', at ? 'pass' : 'fail', `target ${tgt.place} (from ${tgt.source}); at cutoff the Soul is at ${last.place ?? 'unknown place'}`, [sp(last)]));
  }
  const want = postureWanted(ev.text);
  const first = want ? timely.findIndex((s) => postureIs(s.posture, want)) : -1;
  if (!want) { out.push(o('posture', 'unknown', 'not a posture request')); out.push(o('duration-held', 'unknown', 'not a posture request')); }
  else if (!timely.length) { out.push(o('posture', 'unknown', `wanted ${want}; no timely samples`)); out.push(o('duration-held', 'unknown', 'no timely samples')); }
  else {
    out.push(first >= 0 ? o('posture', 'pass', `${want} from +${secs(sent, timely[first].ms)} s`, [sp(timely[first])]) : o('posture', 'fail', `wanted ${want}; observed ${[...new Set(timely.map((s) => s.posture))].join(', ')}`, [sp(last)]));
    if (first < 0) out.push(o('duration-held', 'unknown', 'posture never reached'));
    else { const lost = timely.slice(first).find((s) => !postureIs(s.posture, want)); out.push(lost ? o('duration-held', 'fail', `${want} lost at +${secs(sent, lost.ms)} s (${lost.posture})`, [sp(lost)]) : o('duration-held', 'pass', `${want} held ${secs(timely[first].ms, last.ms)} s to cutoff`, [sp(timely[first]), sp(last)])); }
  }
  const slice = ev.godSlice ?? ctx.godSlice ?? null;
  const solids = (slice?.entities ?? []).filter((e) => e.footprint && e.solid !== false);
  if (!solids.length) out.push(o('inside-solid', 'unknown', slice ? 'godSlice has no solid footprints' : 'no godSlice'));
  else { const hits = timely.filter((s) => s.p && solids.some((e) => inside(e.footprint, s.p))); out.push(hits.length ? o('inside-solid', 'fail', `inside ${solids.find((e) => inside(e.footprint, hits[0].p)).id} in ${hits.length} samples`, hits.slice(0, 3).map(sp)) : o('inside-solid', 'pass', `${timely.length} samples clear of ${solids.length} solid footprints`)); }

  const walks = receipts.filter((r) => WALK.test(r.capability ?? '') || r.target);
  const windowOf = (r) => { const a = ms(r.startedAt) ?? timely.find((s) => s.lastReceipt === r.id)?.ms; const b = Math.min(ms(r.endedAt) ?? cutoff, cutoff); return a == null ? [] : timely.filter((s) => s.ms >= a && s.ms <= b && s.p); };
  if (!walks.length) out.push(o('no-progress', 'unknown', 'no walk receipt'));
  else {
    let worst = null;
    for (const r of walks) { const w = windowOf(r); for (let i = 0; i < w.length; i++) { let j = i; while (j + 1 < w.length && dist(w[i].p, w[j + 1].p) < 0.5) j++; const span = (w[j].ms - w[i].ms) / 1000; if (span >= 20 && (!worst || span > worst.span)) worst = { r, span, a: w[i], b: w[j] }; } }
    out.push(worst ? o('no-progress', 'fail', `walk ${worst.r.id} started; position unchanged for ${worst.span} s`, [sp(worst.a), sp(worst.b)]) : o('no-progress', 'pass', `${walks.length} walk(s) kept moving`));
  }
  if (!walks.length) out.push(o('oscillation', 'unknown', 'no walk receipt'));
  else {
    const w = walks.flatMap(windowOf); let L = 0, rev = 0, prev = null;
    for (let i = 1; i < w.length; i++) { const d = [w[i].p[0] - w[i - 1].p[0], w[i].p[1] - w[i - 1].p[1]]; const n = Math.hypot(...d); L += n; if (n > 0.3) { if (prev && (prev[0] * d[0] + prev[1] * d[1]) / (Math.hypot(...prev) * n) < -0.5) rev++; prev = d; } }
    const D = w.length > 1 ? dist(w[0].p, w.at(-1).p) : 0;
    out.push(w.length < 3 ? o('oscillation', 'unknown', 'fewer than 3 samples while walking') : rev >= 3 || (L > 10 && L > 3 * D) ? o('oscillation', 'fail', `${rev} reversals; path ${L.toFixed(1)} m vs net ${D.toFixed(1)} m`, [sp(w[0]), sp(w.at(-1))]) : o('oscillation', 'pass', `${rev} reversals; path ${L.toFixed(1)} m, net ${D.toFixed(1)} m`));
  }
  const timed = receipts.filter((r) => r.startedAt && r.expectedSec);
  if (!timed.length) out.push(o('stuck-receipt', 'unknown', receipts.length ? 'no expected duration on receipts' : 'no receipts'));
  else { const stuck = timed.map((r) => ({ r, el: (Math.min(ms(r.endedAt) ?? cutoff, cutoff) - ms(r.startedAt)) / 1000 })).filter((x) => x.el > 3 * x.r.expectedSec); out.push(stuck.length ? o('stuck-receipt', 'fail', `${stuck[0].r.id} ${stuck[0].r.phase} for ${stuck[0].el} s (expected ${stuck[0].r.expectedSec} s)`, stuck.map((x) => `${P}#receipts[${receipts.indexOf(x.r)}]`)) : o('stuck-receipt', 'pass', `${timed.length} receipt(s) within 3x expected`)); }

  // truthfulness: owner-facing completion claims vs facts at the boundary
  const words = `${ev.ackText ?? ''} ${ev.resultText ?? ''}`;
  const claims = [];
  if (/\b(arrived|made it to|reached|i'?m (now )?(at|in) the|i am (now )?(at|in) the|here at the)\b/i.test(words)) claims.push('arrived');
  if (/\b(sat|sitting|seated)\b/i.test(words)) claims.push('sitting');
  if (/\b(lying|lay down|lain|napping|asleep)\b/i.test(words)) claims.push('lying');
  if (/\b(done|finished|completed)\b/i.test(words)) claims.push('done');
  const completed = receipts.filter((r) => r.phase === 'completed' && ms(r.endedAt ?? r.startedAt) <= cutoff);
  const atRes = timely.filter((s) => s.ms >= (ms(ev.resultAt) ?? sent) - 5000);
  const unsupported = claims.filter((c) => {
    if (c === 'sitting' || c === 'lying') return !atRes.some((s) => postureIs(s.posture, c)) && !completed.some((r) => r.capability?.startsWith(c === 'sitting' ? 'sit' : 'lie'));
    if (c === 'arrived') { const named = words.match(/(?:arrived at|made it to|reached|(?:at|in)) the ([a-z][\w ]{2,30}?)(?:[.!,]|$)/i)?.[1] ?? tgt?.place; const there = last && named && (norm(last.place).includes(norm(named)) || norm(named).includes(norm(last.place))); return !(completed.some((r) => WALK.test(r.capability ?? '')) && (there || !named)) && !there; }
    return !completed.length;
  });
  out.push(!claims.length ? o('truthfulness-basic', 'pass', 'no completion claim in ack/result') : unsupported.length ? o('truthfulness-basic', 'fail', `claims ${unsupported.join(', ')} but no completed receipt or matching body fact by cutoff${last ? ` (at ${last.place}, ${last.posture})` : ''}`, [`${P}#resultText`, ...(last ? [sp(last)] : [])]) : o('truthfulness-basic', 'pass', `claims ${claims.join(', ')} supported`, [`${P}#resultText`]));

  // vocabulary
  const unk = acts.filter((a) => a.output?.code === 'capability.unknown');
  if (!unk.length) out.push(o('vocabulary', 'pass', 'no unknown capability'));
  else {
    const offered = unk.some((a) => a.output.did_you_mean?.length) || acts.some((a) => /caps\b.*--search/.test(a.cmd) && (a.output?.matches?.length || a.output?.length));
    out.push(offered ? o('vocabulary', 'pass', 'unknown wording, but the world offered a match') : o('vocabulary', 'fail', `capability.unknown with no match for the player's wording "${ev.text}"`, unk.map((a) => `seats/${ev.seat}/transcript.jsonl#turn${a.turn}`)));
  }
  const keys = acted.map((a) => a.cmd.replace(/\s+--wait(\s+\d+)?/, '').trim());
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
  const dupR = receipts.filter((r, i) => receipts.findIndex((x) => x.capability === r.capability) !== i);
  out.push(dup.length || dupR.length ? o('duplicate-acts', 'fail', `${dup.length + dupR.length} repeated act(s): ${[...new Set([...dup, ...dupR.map((r) => r.capability)])].join('; ')}`) : o('duplicate-acts', 'pass', `${acted.length} act(s), none repeated`));
  const errs = (ev.serverErrors ?? 0) + acts.filter((a) => a.output?.code === 'unreachable' || a.output?.error?.code === 'unreachable' || (a.output?.status >= 500)).length;
  out.push(errs ? o('server-errors', 'fail', `${errs} server error(s)/unreachable`, [`${P}#serverErrors`]) : o('server-errors', 'pass', 'none'));
  const fb = ms(ev.firstBodyChangeAt);
  out.push(fb && fb <= cutoff ? o('first-body-change', 'pass', `first visible body change after ${secs(sent, fb)} s`, [`${P}#firstBodyChangeAt`]) : accepted ? o('first-body-change', 'fail', 'an action was accepted but no visible body change before cutoff', [`${P}#firstBodyChangeAt`]) : o('first-body-change', 'unknown', 'no body action was started'));
  if (late) out.forEach((r) => { r.lateSamplesExcluded = late; });
  return out.map((r) => ({ requestId: ev.requestId, ...r }));
}

/** Oracle results for every request of a run. */
export const runAllOracles = (run) => Object.fromEntries(run.evidence.map((ev) => [ev.requestId, runOracles(ev, { run })]));
export const oracleVetoes = (rows) => rows.filter((r) => PHYSICAL.includes(r.id) && r.status === 'fail').map((r) => r.id);

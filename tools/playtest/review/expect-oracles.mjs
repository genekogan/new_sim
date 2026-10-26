// Scenario-truth oracles (playtest round 2): a scripted request may carry `expect`, the world truth the scenario author
// read from the genesis template, and these oracles score the request against it. Code only: pass | fail | unknown with
// pointers. They run only for requests whose script entry has `expect` (older runs and the frozen set are untouched).
//
// Script entry: { seat, atSec, channel, text, budgetSec, expect: {
//   kind: 'go' | 'find' | 'near' | 'which-way' | 'face' | 'look',
//   targets: [{ names: ['eden-bandstand', 'bandstand'], pos: [x, z], radiusM: 6, ref: 'eden-bandstand' }],  // any one counts
//   answer: { anyOf: ['violin', 'bench'], noneOf: [], minHits: 1 },   // near / look: words the reply must use
//   view: 'any' | 'out' | 'alt',  toleranceDeg: 45,  source: 'worlds/templates/… (op name)' } }
// kind → oracles: go/find → target-arrival · near → answer-names · which-way → answer-direction · face → facing ·
// look → view-used + named-in-description. Positions are world x/z (x east, z south; north is −z, as perception speaks).
import { xz } from './run.mjs';

export const EXPECT_ORACLE_IDS = ['target-arrival', 'answer-names', 'answer-direction', 'facing', 'view-used', 'named-in-description'];
export const EXPECT_KINDS = { go: ['target-arrival'], find: ['target-arrival'], near: ['answer-names'], 'which-way': ['answer-direction'], face: ['facing'], look: ['view-used', 'named-in-description'] };
const KIND_NEEDS = { go: ['targets'], find: ['targets'], near: ['answer'], 'which-way': ['targets'], face: ['targets'], look: ['answer'] };

const ms = (iso) => (iso ? Date.parse(iso) : null);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const norm = (s) => String(s ?? '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '');
const words = (s) => ` ${String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
const o = (id, status, detail, pointers = []) => ({ id, status, detail, pointers });
const POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const DEG = { north: 0, northeast: 45, east: 90, southeast: 135, south: 180, southwest: 225, west: 270, northwest: 315 };

/** Compass bearing in degrees (0 = north, 90 = east) from one ground point to another. */
export const bearing = (from, to) => ((Math.atan2(to[0] - from[0], -(to[1] - from[1])) * 180) / Math.PI + 360) % 360;
export const angleDiff = (a, b) => { const d = Math.abs(((a - b) % 360) + 360) % 360; return d > 180 ? 360 - d : d; };
export const compassName = (deg) => POINTS[Math.round(deg / 45) % 8];

/** Compass directions a text names, in order → [{word, deg}] ("north-east", "northeast", "north east" all count). */
export function compassWords(text) {
  const out = []; const re = /\b(north|south)[- ]?(east|west)\b|\b(north|south|east|west)(?:ward|wards|erly)?\b/gi; let m;
  while ((m = re.exec(String(text ?? '')))) { const w = (m[1] ? m[1] + m[2] : m[3]).toLowerCase(); out.push({ word: m[0], deg: DEG[w] }); }
  return out;
}

/** Does a text use any of these names? Whole words with a plural ending ("bench" matches "benches", never "cellophane"
 *  for "cello"), accents folded ("cafe" matches "café"), multi-word names across hyphens and spaces. → the names found. */
export function namesIn(text, names) {
  const T = words(String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, ''));
  return (names ?? []).filter((n) => { const A = words(n).trim(); return A && new RegExp(` ${A.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(s|es)? `).test(T); });
}

/** The script entry (and its expect) that produced this evidence pack: same seat and text, k-th occurrence by sentAt. */
export function expectFor(run, ev) {
  const script = run?.scenario?.director?.script ?? [];
  const entries = script.filter((e) => (e.seat ?? null) === ev.seat && e.text === ev.text);
  if (!entries.length) return null;
  const packs = (run.evidence ?? []).filter((e) => e.seat === ev.seat && e.text === ev.text).sort((a, b) => ms(a.sentAt) - ms(b.sentAt));
  const k = Math.max(0, packs.findIndex((e) => e.requestId === ev.requestId));
  return entries[Math.min(k, entries.length - 1)]?.expect ?? null;
}

/** Problems with one expect block (scenario validation). → [string] */
export function validateExpect(x) {
  const errs = [];
  if (!x || typeof x !== 'object') return ['expect must be an object'];
  if (!EXPECT_KINDS[x.kind]) errs.push(`expect.kind must be one of ${Object.keys(EXPECT_KINDS).join(', ')}`);
  for (const need of KIND_NEEDS[x.kind] ?? []) if (need === 'targets' ? !(Array.isArray(x.targets) && x.targets.length) : !(Array.isArray(x.answer?.anyOf) && x.answer.anyOf.length)) errs.push(`expect.${need === 'targets' ? 'targets[]' : 'answer.anyOf[]'} required for ${x.kind}`);
  for (const [i, t] of (x.targets ?? []).entries()) {
    if (!Array.isArray(t.names) || !t.names.length) errs.push(`targets[${i}].names[] required`);
    if (!(Array.isArray(t.pos) && t.pos.length === 2 && t.pos.every(Number.isFinite))) errs.push(`targets[${i}].pos must be [x, z]`);
    if (t.radiusM != null && !(t.radiusM > 0)) errs.push(`targets[${i}].radiusM must be > 0`);
  }
  if (x.view != null && !['any', 'out', 'alt'].includes(x.view)) errs.push('expect.view must be any, out or alt');
  if (!x.source) errs.push('expect.source required (where the names and positions came from)');
  return errs;
}

const targetsOf = (x) => (x.targets ?? []).map((t) => ({ ...t, radiusM: t.radiusM ?? 5 }));
const label = (t) => t.ref ?? t.names[0];
const NEAR_AT = /^(here|at|close)$/i;
const sampleNames = (s) => [s.place, ...(s.placePath ?? []), ...(s.near ?? []).filter((n) => NEAR_AT.test(String(n.distance ?? ''))).flatMap((n) => [n.who, n.id])].filter(Boolean);
/** Is a body sample at one of the targets? → {target, by} | null (by: 'name' | 'position'). */
export function atAnyTarget(s, targets) {
  if (!s) return null;
  const p = s.p ?? xz(s.pos);
  for (const t of targets) {
    if (sampleNames(s).some((n) => t.names.some((k) => norm(k).length >= 3 && norm(n).includes(norm(k))))) return { target: t, by: 'name' };
    if (p && dist(p, t.pos) <= t.radiusM) return { target: t, by: `position (${dist(p, t.pos).toFixed(1)} m ≤ ${t.radiusM} m)` };
  }
  return null;
}

/** The last heading the body reported inside the request window: completed receipts' endedAt {heading, pos}. */
function lastHeading(receipts, samples, inWindow) {
  const done = [...receipts, ...samples.map((s) => s.lastReceipt).filter(Boolean)]
    .filter((r) => r?.endedAt && Number.isFinite(r.endedAt.heading) && Array.isArray(r.endedAt.pos) && inWindow(r) !== false && r.phase !== 'failed');
  done.sort((a, b) => (a.endedTick ?? 0) - (b.endedTick ?? 0));
  const r = done.at(-1);
  return r ? { heading: r.endedAt.heading, pos: xz(r.endedAt.pos), receipt: r.id ?? null, capability: r.capability ?? null } : null;
}

/** expectOracles({ev, expect, timely, replies, receipts, acts, inWindow, P}) → rows for the expect's kind. */
export function expectOracles({ ev, expect: x, timely = [], replies = [], receipts = [], acts = [], inWindow = () => true, P = `evidence/${ev.requestId}.json` }) {
  const errs = validateExpect(x);
  const ids = EXPECT_KINDS[x?.kind] ?? [];
  if (errs.length) return ids.map((id) => o(id, 'unknown', `expect invalid: ${errs.join('; ')}`));
  const T = targetsOf(x), out = [];
  const sp = (s) => `${P}#samples[${s.i}]`;
  const last = timely.at(-1);
  const reply = replies.map((r) => r.text).join('\n');
  const rptr = replies.map((r) => r.ptr).slice(0, 3);
  const cutoff = ms(ev.cutoffAt) ?? Infinity;
  const late = replies.length && replies.every((r) => r.ms > cutoff) ? ' (the answer came after the cutoff)' : '';
  const nameCheck = (id) => {
    const a = x.answer ?? {}; const min = a.minHits ?? 1;
    if (!replies.length) return o(id, 'fail', 'no answer to the owner', [`${P}#resultAt`]);
    const hit = namesIn(reply, a.anyOf), bad = namesIn(reply, a.noneOf ?? []);
    if (bad.length) return o(id, 'fail', `names ${bad.join(', ')}, which the world does not have there${late}`, rptr);
    return hit.length >= min ? o(id, 'pass', `names ${hit.join(', ')} (${hit.length}/${min} needed)${late}`, rptr) : o(id, 'fail', `names none of ${a.anyOf.slice(0, 8).join(', ')}${a.anyOf.length > 8 ? '…' : ''}${late}`, rptr);
  };
  for (const id of ids) {
    if (id === 'target-arrival') {
      if (!last) { out.push(o(id, 'unknown', `target ${T.map(label).join(' | ')}; no timely samples`)); continue; }
      const at = atAnyTarget(last, T);
      out.push(o(id, at ? 'pass' : 'fail', at ? `at ${label(at.target)} by ${at.by}` : `target ${T.map(label).join(' | ')}; at cutoff the Soul is at ${last.place ?? 'an unknown place'}${last.p ? ` (${last.p.map((v) => v.toFixed(1)).join(', ')}; nearest target ${Math.min(...T.map((t) => dist(last.p, t.pos))).toFixed(1)} m)` : ''}`, [sp(last)]));
    } else if (id === 'answer-names' || id === 'named-in-description') out.push(nameCheck(id));
    else if (id === 'answer-direction') {
      const first = timely.find((s) => s.p) ?? null;
      if (!first) { out.push(o(id, 'unknown', 'no body position when asked')); continue; }
      const t = T.reduce((a, b) => (dist(first.p, a.pos) <= dist(first.p, b.pos) ? a : b));
      const d = dist(first.p, t.pos), want = bearing(first.p, t.pos), tol = x.toleranceDeg ?? 50;
      if (d < 8) { out.push(o(id, 'unknown', `${label(t)} is ${d.toFixed(1)} m away: no direction to judge`, [sp(first)])); continue; }
      if (!replies.length) { out.push(o(id, 'fail', `no answer (truth: ${compassName(want)}, ${Math.round(d)} m)`, [sp(first)])); continue; }
      const said = compassWords(reply);
      if (!said.length) { out.push(o(id, 'unknown', `answered without a compass direction (truth: ${compassName(want)}, ${Math.round(d)} m)${late}`, [...rptr, sp(first)])); continue; }
      const ok = said.find((w) => angleDiff(w.deg, want) <= tol);
      out.push(o(id, ok ? 'pass' : 'fail', `said ${said.map((w) => w.word).join(', ')}; truth ${compassName(want)} (${Math.round(want)}°, ${Math.round(d)} m to ${label(t)}; tolerance ${tol}°)${late}`, [...rptr, sp(first)]));
    } else if (id === 'facing') {
      const gaze = acts.map((a) => /\bview\b.*--gaze\s+("?)([^"\s]+)\1/.exec(a.cmd ?? '')?.[2]).filter(Boolean).find((g) => T.some((t) => t.names.some((n) => norm(g).includes(norm(n)) || norm(n).includes(norm(g)))));
      const h = lastHeading(receipts, timely, inWindow);
      const tol = x.toleranceDeg ?? 45;
      if (h) {
        const t = T[0], d = dist(h.pos, t.pos), want = bearing(h.pos, t.pos), diff = angleDiff(h.heading, want);
        if (d < 1.5) { out.push(o(id, 'pass', `at ${label(t)} (${d.toFixed(1)} m): facing is moot`, [`${P}#receipts`])); continue; }
        if (diff <= tol || gaze) { out.push(o(id, 'pass', diff <= tol ? `body faces ${Math.round(h.heading)}°; ${label(t)} lies at ${Math.round(want)}° (${Math.round(diff)}° off, tolerance ${tol}°; ${h.capability ?? h.receipt})` : `eyes turned with view --gaze ${gaze} (body ${Math.round(diff)}° off)`, [`${P}#receipts`])); continue; }
        out.push(o(id, 'fail', `body faces ${Math.round(h.heading)}° (${compassName(h.heading)}); ${label(t)} lies at ${Math.round(want)}° (${compassName(want)}), ${Math.round(diff)}° off (tolerance ${tol}°)`, [`${P}#receipts`]));
      } else out.push(gaze ? o(id, 'pass', `eyes turned with view --gaze ${gaze} (no body heading in the window)`) : o(id, 'unknown', 'no completed act with a heading in the request window'));
    } else if (id === 'view-used') {
      const views = acts.filter((a) => /\beden(-agent)?\.mjs view\b/.test(a.cmd ?? ''));
      const want = x.view ?? 'any';
      const fits = views.filter((a) => want === 'any' || (want === 'out' ? /--out\b/.test(a.cmd) : /--alt(-only)?\b/.test(a.cmd)));
      out.push(fits.length ? o(id, 'pass', `${fits.length} view call(s) (${fits.map((a) => a.cmd.replace(/^.*?eden(-agent)?\.mjs /, '')).slice(0, 2).join('; ')})`, fits.map((a) => `seats/${ev.seat}/transcript.jsonl#turn${a.turn}`).slice(0, 2))
        : o(id, 'fail', views.length ? `view used, but not ${want === 'out' ? 'view --out (a picture)' : 'view --alt-only'}` : 'the seat never looked (no view call)'));
    }
  }
  return out;
}

// Emergence, metric part (spec §5): computed in code from evidence samples and receipts. The narrative part (story
// rating, O5, what more was wanted) comes from the Reviewer's session call. Heuristics are named in `basis`.
import { rng } from '../lib/hash.mjs';
import { xz } from './run.mjs';

const ms = (iso) => (iso ? Date.parse(iso) : null);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const verb = (cap) => String(cap ?? '').split(/[:.]/)[0].toLowerCase();
const entropy = (labels) => { const n = labels.length; if (!n) return 0; const c = {}; labels.forEach((l) => { c[l] = (c[l] ?? 0) + 1; }); return -Object.values(c).reduce((s, k) => s + (k / n) * Math.log2(k / n), 0) || 0; };

/** All samples (deduped by soul+time) and receipts (deduped by id) seen in the run. */
export function gather(run) {
  const seen = new Set(); const samples = [];
  const add = (s, soulId) => { const id = s.soulId ?? soulId; const k = `${id}@${s.t}`; if (!id || seen.has(k)) return; seen.add(k); samples.push({ ...s, soulId: id, ms: ms(s.t), p: xz(s.pos) }); };
  (run.session?.samples ?? []).forEach((s) => add(s));
  run.evidence.forEach((e) => (e.samples ?? []).forEach((s) => add(s, e.soulId)));
  const rs = new Map();
  [...(run.session?.receipts ?? []), ...run.evidence.flatMap((e) => (e.receipts ?? []).map((r) => ({ soulId: e.soulId, ...r })))].forEach((r) => { if (r.id && !rs.has(r.id)) rs.set(r.id, { ...r, ms: ms(r.startedAt) }); });
  return { samples: samples.sort((a, b) => a.ms - b.ms), receipts: [...rs.values()].sort((a, b) => (a.ms ?? 0) - (b.ms ?? 0)) };
}

export function computeEmergence({ samples, receipts, requests = [], binSec = 5, radius = 5, seed = 1, shuffles = 50 }) {
  const souls = [...new Set(samples.map((s) => s.soulId))];
  const t0 = samples[0]?.ms ?? 0; const binMs = binSec * 1000;
  const nBins = samples.length ? Math.floor((samples.at(-1).ms - t0) / binMs) + 1 : 0;
  const series = Object.fromEntries(souls.map((id) => [id, new Array(nBins).fill(null)]));
  samples.forEach((s) => { if (s.p) series[s.soulId][Math.floor((s.ms - t0) / binMs)] = s.p; });
  const coFrac = (shift) => { let n = 0, co = 0; for (let i = 0; i < souls.length; i++) for (let j = i + 1; j < souls.length; j++) for (let b = 0; b < nBins; b++) { const a = series[souls[i]][b]; const c = series[souls[j]][(b + (shift[j] ?? 0)) % nBins]; if (a && c) { n++; if (dist(a, c) <= radius) co++; } } return n ? co / n : null; };
  let coLocation = null;
  if (souls.length >= 2 && nBins > 1) {
    const r = rng(seed); const observed = coFrac({});
    let sum = 0, k = 0; for (let s = 0; s < shuffles; s++) { const sh = Object.fromEntries(souls.map((_, j) => [j, Math.floor(r() * nBins)])); const v = coFrac(sh); if (v != null) { sum += v; k++; } }
    const baseline = k ? sum / k : null;
    coLocation = { observed, baseline, ratio: baseline ? observed / baseline : null, radiusM: radius, binSec, shuffles, seed };
  }
  const talk = receipts.filter((r) => /talk|chat|convers|greet|say|speak/i.test(verb(r.capability)));
  const conversations = { started: talk.length, accepted: talk.filter((r) => ['started', 'completed'].includes(r.phase)).length, declined: talk.filter((r) => r.phase === 'failed' || /declin/i.test(r.code ?? '')).length, turns: talk.reduce((s, r) => s + (r.turns ?? 0), 0), initiators: talk.reduce((m, r) => ({ ...m, [r.soulId]: (m[r.soulId] ?? 0) + 1 }), {}) };
  const askedWith = (r) => requests.some((q) => q.soulId === r.soulId && r.ms != null && r.ms >= ms(q.sentAt) && r.ms <= (ms(q.cutoffAt) ?? Infinity) && (/\b(together|with|join|both)\b/i.test(q.text) || (r.with ?? []).some((w) => String(q.text).toLowerCase().includes(String(w).toLowerCase()))));
  const sharedKeys = new Set(); let unprompted = 0, prompted = 0;
  receipts.filter((r) => r.with?.length).forEach((r) => { const k = [[r.soulId, ...r.with].sort().join('+'), verb(r.capability), Math.floor((r.ms ?? 0) / 10000)].join('|'); if (sharedKeys.has(k)) return; sharedKeys.add(k); if (askedWith(r)) prompted++; else unprompted++; });
  const posAt = (soul, t) => { let best = null; for (const s of samples) { if (s.soulId !== soul || !s.p) continue; if (s.ms > t + binMs) break; best = s.p; } return best; };
  let imitation = 0;
  receipts.forEach((b) => { if (b.ms == null) return; const a = receipts.find((x) => x !== b && x.soulId !== b.soulId && x.ms != null && verb(x.capability) === verb(b.capability) && x.ms < b.ms && b.ms - x.ms <= 120000); if (!a) return; const pa = posAt(a.soulId, b.ms), pb = posAt(b.soulId, b.ms); if (!pa || !pb || dist(pa, pb) <= 10) imitation++; });
  const individuality = Object.fromEntries(souls.map((id) => { const mine = samples.filter((s) => s.soulId === id); return [id, { places: new Set(mine.map((s) => s.place).filter(Boolean)).size, activityEntropyBits: Math.round(entropy(mine.map((s) => s.activity ?? 'idle')) * 1000) / 1000 }]; }));
  const ent = Object.values(individuality).map((v) => v.activityEntropyBits);
  const objOf = (r) => r.produces ?? r.object ?? r.target?.object ?? null;
  const named = (x) => requests.some((q) => String(q.text).toLowerCase().includes(String(x).toLowerCase()));
  const next = (a) => receipts.filter((b) => b !== a && b.ms > a.ms && (b.object ?? b.target?.object ?? b.uses) === (a.produces ?? a.object) && objOf(a));
  const depth = (a, seen = new Set()) => { if (seen.has(a)) return 0; seen.add(a); return 1 + Math.max(0, ...next(a).map((b) => depth(b, seen))); };
  const roots = receipts.filter((a) => objOf(a) && !receipts.some((x) => next(x).includes(a)));
  const chains = roots.map((a) => ({ root: a.id, object: objOf(a), length: depth(a) })).filter((c) => c.length >= 2 && !named(c.object));
  return {
    souls: souls.length, coLocation, conversations, sharedActivities: { unprompted, prompted }, imitationWithin2min: imitation,
    individuality: { perSoul: individuality, meanActivityEntropyBits: ent.length ? Math.round((ent.reduce((a, b) => a + b, 0) / ent.length) * 1000) / 1000 : null },
    chainsGe2: chains.length, chains,
    basis: { coLocation: `pairs within ${radius} m per ${binSec}s bin vs ${shuffles} seeded circular time shuffles`, conversations: 'receipts whose verb is talk/chat/converse/greet/say/speak', shared: 'receipts with `with`, one per pair+verb+10 s; prompted when inside an owner request window whose text says together/with/join or names a partner', imitation: 'another Soul started the same verb ≤ 120 s earlier and was within 10 m (or position unknown)', individuality: 'distinct places and Shannon entropy of sampled activity labels', chains: 'receipt B uses the object receipt A produced (produces/object/target.object/uses), length ≥ 2, object not named in any request' },
  };
}

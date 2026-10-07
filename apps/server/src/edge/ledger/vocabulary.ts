// PM-R057: agents name things naturally (walk:pond, walk:library, "hang out at the deck"). An exact capability id
// always wins. Otherwise an unambiguous alias is accepted (reported back as `resolved`), and anything else is
// refused capability.unknown with `did_you_mean`: the closest capabilities actually offered. Pure and deterministic.
import type {EdgeCapability} from '../contract.ts';

export type VocabTarget = {
  /** Extra names a capability answers to: its target place's name, a Soul's name. */
  names: string[];
  /** For an object/fixture target: the place it stands in (id + name). Weaker than the target's own names. */
  around: string[];
  /** Target position [x, z], when known. */
  at: [number, number] | null;
};
export type VocabPlace = {id: string; name: string; center: [number, number]};
export type VocabContext = {
  caps: EdgeCapability[];
  target(cap: EdgeCapability): VocabTarget;
  /** Every known place (including ones with no capability yet), and the root's id/name tokens to ignore. */
  places: VocabPlace[];
  root: string[];
  me: [number, number] | null;
};
export type VocabResult =
  | {kind: 'exact'; cap: EdgeCapability}
  | {kind: 'alias'; cap: EdgeCapability; note: string}
  | {kind: 'unknown'; reason: string; didYouMean: {id: string; label: string}[]};

const STOP = new Set(['the', 'a', 'an', 'to', 'of', 'in', 'at', 'by', 'on', 'into', 'near', 'with', 'my', 'some']);
const VERBS: Record<string, string> = {go: 'walk', goto: 'walk', 'go-to': 'walk', 'walk-to': 'walk', visit: 'walk', move: 'walk', head: 'walk', travel: 'walk',
  hangout: 'hang-out', 'hang-around': 'hang-out', linger: 'hang-out', 'go-near': 'go-near', approach: 'go-near', join: 'go-near',
  'sit-on': 'sit', 'sit-at': 'sit', 'sit-down': 'sit', relax: 'rest', stroll: 'wander', 'warm': 'warm-by-fire', 'warm-up': 'warm-by-fire', fire: 'warm-by-fire',
  'stand-up': 'stand', stop: 'stand', greet: 'wave', 'turn-to': 'face', 'look-at': 'face'};
/** Within this many metres of a named place, its nearest admitted walk target stands in for it. */
export const NEAREST_PLACE_LIMIT = 60;

export const tokens = (s: string) => s.toLowerCase().replace(/\[[^\]]*\]/g, ' ').split(/[^a-z0-9]+/).filter(t => t && !STOP.has(t));
const norm = (s: string) => tokens(s).join(' ');
const tokenHit = (q: string, set: string[]) => set.some(t => t === q || (q.length >= 4 && t.length >= 4 && (t.startsWith(q) || q.startsWith(t))));
const bigrams = (s: string) => {const x = s.replace(/\s+/g, ''), out: string[] = []; for (let i = 0; i < x.length - 1; i++) out.push(x.slice(i, i + 2)); return out;};
function dice(a: string, b: string) {const A = bigrams(a), B = bigrams(b); if (!A.length || !B.length) return 0; const m = new Map<string, number>(); for (const g of A) m.set(g, (m.get(g) ?? 0) + 1); let hit = 0; for (const g of B) {const n = m.get(g) ?? 0; if (n) {hit++; m.set(g, n - 1);}} return 2 * hit / (A.length + B.length);}
const dist = (a: [number, number] | null, b: [number, number] | null) => a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : Infinity;

/** Split "verb:target" (or free text such as "hang out at the deck") into a canonical verb and the target words. */
export function parseCapability(input: string, verbs: Set<string>): {verb: string; rest: string} {
  const raw = input.trim(), i = raw.indexOf(':');
  const canon = (v: string) => {const k = v.toLowerCase().trim().replace(/[\s_]+/g, '-'); return verbs.has(k) ? k : VERBS[k] ?? k;};
  if (i >= 0) return {verb: canon(raw.slice(0, i)), rest: raw.slice(i + 1)};
  const words = raw.split(/\s+/);
  for (let n = Math.min(3, words.length); n >= 1; n--) {const v = canon(words.slice(0, n).join('-')); if (verbs.has(v)) return {verb: v, rest: words.slice(n).join(' ')};}
  return {verb: canon(words[0] ?? ''), rest: words.slice(1).join(' ')};
}

export function resolveCapability(input: string, ctx: VocabContext): VocabResult {
  const exact = ctx.caps.find(c => c.id === input); if (exact) return {kind: 'exact', cap: exact};
  const verbs = new Set(ctx.caps.map(c => c.verb)), {verb, rest} = parseCapability(input, verbs);
  const pool = ctx.caps.filter(c => c.verb === verb);
  const info = new Map(pool.map(c => {const t = ctx.target(c), own = [c.target?.id ?? '', c.id.slice(c.id.indexOf(':') + 1), c.label, ...t.names].filter(Boolean); return [c.id, {t, own, ownTokens: own.flatMap(tokens)}];}));
  const unknown = (reason: string, prefer: EdgeCapability[] = []) => ({kind: 'unknown' as const, reason, didYouMean: suggest(input, verb, rest, ctx, prefer)});
  const one = (cs: EdgeCapability[], note: (c: EdgeCapability) => string): VocabResult | null => {
    const live = cs.length > 1 ? cs.filter(c => c.available) : cs;           // several seats, only one free: that one
    if (live.length === 1) return {kind: 'alias', cap: live[0], note: note(live[0])};
    if (cs.length > 1) return unknown(`"${input}" could mean several things you can do; pick one of did_you_mean.`, cs);
    return null;
  };
  if (pool.length) {
    const q = tokens(rest), qs = q.join(' '), byOwn = (want: string) => pool.filter(c => info.get(c.id)!.own.some(n => norm(n) === want));
    // 0. Verbs with a single non-targeted (or "here") capability: rest:anything, swim:pond, wander:around.
    if (pool.length === 1 && (!pool[0].target || pool[0].id.endsWith(':here') || !q.length || pool[0].verb === 'swim')) return {kind: 'alias', cap: pool[0], note: `${input} is ${pool[0].id}.`};
    if (!q.length) return unknown(`Say which: "${verb}:<target>".`, pool);
    // "here": the nearest free one within reach (sit:here, hang-out:here).
    if (qs === 'here') {
      const near = pool.filter(c => c.available && dist(info.get(c.id)!.t.at, ctx.me) <= 6).sort((a, b) => dist(info.get(a.id)!.t.at, ctx.me) - dist(info.get(b.id)!.t.at, ctx.me) || a.id.localeCompare(b.id));
      return near.length ? {kind: 'alias', cap: near[0], note: `${input} is the nearest free one, ${near[0].id} (${near[0].label}).`} : unknown(`Nothing free to ${verb} within a few metres of you; the nearest are in did_you_mean.`, pool.filter(c => c.available).sort((a, b) => dist(info.get(a.id)!.t.at, ctx.me) - dist(info.get(b.id)!.t.at, ctx.me)).slice(0, 5));
    }
    const passes = [q, q.filter(t => !ctx.root.includes(t))].filter((p, i, all) => p.length && (i === 0 || p.length !== all[0].length));
    for (const words of passes) {
      const s = words.join(' ');
      // 1. Same name as the target, its label or its place name.
      const r1 = one(byOwn(s), c => `${input} is ${c.id} (${c.label}).`); if (r1) return r1;
      // 2. The place an object stands in (sit:commons-deck, warm-by-fire:social-eden-fire-circle).
      const r2 = one(pool.filter(c => info.get(c.id)!.t.around.some(n => norm(n) === s)), c => `${input}: ${c.id} (${c.label}) is there.`); if (r2) return r2;
      // 3. Every word appears in the target's own names (walk:pond → the pond).
      const r3 = one(pool.filter(c => words.every(w => tokenHit(w, info.get(c.id)!.ownTokens))), c => `${input} is ${c.id} (${c.label}).`); if (r3) return r3;
    }
    // 4. A known place with no capability of this verb: its nearest admitted target (walk:eden-library-1).
    if (['walk', 'hang-out', 'gather'].includes(verb)) for (const words of passes) {
      const s = words.join(' ');
      let places = ctx.places.filter(p => norm(p.id) === s || norm(p.name) === s);
      if (!places.length) places = ctx.places.filter(p => words.every(w => tokenHit(w, [...tokens(p.id), ...tokens(p.name)])));
      if (places.length !== 1) continue;
      // Prefer whole places (a classroom, the shore) over fixtures (a seat) as the stand-in.
      const reachable = pool.filter(c => c.available && info.get(c.id)!.t.at), wholes = reachable.filter(c => c.target?.kind === 'place');
      const place = places[0], ranked = (wholes.length ? wholes : reachable).map(c => ({c, d: dist(info.get(c.id)!.t.at, place.center)})).sort((a, b) => a.d - b.d || a.c.id.localeCompare(b.c.id));
      if (!ranked.length) break;
      if (ranked[0].d > NEAREST_PLACE_LIMIT) return unknown(`${place.name} is not walkable ground yet (the nearest place you can ${verb} to is ${Math.round(ranked[0].d)} m from it).`, ranked.slice(0, 3).map(r => r.c));
      return {kind: 'alias', cap: ranked[0].c, note: `${place.name} is not walkable ground yet; ${ranked[0].c.id} (${ranked[0].c.label}) is the nearest place you can ${verb} to, ${Math.round(ranked[0].d)} m from it.`};
    }
  }
  return unknown(pool.length ? `Nothing offered matches "${input}"; read capabilities again.` : `No "${verb}" capability is offered to this Soul right now; read capabilities again.`);
}

/** The closest offered capabilities: same verb first, then word overlap, string likeness, availability, distance. */
export function suggest(input: string, verb: string, rest: string, ctx: VocabContext, prefer: EdgeCapability[] = [], limit = 5): {id: string; label: string}[] {
  const q = tokens(rest || input), qs = q.join(' '), first = new Set(prefer.map(c => c.id));
  const scored = ctx.caps.map(c => {
    const t = ctx.target(c), words = [...tokens(c.id), ...tokens(c.label), ...t.names.flatMap(tokens), ...t.around.flatMap(tokens)];
    const overlap = q.reduce((n, w) => n + (words.includes(w) ? 1 : tokenHit(w, words) ? 0.6 : 0), 0), like = Math.max(dice(qs, norm(c.id.slice(c.id.indexOf(':') + 1))), dice(qs, norm(c.label)), ...t.names.map(n => dice(qs, norm(n))));
    return {c, score: (first.has(c.id) ? 100 : 0) + (c.verb === verb ? 20 : 0) + overlap * 10 + like * 8 + (c.available ? 1 : 0), d: dist(t.at, ctx.me)};
  });
  return scored.sort((a, b) => b.score - a.score || a.d - b.d || a.c.id.localeCompare(b.c.id)).slice(0, limit).map(({c}) => ({id: c.id, label: c.label}));
}

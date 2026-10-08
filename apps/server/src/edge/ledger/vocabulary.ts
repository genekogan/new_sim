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
export type VocabPlace = {id: string; name: string; center: [number, number];
  /** Optional richer facts (live ledger): parent id, kind, description words and whether a walk reaches it natively. */
  parent?: string | null; kind?: string; description?: string; walkable?: boolean};
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
  | {kind: 'alias'; cap: EdgeCapability; note: string; params?: Record<string, unknown>}
  | {kind: 'unknown'; reason: string; didYouMean: {id: string; label: string}[];
    /** Refusal code when it is not capability.unknown (place.unreachable: a named place exists but cannot be reached). */
    code?: string};

const STOP = new Set(['the', 'a', 'an', 'to', 'of', 'in', 'at', 'by', 'on', 'into', 'near', 'with', 'my', 'some', 'through', 'thru', 'around', 'across', 'over', 'back', 'please', 'little', 'bit', 'for', 'while', 'and', 'then', 'there']);
const VERBS: Record<string, string> = {go: 'walk', goto: 'walk', 'go-to': 'walk', 'walk-to': 'walk', visit: 'walk', move: 'walk', head: 'walk', travel: 'walk', 'come-back': 'walk', return: 'walk', 'go-back': 'walk', 'head-back': 'walk', 'walk-back': 'walk', 'go-over': 'walk',
  hangout: 'hang-out', 'hang-around': 'hang-out', linger: 'hang-out', 'go-near': 'go-near', approach: 'go-near', join: 'go-near',
  'sit-on': 'sit', 'sit-at': 'sit', 'sit-down': 'sit', 'take-a-seat': 'sit', 'have-a-seat': 'sit', 'take-seat': 'sit', 'be-seated': 'sit', seat: 'sit', relax: 'rest',
  stroll: 'stroll', 'take-a-walk': 'stroll', 'take-a-stroll': 'stroll', 'go-for-a-walk': 'stroll', 'go-for-a-stroll': 'stroll', 'walk-through': 'stroll', 'stroll-through': 'stroll', wander: 'stroll', ramble: 'stroll', meander: 'stroll', explore: 'stroll',
  'warm': 'warm-by-fire', 'warm-up': 'warm-by-fire', fire: 'warm-by-fire',
  'sit-ups': 'situps', situp: 'situps', 'sit-up': 'situps', 'push-ups': 'pushups', pushup: 'pushups', 'push-up': 'pushups', 'press-ups': 'pushups', 'star-jumps': 'jumping-jacks', 'jumping-jack': 'jumping-jacks', 'do-yoga': 'yoga', boogie: 'dance', hop: 'jump',
  'lie-down': 'lie', 'lay-down': 'lie', 'have-a-nap': 'nap', 'take-a-nap': 'nap', snooze: 'nap', doze: 'nap', sleep: 'nap',
  'stand-up': 'stand', 'get-up': 'stand', rise: 'stand', stop: 'stand', greet: 'wave', 'wave-to': 'wave', 'say-hi': 'wave', 'turn-to': 'face', 'look-at': 'face',
  // together/1 (core-next4)
  'walk-with': 'follow', 'go-with': 'follow', accompany: 'follow', 'hi-five': 'high-five', highfive: 'high-five', 'high-5': 'high-five', 'shake-hands': 'handshake', 'shake-hands-with': 'handshake',
  embrace: 'hug', applaud: 'clap', 'pick-up': 'pick-up', grab: 'pick-up', drop: 'put-down', 'put-down': 'put-down', 'set-down': 'put-down', 'hand-to': 'give', 'dance-with': 'dance-with'};
/** Everyday words for places, tried only when the word itself names nothing (walk:lake → the pond, walk:forest → the woodland). */
const SYNONYMS: Record<string, string[]> = {
  woods: ['woodland', 'wood', 'forest', 'grove'], wood: ['woodland', 'woods', 'forest'], forest: ['woodland', 'woods', 'grove'], trees: ['woodland', 'grove', 'orchard'], grove: ['woodland', 'orchard'],
  campfire: ['fire'], bonfire: ['fire', 'campfire'], fireplace: ['fire'], fire: ['campfire'], firepit: ['fire'], 'fire-pit': ['fire'],
  lake: ['pond'], pool: ['pond'], water: ['pond'], swim: ['pond'],
  meadow: ['lawn', 'field', 'green', 'commons'], field: ['commons', 'lawn', 'green'], lawn: ['commons', 'green'], green: ['lawn', 'commons'], grass: ['lawn', 'commons', 'green'],
  square: ['plaza', 'quad', 'green', 'commons'], plaza: ['square'], centre: ['commons'], center: ['commons'], middle: ['commons'],
  market: ['kiosks', 'market'], shops: ['kiosks', 'market'], shop: ['kiosks', 'market'], stalls: ['kiosks'],
  stage: ['deck', 'bandstand'], gazebo: ['bandstand', 'pavilion'], bandstand: ['gazebo'], garden: ['gardens'], gardens: ['garden'],
  dinner: ['dining'], food: ['dining', 'kitchen'], eat: ['dining', 'kitchen'], cafe: ['tea', 'café'], tea: ['café'], playground: ['playground'],
};
export const tokens = (s: string) => s.toLowerCase().replace(/\[[^\]]*\]/g, ' ').split(/[^a-z0-9]+/).filter(t => t && !STOP.has(t));
const norm = (s: string) => tokens(s).join(' ');
// A word names a token when equal, or one is the other with a short ending (garden/gardens, librar-/library); CN5: never a
// different word that merely starts with it ("watermill" is not "water").
const tokenHit = (q: string, set: string[]) => set.some(t => t === q || (q.length >= 4 && t.length >= 4 && Math.abs(q.length - t.length) <= 3 && (t.startsWith(q) || q.startsWith(t))));
const bigrams = (s: string) => {const x = s.replace(/\s+/g, ''), out: string[] = []; for (let i = 0; i < x.length - 1; i++) out.push(x.slice(i, i + 2)); return out;};
function dice(a: string, b: string) {const A = bigrams(a), B = bigrams(b); if (!A.length || !B.length) return 0; const m = new Map<string, number>(); for (const g of A) m.set(g, (m.get(g) ?? 0) + 1); let hit = 0; for (const g of B) {const n = m.get(g) ?? 0; if (n) {hit++; m.set(g, n - 1);}} return 2 * hit / (A.length + B.length);}
const dist = (a: [number, number] | null, b: [number, number] | null) => a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : Infinity;

/** Whole-sentence intents (activities/1): "find somewhere to read a book" → read, "lie down on the grass" → lie. The first
 *  matching rule whose verb is offered wins; its words are removed from the target text. */
const INTENTS: [RegExp, string, ('keep')?][] = [
  [/\b(?:post|send|mail)\b.*\b(?:letter|card|postcard)\b|\bpost (?:a |the )?letter\b|\bmailbox\b/, 'post-letter'],
  // CN5: computers, the gym, park games, stages and audiences
  [/\b(?:computer|computers|laptop|pc|online|internet|e-?mails?|browse the web|surf the web|typing)\b/, 'use-computer'],
  [/\bbench[- ]?press(?:es|ing)?\b/, 'bench-press'], [/\b(?:pull|chin)[- ]?ups?\b/, 'pull-ups'], [/\b(?:tricep )?dips\b|\bdip bars?\b/, 'dips'],
  [/\b(?:lift(?:ing)? weights|weight ?lifting|weights|dumbbells?|bicep curls?|curls|free weights|pump(?:ing)? iron)\b/, 'lift-weights'],
  [/\b(?:p[eé]tanque|boules|bocce)\b/, 'play-petanque'], [/\bfrisbee\b/, 'play-frisbee'], [/\b(?:beach )?volley ?ball\b/, 'play-volleyball'],
  [/\b(?:sing|singing|karaoke|open mic|microphone)\b/, 'sing'],
  [/\b(?:listen|listening|concert|audience|watch (?:the )?(?:show|band|performance|concert|musicians?))\b/, 'listen'],
  [/\b(?:drums?|drum kit|guitar|bass|violin|viola|cello|keyboard|keys)\b/, 'play-music', 'keep'],
  [/\bjumping[- ]?jacks?\b|\bstar[- ]?jumps?\b/, 'jumping-jacks'], [/\bpush[- ]?ups?\b|\bpress[- ]?ups?\b/, 'pushups'], [/\bsit[- ]?ups?\b|\bcrunches\b/, 'situps'],
  [/\byoga\b/, 'yoga'], [/\bstretch(?:es|ing)?\b/, 'stretch'], [/\bdanc(?:e|es|ing)\b|\bboogie\b/, 'dance'], [/\bjump(?:s|ing)?\b|\bhop\b/, 'jump'],
  [/\b(?:read|reading|reads)\b/, 'read'], [/\b(?:write|writing)\b/, 'write'],
  [/\bpiano\b/, 'play-piano'], [/\b(?:paint|painting|easel)\b/, 'paint'], [/\b(?:cook|cooking|bake|baking)\b/, 'cook'],
  [/\b(?:music|instrument|sing|singing)\b/, 'play-music'], [/\b(?:craft|crafts|carve|carving|woodwork|pottery|weave|weaving|whittle)\b/, 'craft'],
  [/\b(?:game|games|cards|board game|play a game)\b/, 'play-game'],
  [/\b(?:eat|eating|meal|lunch|dinner|breakfast|snack)\b/, 'eat'], [/\b(?:drink|coffee|tea)\b/, 'drink'],
  [/\b(?:nap|snooze|doze|sleep|sleeping|siesta|rest my eyes)\b/, 'nap'], [/\b(?:lie|lay|lying|laying)\b/, 'lie'],
  [/\bsit\b.*\b(?:ground|grass|floor|lawn|sand)\b/, 'sit-ground'], [/\b(?:sit|seat|seated)\b/, 'sit'],
  [/\b(?:stroll|wander|ramble|meander|explore|take a walk|go for a walk|walk (?:around|through|about))\b/, 'stroll'],
  [/\b(?:stand up|get up|stand)\b/, 'stand'], [/\b(?:swim|dip|bathe)\b/, 'swim'], [/\b(?:warm up|warm)\b/, 'warm-by-fire'],
  [/\b(?:go|walk|head|come|return|visit|travel)\b/, 'walk'],
];
/** Words that only carry the intent, never the target ("find somewhere quiet to read a book" names no place). */
const FILLER = new Set(['find', 'somewhere', 'someplace', 'place', 'spot', 'quiet', 'nice', 'good', 'cozy', 'cosy', 'comfy', 'book', 'books', 'novel', 'down', 'up', 'read', 'reading',
  'nap', 'snooze', 'doze', 'sleep', 'sleeping', 'siesta', 'lie', 'lay', 'lying', 'laying', 'sit', 'seat', 'seated', 'piano', 'play', 'paint', 'painting', 'easel', 'cook', 'cooking', 'bake',
  'music', 'instrument', 'craft', 'crafts', 'game', 'games', 'cards', 'eat', 'meal', 'lunch', 'dinner', 'breakfast', 'snack', 'drink', 'coffee', 'tea', 'post', 'send', 'mail',
  'letter', 'card', 'write', 'writing', 'stroll', 'wander', 'walk', 'go', 'take', 'have', 'let', 'lets', 'me', 'i', 'want', 'like', 'would', 'could', 'can', 'you', 'we', 'he', 'she', 'they',
  'him', 'her', 'them', 'just', 'now', 'something', 'thing', 'do', 'get', 'grab', 'head', 'come', 'return', 'visit', 'travel', 'around', 'about', 'quick', 'short', 'long', 'while',
  'use', 'using', 'check', 'work', 'game', 'round', 'throw', 'toss', 'catch', 'sing', 'song', 'songs', 'listen', 'watch', 'show', 'set', 'reps', 'exercise', 'exercises', 'workout', 'concert', 'performance', 'audience', 'band']);

/** "go for a X", "take a X", "have a X": X decides the verb (a swim is a swim, a balloon ride is the ride, never a stroll). */
const GO_FOR = /^(?:let'?s\s+|i\s+want\s+to\s+|please\s+)?(?:go|going|take|have|do|try)\s+(?:for\s+|on\s+|in\s+)?(?:a|an|some|the)\s+(.+)$/i;
const GO_FOR_X: [RegExp, string][] = [[/^(?:sit[- ]?ups?|crunches)\b/, 'situps'], [/^(?:push[- ]?ups?|press[- ]?ups?)\b/, 'pushups'], [/^(?:jumping[- ]?jacks?|star[- ]?jumps?)\b/, 'jumping-jacks'], [/^yoga\b/, 'yoga'], [/^(?:swim|dip|bathe|paddle)\b/, 'swim'], [/^(?:walk|stroll|wander|ramble|wee walk|little walk|short walk|long walk)\b/, 'stroll'], [/^(?:nap|snooze|doze|sleep|siesta|lie[- ]down)\b/, 'nap'],
  [/^(?:seat|sit)\b/, 'sit'], [/^(?:dance|boogie)\b/, 'dance'], [/^(?:stretch)\b/, 'stretch'], [/^(?:read|book)\b/, 'read'], [/^(?:look|wander around)\b/, 'stroll'], [/^(?:rest|break|breather)\b/, 'rest'], [/^(?:drink|coffee|tea|cuppa)\b/, 'drink'], [/^(?:meal|bite|snack|lunch|dinner|breakfast)\b/, 'eat']];
/** Rides: the balloon (and any later carrier) is an object you join. */
export const RIDE_WORDS = /\b(?:ride|rides|balloon|fly|flight|flying|go up|up in the air|hot[- ]air)\b/i;
/** Things bodies cannot do yet: refused honestly (never resolved to something else). */
export const NOT_YET: [RegExp, string, string[]][] = [
  [/\b(?:run|runs|running|jog|jogging|sprint|sprinting|race|hurry)\b/i, 'Bodies cannot run yet (walking only); walk or stroll instead.', ['stroll', 'wander', 'walk']],
  [/\b(?:kiss|kisses|kissing|snog)\b/i, 'Kissing is not a gesture here; hug, shake hands, high-five, bow or wave instead (hugs and handshakes ask the other Soul first).', ['hug', 'handshake', 'high-five', 'wave']],
  [/\b(?:climb|jump over|vault|cartwheel|somersault|backflip)\b/i, 'Climbing and acrobatics are not possible yet.', ['jump', 'stretch', 'dance']],
  // CN5 (acceptance: "go fishing" walked to the playground): things nobody can do here yet are refused, never swapped
  [/\b(?:fishing|go fish|to fish|catch (?:a |some )?fish|rowing|row (?:a |the )?boat|boating|sailing|canoeing|kayaking|paddle (?:a |the )?boat)\b/i, 'Fishing and boats are not possible yet.', ['swim', 'stroll', 'sit']],
  [/\b(?:swinging|on the swings?|go on (?:a |the )?swing|feed(?:ing)? (?:the )?(?:ducks|birds|fish)|skateboard\w*|cycling|ride (?:a |my |the )?(?:bike|bicycle))\b/i, 'That is not possible here yet.', ['stroll', 'sit', 'dance']],
];
/** CN5: "go <doing>" names an activity, not a place: these mean something here; any other is refused (never a walk). */
const GO_ING: Record<string, string> = {swimming: 'swim', walking: 'stroll', strolling: 'stroll', hiking: 'stroll', exploring: 'stroll', wandering: 'stroll', rambling: 'stroll', sightseeing: 'stroll',
  dancing: 'dance', reading: 'read', painting: 'paint', napping: 'nap', sitting: 'sit', exercising: 'stretch', stretching: 'stretch', singing: 'sing', shopping: 'walk market'};

/** Split "verb:target" (or free text such as "hang out at the deck") into a canonical verb and the target words. */
export function parseCapability(input: string, verbs: Set<string>): {verb: string; rest: string} {
  const raw = input.trim(), i = raw.indexOf(':');
  const canon = (v: string) => {const k = v.toLowerCase().trim().replace(/[\s_]+/g, '-'); return verbs.has(k) ? k : VERBS[k] ?? k;};
  if (i >= 0) return {verb: canon(raw.slice(0, i)), rest: raw.slice(i + 1)};
  const gf = GO_FOR.exec(raw);
  if (gf) {const x = gf[1].toLowerCase().trim(); for (const [re, v] of GO_FOR_X) if (re.test(x)) {if (verbs.has(v) || v === 'stroll') return {verb: v, rest: x.replace(re, ' ').trim()}; break;}}
  const words = raw.split(/\s+/);
  for (let n = Math.min(4, words.length); n >= 1; n--) {
    const v = canon(words.slice(0, n).join('-')), rest = words.slice(n).join(' ');
    if (!verbs.has(v)) continue;
    // "sit on the grass" is sitting on the ground, not on a seat called grass.
    if (v === 'sit' && verbs.has('sit-ground') && /\b(?:ground|grass|floor|lawn|sand)\b/i.test(rest)) return {verb: 'sit-ground', rest: ''};
    return {verb: v, rest};
  }
  // A whole sentence: the first offered intent, its words removed from the target text.
  const text = raw.toLowerCase();
  for (const [re, verb, keep] of INTENTS) if (verbs.has(verb) && re.test(text)) return {verb, rest: (keep ? text : text.replace(re, ' ')).split(/[^a-z0-9.-]+/).filter(w => w && !FILLER.has(w) && !STOP.has(w)).join(' ')};
  return {verb: canon(words[0] ?? ''), rest: words.slice(1).join(' ')};
}

/** Verbs whose target is a place (natural place names and the places map apply). */
const PLACE_VERBS = new Set(['walk', 'hang-out', 'gather', 'stroll', 'read']);

export function resolveCapability(input: string, ctx: VocabContext): VocabResult {
  const exact = ctx.caps.find(c => c.id === input); if (exact) return {kind: 'exact', cap: exact};
  // CN5 (acceptance): "A, then B" is two things. Walks and strolls chain (the earlier ones become `via` legs of the last);
  // anything else does the first and says to act again for the rest (never a mix-up of the two).
  const clauses = input.includes(':') ? [input] : input.split(/\s*(?:,|;)?\s+(?:and\s+)?then\s+|\s*;\s*|\s*,\s*and\s+then\s+/i).map(x => x.trim()).filter(Boolean);
  if (clauses.length > 1) {
    const parts = clauses.map(c => resolveCapability(c, ctx)), moves = ['walk', 'stroll'];
    if (parts[0].kind === 'unknown') return parts[0];
    if (parts.every(r => r.kind !== 'unknown' && moves.includes(r.cap.verb) && r.cap.target)) {
      const last = parts.at(-1) as Exclude<VocabResult, {kind: 'unknown'}>, via = parts.slice(0, -1).map(r => (r as Exclude<VocabResult, {kind: 'unknown'}>).cap.id);
      if (via.length <= 4) return {kind: 'alias', cap: last.cap, params: {via}, note: `${input} is ${via.join(', then ')}, then ${last.cap.id} (one act: via ${via.join(', ')}).`};
    }
    const first = parts[0] as Exclude<VocabResult, {kind: 'unknown'}>;
    return {kind: 'alias', cap: first.cap, note: `${'note' in first ? first.note : `${clauses[0]} is ${first.cap.id}.`} Doing the first part now; act again for "${clauses.slice(1).join(', then ')}" when its receipt completes.`};
  }
  const text = input.toLowerCase(), colon = text.indexOf(':'), head = colon >= 0 ? text.slice(0, colon) : '';
  // CN5: "go fishing", "go swimming": the doing word decides; an unknown one is refused, never taken as a place
  const going = colon < 0 ? /^(?:let'?s\s+|i\s+want\s+to\s+)?(?:go|going|went)\s+([a-z]+ing)\b(.*)$/.exec(text) : null;
  if (going && !NOT_YET.some(([re]) => re.test(text))) {
    const [verb, ...more] = (GO_ING[going[1]] ?? '').split(' ');
    if (!verb) return {kind: 'unknown', reason: `"${going[1]}" is not something bodies can do here yet; nothing else was chosen in its place.`, didYouMean: suggest(input, 'stroll', '', ctx, ctx.caps.filter(c => c.id.endsWith(':here') && c.available).slice(0, 5))};
    const sub = resolveCapability(`${verb} ${[...more, going[2].trim()].join(' ')}`.trim(), ctx);
    return sub.kind === 'unknown' || sub.cap.verb === verb || (verb === 'stroll' && sub.cap.verb === 'wander') ? sub : {kind: 'unknown', reason: `Nothing to ${verb} is offered here right now; nothing else was chosen in its place.`, didYouMean: suggest(input, verb, '', ctx)};
  }
  // Unsupported motions are refused honestly, with the nearest real things to do.
  if (colon < 0 || !ctx.caps.some(c => c.verb === head)) for (const [re, reason, prefer] of NOT_YET) if (re.test(colon < 0 ? text : head)) return {kind: 'unknown', reason, didYouMean: suggest(input, prefer[0], '', ctx, ctx.caps.filter(c => prefer.includes(c.verb) && c.available).slice(0, 5))};
  // Rides: "ride the balloon", "go for a balloon ride", "fly" → joining the ride object.
  if ((colon < 0 || ['ride', 'fly', 'balloon'].includes(head)) && RIDE_WORDS.test(text) && !/\b(?:bike|bicycle|horse|boat)\b/.test(text)) {
    const rides = ctx.caps.filter(c => c.verb === 'object' && c.action === 'join' && /ride|balloon|carrier/i.test(c.id + ' ' + c.label));
    const named = rides.filter(c => tokens(text).some(w => w.length > 3 && !['ride', 'rides'].includes(w) && tokens(c.id + ' ' + c.label).includes(w)));
    const pick = (named.length ? named : rides).sort((a, b) => Number(b.available) - Number(a.available) || a.id.localeCompare(b.id))[0];
    if (pick) return {kind: 'alias', cap: pick, note: `${input} is ${pick.id} (${pick.label}).`};
  }
  const verbs = new Set(ctx.caps.map(c => c.verb)); let {verb, rest} = parseCapability(input, verbs);
  // "stroll" with nothing named is a stroll right here.
  if (verb === 'stroll' && !tokens(rest).length && !ctx.caps.some(c => c.id === 'stroll:here')) {const w = ctx.caps.find(c => c.id === 'wander:here'); if (w) return {kind: 'alias', cap: w, note: `${input} is ${w.id}.`};}
  if (verb === 'stroll' && !verbs.has('stroll') && verbs.has('wander')) verb = 'wander';
  const pool = ctx.caps.filter(c => c.verb === verb);
  const info = new Map(pool.map(c => {const t = ctx.target(c), own = [c.target?.id ?? '', c.id.slice(c.id.indexOf(':') + 1), c.label, ...t.names].filter(Boolean); return [c.id, {t, own, ownTokens: own.flatMap(tokens)}];}));
  const unknown = (reason: string, prefer: EdgeCapability[] = []) => ({kind: 'unknown' as const, reason, didYouMean: suggest(input, verb, rest, ctx, prefer)});
  const dme = (c: EdgeCapability) => dist(info.get(c.id)?.t.at ?? null, ctx.me);
  const placeOf = (c: EdgeCapability) => ctx.places.find(p => p.id === c.target?.id);
  // Several fit: the free ones; a place that contains the others (the park, not its gazebo); then the nearest.
  const one = (cs: EdgeCapability[], note: (c: EdgeCapability) => string): VocabResult | null => {
    if (!cs.length) return null;
    const live = cs.filter(c => c.available), list = live.length ? live : cs;
    if (list.length === 1) return {kind: 'alias', cap: list[0], note: note(list[0])};
    const outer = list.filter(c => {const p = placeOf(c); return !!p && list.every(o => o === c || isAncestor(ctx, p.id, o.target?.id));});
    if (outer.length === 1) return {kind: 'alias', cap: outer[0], note: note(outer[0]) + ` (it contains ${list.length - 1} more specific match${list.length > 2 ? 'es' : ''})`};
    const ranked = [...list].sort((a, b) => dme(a) - dme(b) || a.id.localeCompare(b.id));
    return {kind: 'alias', cap: ranked[0], note: note(ranked[0]) + ` (the nearest of ${list.length}; also ${ranked.slice(1, 4).map(c => c.id).join(', ')})`};
  };
  if (pool.length) {
    const q = tokens(rest).filter(t => !FILLER.has(t) || !PLACE_VERBS.has(verb) ? true : false), qs = q.join(' '), byOwn = (want: string) => pool.filter(c => info.get(c.id)!.own.some(n => norm(n) === want));
    const here = pool.find(c => c.id === `${verb}:here`);
    // 0. Verbs with a single non-targeted (or "here") capability: rest:anything, swim:pond, wander:around.
    if (pool.length === 1 && (!pool[0].target || pool[0].id.endsWith(':here') || !q.length || pool[0].verb === 'swim')) return {kind: 'alias', cap: pool[0], note: `${input} is ${pool[0].id}.`};
    // Nothing named, or "here"/"down"/"nearby": the verb's own :here capability (sit down → sit:here).
    if (here && (!q.length || ['here', 'nearby', 'near', 'anywhere', 'somewhere', 'down', 'now', 'nearest'].includes(qs))) return {kind: 'alias', cap: here, note: `${input} is ${here.id} (${here.label}).`};
    // CN5: an activity at spots with nothing named: the nearest free one (use a computer, play the drums, sing, play pétanque)
    if (!q.filter(t => !FILLER.has(t)).length && pool.every(c => c.target?.kind === 'spot')) {
      const near = pool.filter(c => c.available).sort((a, b) => dme(a) - dme(b) || a.id.localeCompare(b.id));
      if (near.length) return {kind: 'alias', cap: near[0], note: `${input} is the nearest free one, ${near[0].id} (${near[0].label}, ${Math.round(dme(near[0]))} m).`};
    }
    if (!q.length) return unknown(`Say which: "${verb}:<target>".`, pool);
    // "here" without a :here capability: the nearest free one within reach (30 m for seats).
    if (qs === 'here' || qs === 'nearby' || qs === 'nearest') {
      const reach = verb === 'sit' ? 30 : pool.every(c => c.target?.kind === 'spot') ? 150 : 6;
      const near = pool.filter(c => c.available && dme(c) <= reach).sort((a, b) => dme(a) - dme(b) || a.id.localeCompare(b.id));
      if (near.length) return {kind: 'alias', cap: near[0], note: `${input} is the nearest free one, ${near[0].id} (${near[0].label}).`};
      const rest_ = ctx.caps.find(c => c.id === 'rest:here');
      if (verb === 'sit' && rest_) return {kind: 'alias', cap: rest_, note: `No free seat within ${reach} m; resting where you stand instead (${rest_.id}).`};
      return unknown(`Nothing free to ${verb} within a few metres of you; the nearest are in did_you_mean.`, pool.filter(c => c.available).sort((a, b) => dme(a) - dme(b)).slice(0, 5));
    }
    const passes = [q, q.filter(t => !ctx.root.includes(t))].filter((p, i, all) => p.length && (i === 0 || p.length !== all[0].length));
    for (const words of passes) {
      const s = words.join(' ');
      // CN5: a place elsewhere whose own name is exactly these words, and that this resolution does not reach, is named in the note.
      const also = (r: VocabResult | null): VocabResult | null => {
        if (!r || r.kind !== 'alias' || !PLACE_VERBS.has(verb)) return r;
        const t = r.cap.target?.id, other = ctx.places.filter(p => norm(p.name) === s && p.id !== t && !isAncestor(ctx, p.id, t) && !(t && isAncestor(ctx, t, p.id)));
        return other.length ? {...r, note: `${r.note} ("${other[0].name}" also names ${other[0].id}${other[0].walkable ? '' : ', which cannot be reached yet'}.)`} : r;
      };
      // 1. Same name as the target, its label or its place name.
      const r1 = also(one(byOwn(s), c => `${input} is ${c.id} (${c.label}).`)); if (r1) return r1;
      // 2. The place an object stands in (sit:commons-deck, warm-by-fire:social-eden-fire-circle).
      const r2 = also(one(pool.filter(c => info.get(c.id)!.t.around.some(n => norm(n) === s)), c => `${input}: ${c.id} (${c.label}) is there.`)); if (r2) return r2;
      // 3. Every word appears in the target's own names (walk:pond → the pond).
      const r3 = also(one(pool.filter(c => words.every(w => tokenHit(w, info.get(c.id)!.ownTokens))), c => `${input} is ${c.id} (${c.label}).`)); if (r3) return r3;
    }
    // 3b. Places by name/description words and everyday synonyms (the park, the woods, the lake, the campfire).
    // CN5 (Gene: "walk to the harbour" went to the park): a named place resolves only to itself, a place inside it, or the
    // place that contains it. A named place that cannot be reached is refused honestly (place.unreachable), never swapped
    // for an unrelated place; the nearest places you can reach are offered in did_you_mean.
    if (PLACE_VERBS.has(verb)) for (const words of passes) {
      const found = placeMatch(words, ctx.places);
      if (!found.length) continue;
      const capOf = new Map(pool.filter(c => c.target).map(c => [c.target!.id, c]));
      const reach = found.filter(p => capOf.has(p.id));
      if (reach.length) {const r = one(reach.map(p => capOf.get(p.id)!), c => `${input} is ${c.id} (${c.label}).`); if (r) return r;}
      const place = found[0], inner = pool.filter(c => c.available && c.target && isAncestor(ctx, place.id, c.target.id));
      if (inner.length) {const r = one(inner, c => `${place.name} itself is not a ${verb} target; ${c.id} (${c.label}) is in it.`); if (r) return r;}
      // the nearest containing place this verb reaches (the harbour for its lighthouse), never the world root
      const byId = new Map(ctx.places.map(p => [p.id, p]));
      for (let q = place.parent ? byId.get(place.parent) : undefined, n = 0; q && n < 20; q = q.parent ? byId.get(q.parent) : undefined, n++) {
        const c = capOf.get(q.id);
        if (c?.available) return {kind: 'alias', cap: c, note: `${place.name} itself is not a ${verb} target; ${c.id} (${c.label}) contains it.`};
      }
      const reachable = pool.filter(c => c.available && info.get(c.id)!.t.at), wholes = reachable.filter(c => c.target?.kind === 'place');
      const ranked = (wholes.length ? wholes : reachable).map(c => ({c, d: dist(info.get(c.id)!.t.at, place.center)})).sort((a, b) => a.d - b.d || a.c.id.localeCompare(b.c.id));
      const why = verb === 'read' ? `there is nowhere to read in ${place.name}` : `${place.name} is not walkable ground yet`;
      return {kind: 'unknown', code: 'place.unreachable', reason: `${input}: ${why}${ranked.length ? ` (the nearest place you can ${verb} to is ${ranked[0].c.id}, ${Math.round(ranked[0].d)} m from it)` : ''}; nothing else was chosen in its place.`,
        didYouMean: ranked.slice(0, 3).map(r => ({id: r.c.id, label: r.c.label}))};
    }
  }
  if (!pool.length) return unknown(`No "${verb}" capability is offered to this Soul right now. Things you can do: ${ctx.caps.filter(c => c.id.endsWith(':here')).map(c => c.id).slice(0, 12).join(', ')} (and walk:<place>, stroll:<place>, read:<place>); read capabilities again.`, ctx.caps.filter(c => c.id.endsWith(':here')));
  return unknown(`Nothing offered matches "${input}"; read capabilities again.`);
}

function isAncestor(ctx: VocabContext, ancestor: string, id: string | undefined): boolean {
  const byId = new Map(ctx.places.map(p => [p.id, p]));
  for (let p = id ? byId.get(id) : undefined, n = 0; p && n < 20; p = p.parent ? byId.get(p.parent) : undefined, n++) if (p.parent === ancestor) return true;
  return false;
}
/** Places named by these words: own name/id first, then everyday synonyms, then description words; the most
 *  obvious first (by name over description, walkable, outermost, larger). */
export function placeMatch(words: string[], places: VocabPlace[]): VocabPlace[] {
  if (!words.length) return [];
  const nameT = (p: VocabPlace) => [...tokens(p.name), ...tokens(p.id)], descT = (p: VocabPlace) => tokens(p.description ?? '');
  const hit = (w: string, set: string[]) => tokenHit(w, set) || (SYNONYMS[w] ?? []).some(s => tokenHit(s, set));
  const tiers = [
    // CN5: a place whose own name is exactly these words comes first ("Artists' studio" is the office studio, not the village's warehouse)
    places.filter(p => tokens(p.name).join(' ') === words.join(' ')),
    places.filter(p => words.every(w => tokenHit(w, nameT(p)))),
    places.filter(p => words.every(w => hit(w, nameT(p)))),
    places.filter(p => words.every(w => hit(w, [...nameT(p), ...descT(p)]))),
  ];
  const found = tiers.find(t => t.length) ?? [];
  const depth = (p: VocabPlace) => {let n = 0; for (let q: VocabPlace | undefined = p; q?.parent; q = places.find(x => x.id === q!.parent)) n++; return n;};
  return [...found].sort((a, b) => Number(!!b.walkable) - Number(!!a.walkable) || Number(a.kind === 'water') - Number(b.kind === 'water') || depth(a) - depth(b) || a.id.localeCompare(b.id));
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

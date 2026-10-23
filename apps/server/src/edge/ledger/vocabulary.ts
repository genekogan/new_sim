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
  /** Declared place aliases, distinct from descriptive words and fuzzy matching. */
  aliases?: readonly string[];
  /** Optional richer facts (live ledger): parent id, kind, description words and whether a walk reaches it natively. */
  parent?: string | null; kind?: string; description?: string; walkable?: boolean};
export type VocabContext = {
  caps: EdgeCapability[];
  target(cap: EdgeCapability): VocabTarget;
  /** Every known place (including ones with no capability yet), and the root's id/name tokens to ignore. */
  places: VocabPlace[];
  /** knowledge/1: the names (as tokens, space-joined) of places withheld from this Soul (secret, not yet known). Words that
   *  name one name nothing: never swapped for another place by synonym or description (a name never confirms one). */
  withheld?: string[];
  root: string[];
  me: [number, number] | null;
  /** Ids of the places the Soul is standing in (innermost first), when known: a stroll named for one of them is in place. */
  here?: string[];
  /** r3 quality (cases 23/29): where the nearest thing for a spot-based verb (swing, fish, cycle = a bicycle dock…) is anywhere in
   *  this world, ignoring offer reach. `null`: none exists in this world (the refusal is terminal); `undefined`: not spot-based. */
  elsewhere?: (verb: string) => {label: string; place?: string; placeId?: string; distance: number} | null | undefined;
  /** ROUTE-RECHECK: whether a place (or a place inside it) has a spot for this verb anywhere in the world (a reading spot),
   *  offered or not; unset: unknown (every named place counts). */
  hasSpot?: (verb: string, placeId: string) => boolean;
};
export type VocabResult =
  | {kind: 'exact'; cap: EdgeCapability}
  | {kind: 'alias'; cap: EdgeCapability; note: string; params?: Record<string, unknown>;
    /** RESOLVE (2026-10-21): the target words named no offered thing by its own name, only a place whose description lists
     *  them ("go to the horse": a lawn "with ... a horse"): a host may offer a walk to the nearest thing so named instead. */
    seek?: string[];
    /** F6: the words named a place with no offer of its own (a far building's room), so the walk to the place containing
     *  it was chosen; the named place (a host may offer its own walk on demand and resolve again). */
    inside?: string}
  | {kind: 'unknown'; reason: string; didYouMean: {id: string; label: string}[]; seek?: string[];
    /** Refusal code when it is not capability.unknown (place.unreachable: a named place exists but cannot be reached). */
    code?: string;
    /** place.unreachable: the named place (a host may offer a walk to it on demand and resolve again). gait.unavailable:
     *  the named place with no faster-gait offer (a host may offer that gait on demand: lane RT, run to a building's door). */
    place?: string;
    /** place.unreachable: the verb asked and every place the words name, best name first (a host may build that verb's
     *  offers for them on demand: read:<place> beyond the nearest reading places). */
    verb?: string; places?: string[]};

const STOP = new Set(['the', 'a', 'an', 'to', 'of', 'in', 'at', 'by', 'on', 'into', 'near', 'with', 'my', 'some', 'through', 'thru', 'around', 'across', 'over', 'back', 'please', 'little', 'bit', 'for', 'while', 'and', 'then', 'there']);
const VERBS: Record<string, string> = {go: 'walk', goto: 'walk', 'go-to': 'walk', 'walk-to': 'walk', visit: 'walk', 'go-inside': 'walk', 'go-into': 'walk', 'go-in': 'walk', enter: 'walk', 'step-inside': 'walk', 'step-into': 'walk', 'walk-into': 'walk', 'walk-inside': 'walk', move: 'walk', head: 'walk', travel: 'walk', 'come-back': 'walk', return: 'walk', 'go-back': 'walk', 'head-back': 'walk', 'walk-back': 'walk', running: 'run', sprint: 'run', sprinting: 'run', hurry: 'run', jogging: 'jog', 'go-over': 'walk',
  hangout: 'hang-out', 'hang-around': 'hang-out', linger: 'hang-out', 'go-near': 'go-near', approach: 'go-near', join: 'go-near',
  'sit-on': 'sit', 'sit-at': 'sit', 'sit-down': 'sit', 'take-a-seat': 'sit', 'have-a-seat': 'sit', 'take-seat': 'sit', 'be-seated': 'sit', seat: 'sit', relax: 'rest',
  stroll: 'stroll', 'take-a-walk': 'stroll', 'take-a-stroll': 'stroll', 'go-for-a-walk': 'stroll', 'go-for-a-stroll': 'stroll', 'walk-through': 'stroll', 'stroll-through': 'stroll', wander: 'stroll', ramble: 'stroll', meander: 'stroll', explore: 'stroll',
  // R2 stroll (longrun 2026-10-16): "walk around the Green field", "tour the field" are strolls, not a walk to its centre
  'walk-around': 'stroll', 'walk-about': 'stroll', 'walk-round': 'stroll', tour: 'stroll', 'take-a-tour': 'stroll',
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
  meadow: ['lawn', 'field', 'green', 'commons'], park: ['green', 'commons', 'lawn', 'field', 'meadow', 'gardens'], field: ['commons', 'lawn', 'green'], lawn: ['commons', 'green'], green: ['lawn', 'commons'], grass: ['lawn', 'commons', 'green'],
  square: ['plaza', 'quad', 'green', 'commons'], plaza: ['square'], centre: ['commons'], center: ['commons'], middle: ['commons'],
  market: ['kiosks', 'market'], shops: ['kiosks', 'market'], shop: ['kiosks', 'market'], stalls: ['kiosks'],
  stage: ['deck', 'bandstand'], gazebo: ['bandstand', 'pavilion'], bandstand: ['gazebo'], garden: ['gardens'], gardens: ['garden'],
  dinner: ['dining'], food: ['dining', 'kitchen'], eat: ['dining', 'kitchen'], cafe: ['tea', 'café'], tea: ['café'], playground: ['playground'],
};
/** VOCAB-MECH: everyday words for god things' actuator actions (only used when such an action is offered). */
const ACT_ALIASES: Record<string, string> = {'turn-on': 'switch-on', 'turn-off': 'switch-off', shut: 'close', 'shut-off': 'switch-off', extinguish: 'put-out', 'blow-out': 'put-out', ignite: 'light', kindle: 'light', 'light-up': 'light', 'fill-up': 'fill', drain: 'empty'};
export const tokens = (s: string) => s.toLowerCase().replace(/\[[^\]]*\]/g, ' ').split(/[^a-z0-9]+/).filter(t => t && !STOP.has(t));
const norm = (s: string) => tokens(s).join(' ');
// A word names a token when equal, or one is the other with a short ending (garden/gardens, librar-/library); CN5: never a
// different word that merely starts with it ("watermill" is not "water").
export const tokenHit = (q: string, set: string[]) => set.some(t => t === q || (q.length >= 4 && t.length >= 4 && Math.abs(q.length - t.length) <= 3 && (t.startsWith(q) || q.startsWith(t))));
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
  // R5 group life: storytelling, a book club, cooking together, dancing on the bandstand, a yoga class, giving a concert
  [/\b(?:tell|telling|share|sharing) (?:a |some |the )?(?:stor(?:y|ies)|tales?)\b|\bstory ?tell\w*/, 'tell-story'],
  [/\b(?:listen to|hear|join) (?:a |the |some )?(?:stor(?:y|ies)|storyteller|story ?(?:circle|time))\b|\bstory ?(?:circle|time)\b/, 'hear-story'],
  [/\bbook ?club\b|\bread(?:ing)? (?:together|with (?:others|friends|the group))\b/, 'book-club'],
  [/\bcook(?:ing)? (?:together|with (?:others|friends|everyone|the group))\b|\b(?:communal|group) cooking\b|\bcooking (?:class|club)\b/, 'cook-together'],
  [/\bbandstand\b.*\bdanc\w*|\bdanc\w*\b.*\bbandstand\b|\b(?:barn|social|square|line|ballroom) danc\w*|\bdance (?:party|together)\b/, 'social-dance'],
  [/\byoga (?:class|session|together|group)\b|\b(?:lead|teach|join|take) (?:a |the )?yoga\b/, 'yoga-class'],
  [/\b(?:give|play|perform|put on|hold) (?:a |the )?(?:concert|gig)\b|\bjam session\b|\bperform (?:on|at) (?:the )?stage\b/, 'play-music'],
  [/\b(?:sing|singing|karaoke|open mic|microphone)\b/, 'sing'],
  [/\b(?:listen|listening|concert|audience|watch (?:the )?(?:show|band|performance|concert|musicians?))\b/, 'listen'],
  [/\b(?:drums?|drum kit|guitar|bass|violin|viola|cello|keyboard|keys)\b/, 'play-music', 'keep'],
  [/\bjumping[- ]?jacks?\b|\bstar[- ]?jumps?\b/, 'jumping-jacks'], [/\bpush[- ]?ups?\b|\bpress[- ]?ups?\b/, 'pushups'], [/\bsit[- ]?ups?\b|\bcrunches\b/, 'situps'],
  [/\bfeed(?:ing)? (?:the |some |a few )?(?:koi|fish|carp)\b|\b(?:throw|toss|scatter) (?:some |the )?(?:bread|crumbs|food) (?:to|for|into|in) (?:the )?(?:koi|fish|pond)\b|\bfeed (?:the )?pond\b/, 'feed'],
  [/\b(?:fishing|angling)\b|\b(?:go|to|let'?s) fish\b|^fish\b|\bcast (?:a |my |the )?(?:line|rod)\b|\bcatch (?:a |some )?fish\b/, 'fish'],
  // leisure: the playground, the hammocks, a picnic blanket, the night sky ("swing by" is a visit, not a swing; a picnic table is for eating)
  [/\bsee[- ]?saw\b|\bteeter[- ]?totter\b/, 'seesaw'], [/\b(?:swing|swings|swinging)\b(?!\s+by\b)/, 'swing'], [/\bhammocks?\b/, 'hammock'],
  [/\bpicnic(?:king)?\b(?!\s+tables?\b)/, 'picnic'],
  [/\bstar[- ]?gaz\w*|\b(?:watch|look at|see|count) (?:the )?(?:stars|night sky)\b/, 'stargaze'],
  [/^(?:please\s+)?garden\b|\b(?:gardening|weed(?:ing)?|(?:tend|tending|water|watering|plant|planting) (?:the |some |my )?(?:garden )?(?:beds?|seeds?|flowers?|vegetables?|plots?|plants?|crops?))\b/, 'garden'],
  [/\byoga\b/, 'yoga'], [/\bstretch(?:es|ing)?\b/, 'stretch'], [/\bdanc(?:e|es|ing)\b|\bboogie\b/, 'dance'], [/\bjump(?:s|ing)?\b|\bhop\b/, 'jump'],
  [/\b(?:read|reading|reads)\b/, 'read'], [/\b(?:write|writing)\b/, 'write'],
  [/\bpiano\b/, 'play-piano'], [/\b(?:paint|painting|easel)\b/, 'paint'], [/\b(?:cook|cooking|bake|baking)\b/, 'cook'],
  [/\b(?:music|instrument|sing|singing)\b/, 'play-music'], [/\b(?:craft|crafts|carve|carving|woodwork|pottery|weave|weaving|whittle)\b/, 'craft'],
  [/\b(?:game|games|cards|board game|play a game)\b/, 'play-game'],
  [/\b(?:eat|eating|meal|lunch|dinner|breakfast|snack)\b/, 'eat'], [/\b(?:drink|coffee|tea)\b/, 'drink'],
  [/\b(?:nap|snooze|doze|sleep|sleeping|siesta|rest my eyes)\b/, 'nap'], [/\b(?:lie|lay|lying|laying)\b/, 'lie'],
  [/\bsit\b.*\b(?:ground|grass|floor|lawn|sand)\b/, 'sit-ground'], [/\b(?:sit|seat|seated)\b/, 'sit'],
  [/\b(?:stroll|wander|ramble|meander|explore|tour|take a walk|go for a walk|walk (?:around|through|about))\b/, 'stroll'],
  [/\b(?:stand up|get up|stand)\b/, 'stand'], [/\b(?:swim|dip|bathe)\b/, 'swim'], [/\b(?:warm up|warm)\b/, 'warm-by-fire'],
  [/\b(?:go|walk|head|come|return|visit|travel)\b/, 'walk'],
];
/** RESOLVE: "find X", "look for X", "search for X" (X is then walked to; see resolveWords). */
const FIND = /^(?:please\s+)?(?:(?:can|could|would) you\s+)?(?:(?:go|come|try to|try and)\s+)?(?:find|look for|look around for|search for|hunt for|seek out|locate)\s+(?:me\s+)?(.+?)[.!?]*$/i;
/** Words that only carry the intent, never the target ("find somewhere quiet to read a book" names no place). */
const FILLER = new Set(['find', 'somewhere', 'someplace', 'place', 'spot', 'quiet', 'nice', 'good', 'cozy', 'cosy', 'comfy', 'book', 'books', 'novel', 'down', 'up', 'read', 'reading',
  'nap', 'snooze', 'doze', 'sleep', 'sleeping', 'siesta', 'lie', 'lay', 'lying', 'laying', 'sit', 'seat', 'seated', 'piano', 'play', 'paint', 'painting', 'easel', 'cook', 'cooking', 'bake',
  'music', 'instrument', 'craft', 'crafts', 'game', 'games', 'cards', 'eat', 'meal', 'lunch', 'dinner', 'breakfast', 'snack', 'drink', 'coffee', 'tea', 'post', 'send', 'mail',
  'letter', 'card', 'write', 'writing', 'stroll', 'wander', 'walk', 'tour', 'explore', 'go', 'take', 'have', 'let', 'lets', 'me', 'i', 'want', 'like', 'would', 'could', 'can', 'you', 'we', 'he', 'she', 'they',
  'him', 'her', 'them', 'just', 'now', 'something', 'thing', 'do', 'get', 'grab', 'head', 'come', 'return', 'visit', 'travel', 'around', 'about', 'quick', 'short', 'long', 'while',
  'use', 'using', 'check', 'work', 'join', 'game', 'round', 'throw', 'toss', 'catch', 'sing', 'song', 'songs', 'listen', 'watch', 'show', 'set', 'reps', 'exercise', 'exercises', 'workout', 'concert', 'performance', 'audience', 'band']);

/** "go for a X", "take a X", "have a X": X decides the verb (a swim is a swim, a balloon ride is the ride, never a stroll). */
const GO_FOR = /^(?:let'?s\s+|i\s+want\s+to\s+|please\s+)?(?:go|going|take|have|do|try)\s+(?:for\s+|on\s+|in\s+)?(?:a|an|some|the)\s+(.+)$/i;
const GO_FOR_X: [RegExp, string][] = [[/^(?:sit[- ]?ups?|crunches)\b/, 'situps'], [/^(?:push[- ]?ups?|press[- ]?ups?)\b/, 'pushups'], [/^(?:jumping[- ]?jacks?|star[- ]?jumps?)\b/, 'jumping-jacks'], [/^yoga\b/, 'yoga'], [/^(?:swim|dip|bathe|paddle)\b/, 'swim'], [/^(?:walk|stroll|wander|ramble|tour|wee walk|little walk|short walk|long walk)\b/, 'stroll'], [/^(?:nap|snooze|doze|sleep|siesta|lie[- ]down)\b/, 'nap'],
  [/^(?:seat|sit)\b/, 'sit'], [/^(?:dance|boogie)\b/, 'dance'], [/^(?:stretch)\b/, 'stretch'], [/^(?:read|book)\b/, 'read'], [/^(?:look|wander around)\b/, 'stroll'], [/^(?:rest|break|breather)\b/, 'rest'], [/^(?:drink|coffee|tea|cuppa)\b/, 'drink'], [/^(?:meal|bite|snack|lunch|dinner|breakfast)\b/, 'eat']];
/** R5 group activities whose phrase decides even after a plain verb ("dance on the bandstand" is the bandstand dance). */
const GROUP_VERBS = new Set(['tell-story', 'hear-story', 'book-club', 'cook-together', 'social-dance', 'yoga-class']);
/** leisure: a posture or play word followed by a playground or lawn thing (the thing decides what is done there). */
const LEISURE_LEAD = /^(?:please\s+)?(?:sit|lie|lay|rest|relax|nap|snooze|doze|play|ride|get|hop|go|have a go)\b/i;
const LEISURE_OBJECTS: [RegExp, string][] = [[/\bhammocks?\b/, 'hammock'], [/\bsee[- ]?saw\b|\bteeter[- ]?totter\b/, 'seesaw'], [/\bswings?\b(?!\s+by\b)/, 'swing'], [/\bpicnic (?:blanket|rug)\b/, 'picnic']];
/** Rides: the balloon (and any later carrier) is an object you join. */
export const RIDE_WORDS = /\b(?:ride|rides|balloon|fly|flight|flying|go up|up in the air|hot[- ]air|row|rowing|punt|boat|boating)\b/i;
/** Things bodies cannot do yet: refused honestly (never resolved to something else). */
export const NOT_YET: [RegExp, string, string[], string?][] = [
  [/\b(?:kiss|kisses|kissing|snog)\b/i, 'Kissing is not a gesture here; hug, shake hands, high-five, bow or wave instead (hugs and handshakes ask the other Soul first).', ['hug', 'handshake', 'high-five', 'wave']],
  [/\b(?:climb|jump over|vault|cartwheel|somersault|backflip)\b/i, 'Climbing and acrobatics are not possible yet.', ['jump', 'stretch', 'dance']],
  // CN5 (acceptance: "go fishing" walked to the playground): things nobody can do here yet are refused, never swapped. The
  // optional fourth item is the verb that, when the world offers it, makes the activity real (then it is not refused).
  [/\b(?:fishing|go fish|to fish|catch (?:a |some )?fish)\b/i, 'There is nowhere to fish from here right now: fishing is offered only at a marked pond bank.', ['swim', 'stroll', 'sit'], 'fish'],
  [/\b(?:sailing|canoeing|kayaking)\b/i, 'Sailing, canoes and kayaks are not possible yet; an offered punt can be rowed.', ['swim', 'stroll', 'sit']],
  [/\b(?:swinging|on the swings?|go on (?:a |the )?swing)\b/i, 'There is no swing offered here right now.', ['stroll', 'sit', 'dance'], 'swing'],
  [/\bsee[- ]?saw\b|\bteeter[- ]?totter\b/i, 'There is no see-saw offered here right now.', ['stroll', 'sit'], 'seesaw'],
  [/\bhammocks?\b/i, 'There is no hammock offered here right now.', ['lie', 'nap', 'sit'], 'hammock'],
  [/\b(?:ferris wheel|big wheel|carousel|merry[- ]go[- ]round)\b/i, 'The Ferris wheel and the carousel at the seaside resort are scenery for now: the resort cannot be walked to yet, so they cannot be ridden. Nothing else was chosen.', ['swing', 'seesaw', 'stroll'], 'ride-attraction'],
  [/\b(?:have|having|go for|go on|for) (?:a |some )?picnic\b|^picnic\b|\bpicnicking\b/i, 'There is no picnic blanket laid out here right now; eat at a table or sit on the grass instead.', ['eat', 'sit-ground', 'sit'], 'picnic'],
  [/\bstar[- ]?gaz\w*|\b(?:watch|look at|count) (?:the )?stars\b/i, 'Stargazing needs open grass and a world with nights.', ['lie', 'sit-ground'], 'stargaze'],
  [/\bfeed(?:ing)? (?:the |some )?(?:ducks?|geese|goose|swans?|birds?|pigeons?|gulls?)\b/i, 'There are no ducks or birds to feed here; the ponds have koi, which can be fed from a marked bank.', ['feed', 'stroll', 'sit'], 'feed-birds'],
  [/\b(?:feed(?:ing)? (?:the |some )?(?:fish|koi|carp))\b/i, 'There is nowhere to feed the koi from here right now: it is offered at a marked pond bank.', ['stroll', 'sit'], 'feed'],
  [/\b(?:skateboard\w*|cycling|ride (?:a |my |the )?(?:bike|bicycle))\b/i, 'That is not possible here yet.', ['stroll', 'sit', 'dance'], 'cycle'],
];
/** Quality cases 22/29/30: a NOT_YET refusal is terminal. Agents walked off to look for swings or ducks after it. */
export const NOWHERE = ' Nothing like it exists anywhere in this world, so walking somewhere else to look for it will not help: tell your owner plainly it is not possible here (the suggestions are other things to do).';
/** CN5: "go <doing>" names an activity, not a place: these mean something here; any other is refused (never a walk). */
const GO_ING: Record<string, string> = {swimming: 'swim', walking: 'stroll', fishing: 'fish', gardening: 'garden', weeding: 'garden', swinging: 'swing', stargazing: 'stargaze', picnicking: 'picnic', strolling: 'stroll', hiking: 'stroll', exploring: 'stroll', wandering: 'stroll', rambling: 'stroll', sightseeing: 'stroll',
  dancing: 'dance', reading: 'read', painting: 'paint', napping: 'nap', sitting: 'sit', exercising: 'stretch', stretching: 'stretch', singing: 'sing', shopping: 'walk market'};

/** Split "verb:target" (or free text such as "hang out at the deck") into a canonical verb and the target words. */
export function parseCapability(input: string, verbs: Set<string>): {verb: string; rest: string} {
  const raw = input.trim(), i = raw.indexOf(':');
  const canon = (v: string) => {const k = v.toLowerCase().trim().replace(/[\s_]+/g, '-'); return verbs.has(k) ? k : VERBS[k] ?? k;};
  if (i >= 0) return {verb: canon(raw.slice(0, i)), rest: raw.slice(i + 1)};
  const gf = GO_FOR.exec(raw);
  if (gf) {const x = gf[1].toLowerCase().trim(); for (const [re, v] of GO_FOR_X) if (re.test(x)) {if (verbs.has(v) || v === 'stroll') return {verb: v, rest: x.replace(re, ' ').trim()}; break;}}
  const words = raw.split(/\s+/);
  // leisure: "sit on the swing", "lie in the hammock", "play on the see-saw": the named thing decides, not the posture word
  // R5: "dance on the bandstand", "yoga class", "read with friends": the group phrase wins over its leading verb
  {const low = raw.toLowerCase(); for (const [re, v] of INTENTS) if (GROUP_VERBS.has(v) && verbs.has(v) && re.test(low)) return {verb: v, rest: low.replace(re, ' ').split(/[^a-z0-9.-]+/).filter(w => w && !FILLER.has(w) && !STOP.has(w)).join(' ')};}
  if (LEISURE_LEAD.test(raw)) for (const [re, v] of LEISURE_OBJECTS) if (verbs.has(v) && re.test(raw.toLowerCase())) return {verb: v, rest: raw.toLowerCase().replace(re, ' ').replace(LEISURE_LEAD, ' ').split(/[^a-z0-9.-]+/).filter(w => w && !FILLER.has(w) && !STOP.has(w)).join(' ')};
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
const PLACE_VERBS = new Set(['walk', 'jog', 'run', 'jog-around', 'run-around', 'cycle', 'cycle-around', 'hang-out', 'gather', 'stroll', 'read']);
/** Place verbs done at a spot in the place (a reading spot), not on its ground: the best-named place first. */
const SPOT_PLACE_VERBS = new Set(['read']);
const GAIT_VERBS = new Set(['jog', 'run', 'jog-around', 'run-around', 'cycle', 'cycle-around']);

export function resolveCapability(input: string, ctx: VocabContext): VocabResult {
  const r = resolveWords(input, ctx);
  // R2 stroll (longrun 2026-10-16: nobody moved for 70 minutes): a stroll named for the place the Soul is already in, whose
  // own loop is closed right now (a construction site covers one of its stops), is a wander right where it stands; never a
  // refusal that leaves it standing. An exact id, a different place and a via chain keep their own answer.
  if (r.kind !== 'alias' || r.params || r.cap.available || r.cap.verb !== 'stroll' || r.cap.target?.kind !== 'place' || !ctx.here?.includes(r.cap.target.id)) return r;
  const wander = ctx.caps.find(c => c.id === 'wander:here' && c.available); if (!wander) return r;
  const name = ctx.places.find(p => p.id === r.cap.target!.id)?.name ?? r.cap.target.id;
  return {kind: 'alias', cap: wander, note: `${input}: you are in ${name} already and its loop (${r.cap.id}) is closed right now (${(r.cap.blocked?.reason ?? 'unavailable').replace(/[.\s]+$/, '')}); wandering around where you are instead (${wander.id}).`};
}
// VEHICLE-STEER (Gene 2026-10-23, #12): a seated rider's words to its ride. Only when a steer is offered to this Soul now
// (it is aboard); otherwise the words fall through ("fly the balloon" from the ground is still the join).
const STEER_DIRS = 'north|northeast|north-east|east|southeast|south-east|south|southwest|south-west|west|northwest|north-west|n|ne|e|se|s|sw|w|nw';
const STEER_VEHICLE = String.raw`(?:(?:the|our|this|my)\s+)?(?:hot[- ]air\s+|red\s+|rowing\s+)?(?:balloon|punt|boat|basket|ride|it|us)`;
const STEER_GO = String.raw`(?:fly|flying|steer|drive|sail|float|row|rowing|pilot|navigate|head|take|move|go|bring)`;
function steerWords(input: string, ctx: VocabContext): VocabResult | null {
  const caps = ctx.caps.filter(c => c.verb === 'object' && c.action === 'steer' && c.available); if (!caps.length) return null;
  const t = input.toLowerCase().replace(/^(?:please\s+|let'?s\s+|now\s+|ok(?:ay)?,?\s+)+/, '').replace(/[.!?\s]+$/, '').trim(); if (!t || t.includes(':')) return null;
  const water = /\b(?:row|rowing|punt|boat|ashore|bank)\b/.test(t), air = /\b(?:fly|flying|balloon|basket|hover)\b/.test(t);
  const cap = caps.find(c => water ? /punt|boat|rowing/i.test(c.id) : air ? /balloon/i.test(c.id) : true) ?? caps[0];
  const say = (params: Record<string, unknown>, what: string): VocabResult => ({kind: 'alias', cap, params, note: `${input} is ${cap.id} (${what}).`});
  if (new RegExp(String.raw`^(?:land|touch\s+down|set\s+(?:${STEER_VEHICLE}\s+)?down|bring\s+${STEER_VEHICLE}\s+down|go\s+down|descend|come\s+down|row\s+(?:${STEER_VEHICLE}\s+)?(?:back|ashore|home)|go\s+back\s+to\s+(?:the\s+|its\s+)?(?:bank|shore))(?:\s+${STEER_VEHICLE})?(?:\s+(?:here|now|please))?$`).test(t)) return say({land: true}, 'land');
  if (new RegExp(String.raw`^(?:(?:stop|halt|hold)\s+${STEER_VEHICLE}(?:\s+(?:here|still|there))?|(?:stop|hold)\s+(?:here|still)|hover(?:\s+here)?|hold\s+position)$`).test(t)) return say({stop: true}, 'stop and hold');
  const dir = new RegExp(String.raw`^${STEER_GO}(?:\s+${STEER_VEHICLE})?\s+(?:(\d+)\s*(?:m|metres|meters)\s+)?(${STEER_DIRS})(?:wards?)?(?:\s+(?:for\s+)?(\d+)\s*(?:m|metres|meters))?(\s*(?:,\s*)?(?:and|then|,)\s+land(?:\s+there)?)?$`).exec(t);
  if (dir) return say({direction: dir[2].replace('-', ''), distance: Math.min(1000, Math.max(5, Number(dir[1] ?? dir[3] ?? 100))), ...(dir[4] ? {land: true} : {})}, `steer ${dir[2]}`);
  const to = new RegExp(String.raw`^${STEER_GO}(?:\s+${STEER_VEHICLE})?\s+(?:over\s+)?(?:to(?:wards?)?|toward|over)\s+(.+?)(\s*(?:,\s*)?(?:and|then|,)\s+(?:then\s+)?land(?:\s+(?:there|it))?)?$`).exec(t);
  // "go to X" / "take me to X" without a vehicle word stays a walk (refused aloft with its own reason)
  if (to && (/^(?:fly|flying|steer|drive|sail|float|row|rowing|pilot|navigate)\b/.test(t) || new RegExp(String.raw`^\w+\s+${STEER_VEHICLE}\b`).test(t))) {
    const place = to[1].replace(/^(?:the\s+)/, '').trim(); if (place) return say({to: place, ...(to[2] ? {land: true} : {})}, `steer toward ${place}${to[2] ? ', land there' : ''}`);
  }
  return null;
}
function resolveWords(input: string, ctx: VocabContext): VocabResult {
  const exact = ctx.caps.find(c => c.id === input); if (exact) return {kind: 'exact', cap: exact};
  const steered = steerWords(input, ctx); if (steered) return steered;
  // CN5 (acceptance): "A, then B" is two things. Walks and strolls chain (the earlier ones become `via` legs of the last);
  // anything else does the first and says to act again for the rest (never a mix-up of the two).
  // r3 quality case 35: "pick up a book and give it to X" is two steps too (the give is offered only once holding it).
  const clauses = input.includes(':') ? [input] : input.split(/\s*(?:,|;)?\s+(?:and\s+)?then\s+|\s*;\s*|\s*,\s*and\s+then\s+|\s*,?\s+and\s+(?=(?:give|hand|pass|offer|bring)\s)/i).map(x => x.trim()).filter(Boolean);
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
  // RESOLVE (SOULSIM-E "find a boat": no "find" capability): find / look for / search for X is a walk to the nearest X you
  // can reach, unless the words name an activity offered here ("find somewhere quiet to read", "find a seat" keep theirs)
  const find = colon < 0 ? FIND.exec(text.trim()) : null;
  if (find) {
    const x = find[1].trim(), offered = new Set(ctx.caps.map(c => c.verb));
    if (x && !INTENTS.some(([re, v]) => v !== 'walk' && v !== 'stroll' && offered.has(v) && re.test(x))) {
      const r = resolveCapability(`walk to ${x}`, ctx);
      if (r.kind === 'exact') return {kind: 'alias', cap: r.cap, note: `${input} is ${r.cap.id} (${r.cap.label}).`};
      if (r.kind === 'alias') return {...r, note: `${input}: ${r.note}`};
      return r.code ? r : {...r, reason: `Nothing called "${x.replace(/^(?:a|an|the|some)\s+/, '')}" is anywhere you can walk to from here; nothing else was chosen in its place.`};
    }
  }
  // Gaits are distinct offers: never quietly turn a run into walking. A recreational jog is a loop.
  const motion = /\b(jog(?:ging)?|run(?:ning)?|sprint(?:ing)?|hurry)\b/.exec(text);
  if (motion) {
    const gait = /^jog/.test(motion[1]) ? 'jog' : 'run';
    const loop = /\b(?:around|round|loop)\b/.test(text) || /\b(?:go for|take|have) (?:a |an )?(?:jog|run)\b/.test(text);
    if (head !== gait && head !== gait + '-around') {
      const target = text.replace(motion[0], ' ').replace(/^(?:let'?s\s+|i want to\s+|please\s+)?(?:go|take|have|do)?\s*(?:for\s+)?/, '').replace(/\b(?:around|round|loop|to|a|an|the|please|go|for)\b/g, ' ').replace(/[:.!]/g, ' ').trim().replace(/\s+/g, ' ');
      const r = resolveCapability(`${gait}${loop ? '-around' : ''}:${target || 'here'}`, ctx);
      return r.kind === 'unknown' ? r : {kind: 'alias', cap: r.cap, note: `${input} is ${r.cap.id} (${r.cap.label}).`};
    }
  }
  // todo (leisure): a bicycle from a dock: "ride a bike to the harbour", "go cycling", "go for a bike ride around the park"
  const bike = colon < 0 ? /\b(?:cycl(?:e|es|ing)|bik(?:e|es|ing)|bicycl(?:e|es|ing)|bike ride)\b/.exec(text) : null;
  if (bike && !/\b(?:skateboard\w*|motor ?bike|motorcycle|exercise bike)\b/.test(text)) {
    const offered = ctx.caps.filter(c => c.verb === 'cycle' || c.verb === 'cycle-around');
    if (!offered.length) return {kind: 'unknown', code: 'bike.no-dock', reason: elsewhereReason('cycle', ctx, 'No bicycle is offered here: a ride starts from a bicycle dock within 120 m; nothing else was chosen.', 'There are no bicycles anywhere in this world; nothing else was chosen.'), didYouMean: []};
    const loop = /\b(?:around|round|loop)\b/.test(text);
    const target = text.replace(/\b(?:let'?s|i want to|please|go|going|take|have|do|for|a|an|the|my|ride|riding|on|cycle|cycles|cycling|bike|bikes|biking|bicycle|bicycles|bicycling|around|round|loop|to|and|back|from|dock|rack)\b/g, ' ').replace(/[:.!,]/g, ' ').trim().replace(/\s+/g, ' ');
    if (!target) {
      const near = offered.filter(c => c.verb === 'cycle-around' && c.available).sort((a, b) => dist(ctx.target(a).at, ctx.me) - dist(ctx.target(b).at, ctx.me) || a.id.localeCompare(b.id))[0] ?? offered.find(c => c.verb === 'cycle-around');
      if (near) return {kind: 'alias', cap: near, note: `${input} is ${near.id} (${near.label}).`};
    }
    const r = resolveCapability(`${loop || !target ? 'cycle-around' : 'cycle'}:${target || 'here'}`, ctx);
    return r.kind === 'unknown' ? r : {kind: 'alias', cap: r.cap, note: `${input} is ${r.cap.id} (${r.cap.label}).`};
  }
  // RIDE-EXIT (A, Gene's review): "get inside the hot air balloon", "board the punt", "climb into the boat" are the join too.
  const boardWords = /\b(?:board|boarding|embark|(?:get|getting|climb|climbing|hop|step|jump)\s+(?:in|into|inside|aboard|onto|on\s+board))\b/.test(text);
  const rideIntent = boardWords || /\b(?:row|rowing|boating|ride|rides|fly|flight|flying|leave|disembark|alight|start|depart)\b/.test(text) || /^(?:punt|boat|balloon)(?::|$)/.test(text);
  // Rowing always means a punt, and an explicit balloon always means a balloon.
  if ((colon < 0 || ['ride', 'fly', 'balloon', 'row', 'punt', 'boat'].includes(head)) && rideIntent && RIDE_WORDS.test(text) && !/\b(?:bike|bicycle|horse|see[- ]?saw|teeter[- ]?totter|swings?|ferris|big wheel|carousel|merry[- ]go[- ]round)\b/.test(text)) {
    const water = /\b(?:row|rowing|punt|boat|boating)\b/.test(text), air = /\b(?:balloon|fly|flight|flying|hot[- ]air)\b/.test(text);
    const action = /\b(?:leave|disembark|alight)\b/.test(text) ? 'leave' : /\b(?:start|depart)\b/.test(text) ? 'start' : 'join';
    // the vehicle is told by the ride's id (ride-eden-punt, ride-eden-balloon), never by the join label, which reads the same
    // for every ride ("…punt receipt includes disembarkation"): "row a boat" took Eden 2026's balloon (quality case 22)
    const rides = ctx.caps.filter(c => c.verb === 'object' && c.action === action && (water ? /punt|rowing|boat|canoe|kayak/i.test(c.id) && !/balloon/i.test(c.id) : air ? /balloon/i.test(c.id) : /ride|balloon|carrier|punt/i.test(c.id + ' ' + c.label)));
    const target = text.replace(/\b(?:let|lets|s|go|for|take|have|a|an|the|ride|rides|row|rowing|boat|boating|punt|balloon|fly|flight|flying|in|on|at|around|start|leave|disembark|depart|out|of|to|loop|together|board|boarding|embark|get|getting|climb|climbing|hop|step|jump|into|inside|aboard|onto|hot|air)\b/g, ' ').replace(/[:.!]/g, ' ').trim();
    const words = tokens(target), named = words.length ? rides.filter(c => {const t = ctx.target(c); return words.every(w => tokenHit(w, tokens([c.id, c.label, ...t.names, ...t.around].join(' '))));}) : rides;
    const pick = named.sort((a, b) => Number(b.available) - Number(a.available) || dist(ctx.target(a).at, ctx.me) - dist(ctx.target(b).at, ctx.me) || a.id.localeCompare(b.id))[0];
    if (pick) return {kind: 'alias', cap: pick, note: `${input} is ${pick.id} (${pick.label}).`};
    // E-life (Eden 2026 quality case 22): with no punt anywhere in this world the refusal is terminal (the agent walked off to look)
    const punts = water ? ctx.elsewhere?.('punt') : undefined;
    return {kind: 'unknown', code: water ? 'ride.no-water-route' : 'ride.unavailable', reason: water ? (punts === null ? 'There is no rowing boat or punt to row in this world.' + NOWHERE : 'No rowing punt is offered on that water. It needs water large enough for a safe loop and a reachable bank; nothing else was chosen.') : 'No matching ride is offered here; nothing else was chosen.', didYouMean: []};
  }
  // CN5: "go fishing", "go swimming": the doing word decides; an unknown one is refused, never taken as a place
  const going = colon < 0 ? /^(?:let'?s\s+|i\s+want\s+to\s+)?(?:go|going|went)\s+([a-z]+ing)\b(.*)$/.exec(text) : null;
  // E-life: two refusals give way to what a god world really offers: ducks to feed (a feed bank by ducks or swans) and a
  // ride on the ferris wheel or carousel (their ride objects); old worlds keep them
  const offeredVerbs = new Set(ctx.caps.map(c => c.verb));
  if (ctx.caps.some(c => c.verb === 'feed' && /\b(?:ducks?|swans?|geese|birds?)\b/i.test(c.label))) offeredVerbs.add('feed-birds');
  if (ctx.caps.some(c => c.verb === 'object' && /ferris|carousel/i.test(c.id))) offeredVerbs.add('ride-attraction');
  const notYet = NOT_YET.filter(([, , , v]) => !v || !offeredVerbs.has(v));
  if (going && !notYet.some(([re]) => re.test(text))) {
    const [verb, ...more] = (GO_ING[going[1]] ?? '').split(' ');
    if (!verb) return {kind: 'unknown', reason: `"${going[1]}" is not something bodies can do here yet; nothing else was chosen in its place.${NOWHERE}`, didYouMean: suggest(input, 'stroll', '', ctx, ctx.caps.filter(c => c.id.endsWith(':here') && c.available).slice(0, 5))};
    const sub = resolveCapability(`${verb} ${[...more, going[2].trim()].join(' ')}`.trim(), ctx);
    return sub.kind === 'unknown' || sub.cap.verb === verb || (verb === 'stroll' && sub.cap.verb === 'wander') ? sub : {kind: 'unknown', reason: `Nothing to ${verb} is offered here right now; nothing else was chosen in its place.`, didYouMean: suggest(input, verb, '', ctx)};
  }
  // Unsupported motions are refused honestly, with the nearest real things to do.
  // Quality 22/29/30: a refusal for something that exists nowhere is terminal (NOWHERE); one whose verb a world can
  // offer (fish, swing, picnic…) may exist elsewhere, so it keeps todo's place-specific wording.
  if (colon < 0 || !ctx.caps.some(c => c.verb === head)) for (const [re, reason, prefer, offer] of notYet) if (re.test(colon < 0 ? text : head)) return {kind: 'unknown', reason: offer && offer !== 'feed-birds' ? elsewhereReason(offer, ctx, offer === 'ride-attraction' && ctx.elsewhere?.(offer) ? 'No Ferris wheel or carousel ride is offered from here.' : reason) : reason + NOWHERE, didYouMean: suggest(input, prefer[0], '', ctx, ctx.caps.filter(c => prefer.includes(c.verb) && c.available).slice(0, 5))};
  const verbs = new Set(ctx.caps.map(c => c.verb));
  // VOCAB-MECH: a god-built thing's actuator actions (object caps on `e_…` entities) answer to their own names as verbs:
  // "open the blue door", "put out the fire", "switch off the lamp" (+ everyday aliases). Other objects are unchanged.
  const acts = ctx.caps.filter(c => c.verb === 'object' && c.action && /^e_/.test(c.object ?? ''));
  for (const c of acts) verbs.add(c.action!);
  for (const [k, v] of Object.entries(ACT_ALIASES)) if (verbs.has(v) && !verbs.has(k)) verbs.add(k);
  let {verb, rest} = parseCapability(input, verbs);
  if (ACT_ALIASES[verb] && !ctx.caps.some(c => c.verb === verb)) verb = ACT_ALIASES[verb];
  // A real fire is a qualifier of the existing fire request, not a new seat name.
  // Keep explicit/named IDs intact and require an offered actual fire before dropping it.
  const realFire = colon < 0 && ['sit', 'warm-by-fire'].includes(verb) ? /^(?:by|near|beside)\s+(?:a|the)\s+real\s+(fire|campfire)[.!]?$/i.exec(rest) : null;
  if (realFire && ctx.caps.some(c => c.verb === 'warm-by-fire' && c.target?.kind === 'object')) rest = 'fire';
  // "stroll" with nothing named is a stroll right here.
  if (verb === 'stroll' && !tokens(rest).length && !ctx.caps.some(c => c.id === 'stroll:here')) {const w = ctx.caps.find(c => c.id === 'wander:here'); if (w) return {kind: 'alias', cap: w, note: `${input} is ${w.id}.`};}
  if (verb === 'stroll' && !verbs.has('stroll') && verbs.has('wander')) verb = 'wander';
  // Resolve a named gait destination before looking through capability labels.
  // A park mentioning a pond, or a Library annex, must never replace a named
  // place that has no faster-gait offer of its own.
  if (GAIT_VERBS.has(verb)) {
    const words = tokens(rest), queries = [words, words.filter(t => !ctx.root.includes(t))];
    for (const query of queries) {
      const q = query.join(' '); if (!q) continue;
      const tiers = [
        ctx.places.filter(p => norm(p.id) === q),
        ctx.places.filter(p => norm(p.name) === q),
        ctx.places.filter(p => p.aliases?.some(alias => norm(alias) === q)),
      ];
      const named = tiers.find(matches => matches.length); if (!named) continue;
      if (named.length > 1) return {kind:'unknown',code:'place.ambiguous',reason:`Several places have that name; use an exact offered ${verb} capability. Nothing else was chosen.`,didYouMean:ctx.caps.filter(c => c.verb === verb && named.some(p => p.id === c.target?.id)).map(c => ({id:c.id,label:c.label}))};
      const place = named[0], offered = ctx.caps.filter(c => c.verb === verb && c.target?.id === place.id).sort((a,b) => Number(b.available)-Number(a.available) || a.id.localeCompare(b.id));
      if (offered[0]) return {kind:'alias',cap:offered[0],note:`${input} is ${offered[0].id} (${offered[0].label}).`};
      const bank = verb.endsWith('-around') && place.kind === 'water';
      return {kind:'unknown',code:bank?'gait.no-bank-loop':'gait.unavailable',reason:bank?`${place.name} has no full loop on reachable dry ground; nothing else was chosen.`:`No ${verb} capability is offered for ${place.name}; nothing else was chosen in its place.`,didYouMean:[],...(bank?{}:{place:place.id})};
    }
  }
  // A named pond means its bank loop, never an unrelated park that mentions ponds in its description.
  if (verb === 'jog-around' || verb === 'run-around') {
    const q = tokens(rest).filter(t => !ctx.root.includes(t)), water = ctx.places.filter(p => p.kind === 'water' && q.length && q.every(t => tokenHit(t, tokens(p.id + ' ' + p.name)) || (SYNONYMS[t] ?? []).some(s => tokenHit(s, tokens(p.id + ' ' + p.name)))));
    if (water.length && q.some(t => ['pond','lake','water','pool'].includes(t))) {
      const offered = ctx.caps.filter(c => c.verb === verb && water.some(p => p.id === c.target?.id)).sort((a,b) => dist(ctx.target(a).at,ctx.me)-dist(ctx.target(b).at,ctx.me));
      if (offered[0]) return {kind:'alias',cap:offered[0],note:`${input} is ${offered[0].id} (${offered[0].label}).`};
      return {kind:'unknown',code:'gait.no-bank-loop',reason:'That pond has no full loop on reachable dry ground; nothing else was chosen.',didYouMean:[]};
    }
  }
  const pool = ctx.caps.filter(c => c.verb === verb || (c.verb === 'object' && c.action === verb && /^e_/.test(c.object ?? '')));
  // RESOLVE: a world-engine label's ", by <neighbours> (16 m)" names the neighbours, not the thing ("go to the pond" was a tree
  // by the pond reeds): step 3 tries the names before it first (strict), then the whole label ("the bench by the pond")
  const info = new Map(pool.map(c => {const t = ctx.target(c), own = [c.target?.id ?? '', c.id.slice(c.id.indexOf(':') + 1), c.label, ...t.names].filter(Boolean);
    return [c.id, {t, own, ownTokens: own.flatMap(tokens), strictTokens: [own[0], own[1], c.label.replace(/,\s*by\s.*$/, ''), ...t.names].filter(Boolean).flatMap(tokens)}];}));
  const unknown = (reason: string, prefer: EdgeCapability[] = []) => ({kind: 'unknown' as const, reason, didYouMean: suggest(input, verb, rest, ctx, prefer)});
  const dme = (c: EdgeCapability) => dist(info.get(c.id)?.t.at ?? null, ctx.me);
  const placeOf = (c: EdgeCapability) => ctx.places.find(p => p.id === c.target?.id);
  // Several fit: the free ones; a place that contains the others (the park, not its gazebo); then the nearest.
  // RESOLVE (SOULSIM-E "go to the bakery" went into its storeroom, 5 m, not in at the shop front): the place a match stands in
  const placeIdOf = (c: EdgeCapability) => c.target?.kind === 'place' ? c.target.id : info.get(c.id)?.t.around[0];
  const one0 = (cs: EdgeCapability[], note: (c: EdgeCapability) => string): VocabResult | null => {
    if (!cs.length) return null;
    const live = cs.filter(c => c.available), list = live.length ? live : cs;
    if (list.length === 1) return {kind: 'alias', cap: list[0], note: note(list[0])};
    const outer = list.filter(c => {const p = placeOf(c); return !!p && list.every(o => o === c || isAncestor(ctx, p.id, o.target?.id));});
    if (outer.length === 1) return {kind: 'alias', cap: outer[0], note: note(outer[0]) + ` (it contains ${list.length - 1} more specific match${list.length > 2 ? 'es' : ''})`};
    const ranked = [...list].sort((a, b) => dme(a) - dme(b) || a.id.localeCompare(b.id));
    // ... the nearest match inside a building (or room) that matches too is that building: in at its front door, not the
    // back room or the bookcase nearest the Soul (the outermost such, up to the building)
    const n = ranked[0], np = placeIdOf(n);
    if (PLACE_VERBS.has(verb) && np) {
      const enclosing = list.filter(c => c !== n && c.target?.kind === 'place' && ['building', 'room'].includes(placeOf(c)?.kind ?? '') && (c.target.id === np ? n.target?.kind !== 'place' : isAncestor(ctx, c.target.id, np)));
      const outer = enclosing.find(c => placeOf(c)?.kind === 'building') ?? enclosing.find(c => !enclosing.some(o => o !== c && isAncestor(ctx, o.target!.id, c.target!.id)));
      if (outer) return {kind: 'alias', cap: outer, note: note(outer) + ` (the nearest match, ${n.id}, is in it; ${list.length} matched)`};
    }
    return {kind: 'alias', cap: n, note: note(n) + ` (the nearest of ${list.length}; also ${ranked.slice(1, 4).map(c => c.id).join(', ')})`};
  };
  const one = one0;
  // RESOLVE (Ada "go to the pond" went to twinkle lights "lights-pond-2", Wren "go to the market" to string lights by the
  // kiosks): of the walk targets whose names hold the words, those that are what the words say (", a pond") come first;
  // else the places, before the things named after the place they stand in
  const ownFirst = (cs: EdgeCapability[], words: string[]) => {
    if (cs.length < 2 || !PLACE_VERBS.has(verb)) return cs;
    const kindOf = (c: EdgeCapability) => /,\s+an?\s+([^,:(]+?)(?=\s*[,:(]|\s+(?:by|in|of)\s|$)/.exec(c.label)?.[1] ?? /^Go into (.+?) of /.exec(c.label)?.[1];
    const kinded = cs.filter(c => {const k = kindOf(c); return !!k && words.every(w => tokenHit(w, tokens(k)));});
    // ... with the building a matching room is in, when the building matches too (the cafe: in at its front door)
    if (kinded.length) return cs.filter(c => kinded.includes(c) || (c.target?.kind === 'place' && kinded.some(k => isAncestor(ctx, c.target!.id, k.target?.id))));
    const places = cs.filter(c => c.target?.kind === 'place');
    return places.length ? places : cs;
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
    // ROUTE-RECHECK ("go for a swim" in the park pond was "Say which"): a swim with no water named is in the water the Soul
    // is in, else the nearest it can swim in
    if (!q.length && verb === 'swim') {
      const near = pool.filter(c => c.available).sort((a, b) => Number(!ctx.here?.includes(a.target?.id ?? '')) - Number(!ctx.here?.includes(b.target?.id ?? '')) || dme(a) - dme(b) || a.id.localeCompare(b.id));
      if (near.length) return {kind: 'alias', cap: near[0], note: `${input} is ${ctx.here?.includes(near[0].target?.id ?? '') ? 'the water you are in' : 'the nearest water'}, ${near[0].id} (${near[0].label}).`};
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
      const strict = pool.filter(c => words.every(w => tokenHit(w, info.get(c.id)!.strictTokens)));
      const named3 = strict.length ? strict : pool.filter(c => words.every(w => tokenHit(w, info.get(c.id)!.ownTokens)));
      // ROUTE-RECHECK: a spot verb's places ("read a book in the library") are chosen by 3b below, best name first and offered
      // on demand when far, not as the nearest offer whose name has the word (the library annex next to the quad)
      // ... and a place verb's words that only an offer's "by <neighbours>" names ("go to the south lawn": the quad lawn "by
      // land-campus-south-gate") go to the place whose own name has them (the south lawn, offered on demand when far)
      const byPlace3 = (SPOT_PLACE_VERBS.has(verb) && named3.some(c => c.target?.kind === 'place') && placeMatch(words, ctx.places, ctx.withheld).length > 0)
        || (PLACE_VERBS.has(verb) && !strict.length && named3.length > 0 && [0, 1].includes(placeMatchTier(words, ctx.places, ctx.withheld).tier));
      const r3 = byPlace3 ? null : also(one(ownFirst(named3, words), c => `${input} is ${c.id} (${c.label}).`)); if (r3) return r3;
    }
    // 3c (SOULSIM-E): a thing's everyday synonyms, after its exact words fail, for verbs at things (places have 3b): Mars's
    // "sit by the campfire" was capability.unknown while "sit by the fire" sat on a fire bench (its benches are "Fire
    // bench", the place "Fire circle"). By the thing's own names, else by the place it stands in.
    if (!PLACE_VERBS.has(verb)) for (const words of passes) {
      const syn = (w: string, set: string[]) => tokenHit(w, set) || (SYNONYMS[w] ?? []).some(x => tokenHit(x, set));
      if (!words.some(w => SYNONYMS[w])) continue;
      const r = one(pool.filter(c => words.every(w => syn(w, info.get(c.id)!.ownTokens))), c => `${input} is ${c.id} (${c.label}).`)
        ?? one(pool.filter(c => {const a = info.get(c.id)!.t.around.flatMap(tokens); return a.length > 0 && words.every(w => syn(w, a));}), c => `${input}: ${c.id} (${c.label}) is there.`);
      if (r) return r;
    }
    // 3b. Places by name/description words and everyday synonyms (the park, the woods, the lake, the campfire).
    // CN5 (Gene: "walk to the harbour" went to the park): a named place resolves only to itself, a place inside it, or the
    // place that contains it. A named place that cannot be reached is refused honestly (place.unreachable), never swapped
    // for an unrelated place; the nearest places you can reach are offered in did_you_mean.
    if (PLACE_VERBS.has(verb)) for (const words of passes) {
      const m = placeMatchTier(words, ctx.places, ctx.withheld);
      if (!m.found.length) continue;
      // ROUTE-RECHECK ("read a book in the library" read in the campus library annex): for a spot verb, the place called just
      // these words (the Library) comes before one whose name says more (the library annex); nearest among equals
      const extra = (p: VocabPlace) => new Set(tokens(p.name).filter(t => !words.includes(t) && !ctx.root.includes(t) && !/^\d+$/.test(t))).size;
      const spotted = SPOT_PLACE_VERBS.has(verb) && ctx.hasSpot ? m.found.filter(p => ctx.hasSpot!(verb, p.id)) : [];
      const found = SPOT_PLACE_VERBS.has(verb) ? [...(spotted.length ? spotted : m.found)].sort((a, b) => extra(a) - extra(b)) : m.found;
      // RESOLVE: matched by a place's description only (a lawn "with ... a horse"): the words name a thing in it
      const seek = m.tier === 3 ? words : undefined;
      const one = (cs: EdgeCapability[], note: (c: EdgeCapability) => string): VocabResult | null => {const r = one0(cs, note); return r && seek && r.kind === 'alias' ? {...r, seek} : r;};
      const capOf = new Map(pool.filter(c => c.target).map(c => [c.target!.id, c]));
      const reach = found.filter(p => capOf.has(p.id));
      // (the best-named place with a spot but no offer from here is refused below, and its host offers it on demand)
      const best = SPOT_PLACE_VERBS.has(verb) && spotted.length ? reach.filter(p => extra(p) === extra(found[0])) : SPOT_PLACE_VERBS.has(verb) && reach.length ? reach.filter(p => extra(p) === extra(reach[0])) : reach;
      if (best.length) {const r = one(best.map(p => capOf.get(p.id)!), c => `${input} is ${c.id} (${c.label}).`); if (r) return r;}
      const place = found[0], inner = pool.filter(c => c.available && c.target && isAncestor(ctx, place.id, c.target.id));
      if (inner.length) {const r = one(inner, c => `${place.name} itself is not a ${verb} target; ${c.id} (${c.label}) is in it.`); if (r) return r;}
      // the nearest containing place this verb reaches (the harbour for its lighthouse), never the world root
      const byId = new Map(ctx.places.map(p => [p.id, p]));
      for (let q = place.parent ? byId.get(place.parent) : undefined, n = 0; q && n < 20; q = q.parent ? byId.get(q.parent) : undefined, n++) {
        const c = capOf.get(q.id);
        if (c?.available) return {kind: 'alias', cap: c, inside: place.id, ...(seek ? {seek} : {}), note: `${place.name} itself is not a ${verb} target; ${c.id} (${c.label}) contains it.`};
      }
      const reachable = pool.filter(c => c.available && info.get(c.id)!.t.at), wholes = reachable.filter(c => c.target?.kind === 'place');
      const ranked = (wholes.length ? wholes : reachable).map(c => ({c, d: dist(info.get(c.id)!.t.at, place.center)})).sort((a, b) => a.d - b.d || a.c.id.localeCompare(b.c.id));
      const why = verb === 'read' ? `there is nowhere to read in ${place.name}` : `${place.name} is not walkable ground yet`;
      return {kind: 'unknown', code: 'place.unreachable', place: place.id, verb, places: found.map(p => p.id), ...(seek ? {seek} : {}), reason: `${input}: ${why}${ranked.length ? ` (the nearest place you can ${verb} to is ${ranked[0].c.id}, ${Math.round(ranked[0].d)} m from it)` : ''}; nothing else was chosen in its place.`,
        didYouMean: ranked.slice(0, 3).map(r => ({id: r.c.id, label: r.c.label}))};
    }
  }
  if (!pool.length) return unknown(`No "${verb}" capability is offered to this Soul right now. Things you can do: ${ctx.caps.filter(c => c.id.endsWith(':here')).map(c => c.id).slice(0, 12).join(', ')} (and walk:<place>, stroll:<place>, read:<place>); read capabilities again.`, ctx.caps.filter(c => c.id.endsWith(':here')));
  const left = tokens(rest).filter(t => !FILLER.has(t) && !ctx.root.includes(t));
  // knowledge/1: words that name a place this Soul does not know seek nothing (the secret grove is no thing to walk to either)
  return {...unknown(`Nothing offered matches "${input}"; read capabilities again.`), ...(PLACE_VERBS.has(verb) && left.length && !ctx.withheld?.includes(left.join(' ')) ? {seek: left} : {})};
}

function isAncestor(ctx: VocabContext, ancestor: string, id: string | undefined): boolean {
  const byId = new Map(ctx.places.map(p => [p.id, p]));
  for (let p = id ? byId.get(id) : undefined, n = 0; p && n < 20; p = p.parent ? byId.get(p.parent) : undefined, n++) if (p.parent === ancestor) return true;
  return false;
}
/** Places named by these words: own name/id first, then everyday synonyms, then description words; the most
 *  obvious first (by name over description, walkable, outermost, larger). */
/** A refusal for a spot-based thing (a swing, a bicycle) that is not offered from here: say where the nearest one is, or that
 *  none exists in this world at all (terminal, NOWHERE). Without world knowledge the place-specific wording stays. */
function elsewhereReason(verb: string, ctx: VocabContext, here: string, none?: string): string {
  const e = ctx.elsewhere?.(verb);
  if (e === undefined) return here;
  if (e === null) return (none ?? here) + NOWHERE;
  const where = e.place ? ` in ${e.place}` : '', go = e.placeId ? ` (walk:${e.placeId})` : '';
  return `${here.replace(/[.\s]+$/, '')}. The nearest is ${e.label}${where}, about ${Math.round(e.distance)} m away: walk there first${go}, then ask again.`;
}
export function placeMatch(words: string[], places: VocabPlace[], withheld: readonly string[] = []): VocabPlace[] {return placeMatchTier(words, places, withheld).found;}
/** placeMatch, and which tier matched: 0 own name exactly, 1 own name/id words, 2 everyday synonyms, 3 description words. */
export function placeMatchTier(words: string[], places: VocabPlace[], withheld: readonly string[] = []): {found: VocabPlace[]; tier: number} {
  if (!words.length) return {found: [], tier: -1};
  const nameT = (p: VocabPlace) => [...tokens(p.name), ...tokens(p.id)], descT = (p: VocabPlace) => tokens(p.description ?? '');
  const hit = (w: string, set: string[]) => tokenHit(w, set) || (SYNONYMS[w] ?? []).some(s => tokenHit(s, set));
  const tiers = [
    // CN5: a place whose own name is exactly these words comes first ("Artists' studio" is the office studio, not the village's warehouse)
    places.filter(p => tokens(p.name).join(' ') === words.join(' ')),
    places.filter(p => words.every(w => tokenHit(w, nameT(p)))),
    places.filter(p => words.every(w => hit(w, nameT(p)))),
    places.filter(p => words.every(w => hit(w, [...nameT(p), ...descT(p)]))),
  ];
  // knowledge/1: a withheld place's own name is not an everyday word for some other place (the grove is not the orchard)
  if (!tiers[0].length && !tiers[1].length && withheld.includes(words.join(' '))) return {found: [], tier: -1};
  const tier = tiers.findIndex(t => t.length), found = tiers[tier] ?? [];
  const depth = (p: VocabPlace) => {let n = 0; for (let q: VocabPlace | undefined = p; q?.parent; q = places.find(x => x.id === q!.parent)) n++; return n;};
  return {tier, found: [...found].sort((a, b) => Number(!!b.walkable) - Number(!!a.walkable) || Number(a.kind === 'water') - Number(b.kind === 'water') || depth(a) - depth(b) || a.id.localeCompare(b.id))};
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

/** RESOLVE (SOULSIM-E: "go to the lighthuose", "walk to the cotage" were capability.unknown): a misspelt target word read as
 *  the closest word this world knows (a place's or offered thing's names and description, `extra` names), by optimal
 *  string alignment distance: at most 2 edits for words of 5+ letters, 1 for 4 letters; 3-letter words are never changed
 *  ("dog" is not "log"). A fallback only, after the words as written resolve to nothing; ties go to the commoner word.
 *  Null when no word needs (or has) a reading. */
export function typoFix(input: string, ctx: VocabContext, extra: Iterable<string> = []): {text: string; fixes: [string, string][]} | null {
  if (input.includes(':')) return null;
  const verbs = new Set(ctx.caps.map(c => c.verb)), {verb, rest} = parseCapability(input, verbs);
  if (!verbs.has(verb)) return null;
  const plain = (w: string) => STOP.has(w) || FILLER.has(w) || w in VERBS || /\d/.test(w) || w.length < 4;
  const ask = [...new Set(rest.toLowerCase().split(/[^a-z0-9]+/).filter(w => w && !plain(w) && !LEXICON.has(w)))];
  if (!ask.length) return null;
  const known = knownWords(ctx, extra);
  const fixes: [string, string][] = [];
  for (const w of ask) {
    if (known.has(w)) continue;
    const max = w.length >= 5 ? 2 : 1;
    let best: {k: string; d: number; n: number} | null = null;
    const rank = (x: {k: string; d: number; n: number}) => [x.d, Number(x.k[0] !== w[0]), Number(x.k.length !== w.length), -x.n];
    const before = (x: {k: string; d: number; n: number}, y: {k: string; d: number; n: number}) => {const a = rank(x), b = rank(y), i = a.findIndex((v, j) => v !== b[j]); return i >= 0 ? a[i] < b[i] : x.k < y.k;};
    for (const [k, n] of known) {
      if (Math.abs(k.length - w.length) > max || STOP.has(k)) continue;
      // two edits only keep the first letter (typos rarely change it: "couch" is not "south")
      const d = osa(w, k, max); if (d > max || (d === 2 && k[0] !== w[0])) continue;
      // ties: the same first letter, the same length (a swap: "hrose" is "horse", not "rose"), the commoner word
      const c = {k, d, n}; if (!best || before(c, best)) best = c;
    }
    // a real word nearer than any of this world's ("hrose" is a horse, and Mars has none): no reading, an honest refusal
    if (best && ![...LEXICON].some(x => !known.has(x) && Math.abs(x.length - w.length) < best!.d && osa(w, x, best!.d - 1) < best!.d)) fixes.push([w, best.k]);
  }
  if (!fixes.length) return null;
  let text = input;
  for (const [w, k] of fixes) text = text.replace(new RegExp(`\\b${w}\\b`, 'gi'), k);
  return {text, fixes};
}
/** The words this world knows for typoFix, with how often each occurs. Rebuilt only when the offered ids, the known places or
 *  the extra names change (a dry run reads it once per refusal; building it each time was most of a refusal's cost). */
let knownMemo: {key: string; extra: unknown; known: Map<string, number>} | null = null;
let synonymWords: [string, number][] | null = null;
function knownWords(ctx: VocabContext, extra: Iterable<string>): Map<string, number> {
  const key = ctx.caps.map(c => c.id).join('\n') + '\0' + ctx.places.map(p => `${p.id}|${p.name}|${p.description?.length ?? 0}|${p.aliases?.length ?? 0}`).join('\n');
  const same = (a: unknown, b: unknown) => a === b || (Array.isArray(a) && Array.isArray(b) && !a.length && !b.length);
  if (knownMemo && knownMemo.key === key && Array.isArray(extra) && same(knownMemo.extra, extra)) return knownMemo.known;
  const count = (into: Map<string, number>, s: string | undefined) => {if (s) for (const t of tokens(s)) if (t.length >= 3 && !/\d/.test(t)) into.set(t, (into.get(t) ?? 0) + 1);};
  if (!synonymWords) {const m = new Map<string, number>(); for (const [k, v] of Object.entries(SYNONYMS)) {count(m, k); for (const x of v) count(m, x);} synonymWords = [...m];}
  const known = new Map<string, number>(synonymWords), add = (s: string | undefined) => count(known, s);
  for (const c of ctx.caps) {add(c.id.slice(c.id.indexOf(':') + 1)); add(c.label.replace(/,\s*by\s.*$/, ''));}
  for (const p of ctx.places) {add(p.name); add(p.id); add(p.description); for (const a of p.aliases ?? []) add(a);}
  for (const w of extra) add(w);
  knownMemo = {key, extra, known};
  return known;
}
/** Everyday words for things and places that are spelt right: never read as another word (Mars has no horse: "go to the
 *  horse" is not the bunk house; "stable" is not a table, "couch" not the south). Only guards the typo fallback. */
const LEXICON = new Set(('horse horses pony donkey cow cows sheep goat goats pig pigs chicken chickens hen duck ducks goose swan bird birds dog dogs cat cats ' +
  'rabbit deer fox fish frog bear lion tiger monkey dragon unicorn cattle animal animals boat boats ship ships canoe kayak yacht car cars bus train tram plane ' +
  'airport station taxi bike bicycle house houses home cottage castle tower church chapel temple school college shop shops store market beach sea ocean lake ' +
  'river stream pond pool forest woods tree trees park garden farm barn stable stables field fields meadow mountain hill hills cave bridge road street lane ' +
  'lighthouse harbour harbor pier dock jetty hotel cafe coffee restaurant bar pub bakery library museum gallery theatre theater cinema hospital clinic office ' +
  'bank post kitchen bedroom bathroom toilet bed beds chair chairs couch sofa table tables bench benches desk door window stairs roof attic cellar basement ' +
  'fire campfire fountain statue well gate wall fence tent hut cabin shed palace island volcano desert jungle zoo playground swing slide gym stadium court ' +
  'south north east west centre center middle upstairs downstairs outside inside nearby somewhere').split(' '));
/** Optimal string alignment distance (a swap of two neighbours is one edit), cut off past `max`. */
function osa(a: string, b: string, max: number): number {
  const m = a.length, n = b.length; let p2: number[] = [], p1 = Array.from({length: n + 1}, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i]; let low = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(p1[j] + 1, cur[j - 1] + 1, p1[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, p2[j - 2] + 1);
      cur.push(v); if (v < low) low = v;
    }
    if (low > max) return max + 1;
    p2 = p1; p1 = cur;
  }
  return p1[n];
}

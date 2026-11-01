// EVENTS-v1 (team/CONTRACTS/proposals/EVENTS-v1.md): the push envelope a Soul's body daemon reads.
// Stored stream events stay as they are (`wait` keeps its shape); this module projects each one into
// {id, tick, clock, kind, salience 0–3, about, where, text (one line), media, untrusted, raw, data}.
// Pure functions: the same stored event always projects to the same envelope.
import type {StreamEvent} from '../comms/stream.ts';

export type Media = {type: 'image'; url: string; alt: string};
export type Where = {place?: string; placeId?: string; dist?: number; bearing?: string};
export type Envelope = {
  id: string; tick: number; at: number; clock: string | null; kind: string; salience: 0 | 1 | 2 | 3;
  about?: {soulId: string; name: string}; where?: Where; text: string; media?: Media[]; untrusted: boolean;
  /** The stored event's kind (`wait` vocabulary) and its remaining fields, for code that needs ids (invite accept ids, receipt ids…). */
  raw: string; data?: Record<string, unknown>;
};

/** Every envelope kind with its default salience (3 wake now · 2 wake if idle / batch · 1 log, read in digest · 0 bookkeeping). */
export const EVENT_KINDS: Record<string, {salience: 0 | 1 | 2 | 3; what: string}> = {
  'speech.to-me': {salience: 3, what: 'addressed by name, or sole nearby listener'},
  'mention': {salience: 3, what: 'name in earshot, not opening'},
  'speech.presenter': {salience: 2, what: 'presenter speaking to my audience'},
  'speech.ambient': {salience: 1, what: 'earshot speech, not to me'},
  'conversation.invite': {salience: 3, what: 'private conversation invite; converse accept/decline'},
  'conversation.turn': {salience: 3, what: 'new turn in my conversation'},
  'conversation.member': {salience: 2, what: 'my conversation: joined/left/join requested'},
  'conversation.closed': {salience: 1, what: 'my conversation or invitation closed'},
  'invite': {salience: 3, what: 'shared action invite: accept:<id> / decline:<id>'},
  'invite.answered': {salience: 3, what: 'my invite accepted/declined'},
  'invite.lapsed': {salience: 2, what: 'my sent/received invite expired/closed'},
  'follow.start': {salience: 2, what: 'started walking with me'},
  'follow.stop': {salience: 1, what: 'stopped walking with me'},
  'approach': {salience: 2, what: 'someone approached within3m'},
  'arrive': {salience: 2, what: 'body arrived at receipt’s destination'},
  'arrive.here': {salience: 1, what: 'Soul arrived at my place'},
  'leave.here': {salience: 1, what: 'Soul left my place'},
  'world.join': {salience: 1, what: 'known Soul returned to world'},
  'world.leave': {salience: 1, what: 'known Soul faded from world'},
  'receipt.waiting': {salience: 0, what: 'act accepted; safe body stop pending'},
  'receipt.started': {salience: 1, what: 'act started'},
  'activity.observed': {salience: 2, what: 'own actual current native activity; nonterminal, no content/hold completion'},
  'receipt.terminal': {salience: 3, what: 'act completed/failed; own newer act replacement:1; plan-driven:1 (plan reports)'},
  'blocked': {salience: 3, what: 'act failed: blocked route, occupied seat, full region'},
  'plan.step.started': {salience: 1, what: 'my plan step started; chosen act included'},
  'plan.step.done': {salience: 2, what: 'my plan step finished'},
  'plan.step.failed': {salience: 3, what: 'step refused/failed; onRefusal pauses/skips/cancels'},
  'plan.paused': {salience: 3, what: 'refusal/own act paused plan; PATCH resume/skip/replace/cancel'},
  'plan.done': {salience: 3, what: 'plan done/cancelled/replaced/failed'},
  'reminder.due': {salience: 3, what: 'own private reminder: explicit world/real time due; advisory, no body action'},
  'schedule.starting': {salience: 2, what: 'interested calendar item or happening starts'},
  'presentation.doors': {salience: 2, what: 'ticketed presentation doors open'},
  'presentation.started': {salience: 3, what: 'ticketed/attended presentation began'},
  'presentation.seat': {salience: 3, what: 'standby seat free / unclaimed seat released'},
  'presentation.ended': {salience: 2, what: 'attended presentation ended'},
  'schedule.cancelled': {salience: 3, what: 'attended happening cancelled; reserved, not implemented'},
  'slide.changed': {salience: 2, what: 'presenter published slides/pictures to audience'},
  'object.response': {salience: 2, what: 'response to my mark / work on my project'},
  'chess.move': {salience: 2, what: 'opponent chess move/seat change'},
  'ride': {salience: 2, what: 'my ride: takeoff/landing/boarding'},
  'item.received': {salience: 2, what: 'gift received'},
  'knock': {salience: 2, what: 'someone knocked at a door that shuts me in (or right by me)'},
  'fade.warning': {salience: 3, what: 'abandonment: yellow30min, red50min'},
  'fade.removed': {salience: 3, what: 'abandoned60min: faded; act to return'},
  'fade.reclaimed': {salience: 2, what: 'returned after fading'},
  'world.notice': {salience: 2, what: 'steward maintenance/restart/outage; outage/restart:3'},
  'calendar.new': {salience: 1, what: 'public calendar addition'},
  'light.changed': {salience: 1, what: 'world light: morning/day/evening/dusk/night'},
  'weather.changed': {salience: 1, what: 'reserved: no weather yet'},
  'mail.delivered':{salience:2,what:'private postbox letter; attributed, untrusted text'},
  'world.narration': {salience: 1, what: 'world narration/small consequences'},
  'god-change': {salience: 3, what: 'god changed something by me; moved: walked/relocated'},
  'other': {salience: 1, what: 'unknown envelope kind'},
};

const BEARINGS = ['ahead', 'front-right', 'right', 'behind-right', 'behind', 'behind-left', 'left', 'front-left'];
/** Bearing of (dx,dz) relative to a heading yaw (engine convention: facing = (cos yaw, sin yaw); its right is (−sin, cos)). */
export function relativeBearing(yaw: number, dx: number, dz: number): string {
  if (Math.hypot(dx, dz) < 0.3) return 'here';
  let rel = Math.atan2(dz, dx) - yaw;
  while (rel <= -Math.PI) rel += 2 * Math.PI;
  while (rel > Math.PI) rel -= 2 * Math.PI;
  const i = Math.round(rel / (Math.PI / 4));
  return BEARINGS[(i + 8) % 8]!;
}

export const oneLine = (s: unknown, max = 200) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return [...t].length > max ? [...t].slice(0, max - 1).join('') + '…' : t;
};
const IMG_MD = /!\[([^\]]{0,200})\]\((https?:\/\/[^\s)]{1,500})\)/g, IMG_URL = /(?<![("])\bhttps?:\/\/[^\s)"']{1,500}\.(?:png|jpe?g|gif|webp)(?:\?[^\s)"']*)?/gi;
/** Pictures shared in markdown (`![alt](url)` or a bare image URL), at most 4. */
export function mediaOf(text: unknown): Media[] {
  const s = String(text ?? ''), out: Media[] = [];
  for (const m of s.matchAll(IMG_MD)) out.push({type: 'image', url: m[2]!, alt: oneLine(m[1] || 'picture', 120)});
  for (const m of s.matchAll(IMG_URL)) if (!out.some(x => x.url === m[0])) out.push({type: 'image', url: m[0], alt: 'picture'});
  return out.slice(0, 4);
}

type Ref = {soulId: string; name: string};
const ref = (x: unknown): Ref | undefined => x && typeof x === 'object' && typeof (x as Ref).soulId === 'string' ? {soulId: (x as Ref).soulId, name: String((x as Ref).name ?? 'someone')} : undefined;
const BLOCKING = /^(route\.|slot\.|reservation\.|seat\.|pose\.occupied|pose\.no-room|ride\.full|place\.full)/;
const firstNameOf = (name: string) => (name.split(/[\s,]+/)[0] ?? '').toLowerCase();
const wordIn = (text: string, word: string) => word.length >= 2 && new RegExp(`(^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu').test(text);

export type Viewer = {soulId: string; name: string};
/** Speech addressed to a name: it opens with it ("Roger, …", "hi Roger"), or calls it out (", Roger?" / "Roger!"). */
function vocative(text: string, name: string): boolean {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), a = '(?<![\\p{L}\\p{N}])', b = '(?![\\p{L}\\p{N}])';
  return new RegExp(`^\\W*(?:(?:hey|hi|hello|oh|dear|ok|okay|so|and|well|morning|evening)\\W+)?${n}${b}|${a}${n}${b}\\s*[,!?]|,\\s*${n}${b}\\s*[.!?]*\\s*$`, 'iu').test(text);
}

/** Kind and default salience for one stored event, as seen by the Soul whose stream holds it. */
export function classify(e: StreamEvent, me: Viewer): {kind: string; salience: 0 | 1 | 2 | 3} {
  const k = (kind: string, salience?: 0 | 1 | 2 | 3) => ({kind, salience: salience ?? EVENT_KINDS[kind]?.salience ?? 1});
  const d = e as Record<string, any>;
  switch (e.kind) {
    case 'speech': {
      const text = String(d.text ?? ''), mine = firstNameOf(me.name);
      if (d.channel?.kind === 'audience') return k('speech.presenter');
      if (mine && vocative(text, mine)) return k('speech.to-me');
      if (mine && (wordIn(text, mine) || wordIn(text, me.name.toLowerCase()))) return k('mention');
      if (d.heardBy === 1 && typeof d.where?.dist === 'number' && d.where.dist <= 4) return k('speech.to-me');
      return k('speech.ambient');
    }
    case 'conversation.invite': case 'conversation.turn': case 'conversation.member': case 'conversation.closed': return k(e.kind);
    case 'invite': return k('invite');
    case 'invite.accepted': case 'invite.declined': return k('invite.answered');
    case 'invite.expired': case 'invite.closed': return k('invite.lapsed', e.kind === 'invite.closed' ? 1 : 2);
    case 'follow': return k('follow.start');
    case 'follow.stop': return k('follow.stop');
    case 'approach': return k('approach');
    case 'arrive': return k('arrive', d.plan ? 1 : 2);
    case 'arrival': return k('arrive.here');
    case 'departure': return k('leave.here');
    case 'world.join': case 'world.leave': case 'light.changed': case 'weather.changed': return k(e.kind);
    case 'reminder.due': return k('reminder.due');
    case 'world.notice': return k('world.notice', d.level === 'outage' || d.level === 'restart' ? 3 : Number(d.salience) === 3 ? 3 : 2);
    case 'mail.delivered':return k('mail.delivered');
    // G1 walk-outs (3); R8 "the god changed something near you" sets its own salience.
    case 'god-change': return k('god-change', [0, 1, 2, 3].includes(Number(d.salience)) ? Number(d.salience) as 0 | 1 | 2 | 3 : d.moved ? 3 : 2);
    case 'receipt': {
      const r = d.receipt ?? {}, plan = !!d.plan;
      if (r.channel === 'attention' || r.channel === 'none') return k('receipt.terminal', 0);
      if (r.phase === 'waiting') return k('receipt.waiting');
      if (r.phase === 'started') return k('receipt.started', plan ? 0 : 1);
      if (r.phase === 'replaced') return k('receipt.terminal', plan ? 0 : 1);
      if (r.phase === 'failed' && BLOCKING.test(String(r.code ?? ''))) return k('blocked', plan ? 1 : 3);
      return k('receipt.terminal', plan ? 1 : 3);
    }
    case 'fade': return d.change === 'removed' ? k('fade.removed') : d.change === 'reclaimed' ? k('fade.reclaimed') : k('fade.warning');
    case 'schedule': {
      const phase = d.data?.phase;
      if (d.objectKind === 'presentation') {
        if (phase === 'doors') return k('presentation.doors');
        if (phase === 'ended') return k('presentation.ended');
        if (phase === 'started') return k('presentation.started');
        if (phase === 'running' || d.data?.ticket !== undefined) return k('presentation.seat', d.data?.ticket === false ? 2 : 3);
        return k('schedule.starting');
      }
      if (phase === 'cancelled') return k('schedule.cancelled');
      return k('schedule.starting');
    }
    case 'object': {
      if (d.objectKind === 'presentation') return k('slide.changed');
      if (d.objectKind === 'chess') return k('chess.move');
      if (d.objectKind === 'ride') return k('ride');
      if (d.objectKind === 'mark' || d.objectKind === 'project') return k('object.response');
      return k('object.response', 1);
    }
    case 'world': {
      const text = String(d.text ?? '');
      if (/ gave you /.test(text)) return k('item.received');
      if (/boarded a ride; you stop following/.test(text)) return k('follow.stop');
      if (/^New on the calendar:/.test(text)) return k('calendar.new');
      return k('world.narration');
    }
    default:
      if (e.kind === 'plan.done' && d.status === 'replaced') return k('plan.done', 1);
      if (e.kind.startsWith('plan.')) return k(e.kind, EVENT_KINDS[e.kind]?.salience ?? 2);
      return k(EVENT_KINDS[e.kind] ? e.kind : 'other', EVENT_KINDS[e.kind]?.salience ?? 1);
  }
}

const STRIP = new Set(['id', 'kind', 'tick', 'at', 'where', 'clock', 'untrusted', 'salience']);
const quote = (s: unknown, max = 160) => `"${oneLine(s, max)}"`;
const at = (w?: Where) => w && (w.dist !== undefined || w.bearing) ? ` (${[w.dist !== undefined ? `${Math.round(w.dist)} m` : null, w.bearing && w.bearing !== 'here' ? w.bearing : null].filter(Boolean).join(', ')})` : '';

/** One stored event → its envelope for this viewer. */
export function toEnvelope(e: StreamEvent, me: Viewer): Envelope {
  const d = e as Record<string, any>, {kind, salience} = classify(e, me);
  const about = ref(d.from) ?? ref(d.soul) ?? ref(d.turn?.from) ?? ref(d.invite?.from) ?? ref(d.about);
  const where: Where | undefined = d.where && typeof d.where === 'object' ? d.where as Where : undefined;
  const who = about ? about.name + at(where) : 'Someone';
  let text: string;
  switch (e.kind) {
    case 'speech': text = `${who}${d.channel?.kind === 'audience' ? ' (presenting)' : ''}: ${quote(d.text)}`; break;
    case 'conversation.invite': text = `${who} invites you to a conversation${d.text ? ': ' + quote(d.text) : ''} (converse accept/decline ${d.conversation})`; break;
    case 'conversation.turn': text = `${about?.name ?? 'Someone'} [${d.conversation}]: ${quote(d.turn?.text)}`; break;
    case 'conversation.member': text = `${about?.name ?? 'Someone'} ${d.change ?? 'changed'} [${d.conversation}]`; break;
    case 'conversation.closed': text = `Conversation ${d.conversation} closed (${d.reason ?? 'ended'})`; break;
    case 'invite': text = `${oneLine(d.invite?.label ?? `${who} invites you`, 120)} → accept:${d.invite?.id} / decline:${d.invite?.id} (${d.invite?.expiresInSeconds ?? '?'} s)`; break;
    case 'arrive': text = `You arrived at ${d.placePath?.[0] ?? d.endedAt?.placePath?.[0] ?? where?.place ?? d.placeId ?? 'your destination'}.`; break;
    case 'arrival': text = `${who} arrived${where?.place ? ' at ' + where.place : ''}`; break;
    case 'departure': text = `${about?.name ?? 'Someone'} left${where?.place ? ' ' + where.place : ''}`; break;
    case 'activity.observed': text = `Your body is ${oneLine(d.body?.posture,40)} (${oneLine(d.body?.activity,60)}); receipt remains open. No completion or content outcome implied.${d.body?.occupiedSeats?.length ? ' Occupied '+d.body.occupiedSeats.map((s:unknown)=>oneLine(s,100)).join(', ') : ''}`; break;
    case 'mail.delivered':text=`A private letter is in your postbox (${d.letter?.id??'letter'}).`;break;
    case 'receipt': {
      const r = d.receipt ?? {}, end = r.endedAt ?? d.endedAt;
      text = `${r.capability ?? 'act'} ${r.phase ?? ''}${r.code ? ` ${r.code}` : ''}${r.reason && r.phase === 'failed' ? ': ' + oneLine(r.reason, 100) : ''}${end?.place ? ` · now at ${end.place}${end.posture ? ', ' + end.posture : ''}` : where?.place && r.phase !== 'started' && r.phase !== 'waiting' ? ` · at ${where.place}` : ''}`;
      if(r.outcome?.summary)text=String(r.outcome.summary);
      break;
    }
    default: text = d.text !== undefined ? String(d.text) : kind; break;
  }
  const media = e.kind === 'object' || e.kind === 'schedule' || e.kind === 'speech' ? mediaOf(d.text) : Array.isArray(d.media) ? d.media as Media[] : [];
  const data: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(d)) if (!STRIP.has(key)) data[key] = v;
  return {id: e.id, tick: e.tick, at: e.at, clock: typeof d.clock === 'string' ? d.clock : null, kind, salience,
    ...(about ? {about} : {}), ...(where ? {where} : {}), text: oneLine(text, 240), ...(media.length ? {media} : {}),
    untrusted: d.untrusted === true||d.receipt?.outcome?.untrusted===true, raw: e.kind, ...(Object.keys(data).length ? {data} : {})};
}

/** Server-side filter: `kinds` (exact, or a `prefix.*` / `prefix*` pattern) and a minimum salience. */
export type Filter = {kinds: string[] | null; minSalience: number};
export function parseFilter(q: (name: string) => string | undefined): Filter {
  const kinds = (q('kinds') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const rawSal = q('minSalience') ?? q('salience>') ?? q('salience');
  const n = rawSal === undefined ? 0 : Number(String(rawSal).replace(/^>=?/, ''));
  return {kinds: kinds.length ? kinds.slice(0, 40) : null, minSalience: Number.isFinite(n) ? Math.max(0, Math.min(3, Math.floor(n))) : 0};
}
export function kindMatches(pattern: string, kind: string): boolean {
  if (pattern === '*' || pattern === kind) return true;
  if (pattern.endsWith('*')) return kind.startsWith(pattern.slice(0, -1).replace(/\.$/, '.')) || kind === pattern.slice(0, -2);
  return false;
}
export function passes(env: Envelope, f: Filter): boolean {
  if (env.salience < f.minSalience) return false;
  return !f.kinds || f.kinds.some(p => kindMatches(p, env.kind) || kindMatches(p, env.raw));
}

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
  'speech.to-me': {salience: 3, what: 'speech addressed to me: my name opens it, or I was the only one in earshot close by'},
  'mention': {salience: 3, what: 'my name said in earshot (not at the start)'},
  'speech.presenter': {salience: 2, what: 'a presenter speaking to the audience I am in'},
  'speech.ambient': {salience: 1, what: 'speech in earshot, not to me'},
  'conversation.invite': {salience: 3, what: 'someone asks me into a private conversation (accept/decline with converse)'},
  'conversation.turn': {salience: 3, what: 'a new turn in a conversation I am in'},
  'conversation.member': {salience: 2, what: 'someone joined, left or asked to join my conversation'},
  'conversation.closed': {salience: 1, what: 'a conversation I was in or invited to closed'},
  'invite': {salience: 3, what: 'an invitation to do something together (hug, dance, walk with, ride, gift…): accept:<id> / decline:<id>'},
  'invite.answered': {salience: 3, what: 'my invitation was accepted or declined'},
  'invite.lapsed': {salience: 2, what: 'an invitation (mine or to me) expired or closed'},
  'follow.start': {salience: 2, what: 'someone started walking with me'},
  'follow.stop': {salience: 1, what: 'someone stopped walking with me'},
  'approach': {salience: 2, what: 'someone came within 3 m of me'},
  'arrive': {salience: 2, what: 'my body arrived at the destination its receipt reports'},
  'arrive.here': {salience: 1, what: 'a Soul arrived in the place I am in'},
  'leave.here': {salience: 1, what: 'a Soul left the place I am in'},
  'world.join': {salience: 1, what: 'a Soul I have met came back into the world'},
  'world.leave': {salience: 1, what: 'a Soul I have met faded out of the world'},
  'receipt.waiting': {salience: 0, what: 'my act was accepted; the body finishes a safe stop first'},
  'receipt.started': {salience: 1, what: 'my act started'},
  'receipt.terminal': {salience: 3, what: 'my act ended (completed / failed); replaced by my own newer act is salience 1; plan-driven ones are 1 (the plan reports)'},
  'blocked': {salience: 3, what: 'my act failed on a real obstacle (route blocked, seat taken, region full)'},
  'plan.step.started': {salience: 1, what: 'a step of my plan started (with what was chosen)'},
  'plan.step.done': {salience: 2, what: 'a step of my plan finished'},
  'plan.step.failed': {salience: 3, what: 'a step of my plan was refused or failed (the plan pauses, skips or cancels per onRefusal)'},
  'plan.paused': {salience: 3, what: 'my plan paused (a refusal, or my own act interrupted it); PATCH resume/skip/replace/cancel'},
  'plan.done': {salience: 3, what: 'my plan ended: done, cancelled, replaced or failed'},
  'schedule.starting': {salience: 2, what: 'a calendar item I showed interest in, or a scheduled happening, starts'},
  'presentation.doors': {salience: 2, what: 'doors opened for a presentation I hold a ticket for'},
  'presentation.started': {salience: 3, what: 'a presentation I hold a ticket for or attend began'},
  'presentation.seat': {salience: 3, what: 'a standby seat came free for me / my unclaimed seat was released'},
  'presentation.ended': {salience: 2, what: 'a presentation I attend ended'},
  'schedule.cancelled': {salience: 3, what: 'a happening I am attending was cancelled (reserved: nothing cancels yet)'},
  'slide.changed': {salience: 2, what: 'the presenter published material (slides, pictures) to the audience'},
  'object.response': {salience: 2, what: 'someone responded to my mark or worked on my project'},
  'chess.move': {salience: 2, what: 'a chess move or seat change against me'},
  'ride': {salience: 2, what: 'my ride lifted off, landed, or someone climbed in'},
  'item.received': {salience: 2, what: 'someone gave me something'},
  'fade.warning': {salience: 3, what: 'I am fading (yellow at 30 min abandoned, red at 50)'},
  'fade.removed': {salience: 3, what: 'I faded out (60 min abandoned); act to come back'},
  'fade.reclaimed': {salience: 2, what: 'I came back after fading'},
  'world.notice': {salience: 2, what: 'a steward notice: maintenance, restart, outage (level=outage/restart is 3)'},
  'calendar.new': {salience: 1, what: 'something new on the public calendar'},
  'light.changed': {salience: 1, what: 'the world light changed (morning, day, evening, dusk, night)'},
  'weather.changed': {salience: 1, what: 'reserved: the world has no weather yet'},
  'world.narration': {salience: 1, what: 'world text: narration, small consequences (book back on the shelf…)'},
  'other': {salience: 1, what: 'an event kind this envelope does not know yet'},
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
    case 'world.notice': return k('world.notice', d.level === 'outage' || d.level === 'restart' ? 3 : Number(d.salience) === 3 ? 3 : 2);
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
    case 'receipt': {
      const r = d.receipt ?? {}, end = r.endedAt ?? d.endedAt;
      text = `${r.capability ?? 'act'} ${r.phase ?? ''}${r.code ? ` ${r.code}` : ''}${r.reason && r.phase === 'failed' ? ': ' + oneLine(r.reason, 100) : ''}${end?.place ? ` · now at ${end.place}${end.posture ? ', ' + end.posture : ''}` : where?.place && r.phase !== 'started' && r.phase !== 'waiting' ? ` · at ${where.place}` : ''}`;
      break;
    }
    default: text = d.text !== undefined ? String(d.text) : kind; break;
  }
  const media = e.kind === 'object' || e.kind === 'schedule' || e.kind === 'speech' ? mediaOf(d.text) : Array.isArray(d.media) ? d.media as Media[] : [];
  const data: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(d)) if (!STRIP.has(key)) data[key] = v;
  return {id: e.id, tick: e.tick, at: e.at, clock: typeof d.clock === 'string' ? d.clock : null, kind, salience,
    ...(about ? {about} : {}), ...(where ? {where} : {}), text: oneLine(text, 240), ...(media.length ? {media} : {}),
    untrusted: d.untrusted === true, raw: e.kind, ...(Object.keys(data).length ? {data} : {})};
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

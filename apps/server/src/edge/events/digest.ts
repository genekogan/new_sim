// EVENTS-v1 digest: what happened since a cursor, as a short structured summary (≤ ~400 tokens),
// so a mind that reconnects reads one message instead of replaying a backlog.
import type {EventStreams, StreamEvent} from '../comms/stream.ts';
import {cursorOf} from '../comms/stream.ts';
import {oneLine, type Envelope} from './envelope.ts';

export const DIGEST_SCAN = 2000;

export type DigestInput = {
  streams: EventStreams; soulId: string; since: number | null; envelope: (e: StreamEvent) => Envelope; now: number;
  fade: unknown; plan: unknown; clock: string | null; place: string | null;
};

const uniq = (xs: string[], n: number) => [...new Set(xs)].slice(0, n);

export function buildDigest(d: DigestInput) {
  const head = d.streams.head(d.soulId), floor = d.streams.floor(d.soulId);
  const from = d.since === null ? Math.max(floor, head - 200) : d.since, gap = from < floor;
  const events: StreamEvent[] = [];
  for (let pos = Math.max(from, floor); events.length < DIGEST_SCAN;) {
    const page = d.streams.read(d.soulId, pos, 500);
    if (page.gap || !page.events.length) break;
    events.push(...page.events); pos = Number(page.events.at(-1)!.id.slice(2));
  }
  const env = events.map(d.envelope), byKind: Record<string, number> = {};
  for (const e of env) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  const names = (kinds: string[]) => uniq(env.filter(e => kinds.includes(e.kind) && e.about).map(e => e.about!.name), 8);
  // conversations: who, how many turns, the last line
  const convs = new Map<string, {with: Set<string>; turns: number; last: string; open: boolean}>();
  for (const e of env) {
    const id = (e.data?.conversation as string | undefined); if (!id || !e.kind.startsWith('conversation.')) continue;
    const c = convs.get(id) ?? {with: new Set<string>(), turns: 0, last: '', open: true};
    if (e.about) c.with.add(e.about.name);
    if (e.kind === 'conversation.turn') { c.turns++; c.last = `${e.about?.name ?? '?'}: ${oneLine((e.data?.turn as {text?: string})?.text, 80)}`; }
    if (e.kind === 'conversation.invite') c.last ||= `${e.about?.name ?? '?'} invited you`;
    if (e.kind === 'conversation.closed') c.open = false;
    convs.set(id, c);
  }
  // open invitations (to do something together) that were neither answered nor lapsed in this window
  const lapsed = new Set(env.filter(e => e.kind === 'invite.lapsed' || e.kind === 'invite.answered').map(e => (e.data?.invite as {id?: string})?.id));
  const invites = env.filter(e => e.kind === 'invite' && !lapsed.has((e.data?.invite as {id?: string})?.id)).slice(-3).map(e => oneLine(e.text, 140));
  const toMe = env.filter(e => e.kind === 'speech.to-me' || e.kind === 'mention').slice(-3).map(e => oneLine(e.text, 140));
  const covered = new Set(['conversation.turn', 'conversation.invite', 'conversation.member', 'conversation.closed', 'speech.to-me', 'mention', 'invite', 'invite.lapsed', 'invite.answered', 'arrive.here', 'leave.here', 'approach', 'speech.ambient', 'receipt.started', 'receipt.waiting', 'light.changed', 'world.narration']);
  const salient = env.filter(e => e.salience >= 2 && !covered.has(e.kind)).slice(-6).map(e => `${e.clock ? e.clock + ' ' : ''}${e.kind}: ${oneLine(e.text, 110)}`);
  const mine = env.filter(e => e.kind === 'receipt.terminal' || e.kind === 'blocked').slice(-1)[0];
  const notices = env.filter(e => e.kind === 'world.notice').slice(-2).map(e => oneLine(e.text, 120));
  const span = env.length ? {fromTick: env[0]!.tick, toTick: env.at(-1)!.tick, minutes: Math.round((d.now - env[0]!.at) / 60_000)} : null;
  const parts = [
    `${env.length} events${span ? ` over ${span.minutes} min` : ''}${gap ? ' (older ones pruned)' : ''}.`,
    d.place ? `You are at ${d.place}${d.clock ? ', ' + d.clock : ''}.` : null,
    toMe.length ? `Said to you: ${toMe.join(' | ')}` : null,
    convs.size ? `Conversations: ${[...convs].slice(-3).map(([id, c]) => `${[...c.with].join(', ') || '?'} [${id}] ${c.turns} turns${c.open ? '' : ' (closed)'}${c.last ? ' — ' + c.last : ''}`).join(' | ')}` : null,
    invites.length ? `Open invitations: ${invites.join(' | ')}` : null,
    names(['arrive.here', 'approach']).length ? `Came by: ${names(['arrive.here', 'approach']).join(', ')}.` : null,
    names(['world.leave']).length ? `Faded out: ${names(['world.leave']).join(', ')}.` : null,
    mine ? `Your last act: ${oneLine(mine.text, 120)}` : null,
  ].filter(Boolean) as string[];
  return {since: cursorOf(from), cursor: cursorOf(head), ...(gap ? {gap: true, oldest: cursorOf(floor)} : {}), span,
    counts: {total: env.length, ...(env.length >= DIGEST_SCAN ? {truncated: true} : {}), byKind},
    toMe, conversations: [...convs].slice(-4).map(([id, c]) => ({id, with: [...c.with].slice(0, 4), turns: c.turns, open: c.open, last: c.last})),
    invites, salient, notices, people: {cameBy: names(['arrive.here', 'approach']), left: names(['leave.here']), fadedOut: names(['world.leave']), back: names(['world.join'])},
    plan: d.plan, fade: d.fade, text: oneLine(parts.join(' '), 900), untrusted: true};
}

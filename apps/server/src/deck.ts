// From a Soul's deck to the options its mind chooses among, and from a card's
// depiction program to concrete engine steps. This is the boundary where
// meaning (kernel things) meets the engine (bodies, fixtures, points).
import type { ActivityOption } from '@sim/engine-contract';
import { bind, linked, linksFrom, linksTo, playable, samePlace, whyNot, type MintedCard, type Thing } from '@sim/kernel';
import type { Mind, WorldHost } from './world.ts';

export type CardOption = ActivityOption & { card: string; hash: string; cardTarget: string | null; approachLen: number };

/** What the engine needs in order to find a kernel thing: a body, a fixture entity, or a point. */
export function engineRef(host: WorldHost, id: string): string | [number, number] | null {
  const k = host.kernel;
  for (let t: Thing | undefined = k.things[id], n = 0; t && n < 6; t = t.at ? k.things[t.at] : undefined, n++) {
    if (typeof t.traits.body === 'string') return t.traits.body;
    if (typeof t.traits.entity === 'string') return t.traits.entity;
    if (Array.isArray(t.traits.point)) return t.traits.point as [number, number];
  }
  return null;
}
/** Where a thing physically is, in metres. */
export function positionOf(host: WorldHost, id: string): [number, number] | null {
  const r = engineRef(host, id); if (r === null) return null;
  if (Array.isArray(r)) return r;
  const e = host.engine.world.entities[r]; return e ? [e.pose.p[0], e.pose.p[2]] : null;
}
export function distance(host: WorldHost, a: string, b: string): number {
  const pa = positionOf(host, a), pb = positionOf(host, b);
  return pa && pb ? Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) : 1e6;
}
export const distanceWord = (m: number) => (m < 2.5 ? 'here' : m < 9 ? 'close' : m < 28 ? 'near' : 'far');

/** Replace `$slot` references in depiction params with engine references. */
export function resolveParams(host: WorldHost, v: unknown, b: Record<string, string>): unknown {
  if (typeof v === 'string' && v.startsWith('$')) {
    const [slot, suffix] = v.slice(1).split('.');
    const id = b[slot]; if (!id) return v;
    if (suffix === 'name') return host.kernel.things[id]?.name ?? id;
    if (suffix === 'x' || suffix === 'z') { const p = positionOf(host, id); return p ? p[suffix === 'x' ? 0 : 1] : 0; }
    return engineRef(host, id) ?? id;
  }
  if (Array.isArray(v)) return v.map((x) => resolveParams(host, x, b));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveParams(host, x, b)]));
  return v;
}

function describeTarget(host: WorldHost, me: string, t: Thing): string {
  const k = host.kernel, d = distanceWord(distance(host, me, t.id));
  if (t.kind === 'soul') return `${t.name} (${d}, ${String(t.states.doing ?? host.minds.get(t.id)?.doing ?? 'around')})`;
  if (t.kind === 'gathering') { const n = linksTo(k, t.id, 'attends').length; return `${t.name} (${d}, ${n} taking part${t.states.music === 'playing' ? ', music playing' : ''})`; }
  const here = Object.values(k.things).filter((x) => x.kind === 'soul' && x.at === t.id).length;
  return `${t.name} (${d}${here ? `, ${here} here` : ''})`;
}

/** Things a Soul could act on: for now everything that exists except regions and itself (the world is small). */
export function candidatesFor(host: WorldHost, soulId: string): string[] {
  return Object.values(host.kernel.things).filter((t) => t.id !== soulId && t.kind !== 'region').map((t) => t.id);
}

/** Does a target belong to `of`: is it that thing, or something it hosts, made, holds or otherwise links to? */
export function belongsTo(host: WorldHost, target: string | null, of: string): boolean {
  if (!target) return false;
  if (target === of) return true;
  const k = host.kernel; if (k.things[target]?.by === of) return true;
  return Object.values(k.links).some((l) => l.from === of && l.to === target && l.kind !== 'said' && (l.until === undefined || l.until >= k.tick));
}
/** Does playing this card on this target match a step of the owner's agenda? */
export const matchesStep = (host: WorldHost, s: { card: string; target?: string | null; of?: string | null } | undefined, card: string, target: string | null) =>
  !!s && s.card === card && (!s.target || s.target === target) && (!s.of || belongsTo(host, target, s.of));
/** Does this option serve the current step of the owner's agenda? */
export const serves = (host: WorldHost, m: Mind, card: string, target: string | null) => matchesStep(host, m.agenda[m.agendaPos], card, target);

/** The options the mind chooses among: playable cards, physically feasible, ranked and capped. */
export function optionsFor(host: WorldHost, m: Mind, cap = 12): CardOption[] {
  const k = host.kernel, me = m.soulId; k.tick = host.engine.world.tick;
  const scored: { o: CardOption; score: number }[] = [];
  const perCard = new Map<string, number>();
  const plays = playable(k, me, candidatesFor(host, me)).map((p) => {
    const t = p.target ? k.things[p.target] : null;
    const d = t ? distance(host, me, t.id) : 0;
    let score = 0;
    if (serves(host, m, p.card.name, p.target)) score += 1000;
    if (p.card.name === 'say yes' || p.card.name === 'say no') score += 300;                  // someone is waiting
    if (t && samePlace(k, me, t.id)) score += 40;
    if (t?.kind === 'gathering') score += 25;
    if (!t) score += 10;
    if (p.card.name === 'wait') score += 200;                                                 // always on offer
    score -= Math.min(30, d / 3);
    return { p, t, score };
  }).sort((a, b) => b.score - a.score || (a.p.id < b.p.id ? -1 : 1));
  for (const { p, t, score } of plays) {
    const n = perCard.get(p.card.name) ?? 0;
    if (n >= 3 && score < 1000) continue;                                                     // at most three targets per card
    const b = bind(k, p.card, me, p.target); if (!b) continue;
    const steps = [...p.card.approach, ...p.card.during].map((s) => ({ verb: s.verb, params: resolveParams(host, s.params, b) as Record<string, unknown> }));
    // physical feasibility of the first step, asked of the engine (Mars: verb.plan)
    if (steps.length && host.engine.canPerform({ actor: m.entityId, label: p.card.name, steps })) continue;
    perCard.set(p.card.name, n + 1);
    const label = `${p.card.name}${t ? `: ${describeTarget(host, me, t)}` : ''}`;
    scored.push({ score, o: {
      id: p.id, template: p.card.name, label, goodWhen: p.card.good_when ?? p.card.summary, notFor: p.card.not_for, target: p.target ?? undefined,
      servesIntent: serves(host, m, p.card.name, p.target), steps, durationHint: p.card.takes,
      card: p.card.name, hash: p.card.hash, cardTarget: p.target, approachLen: p.card.approach.length,
    } });
    if (scored.length >= cap) break;
  }
  // If the plan's current step cannot be played yet, waiting is what serves the plan.
  if (m.agenda[m.agendaPos] && !scored.some((x) => x.o.servesIntent)) { const w = scored.find((x) => x.o.card === 'wait'); if (w) { w.o.servesIntent = true; w.o.goodWhen = 'the plan’s next step is not possible yet: stay and wait for it'; } }
  return scored.map((s) => s.o);
}

/** The Soul's social situation in words, for its mind (and for agents through `perceive`). */
export function situationOf(host: WorldHost, m: Mind): { situation: string[]; heard: { who: string; act: string; about?: string; from: string }[] } {
  const k = host.kernel, me = m.soulId; k.tick = host.engine.world.tick;
  const self = k.things[me]; if (!self) return { situation: [], heard: [] };
  const out: string[] = [];
  const name = (id: string) => k.things[id]?.name ?? id;
  for (const g of Object.values(k.things).filter((t) => t.kind === 'gathering')) {
    const mine = linked(k, 'attends', me, g.id), hosting = linked(k, 'hosts', me, g.id), here = samePlace(k, me, g.id);
    if (!mine && !hosting && !here && distance(host, me, g.id) > 40) continue;
    const host_ = linksTo(k, g.id, 'hosts')[0], n = linksTo(k, g.id, 'attends').length;
    const roles = linksTo(k, g.id).filter((l) => !['attends', 'hosts', 'said', 'dancing at'].includes(l.kind)).map((l) => `${name(l.from)} ${l.kind}`);
    out.push(`${g.name} is ${here ? 'here' : `at ${g.at ? name(g.at) : 'somewhere'}`}: hosted by ${host_ ? (host_.from === me ? 'you' : name(host_.from)) : 'nobody'}, ${n} taking part${g.states.music === 'playing' ? ', music is playing' : ''}${roles.length ? `, ${roles.join(', ')}` : ''}${mine ? ' (you are part of it)' : ''}`);
  }
  for (const l of linksFrom(k, me, 'said')) { const d = l.data as { act?: string; about?: string }; if (d?.act === 'ask') out.push(`you asked ${name(l.to)}${d.about ? ` about ${d.about}` : ''} and are waiting for an answer`); }
  for (const l of linksTo(k, me, 'agreed')) out.push(`${name(l.from)} agreed to your request`);
  const heard = linksTo(k, me, 'said').map((l) => { const d = l.data as { act?: string; about?: string }; return { who: name(l.from), from: l.from, act: d?.act ?? 'spoke', ...(d?.about ? { about: String(d.about) } : {}) }; });
  const step = m.agenda[m.agendaPos];
  if (step) {
    const card = k.vocab.cards[step.card];
    const targets = (step.target ? [step.target] : candidatesFor(host, me)).filter((t) => !step.of || belongsTo(host, t, step.of));
    const possible = card && (card.target ? targets.some((t) => !whyNot(k, card, me, t)) : !whyNot(k, card, me, null));
    out.push(`your owner's plan, step ${m.agendaPos + 1} of ${m.agenda.length}: ${step.card}${step.target ? ` (${name(step.target)})` : step.of ? ` (${name(step.of)}’s)` : ''}${possible ? '' : ': not possible yet'}`);
  } else if (m.agenda.length) out.push("your owner's plan is complete");
  return { situation: out, heard };
}

/** For the owner's dashboard: every card in the deck, and whether it can be played now (and on what, or why not). */
export function deckView(host: WorldHost, m: Mind) {
  const k = host.kernel, me = m.soulId; k.tick = host.engine.world.tick;
  const deck = k.decks[me] ?? { cards: [], manners: [] };
  const cands = candidatesFor(host, me);
  const cards = deck.cards.map((n) => k.vocab.cards[n]).filter((c): c is MintedCard => !!c).map((c) => {
    const ok = c.target ? cands.filter((t) => !whyNot(k, c, me, t)) : (whyNot(k, c, me, null) ? [] : ['']);
    const nearest = c.target ? cands.filter((t) => k.things[t].kind === c.target!.kind || c.target!.kind === 'any').sort((a, b) => distance(host, me, a) - distance(host, me, b))[0] : null;
    return {
      name: c.name, summary: c.summary, origin: c.origin, by: c.by === 'world' ? 'world' : (k.things[c.by]?.name ?? c.by), target: c.target?.kind ?? null, plays: host.counts[c.name] ?? 0, wants: c.wants ?? [],
      playableOn: ok.filter(Boolean).slice(0, 6).map((t) => k.things[t]?.name ?? t), playable: ok.length > 0,
      whyNot: ok.length ? null : c.target ? (nearest ? whyNot(k, c, me, nearest) : `there is no ${c.target.kind}`) : whyNot(k, c, me, null),
    };
  });
  return { cards, manners: deck.manners.map((n) => ({ name: n, summary: k.vocab.manners[n]?.summary ?? '' })), agenda: m.agenda.map((s, i) => ({ ...s, targetName: s.target ? (k.things[s.target]?.name ?? s.target) : s.of ? `${k.things[s.of]?.name ?? s.of}’s` : null, done: i < m.agendaPos })), agendaPos: m.agendaPos };
}

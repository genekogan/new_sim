// Applying changes. Deterministic and total: a change either applies or is
// refused with a reason; nothing else can alter the state.
// Coherence rule: an actor changes only itself, what it controls, and things
// nobody controls. Anything shared happens when independent actions fit together.
import { hashOf } from '@sim/engine-contract';
import type { Change, Json, KState, Link, Thing } from './types.ts';

export const linkKey = (kind: string, from: string, to: string) => `${kind}|${from}|${to}`;
export const SAID_TICKS = 20 * 120; // something said stays "just said" for two minutes

export function emptyKernel(): KState {
  return { tick: 0, things: {}, links: {}, vocab: { kinds: {}, links: {}, cards: {}, manners: {} }, decks: {}, nextId: 1 };
}

export class Refused extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code; } }

// ---------------------------------------------------------------- queries
export const linked = (s: KState, kind: string, from: string, to: string): Link | undefined => {
  const l = s.links[linkKey(kind, from, to)];
  return l && (l.until === undefined || l.until >= s.tick) ? l : undefined;
};
export const linksFrom = (s: KState, from: string, kind?: string): Link[] => Object.values(s.links).filter((l) => l.from === from && (!kind || l.kind === kind) && (l.until === undefined || l.until >= s.tick));
export const linksTo = (s: KState, to: string, kind?: string): Link[] => Object.values(s.links).filter((l) => l.to === to && (!kind || l.kind === kind) && (l.until === undefined || l.until >= s.tick));
/** The place a thing is at: itself if it is a place-like container of others, else where it is. */
export const placeOf = (s: KState, id: string): string | null => s.things[id]?.at ?? null;
export const samePlace = (s: KState, a: string, b: string): boolean => {
  if (a === b) return true;
  const pa = placeOf(s, a), pb = placeOf(s, b);
  return pa === b || pb === a || (pa !== null && pa === pb);
};
/** Who controls a thing: Souls with a control-flagged link to it (hosts, holds, made, dj of…). */
export const controllers = (s: KState, id: string): string[] => linksTo(s, id).filter((l) => s.vocab.links[l.kind]?.control).map((l) => l.from);

// ---------------------------------------------------------------- apply
/** Check a change against the coherence rule; throws Refused. `by` is the acting Soul id or 'world'. */
export function check(s: KState, c: Change, by: string): void {
  const world = by === 'world';
  const exists = (id: string) => { if (!s.things[id]) throw new Refused('thing.unknown', `no such thing: ${id}`); return s.things[id]; };
  const mayAlter = (t: Thing) => {
    if (world || t.id === by) return;
    if (t.kind === 'soul') throw new Refused('coherence.other-soul', `${by} cannot change another Soul (${t.name}); ask them instead`);
    const ctl = controllers(s, t.id);
    if (ctl.length && !ctl.includes(by)) throw new Refused('coherence.controlled', `${t.name} is controlled by someone else`);
  };
  switch (c.op) {
    case 'appear': if (s.things[c.id]) throw new Refused('thing.exists', `${c.id} already exists`); if (c.at !== null) exists(c.at); if (c.kind === 'soul' && !world) throw new Refused('coherence.soul', 'only the world brings Souls into being'); break;
    case 'vanish': mayAlter(exists(c.id)); if (s.things[c.id].kind === 'soul' && !world) throw new Refused('coherence.soul', 'a Soul cannot be removed by an action'); break;
    case 'set': mayAlter(exists(c.id)); break;
    case 'move': { const t = exists(c.id); if (c.to !== null) exists(c.to); if (!world && c.id !== by) { if (t.kind === 'soul') throw new Refused('coherence.other-soul', 'a Soul moves only itself'); mayAlter(t); } break; }
    case 'link': {
      exists(c.from); const target = exists(c.to);
      if (!world && c.from !== by) throw new Refused('coherence.link', 'an actor asserts only its own links');
      // Control is taken only over what you made, over a loose thing nobody controls, or when someone who has it agreed.
      if (!world && s.vocab.links[c.kind]?.control) {
        const ctl = controllers(s, target.id);
        const mine = target.by === by, loose = target.traits.loose === true && ctl.length === 0, granted = ctl.some((x) => !!linked(s, 'agreed', x, by));
        if (!mine && !loose && !granted) throw new Refused('coherence.control', `${by} cannot take control of ${target.name}: it was not made by them and nobody who controls it agreed`);
      }
      break;
    }
    case 'unlink': if (!world && c.from !== by && c.to !== by) throw new Refused('coherence.link', 'an actor cuts only links it is part of'); break;
    case 'say': exists(c.from); exists(c.to); if (!world && c.from !== by) throw new Refused('coherence.say', 'an actor speaks only for itself'); break;
  }
}

/** Apply a change (already checked). Mutates `s`. */
export function apply(s: KState, c: Change): void {
  switch (c.op) {
    case 'appear': s.things[c.id] = { id: c.id, kind: c.kind, name: c.name, traits: c.traits ?? {}, states: c.states ?? {}, at: c.at, born: s.tick, by: '' }; break;
    case 'vanish': {
      delete s.things[c.id];
      for (const k of Object.keys(s.links)) { const l = s.links[k]; if (l.from === c.id || l.to === c.id) delete s.links[k]; }
      for (const t of Object.values(s.things)) if (t.at === c.id) t.at = null;
      break;
    }
    case 'set': if (c.value === null) delete s.things[c.id].states[c.key]; else s.things[c.id].states[c.key] = c.value; break;
    case 'move': s.things[c.id].at = c.to; break;
    case 'link': s.links[linkKey(c.kind, c.from, c.to)] = { kind: c.kind, from: c.from, to: c.to, since: s.tick, ...(c.value !== undefined ? { value: c.value } : {}), ...(c.data !== undefined ? { data: c.data } : {}), ...(c.until !== undefined ? { until: c.until } : {}) }; break;
    case 'unlink': delete s.links[linkKey(c.kind, c.from, c.to)]; break;
    case 'say': s.links[linkKey('said', c.from, c.to)] = { kind: 'said', from: c.from, to: c.to, since: s.tick, until: s.tick + SAID_TICKS, data: { act: c.act, ...(c.about !== undefined ? { about: c.about } : {}), ...(c.manner ? { manner: c.manner } : {}) } as Json }; break;
  }
}

/** Apply a batch atomically: all changes pass the check in order, or none apply. */
export function applyAll(s: KState, changes: Change[], by: string): { ok: true } | { ok: false; code: string; message: string } {
  const draft: KState = structuredClone(s);
  try { for (const c of changes) { check(draft, c, by); apply(draft, c); if (c.op === 'appear') draft.things[c.id].by = by; } }
  catch (e) { if (e instanceof Refused) return { ok: false, code: e.code, message: e.message }; throw e; }
  s.things = draft.things; s.links = draft.links; s.nextId = draft.nextId;
  return { ok: true };
}

/** Drop links whose time has passed. Call occasionally; lapsed links are already invisible to queries. */
export function sweep(s: KState): number { let n = 0; for (const k of Object.keys(s.links)) { const l = s.links[k]; if (l.until !== undefined && l.until < s.tick) { delete s.links[k]; n++; } } return n; }

export const kernelHash = (s: KState): string => hashOf({ things: s.things, links: Object.fromEntries(Object.entries(s.links).filter(([, l]) => l.until === undefined || l.until >= s.tick)), decks: s.decks, cards: Object.keys(s.vocab.cards).sort() });

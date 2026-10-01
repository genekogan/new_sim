// The fold: applying one logged event to the world. The world has two parts:
//   the KERNEL (meaning: things, links, vocabulary, decks), which replays from
//   the log alone, and the ENGINE (depiction: bodies, motion), which replays the
//   programs that decisions started. Models never appear here.
// Used identically by the live loop, the restart fast-forward and replay tests.
import type { Engine } from '@sim/engine-contract';
import {
  applyAll, bind, changesOf, emptyKernel, kernelHash, seedVocabulary, whyNot, BASE_DECK, BASE_MANNERS,
  type Change, type KState, type Thing,
} from '@sim/kernel';
import type { BirthPayload, DecisionPayload, DeckPayload, LogEvent, MintPayload, PlayPayload, PlayView } from '@sim/protocol';

/**
 * The words a world began with (kinds, link kinds, manners, base cards), as written into its log.
 * A world's history is replayed with its own vocabulary, never with whatever the code's starting set has since become:
 * changing a base card in the code changes new worlds, and an existing world only when a `rules` event adopts it.
 */
export type Vocabulary = { kinds: KState['vocab']['kinds']; links: KState['vocab']['links']; manners: KState['vocab']['manners']; cards: KState['vocab']['cards'] };
export const baseVocabulary = (k: KState): Vocabulary => ({ kinds: k.vocab.kinds, links: k.vocab.links, manners: k.vocab.manners, cards: Object.fromEntries(Object.entries(k.vocab.cards).filter(([, c]) => c.origin === 'base')) });
export const codeVocabulary = (): Vocabulary => { const k = emptyKernel(); seedVocabulary(k); return structuredClone(baseVocabulary(k)); };
function setVocabulary(k: KState, v: Vocabulary): void {
  Object.assign(k.vocab.kinds, structuredClone(v.kinds)); Object.assign(k.vocab.links, structuredClone(v.links)); Object.assign(k.vocab.manners, structuredClone(v.manners)); Object.assign(k.vocab.cards, structuredClone(v.cards));
}
/** The first vocabulary written into a log, if any: what its genesis kernel started with. */
export const pinnedVocabulary = (events: LogEvent[]): Vocabulary | null => (events.find((e) => e.kind === 'rules' && (e.payload as { vocabulary?: Vocabulary } | null)?.vocabulary)?.payload as { vocabulary: Vocabulary } | undefined)?.vocabulary ?? null;

/** Where Souls arrive: the place the engine tags as its arrival point. */
export const arrivalPlace = (k: KState): string | null => Object.keys(k.things).sort().find((id) => Array.isArray(k.things[id].traits.tags) && (k.things[id].traits.tags as string[]).includes('arrival')) ?? null;

/** A fresh kernel for an engine world: the starting vocabulary plus a place Thing per physical anchor. */
export function initKernel(engine: Engine, pinned?: Vocabulary | null): KState {
  const k = emptyKernel(); if (pinned) setVocabulary(k, pinned); else seedVocabulary(k);
  const anchors = engine.anchors();
  const mk = (id: string, kind: string, name: string, at: string | null, traits: Thing['traits']) => { const r = applyAll(k, [{ op: 'appear', id, kind, name, at, traits }], 'world'); if (!r.ok) throw new Error(`kernel genesis: ${r.message}`); };
  for (const a of anchors) if (a.kind === 'region') mk(a.id, 'region', a.name, null, { ...(a.point ? { point: a.point } : {}) });
  for (const a of anchors) if (a.kind === 'place') mk(a.id, 'place', a.name, a.in ?? null, { ...(a.entity ? { entity: a.entity } : {}), ...(a.point ? { point: a.point } : {}), ...(a.tags ? { tags: a.tags } : {}) });
  return k;
}

const hash32 = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
/** Three starting manners, picked deterministically from the Soul's id until its deck is attuned to its description. */
export const defaultManners = (soulId: string): string[] => { const all = Object.keys(BASE_MANNERS).sort(); const h = hash32(soulId); return [all[h % all.length], all[(h >>> 8) % all.length], all[(h >>> 16) % all.length]].filter((m, i, a) => a.indexOf(m) === i); };

export function soulThing(k: KState, p: BirthPayload, at: string | null): void {
  if (k.things[p.soulId]) return;
  const r = applyAll(k, [{ op: 'appear', id: p.soulId, kind: 'soul', name: p.name, at, traits: { body: p.entityId, about: p.description } }], 'world');
  if (!r.ok) throw new Error(`kernel birth: ${r.message}`);
  k.decks[p.soulId] = { cards: [...BASE_DECK], manners: defaultManners(p.soulId) };
}

/** The most cards a Soul's deck holds. */
export const MAX_DECK = 80;

export type FoldResult = { play?: PlayView; programId?: string; programOk?: boolean; programCode?: string };

/** Apply one logged event to the engine and the kernel. Deterministic; returns what happened for the host's bookkeeping. */
export function foldEvent(engine: Engine, k: KState, e: LogEvent, counts: Record<string, number>): FoldResult {
  k.tick = e.tick;
  switch (e.kind) {
    case 'birth': {
      const p = e.payload as BirthPayload;
      engine.spawnHuman({ id: p.entityId, label: p.name, soul: p.soulId });
      soulThing(k, p, arrivalPlace(k));
      return {};
    }
    case 'decision': {
      const p = e.payload as DecisionPayload;
      if (!engine.world.entities[p.entityId]) return {};
      const r = engine.perform({ actor: p.entityId, label: p.label, steps: p.steps });
      return { programId: r.id, programOk: r.ok, programCode: r.diagnostic?.code };
    }
    case 'play': {
      const p = e.payload as PlayPayload;
      const soul = k.things[p.soulId], card = k.vocab.cards[p.card], target = p.target ? k.things[p.target] : null;
      const view: PlayView = { seq: e.seq, tick: e.tick, soulId: p.soulId, soul: soul?.name ?? p.soulId, card: p.card, target: p.target, targetName: target?.name ?? null, ...(p.manner ? { manner: p.manner } : {}), ok: false, changes: [] };
      const refuse = (reason: string): FoldResult => {
        view.reason = reason;
        // the meaning did not happen, so the depiction should not carry on as if it had
        const body = soul?.traits.body as string | undefined; const pid = body ? engine.programOf(body) : null; if (pid) engine.stop(pid);
        return { play: view };
      };
      if (!soul) return refuse('no such Soul');
      if (!card || card.hash !== p.hash) return refuse('that card is not in the vocabulary');
      if (!k.decks[p.soulId]?.cards.includes(p.card)) return refuse('that card is not in this Soul’s deck');
      const why = whyNot(k, card, p.soulId, p.target); if (why) return refuse(why);
      let changes: Change[], nextId: number;
      try { ({ changes, nextId } = changesOf(k, card, bind(k, card, p.soulId, p.target)!, p.manner)); } catch (err) { return refuse(String((err as Error).message)); }
      const r = applyAll(k, changes, p.soulId);
      if (!r.ok) return refuse(r.message);
      k.nextId = nextId; counts[p.card] = (counts[p.card] ?? 0) + 1;
      view.ok = true; view.changes = changes;
      return { play: view };
    }
    case 'mint': {
      const p = e.payload as MintPayload;
      if (p.kinds) for (const [n, d] of Object.entries(p.kinds)) k.vocab.kinds[n] ??= d;
      if (p.links) for (const [n, d] of Object.entries(p.links)) k.vocab.links[n] ??= d;
      k.vocab.cards[p.card.name] ??= p.card;
      // If someone else minted a different card under this name first, theirs stands and this Soul is not dealt it.
      const same = k.vocab.cards[p.card.name].hash === p.card.hash, d = p.forSoul ? k.decks[p.forSoul] : undefined;
      if (same && d && !d.cards.includes(p.card.name) && d.cards.length < MAX_DECK) d.cards.push(p.card.name);
      return {};
    }
    case 'deck': {
      const p = e.payload as DeckPayload; const d = k.decks[p.soulId]; if (!d) return {};
      for (const c of p.add ?? []) if (k.vocab.cards[c] && !d.cards.includes(c) && d.cards.length < MAX_DECK) d.cards.push(c);
      if (p.remove) d.cards = d.cards.filter((c) => !p.remove!.includes(c));
      if (p.manners) d.manners = p.manners.filter((m) => k.vocab.manners[m]).slice(0, 4);
      return {};
    }
    case 'retire': {
      const p = e.payload as { soulId: string; entityId: string };
      if (engine.world.entities[p.entityId]) engine.removeEntity(p.entityId);
      // what the Soul hosted or made does not outlive it
      const orphans = Object.values(k.things).filter((t) => t.by === p.soulId).map((t) => t.id);
      for (const id of [...orphans, p.soulId]) if (k.things[id]) applyAll(k, [{ op: 'vanish', id }], 'world');
      delete k.decks[p.soulId];
      return {};
    }
    case 'rules': {
      // A world that began before the kernel existed is given one once, and where each Soul was is written into the log,
      // so a replay from genesis arrives at the same kernel.
      const voc = (e.payload as { vocabulary?: Vocabulary } | null)?.vocabulary;
      if (voc) setVocabulary(k, voc);
      const boot = (e.payload as { kernelBootstrap?: { at: Record<string, string | null> } } | null)?.kernelBootstrap;
      if (boot) for (const id of Object.keys(boot.at).sort()) { const at = boot.at[id]; if (k.things[id] && (at === null || k.things[at])) k.things[id].at = at; }
      return {};
    }
    default: return {}; // intent, scene, admin: no effect on engine or kernel
  }
}

/** Pure replay of the log from genesis. Returns the engine and the kernel; neither calls a model. */
export function replayFromGenesis(factory: { genesis(seed: string): unknown; create(world: any): Engine }, seed: string, events: LogEvent[], untilTick: number): { engine: Engine; kernel: KState; counts: Record<string, number> } {
  const engine = factory.create(factory.genesis(seed));
  const kernel = initKernel(engine, pinnedVocabulary(events)); const counts: Record<string, number> = {};
  let i = 0;
  while (engine.world.tick < untilTick) {
    while (i < events.length && events[i].tick === engine.world.tick) foldEvent(engine, kernel, events[i++], counts);
    engine.step();
  }
  kernel.tick = engine.world.tick;
  return { engine, kernel, counts };
}

/** Replay the kernel alone from the log: meaning needs no engine. `places` are the genesis anchors. */
export function replayKernel(genesis: KState, events: LogEvent[]): KState {
  const k: KState = structuredClone(genesis); const counts: Record<string, number> = {};
  const pin = pinnedVocabulary(events); if (pin) { k.vocab = { kinds: {}, links: {}, cards: {}, manners: {} }; setVocabulary(k, pin); }
  const noEngine = { world: { entities: {} as Record<string, unknown> }, spawnHuman() { return ''; }, removeEntity() {}, programOf() { return null; }, stop() {}, perform() { return { id: '', ok: true }; } } as unknown as Engine;
  for (const e of events) if (e.kind === 'birth' || e.kind === 'play' || e.kind === 'mint' || e.kind === 'deck' || e.kind === 'retire' || e.kind === 'rules') foldEvent(noEngine, k, e, counts);
  return k;
}
export { kernelHash };

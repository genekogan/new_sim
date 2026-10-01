// The kernel: the world's grammar. Fixed and small.
//   Thing   anything with an identity (a Soul, a place, a party, a kite)
//   traits  what a thing is forever          states  what it is now
//   at      every thing is somewhere (another thing), or nowhere
//   Link    a named connection between two things
//   Change  the only five things that can happen
// Everything else (kinds of thing, kinds of link, cards, manners) is VOCABULARY:
// open, minted as data, never needed by the kernel to replay history.
import { z } from 'zod';

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export type Thing = {
  id: string;
  kind: string;                      // a vocabulary word: 'soul', 'place', 'gathering', 'dj kit'…
  name: string;
  traits: Record<string, Json>;      // immutable after creation
  states: Record<string, Json>;      // mutable
  at: string | null;                 // id of the thing it is at
  born: number;                      // tick
  by: string;                        // who made it (a thing id, or 'world')
};

export type Link = {
  kind: string;                      // a vocabulary word: 'hosts', 'attends', 'knows', 'said'…
  from: string; to: string;
  value?: number;                    // optional strength
  data?: Json;                       // optional payload (what was asked, what was agreed)
  since: number;
  until?: number;                    // tick after which it lapses
};

/** The five changes. `by` is the Soul (or 'world') whose action caused it. */
export type Change =
  | { op: 'appear'; id: string; kind: string; name: string; at: string | null; traits?: Record<string, Json>; states?: Record<string, Json> }
  | { op: 'vanish'; id: string }
  | { op: 'set'; id: string; key: string; value: Json }
  | { op: 'move'; id: string; to: string | null }
  | { op: 'link'; kind: string; from: string; to: string; value?: number; data?: Json; until?: number }
  | { op: 'unlink'; kind: string; from: string; to: string }
  | { op: 'say'; from: string; to: string; act: string; about?: Json; manner?: string };

export type LinkKind = { summary: string; control?: boolean; mutual?: boolean };
export type Manner = { summary: string };

export type KState = {
  tick: number;
  things: Record<string, Thing>;
  links: Record<string, Link>;                     // key = `${kind}|${from}|${to}`
  vocab: { kinds: Record<string, { summary: string }>; links: Record<string, LinkKind>; cards: Record<string, MintedCard>; manners: Record<string, Manner> };
  decks: Record<string, { cards: string[]; manners: string[] }>;   // per Soul: card names and manner names it holds
  nextId: number;
};

// ---------------------------------------------------------------- cards
// A card is a named action compiled once into: when it is possible, what it
// changes (meaning), and how the engine should show it (depiction).
// References: '$actor', '$target', '$new' (a thing this card made), a derived
// slot name, a literal thing id; suffix '.at' means "the place of".
const ref = z.string().min(1).max(80);
export const condSchema = z.union([
  z.strictObject({ is: z.tuple([ref, z.string()]) }),                                  // thing is of kind
  z.strictObject({ at: z.tuple([ref, ref]) }),                                         // a is at b, or at the same place as b
  z.strictObject({ notAt: z.tuple([ref, ref]) }),
  z.strictObject({ linked: z.tuple([z.string(), ref, ref]) }),
  z.strictObject({ notLinked: z.tuple([z.string(), ref, ref]) }),
  z.strictObject({ noneLinkedTo: z.tuple([z.string(), ref]) }),                        // nobody has this link to x
  z.strictObject({ state: z.tuple([ref, z.string(), z.any()]) }),
  z.strictObject({ notState: z.tuple([ref, z.string(), z.any()]) }),
  z.strictObject({ said: z.tuple([ref, ref, z.string()]) }),                           // from said `act` to to, recently
  z.strictObject({ distinct: z.tuple([ref, ref]) }),
]);
export type Cond = z.infer<typeof condSchema>;

export const stepSchema = z.union([
  z.strictObject({ move: z.tuple([ref, ref]) }),
  z.strictObject({ set: z.tuple([ref, z.string().max(40), z.any()]) }),
  z.strictObject({ link: z.tuple([z.string().max(40), ref, ref]), value: z.number().optional(), data: z.any().optional(), forSeconds: z.number().min(1).max(86400).optional() }),
  z.strictObject({ unlink: z.tuple([z.string().max(40), ref, ref]) }),
  z.strictObject({ say: z.tuple([ref, ref, z.string().max(24)]), about: z.any().optional() }),
  z.strictObject({ appear: z.strictObject({ kind: z.string().max(40), name: z.string().max(80), at: ref, states: z.record(z.string(), z.any()).optional() }), linkFromActor: z.string().max(40).optional() }),
  z.strictObject({ vanish: ref }),
]);
export type Step = z.infer<typeof stepSchema>;

export const cardSchema = z.strictObject({
  name: z.string().min(2).max(60).regex(/^[a-z][a-z0-9 '-]*$/, 'lowercase words'),
  summary: z.string().min(3).max(160),
  good_when: z.string().max(160).optional(),
  not_for: z.string().max(160).optional(),
  // the one free choice: what the card is played on
  target: z.strictObject({ kind: z.string().max(40), same_place: z.boolean().optional() }).nullable(),
  // extra slots computed from links, e.g. host = whoever `hosts` the target
  derive: z.record(z.string().regex(/^[a-z_]+$/), z.strictObject({ link: z.string(), to: ref })).optional(),
  when: z.array(condSchema).max(8),
  then: z.array(stepSchema).min(1).max(8),
  // depiction: what the engine should do. `approach` runs before the changes apply, `during` after.
  approach: z.array(z.strictObject({ verb: z.string(), params: z.record(z.string(), z.any()) })).max(4),
  during: z.array(z.strictObject({ verb: z.string(), params: z.record(z.string(), z.any()) })).max(6),
  // motions the card ideally needs that no engine verb expresses yet (the depiction backlog)
  wants: z.array(z.string().max(40)).max(6).optional(),
  takes: z.enum(['seconds', 'minute', 'minutes', 'long']),
});
export type Card = z.infer<typeof cardSchema>;
export type MintedCard = Card & { hash: string; by: string; mintedAt: number; origin: 'base' | 'compiled' | 'agent' };

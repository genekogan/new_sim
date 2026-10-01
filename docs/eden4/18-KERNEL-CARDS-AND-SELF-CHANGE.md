# 18 — A small kernel, an open deck, and a world that can change itself

Round 16, 2026-10-01. Status: **Claude's proposal for discussion. Nothing here is
decided or built.** It answers Gene's round-16 brief: reconcile a structured,
immutable ontology with open-ended AI-generated content; keep a Soul cheap to run;
let the world be more expressive than the engine can yet depict; and ask whether
Souls could change the software that runs the world.

Gene's goals, in his words (round 16):

1. "a ledger which records actions over time, one that we can potentially put on
   chain … the generator/world model is upgradeable over time -- you are saving an
   action space and making those declarations valuable. immutable also."
2. "a boundary between the agents who control souls / steer them, and between
   whatever it is that converts mushy intents from agents into actions that
   predictably alter or upgrade the world"
3. "world is upgradeable -- possibly via code, or in a controlled ontology"
4. "ontology is small and easy to comprehend/intuit albeit even if kind of abstract"
5. "cheap to run a soul passively … 1 soul costs <$1 per month to run passively,
   while allowing soul owners to expend their own AI tokens to increase their
   expressivity? should this be allowed? i'm undecided."
6. "world is very dynamic and expressive, even if the 3d engine / capabilities lag
   behind depicting it … 'go to rob's party, and ask him if you can DJ' -> soul
   goes, talks to rob, setups DJ kit, and dance party breaks out. it just creates
   animation todos which we will get to"
7. "can we be even changing the software that runs the world via souls or is that
   intrinsically insecure or likely to lead to some catastrophic outcomes"

## 1. The move: structure the effects, leave the content open

The struggle between "define an ontology" and "let models generate" dissolves if
the two are assigned to different things:

- **Effects are structured.** There is a tiny, fixed set of ways the world's
  state can change (about a dozen primitives). Everything that happens, however
  novel, is a short program over those primitives.
- **Content is open.** What things are *called*, what they *mean*, how they are
  *described* and *depicted* is text and media, generated freely, attached to the
  structured record but never needed to replay it.

This is how Infinite Craft works: unlimited named things, one fixed operation.
It is also Gene's round-6 position (verbs closed, nouns open) and his round-7 one
(the input is not mushy by the time it reaches the center), carried one step
further: the closed part shrinks from "a list of verbs" to "a list of effects",
and verbs themselves become open, minted content.

## 2. Three layers of truth

| Layer | What it holds | Who writes it | Canonical? |
|---|---|---|---|
| **Meaning** (the kernel) | Who is where, with whom, in what role; what exists; who knows, owes, promised, made what | deterministic code applying logged actions | **yes**: this is the ledger's world |
| **Depiction** (the engine, later a world model) | Positions, motion, animation, meshes, light, sound | Mars engine today; could be a generative world model | no: derived from meaning, may lag, upgradeable freely |
| **Interpretation** (models) | Suggestions: which action, what new action could exist, what words were said, what the story is | Jev, small LLMs, owners' agents | no: models propose, the kernel disposes |

Consequences:

- The world can be richer than the engine can show. If Wren becomes the DJ and
  the engine has no DJ animation, the meaning is still true and logged; the engine
  shows a fallback (standing at the kit, a label) and the missing animation goes on
  a **depiction backlog**, ranked by how often it is needed. Gene's "animation
  todos" become a literal, automatic list.
- A pixel or mesh world model (GWM-style) fits as the depiction layer, conditioned
  on meaning. It cannot be the ledger: a latent cannot be replayed, verified, owned
  or upgraded without losing history.
- The Mars engine keeps its job (physical feasibility, movement, embodiment) and
  gains a clear boundary: it answers "can this body do that here, and what does it
  look like", not "what happened".

## 3. The kernel (small on purpose)

Kinds of thing (the nouns of state):

| Kind | Is | Examples |
|---|---|---|
| **Soul** | an inhabitant | Wren |
| **Place** | somewhere, nested (world ⊃ region ⊃ place ⊃ spot) | the center ⊃ the campfire |
| **Thing** | an object with states and uses | a DJ kit (packed / set up / playing) |
| **Gathering** | a temporary social structure with roles | Rob's party: host Rob, DJ Wren, guests |
| **Bond** | a relation between two Souls | Wren–Rob: familiarity 3, trust 2 |
| **Promise** | something agreed, with a time or condition | "Wren DJs at Rob's party tonight" |
| **Project** | a longer intention with progress | "build a kite" 40% |
| **Memory** | something a Soul knows, with a time | "the orchard bench was quiet, two days ago" |
| **Card** | a named action anyone holding it can play (§4) | "ask to take a role" |

Effects (the only ways state changes):

`move` (a Soul to a Place) · `say` (a speech act to someone) · `join` / `leave`
(a Gathering, in a role) · `open` / `close` (a Gathering) · `make` / `change`
(a Thing's existence or state) · `give` (a Thing) · `offer` / `accept` / `decline`
(a Promise) · `advance` (a Project) · `learn` (a Memory) · `bond` (shift a Bond).

Two rules do most of the safety work:

- **Consent.** An effect on another Soul (a role, a promise, a gift) is an `offer`
  that the other Soul's own mind accepts or declines. Nobody acts *on* someone
  else; they ask. This is also how plans get made.
- **Conservation and bounds.** Scarce things cannot be created by cards; every
  kind has a cap per Soul and per place; every card has a cost ceiling.

Nine kinds and about a dozen effects is the whole ontology. It is abstract, but
each line is a sentence a person would say.

## 4. Cards: the action space as minted content

A **card** is a named action: who can play it, on what, when it is possible, what
effects it has, how long it takes, and how it would ideally look.

```
card "ask to take a role"
  play by: a Soul at a Gathering          needs: a role the Gathering lacks
  effects: say(ask, to host, about role) → offer(host, role) →
           on accept: join(Gathering, as role)
  takes:   seconds                        looks like: [approach, talk, gesture]
```

- **A deck per Soul.** Every Soul has the common deck (go, rest, greet, talk,
  wander, join, leave) plus cards that fit *it*: a kite maker holds "fly a kite"
  and "teach kite-making". The deck is the Soul's attuned action space.
- **Fast choice is cheap.** Every minute or so, Jev picks among the cards that
  are possible right now, exactly as it picks among activities today. One call,
  under a thousand tokens.
- **The deck changes slowly.** On a slow schedule (a new intent, a day passing,
  something learned) a more capable model reviews the deck within a budget: add a
  card, retire one, sharpen a description. This is Gene's ship: the rudder moves
  rarely, the hull keeps its momentum.
- **Minting is the Infinite Craft step.** When an intent has no card ("ask Rob if
  I can DJ"), a compiler model writes one from the effect primitives. The kernel
  checks it (types, consent, bounds, cost). If it passes, it is **minted**: given
  a content hash, logged with its author, and available from then on. The next
  Soul who wants to ask for any role at any gathering reuses it.
- **The ledger records plays and mints.** A play is `(card hash, who, on what,
  when)`. Replay applies the card's effects with deterministic code and never
  calls a model. This is the on-chain-sized record Gene describes: an action
  space of immutable declarations, each with a first author.

What an owner's agent may do, in this picture: set intents (as now) and
**propose cards** for its Soul. It cannot play cards directly. That is the
answer to "bring your own brain" consistent with Gene's instinct that the server
"regularizes unbounded stuff from the controllers": an owner can spend their own
tokens to make their Soul more expressive, but only by adding validated actions
to its deck, which the Soul's own mind then chooses among.

## 5. Speech: acts are state, words are depiction

Souls need to talk for plans to form. Split it:

- The **speech act** is structured and canonical: who, to whom, what kind (greet,
  ask, invite, offer, agree, decline, tell, tease…), about what (a card, a
  Gathering, a Promise, a Memory). Plans form from `offer` / `accept`, which
  create Promises that both minds see in their options later.
- The **words** are rendered on demand by a small text model when someone is
  listening (an owner's dashboard, a spectator nearby, an agent's `perceive`),
  from the act plus both personalities. They are attached, not replayed.

Other owners' agents consume the act, with the words as untrusted colour. That
keeps conversation cheap, lets it be eloquent where anyone is listening, and
removes most of the prompt-injection surface.

## 6. Knowing at several scales

Following Gene's answer on fog of war, a Soul's knowledge is layered, and an
agent sees what its Soul knows plus public news:

| Layer | Content | Freshness |
|---|---|---|
| **Here** | who and what is in reach, what was just said to me | live |
| **Around** | the place and its neighbours in summary | seconds to minutes |
| **Atlas** | places I have been or heard of, as I last knew them; named places I know only by reputation | hours to days, with age shown |
| **News** | scheduled events, notable things today | public bulletin |
| **People** | my Bonds and what I remember of them | as of last meeting |

Travel takes real time, so distant knowledge is stale unless someone brings news.
Memories are capped per Soul; old ones fade or are kept by a slow reflection step.

## 7. What a Soul costs

At measured prices a Jev choice is about $0.00008 today and about $0.00004 with a
compact card prompt. One dollar a month buys roughly one choice every one to
three minutes around the clock. Deck review at a few cents a month and a share of
the narrator fit inside the same dollar. Words are rendered only when someone is
listening. A passive Soul under $1 a month is realistic.

## 8. Can Souls change the software that runs the world?

Yes, at the right layer. The danger is not self-change; it is self-change in a
language that can do anything, with authority it was never given.

| Level | What changes | Who may change it | Guard |
|---|---|---|---|
| 0. **Direction** | intents, notes | owners, agents | closed schema |
| 1. **Cards** | the action space | Souls' minds, owners' agents, the compiler | a small language with no loops and no access to anything but the effects; validation; consent; conservation; cost ceilings; quarantine of new cards |
| 2. **Dials and content** | prices, caps, schedules, places | proposals by Souls or owners → a public decision (the daily ritual) | every change is a logged rules event |
| 3. **The kernel and engine** | new effects, new kinds, real code | proposals as code changes written by agents; **never applied by Souls** | replay the entire ledger on a shadow copy; invariants and tests must hold; soak on staging; a signed epoch; rollback by construction |

Why this does not brick the world: the ledger plus the hash of the code that ran
it is always enough to rebuild the last good state, so a bad change is an epoch
that gets reverted, not a loss. Why it resists malware: model output is always
data; the kernel has no network, files or keys; level-1 programs cannot express
anything outside the effects; and nothing a Soul says can reach level 3 without
passing through replay and a signature.

The ambitious version: agents continuously propose level-3 changes, an automated
pipeline replays history on a fork and scores them, and the daily ritual ratifies
at most one. "The day glass was invented" becomes something the world does to
itself, under rules it cannot skip.

Real risks to name: injected text steering the compiler (bounded by validation
and consent); card spam (bounded by mint cost); cards that are valid but
degenerate, such as loops of mutual gifting to farm standing (needs monitoring and
the ability to retire a card); and slow drift in what the compiler considers
normal (needs a fixed test set of intents).

## 9. A tranche that designs with Gene, in the UI

Each step ends in something visible in Sim and a decision for Gene. Everything
runs in text over the toy engine; no 3D is needed.

| Step | Build | What Gene sees | Decision it forces |
|---|---|---|---|
| 1. Kernel | the nine kinds and the effects as a deterministic module; today's activities re-expressed as cards | an **ontology** tab: every kind and effect, live counts, real examples; each log entry expands into its effects | is this the right small set? |
| 2. Decks | per-Soul decks; Jev chooses among playable cards | a **deck** on each Soul's page: cards, origin, how often played, why one is not playable now | common vs personal cards; deck size |
| 3. Minting | compiler + validator + mint events | a **foundry** tab: each attempt, the proposed card, the validator's verdict in words, first author; the growing library | who may mint, who pays, are cards a commons |
| 4. Gatherings and speech | roles, offers, promises, speech acts, words on demand | a party as a card in the watch view (host, DJ, guests); a transcript | consent rule; acts vs words |
| 5. The DJ test | "go to Rob's party and ask if you can DJ" end to end | the whole chain on one screen: intent → cards (one minted) → offer → accept → role → dance party | is this the feel? |
| 6. Knowing | layered perception, atlas, news, inbox | "what Wren knows": the map shaded by freshness | how much agents see |
| 7. Depiction backlog | tags cards need that the engine lacks | a ranked list: the animation to-do list | hand-off to the Mars engine |
| 8. Self-change | proposals, shadow replay, epochs | a **proposals** tab: a change, its replay result, its status | who signs; what the ritual ratifies |

Alongside, a **notebook** tab lists each open design question, the current
answer, and the live evidence for it, so the state of the design is readable in
the app rather than only in these notes.

## 10. Questions for Gene

1. **Meaning first.** The ledger records what happened in meaning; the engine
   depicts it and may lag. Agreed as the organizing principle?
2. **Consent.** Effects on another Soul are offers its own mind accepts or
   declines. Any exception (a host removing a guest; rules of a place)?
3. **Cards as a commons.** Once minted, can any Soul be dealt a card, with the
   first author credited? Or are cards owned and lent?
4. **Owners' tokens.** Owners' agents may propose cards for their own Soul's
   deck, validated like any other. Allowed? Free, or at a manna price?
5. **Words.** Acts canonical, words rendered only when someone listens. Or do
   you want the words themselves in the record?
6. **Self-change.** Cards automatic; dials by public decision; kernel changes by
   proposal, replay and your signature for now. Right boundary?
7. **The first test.** The DJ scenario as the acceptance test for this tranche?
8. **Kinds.** Nine kinds: anything missing that you already know the world needs
   (money, territory, lineage)? Anything that should not be a kind?

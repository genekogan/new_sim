# 18 — A small kernel, an open deck, and a world that can change itself

Rounds 16–18, 2026-10-01. Status: **sections 3, 4 and 5 are built and running**
(Sim repo, `packages/kernel`, tested on the toy engine and on the Mars engine);
sections 6 and 8 are still proposals. Section 3 was rewritten after Gene's
round-17 correction (the first draft's nine kinds were vocabulary, not
fundamentals), and sections 4, 5, 9 and 10 were brought up to what was built and
what running it with live models taught. How this compiles down to the Mars
engine is in [`19-MARS-BRIDGE.md`](19-MARS-BRIDGE.md).

It answers Gene's round-16 brief: reconcile a structured, immutable ontology with
open-ended AI-generated content; keep a Soul cheap to run; let the world be more
expressive than the engine can yet depict; and ask whether Souls could change the
software that runs the world.

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

## 3. The kernel: a grammar, not a list of nouns

Gene, round 17: "promise, card, gathering, bond? these feel not *fundamental* as
time, position, identity, motion, immutable attributes, intents." He was right.
The first draft listed nine kinds of thing; all of them were vocabulary. What is
fundamental is smaller:

| Fundamental | In the kernel | |
|---|---|---|
| identity | a **Thing**: an id, a kind (a word), a name, who made it | Wren; the campfire; Rob's gathering |
| immutable attributes | a Thing's **traits** | Wren's description; a place's spot on the ground |
| mutable attributes | a Thing's **states** | music: playing |
| position | a Thing's **at**: another Thing | Wren is at the campfire, which is in the center |
| relation | a **Link**: a kind (a word), from one Thing to another, optionally with a lifetime | Rob *hosts* the gathering; Wren *asked* Rob |
| time | the **tick**, and lifetimes on links | an agreement stands for thirty minutes |
| motion, and every other event | five **changes** | below |

The five changes are the only ways state can alter:

| Change | Says |
|---|---|
| `appear` / `vanish` | a thing comes to exist, or stops |
| `set` | one state of one thing takes a value |
| `move` | a thing is now at another thing |
| `link` / `unlink` | a relation begins or ends |
| `say` | someone says an act (greet, ask, agree, decline, invite, tell, chat) to someone, about something |

Everything else is **vocabulary**, and vocabulary is open: kinds of thing
(gathering, DJ kit, kite), kinds of link (hosts, attends, knows, dj of), manners
(warmly, shyly), and cards. A gathering is a Thing whose kind is the word
"gathering"; a promise is a link; a bond is a link; a role is a link. None of
them is known to the kernel's code. The way to hold it in mind: **the grammar is
fixed, the vocabulary is open, and an action is a sentence**: who, in what manner,
which card, on what.

### One rule: an actor acts only for itself

Gene on consent, round 17: the state "has to be somehow emergent from their
combined conceptions… coherent global state as a result of otherwise discorded
actions." So the rule is about coherence, and it is one rule:

> An actor changes only itself, what it controls, and what it made. Anything
> shared happens because separate actions fit together.

Precisely:

- A Soul can move, set states on and speak for **only itself**. No change can
  target another Soul.
- A link must start from the actor.
- A thing that is not a Soul can be changed by whoever **controls** it (holds a
  link whose kind is marked as giving control: hosts, made, holds, dj of). If
  nobody controls it, only its maker can. Places the world made are nobody's to
  change.
- A control link can be taken only on something the actor made, or when someone
  who already controls the thing has **agreed**.
- What was said, asked and agreed exists only because it was said. Saying "ask"
  leaves an open question until it is answered; saying "agree" is what creates an
  agreement. No card can write or erase these directly.
- Bounds: a Soul may have 24 things of its making and 400 links at a time.

Joint outcomes therefore emerge. Wren becomes the DJ at Rob's party through four
separate plays by two Souls: Rob hosts, Wren asks, Rob says yes, Wren takes the
role (which the world allows only because the host agreed). Nobody acted on
anyone.

## 4. Cards: the action space as minted content

A **card** is a named, reusable action:

```json
{ "name": "ask to be the dj",
  "summary": "Ask the host of a gathering to let you play the music",
  "target": { "kind": "gathering" },
  "derive": { "host": { "link": "hosts", "to": "$target" } },
  "when":   [ { "at": ["$actor", "$target"] }, { "noneLinkedTo": ["dj of", "$target"] },
              { "notLinked": ["asked", "$actor", "$host"] } ],
  "then":   [ { "say": ["$actor", "$host", "ask"], "about": "being the DJ at $target.name" } ],
  "approach": [ { "verb": "walk_to", "params": { "to": "$host", "standoff": 1.3 } } ],
  "during":   [ { "verb": "wave", "params": { "at": "$host", "seconds": 2 } } ],
  "wants": ["hand gesture while asking"], "takes": "seconds" }
```

`when` is conditions on the kernel; `then` is a short list of the five changes;
`approach` and `during` are how the body shows it (before and after the changes
take effect); `wants` names motions the engine lacks. The full grammar is served
at `/cards.md` and is the compiler's prompt.

What is built:

- **A deck per Soul**, starting from fifteen base cards (go to, rest, wait,
  wander, greet, talk with, chat, say yes, say no, host a gathering, join, leave,
  end the gathering, perform, dance), plus three **manners** chosen to suit its
  description (one small Jev call at birth).
- **A plan is an agenda of cards.** An owner's wish becomes an ordered list of
  steps, each a card and optionally a target, or `of` someone for a thing that
  does not exist yet ("Rob's party" before it starts).
- **Minting.** When the vocabulary lacks a card, a compiler model (Haiku) writes
  one. It is checked (grammar; the one rule; link kinds declared; a card that
  changes its target must say where the right comes from; the engine's verbs;
  size) and, if valid, minted: hashed, logged with its author, added to a shared
  library and dealt to the Soul. Owners' agents can propose cards the same way,
  with no model involved.
- **The ledger records plays and mints.** A play is (card hash, who, on what, in
  what manner). Replay applies the card's changes with deterministic code and
  calls no model. The kernel replays from the log **without any engine**. Checked
  on the live world on 2026-10-01: 11,939 events replayed in 35 ms and reproduced
  the running server's kernel hash exactly.
- **Three tiers decide.** *Reflex* (code, free): a question is answered before
  anything else; when cards serve the owner's plan the Soul chooses only among
  them; a Soul that asked waits for the answer. *Mid-brain* (Jev, ~$0.0001): a
  real choice among several cards, with manner and pace. *Compiler* (Haiku,
  ~$0.01): only when an owner states a wish.
- **Looking one step ahead.** If the plan's next step cannot be played, any card
  that would bring it closer serves the plan (go there, join, end what stands in
  the way). Nobody writes travel. A step that cannot be played is passed over
  when a later one can; a plan impossible for ten minutes is given up and noted.

What running it with live models taught (each is now a rule in the code):

| Seen | Rule |
|---|---|
| Two Souls replied to each other's small talk for ever | one talking play is a whole exchange; a pair does not start another for two minutes |
| An asker wandered off before the answer | whoever asked waits; whoever was asked answers first |
| A host left their own party to chat elsewhere | hosts talk to who is there |
| "Rob's party" was bound to a party Rob only attended, or to an invented id | "his" means he hosts, made or holds it; unknown ids become `of` |
| A compiled card set the music without holding any right to | refused at minting, with the reason given back to the compiler |
| A later remark overwrote an unanswered question | a question is its own link until answered |
| An impossible choice was retried every two seconds | a failed option is not offered again for a minute |

## 5. Speech: acts are state, words are depiction

Built as proposed. The **act** (greet, ask, agree, decline…) and what it is about
are kernel state and drive what can happen next. The **words** are written
afterwards by a small model from the act, the two personalities and the manner,
saved beside the record and never replayed. One play of a talking card renders a
short exchange in both voices.

Gene chose on-demand rendering "while I can." It costs about $0.002 an exchange,
so the speech budget goes first to questions, answers and Souls with owners;
small talk between natives is rendered by a model only while someone is watching,
and otherwise gets a plain line.

Still open (Gene: dialogue is the hardest part): whether a Soul can say something
*new* that becomes state (a promise with content, a rumour, a name for a place),
and how what was said is remembered beyond two minutes.

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

Measured on 2026-10-01 with live models (eight Souls, the DJ story, three
minutes): a mid-brain choice $0.00009; a reflex decision nothing; attuning
manners at birth $0.00003; an exchange of words $0.002; compiling a wish $0.007
to $0.012 (about 7,700 input tokens, a third of that when the prompt is cached).
One dollar a month still buys a choice every one to three minutes around the
clock, and reflexes now take many decisions for free. The two costs that scale
with people are words and wishes, and both are metered per tier.

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

## 9. Where the tranche stands

| Step | State | Where to see it |
|---|---|---|
| 1. Kernel | **built** | `grammar` tab: things, links, vocabulary; every play as a sentence with the changes it made |
| 2. Decks | **built** | `my soul`: plan, manners, each card and whether it can be played now, and why not |
| 3. Minting | **built** (compiler, validator, agent proposals) | `grammar`: the card library, click a card for its conditions and changes. A list of failed compile attempts is in the `brain` tab, not yet a foundry view |
| 4. Gatherings and speech | **built** | `watch`: overheard; `my soul`: what was said |
| 5. The DJ test | **passes**: by agenda with a fake brain (toy and Mars), and from two plain wishes with live models on the Mars engine | `apps/server/src/sync.test.ts`, `mars.test.ts` |
| 6. Knowing | not built | still section 6 |
| 7. Depiction backlog | **built** | `grammar`: animation to-do, ranked by how often cards wanted a motion |
| 8. Self-change | **first step built**: a world's base vocabulary is written into its own log, replay starts from it, and adopting a newer set is a logged `rules` event (level 2 of section 8). Proposals, shadow replay and epochs are not built | `adopt_vocabulary` in the admin API |
| Notebook | **built** | `notebook` tab: six open questions beside live evidence |

## 10. Gene's answers (round 17) and what is open now

1. **Meaning first:** yes.
2. **Consent:** reframed as coherence: the state must emerge from separate
   actions. Built as the one rule in section 3.
3. **Cards:** "each soul has its own cards." Built as a personal deck over a
   shared library.
4. **Owners' agents proposing cards:** "would be fun and powerful." Built.
5. **Words:** dialogue is the hardest part; on-demand for now.
6. **Self-change boundary:** fine as proposed.
7. **The DJ scenario as the acceptance test:** yes. It passes.
8. **Money:** not yet.

Open now, in the order they will bite:

1. **Scenes.** Several bodies in one motion (a class, a meal, carrying a beam)
   against a kernel where each acts only for itself. Proposal in doc 19.
2. **Retiring and revising cards.** Nothing can be un-minted. Who may retire a
   card; can a card be improved without changing what past plays meant?
3. **Things that last.** A card can make a thing; only "with another thing" ends
   it. Do made things decay, get owned, get traded?
4. **Locality.** Any card can target anything anywhere; only its own conditions
   stop it. Should reach be a default rule?
5. **Memory.** `said` fades in two minutes and `knows` is for ever. Section 6.
6. **Cost of wishes.** A cheap matcher for wishes that existing cards already
   cover, keeping the compiler for new ones.

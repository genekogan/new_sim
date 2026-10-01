# The brain

Tiers and helpers in `apps/server/src/brain.ts`, with request builders in
`packages/brain`. Every call is recorded (`brain_calls`) with its exact request,
response, what was applied, latency, tokens and cost, and shown in the web app.
Design background: `../eden4/14-MVP-TECHNICAL-SPEC-DRAFT.md` §5 and
`../eden4/18-KERNEL-CARDS-AND-SELF-CHANGE.md`. Measured costs are in `../STATUS.md`.

| Tier | Model | When | Output |
|---|---|---|---|
| **Reflex** | none (code) | at a Soul's think time, when code already knows the answer | a `decision` event by `brain:reflex` |
| **Mid-brain** | Jev `jev-1.13.0` | per Soul: on arrival, new intent, plan advanced, spoken to, activity ended or failed, narrator beat, or a timer it sets itself | a `decision` event by `brain:mid` |
| **Narrator** | `NARRATOR_MODEL` (Claude Haiku 4.5) | per region, about every 5 min ± 30 s, staggered; skipped if the region is empty | up to 4 beats → `scene` events |
| **Director** | Jev | every 6 s while at least one client is connected; a shot is held ≥10 s | broadcast `ShotSpec` + ticker lines |
| **Compiler** | `COMPILER_MODEL` (default: the narrator model) | an owner or agent sends a wish | `mint` and `deck` events, then an `intent` event with an agenda |
| Attune | Jev | at birth; admin action `attune` | a `deck` event setting three manners |
| Speech | `TALK_MODEL` (default: the narrator model) | a play in which a Soul says something to a Soul | spoken lines (`talks`, `talk` message); not state |
| Translator | Jev, Haiku fallback | a wish when the compiler is not used | an `intent` event with a goal |
| Shot | Jev | owner asks for a cinematic shot | a `ShotSpec` |

Call tiers as recorded (`BrainCall.tier`): `mid` (also reflex, with model `reflex`
and no cost), `attune`, `narrator`, `director`, `compile`, `talk`, `translate`, `shot`.

Jev (TypeSafe System One) returns typed judgments, never text: Choice, Score, Noul.
Prompts follow its docs: one narrow judgment per question, backticked state paths,
a condition on every option, numbers as words, user text as data. The larger
models are used only through one forced tool call (`llm.ts` `callTool`).

## Options

A Soul chooses among cards, not engine activities. `deck.ts` `optionsFor` takes
every (card, target) the Soul can play now (`playable`), drops any whose first
verb step the engine says is infeasible, and ranks them: serving the owner's plan
first, then answering a question, then `wait`, then targets in the same place,
gatherings and near things. At most three targets per card and twelve options.

An option **serves the plan** when it matches the plan's current step: the first
remaining agenda step that could be played on some target now. If no option does,
any play that brings that step closer (one-step lookahead, `enablers`) serves it.
If nothing does, `wait` is marked as serving. A successful play that matches the
current step moves the plan to the step after it, passing over earlier steps that
could not be played. A plan that nothing but waiting has served for ten minutes
is given up.

## Reflex

Before any model call, `evaluate` decides what code already knows:

1. **Someone asked this Soul something** (a `say yes` / `say no` option exists):
   only those answers remain. If `say yes` serves the plan, it is taken. If there
   is no model budget now, the answer is drawn in code, yes two times in three.
   Otherwise the mid-brain chooses between yes and no.
2. **Options serve the plan**: only those remain. If there is exactly one, it is taken.
3. **The Soul asked someone here and has no answer yet**: it plays `wait`.

A reflex choice is logged as a `decision` with the manner drawn by hash from the
Soul's manners. If the Soul is already doing exactly that, nothing is logged and
it thinks again in ten seconds.

## Mid-brain

1. One request per Soul. **State**: `world {time, weather, happening}`, `soul {name,
   about, intent, owner_note?, energy, where, doing_now, recently, situation?}`,
   `nearby[]` (≤8, from the engine's `describeSurroundings`), optional
   `said_to_you[]` (act, about, and the rendered words if any) and
   `storyteller_suggests`. `situation` comes from the kernel: gatherings and their
   hosts, open questions, agreements, the plan's current step.
2. **Questions** in the same request:
   - `next` (Choice): which option; each option has `what`, `good_when`, `not_for`,
     and `serves_intent: true` when it serves the plan.
     Option names are readable slugs mapped back to ids in code.
   - `pace` (Score, 3 situation levels) → next think in 10 / 45 / 150 s, but not
     sooner than the chosen card's floor (8 / 20 / 30 s by its `takes`).
   - `sociable` (Noul).
   - `manner` (Choice over the Soul's manners), when it holds more than one.
   - `keep_going` (Noul), only while a program is running and the trigger is not
     urgent.
3. **Policy** (`interpretMid`): `keep_going ≥ 0.7` → continue. Otherwise take the top
   option if its probability ≥ 0.6 (with an unfinished plan) or ≥ 0.8 (without);
   else sample, seeded by `soulId:tick`, among options with p ≥ 0.05 inside the
   top-0.9 nucleus. Options rated near zero are never picked. The manner is the
   top one if its probability ≥ 0.7, else sampled with a separate draw. Mood is
   derived in code from energy, sociability and pace.
4. The choice is logged as a `decision` event with its verb steps, card, target,
   manner and `approachLen`. The sampling RNG is separate from the world RNG.

**Urgent triggers** are `new-intent`, `plan-advanced` and `spoken-to`: the question
is "what now?", so `keep_going` is not asked and a busy Soul does not sit out a
budget shortage.

Scheduling: at most 8 calls in flight; due Souls are served urgent triggers first,
then ended or failed activities and arrivals, then narrator beats, then timers;
within a class, whoever was served longest ago. A call is skipped when nothing the
model would see has changed. If the budget does not allow a call, a busy Soul
waits and an idle Soul (or one with an urgent trigger) takes a deterministic
default that still honours the plan. An option that just failed is not offered
again for a minute.

## Compiler (`compile.ts`, `Brain.compile`)

A wish in plain words becomes an agenda of cards, minting what the vocabulary lacks.

- **Prompt.** The cached system prompt is `COMPILER_PREAMBLE` (the rules and four
  worked examples) plus `cardGrammar(verbs)`, the same text served at `/cards.md`
  (about 14,000 characters on the toy engine). The user part (`compileUser`) lists
  the Soul, the wish, the cards in its deck, the rest of the library, the link kinds
  and kinds, and every known thing with its id. User-written text is flattened to
  one line and cannot open or close a tag.
- **Output.** Forced tool `compile`: `{ understood, reason?, agenda[≤8] {card, target,
  of?}, new_cards[≤4], new_links?, new_kinds? }`.
- **Checks before anything is minted.** Each new card goes through `validateCard`.
  The agenda must be non-empty; each step's card must exist; a target must be a
  known id of the kind the card needs; `of` must be a known id. When the wish
  names whose thing it is ("Rob's party"), a target that is not that Soul's is an
  error.
- **Repairs without asking again.** An invented target id becomes `target: null`
  with `of` set to the Soul the wish names (if any). A target that belongs to
  someone other than the Soul the wish names is replaced the same way.
- **One retry.** If problems remain, they are sent back once. A second failure
  returns the first problem as the reason.
- **Result.** Valid new cards are minted with origin `compiled`, agenda cards the
  Soul lacks are dealt, and `souls.command` sets the intent with the wish as `text`.
- **Limits.** Not available in fake mode or without an Anthropic key. Charged to
  the `user` share. Each owner gets 12 compiles per hour (`souls.ts`).

**Minting** (`Brain.mint`) uses no model. It takes at most four cards per call,
accepts new link-kind and kind names of lowercase letters and spaces (2 to 40
characters, never a speech link), validates each card, and logs a `mint` event per
new card. An agent's proposal is minted with origin `agent`. If two different
cards claim one name, the first logged stands.

## Attune

A new Soul starts with up to three manners picked by a hash of its id. `attune`
asks Jev one Noul per manner in the vocabulary ("would this Soul often act in
this manner?"), keeps the best three and logs a `deck` event by `brain:attune`.
It is skipped in fake mode, over budget, or when the mid-brain share is empty.

## Speech (`talk.ts`, `Brain.speak`)

The act is state: a `say` change writes the `said` link (and `asked`, `agreed`).
The words are depiction. After each successful play, every `say` to a Soul is
rendered: the model gets both descriptions, the manner, the act, `about`, the
place and the last four lines between the two, and returns up to four alternating
lines for `chat`, one line for any other act. Lines are saved to `talks`,
broadcast as `talk`, and the latest line is passed to the listener's mind as
`said_to_you[].words`.

**Priority rule.** A model call is made only in live mode, with an Anthropic key,
under the hard cap, with budget in the `talk` share, and when either

- it matters: the act is `ask`, `agree` or `decline`, or one of the two Souls has
  an owner (is not native); or
- it is small talk between natives, at least one client is connected, and the
  `talk` bucket is more than half full.

Otherwise, and when the call fails, `plainLine` writes a fixed sentence for the act.

Asking and answering wake the listener: after a `say` other than `chat` or `tell`,
the Soul spoken to thinks again within a second or so (trigger `spoken-to`).

## Narrator

Cached system prompt (world description, beat rules, six worked examples; about
15,400 characters, stored once in `prompts`) plus a per-region digest: places, the
Souls present (description, intent without the owner's words, mood, energy),
recent events, neighbouring regions, previous summary. Forced tool call
`plan_region` returns a summary and beats `{at_min 0–5, kind scene|group|soul,
directive, targets, flavor}`. Directives (closed): `gathering, converse, perform,
rest, wander, disperse, follow, quiet`. Invented targets are dropped. When a beat
fires it becomes a `scene` event; targeted Souls get it as `storyteller_suggests`
for one think, and may decline.

The narrator runs once per region the engine reports (`engine.anchors()` of kind
`region`) and finds a region's Souls with `engine.regionAt`. The toy engine has
two regions (center, ring); the Mars adapter has one (`grounds`).

## Director and ticker

Candidates are built in code (frame the campfire group, follow the most active
Souls, a two-shot of a conversation, wide shots) as Mars `ShotSpec` values; Jev
picks one or `hold`. In the same request, one Noul per recent event decides
whether it becomes a ticker line (the line is passed as data).

## Translator

Used for a wish when the compiler is unavailable or the owner's hourly compiles
are used up. `goal` (Choice over the eight goals + `unsure`, each with `what /
not_for / examples`), `target` (Choice over nearby entities, all fixtures, regions,
+ `none_of_these`), `names_target` and `actionable` (Nouls). Rejected when `unsure`,
not actionable, goal confidence < 0.55, or a needed target is missing; then one
Haiku pass with a tool schema; else "not understood". The goal is turned into an
agenda of base cards (`API.md`).

## Spend governor (`governor.ts`)

`BRAIN_BUDGET_USD_PER_DAY` (default 0.5) is split into shares (`SHARES`): `mid` 30%
(mid-brain and attune), `narrator` 15%, `director` 5%, `user` 30% (compile,
translate, shots), `talk` 20%. Each share is a token bucket refilled continuously.

- **Capacity**: one hour of refill, and never less than three typical calls of
  that tier, so a tier whose call costs more than an hour of its refill can still run.
- **Start**: `user` and `talk` start full; the others start with 15 minutes of
  refill (or one typical call, if that is more).
- **Rule**: a call runs only if its bucket covers the tier's typical cost, a
  running average that starts at $0.00008 (mid), $0.004 (narrator), $0.00005
  (director), $0.008 (user), $0.0006 (talk). The actual cost is charged afterwards.

A rolling 24-hour hard cap (counted since the current budget was set) is the
backstop. `BRAIN_MODE=fake` replaces Jev and the narrator with deterministic
stand-ins of the same shape, turns the compiler and attune off, writes speech
with `plainLine`, and costs nothing. The `spend` tab (admin) shows actual and
projected cost; `spend_hourly` keeps exact totals after call bodies are pruned.

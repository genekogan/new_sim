# The brain

Three tiers plus two helpers, in `apps/server/src/brain.ts` with request builders
in `packages/brain`. Every call is recorded (`brain_calls`) with its exact request,
response, what was applied, latency, tokens and cost, and shown in the web app.
Design background: `../eden4/14-MVP-TECHNICAL-SPEC-DRAFT.md` §5.

| Tier | Model | When | Output |
|---|---|---|---|
| Reflex | none (the engine) | every tick | runs the current activity |
| **Mid-brain** | Jev `jev-1.13.0` | per Soul: on arrival, new intent, activity ended or failed, narrator beat, or a timer it sets itself | a `decision` event |
| **Narrator** | Claude Haiku 4.5 | per region, about every 5 min ± 30 s, staggered; skipped if the region is empty | up to 4 beats → `scene` events |
| **Director** | Jev | every 6 s while at least one client is connected; a shot is held ≥10 s | broadcast `ShotSpec` + ticker lines |
| Translator | Jev, Haiku fallback | an owner types a command | an `intent` event |
| Shot | Jev | owner asks for a cinematic shot | a `ShotSpec` |

Jev (TypeSafe System One) returns typed judgments, never text: Choice, Score, Noul.
Prompts follow its docs: one narrow judgment per question, backticked state paths,
a condition on every option, numbers as words, user text as data.

## Mid-brain

1. The engine enumerates feasible activities with parameters bound
   (`enumerateActivities`) and describes surroundings in words (`describeSurroundings`).
2. One request per Soul. **State**: `world {time, weather, happening}`, `soul {name,
   about, intent, owner_note?, energy, where, doing_now, recently}`, `nearby[]` (≤8),
   optional `storyteller_suggests`.
3. **Questions** in the same request:
   - `next` (Choice): which option; each option has `what`, `good_when`, `not_for`,
     and `serves_intent: true` when the engine knows it is what the intent asks for.
     Option names are readable slugs mapped back to ids in code.
   - `pace` (Score, 3 situation levels) → next think in 10 / 45 / 150 s, but not
     sooner than the chosen activity's floor (8 / 20 / 30 s by its duration hint).
   - `sociable` (Noul).
   - `keep_going` (Noul), only while an activity is running and the intent is not new.
4. **Policy** (`interpretMid`): `keep_going ≥ 0.7` → continue. Otherwise take the top
   option if its probability ≥ 0.6 (with an owner intent) or ≥ 0.8 (without);
   else sample, seeded by `soulId:tick`, among options with p ≥ 0.05 inside the
   top-0.9 nucleus. Options rated near zero are never picked. Mood is derived in
   code from energy, sociability and pace.
5. The choice is logged as a `decision` event with its verb steps. The sampling
   RNG is separate from the world RNG.

Scheduling: at most 8 calls in flight; due Souls are served owner intents first,
then whoever was served longest ago. A call is skipped when nothing the model
would see has changed. If the budget does not allow a call, a busy Soul waits and
an idle Soul takes a deterministic default that still honours its intent.
Measured: ~1,900 input tokens, ~220 ms, ~$0.00008 per call.

## Narrator

Cached system prompt (world description, beat rules, six worked examples; ~4,500
tokens, stored once in `prompts`) plus a per-region digest: places, the Souls
present (description, intent without notes, mood, energy), recent events,
neighbouring regions, previous summary. Forced tool call `plan_region` returns a
summary and beats `{at_min 0–5, kind scene|group|soul, directive, targets, flavor}`.
Directives (closed): `gathering, converse, perform, rest, wander, disperse, follow,
quiet`. Invented targets are dropped. When a beat fires it becomes a `scene` event;
targeted Souls get it as `storyteller_suggests` for one think, and may decline.
Measured: ~$0.003 per plan with the cache warm.

## Director and ticker

Candidates are built in code (frame the campfire group, follow the most active
Souls, a two-shot of a conversation, wide shots) as Mars `ShotSpec` values; Jev
picks one or `hold`. In the same request, one Noul per recent event decides
whether it becomes a ticker line (the line is passed as data).

## Translator

`goal` (Choice over the eight goals + `unsure`, each with `what / not_for /
examples`), `target` (Choice over nearby entities, all fixtures, regions, +
`none_of_these`), `names_target` and `actionable` (Nouls). Rejected when `unsure`,
not actionable, goal confidence < 0.55, or a needed target is missing; then one
Haiku pass with a tool schema; else "not understood".

## Spend governor (`governor.ts`)

`BRAIN_BUDGET_USD_PER_DAY` (default 0.5) is split: mid 50%, narrator 30%, director
10%, user-triggered (translate, shots) 10%. Each share is a token bucket refilled
continuously, holding at most one hour of refill, starting at 15 minutes' worth.
A call runs only if its tier's bucket covers the tier's typical cost. A rolling
24-hour hard cap (counted since the current budget was set) is the backstop.
`BRAIN_MODE=fake` replaces every model with deterministic stand-ins of the same
shape and costs nothing. The `spend` tab (admin) shows actual and projected cost;
`spend_hourly` keeps exact totals after call bodies are pruned.

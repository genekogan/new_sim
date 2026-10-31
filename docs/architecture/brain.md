# Minds and the model budget

## Who thinks

`MIND_DRIVER` chooses who decides what Souls do (`apps/server/src/config.ts`).

- **`edge` (default).** Each Soul's mind runs in its owner's own coding agent, at the owner's cost. The world runs no
  Soul decisions, speech rendering, reflection or camera director, and makes no model calls for Souls
  (`Brain.afterTick` returns at once). The world's job is admission and truth: it checks every action against the
  engine and reports what actually happened. See [Souls](souls.md).
- **`central`.** The world's own brain (`apps/server/src/brain.ts`, request builders in `packages/brain`) chooses for
  each Soul. It is kept for test suites and for a future driver of world-owned characters. Its tiers are below.

Launcher worlds run with `BRAIN_MODE=fake` and no provider keys (`tools/world-launcher/children.mjs`).

## The central driver

Souls choose among **cards**: playable (card, target) options built by `deck.ts` from the kernel. A choice becomes a
`decision` event; when its approach steps finish, a `play` applies the card's kernel changes under the coherence rule.

| Tier | Model | Output |
|---|---|---|
| Reflex | none (code) | a `decision` when code already knows the answer (answer a question, the single option that serves the plan) |
| Mid-brain | Jev (TypeSafe System One: typed Choice / Score / Noul judgments) | the next option, pace, manner |
| Narrator | `NARRATOR_MODEL` (default Claude Haiku 4.5) | regional beats as `scene` events |
| Director | Jev | the broadcast camera shot and ticker lines |
| Compiler | `COMPILER_MODEL` (defaults to the narrator model) | a wish in plain words → an agenda of cards, minting missing ones |
| Speech | `TALK_MODEL` (defaults to the narrator model) | words for a `say`; depiction only, never state |
| Attune, translator, reflection, shot | Jev / narrator model | manners, a goal from a wish, a private journal, an on-demand shot |

Every call is recorded in `brain_calls` with its request, response, latency, tokens and cost. Larger models are used
only through one forced tool call (`packages/brain/src/llm.ts`). Replay never calls a model.

**Fake mode.** `BRAIN_MODE=fake` replaces Jev and the narrator with deterministic stand-ins of the same shape, turns the
compiler and attune off, writes speech with fixed sentences and costs nothing. Use it for local worlds and tests.

## The model budget

Each world has a rolling 24-hour budget for paid model calls: `BRAIN_BUDGET_USD_PER_DAY`, default **$0.50**, capped
at **$1** (`apps/server/src/thinking-budget.ts`). An operator may raise the ceiling to $3 only for an explicitly
authorized Eden-core world (`WORLD_THINKING_CEILING_USD_PER_DAY=3` plus matching world settings); a request can never
raise it.

- **Reserve before calling.** Before each provider call, its worst-case cost (known model, input and output bound) is
  reserved in the durable `paid_costs` table (`Db.reserveCost`). If the last 24 hours of reservations plus this one
  exceed the budget, the call is refused. Unknown prices are refused.
- **Settle after.** Valid usage settles the reservation to the actual cost. Missing or uncertain usage keeps the full
  reservation. Restarts, trace pruning and budget changes never reset the window.
- **Pacing.** `governor.ts` splits the daily budget into per-tier token buckets (`mid` 30%, `narrator` 15%, `director`
  5%, `user` 30% for compile/translate/shots, `talk` 20%) that refill continuously, so spend spreads over the day. The
  buckets pace; the reservation ledger enforces.

The admin `spend` view shows actual and projected cost; `spend_hourly` keeps exact totals after call bodies are pruned.

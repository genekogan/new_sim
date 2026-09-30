# 11 — State and update formalism (frontier one)

Round 7, 2026-09-28. Gene: "worldprompt split into two things: the AI outer
layer (edge agents producing high-level intents towards the next state,
simultaneously) … and then the deterministic controller which resolves
actions into the next game state." Claude's refinement below: three
layers, with intents (not verbs) as the canonical unit. Proposal, not
decided.

## Three layers

| Layer | Who runs it | Deterministic? | Logged? |
|---|---|---|---|
| **Edge agents** → intents | owners (Claude, ChatGPT, Codex, a DAO, a human) and governance keys | no | yes: the intent is the event |
| **Policy** → verbs each tick | the sequencer, as versioned code | yes | no: derived |
| **Engine** → next state | the sequencer, as versioned code | yes | no: derived; state roots committed |

Why intents and not verbs are the unit:
- Bodies are always on and owners are mostly absent. A standing intent keeps
  a body alive for a year on one message; a verb stream would need a model
  at the center for every idle body.
- The log stays small and human-readable ("4102: follow Kalama").
- Neutrality: the center never interprets language. Edge agents translate
  natural language into a small structured intent; the center only validates.
- Replay: verbs are recomputed from intents + state, so they never need
  storage and can't drift.

## The log

An append-only, totally ordered sequence of events. Five kinds:

```
Event = { seq, tick, kind, author, payload, sig }
kind ∈ { birth, intent, ingest, econ, rules }
```

- **birth**: name, description, body asset hashes (mesh, rig, capability
  map), sale price. Whenever a body is bought (round 8; was one per day).
- **intent**: `subject` (a body id, or `scene`), the intent payload (below).
  Author must be the body's owner key, or a governance key for `scene`.
- **ingest**: a new noun. GLB hash + affordances (footprint, support type,
  sockets, seats, surfaces, grip slots, material tags) + license/provenance.
  Or a media item (image/video/audio hash). Validated, never judged.
- **econ**: price set (self-assessed premium), buyout, tip, grant,
  treasury action. Manna balances live in state, derived from these plus
  the UBI rule.
- **rules**: "from tick N, rules vK" + hash of the code (engine + policy +
  catalog schema) + a migration from state shape K-1 to K.

Ticks are assigned by the sequencer when it accepts the event. Authors sign;
the sequencer orders. Anyone can verify the order is consistent with the
committed roots.

## The fold

```
S_0            = genesis(rules v1)
I_t            = standing intents after applying log events with tick ≤ t
                 (a map body → intent, plus scene → intent)
verbs_t        = P_k(S_t, I_t)         policy, rules version k in force at t
S_{t+1}        = E_k(S_t, verbs_t, events_t)   engine: verbs + births/ingests/econ
root_{t}       = hash(S_t)   committed every N ticks
```

- `rng` is inside `S`, so the fold is pure.
- A rules event at tick N: `S_N ← M_k(S_N)`, then continue with `P_k, E_k`.
- Replaying from t=0 with all pinned versions yields the same roots. This is
  the `03` versioned-rules principle, now with a concrete shape.

## The intent payload (Q22: keep it small)

```
Intent = {
  goal:     one of a short closed list (wander, go, follow, attend, gather,
            build, place, tend, converse, perform, rest …),
  target:   entity id | body id | region id | event id | null,
  params:   goal-specific, bounded (a build plan hash, a media hash, a mood),
  until:    tick | condition (event ends, target moves, manna < x) | null,
  fallback: Intent | null
}
```

- Exactly one standing intent per body at all times. Birth installs the
  default (`wander` + `attend` births + `follow` peers).
- Replacing it is steering. *(Round 8: the age-rising price is withdrawn;
  Claude's lean is a flat price plus a fairness rate limit, `13` §3.)*
- High-framerate steering = a high replacement rate, sequenced by tick and
  priced per replacement. Nothing else changes.
- Infeasible intents never error: the policy falls through to `fallback`,
  then to the default. A body is always valid.
- Free text never enters the log. The owner's agent does the translation.
  That is the "interpreter at the edges" of `03`, made precise.

## Scene intents

Same payload, `subject = scene`, goals like `weather`, `time`, `event`,
`birth_ritual`, `festival`, `grow_ground`. Authors are governance keys:
the treasury, the ritual contract, later a citizens' vote. Which key may set
what is a rules question (Q23), not a new mechanism.

## The policy

- v1 is hand-written: priorities, pathing, attendance, simple sociality
  (follow, converse, campfire). The Mars engine's `ambient_wander`, `gather`,
  `converse`, `campfire_circle` are its seeds.
- Later a learned policy (intent + local state → verb) can replace it as a
  rules upgrade **if** it's deterministic and pinned (fixed weights, integer
  or reproducible inference). That's the honest route to a "world model
  player" without breaking replay.

## The sequencer's job (Eden, today)

1. Accept, validate and order events; assign ticks.
2. Run the fold continuously (the background tick the engine lacks).
3. Commit roots and publish the log, rule bundles and assets to permanent
   storage.
4. Serve state to renderers (three.js today; splats or video models later).

If Eden stops, anyone with the log, the bundles and the assets can do 1–4.
Who is *allowed* to is Q2.

## What this settles and what it opens

Settles (if adopted): Q1 gets a shape (verbs closed, nouns open, intents
canonical); Q5 (birth is a logged event); Q7/Q8 collapse into one object;
`03`'s replay claim becomes concrete.

Opens: Q22 (the goal list), Q23 (scene keys), and a new one:
- Q26. Tick assignment fairness: when many agents steer at high rate, does
  the sequencer order by arrival, by a per-body rate limit, or by price?

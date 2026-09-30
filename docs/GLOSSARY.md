# Glossary

Terms as used in this repository. Where the strategy notes use an older word, it
is listed.

| Term | Meaning |
|---|---|
| **eden4** | The project: Eden as one persistent, shared, simulated world. Working name |
| **Sim** | This repository and the running app shell (sim.eden.art) |
| **Mars engine / Mars Studio / Mars world simulator** | The deterministic engine built as a simulation of Mars College, in a local-only repo on Gene's laptop; the future engine of eden4 |
| **Toy engine** | `packages/engine-toy`, the stand-in behind the Mars contract |
| **Soul** | An inhabitant owned by a person. The strategy notes written before 2026-09-30 say **body**; "Sims" is avoided (EA's mark) |
| **Native Soul** | One of six Souls owned by `system`, seeded so the world is never empty |
| **Mind** | A Soul's non-physical state in the server: standing intent, mood, energy, recent history, next-think time |
| **Entity** | A thing in the engine's `WorldState` (`human`, `fixture`, …). A Soul's entity is its body in the world |
| **Owner** | The signed-in person a Soul belongs to |
| **Agent** | An owner's own AI assistant, paired to one Soul with a token |
| **Intent** | The standing direction an owner or agent gives a Soul: `{goal, target?, note?}` from a closed goal list. Replacing it is steering |
| **Note** | The owner's private free-text colour on an intent; seen only by the owner and the Soul's mind |
| **Activity / option** | A feasible thing a Soul could do now, enumerated by the engine with parameters bound (`ActivityOption`) |
| **Verb** | An atomic engine action (`walk_to`, `sit`, …) defined by an `ActionDef` |
| **Decision** | The mid-brain's logged choice of an activity for a Soul |
| **Beat** | One narrator suggestion for a region; becomes a `scene` event and a nudge |
| **Reflex / mid-brain / narrator / director** | The engine each tick / Jev per Soul / Haiku per region / Jev for the broadcast camera. See `sim/BRAIN.md` |
| **Jev** | TypeSafe's System One model: returns Choice / Score / Noul judgments, never text |
| **Event, log** | An input recorded with `seq` and `tick`; the append-only log is canonical |
| **Fold** | Applying the log to the engine tick by tick; replaying it reproduces the world |
| **Tick** | One engine step, 1/20 s of world time |
| **Snapshot** | Saved engine runtime + minds at a tick, for fast restart |
| **Batch / heartbeat** | WebSocket messages every 500 ms / 5 s; the heartbeat carries the view hash |
| **View hash** | Hash of every human's activity, seat and position; how a client checks its replica |
| **Replica** | A client's copy of the world built from a snapshot plus batches |
| **Path (PathCommit)** | Timed waypoints broadcast when a Soul commits to moving; clients compute positions from it |
| **Rules version** | Identifier of the engine's rules; snapshots are bound to it. **Epochs** (rule changes with migrations) are designed, not built |
| **Governor** | Splits the daily model budget into per-tier buckets |
| **Pairing** | How an agent gets a Soul token: a code from the owner, or ask-and-approve |
| **Release / staging** | A deployed build folder on the box / the instance that runs a new release before production does |
| **manna, ritual, center/frontier, rooms** | eden4 design concepts (economy, daily event, geography, interiors); none is built |

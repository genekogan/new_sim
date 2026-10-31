# Stage B spike — can the Soul read path leave the tick thread? (lane L9, 2026-10-31)

Branch `lane/srv-split-20261031` off main `da5269cd0`. Prototype only (`apps/server/src/split/**`); no production path
changes. Plan: `team/PLAN-SCALE-20261031.md` §2 Stage B; design `team/scratch/server-reliability-20261031/scalability-design.md`
§2.6. Line numbers are anchors at `da5269cd0` unless a lane branch is named.

## 1. The read path's engine dependencies

### 1.1 Shape of the read path

All five reads funnel into one function. `here`, `around`, `observe`, `capabilities` and `resolve` each call
`EdgeLedger.binds()` (`edge/ledger/ledger.ts` 612–755, the whole menu) at least once:

| Read | Route (`edge/routes.ts`) | Calls `binds()` via | Other engine reach |
|---|---|---|---|
| `capabilities` | 57 | `capabilities()` 760 | — |
| `here` | 65 → `hereFrame` (`edge/perception/here.ts` 211) | `seats()` 69 (`coreA.binds`), `exits` 252 (`ledger.capabilities`), `doHere` 279 | `routeProblem()` per exit (`ledger.ts` 588 → `engine.canPerform`), `engine.programOf/programAction` + `runtime.records` (here.ts 217–220, 61, 138), `takenSeats` over `runtime.records` (61) |
| `around` | 67 → `aroundFrame` (`perception/around.ts` 17) | `walks` 32 | **writes**: `K.find()` persists found secret places and calls `invalidateBodies()` (around.ts 24–25) |
| `observe` | 56 → `ledger.observe` 1695 | `doHere` 1720, `include=capabilities` 1737 | `programOf/programAction` 1697 |
| `resolve` | 68 → `intents.dryRun` (`edge/intents/intents.ts` 346) | vocabulary over `binds()` caps; `resolveOnDemand` 1761 re-runs the activity listing under `readPassV1` (1805–1811) | — |

So "the read path" is, in cost and in dependencies, **`binds()` plus a thin perception layer around it**. Whatever answers
`binds()` off-thread answers all five reads; nothing smaller does (here's seats, exits and doHere are cuts of the menu).

### 1.2 Every dependency, classified

(a) pure function of replicable state · (b) spatial query a replicated nav grid / per-cell table can answer ·
(c) needs the live engine's private state (programs, runtime, planner).

| # | Dependency | Where (file:line) | Class | Why / what a worker would need |
|---|---|---|---|---|
| 1 | Body pose, yaw, `human.activity/baseActivity/level/gaze/attention/together.group`, `body.family` | here.ts 32, 225, 234; ledger.ts 627, 1565, 1609–1620 | a | per-tick body deltas |
| 2 | `host.minds` (soulId↔entity, name), `faded` set, `publicNameMetadata`, `profileFact` | ledger.ts 1611; here.ts 235, 263 | a | mind table + changes (rare) |
| 3 | Places registry `places.containing/byId/ref`, `enclosureAtPoint`, `spots.interiors`, `placeLevel` (`engine.placeLevelV1`) | ledger.ts 1577–1608; places.ts | a | static per epoch; `placeLevelV1` is a static table |
| 4 | `perceivedBodies` (enclosure rule, radius) | ledger.ts 1609 | a | bodies + places; per-cell index makes it O(neighbourhood) |
| 5 | Sightline `clearSight` over `world.navV1.solids` | here.ts 37–41, geometry.ts | a | static solids per epoch (per-cell bucket) |
| 6 | Campfires (scan of **all** entities, 150 m), regions within 60 m | ledger.ts 676–690; here.ts 83–86 | a | static/entity layer; per-cell index removes the O(world) scan |
| 7 | Comms objects (`comms.objects.all()`), placed items (`together.publicItems()`), conversations (`coreA.conversations()`), fading status | here.ts 91–108, 230, 239; ledger.ts 1702 | a | object table snapshot + deltas (L8's in-memory table), items/conversations from sqlite (read-only WAL connection works from a worker) |
| 8 | Receipts `openReceipts()` (sqlite), receipt-claimed seats/spots, bikes out | ledger.ts 399, 1421, 718; here.ts 62, 216 | a | sqlite WAL reader in the worker, or receipt deltas |
| 9 | Live sit holds: `runtime.liveIds()` + `runtime.records` (sit params) | here.ts 61, 137; human-capabilities.ts 111 (`seatOccupancyIssue`) | a | runtime record deltas (verb, actor, fixture/slot, live) — engine state but plain data |
| 10 | `programOf(entity)` + `programAction` + its runtime record (`endsIn`) | here.ts 217–220; ledger.ts 1697 | a | program/action deltas (plain data) |
| 11 | Kernel: `host.engine.anchors()`, `kernel.things`, `describeVerbs()`, `rulesVersion`, `engineRef` | human-capabilities.ts 15–40; deck.ts | a | static per epoch/rules; anchors change only on god edits |
| 12 | Births query (`events` table) for meals | human-capabilities.ts 44 | a | sqlite read |
| 13 | Knowledge `knows/marked/scales/memory` (sqlite) and `secretOffer` filter | knowledge.ts; ledger.ts 753 | a | sqlite read |
| 14 | Clock (`clockAt`), weather (`weatherNow`, `env.weather`), lightning, floors (`floorsNear`) | here.ts 213–214, 268, 270 | a | tick + env deltas; floors static per epoch |
| 15 | Carrier state: `aboard`, `stepOutRefusal`, `rideStandRefusal`, `carriersNative` | ledger.ts 1279–1305, 735–741 | a | carrier entity deltas |
| 16 | `nativeSeatLevelsV1(fixture)` | here.ts 71 → engine.ts 685 | b | static fixture/level table |
| 17 | `clearSpotsV1(polygon, 5)` — stroll loops, nav spots | ledger.ts 767; god/nav.ts 728 | b | static nav grid per epoch (results already memoised per epoch) |
| 18 | `clearanceUpToV1/clearanceAtV1` — bank loops, activity spots, together placement | ledger.ts 776–779, 1428; together.ts 154, 174, 187 | b | nav clearance grid per epoch + **dynamic bodies** (clearance counts bodies) |
| 19 | `nearestStandableV1` — activity `open()`, together, nav | ledger.ts 1429; together.ts 252; engine.ts 2050 | b | same grid + bodies |
| 20 | `readPassV1(fn)` wrapper (planner sync once per listing) | ledger.ts 688–691, 790, 1810 | b | the worker's own grid is already synced: a no-op there |
| 21 | `navEpochV1()` (syncs the planner to read the epoch) | god/nav.ts 719; ledger.ts 592 | b | the static epoch carried in the delta |
| 22 | `navCheckV1/navWarmV1` — "a raised room no stair reaches" cut | god/nav.ts 674 | b | connectivity table per epoch |
| 23 | **`engine.canPerform(program)`** in the listing: `rest`, `eat`, swim, non-deferred goals; registered activity cards | human-capabilities.ts 23, 48; deck.ts 101–161 | **c** | engine.ts 801–: reads `this.programs` (readiness, construction crews, safe-stop, physical replacement of the running action), carriers, gait/body rules, then the planner (`plan()`) incl. routes. Plain data in the engine snapshot, but the logic is ~1,000 lines of engine; only the engine code computes it |
| 24 | **`routeProblem(soul, cap)` → `engine.canPerform`** for each `here` exit | ledger.ts 588–599 (memo per nav epoch × 0.5 m × cap) | **c** | the planner's route search over the live nav (paged windows). Memo means a worker needs it only on a miss |
| 25 | God-world reach checks `offerWalk` (`blocked` set, nav cut) | god/nav.ts 668–730 | b/c | blocked set is computed on the tick thread by perception; replicable as data |
| 26 | `activityCapabilities(spots, aw)` | activities.ts (0 engine calls) via the `activityWorld` adapter ledger.ts 1414–1445 | a+b | **already the right pattern**: pure over an interface of closures (clearance, open, taken, seat, enterable, clock) |
| 27 | `around`'s `K.find()` + `invalidateBodies()` | around.ts 24–25 | **write** | not a read: must become an intent (or a worker-side "found" set merged into the ledger at a tick boundary) |
| 28 | Every route returns `tick: host.engine.world.tick` | routes.ts 57–68 | a | the read model's tick (lag ≤ 1 batch) |

**Counts.** `ledger.ts` reaches `host.engine.*` 133 times (world 39, programOf 17, canPerform 15, clearanceUpToV1 10,
nearestStandableV1 10, clearanceAtV1 8, runtime 7, readPassV1 6, …); `human-capabilities.ts` 20, `deck.ts` 13,
`god/nav.ts` 9, `here.ts` 7, `together.ts` 4; `activities.ts`, `places.ts`, `vocabulary.ts`, `around.ts` 0.
Most of the 133 are in the act path (`act`/`actOnce`/`decide`, 837–1220); the read path's are rows 1–28.

### 1.3 What this means (early signal, sent to main after this step)

- The assumption "every Soul read is answerable from a replicated read model with no engine access" is **true only if
  the read model contains the engine's own code**. Rows 1–15 (a) are plain data and replicate cleanly. Rows 16–22 (b)
  are the engine's spatial service over the static nav grid **plus bodies**; that code (`mars/viewer/engine/spatial`) is
  shared TS that already runs in the browser, so a worker can run it, but it must be fed the same static scene and body
  positions. Rows 23–24 (c) are `canPerform`: the engine's admission and planner over its private programs/runtime. A
  hand-written read model cannot answer them without re-implementing the engine.
- So the replicated read model must be **an engine replica in the worker** (the viewer protocol already does exactly
  this for browsers: snapshot + input batches → a lockstep engine), with the ledger's read code running unchanged
  against a read-only `host` facade. Per-32 m-cell indexes are an optimisation *inside* that worker (rows 4, 6, 7),
  not a replacement for the engine.
- One read is not a read: `around` persists finds (row 27).
</content>
</invoke>

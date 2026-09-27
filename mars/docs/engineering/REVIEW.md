# Engine review — 2026-09-27

Independent review of `viewer/engine/` against SPEC §8, §10–§13, §16, §22–§23, §31 and
`ENGINE_GUIDE.md`. Scope: runtime, actions, history, spatial, locomotion, carry,
construction, sequence, take, rehearsal, api, `simulation/engine-room.ts`. No code was
changed. Findings are ranked by severity. Each has a file:line, a concrete failure
scenario, and a suggested fix.

**Proofs.** Six findings are reproduced by small scripts in `/private/tmp/review-proofs/`
(run with `node <file>.ts`, Node 26 strip-types). They drive the real engine through
`createRegistry()` + `ENGINE_INVARIANTS`, the same configuration the controller and the
Durable Object use. The output quoted under each finding is verbatim.

---

## Critical — physically impossible outcomes with zero violations

### C1. A mid-carry replan can start from the heading-flipped pose, so every carrier teleports to the opposite end of the load
`carry/actions.ts:224-231` (construction replan) and `:259-265` (bystander replan).

The replan passes `starts: [here, {…here, th: here.th + π}]` to `planCarry`, then calls
`applyFormation(rt, ex, r.traj.poses[0])`. When the planner picks the flipped start (it
costs 0, while reversing or rotating in place is expensive), `carrierSpots` at `th+π`
mirrors every carrier through the load centre. On a 12 ft beam that is a 3 m jump in one
tick, and the two carriers pass through each other. The invariants see nothing. The
entity frame is flipped too, so `carryIntegrity` finds no grip drift. No invariant looks
at per-tick displacement.

Proof (`p2-carry-flip.ts`): a carry heads +x. At tick 130, construction drops a U of
`test-wall` blocks ahead, open behind the crew.
```
tick 130 phase move load x 1.01
tick 131 phase replan: max carrier displacement this tick 3.02 m (2.48,-0.38) (-0.45,0.38) prev (-0.45,0.38) (2.48,-0.38)
status completed  violations 0 []
```
Fix: mid-carry, only replan from the current heading (`starts: [here]`), or make the
flip a real motion. The flip would be an in-place 180° rotation, or a set-down → regrip,
swept like any other primitive. Also add a generic invariant: per-tick displacement of
any human or carried entity ≤ `k·vmax·DT`. It catches every teleport class.
```ts
const r = planCarry({ g, f: p.f, starts: [here], goals: [p.target], … });
```

### C2. A person holding up an upright can be assigned to `carry`, walks away, and the frame stays standing "held" by nobody
`carry/validate.ts:97-103` has no `holdingDiagnostic`. `carry/actions.ts:154-158` calls
`walkTo.start` directly, which skips walk_to's own `actor.holding` guard.
`construction/invariants.ts:12` accepts any `support.kind === 'held'` without checking
who is actually gripping.

`raise_upright` completes with the crew holding: `support: held by [p1, p2]` and
`grip` set. The runtime then releases their `actor:` reservations, which is by design,
because release_support must reserve them later. Every other verb refuses holders.
`carry` does not. It gathers p1/p2, overwrites their grip with the carried item, and
carries the load 12 m away.

Proof (`p1-holder-carry.ts`):
```
raise: completed A.support = {"kind":"held","by":["p1","p2"]} p1.grip = {"entity":"A","slot":"hold-0"}
walk_to p1 (guarded): actor.holding
carry submit: executing
carry: completed
A: phase placed pitch 0 support {"kind":"held","by":["p1","p2"]}
p1 at 9.1,0.0,7.6 grip undefined activity idle — distance to A 11.9 m
violations: 0 []
```
Fix, in two parts:
```ts
// validate.ts, crew loop
const hd = holdingDiagnostic(w, id); if (hd) return bad(hd);
// new invariant: every component with support.kind==='held' has each `by` human gripping it (and vice versa)
for (const c of e.support.by) if (ents[c]?.human?.grip?.entity !== e.id) out.push({ code: 'support.holder-absent', … });
```
The same invariant also catches the reverse state: a person with `grip` set but no
holder relation.

### C3. Walkers pass through carried loads; no invariant checks humans against carried loads
`locomotion/walk.ts:478-498` (`encounter`) and `:393-403` (`intrusion`) only consider
humans. `runtime/invariants.ts:31-44` checks human against human. `carry/invariants.ts:48-51`
checks the load only against static geometry.

`carry.pathBystander` halts the crew when someone is ahead. It cannot stop a walker who
crosses the gap between the two carriers, because the walker's lateral test ignores the
carriers, who are 1.46 m away along the beam. The walker walks through the beam at waist
height.

Proof (`p6-walker-through-load.ts 3.0 3`): p3 walks (6, 3) → (6, −3) across a carry
heading +x.
```
walk p3: executing
carry completed | closest p3 body-centre to load cover disc edge: -0.05 m at tick 245 (< 0.28 ⇒ body inside the load envelope; < 0 ⇒ centre inside)
violations 0 []
```
Fix: add an invariant for non-crew humans against `worldDiscs(f, q)` load discs, which
pairs with C1's displacement invariant. In `encounter`/`intrusion`, treat the carried
entities' load discs as moving obstacles: wait, don't cross.
```ts
for (const e of carried) for (const d of worldDiscs(f, entityFrame(e).q)) if (d.d.part==='load')
  for (const h of humansNotIn(e.support.by)) if (dist(h, d.p) < d.d.r + HUMAN_RADIUS - TOL) out.push({ code: 'collision.human-load', … });
```

---

## High

### H1. Failure paths skip cleanup: state leaks and child actions outlive their parents
The runtime's `finish()` (`runtime/runtime.ts:182-191`) only drops reservations. Each
action's `step` returns `failed` without undoing what `start` did:
- `construction/raise.ts:75-77, 87, 92` leaves `phase: 'reserved'`, `reservedBy` set, and
  the pose canonicalised.
- `beam.ts:79, 88, 93, 96`, `deck.ts:150/158, 262/269`, `stairs.ts:213/220, 286/293`
  leave `phase: 'reserved'`.
- `carry/actions.ts:170, 188` (gather failed/stuck): the crew keeps `task` and
  `activity: 'walk'`, the item keeps `reservedBy`, and the other gatherers' narrow-passage
  and stair entries stay in `rt.services.traffic`. Every later walker in that run then
  yields to a ghost (`traffic.yield` forever).
- `walk.ts:229` (`route.invalidated`) leaves `human.task` and `activity`.
- When a child fails at step time, `childrenState` (`children.ts:23-26`, used by
  `raise.ts:92`, `beam.ts:93`, `access.ts:194`) fails the parent but never cancels the
  siblings. They keep walking with no parent.

Also, none of the construction verbs check station reachability at plan time. So
"station unreachable" is a normal, reachable failure.

Proof (`p4-fail-leak.ts`): a post stands on hold station 2. raise_upright is accepted,
then fails at tick 1, and the frame can never be carried again.
```
submit: executing
raise: failed raise.station-unreachable | A.phase reserved A.reservedBy a1 | live children? a2:cancelled a3:failed
later carry of A: failed carry.item-unavailable - A is reserved (support ground); only items lying on the ground can be picked up
```
Fix: give `ActionDef` an optional `abort(rt, exec)` that the runtime calls from
`finish()` for `failed` (and before `cancelled`). Implement it per verb: restore the
entity phase and `reservedBy`, clear `task`/`activity`, call `releaseAll` for walks.
Cascade-cancel live children of any finished parent in `finish()`. Move the station
route checks (`walkCrew` targets) into `plan()`.
```ts
private finish(l, status, d) { if (status !== 'completed') l.def.abort?.(this, l.exec);
  for (const r of this.records.values()) if (r.parent === l.rec.id && this.live.has(r.id)) this.cancel(r.id); … }
```

### H2. walk_to accepts an unstandable goal (0.35 m snap tolerance) but drives the body to the raw goal; the action "completes" in collision
`spatial/path.ts:53, 171` (`pts.push(goal.p)`) and `:178-180`. The comment there says
unstandable endpoints are dropped, but the code only removes duplicates. The start point
has the same problem, at `:156`. Also `walk.ts:327`: the fallback `p = base` never
checks the base point itself.

Proof (`p3-walk-goal.ts`): wall face at x = 4.9, goal x = 4.75.
```
walk_to: completed final 4.750 0.000 grid clearance there 0.15 m (radius 0.28)
violations 6 [ 'collision.human-static' ]
```
The invariant catches it, but the planner accepted an impossible goal and the verb
reports success. Fix: end the final leg at the snapped cell centre, or project the goal
onto the clearance ≥ r region. Report the actual arrival point in `outputs`.
```ts
pts.push(g.clearance[cellOf(gg, goal.p)] >= r ? goal.p : centreOf(gg, gt));
```

---

## Medium

### M1. `controller.call` validates input outside its try/catch; deeply nested JSON throws instead of returning a result
> **Fixed 2026-09-27.** Validation now runs inside the guarded region, behind an iterative `checkInputBounds` pre-check (nesting > 32 or serialized size > 256 KiB → `{ ok: false, code: 'input.invalid' }`); a throwing `safeParse` also maps to `input.invalid`. Test: `api: pathological inputs (5,000-deep nesting, 1 MB array) return input.invalid instead of throwing`.

`api/controller.ts:169` (`safeParse` before `try` at `:171`). Nesting depth is only
bounded by the stack: the recursive `json` schema is at `sequence/types.ts:59-61`,
`bindings` is `z.unknown()`, and `stableStringify`/`structuredClone` are recursive too.

Proof (`p5-deep-json.ts`):
```
1000 → returned false plan.invalid
5000 → THREW RangeError Maximum call stack size exceeded
20000 → THREW RangeError Maximum call stack size exceeded
```
The MCP wrapper in `engine-tools.ts` catches this, so today's impact is limited. Any
other host that trusts "call never throws for engine-level failures" crashes. Fix: move
`safeParse` inside the `try`. Cap depth and size: reject request bodies over ~1 MB at the
worker, and give `json` a depth-limited refinement plus string `.max()`.

### M2. Cancelling walk_to mid-stair leaves the person idle, floating on the stair
> **Fixed 2026-09-27.** A cancel during the `climb` phase of a link leg is now deferred: the walker continues (or backs down) the flight at climbing speed to whichever landing is nearer along the path, waits for anyone in the way, then stands on that landing's level and completes as `cancelled` (stair resource released). carry's `gather` cancel also defers until any mid-stair crew walk finishes. Test: `cancel mid-climb (review M2): the walker finishes at the nearer landing on its level, cancelled, no violations`.

`locomotion/walk.ts:112-118`. The cancel is accepted in any phase. During a link leg the
pose is mid-flight (`:542`), `human.level` is still the entry level, and `activity`
becomes `idle`. The person now stands in mid-air, or inside the flight body on the lower
grid. `humanStaticClearance` flags it on the next tick, but the cancel should never have
produced that state. Fix: in the `climb` phase return `{ ok: true, deferred: true }`
and finish the traversal (or reverse it) before completing as cancelled.

### M3. Replanning around people is a no-op on decks or any level above y ≈ 1.6 m
`spatial/service.ts:124, 133` gives the "person" obstacles fixed `y0: 0, y1: 1.8`.
`buildGrids` skips them on any level whose `y + 0.22 ≥ 1.8`. On a deck, `routeAround`
returns the same corridor. The walker burns `MAX_PEOPLE_REPLANS` and stays blocked. The
carry bystander replan through `gridsAround` has the same bug. Fix: take the level id
and use `y0 = lv.y, y1 = lv.y + 1.8` (or `human.pose.p[1]`).

### M4. A timeout returns while actions are still live; the recorded take and final state are mid-action
`sequence/runner.ts:125`. After `timeout()`, deferred cancels (for example a carry's
controlled set-down) keep running. `runPlan` (`rehearsal/rehearse.ts:79-98`) returns
immediately and records a take whose `finalState` has a load held mid-transition and
`task` fields pointing at actions that no longer exist. `execute(…, { commitOnFailure:
true })` (`rehearse.ts:198, 206`) would commit that as an ordinary `simulation-run`
checkpoint, which violates §22's rule against labelling a snapshot as resumable. The API
does not expose `commitOnFailure` today. Fix: after `timeout()`, keep stepping a bounded
number of ticks until no deferred cancel is live. Refuse to commit when `rt` still has
live actions, and mark the take `incomplete: true`.

### M5. Unbounded storage growth: full history rewrite on every commit, and a "read-only" op that persists
`simulation/engine-room.ts:90` rewrites the whole `WorldHistory.toJSON()` (every stored
state) on each fork or execute. On a campus-sized world that is O(total states) per op,
and it will hit DO CPU and transaction limits. `api/schemas.ts:90` marks `rehearse`
`readOnly: true`, yet `controller.ts:337` stores a full take, including `finalState`, on
every call. `bind_plan` stores every distinct plan with no size cap. Fix: store states
content-addressed as their own blobs (`y<year>/state/<hash>`) and keep only
checkpoints and workspaces in the history blob. Flag `rehearse` `readOnly: false` or
keep its take in memory with an LRU. Cap plan and take counts per room.

### M6. Behaviour depends on entity insertion order, which the state hash ignores
`hashOf` sorts keys, so two worlds with identical content and different
`world.entities` insertion order hash identically. Yet 21 engine call sites iterate
`Object.values(world.entities)` unsorted, and several return the *first* match. For
example, `walk.ts:394` `intrusion` → `personBlock` → `makeWay(that id)`, and
`carry/actions.ts:82-88` `pathBystander` → `makeWay`. Which bystander gets asked to
move, and so the outcome, can differ between two runs whose `baselineStateHash` is equal.
`history/store.ts:55` also overwrites `states[stateHash]` with the newest clone, so
reading an *older* checkpoint can return a different entity order than the one it was
run from. Fix: canonicalise on entry. In `put()` and `read()`, rebuild `entities` (and
`regions`) in sorted-id order, and keep the first stored clone (`if
(!this.states.has(stateHash))`).

---

## Low

- **L1. History objects are exposed by reference.** `history/store.ts:71-76`:
  `publishCanonical` silently replaces an existing workspace of the same id, even a
  protected one. `fork()` and `publishCanonical()` return the internal `Workspace`
  (`ws.protected = false` works), `checkpoints` hands out mutable `Checkpoint`s, and
  `cause` is stored by reference (`:97`). None of this is reachable from the API today.
  Fix: return `{ ...ws }`, freeze checkpoints and a cloned cause, and throw `exists` in
  `publishCanonical`.
- **L2. `fromJSON` trusts stored hashes.** `history/store.ts:142-149` never checks that
  a stored state hashes to its key or that a checkpoint id matches its content. A
  corrupted blob loads silently, and `rehearse`'s integrity check reads the stored
  `physicalHash`. Fix: recompute `hashOf(state)` per state on load, at least in the DO
  once per cold start.
- **L3. Explicit action ids can collide.** `runtime/runtime.ts:57` does not check
  duplicate explicit `opts.id`: a second submit overwrites `records[id]` while the first
  action is still live (runner prefix `step:`, `makeWay` ids). Fix: fail with
  `action.duplicate-id` when `records.has(id)`.
- **L4. Dead usability check.** `locomotion/walk.ts:502` tests `link.usable` on the Link
  object captured at plan time, and `Spatial.sync` rebuilds contributor links as new
  objects, so the check never fires. Only `remainingValid` (on epoch change) protects
  stairs. Fix: look the link up in `sp.scene.links` by id.
- **L5. Nearby decks share a level.** `construction/access.ts:26` computes deck level ids
  as `round(y / 0.5)`. Decks within ±0.25 m share an id, and `spatial/service.ts:97`
  sets that level's `y` from the first sheet, so people on the other deck render up to
  0.25 m sunk or floating. No invariant compares `human.pose.p[1]` with the level y or
  the surface under the person. Fix: add a level/y invariant with a small tolerance, and
  derive the level y per surface under the person.
- **L6. Unswept lifts.** `beam.ts:102-105` and `access.ts:207-211` move beams, joists,
  sheets and treads by straight-line lerp from the ground to the seat with no sweep, so a
  sheet can pass diagonally through joists and uprights (§31). Fix: lift vertically to
  clearance height, then translate, and sweep the footprint against `sp.scene.obstacles`
  like `raiseSweep` does.
- **L7. Cancel set-down ignores bystanders.** `carry/actions.ts:343`: a cancel-initiated
  set-down skips the `bystanderAt` check that the normal set-down performs (`:280`).
  Fix: return `carry.cancel-unsafe` when `bystanderAt(rt, ex, setdownSpots, frame)`
  finds someone.
- **L8. Chunking can split surrogate pairs.** `simulation/engine-room.ts:43-44` splits
  JSON by UTF-16 code units, so a label containing an emoji (API `label` fields accept
  any string) can be cut mid-pair. SQLite then stores lone surrogates as U+FFFD, and the
  take fails `TakeLibrary.put`'s id check forever. 512 Ki characters of 3-byte text can
  also exceed the 2 MB value cap. Fix: step back one code unit when the chunk ends on a
  high surrogate, and chunk by UTF-8 bytes (`TextEncoder`) at ≤ 1.5 MB.
- **L9. Clearance margins are thinner than the raster error.** `spatial/grid.ts:99`
  estimates clearance to within about ±cell·√2/2 (0.07 m), and query points are not cell
  centres. `PLAN_MARGIN` 0.06 and the invariant tolerance 0.03 are both smaller than
  that, and the invariant shares the raster, so true overlaps of a few centimetres are
  structurally invisible. This is an approximation, not a bug. Record it in the rules
  notes, or use `cell·√2/2` as the margin.

---

## Checked and found sound
- **Determinism sources.** There is no `Math.random`, `Date.now`, `new Date` or
  `performance.now` in engine core (`performance.now` appears only in engine-room
  metadata), and `world.rng` is never consumed. Both heaps (`path.ts`, `sweep.ts`) break
  ties by insertion order. The A* forbids corner cutting and uses an admissible octile
  heuristic. Planner closed sets use numeric keys. Construction scans sort by id
  (`contributor.ts`, `topSupport`, `sheetSupports`).
- **Hashing.** `stableStringify` sorts keys, drops `undefined`, normalises `-0` and
  rejects non-finite numbers. The sync SHA-256 is standard.
- **History immutability.** States are stored as deep-frozen clones and `read()`
  returns a fresh clone. Protected workspaces refuse commits. Checkpoint ids cover
  `{stateHash, parent, cause, rulesVersion}`, and no merge operation exists.
- **Plan staleness.** `physicalView` covers the base, every entity field except
  label/tags/provenance (it includes `human.*` and `reservedBy`), region
  geometry/kind/level, `inventory` and `rng`. It excludes env, tick and labels as §16
  requires. Rules-version gate, `planHash` integrity, and a baseline physical-hash
  check are all present. Rehearsal and execution share `runPlan`, with fresh services
  per run and a base/scene mismatch guard. `execute` refuses protected, stale or failed
  runs, and the API cannot pass `commitOnFailure`.
- **Takes.** The recorder's quantisation matches replay interpolation (shortest arc).
  Same-tick re-sampling at `finish()` is handled, removed entities are flushed and
  marked `present:false`, and changes are `structuredClone`d (no aliasing of in-place
  `connections.push`). Tick 0 and zero-length takes work. `TakeLibrary.put` verifies the
  id and deep-freezes. `replay.ts` imports no runtime, registry or history, and camera
  tracks sit outside the take hash.
- **Reservations and delegation.** All reservations are released on every terminal
  status. Ancestor delegation happens only through an explicit `parent`, which neither
  the sequence runner nor the API exposes. The runtime's step loop iterates a snapshot
  in submission order, and actions submitted mid-tick first step on the next tick.
- **Carry.** Whole-formation swept checks use a margin that covers the sample spacing,
  and every primitive and shortcut passes the same sweep. Cancel is deferred or refused,
  never dropped: lift-cancel lowers the load back, and a move-cancel over an obstacle is
  refused. `carryIntegrity` checks held-by ⇔ gripping and grip drift while moving.
- **Construction.** `release_support` refuses until `groupStability` passes.
  `progressiveSupported` walks the sheet → joist → beam → upright chain. Stairs become
  usable only with every tread in, a landing, and top support. Mid-air
  cancels (beam, joist, sheet, tread, flight, partly raised frame) are refused.
- **Sequence binding.** Substitution is eval-free with `hasOwnProperty` checks. Graph
  validation catches unknown ids, self-dependencies and cycles, and every step is parsed
  with its verb's schema. `when: started` chains resolve within the same tick. Refused
  cancels on abort are recorded, never forced.
- **API and DO.** Operation names are checked with `Object.hasOwn`, and all ops have
  zod-bounded ids and coordinates. `fork` onto an existing name fails. Execute is
  idempotent: a second run of the same plan is refused as stale. `bind_plan` and camera
  track ids are content-addressed. The worker validates the year, and the DO drops the
  in-memory controller when a persistence transaction fails.

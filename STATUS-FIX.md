# Soul fix round 1 — implementer status (lane/soul-fix-20261025)

Base `31fa07296` (SOUL3 integration tip). Scope: `<team>/TRANCHE-SOUL-FIX-20261025.md`, causes in
`<team>/playtest/ROOT-CAUSES-20261025.md` §C/§D. No web source changed, so no web build is needed for these commits.
Tests run with `node --test` per file (never full suites). The laptop load was 23–30 the whole time (other lanes), so
two Eden-boot tests timed out once under load and were re-run.

Worktree note: only the root `node_modules` was symlinked; the per-package pnpm link dirs (`apps/server/node_modules`,
`mars/viewer/node_modules`, `packages/*/node_modules`, …) were copied with `cp -a` from `soul3-integration` (relative
symlinks, gitignored) so server tests resolve workspace packages from this worktree.

## Commits

### 1. `889b05c36` D2: sit:here means here
- Before: `sit:here` = nearest free seat within 30 m straight-line (`activities.ts:192` `w.seat(30)`, `ledger.ts`
  `w.seat` Math.hypot only); the bridge upgraded it to any god seat ≤ 30 m (`god/engine-bridge.ts` `sitHere`). Eden 2026
  commons: "sit down" = social-eden-dining-chair 6 m away; the playtest world: a House 1 kitchen chair 29–30 m away.
- After: `EdgeLedger.seatIsHere` (`edge/ledger/ledger.ts:1357`, `HERE_SEAT_M = 3` at `:21`): a seat is here when it
  stands in the body's own enclosed innermost place (its room) on its floor, or within 3 m with the same enclosure (none
  outdoors); never while aboard a carrier. `w.seat(radius, here)` (`ledger.ts:1232`) and `activities.ts:197-203` use it;
  otherwise sit:here is "Sit down on the ground here (no free seat right here)". The bridge's god-seat upgrade
  (`engine-bridge.ts:1380-1384`) applies the same rule. Named seats and `{verb:'sit', target:{nearest:'seat'}}`
  (intents.ts `SEAT_REACH = 30`) are unchanged; `read:here` keeps the nearest seat within 30 m.
- Tests: new `apps/server/src/edge-sit-here.test.ts` (8 m bench → ground, 2.5 m → bench, named bench still offered;
  Eden 2026 lawn → ground, House 1 living room → its seat). Deliberate updates: `edge-seat-duration.test.ts` (bench 8 m →
  2.5 m, walk > 20 ticks), `god/build-residents.test.ts` C1b #12 (Soul 2 m from `outer`). Green: those 3 plus
  edge-ledger-activities, edge-body, edge-far-seat, edge-ledger-vocabulary. No conformance tuple references sit:here
  labels, so no re-pin.

### 2. `4945f650a` D2: numbers name names, not label counts
- Before: "go inside house 2, into the kitchen" → `walk:eden-house-1/kitchen-chair-2` (071922 quin-010): House 1's
  offers matched "2" through "(2 rooms" / "(2 m)" in their labels (`vocabulary.ts:400` tokens of the whole label).
- After: `vocabulary.ts:402-405` strips label counts and distances (`N m|s|rooms|seats|stops`) from name tokens. Room
  words already go to rooms before kitchen chairs (ownFirst); the new test pins it.
- Tests: `edge-ledger-vocabulary.test.ts` new D2 case (14/14), edge-resolve-with (3/3). `edge-ledger-resolve-phrases`
  (Eden boot) timed out under load 27 and was not re-run green — re-run it on a quiet machine.

### 3. `10d33c54a` D3: the server closes the owner loop
- Before: only the agent's `result` closed a card message; `GET /v1/edge/wait` never counted as listening
  (`edge/comms/index.ts:148`), so the card read "away" during `act --wait`; act/wait printed raw receipts with
  `done:true|false`.
- After:
  - `POST /v1/edge/act` takes `for: <owner message id>` (`edge/routes.ts:36-61`, 400 when not this Soul's message;
    echoed as `for`). `edge/owner-loop.ts` links receipt → message in memory (≤ 2000; a restart drops links) and on
    `completed`/`failed` (not `replaced`) calls `inbox.serverResult` with `receipt.done ?? outcome.summary`.
  - `inbox.ts`: column `soul_inbox_queue_v1.result_by` (idempotent ALTER, `:77`), `serverResult` (writes only when no
    agent result; a later linked act replaces the world's line), agent `result` replaces a server line and clears
    `result_by`; messages expose `resultBy: 'server'`.
  - `edge/comms/index.ts:148-152`: the wait holds `inbox.listening(scope)` while open.
  - `eden.mjs` 2.1.0: `act --for <id>|none` (default: newest message acked in this folder within 15 min, saved by `ack`,
    cleared by `result`, dropped when the world answers "no owner message"); default output of act/wait is `brief()`:
    one top-level `now`/`done` sentence (`receipt.now` / `receipt.done` when the server sends them, else
    `outcome.summary` / phase) + receipt id/phase, `for`, `ownerMessages`, ≤ 600 chars; `--json` prints everything.
    `wait` no longer prints the `done:` boolean (the key `done` is now the sentence).
  - `SOURCES.json` controller CLI hash + 2.1.0; `soul-publication.test.ts` pins 2.1.0.
- Tests: new `apps/server/src/edge-owner-loop.test.ts` (presence away → listening during a wait; bad `for` 400; linked
  wave writes `result_by='server'` outcome done; agent result overrides; second agent result 409; a later linked act
  keeps the agent's line), new `tools/world-launcher/soul-cli-owner-loop.test.mjs` (brief shape/600 cap; --for default,
  explicit, none, --json, stale default dropped). Green: those, inbox.test (14), edge-wait-owner, soul-publication (3),
  soul-controller (4).

### 4. `da83c5d7d` Skill 2.1
- `tools/world-launcher/soul/skill.md`: the `--wait` bullet describes `now`/`done`; owner step 4 + long-activity advice →
  "The server closes your owner's message when the act ends; add `result …` only to say something else."; rule "An ack
  says what you will try, never what happened."; step 3 says each act serves the message acked last (`--for`).
  93 → 93 lines, 5,990 → 5,970 bytes (≈1.5k tokens). SOURCES.json skill hash + 2.1.0.

## Uncommitted: D2 walk into a one-room building (see the walk-audit note)
- `god/nav.ts:371-375` (goal) + `:691` (label): a building whose front door reads closed and that has exactly one room is
  walked into that room (as `walk:<b>/<room>`), label "inside, into <room>". Test `edge-walk-into-building.test.ts`
  (Eden 2026 commons → "walk to the pavilion on the commons" ends in `g-commons-pavilion.pavilion`; fails on the old
  nav.ts at [9.0, -1.3], the playtest's exact spot).
- Walk audit (`walk.mjs`, all worlds, load ~27): eden-2026, bench-eden, genesis, bench-hamlet unchanged; **fuzz WORSE:
  hedge-cabin bad 0 → 13 (walk:hedge-cabin and everything inside it nav.disconnected), unusable 2 → 5.** A second fuzz
  run is the check for flakiness — see the result line below. Do not commit nav.ts until hedge-cabin is understood.
- Multi-room buildings with a closed door still end at the door; their label already says "to its front door
  (closed)". A receipt "at the door" line was not added (the outcome summary names the outside place).

## Not done: D1 (body state) — precise plan
1. Server, one derivation `bodyState(entityId)` in `edge/ledger/ledger.ts` beside `seatIsHere`: `{posture, activity,
   on?: carrier label (this.aboard + places.carrierPlaces name), inWater: activity in swim/tread/wade or engine water
   depth > 0.3 at the pose, step?: "walking to <target label>, N m left"}` (N from the program's current `walk_to`
   goal vs pose; target label from the receipt's capability label). Read on every call, never stored.
2. Receipts (`ledger.ts:250-253` `view`): non-terminal receipts gain `body` and `now` ("walking to Kitchen chair, 18 m
   left; not sitting yet" / "sitting on Kitchen chair"); terminal ones `done` = outcome.summary rewritten with place
   names. eden.mjs `brief()` and `owner-loop.ts resultLine` already prefer `receipt.now` / `receipt.done`.
3. `doing` line: `world.ts:930` sets the program label at start → use the approach step's words until the body is in the
   program's main pose; `world.ts:589` stops writing "standing around" while aboard or in water; the `cancelled` branch
   (`world.ts:588`, guarded by `ev.kind !== 'cancelled'`) also clears `doing` (stale "Lie down" after stand);
   `souls.ts:31` IN_WATER + `souls.ts:433` map riding/rowing (ledger `stateOf`) and water depth, not only activity.
4. Join texts (effects.ts:37 already says "Boarded … not left the ground"; the punt join answer "You are in the punt"):
   "boarding the punt" until the rider is seated.
5. Web (needs a coordinator build): `apps/web/src/place-names.ts` POSES gain ride/row/board; generalize
   `WorldEntityLayer.ts:269 isRideBalloonDef` and `LiveWorld.tsx:848 rideCarriers` to any `components.carrier` thing;
   draw a simple car at the carrier pose (or seat the rider on the nearest drawn gondola as `WorldBalloonRide` does);
   do not resync the decorative wheel clock. Balloon carrier/camera tests must stay green.
6. Tests: a ferris-wheel/punt ride fixture asserting card `doing` "riding the ferris wheel" for the whole ride, a
   swim-then-wave body reading in-water, and `sit:here` receipt `now` = "walking to …" until seated.

## Still open for the coordinator
- Re-run on a quiet machine: `edge-ledger-resolve-phrases.test.ts`, `edge-ledger-library-not-stair.test.ts` (both boot
  Eden 2026; timed out / interrupted under load).
- Walk baseline and bundle budget untouched (no web change).

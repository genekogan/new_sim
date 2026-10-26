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

### 6. D2: a walk to a one-room building lands inside (commit after STATUS)
- Before: "walk to the pavilion on the commons" → `walk:commons-pavilion` "to its front door (closed)"; 4 of 4 walks
  ended at [9, -1.5], outside the pavilion floor; only `walk:commons-pavilion/pavilion` got in.
- After: `god/nav.ts:371-375` (goal) + `:691` (label): a building whose front door reads closed and that has exactly one
  room is walked into that room, as `walk:<b>/<room>` is; label "inside, into <room>". Multi-room buildings with a closed
  door still end at the door (their label already says so); no separate "at the door" receipt line was added.
- Test: `edge-walk-into-building.test.ts` (Eden 2026; fails on the old nav.ts at [9.0, -1.3], the playtest's spot).
- Walk audit: run 1 (all worlds, concurrent with Eden-boot tests, load ~27) showed fuzz hedge-cabin bad 0 → 13; run 2
  (`walk.mjs --world fuzz`, alone) **fuzz 536 → 536, unusable 277 → 277, equal to baseline**; eden-2026, bench-eden,
  genesis, bench-hamlet were equal in run 1. Baseline untouched. Treat the run-1 hedge-cabin line as load flake, but
  the gate's V3-walk is the authority.

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
- Re-run on a quiet machine: `edge-ledger-resolve-phrases.test.ts` (timed out at 600 s under load) and the Eden half of
  `edge-ledger-library-not-stair.test.ts` (its synthetic half passed; the Eden walk hit its 900 s limit under load 27).
- Walk baseline and bundle budget untouched (no web change).

## D1: the world reports the body, not the plan (round 1, second implementer)

### `c077857e0` D3 follow-up: server typecheck
- `edge/owner-loop.ts:39` compared a receipt phase with `'accepted'`, a value the type never has (tsc TS2367; harmless
  at runtime). Removed it. Server `tsc --noEmit` is now clean.

### `d81ff3044` D1 server
- Before: the card `doing` was the program label from start (`world.ts` decision), approach included, then
  "standing around" at program end even on a carrier or in water; a `cancelled` end left the old label (stale
  "Lie down"); `souls.ts` mapped only swim/tread/wade; receipts had `phase` only; the ride said "You are in the punt"
  as soon as the rider was listed (still boarding).
- After:
  - `apps/server/src/body-state.ts` (new): `bodyState(host, entity, approach?)` gives `{posture, activity, on, aboard?,
    inWater, step?}`, read on every call (never stored). `stateOf` moved there (ledger re-exports it).
    `inWater` = swim/tread/wade, or depth > 0.3 m from the new engine `bodyWaterDepthV1` (ground/1 base water; 0 aboard,
    on a deck, upstairs) or the shore/1 `submergedHeightMetres`. `cardDoing` = carrier words (boarding / seated,
    waiting / riding / rowing / stepping out); the approach ("walking to Kitchen chair") while the body walks toward a
    non-walk act; the label while in the pose; water words after the program ends.
  - `world.ts`: `publicSoul.doing` = `doingOfV1(m)`; `bodyOfV1`; `approachV1` hook; a cancelled program with nothing
    running after it sets `m.doing = 'standing around'` (a replaced one keeps the new label). `m.doing` stays the plan
    label for the brain and `recent`.
  - `souls.ts` status: `doing` from the body plus `body`. `ledger.ts`: open receipts carry `body` and `now`
    ("walking to ferris wheel, 12 m left; not aboard yet"); `bodyOf` in the public Soul `self` and observe `self`; plans
    remembered per receipt in `decide` and the object-decision path (in memory, 512; a restart loses only the step).
    eden.mjs unchanged: `brief()` already prints `receipt.now`, which the server now fills from `body`.
  - `ride.ts`: "You are in the punt" / "climbs into" fire when the rider is seated (`boarding` list added to the ride
    state), and an attraction's car is "the ferris wheel car", not "the basket".
- Tests: new `body-state.test.ts` (5: riding, rowing, swimming/standing in water, approach walk, idle);
  `edge-body-state-ride.test.ts` (2, retained-commons engine: a ferris-wheel carrier on the attraction route; card read
  "riding the ferris wheel" for all 1,739 seated aloft ticks and never "standing around" aboard; the walk receipt's
  `body.step`/`now`; status `body.on`; stand after lie clears "Lie down", fails on the old world.ts);
  `edge-ride-boarding-text.test.ts` (1). Deliberate update: `swim-status-words.test.ts` publicSoul doing
  "standing around" → "treading water" (the old line said the web relabelled it). Green, one at a time: those, plus
  edge-ride-labels, edge-ride-exit, edge-ledger-ride, edge-ledger-punt, edge-ledger-ride-together, edge-owner-loop,
  edge-ledger-here, edge-body, edge-sit-here. Server and web `tsc --noEmit` clean.

### `e31c5a155` D1 web
- Before: only balloon-tagged things were rides; the wheel's carrier had no car, the broadcast did not frame its rider;
  POSES had no ride/row/board.
- After: `place-names.ts` POSES ride/row/board/alight; `ride-carriers.ts` (`isRideCarrierDef`, `carrierIdOf` mirroring
  installGodRides, `recordedCarriers`, `carrierPoses`); `WorldEntityLayer.rideCars()` (carrier things that are not
  balloons); `LiveWorld` frames every recorded carrier and god ride car, and `WorldRideCars` draws an open car with a
  hanger bar at each god attraction's carrier pose. Balloons unchanged; the wheel's gondola clock untouched.
- Tests: new `ride-carriers.test.ts` (4); `WorldEntityLayer.ride.test.ts` still green.
- Build: `apps/web/dist` was a symlink into soul3-integration; removed the link only and built here (`npx vite build`,
  `apps/web/dist/index.html` 15:02); the integration dist is untouched (mtime unchanged). Bundle:
  `budget.mjs --build --check` → OK, 8681.2 KB raw / 2452.2 KB gzip, 0 offenders, 10 new keys under 100 KB; baseline
  unchanged.

### D1 gaps left
- The car is a stand-in: the rider is not seated in it (no `ride` pose animation) and it does not match the wheel's
  drawn gondolas (their clock is decorative). Eden's punt is framed but no new mesh is drawn (it has its own).
- Terminal receipts get no new `done` line from `body`; they keep `outcome.summary` (D3).
- Native minds' approach name comes from the card target only; no "m left" if the target has no entity.
- Not measured in the replay set yet; a browser check of the wheel car is still due.

## Release candidate `rc/soul-fix-20261026` (merge of main 84f84798a, LINK)

Gene (2026-10-25 evening): tidy up and have everything ready to merge to main and deploy; his go-ahead is required
before the release owner ships. The fix branch sat on the SOUL3 integration tip, so the candidate is main + the SOUL3
client publication + the fix. Four files conflicted:

- `edge/ledger/ledger.ts` — LINK's `body` (body rule view: awake / idle / zombie / asleep) keeps the `body` key in
  `status` and in `here.self`; the D1 engine body state is `bodyState` beside it, and `status.self.doing` stays.
- `world.ts` — both helper blocks kept (D1 approach / bodyOf / doing; LINK soulNow); the public card's `doing` is the D1
  body-truthful line, followed by LINK's `now` and `body`.
- `tools/world-launcher/soul/skill.md` — the 2.x skill, now **2.2.0**: one short "Your public `now` line" section
  (LINK). 6334 bytes ≈ 1.58k tokens.
- `tools/world-launcher/soul/SOURCES.json` — eden.mjs 2.2.0, eden-agent.mjs 1.9.17 (main's LINK build), skill 2.2.0,
  instructions 2.0.1; 1.9.17 guide provenance under `legacy`.

`eden.mjs` **2.2.0** ports the LINK now line (`--now` rides on act/say/ack/result in the body and on wait as a query,
`now "<line>"` / `now --clear`, `status` shows `link` and `now`), so new Souls on the 2.x client keep the feature 3.93
shipped. Test `tools/world-launcher/soul-cli-now.test.mjs` (3 tests; the owner-loop and publishing tests still pass).
Checks: server and web `tsc` clean; bundle budget OK (8685.6 KB raw / 2452.0 KB gzip, 0 offenders); web unit tests
pass. Server test files, walkability and the world-launcher folder: see `team/HANDOFF-SOUL-FIX-RC-20261026.md`.

### Early Modal gate on 163ce3404 (01:53–02:52Z): BLOCKED, 4 new failures + 1 removed assertion → fixed here
- `V6-party` S9 and `V5-server-full` edge-ledger-activities both encode "sit down near seats takes the nearest free
  seat" (the bench by the fountain, the fire-circle logs). D2's 3 m outdoor radius broke both: **HERE_SEAT_M is now
  8 m** (a few steps, same enclosure, never the 30 m walk to another house's chair); the party S9 predicate accepts the
  D2 label ("Sit down on the free seat here (plaza-bench-1 …)"); edge-sit-here's far bench is 12 m, and the commons
  lawn case now expects the free outdoor chair 6 m off.
- `V6-join-clerk/dev` L2 asserted the 1.9 skill template ("This world is **base**", version 1.9.x); it now accepts
  the 2.x publication (no templates, version 2.x) as well.
- `V4-web` removed assertion: the renamed test "Soul card start prompt names pair with the window code" keeps main's
  ID ("pair-soul") with the 2.x assertion, as the LINK integration did for its renames.
- Gate run 2 on c48c705bc (03:05–03:28Z): one new failure, `edge-body-rule` "idle reflex … sits and dozes within 2 h"
  (seated, never napping). With the 8 m radius `sit:here` carries the nearest seat's target, so the LINK idle reflex
  took `sit:here` instead of the concrete seat offer and never reached its doze. The reflex now skips `sit:here`
  (`ledger.ts` attachPresence seat hook); the test passes again (seated 411, napping 1212 ticks).

## D3b: unfinished acts read unfinished; a result lands on its own message; "house 2" is house 2

Why: the two-repeat cloud scorecard (`team/playtest/replays/cloud/fix-r3/SCORECARD-vs-baseline-cloud2.md`, ledgers in
`fix-r3/*` and `rc-r2/*`) kept the sitting (6/6 twice) and walk (100 %) wins, but W rose and pip's H fell in basics-2:
(1) agents reported an outcome as soon as `act` returned accepted (fix-r3 basics-2 pip-006 "lying down" 13 s early,
pip-009 "at the pond" 15 s early; rc-r2 basics-2 pip-002/quin-002 "sitting" while standing); (2) the CLI's implicit
`--for` linked any act within 15 min of the last ack, so trio tam-003's later walk to the pavilion closed "walk with
Mira" as Done; (3) basics-1 r1 pip-010 "go inside house 2, into the kitchen" (the agent sent `act "walk to the kitchen
in eden-house-2"`) resolved to `walk:eden-house-1/kitchen-chair-2`.

- **A. `--for` default (eden.mjs 2.2.1).** The implicit link applies only to the first act the world *accepts* after an
  ack and only within 120 s of it (`IMPLICIT_FOR_MS`); state `.eden-agent.json` `lastAckedActed` beside
  `lastAcked`/`lastAckedAt` (set by that act, cleared by `ack`/`result`/a stale-default drop). A refused act
  (`accepted:false`) links nothing, so it does not use the default up. Explicit `--for <id>` and `--for none` unchanged
  (any accepted act after the ack counts as the first, `--for none` included). Test: `soul-cli-owner-loop.test.mjs`
  (refused act, first act links, second does not, explicit still links, `none` uses it up, `--json`, > 120 s, stale drop).
- **B. Unfinished sentence.** `body-state.ts` `notYet()` (MAIN_POSE moved here from ledger.ts); `ledger.ts` `bodyFacts`
  now ends every open receipt's `now` with it: walk/run/jog/go/go-near/stroll/follow "not there yet"; sit/sit-ground
  "not sitting yet" until seated; lie/nap "not lying yet" until lying; stand "not standing yet"; a body already in a
  timed pose (seated for the 60 s sit, lying, dancing, other timed acts) "not finished yet"; an approach for read/eat/…
  "not reading yet"; waiting and not running, or an invitation nobody has answered, "not started yet"; a join "not
  aboard yet". Never "lying down; not lying yet": once in the pose the open receipt reads "not finished yet". `brief()`
  prints `done: false` next to `now`. Skill 2.2.1 Acting bullet: "Until `done` appears the request is not done; say
  so."; owner step 3: "only the first act after an ack serves it; else `--for <id>`". 6,334 → 6,390 bytes (≤ 6,400).
  SOURCES.json re-pinned (eden.mjs and skill.md 2.2.1); `soul-publication.test.ts` and `soul-cli-now.test.mjs` pin 2.2.1.
  Test: `body-state.test.ts` D3b case (11 readings).
- **C. Numbers bind to the word before them (vocabulary.ts).** The resolver was wrong, not the agent: the agent's words
  named eden-house-2, but house 2's kitchen was not among the offers where Pip stood, and `kitchen-chair-2` in house 1
  held every word (kitchen, eden, house, 2) in step 3, so the nearest match won. Reproduced in a unit fixture (the
  4945f650a fixture without the house-2 kitchen offer). Now `numberConflict`: words that number a word ("house 2")
  exclude a name that numbers that word only otherwise ("house 1"); names without such a number are unaffected; applied
  in step 3 and in `placeMatchTier` tiers 1–3. `numberWords`: "house two" reads "house 2" only where a name here numbers
  "house" ("the red one" stays words). With the room offered the walk is `walk:eden-house-2/kitchen`; without it, the
  house that holds it (`walk:eden-house-2`, existing contains-it path), never house 1. Test: `edge-ledger-vocabulary`
  D3b case next to the D2 one.
- **D. Unchanged:** the 8 m seat radius, the idle-reflex `sit:here` skip, D1's body-truthful `doing` line.

### Product issue recorded (not papered over)
- **The world's dance has no visible body effect indoors.** fix-r3 basics-1 r2, basics-2 r1/r2 pip-008 "dance for twenty
  seconds": the receipt completed after 20 s, but every body sample read standing/idle and the card read "Standing
  around" (D1's doing line is body-truthful, so it reports what the body shows). The dance program needs a visible pose
  or animation (or a refusal where it cannot show one); D3b does not change the doing line to hide it.

### Not verified here
- No Modal gate, dev world or replay was run (coordinator re-gates and re-measures). Whether `not finished yet` while
  seated changes how agents word sit/lie replies is for the replay set to show.
- The real Eden 2026 offer set for pip-010's spot was not reproduced (the unit fixture models "house 2's kitchen not
  offered"); the Eden-boot resolve suites were not run.

# Status

As of **2026-10-03**, canonical checkout `<repo>`. Sources
`<old-sim-repo>`, `~/Mars` and `~/Dev/littlemartians` stay read-only. The exact deployed
build is returned by `/healthz` and recorded in `<eden4>/MERGE-LOG.md`.

The four worlds, owner mandate, take archives and autonomous construction are live.
The prospective sleep policy is activated through a logged event in each living
non-Toy world; recent checkpoints and daily renewal are verified. Final native
gate and successor construction-soak receipts are maintained in MERGE-LOG.

## Live deployment contract

| Surface | State |
|---|---|
| Production | https://sim.eden.art; staging first, immutable release directories and code-only rollback |
| Staging | https://<staging-host>; independent data and fake minds |
| Worlds | `/` list, `/w/toy` preserves `toy-1`, `/w/mars`, `/w/littlemartians`, `/w/eden`: independent owner-bound processes |
| Static | `/l/mars`, `/l/littlemartians`, `/l/eden` browser snapshot Labs, all 68 presets; `/w/mars/2020`–`2027` Studio, public campus assets through an allowlisted same-origin proxy |
| Ownership | All new-world Souls owned by Gene; existing Privy sign-in/admin; public watching |
| Durability | Per-world SQLite, accepted event log, resumable checkpoints plus deterministic replay; Litestream/R2 and on-box backups |
| Budget | Durable admission reservations and rolling real-24-hour ledger; absolute maximum $1/world; existing $0.50 setting retained |

## October 3 playback milestone

The shared Mars view draws actual scene walls, openings, fixtures and server-recorded
people. Selection, following, daylight and the last-hour rewind use TakePeople/sampleTake;
there is no client Runtime. WebSocket chunks are compressed and retained in SQLite.
Measured camp take storage is about 13 KB per simulated second. Verified R2
archives retain historical rewind while SQLite keeps the recent 24-hour buffer.

Replay regressions F1–F8 and the intentional F9 frontier behavior have focused tests.
The living camp is activated per world with `ENABLE_LIVING_WORLD=1`. Its
48-day qualification passed; exact production activation is recorded in MERGE-LOG. This playback release can already
read the newer camp checkpoints, providing a compatible rollback for that activation.
The camp has an additive place, individual needs/journals, logged choices, independently
chosen supper hosting/joining, quiet checkpoints, daily fresh Runtime and durable fault
recovery/quarantine. No routine or timetable controls a Soul. Reflection and owner words
remain private. The local live mind proof spent $0.003215808 and its server was stopped.

Playback milestone checks (historical): workspace typecheck; 45 server tests; all other Sim suites passed. Mars engine 1,489 passed,
6 inherited skips, 11 inherited TODOs, zero failures. Browser selection/follow/rewind proof
has zero page errors or HTTP failures. Run the full Mars release gate at tranche end.

Little Martians and Eden are live, with their qualification described below. The finite construction controller is qualified; ordinary stage/frame/deck/stairs construction cards are live. Toy now uses the same recorded 3D view. All four bounded Opus helpers finished;
building pictures are available at `/buildings`.

## Mandate milestone

Living-world steering adds, edits or removes private owner rules. One Haiku alignment
call explains a new rule and its objective cards; times and party conditions wake
thought. Only explicit NOW uses a direct agenda, on the next tick. Completed NOW rules
record done; impossible ones report blocked; a newer NOW records its predecessor
replaced. Strict rules appear first in mind context and report a differing decision
once per world day. No rule removal stops ordinary needs/journal decisions.

Owner controls and paired-agent REST/MCP share the rule mechanism; legacy structured
intent becomes a NOW rule in living worlds, preserving the supplied cards. Rules survive
checkpoints/replay and stay out of public kernel/log and other Souls' compiler context.
The isolated live proof used one Haiku compile, total world spend $0.01733385, all nine
paid calls settled, server stopped. Browser add/strict/edit/reload/remove passed without
page errors or HTTP failures. Focused tests also cover interruption, blocked reporting,
structured steering, strict reporting, replay/restart and card tampering. Successful
provider responses with missing/invalid usage retain their admission reservation.

## Mars closing unit

The published computer workshop and physical same-book library continuation are
imported together with all six shared wiring files from exact commits `4b89357`,
`1b57a55`, `ab1f6be` and coverage metadata `fa0c9b6`. Original Mars stayed read-only.
Registry activities29→31; old checkpoint restored and advanced without invariant faults.
Both presets are browser Lab snapshots; this does not install composite routines in
the persistent camp. Named floater admission covers all four new verbs.

Successor proof: full Sim suites passed (45 server tests); Mars engine 1,539 passed,
6 inherited skips, 11 inherited TODOs, zero failures. The six actual Play journeys
passed: workshop completion, independent interruption/rejoin, safe End/Reset, same-book
transfer completion, interrupted reading continuation, and held-transfer cleanup/Reset.
Original publication evidence remains source-inherited; full successor Mars gate is
still reserved for tranche end.

## Retained shell capabilities



**The shell**

- Canonical event log, deterministic fold, replay from genesis, snapshots, restore.
- 20 Hz tick loop with clock-rate dial, pause, time dilation.
- WebSocket sync; view-hash heartbeat; resync; resume from a ring buffer.
- Privy sign-in, invite gate, Souls (several per account), ownership, retirement.
- Agent interface: installable `/skill.md`, pairing both ways, per-Soul tokens, REST and MCP.
- Operations: numbered DB migrations, retention, CI, staging-then-production deploys,
  rollback, watchdog, R2 replication.

**The meaning layer** (2026-10-01; design in `eden4/18`)

- **Kernel**: things, links, time and five kinds of change (appear/vanish, set, move,
  link/unlink, say). Everything else (kinds of thing, kinds of link, manners, cards) is open
  vocabulary. One rule: an actor changes only itself, what it controls and what it made.
  The kernel replays from the log with no engine.
- **Cards**: named actions with conditions, changes and a depiction. Fifteen base cards; a
  deck and three manners per Soul; a shared library.
- **Plans**: an owner's wish becomes an agenda of cards (`of` for things that do not exist
  yet). One-step lookahead finds travel and unblocking by itself; unplayable steps are passed
  over; a plan impossible for ten minutes is given up.
- **Minting**: a compiler (Haiku) writes missing cards; owners' agents can propose cards;
  every card is validated before it enters the library.
- **Speech**: acts (ask, agree, decline…) are state; words are rendered afterwards by a
  small model and stored beside the record.
- **Minds in three tiers**: reflex (code, free), mid-brain (Jev), compiler (Haiku). Plus the
  narrator per region and the director.
- **Pages**: `grammar` (plays as sentences, things, vocabulary, card library, animation
  to-do), `notebook` (open design questions beside live evidence), deck/plan/speech on
  `my soul`, overheard speech on `watch`.

**A second engine** (2026-10-01; design in `eden4/19`)

- `packages/engine-mars`: the real Mars engine behind Sim's engine contract, formerly imported
  read-only from a local checkout; the October 3 hard fork now lives under mars/. `ENGINE=mars` runs the
  whole shell on it, and one of Mars's own authored scenarios (the meal) runs through it
  unchanged. At that October 1 checkpoint it was laptop-only; the vendored engine
  and live worlds are now deployed as described above.

## Earlier prototype limitations (historical October 1)

- **Production runs the toy engine**: a 100 m plane, seven fixtures, straight-line walking.
- **No rendering.** The map is text; camera shots are data.
- **Scenes** (several bodies in one coordinated motion: a class, a meal, a carry) are
  designed (`eden4/19` §5), not built.
- **Layered knowing** (atlas, news, memory) and **self-change proposals** (`eden4/18` §6, §8)
  are not built.
- **Not built from the eden4 vision:** manna and any economy, building and materials,
  ground growth, rooms and doors, the daily ritual, generated bodies, NFTs or any chain
  component, asset storage, moderation.
- **Minds are not canonical.** Mood, energy, plan position and think-timers are snapshotted
  but not reproducible from the log.

## Measured

| What | Value | When |
|---|---|---|
| Mid-brain call (Jev) | ~$0.00009, ~220 ms | 10-01 |
| Reflex decision | no model call | 10-01 |
| Compile a wish (Haiku) | $0.007–0.012 (about 7,700 input tokens; a third of that when cached) | 10-01 |
| One exchange of words (Haiku) | ~$0.002 | 10-01 |
| Narrator plan (Haiku, cache warm) | ~$0.003, 3–5 s | 09-30 |
| DJ story, live models, 8 Souls, 3 minutes | $0.041 in total | 10-01 |
| Tick, toy engine, 31 Souls / 50 clients | 0.44 ms avg; 2 KB/s per client | 09-30 |
| Tick, toy engine, 206 Souls / 300 clients | 1.0 ms avg; 22 KB/s per client; all in sync | 09-30 |
| Tick, toy engine, 1,006 Souls / 300 clients | 3.9 ms avg; clients lose sync | 09-30 |
| Tick, **Mars engine**, 20 people strolling | 0.36 ms avg, 8.5 ms worst | 10-01 |
| Mars 2026 campus | loads in 3 ms; walk planning 6 ms avg, 34 ms worst; state hash 1.7 ms | 10-01 |
| Snapshot | 3.5 ms at 31 Souls, 44 ms at 1,000 | 09-30 |
| Server memory | ~150 MB resident | 09-30 |

Replay check on production (2026-10-01): the kernel replayed from the live world's 11,939
events in 35 ms and matched the running server's hash (`infra/verify-kernel.ts`).

Historical October 1 tests: 52 (kernel 6, engine contract 4, toy engine 8, Mars
adapter 13, brain 6, server 15). The former external adapter skipped without a
local Mars checkout; the successor requires its vendored engine and runs in CI.

## Known limits and risks

- The R2 key in use is eden3's media-bucket writer key (shared bucket, `sim/` prefix).
- An eden3 deploy can drop the Caddy `import` line that serves Sim.
- Secrets on eden2 are readable by both root users (Gene and a second admin).
- The October 1 account note recorded a Privy free-tier ceiling of 499 monthly
  users; current plan terms are not part of this merge qualification.
- `node:sqlite` is still marked experimental in Node 22.
- Budget and brain mode changed in the admin tab are lost on restart; pairing
  codes and pending approvals are in memory and are cancelled by a restart.
- **A wish costs about a cent.** At $0.50/day the compiler's share covers roughly fifteen
  wishes a day across all owners; each owner is limited to twelve an hour, after which a
  cheaper translator handles plain goals.
- **Any card can target anything anywhere**; only its own conditions limit reach.
- **Cards cannot be retired or revised** once minted. Base cards can be revised for an existing world
  only by adopting a new base vocabulary (an admin action, logged).
- The old goal `follow` now means "go and talk with"; nothing follows continuously.
- On the Mars engine the director's shot list and the map still assume the toy world's layout.
- Native controllers resume only in codec-supported phases. Persistent worlds
  checkpoint at a safe point and replay the accepted suffix for other actions;
  construction recovery and quiet renewal need ongoing operational observation.

## Earlier shell roadmap (historical)

1. **Take over the Mars engine** (Gene, from 2026-10-02): decide where its code lives; run
   staging on `ENGINE=mars`; a furnished campus world; the first scene; a Mars vocabulary
   pack. Plan in `eden4/19` §8.
2. Layered knowing and memory; self-change proposals (`eden4/18` §6, §8).
3. Cost: a cheap matcher for wishes existing cards already cover; audience-aware cadence.
4. From the hardening sprint (`eden4/16`): protocol version negotiation, hot/cold database
   split, structured metrics, asset store on R2, load Privy only on sign-in.

## Deferred after this merge

Terrain; the `sim.mars.college` redirect and retirement of its Worker; engine
package restructuring; talking faces; other owners and their permissions; the
2026 campus as a persistent world; economy; and a plugin platform remain deferred.
The legacy Mars app stays on its existing codebase and DNS. Larger world ontology,
terrain ownership and material economy questions remain strategy work, without
new decisions being inferred from this implementation.

Strategy questions in `eden4/18` and `eden4/19` remain background; the merge tranche
is authorized by its kickoff. No credential or setup blocker currently needs Gene.

### Verified take archives

Five-minute physical take archives use the existing Sim R2 prefix, with upload,
metadata and checksum read-back before local pruning. SQLite retains a rolling
24-hour buffer and the complete archive manifest. Worker compression stays off
the world loop. Fake tests cover pagination, retention on upload failure, checksum
rejection and world isolation; real R2 read-back passed on recorded camp frames.
Use the exact release receipt in MERGE-LOG to determine production identity and
Mars camp activation. The 48-day camp receipt passed: 3,456,000 ticks, zero invariant faults, exact
mid-supper restart; early/late averages 0.889/0.841 ms per tick, heap 35.27/36.51 MB.
All four Souls completed 12–22 distinct activities/day; 17 of 40 recorded shared
moments had multiple participants. Activity-set similarity averaged 0.544–0.577.

Additive registry checkpoint upgrade: activities29→31 is explicitly qualified to
resume the pinned checkpoint, without an unnecessary full replay. Other physics/
assembly versions stay unqualified. Restart regression and all 46 server tests pass.

## Ceramic garden and green field milestone

The Little Martians scene has seven Gene-owned floating heads, six scenery kin,
Ceramic Tower and Minaret Temple. The clean procedural GLBs use the authored
1046-prism footprints, wide ground entries and five declared shafts. All seven
rooms are reachable through ordinary continuous body movement; a humanoid can
enter the ground room and refuses upper openings. Floaters use their own radius,
height and link admission, with the same 0.1 m collision grid. A role-aware table
covers all 95 verbs in `tools/floaters/POLICY.md`; hand-dependent work is refused.
Humanoid activities and action object identity are preserved.

The ordinary needs/journal chooser has room visiting and garden recharge cards;
there is no timetable. Recharge is enacted only during settled rest, and quiet
company can replenish a ceramic head. Landing alignment, opposite link traffic
and ordinary step-aside clearance are collision checked and serializable. The
soak rejects every physical recovery, including faults cleared by normal recovery.
The 48-day qualification passed: 3,456,000 ticks, zero physical recovery or card faults, every quiet renewal released, exact mid-glide engine/kernel/needs/journal restart. Early/late averages 0.666/0.498 ms per tick, heap 30.34/31.79 MB. Each head completed 7–19 distinct activities per day; habits emerged without a daily sequence.

Eden has a literal green field and one Gene-owned idle humanoid. Only an owner's
unfinished direction wakes its chooser. `/l/mars` includes the camp snapshot;
`/l/littlemartians` and `/l/eden` open paused browser-only place snapshots, without
server state, Soul ownership or a world day. Explicit move, Play, Pause and Reset
use ordinary Runtime actions; reset/reload retains the selected Lab route.

Browser asset/follow proof loaded all seven heads, six kin and both buildings,
with zero errors. The short isolated live model pass used one alignment and
Jev/Speech decisions, cost **$0.014983694**, all reservations settled, server stopped.
Directed snapshot proof passed for all three places: actual completed movement (including tower level 13), Play/Pause, Reset and reload to exact initial poses/tick, no server API calls, zero page errors. Full workspace release checks passed: Sim and 46 server tests; Mars 1542 passed, 6 inherited skips and 11 inherited TODOs, zero failures; typecheck and lint passed. Existing source proof grades remain separate.

## Preserved Toy 3D milestone

Toy now uses the shared recorded 3D shell, selection/follow and bounded rewind. A recording-only factory wraps the original engine with a separate 20-tick event buffer and twelve hot chunks; it constructs no Mars Runtime and changes no Toy rule, state hash, output or snapshot codec. A focused equivalence test checks moving/settled poses, all outputs and physical/state hashes for 800 ticks, plus an exact mid-walk restore. The original seven fixtures get plain depiction geometry.

The browser proof renders loaded people and selected follow with zero page errors or HTTP failures. The first local capture used a server started before the static asset build; its fallback warning was caught by visual review, retained and corrected by restarting the owned harness after the build. Follow now frames a newly selected person from at most twelve metres, then preserves user zoom.

Full runtime checks passed: 47 server tests and all Sim suites; Mars 1542 passes, 6 inherited skips, 11 inherited TODOs, zero failures. Web typecheck/build passed after the camera change. Production Toy archive capture uses its existing Sim R2 credentials under `sim/takes/toy-1`, separate from other worlds. Staging uses `sim/staging` and no paid models. Earlier Toy records and database remain untouched.

## Finite construction controller milestone

`build_lookout` chooses a finite stage/frame/deck/stairs job, lowered to the original
Mars physical verbs. Progress derives from actual part geometry and support, not a
parallel checklist. The crew is reserved at accepted choice; interruption finishes
the committed phase safely. Unsafe execution failure restores the accepted baseline
and records a card fault. Carrying/raising waits for resumable checkpoints.

Qualified: all 24 original parts assembled, repeated-job refusal, daily compaction,
fresh Runtime, exact real-host mid-carry checkpoint/log restart and genesis replay,
held-frame snapshot refusal, safe stop and injected beam-failure recovery. Four bounded paid compiler/mind runs spent $0.069994242 total, all settled and
stopped. Earlier refusals are retained; the clarified construction example produced
a valid optional stage card/mandate on the final run. This release
exposes the controller to the grammar/compiler; ordinary world cards follow as a
separate milestone with this controller as their compatible rollback.

## Autonomous construction cards milestone

All four camp Souls receive ordinary stage/frame/deck/stairs cards. They remain
subject to individual needs, owner words, observations and free crew admission;
completed phases disappear from playable options because their actual parts are
finished. Six autonomous days chose and completed all 24 original parts without a
driver, physical recovery or card faults. A staging-only stalled native sleep
purpose was found separately; the policy-capable living adapter can bound that blockage after a logged
prospective activation and allow quiet renewal, preserving the Lab’s explicit Resume semantics. The full
48-day successor run and final
Mars gate are still running/pending; the deterministic full-build/interruption and
host restart/recovery proofs are already qualified.

Rollback for these cards must retain the preceding construction-controller release.
The grammar/compiler may also reuse them for owner steering. No timetable or
programmatic daily building assignment was added.

The live-card sleep policy is deployed as a reader first. It is inactive until a
`rules.runtimePolicy` event is logged; replay before that event retains the native
behavior. The successor activation release will use this reader as rollback.
A missing selected 2024 review JPEG is restored from its exact committed release43
public derivative; the raw source photograph/archive was not accessed or copied.

## Prospective sleep policy activation

At startup, living non-Toy worlds log the 1,200-tick sleep-block policy once.
Restart uses its persisted receipt; earlier history retains native semantics.
The immediately preceding construction-pack/policy-reader release is the code
rollback after activation, with databases and physical construction retained.
Qualification receipts for the copied-state stall, autonomous 48-day build,
all eight rendered year pages and the native final Mars gate are maintained in
`<eden4>/MERGE-LOG.md`; do not infer a passing gate from this source note.

Three historical browser fixtures now resolve the filtered fork commit
`4976745797652847b790a07926824732ae44a134` (original
`a0c347e0374b473876c97f536dc44dba42399521`) under `mars/`. The selected
2022 JSON remains byte-identical: SHA-256
`205d20234f72a5a05da8252262b9b57488080c70727c20a00b6daf08162d6d93`.
No historical geometry/performance assertion or baseline was changed.

## Fork packaging boundary repair

The native legacy deployment tests now stage selected runtime derivatives,
not Blender reconstruction projects or the source-photo archive. Existing
Blender downloads, methodology and legacy photo references remain linked to
the unchanged public Mars origin; the year-page attribution link is also
reachable there. Displayed open-question images retain existence/packaging
validation; answered entries render only their text, so unused old image
paths no longer require local source copies. Generated questions HTML is unchanged.

All 296 native deployment tests and the changed legacy photo-entry browser
journey passed. The full native gate completed on pinned source; its original RED
report and passing bounded repair receipts remain recorded in MERGE-LOG.
No geometry/performance assertion, baseline or native physical engine code changed.

## Quiet seat courtesy reader

The construction-enabled 48-day run exposed a blocked ordinary workstation
exit after day 27: an idle bystander occupied the seat's stand-up corridor while
quiet renewal held new choices. That run failed qualification and is retained.
The adapter now understands the prospective logged policy
`{sleepBlockTicks:1200, quietSeatCourtesy:true}`. During quiet renewal it releases
finished social holds and asks free bystanders to use native `makeWay` walking;
active programs and construction crews retain control. No poses, seat codecs,
Lab behavior, or historical policy are rewritten.

The reader release `9e78ee416a79` left courtesy inactive on startup. This
activation candidate logs the flag once on each living non-Toy world; the reader
is its compatible rollback. Promotion waits for fresh 48-day qualification. Focused tests prove the legacy obstruction, ordinary walking
without invariant faults, protection of active work, and policy persistence through
checkpoint restore and genesis replay. A fresh 48-day construction run is in
progress; it fails immediately if daily renewal stops releasing.

## Graceful restart at an unsnappable head

A staged restart exposed a separate clock gap: when a controller could not
serialize, graceful shutdown saved no snapshot and boot replay stopped at the
last accepted event rather than the actual shutdown tick. An explicit synchronous
checkpoint now logs a passive `rules` head marker before returning pending.
Boot replays to that marker without forcing serialization or discarding work.
Periodic pending retries emit no markers. The real mid-carry regression now uses
this actual checkpoint path and proves exact engine/kernel restart and continued
physical progress. A hard crash still resumes from the last durable checkpoint
and accepted log; this change specifically preserves graceful restart heads.

## Server hash acceleration candidate

Node uses native SHA-256 for native engine content addresses. The portable
browser/Worker implementation and stable serialization remain unchanged.
Unicode, block boundaries and real state/program/take comparisons are identical.
An isolated 20,000-tick late-camp comparison measured 1.180→0.976 ms/tick.
Construction v4 completed all 48 days physically but failed the unchanged 20%
timing limit narrowly (20.71%); fresh v5 was stopped unqualified after 11 days. Full native
gate retains its original report and focused repairs; this hash-only source
change receives equivalence and full native-engine validation separately.

## Repeated support proof candidate

Fresh v5 was stopped unqualified after 11 days: physical construction, daily
renewal and restart held, but native hashing alone left too much completed-
structure cost. The progressive support invariant now reuses only a successful
proof after every input it reads still matches by value. Connections and holder
arrays mutated in place, definition/phase/standing-angle changes, new/deleted
parts and exceptions invalidate it. Failed diagnostics and locations are never
reused; every other invariant remains active. This memo is bounded by the current
world and is not serialized or added to its rules/state.

Matched unprofiled 20,000-tick late-state copies measured 0.758379→0.595700 ms,
with identical world, kernel and recorded-take hashes and zero invariants. Three
structural mutation/error regressions and full suites pass. Fresh v6 completed
48 days physically but failed timing; the sleep change below is the third native
source change after the original full gate.

## Duplicate supported-sleep clearance candidate

V6 completed all 48 days physically with zero recovery/invariant/card faults and
exact restart, but missed timing again: 0.580091→0.701777 ms, growth 20.977%.
The published sleep pose's safety function already includes full clearance; the
step no longer repeats it on success before any world change. Before first
publication the direct clearance check remains, and the independent end-of-tick
invariant remains active. All 50 existing sleep/visitor/take cases pass. Matched
A/B passed at 0.774711→0.697979 ms with 12,288 sleeping ticks and identical
world/kernel/take hashes. Full suites and fresh v7 remain pending. No performance
limit was weakened.

## Sync test resource repair

The full check failed a pre-existing corruption/resync race: an ordinary activity
delta repaired the test's corrupted field before the heartbeat could detect it.
Its failed assertion then left a reconnect timer running. Test corruption now adds
a phantom body that only a full snapshot removes, and every test closes its
clients even on assertion failure. All six real-server sync journeys passed and
exited cleanly. Production connection behavior and protocol assertions are unchanged.

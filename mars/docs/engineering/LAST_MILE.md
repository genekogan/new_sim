# LAST_MILE — inventory to 100 % of SPEC.md + OWNER_FEEDBACK §1–§15

W55, 2026-09-29, from HEAD `78cd157`. **Inventory only, not an execution order**: the lead sets the order (OWNER_DECISIONS,
"New goal: last mile"). Definition of done (Gene): every known shortcoming / approximate / weak spot / not-done / open /
follow-up line is either **fixed with a test** or **re-classified** as *content* (historical reconstruction, Gene's job) or
*out of scope by spec*, with one sentence why.

How this was built: every line of the source docs listed at the end was read. Items were deduped (one row can carry many
sources) and checked lightly against the code (rg). Items that later workers already fixed in code are not listed one by
one. What is left of them is stale doc text, collected in the evidence rows LM-167…LM-174. Lint numbers come from
`oxlint` on HEAD. Skip markers come from `rg` over `engine/test`, `deploy`, `e2e`. Tool coverage comes from
`simulation/commands.ts` + `worker.ts` + `engine/api/schemas.ts` vs `deploy/simulation-integration.mjs`.

**Row order.** Rows are grouped by the `category` column. Within a category, rows with one of Gene's priority keys come first, in list order, and dependencies follow. The ids are stable handles: they were numbered before rows were grouped, so they are not contiguous within a section.

**Source abbreviations.** HO HANDOFF · EV EVIDENCE · PR PROGRESS (Wnn = worker entry) · RV REVIEW · SP SPEC · OF
OWNER_FEEDBACK_2026-09-28 · CA CARRY · PG PROGRESSIVE · SO SOCIAL · VE VEHICLES · CM CAMERA · CV CAMERA_VERIFY · CD
CAMERA_DIRECT · TP TAKES_AND_PLANS · CS CAMPUS_SCENE · HI HISTORY_IDS · PB PLANNING_BUDGET · DD DIRECTOR_DEMO · HU HANDUP
· IT ITEMS · MV MOVEMENT · PO POSES · BM BODY_MODEL · SPT SOLAR_PAINT · FR FRAMING · YB YEAR_BUILD · SR STUDIO_REPLAY · RC
RECONCILIATION_2022 · LG LAB_GUIDE · LC LIFT_CREW_PLAN · CX-nl / CX-fire / CX-tool / CX-2026 = `briefs/codex-*.REPORT.md`.
Numbers after a colon are line numbers.

**Pins** (PLANNING_BUDGET; `deploy/perf-walk.mjs`, engine tests):
- perf-walk: stress-30 `5c3a3355`, probe `b746b094`, campus crop = full `c56ea8da`, meal `3c28879f`, v3 `39a0fb3f`.
- year-build: bay-1 `251a44c5`, skeleton `d382e461`, B bay+strip `94db263e`, A+B `ddb634d6`, house first-bay tranches
  `940e9f64` / `4862adfc` / `b4c42210`.
- takes: `record-campus-take --check` (flagship `d2f16bd3`, chapter set).
- baselines: Playwright screenshots.

"moves pins?" says which of these a fix is expected to move. Any change to walker timing, grid, route math or the body
model moves the walker pins. Camera, env and observer changes must stay hash-identical.

**Effort.** S ≤ 1 h, M ≤ 3 h, L > 3 h, in worker-hours. For totals: S = 1 h, M = 2.5 h, L = 5 h.
**Codex-owned paths** (CODEX.md §6), flagged **[Codex]** below:
- `engine/camera/parse.ts` + its tests
- `app/engine-view/{fire,paint,solar-mesh,equipment-mesh,palette}.ts` and the `panel()` / `equipment()` / colour-lookup bodies in `components.ts`
- `e2e/{fire,render-polish}.spec.ts` + baselines
- `docs/engineering/data/**`, `deploy/group-2026-frames*`
- `.oxlintrc.json`, the lint script and devDeps in `package.json`
- the lint stage of `deploy/gate.mjs`, `engine/test/source-scan.test.ts`

In-flight workers, whose files a brief must not touch: W47 (2022 houses green checkpoint), W51 (2022 scene), W54
(`directCamera` perf, output-identical), W56 (HISTORICAL_CONTENT.md, after W47/W51).

Priority keys from Gene's list (OWNER_DECISIONS, last entry) appear in brackets:
- controller: C1 auto replan/rebind · C2 static geometry over MCP + region edits stale plans · C3 NL parser →
  `engine_direct_camera` + studio · C4 directed tracks beside the take via an op · C5 one control path for the 20 legacy
  tools · C6 integration covers every tool
- engine: E1 space-time reservations or a proven ordering · E2 deadlock detector · E3 pre-empted social resumes · E4
  stand-on-top-beams · E5 solar side stations · E6 mid-raise cancel · E7 install-lift cancel tests · E8 crews on stairs ·
  E9 forklift swerve/reverse + 3-vehicle cycles · E10 look-ahead on the shared budget · E11 all movers publish speed ·
  E12 combined camera corrections + scene occlusion · E13 per-person body variants · E14 lint to 0 and in the gate
- renderer: R1 talk/watch poses · R2 carry/lift/hold gaps · R3 beam-flange feet · R4 item–item collision + lap support ·
  R5 prone phaseK replay exactness
- evidence: V1 every row PROVEN, notes shrunk, HANDOFF shortcomings only re-classified

---

## 1. Controller

| id | item | source | category | proposed | effort | moves pins? | depends on | notes |
|---|---|---|---|---|---|---|---|---|
| LM-001 | [C1] Stale plan is refused and the director must re-bind by hand; no automatic replan/rebind | EV:44,274,796,911; TP:225-227,243; DD:252-276; HO:639 | controller | fix | L | maybe — director-demo transcript ids only | LM-003 | api test: a physical edit after bind makes `execute` auto-rebind + re-rehearse (or one `rebind` op) and report the diff; `plan.stale` kept as the opt-out path |
| LM-002 | [C2] Static geometry is not editable over MCP (no widen corridor / remove wall) | HO:521,639; DD:410-412 | controller | fix | L | maybe — planning budget if static hash enters baselines | — | `engine_edit_world` static op; integration test: the edit stales a bound plan and a re-rehearsal routes through the new geometry |
| LM-003 | [C2] Region layout edits don't stale plans (`layout` not in physicalView, world/types.ts:154-170) | HO:521,639; DD:418-419 | controller | fix | S | maybe — any state hash that includes physicalView regions | — | test: a layout-only region edit gives `plan.stale` with the region in `diff.regions` |
| LM-004 | [C2] Staleness is conservative: any physicalHash diff stales a plan, relevant to its route or not | EV:44,274 | controller | fix | M | no | LM-003 | region-scoped staleness test: an edit far from every step's footprint keeps the plan valid, an edit on the route stales it |
| LM-005 | [C2] `edit_world` refuses to move vehicles (api/edit.ts:159); tests stage overlaps by raw world edits | EV:321,785; HO:625; VE:134-135; PR W25 | controller | fix | S | no | — | api test moves a parked vehicle through `edit_world` with validation; traffic tests switch to it |
| LM-006 | [C2] Reconstructed mars-2026 scene is not seeded into rooms (2026 rooms are synthetic only; seeds.ts:86) | DD:423-424 | controller | fix | M | maybe — perf-walk campus if the scene file changes | — | `/mcp?year=2026` starts with a protected `mars-2026` workspace; api test queries it |
| LM-007 | [C3] NL camera parser not wired into the controller: not exported from camera/index.ts, no ParseVocab from SemanticWorld, used only by app/studio/direct-panel.tsx | HO:712; PR W45,W48; CX-nl:108; SR:343-353 | controller | fix | M | no | — | `engine_direct_camera` accepts `sentences` → structured parse refusals + compiled directions, with an integration test; parse.ts itself is [Codex] |
| LM-008 | [C3] "main pallet racks" only resolves through the take's "rack bay" structure (no alias / named asset) | EV:316,700; PR W16 | controller | fix | S | no | LM-007 | SemanticWorld alias plus a direct-camera test resolving the phrase |
| LM-009 | [C3] Camera direction schema has no fixture subject kind ("the sink" only via `context.lookAt`) | CX-nl:107 | controller | fix | M | maybe — camera ids | LM-007 | schema change logged in CODEX.md §7 (frozen schema) plus parse and direct tests |
| LM-010 | [C3] Bounded NL grammar: untested paraphrases refused ("zoom in", orbit without angle, "wide lens") | CX-nl:106,109 | controller | fix | S | no | LM-007 | [Codex] refusal list written as a contract with fixtures, so refusals are by design and tested |
| LM-011 | [C3] Director demo never calls `engine_direct_camera` or a sentence; DD/LG tool lists lag the registry (12/13 vs 14 engine tools) | DD:82-84,61; LG:49-57 | controller | fix | S | no | LM-007 | director-demo.mjs adds an asserted sentence → direct_camera step; doc lists are generated from `engineTools()` |
| LM-012 | [C3] Direct compile blocks the page ≈ 5.6 s on a chapter take (D2) | SR:474-476; PR W48, lead 1333 | controller | fix | M | no — must be output-identical | — | **W54 landed on `w54-direct-perf`** (output-identical: `camera-direct-identity.test.ts`, 17 fixtures + the D2 hold vs the pre-W54 golden; `--check` OK for all takes + chapters): D2 hold 7.3 s → 0.25–0.35 s warm in node, flagship orbit 0.32–0.40 → 0.16–0.21 s (CAMERA_DIRECT §9). **Next steps:** (1) timing test as a deterministic proxy — assert the D2 case's sampler-call count (2 424 now, 29 713 before) rather than wall time; (2) move `directForTake` into a worker (removes the remaining ≈ 0.3 s freeze); (3) `trackHash` is half of D2's time — faster identical sha256 in `core/hash.ts`; (4) `centreAt` per-id sampling (≈ 60 ms on D2) |
| LM-013 | [C4] Directed tracks are download-only; no room op stores a directed track beside its take | EV:318,737; HO:630-631; CD:413-415; SR:383-397,444-445; PR W19,W22,W24 | controller | fix | M | no | — | op (sibling of `attach_camera_track`) saves a compiled directed track next to a take; test: take hash unchanged and the track is listed and replayable |
| LM-014 | [C5] Two control paths: 20 legacy tools (18 in simulation/commands.ts + get_state, get_capabilities) sit beside the 14 `engine_*` tools | LG:49; OWNER_DECISIONS last entry | controller | fix | L | no — legacy room state only; integration transcript changes | LM-015 | legacy tools route through the engine controller op path (one registry); integration asserts each legacy tool via the new path |
| LM-016 | Sequence steps have no step-level timeout and no cancel/mark step verbs; `at` cues only apply to registry verbs | TP:334 | controller | fix | M | no | — | runner test: step timeout fires with a named reason; cancel/mark steps work |
| LM-017 | Deleting a workspace leaves checkpoints addressable whose takes may be evicted → `take.unknown` | DD:420-422 | controller | fix | S | no | — | get_take gives a named `take.evicted` refusal (or eviction is blocked while reachable), with a test |
| LM-018 | DO storage: chunking splits UTF-16 surrogates; 512 Ki chars of 3-byte text exceed 2 MB; caps are counts (64 plans / 32 takes), not bytes (REVIEW L8) | RV:277-282; EV:302,469; HO:286-287 | controller | fix | M | no | — | engine-room test: emoji straddling a chunk boundary round-trips; byte-based cap refuses the largest take over the limit |
| LM-019 | Year-build-sized takes in a DO room are untested against the 30 s CPU limit | HO:284-286 | controller | fix | M | no | LM-015 | integration rehearses one chapter in a room under the limit, or refuses with a named code |
| LM-202 | [C5] Not one world model: the Studio component editor / saved layouts don't create engine design-edit checkpoints; the legacy people/EUC simulation is a parallel sim layer | SP:23,175,264 | controller | fix | L | no | LM-014 | Studio edits go through `engine_edit_world` (e2e + api test); legacy people commands become engine verbs — lead may de-scope as a new feature (§9) |
| LM-203 | Action contract not fully machine-readable: `list_verbs` gives description + input schema only (no preconditions, reservations, phases, completion, failure codes, cancel semantics, outputs) | SP:150 | controller | fix | M | no | — | describeVerbs emits those fields per ActionDef; api.test asserts every verb has them |
| LM-204 | No visual scene awareness over the API (no capture op from a requested viewpoint; director captures only via local Playwright) | SP:177 | controller | fix | L | no | — | capture op backed by a render host, with a test — needs a rendering host (Browser Rendering / local service); lead may re-classify (§9) |

## 2. Engine

| id | item | source | category | proposed | effort | moves pins? | depends on | notes |
|---|---|---|---|---|---|---|---|---|
| LM-020 | [E1] No space-time reservations: simultaneous carries/formations are not co-planned (sequences order them with `after`); walker encounters have no time-to-collision model | EV:38,184,857,313,646; HO:219-220,450; MV:222-225 | engine | fix | L | yes — every walker/carry pin if behaviour changes; a pure ordering proof may be pin-neutral | LM-024 | two crossing carries with no `after` both complete with 0 violations, **or** a proven ordering rule plus a test that validate refuses an unordered overlap |
| LM-021 | [E1] Head-on round a tight corner falls to the single-file rule, not the encounter logic | EV:313,646; HO:627; PR W15; MV:222-225 | engine | fix | M | yes — perf-walk | LM-020 | movement test: a curved head-on meeting passes without single-file where width allows |
| LM-022 | [E1] Two climb links on one column face are not mutually exclusive | EV:307,547; HU:272-273 | engine | fix | S | no | — | reservation test: the second climber on the same face waits or is refused |
| LM-024 | [E2] No deadlock detector: mutual waits (head-on in a single-file passage, walled-in walker, two walkers arriving close, blocked mid-carry, forklift pull-over retry) show only as a runner timeout, not `blocked` | EV:31,86,313,646,792,841; HO:221-226,243-244,450-451,627; TP:331-333; CA:169; MV:95-96,231-235; VE:107-108 | engine | fix | L | maybe — pin-neutral if it only reports; replan-on-detect can move pins where a pinned run waits | — | detector names the wait cycle and turns it into `blocked` (+ replan); proving-ground passage test with 2 walkers and a forced 3-cycle; partial passage release exists (walk.ts:827, W38) |
| LM-025 | [E2] Dead-end corridor A: 21/252 layouts end with the crew waiting (`carry.path-occupied`); the walker would have to back out | RV:77 | engine | fix | M | maybe — carry gather routes G | LM-024 | the corridor-A sweep ends with 0 waiting layouts |
| LM-029 | [E3] `snapshot()` refuses while a directive waits for a stand-up | EV:320,768 | engine | fix | S | no | LM-026 | resumable wait-state test |
| LM-032 | [E4] Climb paths are three straight segments with no body check (frame stances, climb links) | HO:637-638; PR W7; EV:307,547,605; HU:272-273; YB:181-182 | engine | fix | M | maybe — year-build | — | climb path swept with the body envelope against structure and people; test with a member across the path |
| LM-035 | [E5] BOM solar ids differ from the catalog solar ids | HO:638; PR W7 | engine | fix | S | maybe — year-build | — | one id scheme plus a BOM ↔ catalog test |
| LM-041 | [E8] After a stair carry `stagedCheck` checks distance only (no support/surface or clearance) | CA:125; EV:294,337 | engine | fix | S | no | — | staged-on-deck check verifies surface and OBB clearance; test places a load half off the deck |
| LM-043 | [E9] 3+-vehicle yield cycles undetected; vehicle traffic is heuristic, not proven deadlock-free | EV:321,785; HO:625; VE:133-134,140-141; PR W25 | engine | fix | M | no | LM-024 | test: a 3-vehicle cycle is detected and broken (or reported `blocked`) |
| LM-045 | [E9] Vehicles are discs: the bicycle's 1.75 m is not swept; yield zones use the reach disc; walkers see a rider as a 0.28 m person; empty-fork height assumed ≤ 0.45 m; overhead clearance uses 1.8 m | EV:296,376; VE:130-131,133,138,141-143 | engine | fix | M | maybe — perf-walk if walker avoidance changes | — | oriented vehicle footprint in curve planning, yield zones and walker avoidance; test: a walker keeps distance along the bicycle's length |
| LM-046 | [E9] Vehicle lanes are a straight read of the planned curve (no replan/braking prediction); traffic engages only with ≥ 2 ridden vehicles | VE:129-130; EV:321 | engine | fix | S | no | — | test: the lane updates on replan; a parked unridden vehicle is handled as an obstacle |
| LM-047 | [E9] `carryIntegrity` flags fork loads (scenario routes around it); forklift loads blanket-exempt from `carry.support` | EV:315,674; HO:192; PR lead ~19:30 | engine | fix | S | maybe — flagship v2 | — | forks count as support; flagship v2 runs without the workaround at 0 violations |
| LM-049 | [E10] Walk look-ahead assumes 0.9 m/s lateral, not the shared per-tick budget, so walkers briefly slow while sidestepping | EV:319,750; HO:626; MV:215-217,326-328; PR W21 | engine | fix | M | yes — all walker pins (perf-walk 5, year-build, takes) | — | movement test: sidestep speed does not drop and pushes = 0 where the prediction used to miss |
| LM-050 | [E10] Stress-30 max tick ≈ 90 ms (tick 5 = 27–30 synchronous exact A*); the ≤ 60 ms target is unmet (corridor planner opt-in only) | HO:238-239,281-282,436-437,632-633; PB:34-41,195-200,436-438; PR W11 | engine | fix | L | yes — stress-30 and every pin if submit planning is spread | LM-049 | perf-walk reports max tick ≤ 60 ms on stress-30 with a recorded re-pin reason |
| LM-051 | [E10] 1.08–1.5 m gaps between people are walkable but not plannable at 0.1 m cells | EV:313,646; HO:626-627; PR W15; MV:95-96,231-235 | engine | fix | M | yes — perf-walk | — | planner test routes through a 1.2 m gap between two standing people |
| LM-053 | [E10] Look-ahead cache / arc memo not done | PB:201-203 | engine | fix | S | no — must be hash-neutral | LM-049 | hash-identical cache with a perf assertion, or struck from PB as unneeded (hazardAhead 0.03 ms/tick) |
| LM-054 | [E11] Only walk_to publishes speed (walk.ts:233): carry, climb, stance, sit, vehicles and forklift don't, so they are bounded only by `motion.teleport` 0.15 m | EV:319,750; HO:626; MV:229-230,329-332; TP:63; VE:67; PR W21 | engine | fix | M | yes — takes with a speed field (take bytes/ids); state hash if speed is in state | — | every mover sets `human.speed`; `motion.overspeed` caps per activity (carry 0.9, climb 0.35 …); a per-mover overspeed test |
| LM-055 | [E11] Emergency stop drops velocity to 0 in one tick | EV:313,646; MV:226-228 | engine | fix | S | yes — perf-walk, takes | LM-054 | decel-limited stop test (or cite the SPEC clause that asks for an instant stop and re-classify, see §9) |
| LM-056 | [E12] Camera phase 2 applies one correction per shot (first valid wins; raise ranks before swing); a shot needing raise + swing is refused | CD:363-364,370-371; EV:317,722; HO:628; PR W18 | engine | fix | M | maybe — camera ids of corrected tracks | — | fixture needing two strategies is corrected with both recorded; ranking prefers the least deviation from the ask |
| LM-057 | [E12] Camera synthesis collides with static geometry only; take people/parts occlude but never block; people are not navmesh obstacles | EV:316,700; HO:628-629; CD:353-355; PR W16 | engine | fix | M | maybe — camera tracks | LM-056 | synthesis test avoids a moving person/part occluder |
| LM-058 | [E12] Scene occlusion vs render mesh: prisms (pitched parts over-occlude), capsule people vs skinned bodies (≤ 0.15), 1 sample ≥ 0.2 in parity; static-subject readability from box points | EV:40,41,215,228,299,425; HO:246,629; CM:144-147,159,189; CV:109-112; CD:356-357,368-369; SR:452-454 | engine | fix | M | maybe — camera tracks | — | two-capsule person proxy plus pitched-part prisms; camera-verify parity with 0 samples ≥ 0.2 |
| LM-060 | [E12] Camera is a point with clearance, not a swept sphere (corners can be clipped ≈ 0.3 m between samples) | CM:153-155 | engine | fix | M | maybe — camera tracks | — | swept-capsule test: never crosses a corner |
| LM-061 | [E12] Year-build/chapter readability low: bay-1 0.42, whole skeleton 0.31, bay-1/skeleton cameras 77 %, chapter min 0.60 on D0/D1/S; the rater scores the desired pose, not the corrected samples | EV:317,722; HO:576-577,619; PR W39; YB:362-365; SR:442-443 | engine | fix | M | yes — take camera ids (re-record) | LM-056 | rater scores final samples; readability floor ≥ 0.65 asserted on year-build takes; re-record |
| LM-062 | [E12] Corrected hold still shows a bystander's head large in frame (foreground rule measures cover of the subject region only) | SR:400-403,455-457 | engine | fix | M | maybe — corrected track ids | LM-056 | combined foreground-size + occlusion rule; test: no bystander > X % of frame in the carryA hold |
| LM-063 | [E12] `occluded` is off for fly-throughs and ignores co-subjects' bodies; flare not occluded by take parts/people; split re-times but does not recompute look-at for a moving subject | CD:307,365-368,374-375,378-379 | engine | fix | M | no | — | three fixture tests (fly-through occlusion, sun behind a sheet gives no flare fail, split on a walker stays centred) |
| LM-064 | [E12] `shorten` and `cut` have no fixture where they win (exercised only via refusal lists) | CD:372-373 | engine | fix | S | no | — | camera-correct fixtures where each wins |
| LM-065 | [E12] Director plans from stored thinned tracks (whole-house deltas 0.196 vs 0.2 threshold); planned cameras came from an exact 1 mm re-run, not the shipped tracks | TP:173-180; EV:318,737 | engine | fix | S | no | — | test: direct_camera on the shipped take equals the plan within margin, or it uses an exact re-run documented in TP |
| LM-066 | [E12] Directed orbit heading search is marginal (a 5 mm tolerance flipped it) | TP:151-153; PR W22,W23 | engine | fix | S | maybe — flagship track | — | tie margin; test perturbs tracks 1–5 mm and the choice is stable |
| LM-067 | Camera navmesh rebuilt per call (100–250 ms), not cached across calls | EV:316,700; HO:629; CD:358-359; PR W16 | engine | fix | S | no | LM-012 | cache keyed by scene hash; timing test (W54 left it: neither W54 case builds a navmesh; see CAMERA_DIRECT §9 next steps) |
| LM-068 | No hard minimum shot length in Viterbi; candidates local to the target (no global search / cross-subject grammar); hairpin fly-throughs slow; region box height from obstacle centres (3 m fallback) | CM:156-158; CD:360-361,381-382 | engine | fix | M | maybe — camera tracks | — | min-shot-length constraint test plus a hairpin fly-through time bound; global search stays out (the explicit ladder is SP §18 design) |
| LM-069 | Camera safe area: top toolbars (≈ 0.18) not modelled; the canvas bar is really ≈ 0.22 vs the planned 0.17 | CM:160-165 | engine | fix | S | yes — takes (camera track re-record) | — | quality.ts models top and bottom UI bands; test with the measured bar |
| LM-070 | [E13] One reach-down cap (0.5 m) and one set of bands for templates reaching 0.35–0.54 m; the woman template's arms hang (ENGINE MISMATCH printed); deck-hand points set for one torso | EV:314,662; HO:595-597,620-621; PR W9,W12,W14,W35; BM:169-174; PO:154-155,321 | engine | fix | L | yes — v3, handup tests, year-build maybe | — | per-person body variant in body/model.ts used by station choice; test: a short template is refused a reach the tall one gets; no MISMATCH print |
| LM-071 | [E13] lowReach 0.5, tableReach 0.6, carryHand, seatedDrop are stated, not measured | BM:26,30,36,40 | engine | fix | S | maybe — meal, paint | LM-070 | measured from the rig in poses.spec and pinned in body-model.test |
| LM-072 | [E14] setpart.ts:241 erasing op `(P.p[0] - final.p[0]) * 0` | PR W45; CX-tool:41,73,111; lint | engine | fix | S | maybe — yb-AB wall panels | LM-076 | intent decided (term removed or restored) with the wall tip-up test; A+B stays or is re-pinned with a reason |
| LM-073 | [E14] core/math.ts:209,298 number literals lose precision at runtime (`no-loss-of-precision`) | lint | engine | fix | S | maybe — any hash through those constants | LM-076 | literals written at double precision; determinism probe + all pins unchanged (or re-pin with reason) |
| LM-074 | [E14] 14 host `**` sites allow-listed in source-scan; `contents.count` untyped | HO:637,714; PR W7,W15,W33,W45; CX-tool:88-107,112 | engine | fix | S | maybe — hashes by ulps (camera/quality, sun, social, path …) | LM-076 | allowlist empty (core/math pow) and source-scan green; typed `contents.count` passes tsc |
| LM-075 | REVIEW L1 + L2: history objects exposed by reference (`publishCanonical` silently replaces, returns the internal Workspace; mutable checkpoints); `fromJSON` trusts stored hashes | RV:242-253 | engine | fix | S | no | — | history test: mutating a returned ws/checkpoint doesn't affect the store; re-publish throws `exists`; a corrupted blob is rejected on load |
| LM-076 | REVIEW L3 + L4: explicit action ids can collide (runtime.ts:87); stepLink checks the plan-time Link's `usable` (walk.ts:1272) | RV:254-261 | engine | fix | S | maybe — makeWay ids | — | duplicate id fails `action.duplicate-id`; a flight made unusable mid-climb fails |
| LM-077 | REVIEW L5: decks within ±0.25 m share a level id (access.ts:30-31); people render up to 0.25 m sunk/floating; no foot-y invariant | RV:262-267 | engine | fix | M | maybe — year-build (many decks) | — | foot-y vs surface invariant plus a two-close-decks test |
| LM-078 | REVIEW L7: a cancel-initiated carry set-down ignores bystanders | RV:273-276 | engine | fix | S | maybe — carry pins | — | cancel with a person under the set-down footprint gives `carry.cancel-unsafe` |
| LM-079 | REVIEW L9 + sampled sweeps: clearance margins (PLAN_MARGIN 0.06, tol 0.03) are thinner than the raster error (≈ 0.07); U-trap clearance per tick on the EDT grid; raise arc sampled; hand-up plan sweep every 5 cm | RV:283-288; EV:30,35,68,142; HO:245-246; PR W30 | engine | fix | M | no — documentation plus tests; a margin change would move all pins and is not proposed | — | a written bound (sample spacing ≤ margin) in ENGINE_GUIDE plus tests showing the invariant catches a ≥ X cm overlap and an arc clip between samples |
| LM-080 | Mid-carry: carry height uses the 0.22–1.8 m body band (a hand-height load can't pass under a 1.7 m member; items < 0.22 m ignored while moving) | CA:40-41,162-164 | engine | fix | M | maybe — carry pins | — | load swept at its own height: test passes under a 1.7 m member and flags a low stack |
| LM-081 | Items: a carried item trails its hand by one tick (≤ 7 cm) while walking (hold_items steps before the walker) | EV:308,562; HO:634; IT:96-97; PR W5 | engine | fix | S | yes — meal, any take with held items | — | meal.test asserts item pose = hand every tick |
| LM-082 | Items: reach over a table assumes a forward bend (shoulder→item ≈ 1.1 m); only eating is checked against the 0.62 m envelope | EV:308,562; HO:634; IT:69,93-94; PR W5 | engine | fix | M | maybe — meal | LM-070 | take/put reach checked against a bent-over envelope; over-reach across the table is refused |
| LM-084 | Stance holders hold the beam 0.73–0.79 m beside the body (no facing turn); the rear hang_beam lifter carries the beam 0.35–0.65 m behind its back; climbing facing is renderer-only | HO:614-615; PR W14 (f1,f2),W24; PO:156-162,170-172,183-185,327-329; SR:446-449 | engine | fix | M | yes — year-build pins, chapter takes | — | engine publishes a facing toward the held load / along the carry; test: hands in front of the body plane on every stance and hang_beam tick |
| LM-085 | No engine foot/hand holds on the bracing (which node a climber stands on); the renderer infers the ladder cycle | HO:616; PR W14 f4; EV:307,547; PO:189-190,324-325 | engine | fix | L | yes — year-build takes | LM-032 | engine publishes a node/rung per foot and hand; renderer soles on the published node 100 % (see LM-121) |
| LM-086 | Bundles keep their full box until empty (engine); the pull off a bundle is not modelled (piece appears after 4 s) | HO:638; PR W7; YB:89-90,185-186; EV:311,605 | engine | fix | M | yes — year-build | — | obstacle box shrinks with `contents.count` (test); pull phase with hands in the take |
| LM-087 | Beam walk-in checks static geometry only (partly addressed by W38's bystander rule) | HO:638; PR W7,W38 | engine | fix | S | maybe — year-build | — | test: a person in the walk-in path is asked to make way or the step waits |
| LM-088 | Giver hands sit at 0 mm slack on the reach envelope | HO:621; PR W12 | engine | fix | S | maybe — v3 | — | explicit epsilon margin; test fails at the boundary |
| LM-089 | liftcrew.ts keeps its own HAND_REACH 1.0 / LIFT_APEX_MAX 2.4 (stance.ts now uses BODY_MODEL) | BM:103-105; LC:14 | engine | fix | S | maybe — build-bay, year-build | LM-070 | liftcrew reads body/model.ts; test that the constants agree |
| LM-090 | Release is not blended in the engine (hands clear when a holder lets go) | EV:314,662; BM:183-184 | engine | fix | S | yes — takes (hands field) | — | release phase moves hands to restHands; `hands.teleport` test |
| LM-091 | postureGap treats the shoulders as one cylinder, not two joints ±0.15 m | BM:175; HU:259-261 | engine | fix | M | maybe — handup, v3, solar | LM-070 | two-joint envelope with tests at one-arm-only reaches |
| LM-092 | Hand-up: balance checked for a single giver only (single receiver feeding end-first and sheets unchecked) | EV:306,531; HU:262-263 | engine | fix | M | maybe — v3 | — | single-receiver end-first slide/balance check with a refusal test |
| LM-093 | Hand-up: rise corridor only outward along the edge normal; station search only on the edge the load comes over; grip always nearest S; load always level, straight up | HU:242-244,265-267; PR W28,W30,W32 | engine | fix | M | maybe — v3, handup-prone | — | fixture where only a lateral/other-edge station or a grip off-centre clears the joist ends |
| LM-094 | [R5] Prone rise checked with cylinders about S (bounding cylinder, no heading); the body beyond the lip is swept only at the take; arms are straight segments | HU:238-241; BM:178-182; PR W28,W32 | engine | fix | M | maybe — handup-prone | — | heading-aware per-tick invariant (proneYaw); proneBodyHit every push_up/kneel_up tick; a fixture where the rise hits a joist tail is refused |
| LM-096 | [R5] Lying slide-back (≤ 0.16 m) is renderer-only; the engine deck hand stays put | PR W35 | engine | fix | M | maybe — handup-prone | LM-070 | engine deck-hand points per body variant; renderer slide 0 |
| LM-097 | Walk-back (walk started off its route) is a straight line not clearance-checked; the adversarial spline test never forces the sharp-vertex fallback | MV:218-221,323-325 | engine | fix | S | maybe — perf-walk | — | walk-back checked; a test forces the sharp fallback (caps 0.35 / 0) |
| LM-098 | walk_to `face` may oscillate with turn-in-place | CA:168 | engine | fix | S | maybe — perf-walk | — | test: `face` converges without sign flips (may be closed by W4 splined turns) |
| LM-099 | Stair flight rise fixed (±0.08 m); stair links need ≥ 0.7 m standable deck behind the exit (forced the 6 ft deck) | PG:126-127 | engine | fix | M | maybe — planning | — | tests: a flight of another rise hooks on; a stair onto a 4 ft deck with a narrower exit zone |
| LM-100 | Sheets on rafters have no span rule (`RAFTER_SPACING_MAX` exported, unused) | FR:87-88 | engine | fix | S | no — unless sequenced | — | deck.ts refuses a sheet on rafters > 24 in, with a test |
| LM-101 | Mid-action resumability restore limits: events start empty, no teleport baseline on the first restored tick, the runner budget counts from resume; walk_to's detour closure is not codec-able | EV:304,500; TP:284,293-296 | engine | fix | S | no | — | tests: teleport on the first restored tick is flagged; detour stored as data |
| LM-102 | Per-year north bearing mechanism: one global `NORTH_AZIMUTH_OFFSET` (−90) for every scene (sun.ts:42 "open follow-up"); the values are content (LM-186) | OWNER_DECISIONS A3 entry; CD:159; CS:65-79; RC:384-397 | engine | fix | S | no — env is outside physicalView; studio/camera baselines yes | — | `northOffset(year)` plumbing with a table defaulting to −90; env-sun.test per year |
| LM-103 | Door metadata lives on the Kit mesh only; the year-file schema and engine have no door objects or state | CS:213-217 | engine | fix | M | maybe — year scene contentHash | — | door entity with an open/closed state that blocks walkers and camera, with a test (which doors existed is content) |
| LM-104 | Incremental grids: sync equality not checked on the uncropped campus | EV:300,440 | engine | fix | S | no | — | campus-full test asserts incremental = full rebuild |
| LM-205 | Rules version is a hand-kept string (`mars-engine/1+${ASSEMBLY_RULES}`); catalog/asset definitions are not hashed into plans/takes | SP:226,254,274 | engine | fix | M | yes — stored plans go stale; take rulesVersion fields | — | rulesVersion derived from engine rule sources + catalog hash; test: editing a catalog def changes it and stales a bound plan |
| LM-206 | Inventory modes only hash-tested: nothing shows `unlimited` spawns parts under the same handling/collision rules, or `finite` refuses | SP:218 | engine | fix | S | no | — | api test for both modes |
| LM-207 | No "installation close-up" semantic shot; subject-specific visibility (hands, beam end, receiving seat) untested for an installation | SP:202-203 | engine | fix | S | no | — | shot kind (or direction framing) plus a connect_beam shot scored on hands + beam end + seat |

## 3. Simulation

| id | item | source | category | proposed | effort | moves pins? | depends on | notes |
|---|---|---|---|---|---|---|---|---|
| LM-023 | [E1] Social approach points and table standing points are not reserved (others make the sitter/taker yield or replan) | EV:295,359; SO:148-149; IT:94 | simulation | fix | S | maybe — meal | — | test: two people converging on one approach or standing point resolve without a push |
| LM-026 | [E3] A pre-empted sit/converse is not resumed; a converse loses all its members; no group re-forming | EV:295,320,359,768,798,947; HO:623; SO:101-102,151-154; PR W25 | simulation | fix | M | no — no pinned scenario pre-empts | — | social test: the pre-empted sitter returns to the same seat after the directive; a 3-person converse keeps 2 talking and re-forms |
| LM-027 | [E3] Ambient never re-adopts a released person | EV:295,359; SO:152-154 | simulation | fix | S | maybe — takes with ambient | LM-026 | test: after a directed task the person rejoins `ambient_wander` |
| LM-028 | [E3] eat/serve overlay on a pre-empted sitter is not released (`eat.not-still`, `actor.holding`) | SO:154-157 | simulation | fix | M | no | LM-026 | test: pre-empting a seated eater sets down bowl/spoon, then the directive runs |
| LM-030 | [E3] Holding social verbs (gather, campfire_circle, take_slot) run to the 1 800 s budget without explicit `stand`; a `sit` ended by `stand` (or on benches) reports `cancelled` → plan `partial` | DD:413-417; HO:192 | simulation | fix | S | maybe — takes/step statuses | — | test: a deliberate stand completes the sit (plan `completed`); the timeout diagnostic names the holding step |
| LM-031 | [E4] Nobody can stand on the top beams: mid-bay rafters refused (`out-of-reach`), the kitchen roof deck is not sequenced, full-height upper floors not reachable | FR:106-108; PR W36; YB:435-437; PG:122-123 | simulation | fix | L | maybe — year-build if sequenced; new tests otherwise | LM-032 | a stand-on-top-beams stance/verb; a framing test places a mid-bay rafter with 0 violations |
| LM-033 | [E5] install_panel stands its crew beyond both tilt-axis ends: only alternate panels mount in a contiguous row (no side stations; 14 solar parts unplaced in A+B) | PR W13,W27; YB:251-254,305-306,372; RC:265-266; EV:309,575 | simulation | fix | M | yes — yb-AB `ddb634d6`, P chapter take | — | side-access stations; a contiguous-row test mounts every panel; re-pin A+B with a PLANNING_BUDGET reason |
| LM-034 | [E5] Solar tilt direction fixed (+pitch/+roll, no azimuth choice); legs/risers implied, not entities or BOM lines | SPT:73-77; EV:309,575 | simulation | fix | M | maybe — year-build P | LM-033 | install_panel takes an azimuth; test tilts south-facing on a deck of either orientation (45° frames are content, see LM-190) |
| LM-036 | [E6] Mid-raise cancel refused ("lowering is not yet modelled", raise.ts:386) | EV:39,200; RV:328 | simulation | fix | M | no | — | test: cancel mid-raise lowers the frame back to lying with holders, 0 violations |
| LM-037 | [E6] Carry on a stair flight: cancel refused, no mid-flight replan | CA:129-130; EV:294,337 | simulation | fix | M | no | — | test: cancel mid-flight finishes to the nearer landing and sets down, 0 violations |
| LM-038 | [E7] Mid-air install-lift cancels (connect_beam, joist, plywood, tread, flight) refused, with no cancel tests | EV:39,200; RV:327-328 | simulation | fix | M | no | — | per-verb cancel tests: set-down or a named `*.cancel-unsafe` refusal; never an unsupported load |
| LM-039 | [E8] Crews (> 1 carrier) cannot carry on stairs (`carry.level-change`, validate.ts:150) | EV:34,124,294,337,793,857; HO:242,520,639; CA:95,130,157 | simulation | fix | L | maybe — year-build if its sequences switch to crew stair carries | — | test: 2 people carry a 12 ft beam up the proving-ground flight, load tilted, every carrier on a tread, 0 violations |
| LM-040 | [E8] Stair carries: one straight flight only (`carry.multi-flight`, no landings or turning flights); no pitched loads (plywood on edge); a 2x4 cannot go onto the 1.83 m deck (`carry.stairs-blocked`) | CA:118-119,130; EV:32,98,294,337; HO:191 | simulation | fix | M | no | LM-039 | two-flight/landing fixture test plus a plywood-on-edge stair carry, or a named refusal per case |
| LM-042 | [E9] Forklift cannot swerve or reverse (it waits indefinitely behind a parked-but-ridden EUC); no three-point turns; `forklift_back` is a straight creep; fork height is not state after unloading | EV:297,321,392,785; HO:624; VE:99-100,138-139,194-195; PR W25; HU:270-271 | simulation | fix | L | maybe — probe / flagship if their forklift manoeuvres change | — | traffic test: the forklift reverses or swerves round a stopped EUC and completes; fork height persists |
| LM-044 | [E9] Forklift reach / side-shift / fork-raise not checked against other vehicles; truck body not swept against people beyond the 1.5 m stop rule | EV:297,321,392; HO:624-625; VE:131-133,195-196; PR W25 | simulation | fix | M | no | — | tests: side-shift into a parked EUC is refused; a person beside the pivoting truck body is flagged |
| LM-048 | [E9] Forklift placements must be square to a deck edge | VE:196 | simulation | fix | M | no | LM-042 | test: an angled deck placement succeeds or is refused by name |
| LM-208 | [R2] Carry transitions: no crouch/stand phase at carry pickup or set-down (carry publishes no crouch activity) | SP:130; OF:85-87 | simulation | fix | M | yes — takes, baselines, carry pins if timing changes | LM-126 | carry publishes crouch/lift phases with hand points; hand check for carriers at pickup/set-down |
| LM-083 | Items: cancelling hold_items leaves items in hand with a stale pose; `serve` ladles with whatever the other hand holds | IT:98-100 | simulation | fix | S | maybe — meal | — | cancel drops/rests or refuses; serve requires a spoon/ladle; refusal tests |
| LM-095 | [R5] Prone lying footprint checked against people only at plan time (spatial sees a disc at S) | HU:241-242; PR W32 | simulation | fix | M | maybe — handup-prone | — | lying footprint published as an obstacle; a walker is routed round a prone receiver |
| LM-105 | [E1] Ambient make-way walks submitted for people already reserved by a waiting step: 94–105 `reservation.conflict` refusals in the whole-skeleton / A+B replays (red FAILED banners) | HO:617-618; PR W14 f3,W24; SR:128-129,290-293 | simulation | fix | S | yes — yb-skel, yb-AB, chapter takes (events) | — | makeWay (walk.ts:1030) skips reserved people; whole-skeleton test asserts 0 make-way conflicts |
| LM-106 | [E1] Idle crew parked with no regard to the next section's work (moved only by make-way); kitchen A+B red on `stringer.site-occupied` | PR W27,W38; YB:370-371,465,471-472 | simulation | fix | M | yes — yb-AB, chapter takes | LM-105 | parking rule avoids upcoming work zones; 0 make-way nudges in A+B; kitchen S no longer site-occupied |
| LM-107 | chiba / west-house A+B red in D1: `s0770-walk-to` receiver spot on the first-floor deck has no standing room beside frame 9172e067 | YB:464,466,470-472; PB:422-426; PR W38; year-build-houses.test.ts:126-129 (FULL_RED) | simulation | fix | M | yes — adds full-house pins | LM-106 | receiver-spot search avoids frame planes; YEAR_BUILD_FULL chiba/west-house green (then LM-156). **Coordinate with W47 (in flight)** |
| LM-108 | Framing: one person per frame face per height band; no runtime make-way for givers (feet checked vs bystanders at plan time only); sliding over something taller refused (no lift-over) | PR W36; FR:169-171,176-177 | simulation | fix | M | no — framing tests only | — | tests: two people on one face at one band with separation; a walker entering the givers' path is asked to make way; a lift-over path |
| LM-109 | Framing and beams: member balance in two hands unchecked beyond one holder ≤ 1.5 m; hand-offs are instantaneous grips | FR:172-173; YB:183-184; EV:311,605 | simulation | fix | M | maybe — year-build | — | balance check plus blended hand-off, tested |
| LM-110 | Set-part bystander rule looks 1.2 m ahead along the lift crew's feet, not the part's sweep through a body band | PR W27 | simulation | fix | M | maybe — yb-AB | — | test: a person beside the path whom the part (not the feet) would hit is flagged |
| LM-111 | Hand-up: a sheet is never turned over the bay (forks deliver only sheets parallel to the edge) | EV:306,531; HU:257-258 | simulation | fix | L | maybe — v3 | LM-093 | turned-sheet hand-up test, **or** re-classify (lead): a new manoeuvre, not a gap; see §9 |
| LM-112 | Hand-up: receivers > ≈ 2.55 m above the givers need the forklift; mixed prone + kneeling crew supported in code but never exercised | EV:306,531; PR W28 | simulation | fix | S | no | — | forced mixed-crew fixture at 0 violations; the row note cites the prone 2.75 m reach (W29/W32) |
| LM-113 | Hand-up v3 has no campus variant (the `onto_s2_4` beam_walk knife edge was fixed by W27, 17/17 origins; not re-proven at staging-east) | EV:306,315,531,674; HO:580-581,612-613; PR W17,W27 | simulation | fix | M | yes — adds a campus v3 pin; takes | — | v3 at 2026 staging-east with 0 violations and a margin ≥ 0.28 m, mapped to the row |
| LM-114 | Rigid carry formation: no re-grip, side change, shifting along the load or pivot round the rear carrier; loads stay level (no tilting over a rail) | EV:34,124; HO:243; CA:156-159 | simulation | fix | L | maybe — carry routes G, flagship | — | a 2-person crew pivots a 12 ft beam round a corner that fails today, **or** re-classify (lead): SP §11 asks for whole-formation validation, not re-grip; see §9 |
| LM-115 | Social: seat collision by activity (`SEATED_ACTIVITIES`), not per fixture; fixture obstacle is its full catalog box (chair back included); mirrored approach steps over a chair back | EV:295,359,798; SO:50-53,146-150 | simulation | fix | M | maybe — meal, takes | — | per-fixture seat volumes; tests: a sitter off-seat is flagged; a front-walled chair uses a side approach |
| LM-116 | Social regions are single-level; audience layouts don't seat people on benches inside the region | SO:158 | simulation | fix | M | no | — | test: an audience region with benches seats people on them |
| LM-117 | §30 H: no party/dance verbs; riding not composed into a social scene | EV:798,947; SP:342 | simulation | fix | L | no — new scenarios | LM-026 | SP §30 H lists party/dance/riding. Fixed = a dance activity composed from existing gather/social verbs plus a social scene with a rider, both tested; the lead should confirm it is in scope (§9) |
| LM-118 | Painting: the band below 0.5 m (crouching) is out of reach; painter goes idle between columns (W10 "bug found", fix unconfirmed) | EV:310,587; SPT:81; BM:26; PR W10 | simulation | fix | M | maybe — paint tests | LM-070 | crouch-paint posture paints the bottom band; test asserts continuous activity between columns |
| LM-209 | Doorway approach untested (only door: 2024 solarium) | SP:117 | simulation | fix | S | no | LM-103 | walker through the solarium door approaches roughly square to it, no side-slide |
| LM-133 | [R4] Items don't collide with each other (a 0.32 m pot on the 0.3 m lattice overlaps its neighbours) | EV:308,562; HO:634; IT:95; PR W5 | simulation | fix | M | maybe — meal | — | item–item footprint invariant on surface slots; test: pot next to bowl is refused |
| LM-134 | [R4] Lap support (bowl on a seated person's knee) not implemented | IT:32-33,99; PR W5 | simulation | fix | M | maybe — meal | LM-133 | `put_item` to `lap` test with a seated eater |
| LM-135 | [R4] Prone grip is always the load point nearest S and lands beside a joist end (hands ≤ 1.9 cm inside j3/j6 ends) | PR W32,W35 | simulation | fix | M | maybe — handup-prone | LM-093 | grip choice along the edge avoids members; prone.spec hand vertices 0 cm inside |

## 4. Renderer

| id | item | source | category | proposed | effort | moves pins? | depends on | notes |
|---|---|---|---|---|---|---|---|---|
| LM-059 | [E12] Parity measured on one take only; no campus-through take (Chiba, trailers) to validate thin-member/roof prisms | CV:89-92,133-134; EV:299,425 | renderer | fix | M | no | LM-058 | camera-verify.spec on a campus-through take, 0 samples ≥ 0.2 |
| LM-119 | Vehicles/forklift: no lean, wheel or balance kinematics for EUC/bicycle (visual) | EV:296,376; VE:138-139 | renderer | fix | M | yes — baselines | — | renderer lean from curvature × speed with a capture; engine stays kinematic (SP §32 excludes dynamics) |
| LM-120 | [R1] talk / watch / listen render as plain Idle (humans.ts has only sit/warm branches) | HO:216,520,639; SO:159-162; LG:31 | renderer | fix | M | yes — baselines (lab-social, campfire) | — | distinct poses keyed on activity; pose-probe capture per activity in lab-social spec |
| LM-121 | [R1] No conversation turn-taking, gaze or gestures | EV:295,359,798,947; SO:151 | renderer | fix | M | yes — baselines | LM-120 | converse publishes the current speaker; heads turn to speaker/focus; spec asserts gaze direction |
| LM-122 | [R2] Rig reaches only 92.5 % (hand-up v3) / 76.6 % (year build) of engine hand points; a reach-down palm is 1.025 m off (t 2682.3 s); p4 stand_with_load 28/32 and 25/32; footers and the far arm | HO:519-522,544,615-616,621-622; PR W6,W9,W14,W29,W35; PO:148-162,256-258; SR:446-449 | renderer | fix | L | yes — baselines (poses-*, year-build) | LM-084, LM-070 | the engine never publishes a rig-unreachable point (invariant) and the renderer reaches 100 % of reachable points; hands-check/prone.spec floors raised to 100 % |
| LM-123 | [R2] Footer's arms hang until the column is within reach during a raise | PR ~20:00 caveat | renderer | fix | M | yes — baselines (poses-raise-footer) | LM-122 | poses spec asserts footer hands on the upright every raise tick |
| LM-124 | [R2] Posture blend lags the engine's hand points by up to 0.4 s (crouch misses) | PO:132-133,330 | renderer | fix | S | yes — baselines | — | blend leads/limits so poses.spec crouch counts reach 100 % |
| LM-125 | [R2] Postures have no side lean, stepping or torso twist; 150° kneel puts the head below the deck; one closed-hand curl for every grip | PO:316-320 | renderer | fix | L | yes — baselines | LM-122 | side lean/twist in posture.ts (year-build reach numbers rise); per-grip hand shape, or accepted as a v1 rule by the lead |
| LM-126 | [R2] Carry/hold poses: carriers play Walk/Idle with a procedural lean; speed-matched walk while carrying unverified; lift/set-down interpolate Euler angles with no ground contact during the tilt | EV:34,124,793,857; HO:449; CA:166-167 | renderer | fix | M | yes — baselines | — | hands on grips every carry tick (hands-check); walk cadence matches speed; the plywood flat→edge tilt never penetrates the ground (pose audit) |
| LM-127 | [R2] Take replay seats default to 0.45 m (takes carry no fixtures); the seated drop is the engine's, not the rig's | IT:101; PO:293-294,332 | renderer | fix | S | no | — | replay reads the seat height from entities0 fixtures; test: eater hips at the fixture seat |
| LM-128 | [R3] Beam walking is the Walk clip at half weight, with no foot placement on the 0.1 m flange | PO:186-187,325-326 | renderer | fix | M | yes — baselines (poses-beam-walk) | — | poses.spec: beam-walk soles within 3 cm of the flange top every step |
| LM-129 | [R3] Frame-climb rungs at 0.35 m pitch are not IK'd to the drawn bracing rods | PO:189-190,324-325 | renderer | fix | M | yes — baselines | LM-085 | climbing feet on drawn rod ends (or the published node), asserted |
| LM-130 | [R3] Climb-wait can keep a foot mid-swing; turning in place plays Idle | PO:326; HO:217; EV:792,841 | renderer | fix | S | yes — baselines (stairs) | — | both feet planted on climb-wait (stairs.spec); a turn-step clip with a pose test |
| LM-131 | [R3] Studio take host passes no base scene, so campus stairs in a take are not walked tread by tread | PO:307-308 | renderer | fix | S | no | — | take-host passes the campus SpatialScene; test with a take on campus stairs |
| LM-132 | [R4] Renderer body-vs-object collision: squatting foot overlaps parts, crossed knee touches the bowl, thighs clip chair arms; arm vertices ≤ 1.9 cm inside joist ends, fingers 4–7 cm below d0's top (logged, not asserted) | PO:264-267,322-323; PR W32,W35 | renderer | fix | M | yes — baselines | LM-133 | vertex-vs-part penetration asserted 0 in poses/meal/prone specs |
| LM-136 | [R5] Prone replay is not exact: replay rises on smooth(phaseK) while live waits for the load (≤ 0.78–0.79 behind at p4 kneel-up); torso pitch search differs without the previous tick (≤ 0.6 rad, head 0.33 m) | SR:236-240; PO:209-213,311-315; PR W35,W37 | renderer | fix | M | yes — baselines (prone-*) | LM-094 | the engine publishes the torso tip / a rise the body can follow, so live == replay within tolerance; studio-take-prone.spec asserts it |
| LM-137 | [C4] `verifyCamera` cannot select a file-carried track (`{ track: { file } }`) | CD:423-424 | renderer | fix | S | no | LM-013 | e2e verifies a file-carried directed track |
| LM-138 | [C4] No camera picker for chapter sets; a directed track is not held; a saved track plays only through the panel | SR:461-462,477-478; PR W48 | renderer | fix | S | no | LM-013 | studio-build.spec picks a saved directed track for a chapter |
| LM-139 | Chapter-set hold tails are locked off (workers walk out of frame, ≤ 84 set-s at 64×); single takes have no shot hold | SR:190-191,466-467,471; PR W48 | renderer | fix | M | no | — | held tail tracks its subjects or cuts; hold applies to single takes; spec asserts subjects in frame |
| LM-140 | Walk weight steps at a chapter seam (±0.15 s speed window clamped at the take edge) | SR:468-470; PR W48 | renderer | fix | S | no | — | window reads across the seam; seams test asserts weight continuity |
| LM-141 | Chapter panel covers the bottom ≈ 20 % of the frame (and its captures); the option text uses a head-noun rule tuned on A+B labels | SR:460-461,463-464; PR W37 | renderer | fix | S | yes — baselines (studio-build) | — | panel doesn't overlap the frame (layout test); captures with the panel closed; a label test on another set |
| LM-142 | Studio take loader checks only wrapper, camera/take id and final hash | EV:318,737 | renderer | fix | S | no | — | the loader validates the full take (hash chain / schema), with a corrupted-file test |
| LM-143 | 2021 central upright still drawn `#293c45` (scenes.ts:113); lab solar-paint pv2 rolled about the wrong axis (low edge 0.34 m in the ground) | PR W50 (orphaned by the cancelled W53) | renderer | fix | S | yes — baselines (studio-2021-*, solar-paint-*) | — | RACK_FRAME_GREEN; the lab scenario uses the engine's tiltedPose; spec asserts no vertex below ground |
| LM-144 | Fire: smoke faint in the wide oblique preset, core saturates white, flat from overhead, small in the top preset | HO:634-635,713; PR W3,W45; CX-fire:30,63 | renderer | fix | M | yes — baselines (fire-*) | — | **[Codex]** fire.ts; smoke visibility metric in the oblique view in fire.spec |
| LM-145 | Paint coverage is colour + stripe / image, not a texture mask (incl. 2024 mural) | EV:310,587; HO:546,635,713 | renderer | fix | M | yes — baselines (render-polish, solar-paint) | — | **[Codex]** paint.ts; coverage mask from the engine's painted rectangles; the mural design is content (LM-188) |
| LM-146 | Replay independence: the browser renderer's camera path is not in the suite | EV:42,241 | renderer | fix | S | no | — | e2e: switching camera tracks in studio leaves take hash and final state unchanged |
| LM-147 | /studio takes ≈ 2 min to become ready (38.5 MB GLB at ≈ 310 KB/s); 2026 studio 1 083 draw calls / 957 k tris | PR release 4; HO:282-283 | renderer | fix | M | no | — | meshopt-compressed GLB (the dependency is already present) plus a load-time bound; or the lead records it as a hosting note, not a spec gap |
| LM-210 | Weather/environment visuals (cloud, rain, wet ground, screens/projections) have no visual test; the control plane checks state only | SP:210 | renderer | fix | S | yes — new baselines | — | studio capture under the rainy preset with a pixel assertion |
| LM-211 | Sit exactness (pelvis on the seat surface, feet on the ground) not measured (lab-poses checks sit weight = 1 only); raise lifters' "hold high" not asserted (only footer low) | OF:92-93,243-245 | renderer | fix | S | no | LM-123 | bone-height assertions in meal/lab-poses specs; lifter hands on grip slots in poses.spec |
| LM-212 | Firelight on nearby people at dusk not asserted (captures only); the Studio campfire (scenery.ts → createFire) has no studio test; tire ring / roof ballast tires have no numeric ground-contact test | OF:10-13,285-289 | renderer | fix | S | no | — | **[Codex]** fire.spec firelight metric; a studio fire frame-diff check; history-geometry assertion for the ring + ballast |

## 5. Tooling

| id | item | source | category | proposed | effort | moves pins? | depends on | notes |
|---|---|---|---|---|---|---|---|---|
| LM-015 | [C6] Integration does not call every tool: `engine_direct_camera` is only name-listed (simulation-integration.mjs:63), never called; the gate runs integration only when `SIM_BASE` is set | HO:398-400; DD:61; LG:49-57; W55 check | tooling | fix | S | no | LM-007 | integration derives the tool list from the registry, fails on any registered tool without a call, and the gate starts a wrangler dev so it always runs |
| LM-052 | [E10] The replan budget never binds in a pinned scenario (only the 10-walker unit test) | PB:52 | tooling | fix | S | no | — | a pinned scenario (or perf-walk bench) where the budget binds, asserted |
| LM-148 | [E14] Lint is red: **123** findings on HEAD (was 114 at W45) and there is no lint stage in `deploy/gate.mjs` or RELEASE_CHECKLIST | HO:522-523,640,714; PR W33,W45; CX-tool:19,23,111; W55 run | tooling | fix | S | no | LM-149…151 | **[Codex]** gate lint stage + RELEASE_CHECKLIST line once LM-149…151 bring it to 0; gate fails on any finding |
| LM-149 | [E14] Lint findings in `engine/**` excluding tests (60): unused-vars, no-new-array, require-array-sort-compare, no-useless-spread, prefer-const, no-explicit-any, no-useless-fallback-in-spread, no-this-alias (runtime.ts:270), no-base-to-string (framing.ts:164); includes LM-072/073 | lint (engine/camera 14, construction 12, campus 11, runtime 9, vehicles 4, locomotion 3, actions 3, + 1–2 each in scenarios, rehearsal, env, core, api, spatial, items, carry) | tooling | fix | M | maybe — sort comparators on hashed collections; every pin re-checked | LM-072, LM-073 | 0 engine findings; the full gate (probe + perf-walk + year-build pins) unchanged, or re-pinned with a reason. `require-array-sort-compare` (13) can change order, so review each |
| LM-150 | [E14] Lint findings in `engine/test/**` (22): unused imports (core.test.ts ×3 per CX-tool, take-chapters Runtime), unbound-method (grid-incremental ×2, walk-perf), prefer-string-starts-ends-with | lint | tooling | fix | S | no | — | 0 findings in engine/test |
| LM-151 | [E14] Lint findings in app/deploy/simulation (26): app/lab 7, app/engine-view 7 (restrict-template components.ts:340), app/studio 2; simulation/worker.ts await-thenable ×2 (262, 383); deploy/group-2026-frames.mjs constant `??` ×2 **[Codex]** + 2; perf-walk 2, evidence-report 2, questions-html 2, record-campus-take, director-demo, gate.mjs control-regex (22) | lint | tooling | fix | S | no | — | 0 findings; worker.ts awaits reviewed (behaviour unchanged, integration green) |
| LM-152 | [E14] Wall-clock perf tests (bounds loosened to 250/120 ms) flake under worker load | PR ~03:00, lead 13:55 | tooling | fix | S | no | — | CPU/profile counters or a gate-excluded bench; 0 flakes over N gate runs |
| LM-153 | [E14] Gate reports `gitDirty: true` from the untracked `viewer/.pw-browsers` symlink; main's node_modules needed `npm ci` for oxlint-tsgolint | PR W33,W45 | tooling | fix | S | no | — | .gitignore entry; gate on a clean tree says clean |
| LM-154 | [C6] Evidence report does not run or ingest proofs outside the node suite: simulation-integration (DO path), Playwright (poses, camera-verify, baselines), `record-campus-take --check`, `deploy/history-ids.test.mjs` (15 rows cite them) | EV:42-45,257,274,288,299,301,302,314,317,318,469,737,791,820 | tooling | fix | M | no | LM-015 | evidence-report.mjs ingests the last gate JSON per step and records pass/fail per cited row |
| LM-155 | Skipped tests: YEAR_BUILD_FULL (year-build.test.ts:93, year-build-b.test.ts:152, year-build-houses.test.ts:149, e2e/year-build.spec.ts:258) and CAMPUS_FULL (campus-extract.test.ts:77) never run in the gate | EV:13,311,605,616,1007,1071; W55 rg | tooling | fix | M | no — they assert existing pins | — | a `gate --full` (nightly) step runs them and the report records the result; "skips → documented" per OWNER_DECISIONS |
| LM-156 | Full-house pins for chiba/kitchen/west-house empty (`PIN_FULL` ticks 0, year-build-houses.test.ts:131-135); `todo: FULL_RED` | YB:469-470; year-build-houses.test.ts:126-135 | tooling | fix | S | yes — adds pins | LM-107, LM-106 | fill PIN_FULL once green, **or** drop the todo tests and point at LM-189 if the lead parks the houses as content |
| LM-157 | Manifest-guarded skips (`camera-chapter-shots.test.ts:105`, `take-labels.test.ts:35`) and capture-only e2e (`questions-captures.spec.ts:242`) | W55 rg | tooling | fix | S | no | — | manifest guards fail instead of skip (the manifest is committed); questions-captures documented as a capture tool, outside the test count |
| LM-158 | `record-campus-take --check` repeats two 13-min rehearsals for the chapter set; studio-build.spec replays every year-build entry (long e2e) | PR W27,W31 | tooling | fix | M | no | — | --check reuses one rehearsal or checks the chapter hash chain; spec samples chapters |
| LM-159 | Concurrent e2e runs sharing test-results delete traces and fail teardown; take-fixture specs (meal, stairs, studio-take-prone) prove replay with a fixture, not real recorder output | CV:22-23; PO:300-302 | tooling | fix | S | no | — | per-run output dir; specs load TakeRecorder output and drop take-fixture.ts |
| LM-160 | Screenshot baselines with unexplained drift left unrefreshed (solar-paint ×2, poses-handup 1.24 %, poses-beam-walk, build-bay ×3, lab-narrow-passage, lab-social-t65, lab-stairs, meal-spoon, year-build ×2; poses-raise-footer 1.520 %) | PR W45,W50; CX-fire:43-56 | tooling | fix | S | yes — baselines | — | each inspected and refreshed or explained; full e2e drift 0 above threshold |
| LM-161 | Worst-sample captures of take-less tracks use the studio fov, not the track fov | SR:479-480 | tooling | fix | S | yes — camera-verify captures | — | captures use the track fov |
| LM-162 | Campus extraction: Chiba 2026 kitchen/café details and gallery screens are procedural in the studio, not in the engine scene; prisms are OBBs of render geometry (parts within 0.5 m merge) | CS:133-136; HO:265-266 | tooling | fix | M | yes — campus `c56ea8da`, contentHash | — | details extracted via the Kit path; thin-member extraction test vs mesh (materials/terrain stay content) |
| LM-163 | Duplicate kind+placement in one assembly would get order-dependent `-2/-3` suffixes (none today); `legacyKinds` kept in take-sampler.ts only for a regression test | HI:18-19; CD:403 | tooling | fix | S | no | — | history-ids test asserts no duplicates; legacyKinds removed with its test retired |
| LM-164 | Deterministic trig checked on one host; cross-host equality by hand; non-Chromium browsers unverified | EV:303,485 | tooling | fix | M | no | — | automated check: workerd (wrangler) + Playwright chromium/firefox/webkit stateHash equal the probe |
| LM-165 | No camera track rendered to video and reviewed; no committed campus-build video | EV:41,228,797,929; HO:207-209,445-448 | tooling | fix | M | no | — | Playwright renders one directed track to video as an artifact; the review verdict is Gene's (content) |
| LM-166 | Lab has no scenes for EUC/bicycle, forklift, single-carrier stairs, flagship v2 | LG:59-63 | tooling | fix | M | yes — new baselines | — | lab presets with expectations; the lead may treat this as out of the last mile (§9) |
| LM-213 | Lab diagnostic overlays lack support relationships, general reservations (only slots + traffic), object ids and camera visibility rays | SP:295,385 | tooling | fix | M | maybe — lab baselines | — | overlays toggled in a lab e2e with captures |

## 6. Evidence

| id | item | source | category | proposed | effort | moves pins? | depends on | notes |
|---|---|---|---|---|---|---|---|---|
| LM-167 | [V1] EVIDENCE.md is stale: generated at `d91057b` (HEAD `78cd157`), 58 vs 63 test files; unmapped: camera-chapter-shots, camera-parse, source-scan, take-labels, year-build-houses + 90 unmapped tests (framing, prone hand-up, kneeling rise, chapters, set-part bystander) | EV:11-13,953-1071 | evidence | fix | S | no | — | `npm run evidence` regenerated with evidence-map.json covering every test (0 unmapped) |
| LM-168 | [V1] Year build phase B row PARTIAL 3/4 though `PIN_FULL_AB` is now set (year-build-b.test.ts:150); no default-suite test executes the stair / wall / solar sections | EV:15,312,616,620; HO:545,581,610-611; PR W17,W26,W40 | evidence | fix | M | no — new tests assert the existing pins | LM-155 | per-section executed tests from chapter checkpoints (S, W, P) in the default suite; row PROVEN |
| LM-169 | [V1] Row notes contradicted by code: "no design-edit engine op" (edit_world exists), "19 ft only refused" (19 ft bay test), stair "root-motion only, no foot IK" (W6 IK), "reach-down ≤ 0.5 m" (prone 2.75 m), "v3 not a campus take", "B not recordable" (chapters), historical "no build" (2022 year build), carry "no replan yet" | EV:32,33,35,43,44,98,294,298,306,311-318,409,737,794,874; CA:108-110,160-161,165; PG:77,124-125 | evidence | fix | S | no | LM-167 | notes rewritten from the regenerated report; each claim cites its test |
| LM-170 | [V1] Rows proven only on synthetic/proving ground: wall avoidance (one wall, no contact-duration metric), U-trap (one U, one start/goal), camera collision, pre-emption, vehicle traffic, EUC/forklift, 19 ft raise beside structures, construction-changes-navigation on campus, one bay only (milestone E) | EV:29-31,35,36,40,57,68,142,157,215,296,297,320,321,376,392,768,785,795,894 | evidence | fix | L | maybe — planning budget for campus runs | LM-113 | campus or second-geometry variants per row (wall-contact metric, seeded U-trap sweep, campus traffic/pre-emption/raise, multi-bay run) |
| LM-171 | [V1] Historical routes proven in 2021 and 2022 only | EV:298,409 | evidence | fix | M | no | — | route test per year 2020–2025 on the published scenes |
| LM-172 | [V1] No-walker-jumps bound measured on stress-30 and campfire only; kneeling rise past joist ends not in any pinned scenario; replan budget (LM-052) | EV:319,750; PR W30 | evidence | fix | S | no | — | per-tick bound asserted on every pinned run; handup fixture cited by a row |
| LM-173 | [V1] Stale numbers/claims in area docs: CAMERA.md 60–80 ms (measured 159; no perf test in camera.test), GPU picking "next step"; CAMERA_VERIFY fixes 1–4 and per-sample subjects done; CAMERA_DIRECT render verify done; CARRY measured table; MOVEMENT climb-wait Walk, `speed` not recorded, "+10–25 %"; POSES body-model table ("Open"), `contents` not recorded; BODY_MODEL crouch 0.55 vs 0.50, CARRY_Y 0.72/0.75/0.80; ITEMS meal pin `baf84de6`; HANDUP proneYaw/phaseK FIELDS; SOCIAL sit pose; PROGRESSIVE hand-up + swept lifts; CAMPUS_SCENE crop pins + seeds "not done"; TAKES_AND_PLANS flagship /2 + payload table; STUDIO_REPLAY:38-40 flagship /2; PLANNING_BUDGET old pin text + loaded-host perf; YEAR_BUILD "Phase B needs" list; LIFT_CREW_PLAN done | CM:139,141,148-152; CV:30-32,114-132; CD:380; CA:153; MV:168-175,207-211; PO:43-56,331-332; BM:39,93,142,167-168; IT:85-87; HU:210-211; SO:144-145; PG:77,124; CS:124-130,168-170; TP:195-199,311-324; SR:38-40; PB:93-95,191-193,207-215,259,330-331,362-363; YB:190-196; LC:1 | evidence | fix | M | no | LM-167 | one doc-hygiene pass: each line fixed or struck, with a `Last verified: <sha>` stamp per doc |
| LM-174 | [V1] Stale top-level docs: HANDOFF headers ("engine not deployed", "DO timings unverified", 548 vs 565.6 s), LAB_GUIDE (release 5, tool counts), DIRECTOR_DEMO transcript ids (09-27 run) and tool lists, lab README perf table, LIB_EVAL experiment D (SE(2) planner) unmeasured, OWNER_DECISIONS 09:45 Codex ownership (scenes.ts, thinning), app/lab/solar-paint.ts "hashed stripes" text (4–5, 79), components.ts "blue" comment; flagship non-historical label needs an e2e check | HO:80-81,155-156,161,166,172-173,260-262,322,433,703-705; LG:1-4,41-57; DD:33-35,366-390; PR W33,W45,W50 | evidence | fix | S | no | LM-011 | HANDOFF "Known shortcomings" reduced to pointers into this file; a re-run director-demo; an e2e asserting the hypothetical banner on every flagship view |
| LM-175 | [V1] Every EVIDENCE row carries an approximation note (53/53) | EV (all rows) | evidence | fix | S | no | all fix rows | final pass once the batches land: each note is either gone (fixed) or one sentence pointing at its LM re-classification |
| LM-214 | [V1] The primary acceptance test (every person's and material's final state traced to action records, supports and the precondition that allowed the next action) has no test; no foot-sliding metric | SP:82,327 | evidence | fix | M | no | — | test over the flagship take traces every final entity state through the log; foot-slide metric asserted ≈ 0 |

## 7. Content (Gene's historical reconstruction; re-classified)

| id | item | source | category | proposed | effort | moves pins? | depends on | notes |
|---|---|---|---|---|---|---|---|---|
| LM-176 | Campus interiors, upper floors, decks, stairs and doors are not walkable/modelled (2026 ground level 0 only, 152 `interior:` blockers; 2026 has no kitchen/sink; doors exist only in the 2024 solarium) | EV:33,37,110,170,316,700; HO:227-228,456,629,705; CS:82-89,159-161; CD:348-352 | content | re-classify: content | — | — | — | real floors/stairs/doors need Gene's photos; the engine supports them (progressive decks, stairs, LM-103 doors) |
| LM-177 | Historical years are procedural hypotheses (2021–25 provisional); flat terrain; glass vs plexiglass; vehicles by CAD name; plexiglass glare | EV:298,409; CS:46-47,92,137,155-157,239 | content | re-classify: content | — | — | — | survey/material data is Gene's |
| LM-178 | 2026 rack members are CAD posts (4.29/4.88/5.97 m, 1.02 m deep, 81 frames `catalogDef` null; 12 beams miss posts by 0.21 m) and are not wired into assembly.ts | HO:21-23,263,711; CS:140; PR W45; CX-2026:33,45-49 | content | re-classify: content | — | — | — | Codex's grouping tool is done; a 2026 year build is reconstruction work (Q5 open) |
| LM-179 | 2020 Portal/Forest (364 parts) and 2025 (39) racks don't map to catalog frames; other years need rules (non-whole-foot decks, walls, 12–41-tread stairs, modules, roofs, doors, windows) | HO:611; YB:31,35,308-319,375-376 | content | re-classify: content | — | — | — | per-year reconstruction data |
| LM-180 | Catalog dimensions provisional: 9 ft frame, deck/stair/tread, plywood-4x6, stair-flight-10, upright-16ft-kit seats 0.22/2.48/4.757, bundle capacities, item sizes; plywood span ≤ 24 in vs 4 ft brief | HO:231-233,264,269-270,522; EV:794,795,874,894; PG:44-46,109-112; YB:59-63,75-76; IT:8 | content | re-classify: content | — | yes if changed — year-build, flagship | — | owner dimensions and rules (QUESTIONS_FOR_GENE Q5 etc.) |
| LM-181 | Build order, piles, crew, staging placement (algorithmic) and the campus flagship are hypothetical; composite v2 layouts tuned until refusals stopped; W13/W38 provisional rules (11 + 7); east-house yard v1 vs v2 re-pin | EV:311,315,605,674,796,911; HO:190-191,270-271; CS:138-139; PR W13,W38,W46; YB:403-407 | content | re-classify: content | — | yes if changed — year-build, chapter takes | — | SP §32 non-goal "perfect inference of undocumented build sequences"; Gene decides the real order/yard |
| LM-182 | 2022 reconciliation steps a–k (names, pinwheel, trailer train, stairs parallel, south solar on 45° frames, SW table, joists → plywood, roof 2x4 framing, 2023/24 trailers out of Chiba, sideways 3 ft row) incl. their engine parts (joist verb, retire beamDeckRule, stringer/tread across the depth, solar-frame-45 part, framing in yearBuildRegistryB, joist-crossed beam access) | RC:57-441; FR:9-11,19,150-166,179; PR W36,W49,W51; YB:248-250,304-306,372-374 | content | re-classify: content | — | yes — mars-2022/23/24 contentHash, every 2022 year-build pin, chapter takes | — | Gene parked reconstruction (OWNER_DECISIONS); W51 lands its green checkpoint; the engine parts are only needed for the reconstruction. HISTORICAL_CONTENT.md (W56) carries the recipe |
| LM-183 | Ground datum: the build ground is the Kit y = 0, 0.16 m above the studio ground, so rebuilt racks draw 0.16 m below the Kit's; 2026 GROUND_Y vs CAD rack feet | EV:311,605; HO:630; PR W19; YB:187; SR:246-255,436-437; RC:57-89 | content | re-classify: content | — | yes — studio/lab year baselines; perf-walk if 2026 GROUND_Y moves | — | Gene answered y = 0 (Q4); implementing it is W53's cancelled reconstruction step |
| LM-184 | Other 2022 houses (chiba, kitchen, west-house): full A+B runs and their W/P/END sections | HO:611,720; PB:422-426; YB:472; PR W38,W47 | content | re-classify: content | — | — | LM-107, LM-106 | which houses existed and how they were built is Gene's; the engine refusals they exposed stay as LM-106/107 |
| LM-185 | Stair parts unplaced (2 rail posts inside the end frame, 3 risers), kitOffsets stair 2.017 m, panels over frame lines (columns 5 cm above the roof deck), Kit roof rail posts / 36 ft railings, the long sloped 2x4 ramp | PR W13,W27; YB:248-250,304-306,372-374; FR:150-155,179; HO:635-636 | content | re-classify: content | — | — | — | Kit geometry questions (Q19, Q29, Q30); the 2.017 m offset should be checked once to rule out an engine bug |
| LM-186 | Per-year north bearing values: 2026 CAD ≈ −57° (33° off), 2025 ± 20°, 2024 kitchen/RV side, 2022 mirrored / "8 o'clock", 2021/2023 unverified | HO:234-235,522; EV:316,700; CS:65-79; PR W42,W44,W49; RC:384-397,448-453; OWNER_DECISIONS A3 | content | re-classify: content | — | studio baselines when set | LM-102 | Gene's photos/answers (Q20–Q22); the mechanism is LM-102 |
| LM-187 | Kit/prop and facade residuals: deck tops at y = 0 heights, fridge vs counter, 2020 counter legs through bins, rv-8/9 (2023) and rv-9/10 (2024) inside Chiba, café counter 19 % squash, 2026 details unseated, 2022 seating held; Chiba 2024 width 6 vs 7 bays, PV rows, flap 29.7°, doorway upright, solarium floor, end wall, no furniture, roof railings; lab scene findings (SW corner, trailers) | PR W43,W46; CS:184-243; LG:34-35 | content | re-classify: content | — | — | — | photo reconciliation, parked; W51 is landing trailers-out-of-Chiba |
| LM-188 | Camera thresholds chosen, not measured against footage (squeeze 1.2 m / 1.0 m / 0.3 m / 0.5 s, phase-2 readability); the 2024 flower mural placement/crop; frame colour per year; year-build crew generic (no fatigue, breaks, others on site) | EV:317,722; CD:376-377; CX-fire:63; YB:188 | content | re-classify: content | — | — | — | owner taste and historical record, not engine behaviour |
| LM-189 | Stable ids change when a piece moves ≈ 2.5 cm / 1° or changes kind (plans must pin names) | EV:301,452; HI:25-26 | content | re-classify: content | — | — | — | by design: ids hash the placement, so an id change is a geometry (content) edit |
| LM-190 | Rails assumed screwed to sheets; sloped roof decks not modelled; Q14 "the forklift must stay supported" ambiguous; 2022 trailer/solar/stair specifics | EV:309,575; SPT:78-79; RC:444-447 | content | re-classify: content | — | — | — | roof slopes and forklift practice are Gene's answers |
| LM-215 | Cross-year identity for named assets (which trailer/RV is which across 2020–2026); SketchUp proposals must not override photographic evidence; install verbs/material rules for doors, windows, roofs, railings, fixtures (bom.ts UNRESOLVED_WHY); OF §7 all seven years built and §9 every year's arrays | SP:42,56,347; OF:120-142,160,213-217 | content | re-classify: content | — | — | — | per-year reconstruction data and process rules; the per-year verbs are new features only if a year needs them (lead, §9) |

## 8. Out of scope by spec (re-classified)

| id | item | source | category | proposed | effort | moves pins? | depends on | notes |
|---|---|---|---|---|---|---|---|---|
| LM-191 | Scanned representations of real Martians | HO:252,640 | out-of-scope | re-classify: out-of-scope | — | — | — | SP §32 "photorealistic scanned representations of real Martians" |
| LM-192 | Electrical: no wiring for solar/equipment, no electrical simulation for place_equipment, no EUC charging/battery/range | EV:309,575; HO:251,640; SPT:36; VE:143 | out-of-scope | re-classify: out-of-scope | — | — | — | SP §32 electrical-grid simulation; SP §19 "not required now" |
| LM-193 | Rule-based support / assembly model, not structural engineering: support predicate, frame load / clip-on, fasteners, toe-nails / hurricane ties, load/span/deflection, the "Mars assembly model v1, approximate" disclaimers | EV:35,142,307,547,874; PG:5-6,126; FR:9,174-175; YB:8,182; HU:6; SPT:5 | out-of-scope | re-classify: out-of-scope | — | — | — | SP §32 "engineering-grade structural analysis … safety certification"; SP §6/§8 ask for believability, not certification |
| LM-194 | No rigid-body / body dynamics: prone lie-down / push-up / kneel-up as timed pose phases; forklift without tilt, pallets, dunnage or a load-moment chart; vehicles without dynamics | EV:297,392; HU:237; PR W28; VE:193-194 | out-of-scope | re-classify: out-of-scope | — | — | — | SP §32 "full dynamic rigid-body simulation"; SP §8 constraint-aware choreography |
| LM-195 | Branch merge; timeline editor | EV:43,257,797,929; HO:251-252; RV:303 | out-of-scope | re-classify: out-of-scope | — | — | — | SP §32 "automatic merging of arbitrary workspace branches", "Unity-like visual timeline editor" |
| LM-196 | Mid-action resumability outside walking/social (carry, construction lifts, vehicles, ambient_wander; pause refuses them); `sampleTake(t)` is visual only | EV:43,257,304,500,797,929; HO:236-237,252,457; TP:277-284; DD:319-322,357-359,405-406 | out-of-scope | re-classify: out-of-scope | — | — | LM-101 | SP §22 lines 248-249 permit "a defined subset" with limits stated; the subset is walking + social and is tested; the non-resumable verbs are refused by name (`snapshot.non-resumable`) |
| LM-197 | Painting drips/layers/drying, one rectangle per call; items without a drinking cycle, ladle, food geometry or spill | EV:308,310,562,587; SPT:80-81; IT:99-100 | out-of-scope | re-classify: out-of-scope | — | — | — | SP §8 not full physics; OF §8/§12 ask for painting and eating together, which exist; the lead confirms (§9) |
| LM-198 | Grid design choices: 0.1 m rasters with exact EDT (no navmesh); reordered/duplicate obstacle lists fall back to a full rebuild; Recast TileCache / Rapier sweeps not adopted; take replay within 5.5 mm / 8.5 mrad (thinning), not exact | EV:300,314,318,440,662,737,919; HO:255 | out-of-scope | re-classify: out-of-scope | — | — | — | SP §9/§26 "evaluate, not blindly adopt" with the decision recorded (ENGINEERING.md); determinism (SP §23) is on state hashes, which are exact; thinning is a visual encoding |
| LM-199 | No dismantling/removal verbs | HO:247; PG:126 | out-of-scope | re-classify: out-of-scope | — | — | — | not in SP §12 recipes or OF §1–§15; the lead confirms (§9) |
| LM-200 | Ladders / scaffold not modelled (`access.ts:91`); access above 2.1 m is by hand-up, pass-up, frame climbing and beam walks | HO:229-230,455; CA:130,157; PG:90,122-123; EV:294,337,795 | out-of-scope | re-classify: out-of-scope | — | — | LM-031 | OF §5/§14 name the real Mars methods (by hand, forklift, frames, top beams) and those are modelled; SP §9 only lists ladders as a pattern to research. The lead confirms (§9) |
| LM-201 | Process notes: usage.py did not track a session; /studio p95 267 ms at 64× on a loaded host; take size +47 % before thinning | HO:493-494; PR W24; BM:158-160 | out-of-scope | re-classify: out-of-scope | — | — | — | not engine behaviour (host load, tooling around the session, superseded by mars-take/3) |
| LM-216 | Selective import / cherry-pick between workspaces | SP:244 | out-of-scope | re-classify: out-of-scope | — | — | — | SP §32 non-goal "automatic merging of arbitrary workspace branches"; SP:244 only says "prefer" — lead confirms (§9) |

---

## 9. Needs a lead / Gene ruling (classified above, but the call is not mine)

- **LM-117 party/dance**: SP §30 H lists party/dance, but Gene said "no new features". Fix (L) or de-scope milestone H.
- **LM-111 turned sheet, LM-114 re-grip / pivot, LM-166 lab vehicle presets, LM-147 studio load time**: these read as
  new capability or product polish, not gaps against a SPEC clause. Each is listed as fix; any of them can be struck.
- **LM-055 emergency stop**: MOVEMENT:226-228 says the spec asks for the one-tick stop. I found no such SPEC clause
  (rg "emergency"/"stop"). If one exists, re-classify.
- **LM-196, LM-197, LM-199, LM-200**: out-of-scope by reading SP §22 / §8 / §12. Gene's brief named only scanned Martians
  and electrical as examples.
- **LM-202, LM-204, LM-216**: Studio editor unification, API visual capture, cherry-pick (SPEC audit) — large and arguably new features.
- **LM-007 vs SP:146**: SPEC keeps NL out of the low-level controller, so wire the parser as its own op/tool (or an optional `sentences` field on `engine_direct_camera`), not into verbs.
- **LM-156 / LM-184**: are the three other 2022 houses content (drop the `todo` tests) or does the lead want LM-106/107
  green first? W47 is in flight on exactly this.

## 10. Coverage checks done for this inventory

- **Lint** (`oxlint` on HEAD): 123 errors.
  - By rule: no-unused-vars 27, no-new-array 13, require-array-sort-compare 13, no-useless-spread 12,
    no-explicit-any 10, prefer-const 10, no-unused-expressions 10, no-useless-fallback-in-spread 6,
    prefer-string-starts-ends-with 5, unbound-method 4, restrict-template-expressions 3, await-thenable 2,
    no-loss-of-precision 2, no-constant-binary-expression 2, no-this-alias 1, no-base-to-string 1, erasing-op 1,
    no-control-regex 1.
  - By directory: engine/test 22, engine/camera 14, engine/construction 12, engine/campus 11, engine/runtime 9, app/lab 7,
    app/engine-view 7, deploy 16, engine/vehicles 4, other engine 20, simulation 2, app/studio 2.
  - Grouped into LM-149…151.
- **Skip/todo markers**: 8 (LM-155…157). No `test.fixme`, `.todo()` or `describe.skip` elsewhere.
- **Tools vs integration**:
  - Legacy: all 20 tools are called in `deploy/simulation-integration.mjs`.
  - Engine: 13 of 14 `engine_*` tools are called; `engine_direct_camera` is only asserted present (LM-015).
  - The gate runs integration only with `SIM_BASE` (LM-015).
- **Gene's priority list**: every key appears.
  - Controller: C1 LM-001; C2 LM-002…006; C3 LM-007…012; C4 LM-013, 137, 138; C5 LM-014; C6 LM-015, 154.
  - Engine: E1 LM-020…023, 105, 106; E2 LM-024, 025, 043; E3 LM-026…030; E4 LM-031, 032; E5 LM-033…035;
    E6 LM-036, 037; E7 LM-038; E8 LM-039…041; E9 LM-042…048; E10 LM-049…053; E11 LM-054, 055;
    E12 LM-056…066; E13 LM-070, 071; E14 LM-072…074, 148…153.
  - Renderer: R1 LM-120, 121; R2 LM-122…127; R3 LM-128…131; R4 LM-132…135; R5 LM-094…096, 136.
  - Evidence: V1 LM-167…175.
- **SPEC / OWNER_FEEDBACK requirement audit**: see §12.

## 11. Summary

### Counts (category × proposed)

| category | fix | re-classify: content | re-classify: out-of-scope | total | fix S/M/L | est. hours (fix) |
|---|---|---|---|---|---|---|
| controller | 21 | 0 | 0 | 21 | 6/10/5 | 56 |
| engine | 68 | 0 | 0 | 68 | 33/30/5 | 133 |
| simulation | 37 | 0 | 0 | 37 | 7/24/6 | 97 |
| renderer | 30 | 0 | 0 | 30 | 14/14/2 | 59 |
| tooling | 22 | 0 | 0 | 22 | 13/9/0 | 35.5 |
| evidence | 10 | 0 | 0 | 10 | 5/4/1 | 20 |
| content | 0 | 16 | 0 | 16 | 0/0/0 | 0 |
| out-of-scope | 0 | 0 | 12 | 12 | 0/0/0 | 0 |
| **total** | **188** | **16** | **12** | **216** | 78/91/19 | **400.5** |

Estimated fix work ≈ **400.5 worker-hours** (S = 1, M = 2.5, L = 5). Re-classifications cost only the one-sentence edit in their source doc, which is folded into LM-173/174/175.

### Items that move pins (batch them into one re-pin)

**Certainly move pins** (49 rows) — batch into one re-pin window, each with a PLANNING_BUDGET reason:

| id | what moves |
|---|---|
| LM-020 | every walker/carry pin if behaviour changes; a pure ordering proof may be pin-neutral |
| LM-021 | perf-walk |
| LM-033 | yb-AB `ddb634d6`, P chapter take |
| LM-208 | takes, baselines, carry pins if timing changes |
| LM-049 | all walker pins (perf-walk 5, year-build, takes) |
| LM-050 | stress-30 and every pin if submit planning is spread |
| LM-051 | perf-walk |
| LM-054 | takes with a speed field (take bytes/ids); state hash if speed is in state |
| LM-055 | perf-walk, takes |
| LM-061 | take camera ids (re-record) |
| LM-069 | takes (camera track re-record) |
| LM-070 | v3, handup tests, year-build maybe |
| LM-081 | meal, any take with held items |
| LM-084 | year-build pins, chapter takes |
| LM-085 | year-build takes |
| LM-086 | year-build |
| LM-090 | takes (hands field) |
| LM-205 | stored plans go stale; take rulesVersion fields |
| LM-105 | yb-skel, yb-AB, chapter takes (events) |
| LM-106 | yb-AB, chapter takes |
| LM-107 | adds full-house pins |
| LM-113 | adds a campus v3 pin; takes |
| LM-119 | baselines |
| LM-120 | baselines (lab-social, campfire) |
| LM-121 | baselines |
| LM-122 | baselines (poses-*, year-build) |
| LM-123 | baselines (poses-raise-footer) |
| LM-124 | baselines |
| LM-125 | baselines |
| LM-126 | baselines |
| LM-128 | baselines (poses-beam-walk) |
| LM-129 | baselines |
| LM-130 | baselines (stairs) |
| LM-132 | baselines |
| LM-136 | baselines (prone-*) |
| LM-141 | baselines (studio-build) |
| LM-143 | baselines (studio-2021-*, solar-paint-*) |
| LM-144 | baselines (fire-*) |
| LM-145 | baselines (render-polish, solar-paint) |
| LM-210 | new baselines |
| LM-156 | adds pins |
| LM-160 | baselines |
| LM-161 | camera-verify captures |
| LM-162 | campus `c56ea8da`, contentHash |
| LM-166 | new baselines |
| LM-180 | if changed — year-build, flagship |
| LM-181 | if changed — year-build, chapter takes |
| LM-182 | mars-2022/23/24 contentHash, every 2022 year-build pin, chapter takes |
| LM-183 | studio/lab year baselines; perf-walk if 2026 GROUND_Y moves |

**Maybe move pins** (60 rows): LM-001, LM-002, LM-003, LM-006, LM-009, LM-023, LM-024, LM-025, LM-027, LM-030, LM-031, LM-032, LM-034, LM-035, LM-039, LM-042, LM-045, LM-047, LM-056, LM-057, LM-058, LM-060, LM-062, LM-066, LM-068, LM-071, LM-072, LM-073, LM-074, LM-076, LM-077, LM-078, LM-080, LM-082, LM-083, LM-087, LM-088, LM-089, LM-091, LM-092, LM-093, LM-094, LM-095, LM-096, LM-097, LM-098, LM-099, LM-103, LM-109, LM-110, LM-111, LM-114, LM-115, LM-118, LM-133, LM-134, LM-135, LM-149, LM-213, LM-170. These are expected to be hash-neutral if done carefully. Each brief must run perf-walk + year-build pins and report; any movement joins the re-pin batch.

### Proposed worker briefs (1–3 h each; files owned so briefs don't collide)

Briefs are grouped by file ownership, not ordered. **[Codex]** marks briefs that fall on Codex-owned paths. Pin-moving
briefs are marked **re-pin**; they should land in one re-pin window (PLANNING_BUDGET reason per pin).

126 briefs, **400.5 h**. The brief hours equal the fix hours because every fix row sits in exactly one brief; a script checks this. Most briefs are 1–3 h. Titles marked "2 briefs" hold an L item (about 5 h) and are split in two when briefed.

Briefs in the same lane share files, so a lane's briefs run one after another. Different lanes own different files and can run side by side (2–3 at a time). Known overlaps between lanes:
- **T4** (lint engine/**) touches every engine lane. It is best run first, as one brief, before other engine briefs start.
- **K7** (speed published by every mover) touches carry, stance, frame, social and vehicles. Run it when lanes C, E, H and I are idle.
- **I4** adds a walker hook in walk.ts; coordinate it with lane B.
- Lane **B** (walk.ts) moves the most pins. Batch its pin moves with K7, D3, D6, E3, E4, F1, F2, J5, L1 and the renderer re-pins into one re-pin window.
- **J** briefs that touch synth.ts wait for W54 to merge. **L1** waits for W47.
- Codex briefs (**X**) take only Codex-owned paths. **A8** changes the frozen direction schema, which Codex logs in CODEX.md §7.

| lane | briefs | est. h |
|---|---|---|
| A controller / API | 17 | 55 |
| B walk + planning | 8 | 25 |
| C carry | 7 | 28 |
| D construction lifts | 6 | 15.5 |
| E stance / frame / framing | 6 | 22 |
| F hand-up / prone / body | 9 | 34 |
| G solar / paint | 3 | 8.5 |
| H social / items | 9 | 29.5 |
| I vehicles | 5 | 16 |
| J camera engine | 11 | 28.5 |
| K runtime / core / cross-cutting | 8 | 20.5 |
| L campus sequences | 1 | 6 |
| R renderer poses | 10 | 36.5 |
| S studio / scenes | 5 | 14 |
| T tooling / gate | 11 | 33.5 |
| V evidence | 7 | 20 |
| X Codex | 3 | 8 |

| brief | lane | title | LM ids | owned files (under viewer/ unless docs/) | est. h | flags |
|---|---|---|---|---|---|---|
| A1 | controller / API | Plan staleness: region layout in physicalView + vehicles via edit_world | LM-003, LM-005 | engine/world/types.ts (physicalView), engine/api/edit.ts | 2 |  |
| A2 | controller / API | Region-scoped plan staleness | LM-004 | engine/rehearsal/*, engine/sequence/bind.ts | 2.5 |  |
| A3 | controller / API | Auto rebind/replan on stale (op + execute path) — 2 briefs | LM-001 | engine/api/controller.ts, api/schemas.ts, engine/rehearsal/* | 5 |  |
| A4 | controller / API | Static geometry query/edit over MCP — 2 briefs | LM-002 | engine/api/edit.ts, api/schemas.ts, engine/spatial/service.ts (static layer) | 5 |  |
| A5 | controller / API | Seed mars-2026 into rooms | LM-006 | engine/api/seeds.ts | 2.5 |  |
| A6 | controller / API | NL parser as an engine op/tool | LM-007 | engine/camera/index.ts, engine/api/controller.ts, api/schemas.ts, simulation/engine-tools.ts | 2.5 |  |
| A7 | controller / API | Racks alias + director demo sentence step + tool lists | LM-008, LM-011 | engine/camera/direct.ts (SemanticWorld aliases), deploy/director-demo.mjs, DD/LG docs | 2 |  |
| A8 | controller / API | Fixture subject kind in the direction schema | LM-009 | engine/camera/direct.ts (frozen schema, logged in CODEX.md §7) | 2.5 | frozen schema: log in CODEX.md |
| A9 | controller / API | Directed track stored beside the take (op) | LM-013 | engine/api/controller.ts, api/schemas.ts, app/studio/direct-panel.tsx | 2.5 |  |
| A10 | controller / API | Sequence step timeout + cancel/mark steps | LM-016 | engine/sequence/runner.ts, sequence/types.ts | 2.5 |  |
| A11 | controller / API | DO storage byte safety + evicted-take refusal | LM-018, LM-017 | simulation/engine-room.ts | 3.5 |  |
| A12 | controller / API | Year-build chapter in a DO room under the CPU limit | LM-019 | deploy/simulation-integration.mjs (new case) | 2.5 |  |
| A13 | controller / API | Machine-readable action contract | LM-203 | engine/api/registry.ts, engine/actions/types.ts, action defs (metadata only) | 2.5 |  |
| A14 | controller / API | Legacy tools through the engine controller — 2 briefs | LM-014 | simulation/worker.ts, commands.ts, model.ts, engine-tools.ts | 5 |  |
| A15 | controller / API | Studio editor → engine design edits — 2 briefs (lead may de-scope) | LM-202 | app/studio/* (editor), engine/api/edit.ts | 5 |  |
| A16 | controller / API | API visual capture op — 2 briefs (lead may de-scope) | LM-204 | simulation/worker.ts (+ render host) | 5 |  |
| A17 | controller / API | Direct-camera perf | LM-012 | engine/camera/synth.ts, app/studio/direct-camera.ts | 2.5 | W54 landed (branch `w54-direct-perf`); worker + timing proxy remain |
| B1 | walk + planning | Deadlock detector (report + blocked) — 2 briefs | LM-024 | engine/locomotion/walk.ts, engine/sequence/runner.ts | 5 |  |
| B2 | walk + planning | Corridor-A back-out | LM-025 | engine/locomotion/walk.ts, engine/carry/actions.ts (read) | 2.5 | **re-pin** |
| B3 | walk + planning | Tight-corner head-on encounter | LM-021 | engine/locomotion/walk.ts | 2.5 | **re-pin** |
| B4 | walk + planning | Look-ahead on the shared budget + cache | LM-049, LM-053 | engine/locomotion/walk.ts | 3.5 | **re-pin** |
| B5 | walk + planning | Stress-30 max tick ≤ 60 ms — 2 briefs | LM-050 | engine/locomotion/walk.ts, engine/spatial/path.ts, runtime/runtime.ts | 5 | **re-pin** |
| B6 | walk + planning | People-gap planning (1.08–1.5 m) | LM-051 | engine/spatial/path.ts, grid | 2.5 | **re-pin** |
| B7 | walk + planning | makeWay skips reserved people + walk-back/spline/face tests | LM-105, LM-097, LM-098 | engine/locomotion/walk.ts | 3 | **re-pin** |
| B8 | walk + planning | Decel-limited stop (after K7) | LM-055 | engine/locomotion/walk.ts | 1 | **re-pin** |
| C1 | carry | Space-time reservations / proven carry ordering — 2 briefs | LM-020 | engine/carry/*, engine/runtime/runtime.ts (reservations) | 5 | **re-pin** |
| C2 | carry | Crews on stairs — 2 briefs | LM-039 | engine/carry/validate.ts, carry/climb.ts, carry/actions.ts | 5 |  |
| C3 | carry | Stair carries: multi-flight, pitched loads, staged check | LM-040, LM-041 | engine/carry/climb.ts, construction/access.ts (stagedCheck) | 3.5 |  |
| C4 | carry | Cancel on a stair flight + cancel set-down bystanders | LM-037, LM-078 | engine/carry/actions.ts | 3.5 |  |
| C5 | carry | Carry height band + fork-load support | LM-080, LM-047 | engine/carry/sweep.ts, carry/invariants.ts | 3.5 |  |
| C6 | carry | Carry pickup/set-down crouch phases | LM-208 | engine/carry/actions.ts | 2.5 | **re-pin** |
| C7 | carry | Re-grip / pivot formation — 2 briefs (lead may de-scope) | LM-114 | engine/carry/formation.ts, carry/planner.ts | 5 |  |
| D1 | construction lifts | Mid-raise cancel (lower back down) | LM-036 | engine/construction/raise.ts | 2.5 |  |
| D2 | construction lifts | Install-lift cancel tests | LM-038 | engine/construction/{deck,beam,stairs,liftcrew,setpart}.ts (cancel paths) | 2.5 |  |
| D3 | construction lifts | setpart erasing-op + set-part body-band sweep | LM-072, LM-110 | engine/construction/setpart.ts | 3.5 | **re-pin** |
| D4 | construction lifts | liftcrew on BODY_MODEL + rafter span rule | LM-089, LM-100 | engine/construction/liftcrew.ts, deck.ts, rules.ts | 2 |  |
| D5 | construction lifts | Stair rise / exit-zone flexibility | LM-099 | engine/construction/stairs.ts, spatial/path.ts (linkApproach) | 2.5 |  |
| D6 | construction lifts | Bundle box shrink + pull phase | LM-086 | engine/construction/bundle.ts, campus/bom.ts | 2.5 | **re-pin** |
| E1 | stance / frame / framing | Climb path body check + face exclusivity | LM-032, LM-022 | engine/construction/frame.ts, framemove.ts | 3.5 |  |
| E2 | stance / frame / framing | Stand-on-top-beams stance — 2 briefs | LM-031 | engine/construction/stance.ts, framing.ts | 5 |  |
| E3 | stance / frame / framing | Stance facing toward the load / hang_beam lifter | LM-084 | engine/construction/stance.ts | 2.5 | **re-pin** |
| E4 | stance / frame / framing | Engine foot/hand holds on bracing — 2 briefs | LM-085 | engine/construction/stance.ts, frame.ts | 5 | **re-pin** |
| E5 | stance / frame / framing | Walk-in make-way + framing make-way / band / lift-over | LM-087, LM-108 | engine/construction/stance.ts, framing.ts | 3.5 |  |
| E6 | stance / frame / framing | Two-hand balance + blended hand-offs | LM-109 | engine/construction/framing.ts, stance.ts | 2.5 |  |
| F1 | hand-up / prone / body | Per-person body variants — 2 briefs | LM-070 | engine/body/model.ts, construction/handup.ts | 5 | **re-pin** |
| F2 | hand-up / prone / body | Measured body constants + giver slack + release blend | LM-071, LM-088, LM-090 | engine/body/model.ts, construction/handup.ts | 3 | **re-pin** |
| F3 | hand-up / prone / body | Two-joint shoulder envelope | LM-091 | engine/body/model.ts | 2.5 |  |
| F4 | hand-up / prone / body | Hand-up balance + corridor/station/grip search | LM-092, LM-093 | engine/construction/handup.ts | 5 |  |
| F5 | hand-up / prone / body | Prone per-tick sweep + lying footprint | LM-094, LM-095 | engine/construction/handup.ts, runtime/invariants.ts | 5 |  |
| F6 | hand-up / prone / body | Prone deck-hand per variant + mixed crew | LM-096, LM-112 | engine/construction/handup.ts, body/model.ts | 3.5 |  |
| F7 | hand-up / prone / body | Prone grip avoids joist ends | LM-135 | engine/construction/handup.ts | 2.5 |  |
| F8 | hand-up / prone / body | Hand-up v3 campus variant at staging-east | LM-113 | engine/scenarios/build-bay-v3*.ts, engine/test/build-bay-v3.test.ts | 2.5 | **re-pin** |
| F9 | hand-up / prone / body | Turned sheet over the bay — 2 briefs (lead may de-scope) | LM-111 | engine/construction/handup.ts | 5 |  |
| G1 | solar / paint | Solar side stations | LM-033 | engine/construction/solar.ts, campus/sequence-b.ts (P) | 2.5 | **re-pin** |
| G2 | solar / paint | Solar azimuth + BOM solar ids | LM-034, LM-035 | engine/construction/solar.ts, campus/bom.ts | 3.5 |  |
| G3 | solar / paint | Crouch painting band + painter idle | LM-118 | engine/work/paint.ts | 2.5 |  |
| H1 | social / items | Social resume after pre-emption + ambient re-adopt | LM-026, LM-027 | engine/social/actions.ts, social/ambient.ts | 3.5 |  |
| H2 | social / items | Eat/serve overlay release + snapshot during stand-up | LM-028, LM-029 | engine/items/actions.ts, social/actions.ts, runtime/snapshot.ts | 3.5 |  |
| H3 | social / items | Holding verbs end + approach/standing reservations | LM-030, LM-023 | engine/social/actions.ts, social/slots.ts | 2 |  |
| H4 | social / items | Per-fixture seat volumes | LM-115 | engine/social/slots.ts, runtime/invariants.ts | 2.5 |  |
| H5 | social / items | Audience regions on benches + doorway approach test | LM-116, LM-209 | engine/social/slots.ts, engine/test/movement.test.ts | 3.5 |  |
| H6 | social / items | Party/dance + rider in a social scene — 2 briefs (lead ruling) | LM-117 | engine/social/actions.ts, engine/scenarios/* | 5 |  |
| H7 | social / items | Items: same-tick hold + table reach | LM-081, LM-082 | engine/items/actions.ts | 3.5 | **re-pin** |
| H8 | social / items | Items: cancel/serve rules + item–item collision | LM-083, LM-133 | engine/items/actions.ts, items/model.ts | 3.5 |  |
| H9 | social / items | Lap support | LM-134 | engine/items/model.ts, world/types.ts | 2.5 |  |
| I1 | vehicles | Forklift swerve/reverse — 2 briefs | LM-042 | engine/vehicles/forklift.ts, vehicles/curve.ts | 5 |  |
| I2 | vehicles | 3-vehicle cycles + lanes/engagement | LM-043, LM-046 | engine/vehicles/traffic.ts | 3.5 |  |
| I3 | vehicles | Forklift fork motions vs vehicles/people | LM-044 | engine/vehicles/forklift.ts | 2.5 |  |
| I4 | vehicles | Oriented vehicle footprints | LM-045 | engine/vehicles/curve.ts, traffic.ts (+ a walker hook in walk.ts, coordinate with lane B) | 2.5 |  |
| I5 | vehicles | Angled forklift placements | LM-048 | engine/vehicles/forklift.ts | 2.5 |  |
| J1 | camera engine | Combined corrections | LM-056 | engine/camera/correct.ts | 2.5 |  |
| J2 | camera engine | Synthesis vs moving occluders | LM-057 | engine/camera/synth.ts (after W54), plan.ts | 2.5 |  |
| J3 | camera engine | Occlusion parity (two-capsule proxy, pitched prisms) | LM-058 | engine/camera/quality.ts, geom.ts, occluders.ts | 2.5 |  |
| J4 | camera engine | Campus-through parity take | LM-059 | e2e/camera-verify.spec.ts, app/studio/camera-verify.ts | 2.5 |  |
| J5 | camera engine | Swept camera | LM-060 | engine/camera/quality.ts, plan.ts | 2.5 |  |
| J6 | camera engine | Readability rater on final samples + re-record | LM-061 | engine/camera/chapter-shots.ts, deploy/record-campus-take.mjs | 2.5 | **re-pin** |
| J7 | camera engine | Foreground bystander rule | LM-062 | engine/camera/correct.ts, synth.ts | 2.5 |  |
| J8 | camera engine | Fly-through occlusion, flare, split look-at + shorten/cut fixtures | LM-063, LM-064 | engine/camera/solve.ts, correct.ts | 3.5 |  |
| J9 | camera engine | Direct on shipped tracks + orbit tie margin + navmesh cache | LM-065, LM-066, LM-067 | engine/camera/take-sampler.ts, synth.ts (after W54) | 3 |  |
| J10 | camera engine | Viterbi min shot length + hairpins + region heights | LM-068 | engine/camera/solve.ts, plan.ts, direct.ts | 2.5 |  |
| J11 | camera engine | Safe-area UI bands + installation close-up shot | LM-069, LM-207 | engine/camera/quality.ts, shots.ts | 2 | **re-pin** |
| K1 | runtime / core / cross-cutting | History store isolation + id/link fixes (REVIEW L1–L4) | LM-075, LM-076 | engine/history/store.ts, runtime/runtime.ts, locomotion/walk.ts (stepLink only) | 2 |  |
| K2 | runtime / core / cross-cutting | Level/foot-y invariant (REVIEW L5) | LM-077 | engine/construction/access.ts, runtime/invariants.ts | 2.5 |  |
| K3 | runtime / core / cross-cutting | Sampled-sweep bound doc + tests (REVIEW L9) | LM-079 | docs/engineering/ENGINE_GUIDE.md, engine/test/* | 2.5 |  |
| K4 | runtime / core / cross-cutting | Restore limits + grid equality on the campus | LM-101, LM-104 | engine/runtime/snapshot.ts, engine/test/campus-full.test.ts | 2 |  |
| K5 | runtime / core / cross-cutting | Per-year north mechanism + door entities | LM-102, LM-103 | engine/env/sun.ts, engine/campus/history-extract.ts | 3.5 |  |
| K6 | runtime / core / cross-cutting | Derived rules version + inventory modes | LM-205, LM-206 | engine/api/registry.ts, world/catalog.ts | 3.5 | **re-pin** |
| K7 | runtime / core / cross-cutting | Speed published by every mover — 2 briefs | LM-054 | engine/carry/actions.ts, construction/stance.ts, frame.ts, social/*, vehicles/*, runtime/invariants.ts | 2.5 | **re-pin** |
| K8 | runtime / core / cross-cutting | math.ts precision + `**` sites + contents.count type | LM-073, LM-074 | engine/core/math.ts + the 14 `**` sites (allowlist edit is Codex) | 2 | **re-pin** |
| L1 | campus sequences | Idle-crew parking + D1 receiver spot + full-house pins | LM-106, LM-107, LM-156 | engine/campus/sequence-b.ts, engine/test/year-build-houses.test.ts (after W47) | 6 | **re-pin** |
| R1 | renderer poses | Talk/watch/listen poses + gaze/turn-taking | LM-120, LM-121 | app/engine-view/humans.ts, posture.ts; engine/social/actions.ts (speaker field) | 5 | **re-pin** |
| R2 | renderer poses | Rig reaches 100 % of reachable hand points — 2 briefs | LM-122 | app/engine-view/humans.ts, posture.ts, hands-check | 5 | **re-pin** |
| R3 | renderer poses | Footer hands + blend lag + sit/lifter assertions | LM-123, LM-124, LM-211 | app/engine-view/posture.ts, e2e/poses.spec.ts, lab-poses.spec.ts | 4.5 | **re-pin** |
| R4 | renderer poses | Side lean / twist / grip hand shapes — 2 briefs | LM-125 | app/engine-view/posture.ts, rig.ts | 5 | **re-pin** |
| R5 | renderer poses | Carry poses + replay seat height | LM-126, LM-127 | app/engine-view/humans.ts, take-replay.ts | 3.5 | **re-pin** |
| R6 | renderer poses | Beam-flange feet | LM-128 | app/engine-view/frame-gait.ts | 2.5 | **re-pin** |
| R7 | renderer poses | Climb rungs on bracing + climb-wait/turn-in-place | LM-129, LM-130 | app/engine-view/frame-gait.ts, stair-gait.ts, humans.ts | 3.5 | **re-pin** |
| R8 | renderer poses | Body-vs-object penetration asserted | LM-132 | app/engine-view/humans.ts, prone.ts, e2e/{poses,meal,prone}.spec.ts | 2.5 | **re-pin** |
| R9 | renderer poses | Prone replay exactness | LM-136 | app/engine-view/prone.ts, take-replay.ts, e2e/studio-take-prone.spec.ts | 2.5 | **re-pin** |
| R10 | renderer poses | EUC/bicycle visual lean | LM-119 | app/engine-view/vehicle meshes | 2.5 | **re-pin** |
| S1 | studio / scenes | Studio: take-host base scene, file-track verify, set camera picker | LM-131, LM-137, LM-138 | app/studio/take-host.ts, camera-verify.ts, chapter-panel.tsx | 3 |  |
| S2 | studio / scenes | Studio: hold tails + single-take hold | LM-139 | app/studio/chapter-set.ts, take-replay.ts | 2.5 |  |
| S3 | studio / scenes | Studio: seam weight, panel overlap, loader validation, replay independence | LM-140, LM-141, LM-142, LM-146 | app/studio/take-walk.ts, chapter-panel.tsx, take-panel.tsx, e2e/studio-*.spec.ts | 4 | **re-pin** |
| S4 | studio / scenes | Studio load time (meshopt GLB) | LM-147 | GLB build pipeline, app/studio loader | 2.5 |  |
| S5 | studio / scenes | History scene colours + lab pv2 + weather capture | LM-143, LM-210 | app/history/scenes.ts, app/lab/solar-paint.ts, e2e/studio-years.spec.ts | 2 | **re-pin** |
| T1 | tooling / gate | Integration covers every tool + always runs in the gate | LM-015 | deploy/simulation-integration.mjs, deploy/gate.mjs (non-lint steps) | 1 |  |
| T2 | tooling / gate | Evidence report ingests gate JSON | LM-154 | deploy/evidence-report.mjs | 2.5 |  |
| T3 | tooling / gate | Full-suite nightly + skip guards | LM-155, LM-157 | deploy/gate.mjs (full step), the guarded tests | 3.5 |  |
| T4 | tooling / gate | Lint engine/** (non-test) to 0 — run before the lanes start | LM-149 | engine/** (lint-only edits) | 2.5 | **re-pin** |
| T5 | tooling / gate | Lint engine/test + app/deploy/simulation to 0 | LM-150, LM-151 | engine/test/**, app/**, deploy/* (not group-2026-frames), simulation/worker.ts | 2 |  |
| T6 | tooling / gate | Perf flake, gitDirty, replan-budget pin | LM-152, LM-153, LM-052 | engine/test/*perf*, .gitignore, deploy/perf-walk.mjs | 3 |  |
| T7 | tooling / gate | Take tooling: --check reuse, spec sampling, e2e dirs, take-fixture | LM-158, LM-159 | deploy/record-campus-take.mjs, e2e/playwright.config.ts, e2e/take-fixture.ts | 3.5 |  |
| T8 | tooling / gate | Baseline drift review + fov captures + history-ids tidy | LM-160, LM-161, LM-163 | e2e/baselines/**, e2e/camera-verify.spec.ts, deploy/history-ids.test.mjs, take-sampler legacyKinds | 3 | **re-pin** |
| T9 | tooling / gate | Campus extraction details / thin members | LM-162 | deploy/engine-scene.mjs | 2.5 | **re-pin** |
| T10 | tooling / gate | Cross-host determinism + track video | LM-164, LM-165 | deploy/determinism-probe.mjs, e2e (video) | 5 |  |
| T11 | tooling / gate | Lab presets + overlays (lead may de-scope) | LM-166, LM-213 | app/lab/scenarios.ts, app/lab/overlay-*.ts | 5 | **re-pin** |
| V1 | evidence | Regenerate EVIDENCE + map every test + stale row notes | LM-167, LM-169 | engine/test/evidence-map.json, docs/engineering/EVIDENCE.md | 2 |  |
| V2 | evidence | Year build B executed sections | LM-168 | engine/test/year-build-b.test.ts, take-chapters.test.ts | 2.5 |  |
| V3 | evidence | Campus/second-geometry variants for proving-ground rows — 2 briefs | LM-170 | engine/test/{navigation,gaps,camera,social,forklift,vehicles,construction,campus-full}.test.ts | 5 |  |
| V4 | evidence | Historical routes per year + jump bound on all pins | LM-171, LM-172 | engine/test/campus-history.test.ts, movement.test.ts | 3.5 |  |
| V5 | evidence | Acceptance trace test + foot-slide metric | LM-214 | engine/test/acceptance.test.ts (new), take metrics | 2.5 |  |
| V6 | evidence | Doc hygiene: area docs + top-level docs | LM-173, LM-174 | docs/engineering/*.md (not EVIDENCE), app/lab/README.md | 3.5 |  |
| V7 | evidence | Final evidence note pass (last) | LM-175 | docs/engineering/EVIDENCE.md, HANDOFF.md | 1 |  |
| X1 | Codex | Lint stage in the gate + group-2026 lint + source-scan allowlist to 0 | LM-148 | deploy/gate.mjs (lint stage), .oxlintrc.json, package.json lint, deploy/group-2026-frames.mjs, engine/test/source-scan.test.ts | 1 | **[Codex]** |
| X2 | Codex | Fire + firelight/studio fire + paint mask | LM-144, LM-145, LM-212 | app/engine-view/fire.ts, paint.ts, e2e/fire.spec.ts, render-polish.spec.ts | 6 | **re-pin** **[Codex]** |
| X3 | Codex | NL refusal contract | LM-010 | engine/camera/parse.ts + camera-parse tests | 1 | **[Codex]** |

## 12. SPEC / OWNER_FEEDBACK audit

A reader enumerated every requirement ("must", "should", table rows, milestones) in SPEC.md and OWNER_FEEDBACK §1–§15. For each one it looked for a named test in `engine/test`, `e2e` or `deploy/*.test.mjs`, and in evidence-map.json. Nothing was re-run for this audit: "proven" means a test with that title exists and is mapped.

| source | requirements | proven | partial | unmet |
|---|---|---|---|---|
| SPEC.md | 144 | 107 | 32 | 5 |
| OWNER_FEEDBACK §1–§15 | 81 | 56 | 23 | 2 |
| **total** | **225** | **163** | **55** | **7** |

**Every partial or unmet requirement is a row above.**
- §28 regression rows: all 17 have tests. Their approximation notes are rows LM-020…LM-058 and LM-167…175.
- SP:23 one world model → LM-202. SP:82 acceptance trace → LM-214. SP:117 doorway → LM-209. SP:130 carry
  transitions → LM-208. SP:150 action contract → LM-203. SP:177 visual capture → LM-204. SP:202-203 installation
  shots → LM-207. SP:210 weather visuals → LM-210. SP:218 inventory modes → LM-206. SP:226/254/274 rules version →
  LM-205. SP:244 cherry-pick → LM-216. SP:295/385 overlays → LM-213. SP:327 foot sliding → LM-214. SP:342 milestone
  H → LM-117. SP:349 invariant gaps → LM-054, 081, 133, 032, 087, 058.
- OF §1 → LM-144, 212. OF §3 → LM-049. OF §5 → LM-032, 022, 085, 084. OF §6 → LM-122…124, 211, 070, 088.
  OF §7 → LM-155, 168; the other years are content (LM-184, 215). OF §8 → LM-118, 145. OF §9 → LM-033, 034; the
  per-year arrays are content (LM-215). OF §11 → LM-007, 013, 056, 057. OF §12 → LM-082, 133, 134, 211, 197.
  OF §13 → LM-094…096, 136. OF §14 → LM-031. OF §15 → LM-102, 186, 187, 212.
- The 7 unmet:
  - SP:42 / SP:347 evidence over invention → content (LM-215).
  - SP:189/369 scans → out of scope (LM-191).
  - SP:177 → LM-204.
  - SP:244 → LM-216.
  - OF §7 six more years → content (LM-184, 215).
  - OF §9 every year's arrays → content (LM-215).
- Proven, with notes to shrink (stale EVIDENCE text): stair foot IK (stairs.spec), v3 campus take (manifest
  `build-bay-v3-campus-2026.json`, "origin-independent"), fire smoke/core/top (fire.spec), chapter-set playback,
  year-build chapter readability ("100 % readable" on the shipped A+B), north offset −90 (env-sun). All are covered
  by LM-169.
- Not test-provable (process/docs): SP:70, 92, 96-98, 256, 278, 325, 358-359, 375-383. Their evidence is ENGINEERING,
  RESEARCH, LIB_EVAL, AUDIT and PROGRESS.


## 13. Lead ordering and rulings (Fable, 2026-09-29 22:10 EDT)

**Rulings on §9:** LM-117 party/dance = **fix** (SPEC §30 H requires it; not a new feature). LM-111 turned sheet, LM-114 re-grip/pivot,
LM-166 lab vehicle presets, LM-147 studio load time = **out-of-scope (product polish, no SPEC clause)**. LM-055 emergency stop = not an
item (documented behaviour; MOVEMENT.md wording corrected by V). LM-196/197/199/200 = out-of-scope as proposed. LM-202 editor
unification, LM-204 API visual capture, LM-216 cherry-pick = **out-of-scope (new features)**. LM-007 = the parser becomes its own op
(`engine_parse_camera`) plus an optional `sentences[]` on `engine_direct_camera` (SPEC:146 keeps NL out of verbs). LM-156/184 (the three
other 2022 houses' `todo` tests) = **content** — they stay `todo` with the refusal named (HISTORICAL_CONTENT.md).

**Waves (2–3 workers; every branch fully gated before merge; pin-movers batched into one re-pin window per wave):**
1. **Wave 1 — foundations:** T4 lint engine/** → 0 (hash-identical; `setpart.ts:241` erasing-op investigated — if it moves a pin,
   report for the wave-2 window) + LM-011 integration/director cover every tool; lane A controller (LM-003/004 region staleness,
   LM-001 auto replan/rebind, LM-013 directed-track op, LM-005 vehicles over edit_world, LM-007/008/009 parser op + aliases, LM-014
   legacy tools behind one path, LM-016/017/018/019); lane V evidence refresh (map + regenerate) once A lands; J camera (combined
   corrections, scene occlusion) after W54.
2. **Wave 2 — engine pin window:** B walk (look-ahead on the shared budget, encounters), K7 all movers publish speed, F body variants +
   release blend, D mid-raise cancel + install-lift cancel tests, E stand-on-top-beams + bracing holds, G solar side stations, H
   pre-empt resume + deadlock detector + party/dance, C space-time reservations or proven ordering + crews on stairs, I forklift
   swerve/reverse + 3-vehicle cycles, K core/math precision → ONE re-pin with reason, takes re-recorded once.
3. **Wave 3 — renderer + studio:** R talk/watch, carry/lift/hold gaps, beam-flange feet, item–item collision + lap support, prone
   phaseK exactness; S studio/scenes/lab fixes.
4. **Wave 4 — close:** V final evidence (every row PROVEN, notes shrunk), HANDOFF "Known shortcomings" = re-classified only,
   lint into the gate, release.

**Budget note:** ≈ 380 fix-hours after the strikes ≈ 115 M subagent tokens at the measured 300 k/worker-hour — beyond this week's
quota; run in wave order so any stop point is a clean milestone.

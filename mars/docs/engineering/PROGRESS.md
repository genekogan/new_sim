# Tranche progress log

Running log for the overnight simulation-engine tranche. Newest entries at the bottom.
Budget: weekly usage meter (`<usage-tool>`) started at 11% used; hard stop ≈61%.

## 2026-09-27 ~01:00 — Phase 0 started
- Local git baseline committed (repo root = campus-2026-reconstruction/).
- Spec copied to docs/engineering/SPEC.md; owner decisions in OWNER_DECISIONS.md.
- Running in parallel: AUDIT.md (architecture audit), RESEARCH.md (engine patterns), LIB_EVAL.md (recast/rapier/bvh/bespoke experiments in viewer/experiments/nav-eval).
- Known: `npm test` broken on Node 26 (`--experimental-transform-types` removed) — fix in Phase 1.

## Next steps
1. Integrate audit/research/lib-eval into ENGINEERING.md (assessment + plan + milestones).
2. Phase 1: pure-TS deterministic engine core (`viewer/engine/`): world state, IDs/semantics, action registry + lifecycle, diagnostics, fixed-step runtime, checkpoints.

## ~03:00 — Phase 1–2 progress
- AUDIT.md done (key: 2026 GLB has 667 CAD rack_member pieces, no frames; stock library frames 8/12/16/19 ft; no 9 ft part; nav was 1 m grid A* zig-zag, no levels; control plane analytic paths + virtual clock; historical IDs build-order dependent).
- e2e harness done (viewer/e2e, 11/11 green, 17 baselines incl. 2021/2022/2024 correction views; `npm run e2e`). Perf: 2026 = 1083 draw calls / 957k tris.
- Engine: core (hash/rng/history/runtime) + grid nav (EDT, multi-level A*, stair links) + walk_to (traffic yielding, replans) + invariants. `npm run test:engine`: 23/23.
- Research + lib-eval agents still running (repeated network stalls; resumed).

## Next steps
1. Crew carry: SE(2) formation planner + carry action (grips, whole-load clearance), carry regressions 6–7.
2. Takes: recorder + replay + camera independence; sequences/plans bound to baselines; rehearsal API.
3. Assembly: upright raise/hold/beam connect/release predicate.
4. Browser integration: render engine world in studio (debug overlays), then DO integration.

## ~09:30 — Milestones B–G reached on synthetic scenes; campus bridge landed
- Carry (SE(2) hybrid-A*, formations, whole-load clearance), takes/plans/rehearsal/execute, camera (decollide/deocclude/plan), progressive decks + stairs, DO + 9 `engine_*` MCP tools, 2026 campus SpatialScene (7578 prisms, staging-east) — all committed with tests + docs (CARRY.md, TAKES_AND_PLANS.md, CAMERA.md, PROGRESSIVE.md, CAMPUS_SCENE.md).
- Flagship `scenarios/build-bay.ts`: piles → carries → raise/hold → beams → release (refused early) → joists → plywood → stair + treads → visitor walks onto the deck. 43 steps, 456 s sim, 0 violations; execute == rehearsal hash; canonical untouched. Test: `engine/test/build-bay.test.ts`.
- Engine fixes found by the scenario: carry replans on topology change; people in a formation's path halt it and idle bystanders are asked to make way; set-down stations must be clear; raise picks its footing end; walk turn hysteresis, hard separation, continuous stair traversal, stair occupancy waits.
- Stress-30 (lab): 0 violations / 60 s. Lab e2e 13/13 (two spurious ENOENTs from overlapping Playwright runs).
- Env/lighting agent still running (repeated network stalls).

## Next steps
1. Flagship on the real 2026 fork at `staging-east` (crop scene); record take + camera track; capture screenshots via lab/studio.
2. Add `/lab` to Worker SPA routes; full e2e; production deploy with rollback note.
3. Handoff report (HANDOFF.md).

## ~11:30 — Campus flagship green; Gene back online; leadership mode
- Flagship runs on the real 2026 campus fork (staging-east): 43 steps, 548 s sim, 0 violations, execute == rehearsal (engine/test/campus-flagship.test.ts).
- Env track done: real NOAA sun, wetness, cloud-softened shadows; studio baselines refreshed.
- Gene's instruction: Fable leads/evaluates, Opus subagents do narrow work. Delegated: (1) progressive deck-y regression + nav perf caching, (2) Lab build-bay scenario + captures, (3) HANDOFF.md draft.
- Pending after (1): full-suite green → production deploy with rollback note.

## ~15:00 — Review fixes, perf, lab flagship, release prep
- Independent review (REVIEW.md): 3 critical / 2 high reproduced (carrier teleport on flipped replan; holders could walk away; walkers through carried loads; failed actions leaked reservations/tasks/traffic; snapped goals). All fixed with regression tests (engine/test/review.test.ts) + new invariants: motion.teleport (0.6 m/tick), support.holder-missing, collision.human-load. Engine suite 126 pass / 1 skip.
- Deck-y "regression" was a fixture bug (frames sunk 3.8 cm); beam height is now correctly seat-relative. Perf: cached base rasters — campus flagship compute 56 s → 17 s, hashes identical.
- Lab: flagship runs live in /lab via SequenceRunner.advance/poll; final hash == Node rehearsal. Baselines: build-bay-held-oblique.png, build-bay-visitor-oblique.png (reviewed by lead).
- Release prep: prepare.py allowlist fix for /engine (would have 404'd in prod); dry run + local smoke + MCP integration pass; rollback target de2dddaa-0fab-477c-8b8f-cb1c579efba5 (deployment.json was stale).
- Open (documented): raise crew stands at the base only; lifts not swept; beam spins 180° during connect (one-liner in beam.ts); carrier can bump a walker stopped beside the path (1/51 layouts); no lifting poses.
- Deploy agent running: gates → e2e → build → deploy → live smoke → docs.

## ~17:30 — Post-deploy
- Production live: d33a4d6b (from 2ecff4b); rollback de2dddaa. HANDOFF.md finalized. Beam 180° spin fixed (42abb2a; changes flagship hash — prod is 2 commits behind, cosmetic). Doc numbers refreshed (a2336a3).
- Continuing one agent at a time (Gene: max 3, quota-conscious): review mediums M1/M2/M4 in progress. Next candidates: raise choreography (crew at the rising end) + swept lifts; gate script; planning budget.

## ~20:00 — Review mediums, raise choreography, swept lifts, determinism hole
- M1/M2/M4 fixed (cf86834, 1c70f65, 3c0263b); runner timeout now settles deferred cancels; execute refuses unsettled commits.
- raise_upright: lifters walk the far end up (≤0.6 m/s, hands ≤1.9 m), footers at the base, per-tick clearance + blocked diagnostics (bc0cf8f). Swept lifts + lift-over fallback for beam/joist/plywood/tread (ace7fa1); symmetric parts no longer spin mid-air. Engine 136/137.
- Lab baselines refreshed + new build-bay-raise-oblique (893b0ba); lead inspected raiseA-45deg: plausible; caveats: footer's arms hang until the column is in reach; deck_s1 lift-over reads as a floating sheet (crew 2.9 m away) — TODO crew accompanies lifted parts.
- FOUND: browser≠node final hash since ace7fa1 — Math.sin/cos/atan2 differ in the last bit between Chromium 153 and Node 26 (spec §23 warning realised). Fix in progress: deterministic trig in core/math.ts, grep guard, golden bit patterns, determinism-probe.mjs.
- Production still d33a4d6b (behind: beam spin, review fixes, raise/lift work). Redeploy after the determinism fix lands and e2e is green.

## ~22:00 — Determinism fixed; second production release
- Deterministic trig (fdlibm-style, +−×÷√ only) replaces Math.sin/cos/atan2/atan/exp/log across engine (ec13a19, eccfd43, 6593a06); source-scan test + 37 golden bit patterns; deploy/determinism-probe.mjs. Browser == Node == production hash 5c29efcf… at tick 10918. Engine 141/142.
- Production 6f1200ce (from 6593a06); rollback d33a4d6b. Gates: 48/48, 141/1 skip, tsc clean, e2e 26/26; live MCP PASS; headless prod /lab flagship 43/43, 0 violations.
- In progress: crew accompanies lifted parts (floating-sheet look during lift-over).

## ~23:30 — Paused
- "Crew accompanies lifted parts" (floating-sheet look during lift-over): attempted 4× by a subagent, each attempt stalled on the network before writing anything; nothing landed. DEFERRED — brief is in the next-tranche list (HANDOFF §Suggested next tranche, item 3) and in this entry: crew walks alongside the part (positions from the part pose each tick, ≤0.9 m/s, no clipping); `lift.hands-out-of-reach` invariant (holder within 1.0 m of a hand point, hand points ≤2.4 m above the holder's floor); tests for a joist lift and a plywood lift-over.
- Spawning paused by the lead until the connection is steady; production is current (6f1200ce) and the tree is clean.

## ~01:00 (09-28) — Gate script; retrying lifted-parts
- `npm run gate` (deploy/gate.mjs, 5e077a5): test → test:engine → tsc → e2e → determinism probe (+ simulation-integration when SIM_BASE set); report under viewer/.cloudflare/gate/<ts>/. First real run green (48/48, 141/1 skip, clean, 26/26, hash 5c29efcf…). RELEASE_CHECKLIST now requires a green gate report with matching gitHead and gitDirty:false.
- Network steady again; "crew accompanies lifted parts" retried with reduced scope (plan file committed first).

## 2026-09-27 ~21:15Z: Third production release (crews accompany lifted parts)
- Pre-step `497e913`: `RULES_VERSION` changed to `mars-assembly/2` (plans bound under `/1` now report stale). `campus.test` uses the constant. The stale `holdersPresent` comment is fixed. Engine 144/1 skip, tsc clean.
- The first gate run went red on one e2e baseline only: `build-bay-visitor-oblique` at 2.74 % (crews end in different spots). Reviewed: same end state, nobody inside geometry. Refreshed in `3f5ece7`. Gate rerun GREEN: 48/48, 144/1 skip, clean, 26/26, hash `d54eca7c…f610` (was `5c29efcf…`; 11522 ticks, was 10918, intended). Report `.cloudflare/gate/2026-09-27T21-06-25-559Z`, gitDirty false.
- Production `17f7c9aa-84d1-437d-b1d6-287c85e553fe` (from `3f5ece7`); rollback `6f1200ce…`. Live smoke 200 / R2 200, integration PASS, headless prod `/lab` 43/43, 0 violations. Prod hash matches node.

## ~03:00 (09-28) — Lifted parts, release 3, planning budget
- Crews accompany lifted parts (13b5b4b..b5fc83b): lift.hands-out-of-reach invariant, LIFT_APEX_MAX 2.4 m, lift.crew-blocked; RULES_VERSION mars-assembly/2.
- Production 17f7c9aa (from 3f5ece7), rollback 6f1200ce; gate green (gitDirty:false); prod hash == probe d54eca7c…
- Planning budget (4969f6a..324102e): default A* 2× cheaper with bit-identical routes (stress-30 worst tick 233 → 80–91 ms warm); opt-in corridor planner (42–46 ms, routes differ ≤3.9 %); construction replans staggered ≤4/tick; rt.profile hook; deploy/perf-stress.mjs; all hashes unchanged. Lead loosened the wall-clock test bounds (250/120 ms) to avoid gate flakes.
- Not deployed (engine-internal perf); rides with the next release.

## ~06:00 (09-28) — Three parallel tracks (Gene asked for 3)
- Social vocabulary (engine/social: slots as reservations; sit/stand/face/converse/gather/campfire_circle/ambient_wander; SOCIAL.md).
- Review M3/M5/M6 fixed: people-as-obstacles use foot height; canonical entity order (forward/reverse hash equal); DO stores content-addressed states, rehearse writes 0 B unless keep.
- Evidence report: `npm run evidence` → EVIDENCE.md/evidence.json, all 17 §28 rows + A–H mapped to passing tests with honest approximation notes.
- Campus take in the studio: deploy/record-campus-take.mjs → public/engine/takes/flagship-campus-2026.json (1.41 MB, gzip 206 KB, take id f747d29d…); /studio "Replay take" (banner, scrubber, engine camera toggle, diagnostics); camera shotlist (10 shots, 0 wall crossings, readability min 0.72); e2e/studio-take.spec.ts; gate green (27 e2e). Lead inspected studio-take-held/visitor: correct placement east of Chiba among the trailers; people on the ground; shots readable.
- Running: carrier-vs-stopped-walker + DO caps; evidence gaps (19 ft raise, 2 m passing, U-start). Then deploy 4.

## 2026-09-27 ~23:20Z: Fourth production release (studio take replay)
- `72bb2ad`: `prepare.py` stages `engine/takes/*.json` (one line); `9561854`: evidence regenerated (17/17 rows, 8/8 milestones PROVEN).
- Gate GREEN at `9561854` (gitDirty false): 48/48, 177/1 skip, tsc clean, e2e 28/28 (no baseline refresh), probe `79447f75…6129` at 11403 ticks. Report `.cloudflare/gate/2026-09-27T23-03-25-583Z`.
- Production `89e65c8c-5abb-4377-a693-3689de30d465`; rollback `17f7c9aa…`. Live smoke: all routes incl. `/engine/takes/*` 200, R2 200, integration PASS; headless prod `/lab` 43/43, 0 violations, prod hash == probe; prod `/studio` take at "held" matches the baseline (37/37 entities, banner visible, 0 errors). `/studio` takes about 2 min to become ready here (38.5 MB GLB at ~310 KB/s).

## ~09:00–14:00 (09-28) — Six-agent wave (Gene: accelerate)
Landed (all with tests, hashes unchanged unless stated):
- Seats/benches/campfire are obstacles with approach points; sit-down/stand-up transitions (a2245cd); lab campfire script re-sequenced (3990932).
- Director demo over MCP (deploy/director-demo.mjs → DIRECTOR_DEMO.md, 0.9–1.6 s) + prepare.py folder rules + allowlist test (440f9e5, 472e53c).
- Stable historical ids `${assembly}-${kind}-${hash}` + 7,942-entry legacy migration; studio baselines unchanged (57c5e80; HISTORY_IDS.md).
- Single-carrier loads up/down stairs (152d5ce; carry/climb.ts): tilt on the flight, width rules, exclusive flight.
- Replay/fork/plan-invalidation proven through the real room (264b6bf; integration + api tests).
- Camera: parts + people as per-tick occluders; planner-vs-render disagreements 40 → 1 (a812baa verify pass; dfe3b56 fix); take 1.7 MB (gzip 274 KB).
- Engine scenes for 2020–2025 (b0d4c8b; 24–32 KB gzip each; 2021 corridor / 2022 courtyard routes proven); year rooms seed protected mars-<year> (50019d6).
- EUC/bicycle riders as engine agents (ba05486; VEHICLES.md).
- Region-local grid updates, bit-identical (5d77503): campus flagship compute 22.5 → ~10 s.
- MCP: engine_edit_world (design-edit), engine_list, engine_delete_workspace, one refusal envelope, seconds units (8ad737e…c2e0ee2).
In flight after a 5-h rate-limit cut (resumed): renderer sit/hold poses; lab year walkabout; sync-key/carry perf; forklift; mid-action resumable checkpoints.
Then: gate → release 5; HANDOFF refresh.

## ~19:30 (09-28) — Checkpoint
- All eleven wave workers landed (seats/approach, director demo + allowlist, stable ids, stairs carry, room isolation proofs, camera occluders + render verify, year scenes + rooms, vehicles + forklift, incremental grids + sync key, edit_world/list/delete/pause/resume ops, resumable checkpoints, renderer poses, lab campfire + year walkabout, evidence map + full-campus test, flagship v2). Engine ≈ 243 pass / 1 skip / 1 todo. Lead fix: forklift loads exempt from carry.support.
- Docs: HANDOFF checkpoint addendum (71efed0), NEXT_SESSION_PROMPT.md (26acb78), lab README brought current.
- Release 5 (checkpoint) running via `npm run gate` → deploy; see deploy/deployment.json + RELEASE_CHECKLIST.md for the outcome.
- Next session starts from NEXT_SESSION_PROMPT.md: first fix the grid-origin hash dependence (re-pins hashes), then ask Gene the two 2022/2023–24 reconstruction questions.

## 2026-09-28 ~02:30Z: Fifth production release (session checkpoint)
- Gate GREEN at `26acb78` (gitDirty false): 56/56, engine 243 pass / 1 skip / 1 todo, tsc clean, e2e 37/37 (no baseline refresh), probe `79447f75…6129` at 11403 ticks (unchanged). Report `.cloudflare/gate/2026-09-28T02-12-46-239Z`. Later commits are docs/evidence only.
- `d5d2f84`: evidence regenerated (17/17 rows, capabilities 11 PROVEN / 1 PARTIAL, 8/8 milestones).
- Production `cebd5827-b08d-4224-a320-afba968a1352` (from `d5d2f84`); rollback `89e65c8c…`. Live smoke: all routes incl. `/engine/campus-2022.json`, `/engine/takes/*` 200, R2 200; integration PASS (13 engine tools, 2022 year room); director demo PASS against production (9 steps, 7.4 s); headless prod `/lab` 43/43, 0 violations, prod hash == probe; prod `/studio` take at "held" identical to the baseline (37/37 entities, banner, 0 errors). Details in RELEASE_CHECKLIST.md "Production deploy 5".

## 2026-09-28 ~04:20Z (00:20 EDT) — Overnight session start (lead: Fable 5.1, unattended)
- Window 1 starts 00:18 EDT. usage.py at start: 5h 2 %, week 12 %, fable-week 10 %. Rule: 2–3 workers, ~50 % of each 5-h window.
- Gate GREEN at HEAD `ff63477` (unit 56, engine pass, tsc, e2e 486 s, probe): report `.cloudflare/gate/2026-09-28T04-17-58-413Z`.
- Wave 1 (spawned ~00:25 EDT): W1 grid-origin hash fix (`spatial/grid.ts`, re-pin); W2 hand-up engine (`construction/handup.ts`, climbable frames, build-bay-v3); W3 animated fire (renderer only).
- Sequencing decision: items 2+3 (walk.ts splines + immediate block reaction) start only after W1 lands so the hashes are re-pinned once more, together; item 4 (foot IK) and item 6 (handling poses) both live in `humans.ts` and run as one renderer track after W2 publishes hand points.
- Subagent cost tally (tokens / wall): —
### Questions for Gene
- (carried) 2022 SW-corner passage closed by west-house table; rv-8/9 (2023), rv-9/10 (2024) intrude into Chiba; 9 ft frame; north axis.
- (00:35 EDT) Gene: no production deploys until he says so; focus on functionality + constraints. Lead = Fable 5.1 as PM, Opus 5.5 workers.
- (W1, grid lattice, 2026-09-28) Grid coordinates are origin-independent: every LevelGrid is a window on one global lattice (`ox/oz`, `latticeIndex/latticeCentre/latticeOf` in `spatial/grid.ts`), so the full uncropped campus flagship is now bit-identical to the cropped one (`42dec8e8…dde61`, 11926 ticks; the `campus-full` todo is a real assertion). Re-pinned once (probe `c2c84663…67a41` at 11400 ticks, campus `42dec8e8…`, stress-30 `0ec4d884…`, gather `ea04513b…`); table and behaviour check in PLANNING_BUDGET.md. The recorded take `public/engine/takes/flagship-campus-2026.json` (11950 ticks, `b159317e…`) is stale until re-recorded.
- **W1 landed** `09f318b` (≈160k tokens, 11 min): grids on one global lattice (`ox/oz`, `latticeIndex/latticeCentre`; `cellOf/centreOf` the only world↔cell conversions; carry/planner + sweep routed through them). Full campus == crop: `42dec8e8…dde61` @ 11926 ticks (campus-full todo → real assertion). Re-pins in PLANNING_BUDGET.md (probe 79447f75→c2c84663 @11400; crop b159317e→42dec8e8; stress-30 →0ec4d884; G →ea04513b). Lead review: accepted — behaviour-preserving (same 43 steps / 37 entities / 24 components, 0 violations). Follow-ups queued for W4: `campus.test.ts:76`, `campus-history.test.ts:163` still compute centres by hand; take regen deferred until walk.ts re-pin.
- usage.py 00:42 EDT: 5h 4 %.
- Wave 1b: W4 spawned — splined turns + immediate block reaction (`locomotion/walk.ts`), final re-pin of this window.
- (00:55 EDT) Gene added §12 to OWNER_FEEDBACK: chairs (natural approach/turn/sit, legs-crossed stretch), tables with food items, take bowl+spoon, sit together and eat (deterministic eat cycle with hand points), 80/20. Queued as W5 (engine: catalog items, `engine/items/` verbs, meal scenario) when a slot frees; renderer part joins the humans.ts pose track.
- **W3 animated fire landed** (owner feedback §1, renderer only) `dd4d65b` + `8dc4dd8`: `viewer/app/engine-view/fire.ts` (≈200 lines) — noise-shaded cylindrical-billboard flame tongues (3 layers, one draw), coal bed, GPU-animated embers + thin smoke points, point light with seeded flicker (intensity ×0.72–1.22, small position jitter); a pure function of (`seedOf(entity id)`, sim/take seconds), no Math.random/Date.now. Lab `fixtures.ts` campfire and the studio ambience fire (`studio/scenery.ts`) share it. `e2e/fire.spec.ts`: close-up flame changes in 4.7 % of 2×2 blocks (> 32/255) between t 25.0 and 25.3 s while a still standing person (g4, oblique) changes 0.00 %; replayed tick 506 is bit-identical in the fire box; draw calls +1 (431/429/466 vs 430/428/465: the old DoubleSide cone was two passes); no console errors. New baselines `fire-dusk-{oblique,close}`; refreshed `lab-social-t20-oblique`, `lab-social-t60-top-debug` (firelit pixels only). Weak spots: smoke barely visible at dusk; flame core saturates to white; flames are billboards (fine at eye level, a blob from overhead); in the oblique preset a ring member hides the flame.
- **W3 landed** `dd4d65b`, `8dc4dd8`, `4645551` (≈190k tokens, 25 min): shared `app/engine-view/fire.ts` (3 flame layers, coal bed, 28 embers, 12 smoke puffs, flickering warm point light; pure function of id-hash + sim seconds); lab fixtures + studio `scenery.ts` fire rewired; `e2e/fire.spec.ts` (flame region changes 4.7 % of blocks between t25.0/25.3, standing person 0.00 %, replay bit-identical, draw calls +1). Lead LOOKED at fire-dusk-close + studio-fire-a: accepted — reads as fire, firelight on faces and ring. Weak spots recorded by W3 (billboards flat from above, faint smoke, white-saturated core, hard-coded OLD_CALLS in spec).
- usage.py 01:05 EDT: 5h ≈ 5 %. Wave 1c: W5 spawned — §12 meal/items engine (catalog items, `engine/items/`, `eat` cycle + hand points, meal test).
- **W5 items / meal engine** (owner feedback §12, 80/20): `7280cce` catalog — `world/catalog-items.ts` (`table-6ft` with 3×6 `surfaceSlots` at 0.75 m; `bowl`, `spoon`, `plate`, `cup`, `pot` with `handling { hands: 1, small: true }` + one grip slot), additive types: `Support` `in-hand { by, hand }` and `resting-on.slot`, `entity.contents { food, fraction }`, `human.hands { left?, right? }` (world hand points — the schema W2's hand_up now also writes) and `human.baseActivity`. `9b019d3` engine — `engine/items/`: `take_item` / `put_item` (seatApproach-style standing points ≤ 0.6 m from the edge, reach 0.4 s, grasp / release, refusals `item.held-by` / `item.hand-full` / `item.unreachable` naming blockers / `item.not-handheld` / `item.slot-occupied`), `serve` (pot ≤ 1.10 m, fills the bowl), `eat` (overlay: no actor claim, runs inside sit / gather / converse; 2.4 s cycle dip 0.6 → lift 0.6 → pause 0.4 → return 0.8, −0.2 per cycle, `eat.not-still`), internal `hold_items` (keeps held items at the hands every tick); all resumable. `meal.test.ts`: 4 people take bowl + spoon, serve, sit round the fire, eat 5 cycles each — 0 violations, 689 ticks, hash `baf84de6…ccbfd` (at walk_to e09a961: W4's walk.ts change must re-pin it); eat inside converse; 9 refusals; mid-eat snapshot/restore. Shared-file edits (additive): registry `ITEM_ACTIONS`, `SEATED_ACTIVITIES` + eat/serve, `slots.ts` exports `blockerNear`. Docs: ITEMS.md (hand-point contract for the renderer), SOCIAL.md verb row.
- **W5 landed** `7280cce`, `9b019d3`, `9c7236e` (≈270k tokens, 25 min): `world/catalog-items.ts` (table-6ft w/ 18 surface slots; bowl/spoon/plate/cup/pot), `engine/items/` (`take_item/put_item/serve/eat` + internal `hold_items`, resumable), `human.hands {left,right}` + `baseActivity` — same field W2's `hand_up` writes (one schema). Meal scenario: 4 people, 5 cycles, bowls→0, 0 violations, 689 ticks pinned `baf84de6…`; 9 refusal cases. Lead review: accepted; weak spots recorded in ITEMS.md (reach-over-table 1.1 m unchecked, 1-tick item lag while walking, no item–item collision, no lap support). Meal pin must be re-pinned by W4 (658 ticks under the new walk.ts).
- **W2 in flight**: `e09a961` climb links + beam walkways (`climb_frame`/`beam_walk`, `frameAccessOk`), `04ddbc7` `hand_up`, `17ac0a3` forklift variant; v3 scenario pending.
- usage.py 01:20 EDT: 5h 8 % (window 2 began ~01:07 EDT per usage.py). Tally so far: W1 160k/11 min, W3 190k/25 min, W5 270k/25 min.
- W6 spawned: renderer pose track — foot IK on stairs (§4), crouch/kneel/reach-up/reach-down/hold poses (§6), hand-held items + eat cycle + legs-crossed (§12), lab scenarios for hand-up and meal.
- **W2 landed** `e09a961`, `04ddbc7`, `17ac0a3`, `28c0837`, `f90e28d` (+ docs): owner feedback §5 + §6 engine side — see HANDUP.md. Climbable frames / walkable beam pairs (`climb:*` / `beam:*` links via opt-in `frameAccessContributor`; `climb_frame`, `beam_walk` 0.4 m/s, small loads ≤ 10 kg only, never under a deck; invariant `frameAccessOk`); `hand_up` (givers crouch → lift → walk-load → reach_up ≤ floor + 2.1 m → [push in]; receivers climb → beam-walk → reach_down ≤ 1.0 m below feet → take → stand_with_load → lay → set_down; part staged in place, `install_joist`/`install_plywood` fasten parts staged aloft); per-tick `human.hands {left,right}` for all holders + `handupHands(part, pose, holder, slot)` to rebuild them from a take (slots `handup-give-<i>:<lx>:<lz>:<axis>`, `handup-take-<i>`); `lift.hands-out-of-reach` covers both ends; `via: 'forklift'` with additive `forklift_present` / `forklift_back`. `build-bay-v3`: 7 joists + s1 by hand to two on the beams, s2 off the forks to two on s1, v2's stair/spare/campfire — 87 steps, 17288 ticks, 0 violations, pinned `584685f1…` (at HEAD walk.ts; W4's spline walk.ts gives 16191 ticks — re-pin with the others). Shared-file edits (additive): `Link.kind` climb/beam + optional fields, `HumanState.on`, `Handling.smallLoad`, `AssetDef.walkway`, `humanStaticClearance` skips `human.on`, registry `frameAccessOk`.
- **W2 landed** `e09a961`, `04ddbc7`, `17ac0a3`, `28c0837`, `f90e28d`, `11cd063` (≈530k tokens, 45 min): climb links per upright column + beam walkways (`climb_frame`/`beam_walk`, `frameAccessOk`), `hand_up` (crouch/lift/walk-load/reach_up ↔ climb/beam-walk/reach_down/take/stand_with_load/lay), `aloft.ts` (install_joist/plywood fasten staged-aloft parts), forklift variant + `forklift_present`/`forklift_back`, `lift.hands-out-of-reach` on both ends; `build-bay-v3` (12 ft bay — forks can't take a 4x6 short-side into v2's bay, refused not faked; 87 steps, 17288 ticks, 0 violations, pinned 584685f1…, W4 re-pins). Lead review: accepted; follow-ups → (a) tighten receiver horizontal reach to the spec's 0.5 m from the edge (now ≈1.2 m with lean), (b) make the frame-access contributor part of the API spatial scene, (c) long-load balance unchecked. HANDUP.md.
- Tally since 00:25 EDT: 1.15 M subagent tokens in ~70 min (≈1 M/h) — under the 1.5 M/h throttle; 3 workers continue.
- W7 spawned: §7 phase A — assembly graph + bill of materials + piles + `cut` verb + skeleton-stage sequence for the simplest year.
- **W4 landed** `9e1c2f4` (+ docs): owner feedback §2 + §3 — see MOVEMENT.md. `locomotion/spline.ts`: walk legs become straight runs + circular fillets (R 1.2 → 0.2 m, optional outward push), every piece checked every 2 cm against the raw corridor's clearance, sharp fallback; per-vertex speed caps √(1.5·R) so R ≥ 0.6 m at walking speed; heading follows the path chord, heading error caps speed → turn in place only beyond 120°, never > 180°. `walk.ts`: 1.5 s look-ahead (standing people, loads, stale geometry; blocked walkers contact-only) with bisected contact and 2 cm stop; emergency stop on the tick something appears inside the comfortable stopping distance; hold, then decide within 0.5 s (named wait or routeAround, backed off 0.5/1/2/4 s, fewer-obstacle fallback when walled in); most-room latched sidesteps; slow near a driven vehicle. Additive `HumanState.speed` (renderer Walk clip: speed ≥ 0.08 ⇔ activity 'walk'); `take/metrics.ts` walk-stall metric = **0** on build-bay (of 7391 walk-ticks), stress-30 (of 27275), campfire (of 2876). `movement.test.ts` (10 tests incl. adversarial). Re-pinned once (probe 11400→10693, campus crop=full 11926→11227, stress-30, meal 689→631, v3 17288→16191; same outcomes, 0 violations; PLANNING_BUDGET.md). `campus.test` / `campus-history.test` use `centreOf`. Follow-ups for the renderer (W6): stop the Walk clip on `climb-wait`, key it on speed.
- **W4 landed** `9e1c2f4`, `7508d09` (≈525k tokens, 57 min): `locomotion/spline.ts` (arc blends r 1.2→0.2 m, checked every 2 cm vs corridor clearance, curvature speed cap, turn-in-place only > 120°, shorter way), 1.5 s look-ahead + one-tick block stop + ≤ 0.5 s decision (wait w/ reason | route around), `take/metrics.ts` walk-stall metric = 0 on build-bay (was 24), stress-30 (11), campfire (9); honesty fix: motion ≥ 0.08 m/s is always `walk` (414 wait + 215 idle ticks were moving). `human.speed` field. Final re-pin (PLANNING_BUDGET): probe c2c84663→93fa2a0a @10693; crop/full ecb424c7 @11227; stress-30 093779fd; meal 9dae86bf @631; v3 e121377d @16191. Lead review: accepted. Open: per-tick cost +40 % mean on stress-30 (0.85 ms; failing people-replan ≈ 90 ms) — perf item for later; walker-vs-walker rules still on current direction, not the smoothed path.
- Takes (`public/engine/takes/flagship-campus-2026.json`) are now stale vs the engine (old hash b159317e…); studio-take.spec stays self-consistent. Regenerate + full gate after W6 lands (baselines will move together).
- usage.py 01:37 EDT: 5h 2 % (window rolled at ~01:35). Tally window 1 (00:18–01:35): W1 160k, W3 190k, W5 270k, W2 530k, W4 525k ≈ 1.7 M in 77 min.
- W8 spawned: §9 solar verbs + §8 paint verb + W2 follow-ups (receiver reach 0.5 m, frame-access contributor in API scene).

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
- **W6 renderer pose track** (owner feedback §3 renderer half, §4, §6, §12; POSES.md) `ad85f1b`, `79241a1`, `f8ff03d`, `386cd30` (+ docs): `app/engine-view/` `rig.ts` (bone chains, two-bone IK, leg IK placing the Root-parented Foot bones), `stair-gait.ts` (pure tread-by-tread gait from `Link.path`: feet planted on tread tops, 40 % swing, toe-off heel, reversible for descent), `posture.ts` (pure crouch / hip-bend / heel-raise solver over the spine chain, per-activity styles, 0.4 s blend), `items.ts` (bowl/cup/plate/pot/spoon meshes, food disc from `contents.fraction`, 6 ft table), `humans.ts` (layers: clip — Walk iff `human.speed` ≥ 0.08, out in 0.2 s — sit + legs-crossed variant, stairs, posture, arms to `human.hands` / grip slot, free arms hang when bent; `bones()` readout), `components.ts` (items `in-hand` ride the rendered palm; spoon aims bowl → lips). Lab presets `meal`, `hand-up` (build-bay-v3); hook `bones/stairs/heldItems`. Specs: `stairs.spec.ts` (up + down: 0.0 cm at every plant, no sinking), `meal.spec.ts` (99.0 % of 4372 hand points within 0.1 m, all rig-reachable ones; items stay in hand), `poses.spec.ts` (hand-up v3: 0 rig-reachable misses, no over-long arm, 54.8 % of 5528 engine points reached — see POSES.md "Reach gap": rig arm 0.44–0.50 m vs engine ARM_LEN 0.75). New baselines `poses-stairs-mid-flight`, `meal-spoon-at-mouth`, `meal-legs-crossed`, `poses-{pickup-crouch,handup,handup-joist,raise-footer}`; refreshed (inspected) `build-bay-{raise,held,visitor}-oblique`. `lab-social` t60 arrangement (warm 6 vs 7) fails on HEAD's engine (W4 timing), not the renderer; its t60 baseline was not re-captured.
- **W8 solar + paint + W2 follow-ups** (owner feedback §9, §8, §5/§6; SOLAR_PAINT.md, HANDUP.md) `cdcf731`, `bd2c73a`, `aa3b589` (+ docs): hand_up receivers' edge rule now also for deck stations (hands ≤ 0.5 m beyond the beam side / deck outline, `handup.receiver-reach` names the distance); long-load balance (one giver end-first = two-hand lever grip, slot suffix `:lever`, free end > 1.5 m → `handup.unbalanced`); frame climb links / beam walkways in the API spatial scene by default (`servicesFor(scenes, { frameAccess })`, `ControllerOptions.frameAccess`); v3 pin unchanged. Solar: `catalog-solar.ts`, `install_rail` / `install_panel` / `place_equipment` (`construction/solar.ts`), hand_up rests loads on installed rails, `carry/fragile.ts` (`carry.fragile-tilt` / `carry.fragile-dropped`). Paint: `work/paint.ts` (`paint`, panel `paint` state, take FIELDS += `paint`, `equipment`), plywood `paintable` faces.
- W8 **pending lead decision (moves v3's pin)**: the stricter "kneel at the edge" receiver rule (hands ≤ 0.8 m horizontally from the feet at reach_down/take, plan + invariant) refuses v3's s2 deck receivers (≈ 1 m back from where s2 is taken). Patch `scratchpad/w8-kneel-rule-v3-repin.patch` (applies on `aa3b589`): rule + invariant + v3 s2 receivers (crew[4] walks b3 to its north end past s2, crew[5] on s1 at its NW corner; crew[4] steps onto s2 after fastening) → v3 88 steps, 16248 ticks, final `0870c58386ccaa9d1a4c38f0a7001db4cad71ad0a7f240f7f19ad63fcaef946a` (was 16191 / `e121377d…`), 0 violations.
- **W6 landed** `ad85f1b`…`c7ca121` (≈435k tokens, 55 min): `app/engine-view/{rig,stair-gait,posture,items}.ts`; two-bone leg IK on stairs (sole vs tread 0.0 cm worst at plant), posture solver (squat, hip bend, bent spine chain), arm IK to `human.hands` with reach honesty, items in hands + fill discs, legs-crossed seated variant, Walk iff speed ≥ 0.08; lab presets `meal`, `hand-up`; specs stairs 3/3, meal 2/2 (99 % of 4372 hand points reached), poses 3/3 (hand-up only 54.8 % of 5528 — rig arms shorter than the engine envelope). Lead LOOKED: stairs ✓, meal ✓ (spoon at lips, legs crossed), hand-up ✗ (arms hang under the sheet; one receiver lies on the sheet). Decision → OWNER_DECISIONS "One body model". lab-social t60 "warm 6 vs 7" failing (engine timing after W4) — to investigate, not paper over.
- Takes lack `hands`/`baseActivity`/`on`/stair data → studio replay can't pose eating/hand-up; engine recorder FIELDS to extend (W10).
- W9 spawned (renderer): rig arms → body model, one-knee kneel at deck edge, closed-hand grip, replay consumption of hands/stairs, lab-social t60 investigation. W10 (engine body model + take fields + crouch hand motion + v3 re-verify) waits for W8 to release handup.ts.
- **W8 landed** `cdcf731`, `bd2c73a`, `aa3b589`, `ced34bd`, `47c90ff` (≈350k tokens, 90 min): hand-up receiver 0.5 m edge rule on decks too, single-giver lever grip + `handup.unbalanced` (> 1.5 m free end), frame access in the API scene by default (`frameAccess: false` opt-out); solar (`catalog-solar.ts`, `construction/solar.ts`: install_rail / install_panel / place_equipment, `carry/fragile.ts` tilt refusal + invariant); paint (`work/paint.ts`, 0.2 m bands, `panel.paint` in takes). 292 tests / 291 pass / 1 skip. Lead review: accepted. Lead decision: APPLY the pending kneel rule patch (`scratchpad/w8-kneel-rule-v3-repin.patch`: receivers' hands ≤ 0.8 m horizontally from their feet; v3 → 88 steps, 16248 ticks, 0870c583…) and bump RULES_VERSION → mars-assembly/3 — assigned to W10.
- W10 spawned (engine): body model + kneel patch + v3 re-pin + RULES_VERSION + take FIELDS (hands/baseActivity/on) + crouch hand motion.
- **W10 landed** `a3a2c68`, `b7c901a`, `af52359`, `2a8b4f7` (+ docs): kneel rule at the edge (W8 patch: receivers' hands ≤ 0.8 m from their feet at `reach_down`/`take`, plan + invariant; v3 s2 receivers moved) + `RULES_VERSION` `mars-assembly/3`; **one body model** `engine/body/model.ts` (shoulders 1.42, arm 0.62, overhead 2.0 + 0.06 heels = **2.06 m** = the §5 standing reach everywhere, reach-down 1.0, 0.8 m horizontal, posture bands) imported by hand-up, items (items/body.ts now only eat landmarks), solar, aloft, paint, access, rules — no duplicated reach constants in those; givers carry at 0.80 m, lever givers stand beside the end, paint columns 1.0 m, solar test battery 0.36 m move, `handup.giver-reach`; hand-up hands travel from the hips during crouch / reach_down (smoothstep; `hands.teleport` ≤ 0.25 m/tick in handup/handup-rules/solar tests, worst 0.14); takes `mars-take/2` (hands mm, baseActivity, on, speed cm/s, contents; v3 take 458 → 675 KB, gzip 102 → 142 KB). Pins: v3 16191 → 16248 (`0870c583…`, kneel rule) → 16219 (`339cf310…`, body model), 0 violations, same outcome; meal unchanged. 295 tests / 294 pass / 1 skip. BODY_MODEL.md. Open: `construction/stance.ts` (W7, year-build hang) still has its own GIVE_MAX / STANCE_UP 2.1; reach-down cap 1.0 vs the kneeling envelope's 0.77 m (owner decision).
- **W7 year build, phase A** (owner feedback §7 headline, skeleton stage; YEAR_BUILD.md) `3be2449`, `c3cb58a`, `aa248de` + generator / scenario / test commit: assembly graph of every year scene (`campus/assembly.ts`: Kit posts + crossbar → catalog frame, beams `connects-to` frame columns at seats, features opaque, `unclassified` with reasons — 2022: 48 frames, 216 beams, 0 unclassified; 2020's racks don't map and are reported); reconstruction frames `upright-<ft>ft-kit` (stock seats + the Kit's 0.22 / 2.48 / h−0.12 m levels), whole-foot lumber, 4xN plywood, bundles / stacks, cutting station (`world/catalog-stock.ts`, one registration in `catalog.ts`); bill of materials + one-sided pile yard (`campus/bom.ts`); `take_from_bundle`, `cut`; frame stances (bracing as a ladder) + `hang_beam` (ground / hand-up / relay) + `hold_frame` / `let_go` (`construction/stance.ts`); stability v1.1 in `rules.ts` (held uprights of a group carried by their holders; pins unchanged); skeleton generator (`campus/sequence.ts`) + `scenarios/year-build.ts`. Chosen year **2022** (fewest catalog frames / beams of the mappable years; four identical 2-level houses), first building **east-house**: 552 steps, 116 477 ticks (≈ 97 min simulated), 0 violations, all 66 sequenced frames / beams installed at the canonical pose (max 0.57 mm, 0°), pinned `14d5c768…` (gated `YEAR_BUILD_FULL=1`, ~40–55 s); the first-bay tranche (198 steps, 41 019 ticks, 24/24 parts, `ad844b78…`) runs in the suite; unplaced (phase B, with reasons) 27 deck sheets, 21 stair parts, 20 solar parts, 4 walls. No forklift (forks reach 3.2 m, top beams sit at 4.76 m). Code commit `904f513` (+ stance reach on `body/model.ts`; runner: a ready step waits for an ambient make-way walk holding its actor instead of aborting).
### Questions for Gene (W7, year build — not resolved by the engine)
- **Ground datum**: the Kit stands every piece on y = 0 but the published year scenes (and the studio) put the ground at −0.16 m, so rack posts start 16 cm above the drawn ground. The build runs on the Kit datum (y = 0). Which is right?
- **Beam heights**: the Kit hangs beams at 0.22, 2.48 and 4.757 m (16 ft frames) — on no real hole pitch (0.22 m is below any plausible first hole). The engine reproduces them exactly with `upright-16ft-kit` seats. Keep the Kit's levels, or move the reconstruction's beams to real hole positions?
- **How were top beams (~4.76 m) hung?** The model climbs the frames' bracing (installers at ~3 m, a relay at ~0.9 m, two on the ground handing up). Was it that, ladders, a scissor lift / man basket, the forklift, or bays assembled lying down and raised whole?
- **Stock on site**: sheets per plywood bundle, pieces per lumber unit, and how uprights / beams were stacked (the piles here are chosen to look like the evidence photos, not documented).
- **2022 stairs**: the Kit draws a 4.45 m-wide, 8-tread end stair with no stringers — what was actually built (width, stringers, a ramp)? (phase B)
- **Deck strips**: the Kit's decks are 4 ft × 15 ft plywood strips laid at beam height with no joists; real decks were 4x8 sheets on 2x4 joists? (phase B)
- **W10 landed** `a3a2c68`, `b7c901a`, `af52359`, `2a8b4f7`, `b7a1f3e`, `0c523bb` (≈300k tokens, 75 min): kneel-rule patch applied (v3 → 16248 ticks 0870c583…), RULES_VERSION mars-assembly/3; `engine/body/model.ts` is the single reach model (arm 0.62, shoulders 1.42, overhead 2.06 with heels = the §5 standing reach now; reach-down 1.0; 0.8 m horizontal-from-feet; edge 0.5; table 0.6) imported by handup/solar/aloft/paint/access/rules/items; honest-envelope adjustments (givers carry at 0.80 m, single giver stands beside the joist end, paint columns 1.0 m → two spots per sheet, painter goes idle between columns — a bug found); crouch/reach_down hands travel over the phase (`hands.teleport` ≤ 0.25 m/tick, worst 0.14); take schema `mars-take/2` with hands/baseActivity/on/speed/contents (v3 take gzip 102 → 142 KB). v3 re-pinned again → 16219 ticks `339cf310…` ("body model unification"). 295 tests / 294 pass / 1 skip. Lead review: accepted.
- W11 spawned (engine perf, hash-identical): walker per-tick cost after W4 (stress-30 mean 0.85 ms, failing people-replan ≈ 90 ms).
### Questions for Gene (added 03:50 EDT)
- Reach-down from a deck edge: the spec says ≈ 1.0 m below the feet, but a kneeling body (shoulders ≤ 0.15 m below the feet + 0.62 m arm) reaches only ≈ 0.77 m. Options: lower the cap to 0.77 m (more hand-ups become "use the forklift"), or allow a lying-down receiver posture (reach ≈ 1.0 m). W10 left the cap at 1.0 with refusals at station choice. Your call.
- **W9 renderer body-model track** `84f22e9`, `0773702` (+ docs; POSES.md "Body model", "Take replay"): `rig.ts BODY_MODEL` (renderer copy) — every template scaled uniformly so its shoulder joints stand at 1.34 m (Quaternius rigs are big-headed: lifting them to an anatomical 1.42 m would make them 1.87 m tall, eyes 1.72 m; punk was 7 % small because its hair counted as height), UpperArm/LowerArm lengthened once per template to 0.62 m shoulder → palm (k 1.29–1.38; rest offsets + clip translation tracks + one-axis skin stretch via bind inverses, hands unscaled), shrug an exact 5 cm overhead. **Measured** (lab preset `body`, `probe()`, `poses.spec.ts` within 2 cm): arm 0.620, overhead 1.997 flat / 2.057 heels up (= engine 2.0 / 2.06), **reach-down kneeling at an edge 0.35 (woman) – 0.54 m (casual, punk)** at 0.45 m out, kneeling reach out 0.78–0.96 m. **Engine mismatches printed every run**: shoulderHeight 1.42 vs rendered 1.34, shoulderHalf 0.19 vs 0.12–0.15, reachDownBelowFeet 1.0 vs 0.35–0.54 (a kneeling body's shoulders stay above the deck even bent 150° over it; the lead's 0.77 estimate assumed shoulders 0.15 m below the feet). One-knee kneel in the posture solver (reach_down/take/lay past a 60° standing bend, far ground pickups, raise footers), closed-hand grip on every arm in contact. Hand-up v3 at `b7c901a`: **63.3 % → 89.5 %** of 5518 engine hand points reached, 0 rig-reachable misses (floor 88 %); per activity crouch 78→119/216, lift 214→216/216, walk-load 304→514/514, reach_up 620→1773/2166, reach_down 148→172/264, take 176/176, stand_with_load 161→176/176, lay 1592/1592, set_down 198/198. Take replay: `TakePeople` (shared by studio `TakeReplay` and the lab) consumes `hands` / `baseActivity` / `on`, frame phase/support (items ride the palms), stairs from base scene + construction contributor — proven with a lab-recorded take + fixture fields (`e2e/take-fixture.ts`): meal 216/216 points as live, stairs soles 0.0 cm from live. lab-social: x1 arrives at 63.3 s (3.5 s traffic wait behind g3 standing warm in the ring, then replan) — late not missing, check moved to 65 s. Baselines refreshed after inspection: poses-{handup,handup-joist,pickup-crouch,raise-footer,stairs-mid-flight}, meal-{spoon-at-mouth,legs-crossed}, fire-dusk-{close,oblique} (people's arms/scale only), lab-social-{t20-oblique,t65-top-debug}.
- **W9 landed** `84f22e9`, `0773702`, `0137056` (≈450k tokens, 2 h): rig scaled per template to shoulders 1.34 / arm 0.62 / overhead 2.00 (+0.06 heels), measured in-lab and asserted within 2 cm; one-knee kneel, closed grip; hand-up v3 hand points reached 63 % → 89.5 % (0 rig-reachable misses); `TakePeople` replay consumes hands/baseActivity/on/items/stairs (proven with a fixture); lab-social: nobody fails to arrive — x1 waited 70 ticks (3.5 s) behind g3 standing still in the ring before replanning; check moved to 65 s with the reason. Lead LOOKED at poses-handup: accepted (giver overhead both hands, receivers kneel/squat on the beams).
- Engine follow-up from W9: a walker waiting 3.5 s for a person who is standing still violates §3 (≤ 0.5 s decision) — `walk.ts` fix after W11 (perf) lands; must not move hashes silently (re-pin with reason).
- W12 spawned (engine): body model adopts the measured rig (see OWNER_DECISIONS), re-verify hand-up/solar/paint/v3, re-pin with reason if moved.
- **W7 landed** `3be2449`, `c3cb58a`, `aa248de`, `904f513`, `0f7ccec` (≈620k tokens, 90 min): §7 phase A. Assembly graph (Kit post/crossbar/bracing groups → catalog frames; beams → column seats; 2022 whole year 48 frames / 216 beams / 0 unclassified; 2020 → 364 unclassified rack parts, 2025 → 39), BOM + pile yard (`catalog-stock.ts` bundles/stacks/cutting station, `take_from_bundle`, `cut`), `construction/stance.ts` (bracing as ladder, `hang_beam` ground / hand-up / relay modes, `hold_frame`/`let_go`, stability v1.1), sequence generator → **2022 east-house skeleton from piles in a fork of protected mars-2022: 552 steps, 116,477 ticks (≈ 97 min sim), 0 violations, 66/66 parts at canonical pose (max 0.57 mm / 0°)**; first bay (198 steps, 41,019 ticks, 24/24) in the default suite, whole house behind `YEAR_BUILD_FULL=1`. Pins ad844b78… / 14d5c768…. Unplaced for phase B: 27 deck sheets, 21 stair parts, 20 solar, 4 walls. Lead review: accepted. Follow-ups: climb paths not body-checked; beam walk-in checks static geometry only (no people check); bundle keeps full box until empty; `contents.count` needs a formal type; BOM solar id vs W8's catalog ids.
- W13 spawned (engine): §7 phase B — decks (hand-up plywood), stair material rule + sequencing, solar (W8 verbs), walls, for east-house; comparison test extended; unplaced → 0 or reported.
- **W12 (engine): body model = the measured rig.** `engine/body/model.ts`: shoulders 1.34 m (were 1.42), half-width 0.15, arm 0.62, overhead 2.00 / 2.06 heels, shrug 0.05, reach-down **0.5 m** below the feet (the spec's ≈ 1.0 m superseded — BODY_MODEL.md, HANDUP.md), kneel rule 0.8 m now with a physical basis (kneeling rig reaches 0.78–0.96 m out at 0.1 m below its feet); posture bands from the rig (tops 1.45 = shoulders + shrug + heels; crouch 0.50, kneeling 0.07 / lean 0.35, upright 1.22, painting 0.82), chest 1.22, rest hands 0.72, mouth 1.58 kept. New `test/body-model.test.ts` (measured values + internal consistency: overhead ≈ shoulder + arm + shrug, caps bind before envelopes, bands from rig hips/torso, landmarks within an arm). Consumers: hand-up givers now raise to what their hands reach at the grips (`postureTop`: 2.05 m, not 2.06 — otherwise every ground hand-up was refused by ~4 mm); a deck the old 1.0 m allowed (seat 2.6 m) is now `handup.too-high` → forklift (new test case); paint: the top 0.38 m of a standing 4x8 is refused from the ground and painted from a 0.6 m platform (new test), band coverage fixed to the face's true top (2.4384 m). No station moved. Pins: v3 re-pinned once (16219 → 16237 ticks, `339cf310…` → `5f32379d…`), same outcome (scratch diff: steps, grips, levels, final states identical); meal, year-build first bay (41019, `ad844b78…`) and whole house (`YEAR_BUILD_FULL=1`: 116477 ticks, `14d5c768…`, 0 violations, 66/66) unchanged. W13 note: deck hand-ups need receivers ≤ ≈ 2.57 m above the givers' floor.
### Questions for Gene (from W7, 03:00 EDT)
- Kit stands parts on y = 0 but published year scenes use −0.16 m ground: which is the truth for the build takes?
- `upright-16ft-kit` seats sit exactly at the Kit's photo-estimated beam heights (0.22 / 2.48 / 4.757 m), not on a real hole pitch (2 in). Real pitch would move beams by up to ±2.5 cm vs the reconstruction. Keep the Kit heights, or snap to the pitch?
- **W12 landed** `6cc13b3` (≈210k tokens, 30 min): `body/model.ts` = measured rig (shoulders 1.34, half 0.15, arm 0.62, overhead 2.00/2.06, reach-down 0.5 @ 0.45 out, kneel reach-out 0.8; `shrug` 0.05, `rig` hips/torso/squat/kneel numbers, bands derived, `postureTop`), `body-model.test.ts` (measurement match + internal consistency); givers raise only to `postureTop` at their grips (2.05 m); 2.6 m seat now `handup.too-high` (limit ≈ 2.57 m above the givers' floor); paint top band 2.06–2.44 refused from the ground, painted from a 0.6 m platform (+ fixed a coverage rounding bug). v3 re-pinned 339cf310→5f32379d @16237 ("body model = measured rig"); meal / year-build pins unmoved (whole house re-run: 116477 ticks, 66/66). 303 / 301 / 2 skip. Lead review: accepted. Open: woman template reaches 0.35 m down (< 0.5 cap) → per-person body variant in the engine later; giver hands at 0 mm slack on the envelope by design (fragile to any rounding change); renderer not re-run against chest 1.22 / rest-hands 0.72 → W14.
- W14 spawned (renderer): e2e catch-up on HEAD, render solar/rails/equipment/paint progress/bundles/cutting station, climb + beam-walk poses, lab preset "2022 east-house skeleton from piles".
- **W11 landed** `719ba10`, `ccd6839`, `fad3ccc`, `dfcaa93` (+ docs; PLANNING_BUDGET.md §6): walker perf, **every pin bit-identical**
  (stress-30, probe, campus crop, meal and v3 hashes equal to a HEAD-minus-W11 tree in 3/3 alternating runs; stress corridor
  `0754e1eb…` too). Changes: one entity snapshot + one load-disc read per `walk_to` step (the V8 dictionary-mode `world.entities`
  made each `Object.values` ~2 µs); `routeAround` proves unreachable goals with a reverse flood beside the A\*; skips the
  unusable-link explanation the walker never reads; `narrow()` 7× cheaper and reused per clearance array.
  Stress-30 warm mean tick 0.69–0.71 → 0.48–0.50 ms (CPU −29 %); failing people-replan 88–94 → 9 ms; corridor max tick
  88 → 53 ms; campus flagship compute −13 %, probe −5 %, v3 −4 %. Not met: exact max tick ≤ 60 ms (tick 5 = 27 exact A\*,
  ~95 ms; only the corridor planner or spread submits get there, and both move hashes). Test `walk-perf.test.ts`, bench
  `deploy/perf-walk.mjs`.
  Finding for the lead: `walk.ts`'s fewer-obstacles fallback fires only when a failed `routeAround` names one of its obstacle
  ids in `diagnostic.subjects`. `findRoute` only ever puts link ids there, so the fallback never runs; MOVEMENT.md says it
  does. Fixing it moves hashes (a behaviour change, for the W9 "waits 3.5 s" follow-up). Also: `walk.ts` still uses host
  `Math.hypot` (intrusion / encounter / occupant / stairBlocker); swapping it for `dist2` may move hashes by ulps.
- **W11 landed** `719ba10`, `ccd6839`, `fad3ccc`, `dfcaa93`, `67a9a00` (≈330k tokens, 45 min): one entity snapshot per walk step (Object.keys+index), `proveUnreachable` reverse flood (failing people-replan 90 → 9 ms), typed-array `narrow()`, `explainUnusable` skip; stress-30 mean 0.70 → 0.49 ms, campus crop compute 5.5 → 4.8 s; all five pins bit-identical (3/3 alternating runs), `walk-perf.test.ts` + `deploy/perf-walk.mjs`. Not met hash-identically: exact max tick (tick 5 = 27 synchronous A* ≈ 90 ms; corridor planner or spread submit-time planning would fix it but move hashes). W4's "+10–25 % compute" did not reproduce (host load). Lead review: accepted. Findings → W15: the fewer-obstacles fallback never fires (`findRoute` puts only link ids in `subjects`), explaining W9's 3.5 s wait; `walk.ts` uses host `Math.hypot` (source-scan test doesn't cover hypot).
- W15 spawned (engine walk.ts behaviour, one re-pin): fallback fix, `Math.hypot` → `dist`/`dist2` + scan covers hypot, walker-vs-walker on the smoothed path, stationary-blocker decision ≤ 0.5 s.
- **W14 (renderer): e2e catch-up, solar / paint / stock rendering, rack-structure poses, 2022 east-house preset.**
  `8aedc3d`, `2408cb1`, `87ed562` (+ poses/docs commit). E2e on `36aa230`: 48/49 green; the one red was `poses-pickup-crouch`
  (inspected: since W12's landmarks the joist giver squats with both hands on the joist instead of a kneel + >100° bend; refreshed).
  Hand-up v3 (16237 ticks, 5554 points) 91.8 % → 92.5 % reached with a 25° walking bend (walk-load 478 → 514 / 514), 0 rig-reachable
  misses; the `ENGINE MISMATCH reachDownBelowFeet` print stays (woman template 0.35 m vs 0.5). Rendering (`components.ts`,
  `fixtures.ts`, `paint.ts`): solar panels (glass + aluminium frame + cells, tilt from the pose), rails, labelled battery / charge
  controller / inverter (entity `equipment`), per-band paint overlay (width = band coverage; texture = hashed colour + stripe until
  textures exist), bundles / stacks drawn to `contents.count` with straps, cutting station, Kit frames with the Kit's bracing.
  Poses (`frame-gait.ts`, POSES.md "Rack structure"): climbing as a two-hand two-foot ladder cycle facing the frame (0.35 m rungs),
  both soles on the bracing node on a stance, a turn on the rod toward a held beam, beam-walk arms out + short steps. Lab presets
  `year-build-2022` (first bay; live = node rehearsal, 41 019 ticks `ad844b78…`) and `year-build-2022-house` (116 477 ticks
  `14d5c768…` in 33–37 s wall in headless Chromium), `solar-paint`; specs `year-build.spec.ts`, `solar-paint.spec.ts`, poses climb /
  beam-walk test; year build hand points 62.6 → 76.5 % reached. Skeleton vs the skeleton-stage photo: the rack vocabulary matches
  (braced frames face-on, beams at three levels, open bays); missing the 2x4 timber frame (phase B), frames blue not green.
  Findings for the engine: (1) `hang_beam` walk-in: both lifters face the direction of travel, so the rear lifter carries, lowers
  and slides the beam with its hands 0.35–0.65 m behind its back (walk-load / lift / hook at the 0.22 m seat) — turn the rear lifter
  to face the beam (or walk it backwards); (2) installers on a stance hold the beam 0.73–0.79 m beside the body point (column 0.3 m +
  stage axis 0.457 m) while facing their frame — the engine envelope (a cylinder) allows it, a body needs to turn / lean (the renderer
  turns it on the rod); a `human.facing` override for stances holding a load would let takes carry it; (3) the whole house submits
  77 ambient make-way walks for people already reserved by a waiting step (`reservation.conflict`, a red FAILED banner each in the
  lab; same outcome) — `makeWay` should skip reserved people; (4) no engine foot holds / climb facing: the renderer's ladder cycle and
  climbing facing are its own reading of the link path.
- **W15 landed** (engine walker behaviour, one re-pin; MOVEMENT.md §2, PLANNING_BUDGET.md §6 "walker fallback + hypot + encounters on the smoothed path"):
  - **§3 ≤ 0.5 s decisions.** The lab-social x1 wait was not the missing fallback: its walk_to crept 3 mm on alternate ticks
    between two ring neighbours. The static sidestep flipped side every tick (g3 +0.8 / g2 −0.2), and every creeping tick
    reset the decision clock. It decided after 79 ticks (1030 → 1109) and was warm at 63.3 s.
    - Now a blocked stretch ends only at > 0.15 m/s or 0.2 m of progress.
    - The sidestep never flips while its person is alongside.
    - x1 walks steadily, stops once behind g2 (tick 1053), replans 9 ticks later and is warm at 58.2 s (tick 1163).
  - **Fallback made real.** `findRoute` names the people / loads behind a failure (`RouteOpts.nameObstacles`, additive,
    `b7dd62e`): crowding start / goal, walling in the exhausted region, at a needed stair's approach; structural failures
    name nobody. The old "route round only the blockers" walked walkers into the others once it could fire (campfire_circle
    f8 → f7). It is replaced by a squeezed replan: everyone as 0.22 m octagons, never planned inside the 0.54 m separation.
    `routeAround` lets a crowded start snap up to 1 m.
  - **Arrived walkers count as standing.** A walker at the end of its route, turning to face, used to be classed as
    oncoming / crossing by its rotating yaw.
  - **Encounters on the smoothed path.** follow / head-on / crossing use the path ahead (2.5 m, 0.1 m samples, at the current
    offset) and the other walker's 1 s path chord; the result equals the old measure on straight paths. `encounterOf` test hook.
  - **hypot.** `core/math.ts` `hypot` (√ of a sum of squares); `dist2` / `len2` and all 149 former host `Math.hypot` calls in 55
    `engine/**` files (core/math.ts and tests included) use it. The core.test source scan now bans `Math.hypot` (pow / exp / log were already
    banned).
  - **Tests.** 8 new (movement: stationary blocker ×3 activities, moving blocker, campfire x1, squeezed replan, curved-passage
    head-on, corner crossing, encounters-follow-the-path; navigation: naming).
  - **Re-pinned once**, 0 violations and the same discrete outcome everywhere:
    - probe 10693 → 10729, campus 11227 → 11316, meal 631 → 626, v3 16237 → 16230;
    - year-build 41019 → 41182 and whole house 116477 → 117125 (66/66);
    - stress-30, and G by 1 ulp.
  - **Open.**
    - `**` (host pow) remains in 14 non-test engine lines, not scanned: grid / path / vehicles / social nearest-cell squares, take
      metrics, camera quality, solar, stance, invariants, fragile, sun, hash (2 ** 32, exact).
    - 1.08–1.5 m gaps between people are walkable but not plannable at 0.1 m cells.
    - Head-on round a tight corner is decided by the single-file traffic rule, not by the encounter.
- **W15 landed** `b7dd62e`, `d38a71d`, `9c8eb53` (≈430k tokens, 47 min): `findRoute` names the people/loads behind a failure (`nameObstacles`); the never-firing fallback replaced by a squeezed people-replan (0.22 m octagons, separation ≥ 0.54 m kept); one decision clock per blocked stretch (ends only > 0.15 m/s or 0.2 m progress) + sidestep latch — real root cause of x1's 79-tick wait (3 mm creep with the side flipping every tick); arrived walkers count as standing; encounters measured on the smoothed path 2.5 m ahead; `core/math.ts` `hypot` replaces host `Math.hypot` in 149 call sites (scan now bans it; `**` still unscanned on 14 lines). x1: blocked 79 → 9 ticks, warm 63.3 → 58.2 s. Re-pin "walker fallback + hypot + encounters": probe 0147f8f1 @10729; crop/full fee92ee0 @11316; stress-30 1298e2e5; meal 035e8c39 @626; v3 66800edc @16230; year-build first bay 695d2dcb @41182; whole house 35d12886 @117125 (66/66); G 9ba1037c. 312 / 310 / 2 skip. Lead review: accepted incl. the two beyond-brief behaviour changes (squeeze, settled = standing) — both documented in MOVEMENT.md.
- usage.py 04:23 EDT: 5h 21 %, week 19 %. Tally: ≈ 5.9 M subagent tokens in 4 h (≈ 1.5 M/h — at the throttle; keep 3 workers but no more).
- W16 spawned (engine camera, §11 phase 1): direction vocabulary + compiler, trajectory synthesis (orbit from extent, sun-behind window, camera navmesh through doors), MCP tool.
- **W14 landed** `8aedc3d`, `2408cb1`, `87ed562`, `6b5d971`, `c9ce960` (entry above swept into `00e0e81`): full suite on `6b5d971` (after W15's
  re-pin) 53 / 53 with `meal-legs-crossed` refreshed (W15 moved that moment 278 → 358; inspected); v3 16230 ticks 92.5 % (5156 / 5574);
  year build first bay 41 182 ticks `695d2dcb…` = node rehearsal, 76.6 % of hand points, soles on node / rungs 100 %; whole house
  117 125 ticks in 33 s wall, 66 / 66, 67 failed ambient make-way walks (finding 3 above).
- **W14 landed** `8aedc3d`, `2408cb1`, `87ed562`, `6b5d971`, `c9ce960`, `90b59ce` (≈520k tokens, 100 min): renders solar panels/rails/equipment (labelled), paint bands (texture = colour+stripe until textures exist), strapped bundles/stacks shrinking with `contents.count`, cutting station; climb-frame ladder cycle, beam-walk, stance turn-on-the-rod; lab presets `year-build-2022` (first bay, 41 182 ticks = node rehearsal) and `year-build-2022-house` (117 125 ticks, 33 s wall, 66/66) + `solar-paint`; year-build spec compares live stepping with a node rehearsal (not hard pins). v3 hand points 92.5 % reached, 0 rig-reachable misses; year-build stance soles 44 682/44 682 on bracing nodes. Playwright 53/53 on HEAD after two inspected refreshes. Lead LOOKED at year-build-skeleton, year-build-handup-248, solar-paint-mounted-equipment: accepted. Skeleton vs the evidence photo: same vocabulary (face-on braced frames, three beam levels, open bays), missing the 2x4 top framing + stair ramp (phase B) and the photo's green frames.
- Engine findings from W14 → W17 after W13 lands (all in `construction/stance.ts`/`sequence`): (1) rear `hang_beam` lifter faces travel and carries the beam behind its back — must face the beam or walk backwards; (2) stance holders' hands 0.73–0.79 m beside the body point with the yaw facing the frame — needs a `human.facing`/turn for stance holders in takes and a climb pose on `climb:`/stance links; (3) whole house submits 67 `makeWay` walks for people already reserved by a waiting step → `reservation.conflict` FAILED banners (outcome unchanged) — `makeWay` should skip reserved people; (4) no foot/hand holds for frames (which bracing node a climber is on).
- W17 spawned (consolidation in a worktree at HEAD): regenerate the flagship take, full `npm run gate`, `npm run evidence`, HANDOFF numbers.
- **W16 (engine camera, OWNER_FEEDBACK §11 phase 1)** `649bc72` + docs/tests commit. Details in `CAMERA_DIRECT.md`.
  - `camera/direct.ts`: typed `CameraDirection` vocabulary (zod) and a `SemanticWorld` resolver. Entities, take
    structures from the connection graph ("rack bay"), scene assemblies, regions, fixtures clustered by contact
    (sink bowl + rim = one sink), and groups by action/activity. Ambiguity is a `camera.direct.ambiguous` question
    with candidates; unknown names are refused with what is known.
  - `camera/synth.ts`: computed trajectories.
    - Framing by `fitDistance`; smootherstep timing under motion caps (20°/s, 30°/s², 6 / 1.5 m/s, 2 m/s²).
    - Sun-behind heading/pitch window from `env/sun.ts` (new `sunBehindWindow`), verified at every sample.
    - Camera navmesh: band rasters via `buildGrids`, layered A* with a flight layer from 2.2 m, clamped cubic
      B-spline (C²), curvature-aware speed profile.
    - Program = dense `path` shots, validated by `planShotList` with alternates off.
    - Report per shot with `corrections: []` for phase 2.
  - `engine_direct_camera` tool (`api/schemas.ts` + `controller.ts`, additive).
  - Results:
    - Flagship bay orbit, 270° in 120 s: radius 13.86 m, 0 invalid, readability min 0.67.
    - Chiba sunset pan (2026): 90 / 90 samples in the sun window.
    - 2024 kitchen → sink (2026 has no kitchen or sink): 9.1 m over the half wall, not through the east wall,
      18 s.
  - Tests: +16 (camera-direct 8, camera-synth 8).
- **W16 landed** `649bc72`, `37a0d1d` (≈500k tokens, ~2 h): §11 phase 1 — `camera/direct.ts` (zod `CameraDirection`: subject entity/assembly/region/group, verbs pan/tilt/dolly/orbit/crane/push_in/pull_out/fly_through/hold, framing, `sunBehind{sunset}`, `interior`, `lookAt`; ambiguity → `camera.direct.ambiguous` with candidates), `camera/synth.ts` (orbit radius from extent+lens, view-rate/accel caps, sun-behind window from `env/sun.ts`, camera navmesh = clearance grids + flight layer, C² path, continuous look-at), op `engine_direct_camera {take_id, directions[]}` with per-shot report + `corrections: []`. Proven: 270° orbit of the flagship bay over 120 s (r 13.86 m, 0 invalid, readability min 0.67); sunset pan across Chiba at 17:18 (90/90 samples in the window, sun ≥ 7° off axis; `not-sunset` refused at 16:00); "inside the kitchen, face the sink" on 2024 (2026 has no kitchen/sink; route enters over the 1.26 m half wall — no year scene has door objects); group orbit follows carryA. 328 / 326 / 2 skip. Lead review: accepted. Weak: alternates off (problems reported, not fixed — phase 2), collision static-only, "main pallet racks" needs "rack bay", navmesh rebuilt per call (100–250 ms), north offset 0.
- W18 spawned (engine camera, §11 phase 2): simulate every shot against the take, score failure modes, ranked explicit corrections recorded with reasons, CAMERA_VERIFY regression feed.
- **W18 (engine camera, OWNER_FEEDBACK §11 phase 2 — self-correction)** `b554592`, `bc8dd33` + docs. Details in `CAMERA_DIRECT.md` §6.
  - `camera/solve.ts` (additive) `scoreShot`: every sample of a directed shot simulated against the take (people and
    parts per tick, the sun, the caps) — collision; squeeze (free width across the camera < 1.2 m against solids and
    take-part boxes, free height < 1.0 m by an exact footprint column test, part clearance < 0.3 m; sustained ≥ 0.3 m /
    0.5 s); foreground (a non-subject person ≤ 1.5 m from the lens covering ≥ 25 % of the subject's frame region);
    flare (visible sun < 6° off axis); frame (< 75 % of the subject's points framed, incl. a structure's members as
    they arrive in its final box); horizon (|pitch| > 75°, roll > 1°); motion (per-sample `MOTION_CAPS`).
  - `camera/correct.ts` `correctShot`: raise → widen → swing (flare: only inside the sun-behind band) → re-route (the
    squeezed slot blocked, take parts as obstacles) → shorten → split (two shots with a cut) → cut; fixed ladders,
    first candidate valid on every sample wins; recorded `{ failure, samples, strategy, before, after, reason, params,
    tried, attempts }`; nothing works → refused with every strategy listed (refusals keep their code).
  - `synth.ts`: `directCamera` runs it by default (`DirectInput.correct`), SynthOverrides `navRadius` / `avoid`, the
    sun in the context, per-shot `simulation`; `engine_direct_camera` gains `correct?` (additive).
  - Fixtures (`camera-correct.test.ts`, synthetic yard takes): plywood 0.8 m → raise +1 m; head at the lens → raise
    +0.5 m; group outgrows the frame → widen ×1.15; crew walks 6 m in a 270° orbit → no correction (a fixed centre fails
    `frame` on 91 samples); pan across the 1.8° sun → swing +20° inside the band; sealed room → refused, 7 listed.
  - Phase-1 shots: flagship bay orbit, carry orbit, Chiba sunset pan valid as computed (`[]`). Two genuine issues:
    the 2024 kitchen move threads a 0.79 m serving hatch (the only camera-sized way in) → split at the hatch; the
    proving-ground orbit of n1 went inside the passage west wall (phase 1: a planner rescue cut) → raise +1 m.
  - CAMERA_VERIFY cannot run on directed tracks from node (browser + the take file's own `camera`); needs a
    `verifyCamera(…, { track })` option in `app/studio` — reported, not touched.
  - Tests: +8 (camera-correct), camera-synth / camera-direct updated for the two genuine issues.
- **W17 consolidation** (worktree at `6ff7a67`, rebased onto `cd69215` after W16 landed; ≈ 0.3 M tokens, ~50 min):
  - **Takes.** `record-campus-take.mjs` gains `--scenario flagship | build-bay-v3 | year-build-2022`, `--all`, per-scenario `--check`;
    the flagship path is byte-identical to the old script (checked). Flagship re-recorded: `969c8bf9…` = `fee92ee0…` @11316
    (1 746 020 B, gzip 288 378; was `c531eaf4…` / `b159317e…` @11950, 1 736 933 / 280 180). 2022 east-house first bay:
    `9970e93e…` = PIN_BAY1 `695d2dcb…` @41182, 2 881 438 B (camera 0.5 Hz), listed under manifest `otherYears`. `mars-take/2`
    loads through the unchanged `mars-take-replay/1` wrapper (no `take-host.ts` change needed); W16's camera tests read the new
    flagship file and pass.
  - **Gate** `.cloudflare/gate/2026-09-28T09-15-51-095Z` (worktree), GREEN at `3d04649`:

    | stage | result | time |
    | --- | --- | --- |
    | unit (`npm test`) | 56 / 56 | 0.4 s |
    | engine | 326 pass / 0 fail / 2 skip (328) | 42.1 s |
    | tsc | clean | 4.6 s |
    | e2e | 52 passed / 1 skipped | 524.1 s |
    | determinism probe | `0147f8f12a99…` @10729 | 2.6 s |

    First run (at `268b66d`, before the baseline refresh): unit failed only because the worktree lacked `campus.glb.br`
    (setup, now symlinked), and `studio-take-held` differed 7.71 % from the old take's frame. Refreshed and inspected:
    `studio-take-held` (209.9 s, both frames standing on their beam pairs, every column held, "seat b1 at 0.5 m"),
    `studio-take-visitor` (565.8 s, the visitor on the finished deck, same follow framing).
  - **Evidence** at `f4d6738`: rows 17/17, capabilities 21 PROVEN / 1 UNPROVEN (year build B: no engine test cites phase B yet),
    milestones 8/8; ten new capability rows mapped with approximation notes; 86 tests added since `6ad36f0`, 3 renamed.
  - **Findings for other owners (not patched):**
    1. *v3 site sensitivity* (`scenarios/build-bay-v3.ts` / `beam_walk` in construction): `onto_s2_4` fails `beam.no-room`
       ("no room to stand at … on deck s2, clearance 0.25 m < 0.28 m", tick 10443) at 11 of 17 site origins tried on open
       ground (e.g. (0,5), (0,−9), (20,−9), (28,±…), every staging-east candidate), passing only at (0,0), (0,±1), (0,−0.5),
       (0,−3), (1,0), (28,0); on the real campus at (28,0) the deck passes but `carry_spare` fails `carry.no-route`. The pinned
       v3 run is a knife edge (~3 cm), so v3 cannot be recorded as a studio take. Probe script: scratchpad `v3probe.mjs`.
    2. *Take size* (`take/recorder.ts`): `hands` changes are ~0.9 MB and `speed` ~0.35 MB of the 2.4 MB year-build take (per-tick
       while hanging beams) — thinning like the pose tracks would keep long year takes small.
    3. *Studio* (`app/studio/take-panel.tsx`, `page.tsx`): the picker lists every manifest take and the take host exists only
       in 2026; to offer the 2022 take, filter by `entry.year === year`, create a host for every year, and account for the
       year-build datum (y = 0 vs the published −0.16 m ground).
- **W18 landed** `b554592`, `bc8dd33`, `dc6386c`, `e8f681c` (≈350k tokens, ~90 min): §11 phase 2 — per-sample checks (static collision; squeeze < 1.2 m wide / < 1.0 m high / < 0.3 m from a part lasting ≥ 0.3 m or 0.5 s; bystander ≤ 1.5 m covering ≥ 25 %; sun < 6° off axis; < 75 % of subject points framed incl. members arriving in place; pitch > 75°, roll > 1°; motion caps) + `camera/correct.ts` ladder raise → widen → swing (in the sun band) → re-route → shorten → split → cut, each re-synthesized and re-simulated, record `{failure, samples, strategy, before, after, reason, tried}`; refusal lists all strategies. Fixtures: plywood squeeze → raise +1 m; behind-a-head → raise +0.5; group outgrows frame → widen ×1.15; moving-crew orbit needs nothing (fixed-centre orbit fails 91 samples — check works); flare → swing +20°; sealed room refused. Phase-1 bay orbit / carry orbit / Chiba sunset pan valid with `[]`; 2024 kitchen route actually threads a 0.79 m hatch → split with a cut at 5.6 s; proving-ground n1 orbit was inside a wall → raised. 339 / 336 / 3 skip. Lead review: accepted. Weak: one correction per shot; readability still planner-only; verify pass needs the browser (`verifyCamera` lacks a `{track}` option) → W19.
- W19 spawned (studio): "Watch it being built" replay picker over the recorded takes, direction text → `engine_direct_camera` → shot list + corrections in the replay bar, `verifyCamera({track})` + e2e over directed tracks.
- **W17 landed** `659d90c`, `b151d8a`, `e54a34b`, `ef4921d`, `be65c7a`, `4e82c8d` (≈350k tokens, 48 min): gate GREEN at the consolidated head (unit 56/56; engine 326/0/2; tsc; e2e 52 pass / 1 skip in 536 s; probe 0147f8f1 @10729 = pin; report `.cloudflare/gate/2026-09-28T09-29-51-376Z` in the w17 worktree); flagship take re-recorded `969c8bf9…` = pin fee92ee0 @11316 (1.75 MB / 288 KB gz); 2022 east-house first-bay take `9970e93e…` = pin 695d2dcb @41182 (2.9 MB / 482 KB gz, camera 0.5 Hz) under manifest `otherYears`; `record-campus-take.mjs --scenario flagship|build-bay-v3|year-build-2022 --all --check`; two studio-take baselines refreshed (inspected); evidence 17/17 §28, 21 PROVEN / 1 UNPROVEN (year build B — W13's test untracked) / 22, 8/8 milestones (camera direction unmapped yet). Lead review: accepted. Findings: (1) **v3 bug** — `onto_s2_4` `beam_walk` fails `beam.no-room` (0.25 < 0.28 m on s2) at staging-east and 11/17 site origins; the pinned open-ground run is ≈ 3 cm from failing (probe `scratchpad/v3probe.mjs`) → W21 after W13 releases construction/**; (2) take size: `hands` ≈ 0.9 MB + `speed` ≈ 0.35 MB of the 2.4 MB year take → W20 thinning; (3) studio needs a per-year take host + datum offset (y 0 vs −0.16) → sent to W19.
- W20 spawned (engine take/recorder.ts): thin `hands`/`speed` like pose tracks, replay hash-preserving; whole-house take budget.
- **W20 (take thinning, mars-take/3)** `0fe78aa`, `860dcaf`: `hands` / `speed` changes are keyframes now (`INTERP_FIELDS` hands 5 mm Euclidean, speed 1 cm/s; `thinChanges` in `TakeRecorder.finish()`, greedy like pose tracks, holds keep their last tick, releases / shape changes exact; linear between keyframes of one shape via `interpChange`). `sampleTake` interpolates them and indexes `changes` once per take (binary search, no full scan per call); `sliceTake` (api/controller.ts, shared file: +bracketing keyframes of thinned fields) still samples like the take. Proven: re-recorded flagship / 2022 bay 1 / 2022 whole house (YEAR_BUILD_FULL) with the new recorder → final states = pins (fee92ee0 @11316, 695d2dcb @41182, 35d12886 @117125), take ids = the offline projection (79c19511…, 81c47592…, f3e27e28…); every tick checked vs the /2 step signal: worst hand 4.93 mm, speed 1.00 cm/s, all releases exact. Sizes (take JSON, raw): flagship 539 → 468 KB, bay 1 2.51 → 1.35 MB, whole house 8.32 → 3.94 MB (gz 1.35 → 0.76 MB; hands 3.83 MB → 100 KB, speed 1.06 MB → 414 KB). sampleTake over the whole house ≈ 114 s → 14 s. Tests: engine 340 / 337 pass / 0 fail / 3 skip at d44c601 + W20 (worktree); tsc clean (also on the shared tree with W19's edits). **Not re-recorded**: `public/engine/takes/*.json` are still /2 (a /2 take still samples; holds between ticks only) — `--check` will mismatch take ids after the re-record the lead schedules. **Renderer (W19)**: `TakePeople.handsAt` must interpolate between consecutive `hands` keyframes of the same shape at any gap (today: only when 1 tick apart → a /3 take would step), or read `sampleTake(...).entities[id].hands` (metres, interpolated). The lab/e2e hands FIXTURE (take-fixture.ts, hook.ts) is obsolete since /2.
- **W20 landed** `0fe78aa`, `860dcaf`, `579afd1` (≈190k tokens, 40 min): `mars-take/3` — `hands`/`speed` thinned to keyframes in `TakeRecorder.finish()` (5 mm / 1 cm/s; linear between same-shape keyframes, exact releases), `sampleTake` indexed by binary search (whole house 972 → 122 µs/tick), `sliceTake` keeps bracketing keyframes. Whole-house take 8.32 → 3.94 MB (gz 1.35 → 0.76); first bay 2.51 → 1.35 MB; flagship 539 → 468 KB. All three pins unchanged; re-recorded takes match offline thinning byte-for-byte. 340 / 337 / 3 skip. Lead review: accepted. Committed takes still /2 → re-record with the next consolidation. Next to thin: tracks (2.0 MB) + events (0.9 MB). Finding → W21: `walk_to` publishes one-tick speeds of 4–11 m/s (9 in the flagship, 88 in the whole house) — positions jumping ≈ 0.2–0.55 m in a tick under the 0.6 m `motion.teleport` limit.
- W21 spawned (engine walk.ts): diagnose/fix the speed spikes (snaps on replan/reposition), tighten `motion.teleport`, re-pin once if it moves.
- **W19 (studio replay: watch it being built, direct camera, verify directed tracks)** `0ab2e6f`, `b0af6c7`, `8393e9f` + docs (`STUDIO_REPLAY.md`):
  - **Picker.** Manifest-driven: `takes` + `otherYears` filtered by `year`. Year-build entries (`kind: 'year-build'`, else
    `rulesVersion` ~ `year-build`) also appear as **Watch it being built** under the year picker. There is a take host
    per year.
  - **Datum.** `campus-<year>.json groundY − site.groundY` (2022: −0.16 m), applied to a shifted render copy so the arm
    IK stays in scene coordinates.
  - **Replay behaviour.** The rebuilt building is hidden while its take is open; speeds go up to 64×; the take log
    (blocked / refused) is shown live.
  - **Final checks.** Replayed hash = recorded = manifest; last frame = final state; `compareToCanonical` over the year
    file's graph. 2022 first bay: ✓ 24/24, max 0.2 mm.
  - **Direct camera** in the replay bar: a typed form or the JSON list, compiled in the browser (`directCamera`, the
    recorder's camera scene), shot list with corrections, play the directed track. The flagship carryA close hold
    gives foreground → raise 1 m.
  - **`verifyCamera { track }`** over the bay orbit, the corrected hold, the Chiba sunset pan and the 2024 kitchen:
    240/11/18/37 samples, 0 hidden, 0 with |Δ| ≥ 0.2.
  - **Replay bugs fixed** (`take-replay.ts`):
    1. recorded `hands` (integer mm) reached the arm IK unconverted; they are now read through `sampleTake` (metres,
       `/3` keyframes interpolated);
    2. fixture entities (piles, the cutting station) were drawn as people; they now go through `FixtureViews`, with
       piles shrinking.
  - **Retired** the metre-valued hands fixture (`e2e/take-fixture.ts`); meal/stairs replay the recorder's own fields,
    and the meal hand-target tolerance is 6 mm for `/3`.
  - **Take gap for W17 / engine:** an entity removed mid-take (the emptied `pile-upright-16ft-kit-1`) has no record in
    the take, so the replay cannot draw it (`info().undrawable`).
- **W19 landed** `0ab2e6f`, `b0af6c7`, `8393e9f`, `6374b60` (≈330k tokens, 105 min): **"Watch it being built"** in the studio year picker (manifest-driven over `takes` + `otherYears` filtered by year; take host per year; datum from `campus-<year>.json groundY − take site.groundY`; refusal/blocked log live; final check = recorded hash + parts at canonical pose from the take report); Direct-camera panel in the replay bar (typed form + JSON → in-browser `direct/synth/correct` → shot list with corrections + reasons → play directed track); `verifyCamera({track})` + `e2e/camera-verify.spec.ts` over the bay orbit / carryA hold / Chiba pan / 2024 kitchen: 0 hidden samples, 0 planner-vs-render disagreements; `TakePeople` reads hands via `sampleTake` (/3-ready), retired the metre fixture; fixed two replay bugs (mm hands unconverted; piles drawn as people). 23/23 specs. Lead LOOKED at studio-build-final + studio-direct-shots: accepted. Weak: rebuilt racks draw 0.16 m below the Kit's (datum applied to the take copy); directed tracks live in the page, not beside the take; take lacks initial state for entities removed mid-take (emptied piles undrawable) → W22.
- W22 spawned (engine take + re-record): `entities0` (initial def/kind/pose for every tracked id), thin tracks/events, re-record flagship + 2022 bay-1 (+ whole house if < 6 MB) as /3, studio specs green.
- **W21 (no walker jumps)** `3674124` + docs (`MOVEMENT.md` §7, `PLANNING_BUDGET.md`):
  - **Diagnosis.** A scratch spy over the six pinned runs looked at every person-tick and what `walk_to` was doing.
    Three `walk_to` classes (counts in `MOVEMENT.md` §7):
    - **A. release after a hold:** while the hard layer cancelled steps, the lateral offset drifted to its sidestep
      target, and the body jumped up to 0.55 m on release. This is W20's p6 @1092 at 11 m/s.
    - **B. offset collapse:** `place()` halved an offset that had no clearance in one step (0.1–0.55 m).
    - **C. swept offset / sidestep at full speed:** 1.5–3.7 m/s. There were 3115 such ticks in the whole house.
    - Replan / crowded-start snaps were **not** a class: routes already begin at the body, so the snap is walked.
  - **Also found:**
    - `climb_stance` jumped up to 0.37 m onto the frame from `walk_to`'s snapped goal;
    - a dropped / failed task left idle people publishing `human.speed` 0.3–0.6 m/s.
  - **Fix** (`walk.ts`):
    - one per-tick budget of min(speed, 1.4 m/s)·DT;
    - largest fitting fraction of the tick's progress, else pull the offset in first, else walk back to the corridor
      point;
    - the offset is reverted with a cancelled step;
    - offsets narrow by bisection;
    - the stair entry is stepped onto;
    - `speed` param ≤ 1.4.
  - **Changes outside `locomotion/`:**
    - shared `runtime.ts` cleanup deletes `human.speed` (1 line);
    - W13's `stance.ts`: the climb path starts at the body (3 lines).
  - **Invariants:**
    - `motion.teleport` is 0.15 m/tick for people on foot; riders and carried loads keep 0.6 m;
    - new `motion.overspeed` (published speed ≤ activity cap + 5 %: walk 1.4, climb 0.45, idle / wait / climb-wait
      0.08; an uncapped activity with a speed fails).
  - **After:** max one-tick walker distance 0.0675 m in every run; 0 violations everywhere; the walk-stall metric 0;
    pushes asserts unchanged.
  - **Re-pin, once, same discrete outcomes:**

    | run | before → after |
    | --- | --- |
    | probe | 10729 → 10901 |
    | campus | 11316 → 11459 |
    | meal | 626 → 608 |
    | v3 | 16230 → 16401 |
    | bay 1 | 41182 → 41317 (24/24) |
    | whole house | 117125 → 117277 (66/66) |
    | stress-30 | new hash |

  - **Tests:** 342 / 339 pass / 0 fail / 3 skip at `3674124`; `perf-walk` PIN-OK ×5.
  - **For the lead / W22:**
    - `public/engine/takes/manifest.json` and `deploy/record-campus-take.mjs` (bay-1 pin 41182 / 695d2dcb) still name
      the old final states; the re-record picks up the new ones.
    - HEAD `f58e527` (W13, after W21) has 1 red test: `year-build-b` plan expects `riser: 2`, but the new parts list has
      none. That is W13's parts-b change, unrelated to walking.
- **W22 (takes mars-take/4: entities0, thinner tracks / events, re-record)** `5976c6b`, `15991b1` + docs (`TAKES_AND_PLANS.md` "Compact tracks, events and entities0"):
  - **Schema bumped to `mars-take/4`.** Compacted `events` change meaning for a reader that counts statuses. The studio
    loader checks only the wrapper and the hash.
  - **`entities0` + `removed`.** Every tracked entity is stored as first recorded (minus provenance / label / tags), and
    removals are listed as `[{ id, t }]`. The studio draws from `entities0` when the final state lacks the entity. The
    emptied `pile-upright-16ft-kit-1` is drawn until tick 29 588. `info().undrawable` is `[]` at every studio-build
    moment (asserted), and the yard capture shows both upright stacks.
  - **Tracks at `TRACK_TOL` 4 mm / 8 mrad** (replay ≤ 4.5 mm / 8.5 mrad; measured 4.50 / 8.31). Position holds are now
    exact at both ends: at 4–5 mm a stop or start smeared into 0.004–0.047 m/s take "walk stalls" (movement.test). 5 mm
    flipped a marginal directed-orbit heading search in camera-direct.test, so 4 mm is used.
  - **`compactEvents`.** Same-tick lifecycle runs fold to one event with `from` (lossless via `expandEvents` /
    `takeEvents`). A repeated blocked wait becomes one event with `n` and `until`. `blockedWaits` counts `n`, and the
    studio log shows "×n until t".
  - **What is unchanged.** Final state, changes and every pin are unchanged.
  - **Cameras** are planned from an exact re-run (`EngineConfig.trackTol: 1`; additive in rehearse.ts), so the shipped
    `camera.data` is byte-identical to a 1 mm plan. Planned from the thinned tracks, the whole-house camera changed on
    99 of 2 933 samples, which was too close to the 0.2 threshold.
  - **Recorded.** The 2022 first bay (1.34 MB file, take 938 KB) and, via `--full`, the whole skeleton
    (`year-build-2022-east-house.json`, 3.85 MB, take 2.71 MB) were recorded. `kind: 'year-build'` is on both, and
    `--check` is deterministic.
  - **Before and after.** File sizes: first bay 2.88 → 1.34 MB. Take gzip: flagship 117 → 67 KB, first bay
    421 → 169 KB.
  - **Tests.** Engine 344 tests, 340 pass, 3 skip, 1 fail: W13's `year-build-b` A+B plan (`riser: 2` missing). It is
    pre-existing at `f58e527`. Studio specs: studio-take, studio-build, studio-direct, camera-verify (2), stairs (4)
    and meal (2 of 3) pass. `meal: captures` fails with `meal-legs-crossed` 2.92 % off its baseline; it fails
    identically at `main` (a live-lab pose after W21, not a take). Its baseline was not refreshed.
  - **Open 1: the flagship is not re-recorded** (still /2, `969c8bf9…`). Re-recorded at W21's motion (`c56ea8da…`,
    take `d2f16bd3…`), `camera-synth.test.ts` (a)'s directed 270° bay orbit reaches min readability 0.56 < 0.6. The
    same happens with 1 mm tracks, so the motion causes it, not /4. The camera owner needs to accept or fix it; then
    run `record-campus-take.mjs --scenario flagship`.
  - **Open 2: v3** is still refused: `beam.no-room` at `onto_s2_4` (tick 11 009), "no room to stand at (27.80, -6.20)
    on deck 1.83 m (clearance 0.25 m < 0.28 m)".
  - **Open 3: phase A + B** is not recordable. It aborted on a `beam_walk` (0.45 m off a walkway), and its take is
    ≈ 8 MB.
  - **Open 4: the camera sampler** (`take-sampler.ts`) still takes the kind of an entity absent from `finalState` as
    `human`. The emptied pile counts as a bystander for camera scoring. It is left as is to keep the planner's inputs
    unchanged.
- **W21 committed** `3674124`, `a6556a3` (report pending): walk_to per-tick step budget min(speed,1.4)·DT (progress, sidestep, pull-back share it; offsets reverted with the body; bisection narrowing; stair entry stepped), `motion.teleport` 0.15 m/tick on foot, new `motion.overspeed` (speed ≤ activity cap + 5 %), runtime cleanup clears `speed` with the task, stance climb starts from the body; max one-tick walker distance 0.0675 m over stress-30 + campfire. Re-pin "no walker jumps": stress 5c3a3355, probe b746b094 @10901, campus c56ea8da @11459, meal 3c28879f @608, v3 a2f782ad @16401, bay-1 251a44c5 @41317, house d382e461 @117277 (24/24, 66/66).
- **W22 landed** `5976c6b`, `15991b1`, `5423c77` (≈340k tokens, 70 min): `mars-take/4` — `entities0` + `removed` (emptied pile drawable; `info().undrawable` = []), pose tracks 4 mm / 8 mrad with exact hold ends (5 mm flipped a directed orbit's start heading), `compactEvents` (same-tick status runs; repeated blocked waits → n + until), cameras planned from an exact 1 mm re-run (`EngineConfig.trackTol`); 2022 bay-1 1.34 MB / 247 KB gz, whole skeleton 3.85 MB / 698 KB gz (`--full`), `kind: 'year-build'` in the manifest. Flagship NOT re-recorded: under W21's motion `camera-synth.test (a)` 270° orbit min readability 0.56 < 0.6 (also at 1 mm) — ready /4 file in `scratchpad/w22/new/`. Lead review: accepted. Open: v3 `beam.no-room` at `onto_s2_4` (after W13); A+B `--full` aborts on a `beam_walk` 0.45 m off a walkway (W13); camera sampler treats a missing entity as a person; directed tracks not stored beside the take.
- usage.py 07:07 EDT: window 3 began ~07:00; 5h 3 %, week 24 %. Tally ≈ 9.5 M subagent tokens over 6.8 h (≈ 1.4 M/h).
- W23 spawned (engine camera): phase-1 tests through the phase-2 pipeline (orbit self-corrects instead of failing a threshold), missing-entity sampler fix, directed track stored beside the take, then re-record the flagship as /4.
- **W21 report received** (≈350k tokens, 80 min): spike classes A release-after-hold (0.55 m), B offset collapse, C offset swept round a bend at full speed, + stance climb entry; all six runs now ≤ 0.0675 m/tick on foot; stale-speed and climb-start bugs fixed too. Lead review: accepted. Open: look-ahead still assumes 0.9 m/s lateral (walkers briefly slow while sidestepping); carry/climb/stance/sit publish no speed (bounded only by 0.15 m/tick); runs 1–2 % longer. W13 told to fix its red `year-build-b` "A+B: plan" test (`riser: 2`) and to look at both `beam_walk` refusals (v3 `onto_s2_4`, A+B `--full`).
- **W23 (engine camera: flagship re-record, occluded, kind-aware sampler, take-file cameras)** on branch `w23-camera` (rebased on `294926e`) + docs (`CAMERA_DIRECT.md` §6, §8):
  - **Diagnosis of the 0.56.** The directed 270° bay orbit is geometrically the same at W21's motion (centre
    (29.26, 1.67, −7.63), radius 13.86 m, height 7.27 m, start 90°). The crew's timing changed: `carry_j1` runs
    231.2–263.5 s (it was 230.8–257.3 s). At t 259.2–259.3 s the camera passes due west of the bay while p2 stands at
    upright A's foot and p1 walks across the line to B. Each upright loses its 4 bottom points (44 %), giving
    readability 0.56 on 2 samples. This is not a synthesis bug: phase 2 had no failure mode for the planner's
    readability.
  - **Phase 2 `occluded`.** A sample fails when the planner's own readability is < 0.6 because of something that is
    not the subject: co-subjects are ignored, framing and size are excluded (cutaway ≥ 0.6), and fly-throughs are off.
    One sample is enough. raise, widen, swing, shorten, split and cut address it.
  - **One knob per correction.** Corrections re-use the first synthesis's searched start heading; before, a raise
    re-searched the heading and moved it from 90° to 45°.
  - **Flagship orbit corrected.** The orbit now goes through `correct: true`: raise +2.5 m (+0.5 m and +1 m still
    occluded on 2 samples, +1.5 m on 1). Height is 9.77 m, with the same centre, radius and start heading. Planner
    min readability is 0.61, mean 0.92; the 0.6 threshold is kept.
  - **Proving-ground n1 orbit.** raise +1 m used to clear the wall but looked at n1 through it; the correction is
    now swing −90°.
  - **Sampler.** Kind now comes from finalState, else from entities0. Piles and the cutting station are boxes, and an
    entity leaves at its removal tick. Before, *every* pile was a person, not only the removed one. The flagship is
    identical.
  - **Year-build cameras, not re-recorded (for the lead).** The fix would move bay-1 `cam-305a0efe` → `cam-7492f43a`
    (min 0.403 → 0.42) and the whole house `cam-9609b6f7` → `cam-b83a6828` (cuts 50 → 52). The recorder keeps
    `legacyKinds` for year-build until the lead accepts that delta.
  - **Take-file cameras.** Take files carry `cameras: { [id]: track }` (`withFileCamera` / `fileCameras` /
    `fileCamera`). The recorder keeps them across a same-take re-record. The studio read path is in §8.2.
  - **Flagship take.** `d2f16bd3…` (pin `c56ea8da…` @ 11 459, mars-take/4), 1.54 MB, gzip 234 KB, camera
    `cam-bb4b6990b0c93c33`. `--check` is OK for all three takes.
  - **Tests.** Engine: 347 tests, 344 pass, 3 skip, 0 fail. E2E: studio-take, camera-verify (2), studio-direct and
    studio-build pass. The `studio-take-visitor` baseline was refreshed after looking at it.
- **W23 landed** `7422331`, `7362943`, `a6f4a02`, `8c91825` (≈280k tokens, 25 min; merged ff from `w23-camera`): the 0.56 = p1/p2 crossing the sight line at t 259.2 s under W21's timing (orbit geometry unchanged); new phase-2 failure `occluded` (planner readability < 0.6 caused by non-subjects; off for fly-throughs) → test (a) corrected by raise +2.5 m (height 9.77 m, min 0.61, recorded reason); corrections keep the searched start heading; proving-ground n1 orbit now swing −90° (raise had looked through the wall). Sampler classifies by kind via `finalState`/`entities0` (every pile had been a person), dropped at `removed`; take files carry `cameras: {id: track}` (`camera/track.ts` helpers; read path for the studio in CAMERA_DIRECT §8.2). Flagship re-recorded `d2f16bd3…` = pin c56ea8da @11459 (1.54 MB / 234 KB gz). 347 / 344 / 3 skip; studio-take, camera-verify, studio-direct, studio-build green; `studio-take-visitor` refreshed (inspected). Lead review: accepted. **Lead decision:** accept the sampler delta — drop `legacyKinds: true` in the recorder and re-record `--scenario year-build-2022` + `--full` (bay-1 min readability 0.40 → 0.42; whole house cuts 50 → 52) — folded into the next consolidation.
- 07:40 EDT: W24 spawned (studio: file cameras in the replay bar + save directed track, whole-skeleton "Watch it being built" at 64× with frame-time numbers, drifted meal baseline); W25 spawned (engine, hash-identical: automatic pre-emption of social holds by directed tasks, vehicle–vehicle collision + yielding). W13 still in flight (phase B: decks, stair, solar landed; walls + A+B run + report pending).
- **W24 (studio: file cameras, save directed track, whole skeleton at 64×, meal baseline, lab yard view)** — commits
  `e607410`, `81ce842`, `0d0158e`, `9c2c012` + this docs commit (`STUDIO_REPLAY.md` §1–§6, `e2e/README.md`):
  - **File cameras.** `TakeReplayFile.cameras?` typed and checked on load (`fileCameras`); replay-bar **Camera** picker:
    planned, every `cameras` track (`kind · id · n shots`), an unsaved in-page directed track; plays via `fileCamera` →
    `trackData` → `sampleTrack` like the planned one. Hook `verifyCamera(…, { track: { file: id } })`.
  - **Save track** (Direct camera) → `withFileCamera` → download named like the shipped file (byte-identical + `cameras`,
    tested); the owner copies it into `public/engine/takes/`. **Not posted to a room:** no controller op stores a
    precomputed track or take file (`attach_camera_track` takes a shot spec, `direct_camera` directions, both for a
    room-held take); the panel says so.
  - **Whole skeleton.** Both 2022 builds offered with length + ticks; studio-build runs per take: whole skeleton ✓ 66 / 66
    at the mars-2022 pose (max 0.2 mm), hash = manifest, last frame 0.57 mm. **64× for 10 s (SwiftShader):** 19.8 fps,
    frames 50.8 / 66.7 / 83.3 ms (mean / p95 / max), 64.6 take-s per wall-s; redraw 1.38 ms mean, `sampleTake` 0.24 ms
    (bay 1: 0.15) → **no cache** (a loaded-machine run stalled to p95 267 ms with redraw unchanged: rendering / CPU).
    Log: merged waits "(×n over d s, until m:ss.s)", same waits resuming within 5 s fold (160 → 154 lines, totals kept).
  - **meal-legs-crossed** refreshed: same eater and pose, moment tick 358 → 278 under W21 (diff zero on her).
  - **Lab** "Oblique yard" on the year-build presets = the whole-skeleton take's first camera sample (tested to 1 mm).
  - **Specs:** studio-direct 2, studio-take 1, camera-verify 2, studio-build 5, lab 8, meal captures 1 — all pass (in
    the W24 scratch worktree on HEAD; the main tree's tsc error is W25's in-progress `social.test.ts`).
  - **Open (not studio):** whole skeleton t 2682.3 s, m5 on a frame stance reaching *down* for the relayed top beam —
    rendered palm 1.025 m from the recorded hand (`humans.ts` posing; the other 11 hand moments 0 mm). Template step
    labels `$crew[0] steps out of the aisle` in the whole-skeleton take. The 95 make-way `reservation.conflict` refusals
    (known since W14) show as "refused / failed" in the replay.
- **W24 landed** `e607410`, `81ce842`, `0d0158e`, `9c2c012`, `133ee39` (≈250k tokens, 27 min): replay-bar Camera picker (planned + file `cameras` + unsaved directed), "Save track" → take file with `cameras` downloaded under the shipped name (no room op stores a computed track — controller has none); whole-skeleton "Watch it being built" plays at 64× ≈ 20 fps (frame 51 ms mean, `sampleTake` 0.24 ms — no cache needed; redraw 3 % of a frame), picker labels with duration/ticks, merged wait lines "(×n over d s, until m:ss)"; `studio-build.spec` runs per year-build take; `meal-legs-crossed` refreshed (same pose, moment 358 → 278 after W21; inspected); lab "Oblique yard". 27 specs pass. Lead LOOKED at studio-build-east-house-final: accepted — 12 frames, 66/66 ✓, piles emptied, next to the three finished houses. Weak: one stance reach-down palm 1.025 m off at 3.01 m (engine envelope vs body, W14 finding 2); 95 refused = makeWay conflicts (W14 finding 3); unfilled `$crew[0]` step labels in the whole-skeleton take (sequence/recorder side, W13).
- 08:10 EDT: in flight W13 (phase B), W25 (pre-emption + vehicles). Third slot held for the final consolidation (gate + evidence + re-record with the sampler fix + HANDOFF/NEXT_SESSION_PROMPT) once W13 lands or by ~09:00 at the latest.
- **W25 (engine, hash-identical: automatic pre-emption of social holds; vehicle–vehicle collision)** — commits
  `17a1c9b` (pre-emption), `e95d607` (vehicles) + a final commit (make-way nudges exempt, SOCIAL.md / VEHICLES.md, this entry):
  - **Pre-emption** (HANDOFF open item). `ActionDef.yieldTo` on every social verb; `Runtime.submit` reads a directive's
    reservations before its plan and, when its only conflicts are `actor:` claims under social actions, cancels the
    smallest unit (own seat / slot — a gather keeps the rest; the ambient walk; the whole converse / face) with
    `social.pre-empted` "pre-empted by <id> (<verb>)" on the record + take events. A seated person's 0.6 s stand-up
    parks the directive (`requested` / `pre-empting`) until the end of the tick the seat is free, then plan → reserve →
    start. Social vs social stays `reservation.conflict`; make-way nudges are not directives; `preempt: false` (params
    key or submit option) = the old refusal. `cancel(id, reason?)`; waiting directives in `isActive` / `runUntilIdle` /
    parent cleanup; `snapshot()` refuses while one waits.
  - **Vehicles** (`vehicles/traffic.ts`). Footprints (box + rider + tines + fork load); invariant
    `collision.vehicle-vehicle`; lanes in `services.vehicleLanes`; right of way (smaller yields, then earlier ride, then
    id); follower stops 1 m short of a vehicle on its path (`traffic.vehicle` naming it), yields 1 m clear of a
    right-of-way lane or pulls over and resumes; plan round stationary ridden vehicles; plan-time
    `vehicle.path-conflict` naming both. Engages only with ≥ 2 ridden vehicles.
  - **Hash identity** (clean scratch worktree, before → after): perf-walk stress / probe / campus / meal / v3 all
    PIN-OK (5c3a3355 / b746b094 / c56ea8da / 3c28879f / a2f782ad); year-build first bay 41317 ticks, 251a44c5…,
    0 violations — at 9cb9138 (task 1) and at 3d530af (task 2), and again for the final commit.
  - **Tests.** social 19 (7 new), forklift +6 traffic tests; engine 358 pass / 0 fail / 3 skip (361) on the final tree.
  - **Open.** No resumption of a pre-empted sit / converse; a converse loses all members; a forklift stopped 1 m short
    of a parked-but-ridden EUC cannot swerve (2.5 m turn radius, no reversing) — it waits until the rider leaves;
    forklift reach / side-shift / raise not checked against vehicles; 3-vehicle yield cycles undetected; `edit_world`
    cannot move vehicles, so forced overlaps are world edits in tests.
- **W25 landed** `17a1c9b`, `e95d607`, `1a361a3` (≈390k tokens, 40 min): automatic pre-emption of social holds by directed tasks (smallest unit released; stand-up first; directive waits in phase `pre-empting`; `social.pre-empted` reason in events; `preempt: false` opt-out; make-way nudges exempt); vehicle–vehicle collision (`vehicles/traffic.ts`: footprints incl. rider/tines/load, `collision.vehicle-vehicle` invariant, right-of-way smaller→earlier→lower id, stop 1 m short with `traffic.vehicle`, pull-over, `vehicle.path-conflict` refusal). 361 / 358 / 3 skip; all pins bit-identical (perf-walk ×5 + first bay). Lead review: accepted. Weak: no resumption after pre-emption; forklift waits indefinitely behind a parked rider; `edit_world` can't move vehicles.
- W26 spawned: FINAL overnight consolidation — worktree gate, year-build re-record without `legacyKinds`, evidence (map camera-direct/phase-2/pre-emption/vehicles/take-4), HANDOFF + NEXT_SESSION_PROMPT for Gene's morning.
- **W26 (final overnight consolidation)** — worktree of `c27093d` on branch `w26-final`; commits `9f3cf9c` (takes), `7b47955`
  (evidence map), `a00fc08` (allowlist comment), `7ed5ea0` + `1395dd4` (pose baselines), `554a81a` (evidence) + this docs commit:
  - **Year-build takes re-recorded with the kind-aware sampler** (lead decision after W23): `record-campus-take.mjs` drops
    `legacyKinds`. Takes and final states unchanged (bay 1 `b7b882fd…` = `251a44c5…` @41317; whole skeleton `69c41651…` =
    `d382e461…` @117277). Cameras: bay 1 `cam-305a0efe…` → `cam-7492f43a…` (min readability 0.403 → 0.416, mean 0.806, 19 → 19
    cuts, 1 335 154 → 1 335 100 B, gzip 246 884 B); whole skeleton `cam-9609b6f7…` → `cam-b83a6828…` (min 0.310, mean 0.789,
    cuts 50 → 52, 3 851 872 → 3 852 499 B, gzip 697 763 B) — exactly W23's prediction. `--all --full --check`: OK for flagship,
    bay 1 and whole skeleton; v3 still fails `beam.no-room` at `onto_s2_4` (tick 11 009). studio-build (5), studio-take (1),
    camera-verify (2) pass with no baseline change; looked at studio-build-east-house-mid (48:52, frames + beams rising, camera
    picker shows `cam-b83a6828…`, ✓ 66 / 66) and -bay1-yard (piles, cutting station, crew, the other three houses).
  - **Gate GREEN** at `1395dd4` (worktree), report `.cloudflare/gate/2026-09-28T12-53-41-373Z` (W26 worktree):

    | stage | result | time |
    | --- | --- | --- |
    | unit | 56 / 56 | 0.4 s |
    | engine | 358 pass / 0 fail / 3 skip (361) | 43.5 s |
    | tsc | clean | 1.5 s |
    | e2e | 61 passed / 1 skipped | 643.5 s |
    | determinism probe | `b746b0947e65…` @10901 (= pin) | 2.7 s |

    Reds on the way, both fixed and committed: (1) **unit 55/56 since `0ab2e6f` (W19)** — `prepare-allowlist.test.mjs` read the
    JSDoc "`/engine/campus-<year>.json`" in `app/studio/direct-camera.ts:34` as an unstaged URL; comment reworded (no behaviour
    change). Nobody had run `npm test` since W19. (2) **Three v3 hand-up captures** off their W14 baselines: `poses-pickup-crouch`
    3.59 %, `poses-handup-joist` 2.57 % (masked by the first until it was fixed), `poses-climb-frame` 2.06 % — the same moments at
    +117 ticks (W21's walker: carry_j1 now waits 3.9 s for p4), poses unchanged; looked at baseline / new / diff for each; refreshed.
  - **Evidence** at `1395dd4`: rows 17/17; capabilities 27 PROVEN / 1 PARTIAL (year build B 3/4) / 0 UNPROVEN of 28; milestones 8/8.
    New rows: camera-direct (15), camera-correct incl. `occluded` + sampler (11), take-schema-4 (4), no-jumps (2),
    social-preemption (7), vehicle-traffic (6); year-build-b now cites W13's committed `year-build-b.test.ts` (the A+B whole-house
    test is `YEAR_BUILD_FULL`-gated and has no pin → PARTIAL); stale "no pre-emption / no vehicle–vehicle" notes corrected.
  - **Docs:** HANDOFF "End of night" replaces the Overnight addendum (landed by §1–§12, gate, takes, pins, vetoable decisions,
    11 questions for Gene, 15 prioritised open items, cost); NEXT_SESSION_PROMPT ground truth + open items refreshed;
    CAMERA_DIRECT §6 and PLANNING_BUDGET "not re-recorded" notes updated.
  - **W13:** no commits on `main` during W26 (its unstaged `YEAR_BUILD.md` is still in the main tree).
  - Cost: ≈ 0.35 M tokens, ≈ 1 h 10 min.
- **W26 landed** `9f3cf9c`…`09ddb71` (≈350k tokens, 70 min): year-build takes re-recorded without `legacyKinds` (bay-1 `b7b882fd…`, house `69c41651…`; camera ids as W23 predicted); gate GREEN at `1395dd4` (unit 56/56 — `npm test` had been 55/56 since W19 over a doc-comment false positive in the allowlist test; engine 358/0/3 of 361; tsc; e2e 61 pass / 1 skip in 644 s; probe b746b094 @10901 = pin), report `.cloudflare/gate/2026-09-28T12-53-41-373Z`; three pose baselines refreshed (same moments 117 ticks later under W21; inspected); evidence 17/17 §28, 27 PROVEN / 1 PARTIAL (year build B, 3/4 — cites W13's committed tests) / 0 UNPROVEN, 8/8 milestones; HANDOFF "End of night" section (by feedback item, gate/take/pin tables, 6 vetoable decisions, 11 questions for Gene, 15 open items, cost tally), NEXT_SESSION_PROMPT refreshed. Lead review: accepted.
- Overnight tally (lead): 25 workers finished (W1–W12, W14–W26), ≈ 9.0 M subagent tokens, ≈ 1 530 worker-minutes over 8 h; W13 (phase B) still running at ≈ 1 M tokens. Usage stayed ≤ 35 % of any 5-h window.

## 2026-09-28 ~09:20 EDT — W13: year build phase B (2022 east-house: decks, stair, walls, solar)
- **Commits:** 77e9d28 (catalog-phase-b + provisional rules), 58ebcee (material rules parts-b, pass_up, set_part verbs,
  install_wall), 76db6c3 / d44c601 / 124a185 / f58e527 / 45318ed / c11c12c / 294926e / 403b9cd / bb41ab3 / c3405da
  (generator sections D0, D1, D2, S, W, P; section barriers; tranche test + pins), + docs. Details: YEAR_BUILD.md "Phase B".
- **Plan:** 1552 steps (552 A + 1000 B), 106 × 4x8, 136 cuts, 89 offcuts stacked. Sequenced: 12 frames, 54 beams,
  27 deck strips (81 pieces), 4 walls (25 panels), 16 / 21 stair parts, 6 / 20 solar parts. Unplaced 19 with reasons.
- **Runs:** every section clean (0 violations) run from the previous section's snapshot under W21's walker (A 117 277,
  D0 94 646, D1 96 662, D2 102 287, S 84 136, W 68 331, P+END 15 635 ticks ≈ 8 h simulated). Default-suite tranche
  (bay 1 + first ground-floor strip): 53 604 ticks, 0 violations, 14 s, pinned 94db263e. The full end-to-end run
  (YEAR_BUILD_FULL=1, ~13 min wall) completed every step but with 37 ticks of one overlap (m2 carrying a wall panel
  past m6, parked outside +x during the walls section); a fix (m6 waits on the deck during walls) is uncommitted
  pending a green full run.
- **The lead's `beam_walk` 0.45 m off a walkway:** sections overlapped in the end-to-end run (a solar-crew member free
  early climbed toward a roof deck not yet laid, so the step-off target was not a deck). Fixed by section barriers
  (c3405da). v3's `onto_s2_4` `beam.no-room` at staging-east is a different rule (deckAt clearance on s2 < 0.28 m at
  the step-off spot) — not touched.
- **Provisional rules added:** plywood straight on reconstruction-frame beams at ≤ 4 ft (rules.ts beamDeckRule);
  notched parts may share 2 in of their edges with a reconstruction frame (access.ts); cut.ts rips plywood ≥ 0.3 m
  wide and adds 30 s per notch; stringer / tread / riser / post / handrail / wall fastening rules (setpart.ts,
  wall.ts); receivers may screw a sheet down alone (pass_up); the Kit stair link; standing plywood is not a deck.
- **Files outside my list I needed:** frame.ts (frameAccessOk skips `stairwork:`), contributor.ts (standing sheets are
  not decks) — both additive. W12's handup.ts / solar.ts untouched: install_panel needs side stations (7 of 10 modules).

### Questions for Gene (W13, year build phase B)
1. Decks: do Mars decks sit ON the beams (the engine: top 5.7 cm above the Kit's), in a step-beam ledge, or on 2x4
   joists? The Kit draws its sheets centred on the beam centreline, through the frame planes.
2. How were the 15 ft deck strips made from 4x8s — 6 + 6 + 3 jointed on beams (engine), or 8 + 7 with blocking?
3. Wall panels: outside the beam line (engine, 3.5 cm off the Kit) or inside? How were they fastened at the aisles?
4. The rack-house stair: stringers (how many, what lumber), tread boards, where its foot stands (the Kit draws its
   first step 0.55 m above the ground datum and its top posts inside the end frame).
5. Solar: rails or a frame under the modules? The Kit's modules sit over the frame columns that stand above the roof
   deck, in a contiguous row — how were they mounted (side access)?
6. Were the upper decks passed up through a relay on the first-floor deck, or by forklift / ladder?
- **W13 landed** `77e9d28` … `97957ca` (13 commits; ≈0.95 M tokens, 6.3 h): §7 phase B for 2022 east-house — `catalog-phase-b.ts`, `campus/{parts-b,sequence-b}.ts`, `construction/{passup,setpart,wall,moves-b}.ts`; plan 1552 steps (552 A + 1000 B: 145 take, 370 carry, 136 cut, 90 pass_up, 25 install_wall, 6 stringers, 24 stair parts, 6 rails, 3 panels …); every section run from the previous snapshot with 0 violations (A 117k, D0 95k, D1 97k, D2 102k, S 84k, W 68k, P 16k ticks ≈ 8 h simulated); matched at 1 cm/1°: 12 frames, 54 beams, 27 deck strips (81 pieces), 4 walls (25 panels), 16/21 stair parts, 6/20 solar parts; 19 unplaced with reasons (2 rail posts inside the end frame, 3 risers, 14 solar parts needing side stations in `solar.ts`); Kit offsets reported (decks +5.7 cm, walls 3.5–4.8 cm, solar +3.2 cm); stair built after both upper decks (crews climb the end frames). Default-suite tranche (first bay + first deck strip) pinned `94db263e…` @53604. **End-to-end A+B not green:** 37 ticks `collision.human-human` (m2 carrying a wall panel passes 0.48 m from parked m6, tick ≈ 545 7xx) — no pin, no take; one fix attempt reverted. Section barriers fixed the `beam_walk` 0.45 m case; v3's `onto_s2_4` is a different rule (deck clearance 0.25 < 0.28 m on s2), untouched. Report-only for all years (2022 four houses 1322–1478 steps each; 2021/2023/2024/2025/2020 skeletons sequenced, phase-B features unplaced — rules fit the 2022 template only). 6 Questions for Gene. Lead review: accepted; open item #1 for the next session = the A+B overlap (parked-crew station vs carry path) then pin + record the A+B take; #2 v3 `beam.no-room`; #3 solar side stations.
- **End of night (lead, 09:35 EDT).** Final head `97957ca`: tree clean; tsc clean; engine 361 / 358 pass / 0 fail / 3 skip (lead-verified). Gate GREEN at `1395dd4` (W26) — W13's later commits are engine + docs only (verified by the engine suite above; e2e not re-run since; run `npm run gate` first thing). 26 workers, ≈ 10 M subagent tokens, ≈ 1 900 worker-minutes over 9.3 h; usage never exceeded 35 % of a 5-h window (usage.py at close: 5h 13 %, week 27 %). No deploys. Nothing pushed. HANDOFF "End of night" + NEXT_SESSION_PROMPT are current except for this W13 entry.

## 2026-09-29 morning — Gene is up
- Answered: reach-down → keep 0.5 m kneel default, ADD a prone receiver posture with a continuous-hold rise (§13); top beams → climb-the-upright with two receivers confirmed as the real method (§14). Removed from Questions for Gene.
- W27 spawned (engine construction): the A+B end-to-end overlap (parked crew vs wall-carry path) → green run, pin, take; v3 `onto_s2_4` `beam.no-room`. W28 spawned (engine hand-up): prone receiver + rise sequence.
- **W28 landed** `4a209a4`, `bea0d0a` (≈300k tokens, ~75 min; merged from `w28-prone`): `BODY_MODEL.prone` (station 0.35 m behind the edge, torso 0.30 m over it tipped ≤ 60°, shoulders −0.32…+0.08 m → reach 0.94 m below the deck, hands ≤ 0.45 m beyond the edge; rise bands push-up / kneel-up; hips 0.10 → 0.46 → 0.89), receiver posture stand → kneel → prone (prone only where kneel refuses on depth AND a deck covers the edge beam), phases lie_down 0.8 / reach_down 0.6 / take 0.4 / push_up ≥ 0.8 / kneel_up ≥ 0.6 s, load straight up outside the edge, full sweep incl. joist ends, `handup.rise-blocked` naming the member, `handup.too-high` lists all three reaches; activities `lie-down`, `prone-wait`, `prone-reach`, `push-up`, `kneel-up` (`PRONE_ACTIVITY`), `grip.slot = handup-prone-<i>:<hand>`; 6 tests (2.9 m deck two prone 0 violations 481 ticks; 3.36 m too-high; no deck; wall in the rise corridor; forklift 0.75 m ok / 1.0 m too-high; determinism). 368 / 365 / 3 skip; all five pins + v3 + year-build unchanged. Lead review: accepted. **Bug found (queued W30, after W27 re-pins v3):** the kneeling rise does not sweep the members the load will rest on — the 2.4 m green test's sheet passes through its own joists' ends.
- W29 spawned (renderer): prone / push-up / kneel-up pose layers, lab preset for the 2.9 m prone hand-up, captures.

## 2026-09-29 — W28: prone receiver (owner feedback §13)
- **Commits** (branch `w28-prone`): 4a209a4 (body model `BODY_MODEL.prone` + hand_up prone posture, rise, sweep, tests,
  HANDUP / BODY_MODEL docs), then a follow-up (forklift prone test, rise-blocked wording, verb description, this entry).
- **Body model:** station S 0.35 m behind the deck lip (standable on the 0.1 m raster), torso 0.30 m over the lip tipped
  ≤ 60°, shoulders −0.32…+0.08 m → **reach 0.94 m below the deck** (§13 "≈ 1.0"), hands ≤ 0.45 m beyond the deck outline;
  rise bands push-up (−0.32…0.62) and kneel-up (0.07…0.91), hips 0.10 → 0.46 → 0.46 → 0.89. All derived from the rig
  numbers and checked in `body-model.test.ts`. BODY_MODEL.md "Prone receiver + rise".
- **hand_up:** stand → kneel → prone; prone engages only where the kneel rule's depth cap refuses (the old
  `handup.too-high`) and a deck covers the edge beam. Phases lie_down 0.8 s (while the givers work), reach_down 0.6,
  take 0.4, push_up ≥ 0.8, kneel_up ≥ 0.6, then stand_with_load / lay / set_down; activities `lie-down`, `prone-wait`,
  `prone-reach`, `push-up`, `kneel-up`; slot `handup-prone-<i>:<left|right>` (that hand never lets go). The corridor
  beside the edge is swept up to slide height with everything (joist ends included) → `handup.rise-blocked` names the
  member; `handup.too-high` now lists stand / kneel / prone reach. HANDUP.md "Prone receiver".
- **Tests:** `handup-prone.test.ts` (6): 2.9 m deck, two prone receivers — hand-off 0.83 m below the deck, 0 violations,
  481 ticks, worst hand step 0.163 m/tick, hold hand on the load every rise tick, sheet swept clear every tick; one
  receiver + bit-identical rerun; no deck → too-high; 3.36 m deck → too-high listing all three; wall panel →
  rise-blocked naming it; off the forks 0.75 m below the deck → prone, 1.0 m → too-high "raise the forks".
  `body-model.test.ts` +1. `handup.test.ts`: three too-high message regexes updated (text only).
- **Pins unchanged:** `deploy/perf-walk.mjs` stress / probe / campus / meal / v3 PIN-OK before and after (v3
  `a2f782ad…` @16401); build-bay-v3 and year-build tranche tests green in the suite. Year builds do not call hand_up.
- **Weak spots:** the kneeling hand-up's rise ignores the members the load will rest on, so its sheet passes through
  its own joists' cantilevers (the 2.4 m green test does) — left for the pins; prone stations are searched on the edge
  beam the load comes over only; envelopes are cylinders about S; lie-down / push-up / kneel-up are timed pose phases
  (no body physics); a mixed prone + kneeling crew is supported in code but never arises under the depth gate; the rig
  has not been posed prone (renderer track).
- **W27 landed** `82e00c0`, `81ce663`, `f97d5db` (≈300k tokens, 105 min): A+B overlap root cause = `setpart.ts` moved lifters' feet without checking people (the carry was fine) → lift crews hold the part and wait (`setpart.path-occupied`), idle people make way; **east-house A+B green and pinned `ddb634d6…` @600599 (8.3 h simulated), 0 violations, 66 + 145 parts at 1 cm/1° (max 0.25 mm), 19 unplaced (solar 14, stair 5)**; v3: `deckAt` clearance is read at lattice cell centres so a 0.35 m spot read 0.25 m at staging-east → `beam_walk` `stepOffSpot` (nearest spot with room ≤ 0.15 m), spare tread moved; 17/17 origins + staging-east green (was 10/17); v3 re-pinned a2f782ad → 39a0fb3f @16374; **v3 take recorded** `64c3331c…` at staging-east (2.09 MB / 238 KB gz) in the manifest. 371 / 368 / 3 skip. Lead review: accepted. Unlanded (its Bash checks failed 9×): recorder `year-build-2022-ab` scenario + YEAR_BUILD/PLANNING_BUDGET/PROGRESS docs in `scratchpad/w27-wt` (branch `w27-ab`), to land once `scratchpad/w27/fulltest2.log` shows ✔ → W31. **Lead decision:** the A+B take (12.0 MB) is split per section (A, D0, D1, D2, S, W, P) as chapters, each with its own camera plan → W31.
- W30 spawned (engine handup.ts): kneeling rise sweeps the members the load rests on (W28's finding), v3 re-pin + re-record. W31 spawned (recorder/manifest): land W27's files, per-section A+B takes with chapter metadata.

## 2026-09-29 — W29: the prone receiver posed (renderer half of §13)
- **Pose layer** `viewer/app/engine-view/prone.ts` + `humans.ts` (POSES.md "Prone receiver"): one rise coordinate
  (lying → on the knees → kneeling up → standing) on the engine's phase clocks, the body waiting for the load it holds;
  a per-tick solve of rise / torso pitch (flat … the engine's 60° tip; kneeling to 150°) / body turn about S (≤ 45°, only
  while the body lies on an installed sheet: ±20° here) keeping the shoulders in reach and the spine / head off the deck
  slab and edge beam; lying depth and chest height measured from the skinned rig (hips 0.15 m up, shoulders 0.10 m);
  tip joint 8 cm past the lip; knees on the deck, feet pointed; the girdle reaching ≤ 0.1 m (the engine's 2 × shrug);
  flat hands on the deck; feet / hands lifted by whatever of their skinned surface dips below the deck; a 0.4 s bone
  blend into the posture layer at `stand_with_load`.
- **Lab** presets `prone` ("Prone hand-up (2.9 m deck)") and `prone-forks` from `handup-prone.test.ts`'s fixture; hook
  `meshPoints(id)`. **Spec** `e2e/prone.spec.ts` 3/3 (per-tick hands, shoulders past the lip, chest height, skinned
  surface vs deck; captures, 3 baselines). poses / lab-poses / stairs / meal 13/13 unchanged (hand-up v3 92.5 %).
- **Numbers:** 0 rig-reachable misses; engine hand points reached by hand / off the forks: prone-reach 45/80 · 60/80,
  push-up 73/80 · 82/84, kneel-up 64/64 · 48/48, everything else all but stand_with_load 30/32 · 25/32. The misses are
  beyond the arm (1.06–1.37): this rig lying at the lip reaches 0.80 m (punk) / 0.73 m (woman) below the deck, not
  0.94, and the grips lie 0.31–0.47 m to the side of S.
- **For the engine** (not changed here): (1) prone reach from the rendered rigs — chest 0.10 m, Torso joint → shoulders
  0.27 / 0.19 m → reachDown ≈ 0.73–0.80 m, not 0.94; (2) the prone envelope is a cylinder about S, but a body lying
  perpendicular to the edge has its shoulders ±0.15 m across: place S with the body's axis through the grips, or
  publish the lying heading (`human.proneYaw`, footprint checked at it); (3) check the body beyond the lip (chest tipped
  60°, head, arms to the grips) against members there — p3 / p4's chests pass through joist tails j2 / j7; (4) a phase
  fraction (`human.phaseK`) would make the rise timing exact and take replay mid-phase.
- **W29 landed** `de94b9d`, `046a0cd` (≈470k tokens, 50 min): `app/engine-view/prone.ts` — one rise coordinate (lying 0 → knees 1 → kneel-up 2 → standing 3) driven by the phases, per-tick grid search over rise / torso pitch (≤ 60° lying, ≤ 150° kneeling) / body turn (≤ 45°, only while on an installed sheet); shoulders kept in reach, spine and head off the deck and edge beam; measured lying hips 0.15 / shoulders 0.10 m above the deck; flat hands on the deck; lab presets `prone`, `prone-forks`; `prone.spec` 3/3 (shoulders beyond the lip, chest within 1 mm of deck + depth, no vertex > 1.5 cm into the deck, no over-long arm). Hand points: prone-reach 45/80 by hand (p3 27/40, p4 18/40), 60/80 off the forks; 0 rig-reachable misses — the rig lying tipped 60° reaches 0.80 (punk) / 0.73 m (woman) below the deck vs the model's 0.94. Lead LOOKED at prone-reach + prone-push-up: accepted — reads as Gene described (on the stomach over the edge; then one hand on the deck, one on the sheet). Engine follow-ups → W32 (after W30 frees handup.ts): prone model = measured rig (chest 0.10, torso-over-edge per rig → reach ≈ 0.73 m; the 2.9 m test deck must drop to what the rig can do), a lying heading (`human.proneYaw` or S placed on the grip axis), a check beyond the lip (chest/head/arms vs joist tails), `human.phaseK` for mid-phase replay.

## 2026-09-29 — W27: the 2022 east-house A+B green + pinned; v3 origin-independent
- **Commits:** `82e00c0` (v3 origin-independent + re-pin), `81ce663` (v3 take), `f97d5db` (set-part bystander rule;
  A+B pinned), + the recorder's A+B scenario and these docs.
- **A+B overlap, root cause:** it was not the carry. `s1417-install-wall` (tip-up, then walk-in of wall panel p5 of
  wall 113aa87d) moved m2's feet to 0.48 m from m6, who had stood idle outside +x since the stair section. The carry
  that brought the panel had checked its set-down spots. The set-part engine (`install_wall` / `install_stringer` /
  `install_stair_part`) checked lift-crew feet only against the static grid, so people were not obstacles. W15's
  squeezed replan and `carry.path-occupied` belong to the carry verb and were never involved.
- **The fix is in the engine, not in parking:** while the lift crew moves the part, anyone whom a lifter's feet would
  come within 2r + 0.08 m of (and closer than now), in the next 1.2 m, stops the crew. The crew holds the part
  (`setpart.path-occupied`) and an idle person is asked to make way (`makeWay` with a clear-of-the-lift-path test).
  In the whole house it waits once, 17 ticks. Regression test: a sheet walked 3 m past an idle person (without the
  rule: 31 overlap ticks).
- **A+B end to end:** 1552 steps, **600 599 ticks ≈ 8.3 h simulated, 0 violations**, settled. Matched at 1 cm / 1°:
  phase A 66 parts, phase B 145 parts (81 deck pieces, 25 wall panels, 6 stringers, 16 tread boards, 6 posts,
  2 handrails, 6 rails, 3 panels; max 0.25 mm); unplaced 19 (solar 14, stair 5). Pinned `ddb634d6…` in
  `year-build-b.test.ts` (YEAR_BUILD_FULL=1, 815 s wall), re-verified on the head with W28's prone receiver.
- **A+B take: not recorded, over budget.** `record-campus-take.mjs --scenario year-build-2022-ab` (explicit only)
  reproduces the pin (take `53a180fd…`). The payload is **12 029 291 B, 5 737 835 B over 6 MB**: take 10.47 MB (tracks
  4.74, changes 3.66, events 1.75) + camera 1.03 MB at 0.1 Hz; gzip 2.02 MB. Its phase-A shot list reads poorly over
  8 h (min 0.15, 44.7 % readable). **Lead decides:** thin, split per section, or a larger budget. No manifest entry.
- **v3 `beam.no-room`, diagnosis:** the rule is framemove.ts `deckAt`: a beam_walk step-off target on a deck needs
  grid clearance ≥ 0.28 m (the body radius). That value is a cell-centre clearance on the global 0.1 m lattice, so
  the same site-local spot reads differently depending on where the site sits on the lattice. The s2 target (−0.2,
  2.8) is truly 0.35 m from s2's north edge; at staging-east (28, −9) it reads 0.25 m. s2's laid pose and the beam
  station do not vary; the quantisation of the target does. The step-off spot on the beam was already searched. At
  HEAD a second origin bug showed up: `carry_spare` failed at 7 of my 17 open-ground origins. The spare tread's end
  load disc (r 0.163 m) lay 0.171 m from the s1/s2 corner.
- **v3 fix:** `beam_walk` lands on the nearest spot with room within 0.15 m (`stepOffSpot`: rings of 0.05 m in 16 fixed
  directions; still refused when truly at an edge). `deckAt` is unchanged (handup.ts uses it). The spare tread now lies
  at (0, 1.0). v3 completes with 0 violations at **17 of 17** origins (it was 10 of 17) and at staging-east. At the
  origin the discrete outcome is identical. Re-pinned **`a2f782ad` @16401 → `39a0fb3f` @16374**
  (PLANNING_BUDGET.md). New tests: v3 at (28, −9, −0.16) and (0.07, 0.03); a step-off unit test.
- **v3 take:** `64c3331c…` at staging-east, 17 034 ticks, final `0fe37f01…`, camera `cam-c30b084c` (8 shots, min
  readability 0.60), **2 086 540 B** (gzip 238 KB), manifest `takes[1]`, label "Flagship v3: hand-up + forklift deck,
  at staging-east"; `--check` OK.
- **Weak spots:** idle crew are still parked without regard to the next section's work; they get moved by make-way
  (one wait here). The set-part bystander test looks 1.2 m ahead along the lift crew's feet, not the part's sweep
  through a person's body band (the carried part at hand height). The whole-house A+B `kitOffsets` reports stair
  2.017 m max centre offset (W13's metric, not examined). The studio e2e (`studio-build.spec.ts`) replays every
  year-build manifest entry, so an A+B take, once in, will be a long e2e. e2e and gate not run.

## 2026-09-29 ~09:45 EDT — Codex split (Gene)
- Ownership map + merge rule recorded in OWNER_DECISIONS.md. W33 spawned (docs only, ≤ 1 h): CODEX.md, `briefs/` (five Codex briefs), QUESTIONS_FOR_GENE.md with images, HANDOFF/NEXT_SESSION_PROMPT with the split + ETAs. A.1: W13's YEAR_BUILD.md already landed in `97957ca` (tree clean) — W33 verifies only.
- In flight: W30 (kneel-rise sweep, v3), W31 (W27 docs + A+B chapter takes). Next toward checkpoint 1: W32 prone model = rig (after W30), then the other three 2022 houses + 2x4 framing (after W31).
## W30 — kneeling rise swept against the resting members (2026-09-29)
- **Finding (W28):** a kneeling receiver's `stand_with_load` rise was swept with the load's supports ignored. In the
  2.4 m green test the sheet was handed off just outside b3's face. It then rose through j1's cantilevered end (6 ft
  joists overhang b3 by 0.28 m) for 4 ticks.
- **Fix (`construction/handup.ts`):** the hand-off corridor search (outward from the edge beam, 5 cm steps, ≤ 1 m)
  now also sweeps the receivers' rise, hand-off → slide height, against everything whenever the givers do not
  raise the load to slide height themselves. Previously only prone receivers had this. So the load goes straight up
  outside the joist ends and comes in over them. If the kneelers cannot reach it there, the hand-up is refused
  `handup.rise-blocked`, naming the member ("…in the hands of receivers kneeling at it: 6 ft 2x4 (j1) is in the way
  of its rise…"). A kneeling rise off the forks is checked where the forks hold it. `finishPlan` sweeps the take, the
  rise and the feed-in against everything; only `set_down` may touch the supports.
- **Tests (`handup.test.ts`, +2, 9 total):** `watch()` sweeps the received load on every reach_down / take /
  stand_with_load / lay tick. The 2.4 m green test now has 0 intersections (≥ 60 swept ticks), is handed off
  outside the joist ends, and takes 528 ticks (was 518). Joists overhanging by 0.78 m → rise-blocked naming the
  joist; 0.48 m → green. A sheet on the forks under the joist ends → rise-blocked "…where the forks hold it". All
  three fail on the pre-W30 handup.ts (checked).
- **Pins:** none move (PLANNING_BUDGET "No re-pin 2026-09-29"). v3 stays `39a0fb3f…` @16374 with 0 intersections.
  Its take `--check` is OK against the manifest (`64c3331c…`), so nothing was re-recorded. The year builds (pass_up)
  pass unchanged: bay-1 in the suite, and A+B `ddb634d6…` @600599 in a full `YEAR_BUILD_FULL=1` run. The
  perf-walk v3 pin was stale (`a2f782ad…`) and is fixed. Suite: 373 tests, 370 pass, 3 skipped, 0 fail; tsc clean.
- **Weak spots:** the corridor moves only outward along the edge normal, never sideways, never tilted. The load
  always comes straight up. The plan-time sweep samples every 5 cm of motion (the per-tick test sweep covers the
  ticks). No pinned scenario exercises a kneeling rise past joist ends, so the change is covered only by the
  handup.test.ts fixtures.
- **W30 landed** `166b0d4`, `32a85ec`, `c5afddd` (≈180k tokens, 45 min; merged from `w30-kneel-sweep`): the hand-off corridor search now sweeps the kneeling receivers' rise against everything (load goes straight up outside the joist ends, then in); `handup.rise-blocked` for kneelers naming the member (+ forklift variant "present it clear of it"); `finishPlan` sweeps take/rise/feed-in; tests sweep every held tick (2.4 m green test 0 intersections, was 4 ticks through j1; +2 regressions). v3 pin unchanged (39a0fb3f @16374 — v3's loads are raised to slide height by the givers); `perf-walk.mjs` v3 pin was stale, fixed; full year-build set 8/8 green (A+B ddb634d6 @600599). 373 / 370 / 3 skip. Lead review: accepted.
- W32 spawned (engine handup/body): prone model = measured rig (W29's numbers), lying heading, beyond-lip check, `phaseK`.

## 2026-09-29 — W33: Codex split docs (CODEX.md, four briefs, QUESTIONS_FOR_GENE.md)
- **A.1 verified:** `YEAR_BUILD.md` last touched by `279d405` (W27), `97957ca` (W13) is an ancestor, and the tree was clean for it.
  Not edited.
- **`CODEX.md`** (new): the external contributor contract.
  - Worktree recipe `git worktree add <wt> -b codex/<topic> main` with the four exact symlinks (`public/browser/` must be
    `mkdir`-ed first; `.pw-browsers` shows as untracked, never add it; never `npm install` through the shared `node_modules`).
  - **Own ports / dirs:** `E2E_VITE_PORT=5491` (Claude's default 5391), a manual Vite at 5493, `E2E_RUN=codex-<topic>-<n>`
    → `e2e/artifacts/<run>/`. `test-results/` and `.cloudflare/gate/` are per worktree. `E2E_SIMULATION` stays off
    (inspector 9337 is hard-coded).
  - Hard rules, including the source scan `core.test.ts:292-313` (catches `hypot` / `pow`, not `**`).
  - Gates: test:engine + tsc + Playwright per spec, **not** `npm run gate`. Rebase onto main + test:engine before every report.
  - Pin rule: STOP, REVERT, REPORT. Commits: `Co-Authored-By: Codex <noreply@openai.com>`.
  - The **final ownership map** (Gene's correction: take and `app/history/scenes.ts` are Claude-owned).
  - `cameraDirectionSchema` (`direct.ts:62`) frozen, with a change log.
  - REPORTs go to `briefs/<brief>.REPORT.md`, never PROGRESS / HANDOFF. Merge / reject protocol; ETAs.
- **`briefs/`**, four briefs (the year-scene-doors brief was dropped per Gene's correction):
  - `codex-2026-frame-grouping.md`: offline tool `deploy/group-2026-frames.mjs` → `data/campus-2026-frames.json` + an
    unclassified report + an SVG. 660 rack_member components / 907 rows, 89 beam_candidates; the lab has no scene hook,
    so the in-scene overlay is Claude's integration half.
  - `codex-camera-nl-parse.md`: `parseSentence` / `parseSentences`. **Not `parseDirection`**, which `direct.ts:404`
    already exports.
  - `codex-fire-v2-and-render-polish.md`: new `solar-mesh.ts` / `equipment-mesh.ts` / `palette.ts` plus one-line
    delegations in `components.ts`. Frame blue comes from the Claude-owned `catalog.ts:109`, so the recolour is
    renderer-side. The 2024 mural is `public/history/2024/flower.webp`. Codex refreshes only `fire-*` /
    `render-polish-*` baselines.
  - `codex-tooling.md`: lint fails with "Failed to find tsgolint executable" (reproduced at `be0f66a`;
    `node_modules/@oxlint-tsgolint/` is empty). The lint stage goes into the gate only when green. Findings are triaged,
    not fixed, in Claude-owned source. The new `source-scan.test.ts` covers `**` with an allowlist of today's 14 sites
    (13 files). Nothing in `engine/take/**`.
- **`QUESTIONS_FOR_GENE.md`**: 18 collected questions (HANDOFF's 11, W13's 6, and PROGRESSIVE's plywood span rule),
  shown as **14 open blocks** (two duplicate pairs merged: stair, decks) and **2 answered** (top beams §14, reach-down
  §13), each with the engine's view, what the answer changes, and a `Gene:` line.
  - **New images** (`questions/`, lab captures at `be0f66a` from the W33 worktree, Vite on 5433):
    `yb2022-pile-yard`, `yb2022-top-beam-relay` (s0047 at tick 11912), `yb2022-frame-feet`, `kit2022-east-house-{a,b}`
    (the year-2022 walkabout; the lab's year-build preset is phase A only, so the Kit's decks / stair / walls / solar come
    from the walkabout). `lab-year-2023-top-prisms` was copied from the gitignored review capture
    `e2e/artifacts/2026-09-28T04-18-51/`.
  - Existing baselines embedded: `lab-year-2022/2024-top-prisms`, `year-build-skeleton`, `solar-paint-mounted-equipment`.
- **HANDOFF / NEXT_SESSION_PROMPT / ENGINE_GUIDE:**
  - HANDOFF: the questions were removed (End-of-night list, checkpoint addendum, tranche item 6, top blockquote) and
    replaced by pointers. New closing section "Codex split and checkpoint 1": map, merge rule, ETA table (≈ 18–30 Codex
    h in total, estimates), and the checkpoint-1 wording.
  - NEXT_SESSION_PROMPT: the questions rule now appends to QUESTIONS_FOR_GENE; item 0 is a pointer; Codex paragraph +
    map + ETAs; no Claude briefs into Codex paths.
  - ENGINE_GUIDE: one pointer line.
- **For the lead:** OWNER_DECISIONS' 09:45 entry still names `app/history/scenes.ts` and take thinning as Codex-owned; the
  corrected map says Claude. Amend it (W33 does not own it). No engine / app / spec file touched; the capture script was
  not committed.
- Cost: ≈ 0.37 M tokens (incl. a 95k Explore subagent), ≈ 45 min wall.
- **W33 landed** `70cc6ea`, `0650aa8`, `fe05070`, `f8e6675` (≈370k tokens, 45 min, docs only): CODEX.md, four Codex briefs, QUESTIONS_FOR_GENE.md (14 open + 2 answered, 10 images incl. 5 new lab captures), HANDOFF/NEXT_SESSION_PROMPT with the split + ETAs, questions removed from handoffs. Lead verified on main; **Gene alerted 11:55 EDT: "CODEX.md and briefs are on main".** Notes: parse brief uses `parseSentence/parseSentences` (name collision with `direct.ts` `parseDirection`); `**` scan needs an allowlist of 14 Claude-owned lines; green frames will drift many baselines (accept firelit/colour drift at merge); `npm run lint` fails on missing tsgolint (Codex tooling brief).
- 12:00 EDT Gene: deploy bleeding edge now (RELEASE_CHECKLIST protocol); Codex starts. W34 spawned: release 6 — full gate at HEAD in a worktree, deploy, smoke, deployment.json + rollback, RELEASE_CHECKLIST record. ETA to checkpoint 1 given to Gene: ≈ 18:00 EDT.
## W32 — prone model = the measured rig; lying heading; body beyond the lip; phaseK (2026-09-29)
- **Model** (`body/model.ts` `BODY_MODEL.prone`, BODY_MODEL.md "Prone receiver + rise"): the woman template lying at the
  edge (W29's measurement, the smaller reach): chest 0.10 (rig 0.097–0.102), tip joint 0.08 past the lip (renderer) and
  0.15 up (rig lying hips), tip joint → shoulders 0.19 (woman; punk 0.27). Tipped 60° the shoulders are −0.034 m
  (measured −0.03; the punk construction −0.106 vs −0.10) → **reachDown 0.73 m** (0.034 + girdle 0.10 + 0.97 × 0.62;
  was 0.94). Exact heading-aware geometry `proneFrame` / `pronePoints` / `proneReachGap` (arm + girdle from each shoulder
  joint); `posture.prone` is now the cylinder bounding it over every turn ≤ 45° (−0.13 … 0.20, lean 1.06; checked on a
  grid). Punk / casual reach ≈ 7 cm more: slack.
- **hand_up** (`construction/handup.ts`): prone stations lie with the body's axis through the grip, else turned back
  toward the edge normal in 5° steps; the lying body (toes 0.75 m behind S, half-width 0.20) checked at that heading
  against the deck, parts and people (and two bodies against each other); the take planned with the exact reach; the
  chest tipped as far as that needs, head and arms swept against everything past the lip → another heading / station, or
  `handup.rise-blocked` naming the member when a crew would work but for that sweep. `human.proneYaw` (lying heading;
  `pose.yaw` keeps facing out, so the renderer's `lipAlong(proneYaw − yaw)` is right) and `human.phaseK` (0–1 in the
  current phase), prone receivers only, cleared at the release. `world/types.ts`: the two optional HumanState fields
  (additive).
- **Tests** (`handup-prone.test.ts` 8, was 6; `body-model.test.ts` prone test rewritten; `handup.test.ts` three
  too-high regexes 0.94 → 0.73): with reach 0.73 the old 2.9 m hand-off (0.83 m) is `too-high`, so the green case is the
  **2.75 m deck** (the tallest 6 in beam seat within reach from the ground: hand-off 0.67 m; 477 ticks, turns ±20°,
  worst hand step 0.152) and **2.90 m** the too-high case; the fixture's deck joists are 4 ft (ending at the lip; the
  middle keeps 6 ft) — W29's all-6-ft geometry (tails 0.30 m past the lip under the decks) is the new `rise-blocked`
  regression (a chest / head / arm through a joist wherever they could lie); forks: 0.70 m below green, 0.72
  no-receiver-station, 0.74 too-high. Per tick: exact reach + body clear at every take tick, proneYaw / phaseK schema.
  Suite 375 / 372 / 3 skip, 0 fail; tsc clean.
- **Pins unchanged:** `deploy/perf-walk.mjs` stress / probe / campus / meal / v3 all PIN-OK (v3 `39a0fb3f…` @16374);
  full `YEAR_BUILD_FULL=1` set 8/8: phase A first bay `251a44c5…` @41317, whole skeleton `d382e461…` @117277, first bay +
  deck strip `94db263e…` @53604, A+B `ddb634d6…` @600599 — all unchanged.
- **For others:** the recorder needs `proneYaw` / `phaseK` in FIELDS (W31's area) for takes; W29's lab preset
  `app/lab/prone.ts` mirrors the old 2.9 m / all-6-ft fixture — it now refuses (too-high) and must move to 2.75 m with 4 ft
  deck joists; POSES.md still quotes the engine's 0.94.
- **Weak spots:** the rise (push-up / kneel-up) still uses cylinders about S and is not body-swept; arms are straight
  segments; the lying footprint vs people is a plan-time snapshot; the grip is always the load's point nearest S (no
  choice of grip along the edge), which in this fixture is the sheet's corner beside a joist end.
- **W32 landed** `0cd2f19`, `f350896`, `ce74ba0` (≈370k tokens, 50 min; merged from `w32-prone-rig`): `BODY_MODEL.prone` = measured rig (chest 0.10, overEdge 0.19 woman, tipUp 0.15 fitted, reach 0.73 m; exact `proneFrame/pronePoints/proneReachGap`), `human.proneYaw` (body axis through the grip, 5° back-off, footprint checked at that heading vs deck/parts/people/other lying bodies), beyond-the-lip sweep (chest every 15°, head, straight arms) → `rise-blocked` naming the member; `human.phaseK` on prone receivers only (additive `world/types.ts`). Tests: green at 2.750 m (tallest reachable seat; hand-off 0.65–0.67 m below), `too-high` at 2.902 m; forklift 0.70 ok / 0.72 no-station / 0.74 too-high. 375 / 372 / 3 skip; all pins + full year-build set unchanged. Lead review: accepted. Knock-on: W29's `app/lab/prone.ts` + `e2e/prone.spec.ts` (2.9 m, all-6-ft joists) now refused → W35; recorder FIELDS one-liner (`proneYaw` mrad, `phaseK` %) → W31.
- W35 spawned (renderer): prone.ts reads `proneYaw`/`phaseK`, preset → 2.75 m + 4 ft deck joists, forks 0.70 m, POSES.md 0.94 → 0.73, spec green.
- **W34 release 6 deployed** (12:11 → 12:36 EDT): gate GREEN at `27e04f6` in a detached worktree (unit 56/56, engine 370/0/3 skip, tsc clean, e2e 64 passed / 1 skipped in 729 s on port 5591, probe `b746b094…f0c3` = pin; `gitDirty: false`); production **`07dce638-2950-444f-823f-0e19b8f62320`** replaces `cebd5827…` (rollback target, confirmed 100 % before the deploy). Not in the deploy: `0cd2f19` (W32 prone engine) + `f350896`, `ce74ba0`, `848b895`, `858946e`. Smoke: all routes / `/engine/campus-2022.json` / 5 `/engine/takes/*` / R2 GLB 200, `smoke.mjs` OK; director demo PASS (9 steps, 7.96 s); prod `/lab` build-bay 43/43, 0 violations, tick 10901, **prod hash = probe**; prod `/studio`: 2022 "Watch it being built" picker (both takes), flagship replay at held 37/37, hash = recorded = manifest, banner, 0 errors (screenshots reviewed, `e2e/artifacts/prod-smoke-6/`). **Red: committed `deploy/simulation-integration.mjs` fails against prod** (its engine tool list predates `engine_direct_camera`); a scratch copy with that one name added passes all 3 lines — needs a one-line fix by the `deploy/` owner. Evidence not regenerated (out of scope). Record: RELEASE_CHECKLIST "Production deploy 6". Cost ≈ 0.16 M tokens, ≈ 25 min wall.
- **W34 landed** `a98c0b3` (≈160k tokens, 25 min): **Release 6 live** — production `07dce638-2950-444f-823f-0e19b8f62320` from gated head `27e04f6` (gate GREEN: 56/56, engine 370/0/3, tsc, e2e 64 pass / 1 skip in 729 s, probe b746b094 = pin; report `w34-wt/viewer/.cloudflare/gate/2026-09-28T16-12-39-722Z`); rollback `cebd5827…` (command in RELEASE_CHECKLIST "Production deploy 6"). Smoke: all routes + engine files + 4 takes + R2 200; director demo PASS (9 steps, 8.0 s); prod `/lab` flagship 43/43, 0 violations, hash = probe; `/studio/2022` shows "Watch it being built" with both takes; flagship replay hash = recorded. Not in the deploy: W32 (`0cd2f19`…`848b895`). Lead fix: `deploy/simulation-integration.mjs` expected 13 engine tools → now 14 incl. `engine_direct_camera`; re-run against production: 3/3 PASS.

## W35 — the prone layer on the engine's proneYaw / phaseK; lab presets = W32's fixture (2026-09-28)
- **Renderer** (`app/engine-view/prone.ts`, `humans.ts` `proneGoal`): body turn = `engineTurn` = angleDelta(pose.yaw,
  proneYaw), taken as is (no deck test, no rate limit — the engine checked that heading and turns it with the lie-down's
  smoothstep); the rise clock = 3 (1 − smooth(phaseK)) lying down, smooth(phaseK) pushing up, 1 + smooth(phaseK) kneeling
  up. Fallback without the fields (a take — the recorder does not carry them yet): W29's turn search and age clocks.
  `SampledHuman` has optional `proneYaw` / `phaseK` (setFrame reads them; `take-replay.ts` must fill them once W31's
  recorder records them). Two findings kept honest rather than exact: (1) r = smooth(phaseK) forced exactly left p4's
  held hand out of reach mid push-up (23/32) with that arm 0.14 m through the deck edge, so the body still **waits for the
  load it holds** (never ahead of the engine; the spec asserts that and logs the lag); (2) the engine's deck-hand points
  (0.20 m ahead of S along the heading) are set for the woman's torso — the punk (p3, Torso joint → shoulders 0.27 vs
  0.19 m) turned 20° had its deck hands 1.18 arm lengths away all through prone-wait (574/1148), so lying flat the body
  may **slide back** along the deck (≤ 0.16 m, still on it; 4–5 cm used) and comes forward as the chest tips. Deck hand
  along the heading: the rendered yaw is proneYaw, so the flat hand's fingers follow it. Reach honesty, the girdle rule
  and the body-vs-deck checks unchanged. Diag `prone` gains `slide`, `engTurn`, `phaseK`.
- **Lab** (`app/lab/prone.ts`): `prone` = 2.750 m deck, 4 ft deck joists (j1 j2 j7 j8) ending at the lip, 6 ft in the
  open middle; `prone-forks` = 2.902 m deck, s1 presented 0.70 m below it, 6 cm outside the middle joists' ends — the
  descriptions state the numbers. Headless: 477 ticks (= the engine test) / 632, all checks green, turns ±20° / ±25°.
- **Spec** (`e2e/prone.spec.ts` 4/4, was 3): per tick turn vs the engine (worst |Δ| 0.0000 rad over 708 / 130 ticks), rise
  never ahead of smooth(phaseK) (behind while waiting: 51/64 by hand, 44/60 off the forks, worst 0.78 / 0.86 — p4), a
  determinism test (two runs, receivers' bones equal every tick, 477 ticks), a north-east take view. Hand points reached
  ≤ 0.1 m by hand (before → after): **prone-reach 45/80 → 80/80** (p3 27 → 40, p4 18 → 40), prone-wait 1148/1148 (574 before
  the slide), push-up 73/80 → 64/64, kneel-up 64/64, lie-down 60/60, stand_with_load 30/32 → 28/32 (p4, 1.08–1.10 arm
  lengths); off the forks prone-reach 60/80 → 80/80, lie-down 56/60 (p3's last two ticks), stand_with_load 25/32. 0
  rig-reachable misses, 0 over-long arms, 0 body vertices below the deck top in a prone phase, shoulders past the lip
  every lying tick. Logged: arm / hand vertices ≤ 1.9 cm inside j3 / j6's ends (the grips are the sheet corners beside
  them); no chest / head inside any member now (W29: through j2 / j7's tails).
- **Baselines refreshed after looking**: `prone-reach` (tick 340: both on their stomachs, chests tipped over the lip, arms
  straight down, the sheet overhead in the givers' hands), `prone-push-up` (now tick 363, mid push-up — `step(16)`
  overshot into kneel-up on the 0.8 s phase: hips coming up, one hand flat on the deck, the other on the rising sheet),
  `prone-standing` (first `lay` tick: both kneeling on the deck bent over the sheet at deck level). `prone-take` /
  `prone-take-ne` show both receivers' hands on the sheet's inner corners; the turn reads as the engine's ±20°.
- `POSES.md` "Prone receiver": proneYaw / phaseK consumption, slide, reach 0.94 → 0.73, W35 measured block; lab README row.
- **Weak spots:** the rise trails the engine while the body waits (p4 up to 0.78 in r), so a replay frame (no history:
  exact r) and the live run differ there; the slide is the renderer's (the engine's deck hand stays where it is); p4's
  stand_with_load hands 1.06–1.15 arm lengths away (posture layer); take replay needs `take-replay.ts` to copy the two
  fields once the recorder has them (not W35's file).
- **W35 landed** `9ddd6d8`, `f2a52c8` (≈220k tokens, 20 min; merged from `w35-prone-rig-render`): `prone.ts` reads `proneYaw` (turn exact to the engine, 0.0000 rad over 708 ticks) and `phaseK` (rise clock, but the body never gets ahead of the load it holds — logged lag), lying slide-back ≤ 0.16 m for the longer punk torso; presets mirror W32's fixture (2.750 m / 4 ft deck joists; forks 0.70 m below 2.902 m); `prone.spec` 4/4; prone-reach 80/80 by hand (was 45/80) and 80/80 off the forks, no rig-reachable misses, no body vertex in the deck. Lead LOOKED at prone-reach: accepted — both on their stomachs over the lip, both pairs of hands at the sheet. Open: `take-replay.ts` must copy `proneYaw`/`phaseK` once W31's recorder carries them.

## 2026-09-29 — W31: W27 landed; the 2022 east-house A+B as 7 chapter takes
- **W27 landed:** `fulltest2` (YEAR_BUILD_FULL=1, the A+B test on `f97d5db`, the head with W28's prone receiver) ✔:
  1552 steps, 600 599 ticks, 0 violations, `ddb634d6…`, 784 s wall. W27's recorder scenario + docs are committed in
  w27-ab as `f9fa987` and cherry-picked to main as `279d405` (PROGRESS kept both sides).
- **Chapter takes** (`engine/take/chapters.ts`, additive): ONE run recorded as consecutive takes. A `ChapterCutter`
  observer finishes the TakeRecorder and starts the next at the end of the tick in which the last step before a bound
  ended. The run is the ordinary `SequenceRunner.run`. Also `isBarrier` (a plan check: every later step depends on
  every earlier one), `sectionBounds(build, ['END'])` (A@0, D0@552, D1@743, D2@954, S@1167, W@1341, P@1499; from
  sequence-b's existing `sectionStarts`, so sequence-b.ts is unchanged), `chapterContinuity` and `rehearseChapters`.
- **Recorded** (`--scenario year-build-2022-ab-chapters`, explicit, ≈ 30 min): set `8ce33bee…` "Watch it being built:
  2022 east-house (A+B)", 7 chapters, **600 599 ticks = the A+B pin, final `ddb634d6…`**. Each chapter < 6 MB with its own
  camera plan: **15 370 637 B total (gzip 2 159 008 B)**. The table is in YEAR_BUILD.md "A+B as chapter takes". Camera min
  readability 0.60–0.80, mean 0.94–1.00 (the 8 h reuse of the skeleton shot list: min 0.15). Manifest: the chapters are
  `otherYears` entries with `kind: 'year-build-chapter'` and `chapter` { of, index, id, startsFrom, startHash }; the set
  is under a new top-level `chapterSets` (STUDIO_REPLAY.md "Chapter sets").
- **Deviation:** the whole-skeleton take `69c41651…` could not be reused as chapter A. The A+B yard has ten more piles
  (26 vs 16 initial entities), so that take's final state is not where D0 starts. Chapter A is recorded from the A+B run
  (`e8fd2e0d…`, same 117 277 ticks). The skeleton take stays as its own entry.
- **Tests:** `take-chapters.test.ts` checks the mechanism on open ground (the same ticks and final hash as the
  unchaptered run, continuity, a non-barrier bound refused, 50 ms) and the shipped chapter set (continuity of every
  join, Σ ticks, ends at the pin, 130 ms). `year-build-b.test.ts` gains a plan-only section-boundary test; the pins are
  untouched. Suite 371 pass / 3 skipped; tsc clean.
- **Recorder** refactored into `record` → `packageTake` (+ `recordChapters`). **`--check` OK for every manifest take**
  on the head with W30 + W32 merged: flagship, v3, bay 1, whole skeleton (byte-identical), and the 7 chapters + the set.
- **Prone take fields (lead note, W32):** `TakeRecorder` FIELDS gains `proneYaw` (integer mrad) and `phaseK` (integer %),
  still `mars-take/4` (additive: an absent field records nothing, so every manifest take re-checks byte-identical).
  Test `take-prone-fields.test.ts`. No pin moves.
- **Commits** (branch `w31-chapters`, on main `36772d7`): `6a7fadb` chapters.ts + tests, `3afc6fb` recorder + 7 takes +
  manifest, `d9c603a` docs, `6fc9b46` prone take fields, `ccdf9d2` + this entry. W27: `279d405` on main.
- **Weak spots:** the studio cannot play a set back to back yet (contract written; a renderer task). The chapters are not
  in "Watch it being built" by design (kind), but they are listed under "Replay take" for 2022 (7 more options). Work
  shots stay close on 1–4 people for minutes; the yard is seen only in the opening wide. Chapter moments are generic.
  Recording the set takes two 13-min rehearsals, and `--check` takes the same again.
- **W31 landed** `6a7fadb`, `3afc6fb`, `d9c603a`, `6fc9b46`, `ccdf9d2`, `6c6f23d` + W27's docs as `279d405` (≈290k tokens, 115 min): `engine/take/chapters.ts` (observer cuts the take at section barriers, fresh recorder on the same runtime), **2022 east-house A+B as 7 chapter takes** (A 117 277 / D0 99 007 / D1 100 831 / D2 107 341 / S 87 041 / W 72 915 / P 16 187 ticks = 600 599; set `8ce33bee…`; 15.4 MB raw / 2.16 MB gz; every chapter 100 % readable, 0 invalid); continuity by hash + exact entities + replayed first frame; manifest `chapterSets` + `kind: 'year-build-chapter'` (STUDIO_REPLAY "Chapter sets"); recorder FIELDS `proneYaw`/`phaseK` (still /4). 376 / 3 skip / 0 fail; `--check` OK for all 13 takes. Chapter A is a new take (the A+B yard has the phase-B piles). Lead review: accepted.
- W37 spawned (studio): chapter-set playback back-to-back with continuity check, captures. W38 spawned (campus): the other three 2022 houses (chiba, kitchen, west-house) through phase A+B, fix rules, pins.
- **W36 landed** `03bed33`, `d1f02c0` (≈375k tokens, 50 min; merged from `w36-framing`): `catalog-framing.ts` (plates 8/12/16 ft, rafters 4–16 ft, blocking 16/24 in; all cut-to-order from 16 ft stock), `construction/framing.ts` (`install_top_plate` / `install_rafter` / `install_blocking` via givers → optional relay → installers on stances/deck; `framing.gap`, `framing.out-of-reach`), support rules (≥ 2 bearings, ≤ 24 in overhang; rafters need both plates, 1.5 in bearing, ≤ 12 in tail; `RAFTER_SPACING_MAX` 24 in exported), invariants `framingHandsInReach`/`framingSupported`; test bay 7 674 ticks 0 violations pinned 935bfcee…; 7 refusal cases. 379 / 376 / 3 skip; all pins unchanged. **Finding:** the 2022 Kit has no 2x4 framing (roof sheets on the top beams; "roof" features = kitchen guard rail) → decision in OWNER_DECISIONS (framing only where the reconstruction has it), Q19 parked. Lead review: accepted. Weak: mid-bay top members unreachable from end-frame stances (needs a stand-on-the-top-beams verb); one person per frame face per height band.
## W36 — 2x4 roof framing verbs: top plates, rafters, blocking (2026-09-29)
- **Verbs** (`construction/framing.ts`, FRAMING.md; branch `w36-framing`):
  - `install_top_plate {part, onto, at}`: rests on column tops of beam-stable frames that have their top beams, or on
    top rack beams; ≥ 2 bearings of ≥ 1.5 in; ≤ 24 in overhang.
  - `install_rafter {part, from, to, at, pitch?}`: plate to plate, square across; pitch from the plates' tops, checked
    ±1°; ≥ 1.5 in on each plate, tail ≤ 12 in (names the lengths).
  - `install_blocking {part, between, on}`: between two rafters on a plate, ≤ 1 cm play a side.
  - All three go up by the hang_beam / pass_up relay pattern on set_part's helpers: givers → relay → installers on frame
    stances or a deck, raised outside the structure, slid 2 cm over the supports, fastened. Hand-off heights are
    searched inside both crews' reach.
  - Refusals: `framing.gap` ("add a relay"), `framing.out-of-reach` (names the height, "use a stance/deck"),
    `plate-not-installed`, `rafter-long/short`, `pitch-mismatch`, `blocking-length`, `plate-frame-not-ready`, … .
  - Invariants: `framingHandsInReach` (stance / floor reach every tick) and `framingSupported`.
- **Catalog** (`world/catalog-framing.ts`): plates 8/12/16 ft (flat), rafters 4–16 ft (on edge; a flat-roof rafter is
  the ceiling joist, so there is no separate def), blocking 16/24 in centres. All are 2x4 section, cut to order from
  16 ft stock by the unchanged `cut`.
- **Additive changes:** `rules.ts` (`RAFTER_SPACING_MAX` 24 in for the sheet rule + limits, `frameTopProblem`),
  `index.ts` / `api/registry.ts` (ENGINE_ACTIONS / ENGINE_INVARIANTS), `catalog.ts` (one registration).
- **Test** (`framing.test.ts`, 4 tests):
  - A 16 ft Kit bay (beams 0.22 / 2.48 / 4.757) gets 2 plates, 4 rafters and 4 blocks: 7 674 ticks, 0 violations,
    every member within 1 cm / 1°, pinned `935bfcee…`.
  - The seven refusals listed in FRAMING.md.
  - Determinism; catalog / cut; sloped rafter (plan).
  - Engine suite 379 / 376 pass / 0 fail / 3 skip; `npm test` 56/56; tsc clean.
- **Pins unchanged:** `deploy/perf-walk.mjs` stress / probe / campus / meal / v3 all PIN-OK. The suite's year-build
  tests (first bay, first bay + deck strip) are unchanged.
- **Kit finding (for the campus worker):**
  - 2022 has no roof framing. Its 10 "roof" features are the kitchen's first-floor guard rail: 8 `roof rail post`
    (0.07 × 1.0 × 0.06, y 2.5–3.5, standing in the outer frame columns: unplaceable, the column is the post) and 2
    `timber roof railing` (10.972 × 0.07 × 0.08 at y 3.45 along both long sides). They map to a guard-rail rule, not
    to these verbs.
  - A framed roof raises the roof sheets 13 cm above the Kit's 4.892 m roof deck, so framing in a replay is a
    non-canonical addition. That needs a decision (FRAMING.md).
- **Weak spots:**
  - Mid-bay top members are out of reach from end-frame stances (refused) until there is a deck or a "stand on the top
    beams" verb.
  - One person per frame face per height band (0.31 m apart otherwise).
  - No runtime make-way for the givers.
  - Sloped framing only plan-tested.
- 13:55 EDT lead: merged head `c27c2d4` (W31 + W35 + W36 on main) — tsc clean, engine 383 / 380 / 0 fail / 3 skip on a clean run (one wall-clock flake under worker load on the first run, not reproduced). In flight: W37 (studio chapter-set playback), W38 (chiba/kitchen/west-house A+B). Next: per-house chapter takes → gate → release 7 (checkpoint 1).

## 2026-09-28 — W37: studio "Watch it being built · 2022" plays the A+B chapter set back to back
- **One entry.** The 2022 pickers offer the chapter set once: "2022 east-house: skeleton, decks, stair, walls, solar —
  from the piles · 8 h 20 min · 7 chapters" (derived from the manifest; 30 029.95 s = 8 h 20.499 min, so 20 not 21). The
  bay-1 and whole-skeleton takes stay; the 7 chapter takes are in neither picker (`isChapter`).
- **Playback** (`app/studio/chapter-set.ts` ChapterSetReplay, `chapter-panel.tsx`, `take-host.ts openSet`): one set clock
  (h:mm:ss) and scrubber, 0.5–64×; chapter bar A · D0 · D1 · D2 · S · W · P with the chapter on screen highlighted and a
  continuity mark at every seam; one `TakePeople` for the whole set, the next chapter swapped in with `setTake` (no rig /
  mesh rebuild); a hash guard before every swap (baseline = previous manifest final = `chapter.startHash`, else the clock
  stops with a continuity error); chapter k + 1 prefetched while k plays, k − 1 … k + 1 kept; engine camera = each
  chapter's planned track; the log on the set clock (merged waits' "until" too; `takeLog(…, { at, clock })`).
- **Whole-set checks in a worker** (`chapter-set.worker.ts`, 2.9 s after opening): per chapter hash + start
  (`chapterContinuity`) + log; final: ✓ 7 / 7 chapter starts · ✓ final state ddb634d6… = A+B pin (spec reads
  `PIN_FULL_AB`) · last frame = final state 0.64 mm · ✓ 66 frames + beams + 145 parts at the mars-2022 canonical pose
  (`compareToCanonical` + `compareB` on `yearBuildPlan(…, { phaseB: {} })`, max 0.57 mm). `vite build` emits the worker
  as its own chunk (267 kB).
- **64× across the A → D0 seam** (10 s, SwiftShader): 17.7 fps, frame mean 56.8 / p95 66.7 / **max 66.8 ms** (no stall;
  limit 250 ms), frames around the seam 50–66.7 ms, the swap redraw 2.6 ms, prefetch 20–36 ms fetch + parse, 64.6 take-s
  per wall-s.
- **Prone fields in replay** (`take-replay.ts`): `proneYaw` (mrad → rad) and `phaseK` (% → 0–1) into `SampledHuman`.
  `studio-take-prone.spec.ts` (lab `prone`, 708 receiver samples): engine numbers identical, turn within 0.0005 rad,
  prone-wait hips / head within 0.6 mm; getting up the replay rises exactly on smooth(phaseK) and the live body is never
  ahead (it waits for the load, up to 0.79 behind — random access cannot know). Without the fields: turn off 0.35 rad
  every prone-wait tick.
- **Specs:** studio-build 8/8 (3 new), studio-take-prone 1/1 (new), studio-take 1/1, studio-direct 2/2; tsc clean.
  Captures looked at: `studio-build-set-{yard,roof-relay,stair,walls,final}.png` (STUDIO_REPLAY.md "Chapter sets:
  playback").
- **Weak spots:** STUDIO_REPLAY.md §5 "Chapter sets (W37)": gait phase restarts at a seam, heuristic chapter words,
  no Direct camera for sets, the panel covers the bottom of the frame; unbound `$crew[n]` labels still in the log
  (recorder side).
- **W37 landed** `295632c`, `c283820`, `bb23a25` (≈310k tokens, 75 min; merged from `w37-chapters-ui`): **studio "Watch it being built · 2022"** — one picker entry for the A+B chapter set (8 h 20 min · 7 chapters), `ChapterSetReplay` swaps chapter takes without rebuilding rigs, hash guard at every boundary, prefetch next / keep 3 in memory, per-chapter engine camera, continuous log on the set clock, whole-set checks in a Web Worker (2.9 s): "✓ continuity 7/7 · ✓ final state ddb634d6… = A+B pin · last frame = final state (0.64 mm) · ✓ 66 frames + beams + 145 parts at the canonical pose (max 0.57 mm)"; 64× across the A→D0 seam: 17.7 fps, max frame 66.8 ms (swap redraw 2.6 ms). `take-replay.ts` carries `proneYaw`/`phaseK` (replay turn within 0.0005 rad of live). studio-build 8/8, studio-take-prone 1/1, studio-take, studio-direct green. Lead LOOKED at set-final + set-roof-relay: accepted. Weak: one-frame leg-phase jump for a walker crossing a boundary; no Direct camera for a set; `$crew[n]` placeholders in step labels (recorder side — to fix).
- 14:35 EDT: W39 spawned (take/camera, hash-identical: `$crew[n]` step labels, chapter camera quality + re-record chapters); W40 spawned (release 7: gate + deploy of the studio milestone). W38 (houses) in flight. Checkpoint 1 remaining after W38: per-house chapter takes, gate, release 8.
- **W40 release 7 deployed** (13:38 → 14:05 EDT): gate GREEN at `d91057b` in a detached worktree (unit 56/56, engine 380/0/3 skip, tsc clean, e2e 69 passed / 1 skipped in 759 s on port 5601, probe `b746b094…f0c3` = unchanged; `gitDirty: false`; report `w40-wt/viewer/.cloudflare/gate/2026-09-28T17-38-47-294Z`); production **`f709304d-fc55-45f2-a44b-200cfadf4ae1`** replaces `07dce638…` (rollback target, confirmed 100 % before the deploy). Nothing on `main` left out. Smoke: all routes incl. `/studio/2022`, manifest + all 11 take files (flagship, v3, bay-1, whole skeleton, 7 chapters) and R2 200; `smoke.mjs ALL_ASSETS=1` OK (19 routes, 322 assets); `simulation-integration.mjs` 3/3 PASS (14 engine tools); director demo PASS (9 steps, 8.8 s); prod `/lab` build-bay 43/43, 0 violations, tick 10901, **prod hash = probe**; prod `/studio/2022` chapter set (8 h 20 min · 7 chapters) scrubbed to the end: 7/7 chapter hashes + starts ✓, "✓ continuity 7/7 · ✓ final state ddb634d6… = A+B pin · last frame = final state (0.64 mm) · ✓ 66 frames + beams + 145 parts … (max 0.57 mm)", 221/221 drawn, 0 errors (screenshot looked at: finished east-house with solar, crew stood down); prod `/studio` flagship at held 37/37, hash = recorded = manifest `c56ea8da…`, banner, 0 errors (`e2e/artifacts/prod-smoke-7/`). Evidence regenerated: 17/17 rows, capabilities 27/1/0, milestones 8/8. Record: RELEASE_CHECKLIST "Production deploy 7". Nothing red.
- **W40 landed** `b4084ce` (≈150k tokens, 35 min): **Release 7 live** — production `f709304d-fc55-45f2-a44b-200cfadf4ae1` from gated head `d91057b` (gate GREEN: 56/56, engine 380/0/3, tsc, e2e 69 pass / 1 skip in 759 s, probe = pin; report `w40-wt/.cloudflare/gate/2026-09-28T17-38-47-294Z`); rollback `07dce638…` (command in RELEASE_CHECKLIST "Production deploy 7"). Smoke all green: routes, manifest + 11 take files, R2, ALL_ASSETS, integration 3/3 (14 tools), director 9/9, prod `/lab` 43/43 hash = probe, **prod `/studio/2022` chapter set: continuity 7/7, final = A+B pin, 66 + 145 parts at canonical pose, 0 console errors** (screenshot inspected by W40). Evidence 17/17, 27/1/0, 8/8. No commits missed. Lead review: accepted.
- 14:20 EDT Gene: rebuild QUESTIONS_FOR_GENE as a self-contained plain-English HTML page with annotated captures, option renders, answer controls + export, served at /questions after the next deploy; Markdown stays the source, generated by `deploy/questions-html.mjs`. W41 spawned (docs/lab-capture, ≤ 1.5 h). W38 resumed after a watchdog stall (silent wait on 13-min runs). In flight: W38, W39, W41.
- 15:05 EDT Gene (§15): north bearing = ±90° (tire ring long axis N–S; sign from the DJI_0079 shadows), tires levitate (renderer datum), Chiba 2024 facade wrong (vertical inset with straight stairs, angled flaps protruding, plexiglass windows showing the solarium, plexiglass side door). Photos saved under evidence/. W42 spawned (north + tires, ≤ 45 min, renderer/env). W43 (Chiba 2024 facade reconstruction edit) queued for the next free slot.

## 2026-09-28 — W41: Gene's questions page (`/questions/`)

- **Page:** `docs/engineering/questions/index.html`, generated by `viewer/deploy/questions-html.mjs` from the new
  ` ```question ` field blocks in QUESTIONS_FOR_GENE.md (id, urgency, order, plain, context, changes, terms, options,
  images; answer from the `Gene:` line). 15 open cards ordered by urgency (north, trailers, SW corner, floors first;
  ground level, beam holes, 9 ft part last) + the 2 answered as a record. Each card: plain question (engine words
  refused by the generator unless defined in `terms`), two-sentence context, pictures, radio options + don't know /
  skip + "show me a different angle" + note, what-changes line + urgency tag; answers persist in localStorage;
  "Export answers" copies a Markdown block. Single file, inline CSS / vanilla JS, 60 KB.
- **Pictures (36 on the page, 3.7 MB staged):** 15 new lab captures with outlines + labels through the new lab hook
  `highlight(ids | prefix*, label, opts)` (`app/lab/highlight.ts`: entity / scene-obstacle / region footprint by id,
  depth-test-off tubes + CSS2D word-and-arrow) via the capture-only `e2e/questions-captures.spec.ts`
  (`QUESTIONS_CAPTURE=1`); 13 real photos (studio year references + `evidence/`) in `questions/photos/`;
  8 labelled SVG option diagrams (`questions/tools/diagrams.py`) where an option cannot be staged; the Q3 compass
  overlay (`tools/compass.py`). None of the six older `questions/*.png` is reused (no outline / label, debug panel
  in frame); the engineer text still links them. Q5 (9 ft part) has no picture: a description instead.
- **Serving:** `deploy/prepare.py` stages `questions/index.html` + exactly the files it references under
  `/questions/` (records in release.json, so `ALL_ASSETS=1` smoke HEADs them; `--questions` lists them); the worker
  (`deploy/configure.mjs`) serves `/questions/` (no-cache) and redirects `/questions`; `deploy/smoke.mjs` checks it.
  `deploy/questions-html.test.mjs` (in `npm test`): page up to date, every referenced file staged, < 25 MiB, route
  present. Dry run: 359 files staged, 37 under `/questions/`. Not deployed.
- **Structure-only edits to QUESTIONS_FOR_GENE.md:** field blocks, Q19 moved above "Answered" with a `### Q19.`
  heading (wording unchanged), status now 15 open, a "Gene's page" section documenting the fields.
- **Rule** (NEXT_SESSION_PROMPT.md): any new question for Gene goes in with a capture and the plain-English fields,
  then `node deploy/questions-html.mjs`.

- **W41 landed** `1876875` (≈255k tokens, 31 min; merged from `w41-questions-page`): `docs/engineering/questions/index.html` (60 KB, generated by `deploy/questions-html.mjs` from fenced `question` blocks in QUESTIONS_FOR_GENE.md; fails loudly on missing fields/images and on engine words), 15 open cards + 2 answered, ordered by urgency (Q3 north, Q2 trailers first; Q4/Q6/Q5 last); 15 new outlined+labelled lab captures via the new `highlight()` lab hook, 13 real photos, 8 labelled SVG option diagrams; radio/skip/angle/free-text controls, localStorage, Export → Markdown; served at `/questions/` (prepare.py stages exactly the referenced files; worker route + 301 in `deploy/configure.mjs`; `smoke.mjs` check; `questions-html.test.mjs`). Rule added to NEXT_SESSION_PROMPT. Lead LOOKED at q02-2024-eye + q03 compass + the Q3 card text: accepted. Q5 (9 ft part) described in words (no image exists).
- W43 spawned (scenes.ts reconstruction edit): Chiba 2024 facade — vertical inset with straight stairs, angled flaps protruding, plexiglass windows showing the solarium, plexiglass side door.

## 2026-09-28 — W39: filled step labels; event-driven cameras for the A+B chapter takes
- **`$crew[n]` labels.**
  - Where from: the step labels written by `engine/campus/sequence.ts` (`$crew[${i}] steps out of the aisle`, …).
  - Why they stayed raw: `bindTemplate` substitutes step params only. The recorder's `timeline()` copied `plan.steps[].label`
    as written into the take file's `steps`, which the studio shows as the current step and in the log.
  - Fix: `bindLabel(label, plan.bindings)` (`sequence/bind.ts`; inline `$name[i]` / `.field`, `$$`, an unbound ref stays).
    It is applied in `timeline()`. `bindTemplate` still keeps labels as written: filling them there would move `planHash`
    and every year-build take id.
  - W38 needs no change. `take-labels.test.ts` checks that no shipped chapter step label or event message holds a
    reference.
- **Chapter cameras** (`engine/camera/chapter-shots.ts`, CAMERA.md "Chapter shot lists"; replaces W31's `workShots`):
  - Shots come from an activity grid (recorded activity, idle/wait = idle) and the step timeline plus actors.
  - Cuts at telling events (raises, hand-ups, relays, pass-ups, cuts at the station, stringers, treads, walls, rails,
    panels), 40–90 s. Only the working people are framed, and a shot cuts 12 s after they all went idle while someone
    else works. A wide from the yard side comes every 5 min.
  - Candidate angles are rated by `shotRater` (desired-pose readability over the whole shot). An unreadable shot is split,
    else the one who works is framed alone, else the house wide.
  - Moments are the first of each event ("first raise", "first relay", "first cut", "first tread", "first wall", …) +
    `done` (was work / middle / done).
  - Audit: `shotActivityReport`. Tests: `camera-chapter-shots.test.ts` (mechanism on a hand-made take + the shipped
    cameras).
- **Re-recorded** the 7 chapters (`--scenario year-build-2022-ab-chapters`):
  - Same take ids, same set `8ce33bee…`, final `ddb634d6…` = A+B pin (take bodies unchanged).
  - New camera tracks, moments and labels; the manifest changes only the chapter entries (camera, moments, bytes) and the
    set's bytes.
  - Per chapter, before → after (idle = frameGroup stretches > 20 s in which every framed person is idle/wait while
    someone else works; wides = mid-chapter wides):

  | ch | cuts | min read | mean read | idle stretches (longest) | wides (longest gap) | longest shot |
  | --- | --- | --- | --- | --- | --- | --- |
  | A | 52 → 123 | 0.70 → 0.70 | 0.983 → 0.977 | 3 (32 s) → 0 (10 s) | 0 → 17 (352 s) | 180 → 90 s |
  | D0 | 28 → 115 | 0.70 → 0.60 | 0.989 → 0.979 | 33 (186 s) → 0 (10 s) | 0 → 14 (340 s) | 218 → 90 s |
  | D1 | 28 → 120 | 0.80 → 0.60 | 0.997 → 0.979 | 33 (176 s) → 0 (10 s) | 0 → 15 (376 s) | 222 → 90 s |
  | D2 | 28 → 131 | 0.67 → 0.67 | 0.997 → 0.976 | 32 (186 s) → 0 (10 s) | 0 → 16 (364 s) | 246 → 90 s |
  | S | 31 → 91 | 0.80 → 0.60 | 0.999 → 0.977 | 31 (202 s) → 0 (10 s) | 0 → 12 (352 s) | 218 → 90 s |
  | W | 27 → 88 | 0.60 → 0.70 | 0.944 → 0.981 | 25 (154 s) → 0 (6 s) | 0 → 10 (368 s) | 164 → 82 s |
  | P | 9 → 24 | 0.60 → 0.78 | 0.963 → 0.981 | 8 (58 s) → 0 (10 s) | 0 → 4 (274 s) | 144 → 58 s |

  Every chapter is still 100 % readable with 0 invalid / 0 crossings.
- **Bay-1 and whole-skeleton takes** were re-recorded for the labels only: same take ids, pins and camera tracks; only
  bytes changed (separate commit).
- **Pins:** perf-walk stress / probe / campus / meal / v3 PIN-OK. Suite 390 / 387 pass / 0 fail / 3 skip; tsc clean.
  `--check` OK for flagship and v3; the chapters' `--check` is in the final report.
- **Weak spots:**
  - Cuts rose 2.5–4× (mean frameGroup shot 45–54 s; P 38 s). At 64× a shot lasts under a second. The set player could
    hold or skip shots under ~2 wall-s.
  - Mean readability dropped ~0.01–0.02 on A / D0–S: moving workers are harder to read than people standing still.
  - The rater scores the desired pose only; the planner's own corrections decide the final sample. Min 0.60 on D0 / D1 / S
    sits exactly at the readable line.
  - The moment "up the frame" at 6 s (D1, D2, W, P) is a weak jump point.
  - W31 counted 5 idle stretches by eye; this audit's stricter definition counts 3–33 per chapter before.
- **W39 landed** `167bee6`, `6c2d65d`, `0064c63`, `4bc4d98` (≈300k tokens, 80 min; merged from `w39-take-polish`): `bindLabel` fills `$crew[n]` at record time (labels never entered `planHash`, so take ids are unchanged); `engine/camera/chapter-shots.ts` — event-driven shot lists (raises, hand-ups, relays, pass-ups, cuts, stringers, treads, walls, rails, panels), frames only the people working, ends 12 s after they go idle / at 90 s, a yard wide every 5 min, moments = first of each event; all 7 chapters re-recorded (same ids, same final states, set unchanged; idle stretches 3–33 → 0 per chapter; cuts ×2.5–4; min readability ≥ 0.60); bay-1 + skeleton re-recorded for labels only. 390 / 387 / 3 skip; 5 pins + A+B pin unchanged; `--check` byte-identical. Lead review: accepted. Follow-ups: STUDIO_REPLAY moments text + YEAR_BUILD camera table (next consolidation); set player may hold sub-second shots at 64×; bay-1/skeleton cameras still 77 % readable (predates).
- **W42 north + tires** (branch `w42-north-tires`): (1) `NORTH_AZIMUTH_OFFSET = −90` (world −X north, −Z east) from DJI_0079
  (2020-03-04 10:10:34 PST, FlightYaw +99.4, sun az 143°, shadows NW = behind-left, as photographed). env-sun tests pin
  bearing, evidence and the import-graph isolation; perf-walk 5 pins PIN-OK, year-build pins green; camera fixtures
  relabelled to keep geometry (correct "outgrows": south→west; studio-direct: east→south); 19 studio baselines refreshed
  (shadows rotate; also picks up current UI). Other years' frames differ (2026 CAD ≈ −57°, 2025 ≈ 0°, 2022 mirrored,
  2024 kitchen/RV side) — QUESTIONS A3, per-year bearing open. (2) 2020 tires rest on their surfaces: ring on the −0.16
  ground (was +0.175 m, 6-sided tube → centre at ground + 0.091), tarp ballast on the analytic tarp and tilted with it
  (was +0.13–0.19), roof ballast on the roof top (was −0.03). 73 tire ids moved → aliased in id-migration.json (2020
  site/container/canopy lines); campus-2020.json regenerated (tire obstacles only). New baseline `studio-2020-ring-edge`.
  Prop-float survey for 2020–2026 in QUESTIONS Q4 (Kit datum +0.16 plus table +0.10 / crates +0.22 / benches +0.05).
- **W42 landed** `ece387d`, `a109499` (≈450k tokens incl. a subagent, 110 min; merged `50e805d`): `NORTH_AZIMUTH_OFFSET = −90` (world −X north) from DJI_0079 EXIF 2020-03-04 10:10:34 PST, yaw +99.4°, sun az 143° / el 43° → shadows NW behind-left of an east-facing camera, holds ±1 h; import-graph test proves only `camera/`/`api/` see `env/sun.ts`; 5 pins + year-build pins unchanged; camera fixtures derive bearings from the constant (no tolerance loosened); 19 studio baselines refreshed (shadows rotated, inspected). **Years don't share the frame:** 2026 CAD ≈ −57° (33° still off), 2025 −Z (±20°), 2024 Chiba fits −Z but kitchen + RV ring on the wrong side, **2022 mirrored** (pinwheel turns the other way), 2021/2023 unverified. Tires: ring floated 17.5 cm (6-sided tube) → seated on ground/tarp/roof (73 ids aliased in `id-migration.json`, campus-2020.json regenerated); eye-level baseline `studio-2020-ring-edge` inspected. Props survey: 2020 RVs/toilets/workshop table + Kit tables (+0.26: 0.16 datum + legs at y 0.1), benches, crates, fridge, cafe counter, trailer wheels still float — Q4 + a Kit bug. Q3 → answered (A3). Lead review: accepted. Follow-ups: per-year bearing + the 2022 mirror / 2024 side as reconstruction edits → cards for Gene (W44); Kit prop datum fixes after W43 releases scenes.ts.
- W44 spawned (docs): Q20 (2022 mirror), Q21 (2024 kitchen/RV side), Q22 (2026 bearing) cards with annotated captures; STUDIO_REPLAY moments, YEAR_BUILD camera table, CAMPUS_SCENE north note.
- 16:10 EDT: all four `codex/*` branches carry REPORT files (+2 commits each). W45 spawned (merge worker): tooling → camera-nl-parse → 2026-frame-grouping → fire-v2-render-polish, each re-gated on `w45-codex-merge` (engine, tsc, unit, 5 pins, own specs; lint only if green; fire baseline drift inspected), then a full gate; lead fast-forwards. In flight: W38, W43, W44, W45.

## 2026-09-28 — W44: site-axis cards for Gene (Q20–Q22) + doc touch-ups
- **Three `first` cards** (QUESTIONS_FOR_GENE.md, new section "Site axis per year", orders 5–7), from W42's A3 table:
  - **Q20 2022 mirrored:** "The model's four 2022 houses spin one way (counter-clockwise from above); the drone photo
    shows them spinning the other way. Which is right — or is the model's map flipped left-to-right?"
  - **Q21 2024 side:** "In 2024, did the kitchen and the ring of trailers sit north of Chiba, as the drone photo shows,
    or south of it, as the model has them?" (answering "photo" also settles Q2 for 2024).
  - **Q22 2026 north:** "Your 2020 answer set one north for every year, but the 2026 model is turned about 33° from what
    the 2026 drone photos show. Should 2026 use the drones' north?" (+ "each year's own north" option).
- **Pictures:** 6 new outlined + labelled lab captures (`e2e/questions-captures.spec.ts`, additive shots
  `q20-2022-{top,eye}`, `q21-2024-{top,eye}`, `q22-2026-{top,eye}`) and 3 side-by-sides drawn by the new
  `questions/tools/axis.py`: model top-down next to the drone still turned north-up from its logged heading, a north
  arrow on each side — `q20-2022-model-vs-drone.jpg` (DJI_0829 rotated −110.2°; spin arrows: model counter-clockwise,
  photo clockwise), `q21-2024-model-vs-drone.jpg` (DJI_20240122144543_0335_D, north-up by the tire ring; Chiba /
  kitchen / trailer ring labelled on both), `q22-2026-model-vs-drone.jpg` (grey = north the engine uses now, −X; red =
  drone north, −X turned 33° toward −Z; DJI_0005 rotated +91.7°). Stills copied from W42's scratch into
  `questions/photos/` (`2022-DJI_0829`, `2024-DJI_20240122144543_0335_D`, `2026-DJI_0005`). All captures looked at;
  the rotated DJI_0829 matches W42's north-up frame (afternoon shadows NE). Page regenerated: 17 open + 3 answered,
  72 KB; `questions-html.test.mjs` 3/3.
- **Docs:** STUDIO_REPLAY "Chapter sets" moments = first of each event + `done` (real keys from the manifest);
  YEAR_BUILD "A+B as chapter takes" table → W39's cuts / min / mean readability / idle stretches 0 and the re-recorded
  bytes (set 17 023 471 raw / 2 668 326 gzip), W31 camera bullet marked replaced; CAMPUS_SCENE "North = −z" → A3's
  per-year table (−90 constant, 2026 ≈ −57°, caveat that −z is ~57° off); CAMERA.md already points at
  `chapter-shots.ts` (no change).
- **Weak spots:** the 2022 photo buildings are not named (which house is which decides X- vs Z-mirror; asked on the
  card). Q21 rests on one wet-day nadir whose north comes from the tire ring, not EXIF. The eye-level 2026 capture only
  identifies Chiba.
- **W44 landed** `5eeedb7`, `047fc68` (≈190k tokens, 40 min; merged): cards Q20 (2022 mirrored — model vs DJI_0829 north-up, spin arrows), Q21 (2024 kitchen + trailer ring north or south of Chiba — vs DJI_20240122144543_0335_D), Q22 (2026 north ≈ 33° off — vs DJI_0005; option "each year's own north"), all "worth answering first" with outlined captures + drone stills; page 17 open / 3 answered; STUDIO_REPLAY moments, YEAR_BUILD camera table, CAMPUS_SCENE per-year north. Lead LOOKED at q20-2022-model-vs-drone: accepted. Note: Q21's answer also settles Q2 for 2024.
## 2026-09-29 — W43: Chiba 2024 front as photographed (reconstruction edit of `mars-2024`)

- **Scene** (`app/history/photographic-corrections.ts frontage2024`, `scenes.ts make2024`):
  - a VERTICAL inset (2.5 bays) at the frame front, 2.65 m behind the flap bottoms;
  - two straight stair flights (run 2.6, rise 2.08, 12 risers; the old shear matrix is gone) to a 3.46 × 1.45 m
    landing at the upper-floor level above a sliding double door (yellow leaf kept, orange leaf added);
  - flaps keep the 29.7° lean, with triangular cheeks against the inset and a left upper step under the top PV rows;
  - right flap = 4 rows of `plexiglass` panes (new renderer-only material) on a 2x4 lattice, with the painted eye pane
    and no opaque backing, so the solarium shows through;
  - the solarium's end: a plexiglass wall on 2x4 studs with a 1.21 × 2.0 m door standing open. This is the **first
    door object**: pinned `chiba-solarium-door`, kind `plexiglass door` → engine `glass`, `userData.door` = the
    opening.
  Measurements and pixel reasoning: CAMPUS_SCENE.md "Chiba 2024 front".
- **Re-seed** (new HISTORY_IDS.md "Reconstruction edits" procedure): `campus-2024.json` c542f3fe… → d197e6ae…
  - 1446 of 1606 Kit ids kept (all non-Chiba, PV, left strip, yellow leaf, frame, decks, upper stair); 160 Chiba
    pieces replaced or added; the pins survive;
  - migration table: 76 aliases, 84 nulls (the removed right-hand salvaged windows);
  - `campus-history.test.ts` (+4 tests): pre-edit canonical → fork → `reconstruction-edit` checkpoint = the new
    canonical (same physicalHash); the 2024 year room seeds protected `mars-2024`; walker 5.5 m and eye-level camera
    navmesh 5.0 m through the door (closed-door counterfactual: no route); the hall interior still 100 % blocked;
  - `history-geometry.test.mjs`: a new photographed-front test (vertical inset, level treads, flaps proud, an exact
    open doorway).
- **Captures** (looked at):
  - studio 2024 default / plan / frontage re-baselined, plus new `front-eye` (the photo's framing), `solarium`
    (through the right panes) and `solarium-door`;
  - lab `year-2024-top-prisms` refreshed (4 walkers, zero violations).
  Still differs from the photo: width (Q20: the photo's door/landing scale suggests ~7 bays), the older PV row layout,
  flat plexiglass (no glare), an upright in the front doorway, a plywood floor where the interior photo shows sand, and
  no furniture.
- **Questions:** Q20 (6 vs 7 bays), Q21 (end-wall door position / swing); the page is regenerated (17 open cards).
- **Gates:** `npm test` 60/60, `test:engine` 384 pass / 0 fail, `tsc` clean, `--check` 6/6 deterministic,
  studio-years 14/14, lab-years year-2024 pass.
- **Not changed, flag for the lead:** CAMERA_DIRECT.md §7 still says "No door objects in any scene". The 2024 solarium
  door is now one (tagged as above; the navmesh sees it as a gap, so no rule changed).
- **W43 landed** `9f70386`, `24f1e84` (≈270k tokens, 55 min; merged): Chiba 2024 front rebuilt from Gene's photos in `photographic-corrections.ts` (`frontage2024`): vertical inset 2.5 bays wide in the frame-front plane, flaps leaning out with bottoms 2.65 m proud + cheeks, straight 12-riser flights to a 3.46 × 1.45 m landing at 2.49 m, sliding double door, right-flap stepped plexiglass (20 panes, 2x4 lattice) with the eye pane, plexiglass end wall on studs with `chiba-solarium-door` open 90° — the first door object in any year scene (walker 5.5 m and camera navmesh 5.0 m through it); new renderer material `plexiglass` (engine kind `glass`: collides, doesn't block view); 1446/1606 ids kept, 76 successors + 84 nulls in `id-migration.json`; `campus-2024.json` re-seeded (`reconstruction-edit` with both photos as evidence, protected); HISTORY_IDS gained a "Reconstruction edits" procedure; history-ids/geometry tests extended. 387 / 384 / 0 fail; studio-years 14/14; lab 2024 0 violations. Lead LOOKED at front-eye + solarium: accepted (matches the photo's structure; still differs: width 6 vs 7 bays → Q23, solar rows 4+4+2+2 vs 6+6+4+4, flat plexiglass, an upright in the front doorway, plywood deck where the photo shows sand). Q24 = end-wall door position/swing. Merge note: the three 2024 studio baselines conflicted with W42's north refresh — W43's taken, to be re-captured (W46). CAMERA_DIRECT §7 door line updated by the lead.
- W46 spawned (Kit/renderer): prop datum fixes (tables +0.26, benches, crates, fridge, cafe counter, 2020 RVs/toilets/workshop table, trailer wheels) with id migration; re-capture the 2024 studio baselines with north −90 + the new front.
- **W38 (2026-09-28, the other three 2022 houses, checkpoint 1; branch `w38-houses`, rebased on `b4b5284`).**
  `yearBuildHouseSetup(2022, house, file, { tranche? })` runs chiba, kitchen, west-house (and east-house, report only)
  through the same generator A+B, crew of six. The four houses are checked to be one template (12 × `upright-16ft-kit`
  4 × 3, 54 × `beam-12ft` at 0.22 / 2.48 / 4.757, same footprint); the phase-B split rules apply unchanged. Differences:
  kitchen's roof deck covers bay 0 only and it has no solar; chiba has two screens + bezels and a 2.30 m wall; kitchen /
  west-house have 0.90 / 1.00 m walls (all unplaced with reasons; geometry in YEAR_BUILD.md).
  - **Default suite: each house's first bay + first ground-floor strip is green and pinned**: chiba `940e9f64…` @60 997,
    kitchen `4862adfc…` @55 293, west-house `b4c42210…` @54 322 (0 violations, 24 + 3 parts at pose, max 0.49 mm).
  - **Full A+B: not green yet** (0 violations up to the refusal, `todo` behind `YEAR_BUILD_FULL=1`): chiba and west-house stop
    in D1 (`s0770-walk-to`, a first-floor receiver spot beside frame 9172e067 has no standing room); kitchen stops in S
    (`stringer.site-occupied`, idle crew parked on the stair site). Each got through the skeleton (66 / 66) and D0.
  - **11 provisional rules** (YEAR_BUILD.md "Rules added or changed"): yard v2 (neighbours' work zones; opt-in, east-house
    pins keep v1), yard work area on the ground, beam staging end, lay-out room / build direction (kitchen reverses),
    raise / hang_beam walk-in bystanders, walker static guard and passage release, narrow +u side (one giver), unreachable
    upper deck reported, stringer lay-down. Shared files touched additively: `raise.ts`, `stance.ts`, `locomotion/walk.ts`.
  - **Pins:** no existing pin moved. East-house plans byte-identical after every change; suite bay-1 / bay-1 + strip green;
    perf-walk 5 × PIN-OK; `YEAR_BUILD_FULL=1` skeleton `d382e461…` @117 277 and A+B `ddb634d6…` @600 599: green on the final head (9 / 9, run in full), bit-identical.
  - Suite on the rebased head: 405 tests, 399 pass, 0 fail, 6 skipped (the `YEAR_BUILD_FULL=1` east-house proof ran on the same code before the last docs-only rebase). Questions for Gene: Q25–Q27 in QUESTIONS_FOR_GENE.md. Lead decision:
    move east-house onto yard v2 (re-pin `94db263e…` / `ddb634d6…` and W31's chapter takes) or keep v1.
- **W38 landed** `ede0be0`…`e237c55` (≈475k tokens, 3 h incl. a stall; ff): chiba / kitchen / west-house through A+B — one template confirmed (12 × 16 ft frames, 54 beams at 0.220/2.480/4.757); per-house yards (v2: avoid other houses' work zones, 0 refused); tranches green + pinned (chiba 940e9f64 @60997, kitchen 4862adfc @55293, west b4c42210 @54322; 24 + 3 parts ≤ 0.49 mm); full runs stop at one refusal each with 0 violations before it (chiba/west D1 receiver spot beside frame 9172e067 — mirrored houses; kitchen `stringer.site-occupied` — idle crew parked on the stair site); 11 provisional rules (yard v2, beam staging end, build direction, raise/walk-in bystanders, walker static guard + passage-release deadlock fix, narrow +u side, unreachable upper deck reported, stringer lay-down); east-house pins bit-identical (9/9 full set); Q25–Q27 (chiba screens + 2.30 m wall, kitchen roof deck, low walls). 405 / 399 / 0 fail / 6 skip. Lead review: accepted. **Lead decision:** east-house stays on yard v1 until all four full runs are green, then one joint re-pin. Checkpoint 1b → W47.
- W47 spawned (campus): the three refusals → green full A+B runs for chiba/kitchen/west-house, pins, yard v2 joint re-pin incl. east-house, chapter takes per house (W31 chapters + W39 cameras), manifest entries.
- **W46 prop datum** (branch `w46-prop-datum`, `8c5b8df`): props seated on the surface under them (§15), computed, not
  hard-coded — `Kit.surface()` = the highest upward structure face (floor/steel/roof layers: deck sheets, beams,
  crossbars; never other furniture) under the prop's footprint, else the studio ground (`GROUND` −0.16 = every year
  file's `groundY`; the studio draws the soil there in every year). Legs/feet run from it to their unchanged tops;
  rigid props rest on it; trailers/RVs/toilets stand on the ground. **Re-measured** (ray from 0.5 m above the prop's
  bottom, structure only): W42's "+0.26 tables / +0.38 crates" were rays from inside the ground-floor deck (top
  0.2525) — most Kit props were **sunk**, not floating.

  | Scene | Prop | Before (gap to its surface) | After | Ids aliased |
  | --- | --- | --- | --- | --- |
  | 2020 | RV tires (6 RVs × 4) | +0.089 over ground; wheels turned 90° (rolling sideways) | 0.000, rolling along the body | 48 (tire + hub) |
  | 2020 | portable toilets (4) | +0.190 over ground | 0.000 | 12 (body, roof, door) |
  | 2020 | workshop table legs (4) / counter legs (3) | −0.100 / −0.070 (inside the platform) | 0.000 on the platform top | 4 / 0 (same 5 cm bucket) |
  | 2020 | workshop storage bins (6) | +0.015 over the platform | 0.000 | 6 |
  | 2021/23/24/25 | table legs (classroom, library, kitchens, cafe, chiba, lounge) | −0.13 … −0.18 (inside the deck) | 0.000 (edge legs on a beam that stands 2.75 cm proud of the deck) | 24+4+12 / 28 / 28 / 20 |
  | 2021 | classroom bench feet (12) | from 0.05, i.e. −0.20 inside the deck | 0.000, floor to seat underside | 12 |
  | 2021/23/24/25 | stored food crates (12 per kitchen) | −0.01 … −0.06 (deck / proud beam) | 0.000 | 2 / 8 / 8 / 8 |
  | 2021/23/24/25 | white refrigerator (+ seam, handles) | −0.21 / −0.23 | 0.000 (one corner on a beam) | 4 each year |
  | 2023/24/25 | café painted counter | −0.15 | 0.000, spans floor → counter top 0.9 | 1 each |
  | 2021/23/24/25 | trailer wheels (all rings) | +0.160 over ground | 0.000 | 0 (assembly moved) |
  | 2022 | all of the above | unchanged (held) | unchanged | 0 |

  243 legacy entries re-pointed at successors in `id-migration.json` (2020 70, 2021 58, 2023 41, 2024 41, 2025 33; no
  nulls; live/null totals 7,858 / 93 unchanged); campus-2020/21/23/24/25.json regenerated, `--check` deterministic for
  all six. **2022 held** (`SEAT_HELD_YEARS`): its furniture is inside the year-build static scene (the east-house fork
  keeps every other obstacle within 35 m) — nudging one 2022 bench-foot obstacle moved the first-bay pin
  251a44c5 → ca200e08. Seat 2022 together with the next year-build re-pin (re-record the 2022 takes; lead decision).
  2026 details held too (CAD room floors are not visible to the Kit). Pins: perf-walk 5/5 PIN-OK, year-build first
  bay + whole skeleton (`YEAR_BUILD_FULL=1`) + A+B chapter pin green, `campus-2022.json` byte-identical.
  Tests: `history-geometry` per-year "every prop stands on its surface" (lowest vertex ≤ 1 cm from the highest
  support under any bottom vertex, nothing poking > 1 cm into the footprint core; bites: with seating off, 2021/23/24/25
  fail) + RV wheel axis; npm test 67/67, engine 397/394/0 fail/3 skip, tsc clean. Baselines (looked at each):
  2020 default/plan/ring-edge (only "76 definitions" + RV edge), 2021/2023/2025 default/plan + 2021 corridor (trailers
  16 cm lower), 2024 default/plan/frontage/front-eye/solarium/solarium-door re-captured with north −90 (shadows swing to
  the front/left; solarium end now in shade), lab-year 2021/2024 top-prisms (north lighting, trailer shadows shorter);
  new eye-level `studio-2020-rv-eye` (round wheels on the soil), `studio-2021-classroom-eye`, `studio-2024-kitchen-eye`
  (crates on the deck). Weak spots: deck-standing tops keep their y = 0 authored heights, so tables/counters are 0.53–0.66 m
  and benches 0.19 m above the deck; the fridge footprint still overlaps the counter end; 2020 counter legs pass through
  two storage bins; 2023 rv-8/9 and 2024 rv-9/10 stand inside Chiba (ring through the hall; asserted in the test);
  the café counter photo is squashed 19 % vertically.
- **W46 landed** `8c5b8df`, `ad4a988` (≈300k tokens, 80 min; merged): `Kit.surface()` (highest structure face under a prop's footprint, else ground −0.16) seats legs/feet/crates/fridge/counter/trailers/RVs/toilets/bins in 2020/21/23/24/25; finding: W42's ray started below the deck top — Kit props were SUNK (legs −0.15, fridge −0.23), only trailers/RVs/toilets/west-house table floated; 2020 RV wheels also turned to roll along the body; 243 id aliases (no nulls); `history-geometry` "no prop floats / no structure in the core" per year; **2022 held** (`SEAT_HELD_YEARS`) — a nudged bench foot moved the first-bay pin (251a44c5 → ca200e08), so seating 2022 = a year-build re-pin + take re-record → folded into W47's joint re-pin; 2024 studio baselines re-captured with north −90 + the new front (inspected). 397 / 394 / 0 fail; npm test 67/67; studio-years 18/18, lab-years 7/7. Lead review: accepted. Open: tabletops/seats keep y = 0-authored heights (0.53–0.66 m above decks — Q4); fridge overlaps the counter end; 2026 details unseated.
- 18:05 EDT: W48 spawned (studio set player: shot hold at high speed, leg-phase continuity across seams, Direct camera per chapter). In flight: W45 (Codex merge gate), W47 (checkpoint 1b), W48.

## 2026-09-29 ~18:20 EDT — Gene's questionnaire answers (new tranche: 2022 reconciliation)
- Answers recorded in OWNER_DECISIONS.md; W47 redirected (finish the green runs + pins, skip takes + joint re-pin — the 2022 states change). Plan: W49 (docs: answers into the fenced blocks, page regenerated, RECONCILIATION_2022.md work plan from `photos/2022-aerial-03.jpg`), W50 (2022 scene: names, stairs parallel, trailer train, solar south on 45° frames, SW corner, joists + roof framing in the Kit, per-year north from the panels), W51 (2023/24: trailers out of Chiba, off the walls), W52 (engine: joists-then-plywood floors, roof framing sequenced with W36's verbs, solar frames; BOM/sequence; re-pins; then takes), W53 (ground datum y = 0 across the studio + Kit.surface fallback). Codex: `codex/tooling-2` after W45 reports.

- **W45 Codex merge** (branch `w45-codex-merge`, worktree `scratchpad/w45-wt`, ports 5651/5653): all four `codex/*` branches
  **accepted**, merged `--no-ff` in order tooling → camera-nl-parse → 2026-frame-grouping → fire-v2-render-polish (Codex
  commits untouched). No conflicts; every diff stays inside the CODEX.md §6 Codex-owned paths (`components.ts` = the
  `rendererColor()` lookup in `build()` + one-line `panel()` / `equipment()` delegations; `package.json` = one
  devDependency). No pin moved at any step: perf-walk 5/5 PIN-OK after each merge and on the final head; year-build
  pins green in the suite.
  - **tooling** (`9a4be6c`): `oxlint-tsgolint` 7.0.2003 devDependency, so type-aware lint runs again. Test-only overrides
    in `.oxlintrc.json`. `engine/test/source-scan.test.ts` replaces the `core.test.ts` scan: a tokenizer that strips
    comments/strings/regex, keeps `${…}`, and bans host transcendentals plus `**`/`**=` in production `engine/**`. Its
    allowlist holds the 14 exact existing `**` lines and only shrinks; it still passes after main's W38/W46 engine code.
    **Lint is red: 114 errors** (engine 89, app 14, deploy 9, simulation 2; re-run on the merge = 114). So **no gate stage
    was added** (`gate.mjs` untouched, correct per the brief). Real findings for the lead: 26 `no-unused-vars` (3 are
    the old scan's imports in `core.test.ts`), 10 production `no-explicit-any`, 3 `restrict-template-expressions`, and
    `construction/setpart.ts:241` `erasing-op` (check it; changing it may move a pin). The full list is in the REPORT.
    Note: main's `node_modules` lacks `oxlint-tsgolint` until the lead runs `npm ci`.
  - **camera-nl-parse** (`a61bed6`): pure `engine/camera/parse.ts` (`parseSentence` / `parseSentences` → frozen
    `cameraDirectionSchema`; imports only `direct.ts`). 55 success sentences incl. the 4 owner sentences; 21 structured
    refusals (`camera.parse.{deictic,missing,conflict,unknown-verb,ambiguous,invalid}`) with question / candidates / span.
    Not wired: needs the Claude-owned export from `camera/index.ts`, plus a Studio Direct-camera panel / api call with a
    `ParseVocab` from `SemanticWorld`. No fixture subject kind in the schema (lookAt only).
  - **2026-frame-grouping** (`8567ded`): `deploy/group-2026-frames.mjs` (+6 tests, `--check` byte-identical on the merge)
    → `docs/engineering/data/campus-2026-frames.{json,svg}` + `-unclassified.md`. 667 rack_member → **81 frames, 12 beams,
    92 unclassified** (panel-not-beam 65, beam-end-miss 12 at 0.21 m vs 0.12 m tol, coincident-post 8, no-scene-prism 7).
    All frames `catalogDef: null` (post depth ≈1.02 m ≠ 0.914 stock; heights 4.292/4.877/5.971). No 9 ft beam / 2.743 m
    post, so it does not settle Q5. Lab year-2026 spec passes. Not wired into `campus/assembly.ts`.
  - **fire-v2-render-polish** (`965bed9`): crossed seeded flame ribbons + smoke in the same draw budget (431/429/466 =
    pre-v2 reference); image paint from `public/history` (flower mural etc., unknown name warns once); solar module /
    rail / tilt-riser builders; equipment meshes; engine uprights green `#2c4629` (photo median). fire.spec +
    render-polish.spec green.
  - **Baselines refreshed** (`eacf928`, each Read old/new/diff, and each compared with a pre-fire full-e2e run on
    `8567ded`). These 9 had zero pre-fire drift and changed only by frame green or firelight: `poses-climb-frame`,
    `poses-handup-joist`, `prone-push-up`, `prone-reach`, `prone-standing`, `studio-take-held`, `studio-take-visitor`
    (green uprights); `lab-social-t20-oblique` (warmer fire glow on a person edge). `poses-raise-footer` was the one
    failure (1.52%): green frame (1.19% vs pre-fire) on top of main's pre-existing drift (tick 2932→2946, one background
    walker; 0.335% before the merge). It was refreshed on that basis.
    **Not refreshed** (under threshold): `solar-paint-mid-paint` 0.66% and `solar-paint-mounted-equipment` 0.58% change
    geometry and texture (image paint, cell grid, equipment), not just colour; `poses-handup` 1.24% and
    `poses-beam-walk` 0.79% mix green with drift that predates the merge (1.06% / 0.72% pre-fire). Also below threshold
    and predating this merge (identical pre-fire): build-bay ×3, lab-narrow-passage, lab-social-t65, lab-stairs,
    meal-spoon, year-build-skeleton/handup-248.
  - **Gate:** `eacf928` GATE GREEN (test 65, engine 394/0/3 skip, tsc clean, e2e 73 + 2 skip, probe b746b094). Main then
    moved (W38/W43/W44/W46), so main was merged in (`a7b0da2`, no conflicts), then perf-walk 5/5 PIN-OK and
    **GATE GREEN** (test 73, engine 403/0/6 skip, tsc clean, e2e 79 + 2 skip, probe b746b094; report
    `.cloudflare/gate/2026-09-28T20-12-22-345Z`). The gate's `gitDirty: true` comes only from the untracked
    `viewer/.pw-browsers` symlink. Main's new studio baselines show no fire/green drift (all <0.1%).
  - **Lead follow-ups (Claude-owned):** `components.ts` `build()`: route `panel-rail` to `solarRailMesh()`; pass installed
    state/pose to `panel()` and add `solarTiltLegs()` only for installed tilted modules; `app/history/kit.ts:84` posts
    `#293c45` vs engine green; `components.ts` upright comment still says blue; `app/lab/solar-paint.ts` text says
    hashed stripes; RELEASE_CHECKLIST once lint is gated; `npm ci` for `oxlint-tsgolint`.
- **W45 landed** (≈180k tokens, 75 min; main ff to `7a00405`): all four Codex branches ACCEPTED — tooling (`oxlint-tsgolint` 7.0.2003, lint runs type-aware but is red: 114 errors → not in the gate; `source-scan.test.ts` bans host transcendentals + `**` with a 14-line allowlist), camera-nl-parse (`parse.ts`, 55 sentences + 21 structured refusals, schema frozen; not wired into the app), 2026-frame-grouping (81 frames / 12 beams / 92 unclassified; every frame `catalogDef: null` — posts ≈ 1.02 m deep, not a stock size; `--check` byte-identical), fire-v2-render-polish (green uprights, fire draw calls unchanged; 9 baselines refreshed after inspection — green/firelight drift only). Full gate GREEN at `a7b0da2`: unit 73, engine 403/0/6, tsc, e2e 79 pass + 2 skip, probe = pin. Lead review: accepted. Follow-ups (Claude-owned): `components.ts` route `panel-rail` → `solarRailMesh()`, tilt legs for installed panels, `kit.ts:84` post colour, stale comments; lint findings (26 unused vars, 10 `any`, 3 template exprs, `setpart.ts:241` erasing-op — may move a pin); wire the parser into the Direct panel (→ W48); grouping → `assembly.ts` (2026 year build, later).
- **W49 (docs) landed** on `w49-answers`: Gene's questionnaire answers are on the `Gene:` lines of QUESTIONS_FOR_GENE.md (Q1–Q14, Q19 answered; Q3 carries the 2022 north correction, Q22 stays open); new open follow-ups Q28 (which house is "staggered"), Q29 (stair foot side), Q30 (joist orientation / depth), Q31 (what each house held); page regenerated: **12 open, 17 answered**. **Work plan: `docs/engineering/RECONCILIATION_2022.md`** — sections (a)–(k) in dependency order (datum → one `mars-2022` reconstruction edit → north / 2023-24 → engine rules → re-pins → takes), ≈ 50–58 worker-hours (estimate), pins/takes each step invalidates. Key findings from aerial-03 + DJI_0829: model ids map quadrant-for-quadrant (chiba = Ba Sing Se, east-house = Cahuilla, kitchen = Chatsubo, west-house = Huaqiangbei); the pinwheel handedness is fixed by flipping `make2022`'s `shift` (3 → ≈ −2), no mirror; stairs fill the end slot with treads parallel to the house (≈ 1 bay × ≈ house depth); 5-trailer train on −X + 4 scattered (9, not 12); 2022 north ≈ world −X turned ≈ 11° toward +Z (DJI_0829 yaw; Gene ≈ 30°). Pictures: `questions/r2022-aerial-annotated.jpg`, `questions/r2022-names-model-vs-photo.jpg` (`questions/tools/reconcile2022.py`).
- **W49 landed** `b772682`, `e62f904` (≈230k tokens, 40 min; merged): answers in the fenced blocks (12 open / 17 answered), Q28–Q31 follow-ups with defaults; `RECONCILIATION_2022.md` (sections a–k, ≈ 50–58 worker-h, 12 h critical path; all seven 2022 pins + the chapter set replaced). Names: Ba Sing Se = `chiba` (up/east), Cahuilla = `east-house` (right/south), Chatsubo = `kitchen` (down/west, no panels), Huaqiangbei = `west-house` (left/north). Findings: no mirror — `make2022` `shift` 3 → ≈ −2 reverses the overlap; stairs ≈ one bay wide, treads parallel, rising to 2.638 m with joists; trailers 5 nose-to-tail + 4 scattered (9, not 12); solar rows: Huaqiangbei 1, Cahuilla 1, Ba Sing Se 3 stepped, Chatsubo 0; 2022 north = −X turned ≈ 11° toward +Z (≈ 8:40 on the render); joists on edge 24 in → deck +8.9 cm, roof framing → +13 cm; ≈ 75 more 16 ft 2x4 per building. Lead review: accepted. Ids stay (`chiba` etc.), display names change.
- W51 spawned (2022 scene, sections a–f + i): names, pinwheel shift, stairs parallel, trailer train, solar south on 45° frames, SW table, per-year north field; 2023/24 trailers out of Chiba + off the walls. W52 (floors/roofs Kit + build rules) after W47 lands; W53 (datum y = 0) after W50 lands.

## 2026-09-28 — W48: set player — shot hold at 64×, leg phase across seams, Direct camera on a chapter, sentences
- **Shot hold** (`chapter-set.ts` `HOLD_S` = 1.5 s, `holdNext`; STUDIO_REPLAY.md "Chapter sets: shot hold, gait across
  seams, Direct camera"):
  - The rule: a chain of displayed shots from the anchor (the last seek or speed change). Shot at d → on screen until
    r = max(planned end, d + 1.5 s × speed). Held past its end, the camera keeps that shot's last pose (the world goes on).
    The next shot is the planned one at r, so shots wholly inside a hold are skipped.
  - Deterministic in (anchor, speed, T), and identical to the planned camera up to 8×. A checkbox "Hold shots ≥ 1.5 s"
    is on by default. A hold may run ≤ 1.5 wall-s into the next chapter on the previous chapter's last pose.
  - **64× for 60 s wall** (from 384 set-s before A → D0): **89 → 41 shots**, mean on screen **0.67 → 1.50 s**, min
    0.17 → 1.47 s (p10 0.20 → 1.47, max 1.43 → 1.57). The shots on screen equal the rule's chain, which the spec
    recomputes from the files.
  - Wall times depend on the frame rate, so the spec also reports the load-independent set-s ÷ 64. Under load (4 fps in
    one run) held shots stretched to 8 wall-s; the nominal mean stayed at 1.50 s.
- **Leg phase across seams** (`take-walk.ts` `walkTotals`, `TakePeople.setTake(take, walkOffsets)`, the worker posts
  per-chapter `walked`):
  - Each walker's metres are carried from the chapters before, so the Walk phase continues. The clock holds after a jump
    until the earlier chapters' totals are known (≈ 3 s after opening, from the worker).
  - At each seam, every person on the last frame of k − 1 vs the first of k: **A → D0 max jump 0.447 → 0; D0 → D1 0.471
    → 0** (6 people each; m2 / m4 walking; metres equal to the mm).
- **Direct camera for a set:**
  - The panel sits under the set transport and acts on the chapter on screen. "Direct camera · chapter D2" plus a note
    saying what compiles against D2's take (its own times), what plays while D2 is on screen, and what Save track adds
    to `year-build-2022-east-house-ab-d2.json`.
  - Tested: a medium hold on m1 at the D2 relay (local 2728.8 s, 20 s) → 1 shot, readability 1, simulated valid → Play
    ("Directed (D2): …"; other chapters keep their own camera) → Save = D2's shipped file byte-for-byte + `cameras`.
  - `directCamera` took 5.6 s on the main thread for that chapter take.
- **Sentences** (lead addition, on Codex's `parse.ts`, not edited): a "Say it" box in the Direct panel. `parseSentences`
  → all-or-nothing append to the JSON list; refusals are shown with the parser's question, candidates and the marked
  words.
  - Gene's four sentences give CAMERA_DIRECT.md §1's objects: three appended, "look at this crowd …" refused
    (`camera.parse.deictic`, "Which activity are the people doing?").
  - "pan across the shed" shows candidates region / assembly / entity; "… then …" appends two.
  - The 270° rack-bay orbit sentence → Compute (139 ms, readability min 0.63 / mean 0.96, simulated valid) → Play.
  - Against the flagship the compiler (not the parser) refuses the sunset pan (sun 19.1° up at 16:00) and the kitchen
    (no `kitchen-interior` in 2026). **No parser failures to report to Codex.**
- **Specs:** studio-build 11/11 (3 new: hold, seams, Direct in D2), studio-direct 2/2, studio-direct-sentences 1/1
  (new file), studio-take 1/1; tsc clean.
- **Captures looked at:** `studio-build-set-hold-held.png` (D0, 16 set-s into a hold, m1 still in frame at the left
  edge), `studio-build-set-direct-{panel,hold}.png`, `studio-direct-sentences-{refused,orbit}.png`.
- **Weak spots:**
  - Hold tails are locked off, so workers can leave the frame (≤ 84 set-s at 64×; seen in a capture: one of two
    carriers gone 12 set-s into a hold).
  - The Walk *weight* still steps at a seam: the ±0.15 s speed window is clamped at each take's edge (m2 0 → 0.96).
  - Single takes have no hold.
  - Direct compile blocks the page for ≈ 6 s on a chapter take.
  - No Camera picker for sets.
  - The parser gets no world vocabulary; names are checked by the compiler.
- **W48 landed** `40002d0`, `1c090b7` (≈250k tokens, 41 min; merged): shot hold ≥ 1.5 s on screen (deterministic chain from the anchor; 64×/60 s: 89 shots @0.67 s → 41 @1.50 s; toggle), walked metres carried across chapter seams (`take-walk.ts`; leg-phase jump 0.45 → 0 at A→D0 and D0→D1), Direct camera on the chapter on screen (label + Save into that chapter's file), "Say it" sentence box on Codex's `parse.ts` (Gene's four: three compile, "this crowd…" refused `camera.parse.deictic` with a question). 15/15 studio specs. Lead review: accepted. Weak: locked-off holds can lose their people; walk weight steps at a seam; `directCamera` on a chapter take freezes the page ≈ 6 s (to profile); single takes get no hold.

- **W50 render follow-ups** (branch `w50-render-followups`, worktree `scratchpad/w50-wt`, port 5681): the two Codex
  hand-offs. `components.ts` `build()` routes `panel-rail` → `solarRailMesh()` (C-channel); `panel()` takes the entity
  and adds `solarTiltLegs()` only for an installed module with non-zero pitch/roll (two plumb risers under the high
  edge, span × sin(tilt); view rebuilds on that mount key), carried/flat panels get none; upright comment fixed.
  `kit.ts` rack posts import `RACK_FRAME_GREEN` (palette.ts) instead of `#293c45`. Baselines (all inspected): new
  `render-polish-tilt-legs`, refreshed `render-polish-mounted-panel` + 9 post-recolour views (studio-2021-default /
  -classroom-eye / -corridor-aluminet, studio-2022/2023/2024/2025-default, studio-2024-solarium-door,
  lab-year-2022-top-prisms; each under the 0.2 pixelmatch threshold, 0.2–1.1 % raw, every changed pixel greener).
  Specs: render-polish, solar-paint, lab-years, studio-years 29/29; year-build, studio-build, build-bay, poses 41 pass +
  1 skip (studio-build "chapter set at 64×" failed once under the parallel load, passed 3/3 alone). Open: the
  pre-existing Codex drift in poses/build-bay/solar-paint/year-build baselines (the same 0.03–1.24 % its REPORT lists)
  is still unrefreshed; `scenes.ts:113` still draws the 2021 central upright `#293c45` (W47/W46 area); the Lab
  `solar-paint` pv2 is rolled 20° with its x ∥ the rails and its origin unlifted, so its low edge sinks 0.34 m into
  the ground (the engine's `tiltedPose` would pitch it and lift it span/2·sin); `app/lab/solar-paint.ts` header and
  description still say textures are hashed stripes.
- **W50 landed** `4999421`, `cb671fa`, `8ef5e39` (≈80k tokens, 40 min; merged): `panel-rail` → `solarRailMesh()`, `solarTiltLegs()` only for installed tilted modules (plumb legs under the high edge, span·sin(tilt)), `mount` view key; Kit posts use `RACK_FRAME_GREEN` from `palette.ts` (9 studio/lab baselines inspected + refreshed). 29/29 specs. Lead review: accepted. Notes: the stale stripes text is in `app/lab/solar-paint.ts` (Claude-owned lab file, not Codex's) lines 4–5/79; `scenes.ts:113` 2021 central upright still `#293c45`; lab pv2 rolled about the wrong axis, low edge 0.34 m in the ground (lab scenario fix). → fold into W53.
- W54 spawned (engine camera perf, output-identical): `directCamera` on a chapter take takes ≈ 5.6 s on the main thread (D2: 5 367 s, 220 entities).

## 2026-09-29 ~20:40 EDT — Gene: content parked, last-mile goal
- Decisions recorded in OWNER_DECISIONS.md. W47/W51 told to land at their next green checkpoint with a full gate and stop; W52/W53 cancelled before start. W55 spawned: `LAST_MILE.md` inventory. W56 (HISTORICAL_CONTENT.md + banners) after W47/W51 land. Merge protocol from now: the worker runs a full `npm run gate` on its rebased branch and reports the table; the lead merges only green.

## 2026-09-29 — W55 LAST_MILE inventory (docs only)
- `docs/engineering/LAST_MILE.md`: 216 deduped items from HANDOFF, EVIDENCE, PROGRESS W1–W54, REVIEW, the 24 area docs, the Codex REPORTs, SPEC (144 requirements) and OWNER_FEEDBACK §1–§15 (81), plus the lint output, skip markers and the integration-vs-registry check. Each item has a source, category, proposal, effort, pin impact, dependencies and a "fixed means" test.
- Counts: 188 fix (controller 21, engine 68, simulation 37, renderer 30, tooling 22, evidence 10), 16 re-classify: content, 12 re-classify: out-of-scope (SPEC §32/§22/§8). About 400 worker-hours of fixes. 49 rows certainly move pins and 60 might, to be batched into one re-pin window. 126 briefs of 1–3 h in 17 file-ownership lanes (A–X; X = Codex).
- Findings:
  - Lint is **123** (not 114) and is still not a gate step.
  - Integration never calls `engine_direct_camera`, and the gate runs integration only with `SIM_BASE`.
  - EVIDENCE.md is stale at `d91057b` (5 new test files and 90 tests unmapped; the phase-B row is PARTIAL although `PIN_FULL_AB` is set).
  - REVIEW L1–L5 and L7–L9 are still open in code.
  - `setpart.ts:241` erasing-op; `core/math.ts:209,298` lose precision.
  - Three W50 follow-ups were orphaned by the W53 cancel (LM-143).
- Needs a ruling (LAST_MILE §9): party/dance (SP §30 H) vs "no new features"; ladders, dismantling, cherry-pick, API visual capture and the Studio-editor unification (proposed out-of-scope or de-scope); whether the other 2022 houses' todo tests are content.
- **W55 landed** `6722b5e` (≈1.5 M tokens incl. six reader subagents — expensive; 75 min): LAST_MILE.md 216 items (188 fix ≈ 400 h; 16 content; 12 out-of-scope), 49 certain + 60 maybe pin-movers, 126 briefs in 17 lanes; findings: lint 123, `engine_direct_camera` never called by integration, EVIDENCE stale (90 tests unmapped), 8 skip/todo, REVIEW L1–L5/L7–L9 open, `setpart.ts:241` erasing op, `core/math.ts:209/298` precision. Lead rulings + waves in LAST_MILE §13. Wave 1 spawned: W57 (T4 lint engine → 0 + LM-011), W58 (controller lane A).

## 2026-09-29 ~22:40 EDT — Handoff procedure (Gene: transfer to Codex in ~1 h)
- All running workers (W47, W51, W54, W57, W58) told to land at their next green checkpoint with an explicit "Next step" per unfinished item, full gate, then stop; no new workers. Then: docs refresh (HISTORICAL_CONTENT.md + banners, HANDOFF, NEXT_SESSION_PROMPT, LAST_MILE statuses) and the handoff prompt `docs/engineering/HANDOFF_PROMPT_ENGINE.md` for the next agent (engine / simulation / controller / app only; historical content is a separate agent's job).
- **W54 (engine camera perf, output-identical)** on `w54-direct-perf`: `directCamera` on the W48 D2 hold 7.3 s → 0.25–0.35 s
  warm in node (studio saw 5.6 s), flagship 270° bay orbit 0.32–0.40 → 0.16–0.21 s. Cause: the 2728.8 s lead-in hold
  sampled all 220 entities × 27 288 ticks for readability that never reads them. `plan.ts` skips the sampler for
  subject-less windows and reuses one candidate row for a subject-less `fixed` window; `geom.ts` candidates dedupe by
  generation stamp. New `camera-direct-identity.test.ts` (17 CAMERA_DIRECT fixtures + the D2 hold, sha256 of the full
  result JSON vs the pre-W54 golden): identical; `--all --full --check` and chapters `--check` OK. Phase table + what
  is left: CAMERA_DIRECT.md §9.
- **W54 landed** `7e4fe7c`…`800ad5c` (≈330k tokens, 2 h 20 incl. waits; merged): `directCamera` D2 hold 7.3–7.8 s → 0.25–0.35 s, flagship orbit 0.36 → 0.19 s — the subject-less lead-in hold sampled all 220 entities at every tick (29 713 sampler calls → 2 424); per-solid stamps in `CameraWorld.candidates`; `camera-direct-identity.test.ts` (17 cases, sha256 golden) + `--check` OK on all takes. Gate on its branch: unit 73, engine 404/0/6, tsc; e2e 78 pass + 1 wall-clock frame bound (266 ms > 250 under load 44–53) + 6 unreached by the 20-min timeout — all pass on re-run; probe = pin by hand. Lead review: accepted; single-run gate deferred to the consolidated handoff gate. Next steps in CAMERA_DIRECT §9 (sampler-call-count test, worker, faster sha256 in core/hash, subject-only centring).
- **W58 (controller lane A, branch `w58-controller`)** — LM-001 auto rebind (`rebind:'auto'`, `plan.rebound`, `plan.rebind-failed`), LM-003 region layout in `physicalView` (hash only when present: pins unchanged), LM-004 region-scoped staleness (`rehearsal/envelope.ts`: per-step route/footprint envelope from a baseline run; `affected[]`, `outsideEnvelope`), LM-005 parked vehicles over `edit_world` (`edit.vehicle-ridden`), LM-007/008 `engine_parse_camera` + `engine_direct_camera { sentences }` with a SemanticWorld vocab + rack alias table (`api/camera-vocab.ts`), LM-013 `engine_store_camera_track` (per-take camera byte cap), LM-014 legacy tools classified + one refusal envelope (`simulation/legacy.ts`; routing needs LM-202), LM-016 step `timeout` + `mark`/`cancel` built-ins, LM-017 `take.evicted`. Partial: LM-010 (op-level tests only; the Codex contract remains), LM-014 (classification, not routing). Not done: LM-009 (frozen `cameraDirectionSchema`; request logged in CODEX.md §7). New tool names for W57's integration: `engine_parse_camera`, `engine_store_camera_track`. perf-walk 5/5 PIN-OK after every commit.
- **W58 landed** `ecce5f4`, `7618cd1`, `c79f999`, `1b3b0b1`, `e712963` (≈330k tokens, 2.5 h; merged): LM-003/004 region-scoped staleness (`rehearsal/envelope.ts` per-step route/footprint envelopes; `plan.stale` lists `affected: [{step, causes}]`; far edits keep the plan), LM-001 `rebind: 'auto' | 'refuse'` on execute/rehearse (`plan.rebound` event, `plan.rebind-failed`), LM-013 `engine_store_camera_track` (4 MiB per take by bytes; 4 refusal codes), LM-005 parked vehicles movable (`edit.vehicle-ridden`), LM-007/008 `engine_parse_camera` + `sentences[]` on direct_camera with an alias table (`api/camera-vocab.ts`), LM-016 step `timeout` + `mark`/`cancel` steps, LM-017 `take.evicted`, LM-014 partial (20 legacy tools classified: 8 with engine equivalents, 12 viewer-only with reasons; one refusal envelope `legacy.command-failed`), LM-010 partial (op-level refusals tested; fixture contract = Codex), LM-009 blocked (frozen schema → CODEX §7). 5 pins unchanged. Gate: unit 73, engine 418/0/6, tsc, probe = pin; e2e 81 pass + the same load-only 250 ms frame bound + 3 unreached — all pass on re-run. Lead review: accepted. For the next agent: integration calls for `engine_parse_camera` / `engine_store_camera_track` / a `legacy.command-failed` assertion (W57 lane).
## 2026-09-29 — W47: checkpoint 1b (all four 2022 houses, as far as green)
- Branch `w47-houses-green` (rebased on `78cd157`). Landed at the lead's next green checkpoint: the joint yard-v2 /
  2022-seating re-pin and the per-house chapter takes were skipped (content parked). East-house stays on yard v1 and
  2022 in `SEAT_HELD_YEARS`. YEAR_BUILD.md "Checkpoint 1b" has the per-house table, rules 12–23 and the next steps.
- **Chiba A+B green end to end, pinned `0ee1da11…` @ 564 548** (7.8 h simulated, 0 violations, 66 + 133 parts at target).
  West-house now passes all three decks, the stringers, the treads and the posts, and stops in S at `carry.gather-stuck`:
  two carriers meet head-on in a pile's take-out strip. Kitchen passes all six stringers, then waits without end at a
  tread carry blocked by an idle crew member with no room to step aside. Both are `todo` with the refusal named; the
  kitchen run is cut at 340 000 ticks.
- W38's D1 refusal on chiba / west-house was not about frame planes. On those houses the second strip's middle piece
  goes in from −u (rule 8), so its receiver would walk alongside over the first strip's unlaid middle, and the bystander
  was sent to an unlaid aisle. Fix: those levels start at line 0 (rule 12). Other general rules: the step-back spot is
  on laid deck; a mutual single-file wait is released after 3 s (walk.ts, shared, additive, every walker pin unchanged);
  idle crew park clear of the stair zone and carry corridors; the set-part crew asks an idle person off the part's place
  (setpart.ts, additive); stringer lay-down after a −lat neighbour, order after a shifted one, and end margin; stair
  parts by where they are (grips, lower end, side by lat); a tread-board lying-spot search; the far end for the roof
  crews; the solar side nearer the panels.
- **No pin moved.** East-house's plans are byte-identical. The corridor part of the parking rule (verified: east green at
  `2cd6af11…` @ 600 204; it gets kitchen one step further) would move east's A+B pin, which the shipped chapter set and
  studio-build.spec assert. It is held back for the lead (YEAR_BUILD.md "Next step").
- Gate on `eb14de2` (with that re-pin): test, test-engine and tsc pass. e2e hit the gate's 20 min step timeout after
  about 60 of 85 specs, with 2 failures: studio-build "final A+B checks" (the re-pin, now reverted) and "chapter set at
  64×" (load-flaky, W50). A full gate did not fit the hand-over window.
- Shared files touched additively: `locomotion/walk.ts` (yield table in `services.walkYields`, release after 3 s),
  `construction/setpart.ts` (site rule), `campus/sequence.ts` (`standFree` ctx hook).
## 2026-09-29 evening — W51: 2022 reconciliation + 2023/24 trailers (reconstruction edits), per-year north
- **Landed** (branch `w51-2022-scene`, rebased on `78cd157`): RECONCILIATION_2022 §a, §b-Kit, §c, §d-Kit, §e, §f, §i as one
  re-seed per year (its banner has the per-section status, "Content is parked"). 2022: names Ba Sing Se / Cahuilla /
  Chatsubo / Huaqiangbei on the kept ids (no "Chiba" in 2022, studio button included); `shift` 3 → −2 (clockwise);
  parallel stairs (12 × 3.54 m treads, 13 risers from the sand, landing at the deck over the outer frame bay; Q29 default,
  Q32 new); south-facing 45° solar rows on triangle frames (10 / 10 / 3 × 3 / none; Q28 default); no corner table; 9
  trailers from aerial-03 (train of 5 on −X), rv-10…12 gone. 2023 / 2024: `ring()` keeps out of Chiba (Q2 done).
  North: `YEAR_NORTH_AZIMUTH_OFFSET {2022: −101}` (DJI_0829; W51's own picks 95–103°, mean 100.4°), carried by the year
  file and `scene.meta`, used by the camera (sun, sun-behind, compass side) and the studio sky; global −90 fallback.
- **Ids:** 2022 999 / 1204 kept, stair + solar entries aliased by role, 47 → null; 2023 / 2024 all kept. contentHash
  2022 8b88e6f0… → f8090a99…, 2023 8e401abb… → 883e6371…, 2024 832e8d9a… → bd2e0c79….
- **Moved as planned (parked, not re-pinned):** 2022 year-build engine pins → `todo` "2022 reconciliation W51; re-pin by
  W52" with old hashes in the tests (251a44c5, d382e461, 94db263e, ddb634d6, 940e9f64, 4862adfc, b4c42210; also the
  phase-A / A+B plans, sections, report tables, year-stock BOM). e2e consumers of the recorded 2022 takes →
  `test.fixme(W51_FIXME)` (studio-build watch ×3, lab "Oblique yard", year-build first bay + whole house). Causes besides
  the moved neighbours: Cahuilla's beam staging end falls in Ba Sing Se (W38 rule 3, 9 beams), the stair template (no
  stringer rule → no Kit stair link), tilted modules read as 1.18 m panels. perf-walk 5 pins PIN-OK.
- **Baselines refreshed after looking:** studio 2022 (default, plan, courtyard), 2023 (default, plan), 2024 (default,
  plan, front-eye, frontage, kitchen-eye, solarium, solarium-door), lab-year-2022/2024-top-prisms, render-polish
  green-frame (the upright's surroundings moved). Lab 2022 walkabout: the SW corner is no longer known-blocked.
- **Honest comparison with aerial-03:** handedness, stair ends, stair orientation, panel rows and Chatsubo bare match;
  the train follows the photo's arc (positions ±1.5 m); the model courtyard reads ~1–2 m tighter than the photo (radius
  8.6 unchanged), so each corner passage is 1.0 m (photo ≈ 2 m); Cahuilla's short second group is left out (Q28).

## 2026-09-29 — W57: T4 lint engine/deploy/simulation → 0 (hash-identical) + LM-011 (branch `w57-lint-zero`)
- Lint 123 → 25 on the branch: engine 69 → 1, engine/test 22 → 3, deploy 14 → 5, simulation 2 → 0, app 16 → 16 (lanes R/S). The 9 left in my lanes are all Codex-owned: `camera/parse.ts:148`, `core.test.ts` ×3, `group-2026-frames*` ×5. Pins: perf-walk 5 PIN-OK and the suite after every batch; `YEAR_BUILD_FULL=1` 6/6 (A+B `ddb634d6`, bay-1 `251a44c5`, skeleton `d382e461`, B bay+strip `94db263e`).
- Mechanical only. Default sorts go through `core/order.ts` `defaultSortOrder`, the exact no-comparator order (`[key, obj]` tuples sort by their joined string, not by key). Spreads that snapshot a collection the loop mutates became `Array.from`. `ActionDef` defaults are now `unknown`. Runtime `services` is one documented `RuntimeServices` seam with an inline allowlist. Allowlisted inline with reasons: unbound-method probes (3 tests + perf-walk), the gate's ANSI regex.
- LM-072 `setpart.ts:241`: the `* 0` term was a dead store (`Up.p` is overwritten before any read); removed, hash-neutral. LM-073 `core/math.ts`: the fdlibm literals were rewritten at double precision and parse to the same doubles. Neither needs a re-pin.
- LM-011 / LM-015: integration and the director demo check the MCP listing against `engineTools()`. Integration fails on any registered tool that is never called. `engine_direct_camera` is called for real with a recorded self-correction, and both scripts PASS against a local wrangler dev. Open: the sentence step (LM-007) and a gate that auto-starts wrangler.
- Gate on the rebased branch (base `a0c347e`): report `viewer/.cloudflare/gate/2026-09-28T22-03-34-850Z/`. It shows test 73/73, test-engine 403 pass / 0 fail / 6 skip, and tsc clean. The run was then killed during e2e (57/85, 0 failed at that point) by the session watchdog. I re-ran the missing steps by hand: e2e 83 passed / 2 skipped / 0 failed (15.9 min, `E2E_RUN=w57-2`), determinism-probe `b746b094` (pin), simulation-integration PASS and director-demo PASS against a local wrangler dev.
- **W47 landed** `eb14de2`, `ff47a24` (≈500k tokens, 2 h; merged `531834e`): chiba A+B green end to end, pinned `0ee1da11…` @564548 (66/66 + 133/133 phase-B parts ≤ 0.25 mm; unplaced fixtures 16 / solar 14 / stair 5 / walls 5); west-house `todo` at `s1328-carry` `carry.gather-stuck` (110/136 phase-B parts), kitchen `todo` at `s0995-carry` (idle crew nudged onto the stair foot); rules 12–23 (upper-deck start end, step-back spot, walk.ts deadlock release ≥ 3 s, idle-crew parking, set-part step-aside, stringer ordering, stair parts by position, tread lying spot, far-end climbing, solar side); east-house pins + plan byte-identical (yard v1; rule 15's corridor part held back — it would move east's A+B pin to 2cd6af11 @600204). Lead review: accepted; content parked after this.
- **W51 landed** `d2aafe3`, `54315f3` (≈420k tokens, 3.5 h; merged `2a99adb`): 2022 reconciliation a–f + i — names Ba Sing Se / Cahuilla / Chatsubo / Huaqiangbei on kept ids, pinwheel `shift` 3 → −2 (clockwise), stairs parallel (12 treads × 3.54 m, landing at 2.49 m — Q32), trailers rv-1…9 (train of five + four scattered; rv-10…12 null; ≥ 3.4 m from houses), corner table removed, solar at 45° on triangle frames with the low edge on the south roof edge (rows 10/10/3×3/0), per-year `northAzimuthOffset` (2022 = −101 from DJI_0829 yaw; year file → `scene.meta` → sun/camera/studio sky), 2023/24 trailers out of Chiba (walls ≥ 3.45 m); ids 2022 999/1204 kept (47 null), 2023/2024 all kept; every 2022 year-build pin → `todo` with old hashes; 6 e2e replays of the 2022 takes `fixme`. Not delivered (parked): the stair link (old engine stair rule refuses the new template), tilted modules read as flat panels, g/h floors-roofs, j datum. 5 perf-walk pins unchanged. Lead review: accepted as the content checkpoint. "Content is parked" banner + per-section status in RECONCILIATION_2022.md.
- **W57 landed** 11 commits `67c4698`…(≈1 M tokens, 4 h; merged `ebc8cc3`, `sequence-b.ts` conflict resolved keeping W47's stringer ordering): lint 123 → 25 (engine 69 → 1, tests 22 → 3, deploy 14 → 5, simulation 2 → 0; the 25 = 9 Codex-owned + 16 `app/**` for lanes R/S); `core/order.ts` `defaultSortOrder` keeps every sort bit-identical; LM-072 `setpart.ts:241` `* 0` was a dead value (overwritten two lines later) — removed, hash-neutral; LM-073 fdlibm literals rewritten at double precision (`Object.is`-equal); LM-011: integration asserts the engine tool list from the registry, fails if any tool is never called, directs a real self-corrected orbit in the room; director demo step 5b; both PASS vs local wrangler dev. Pins unchanged incl. `YEAR_BUILD_FULL=1` 6/6 (pre-W51). Lead review: accepted.
- Lead: consolidated head `1a0b458` — the W54 identity test's D2 chapter case now runs only while the take's recorded base equals the current scene (W51 re-seeded 2022; content parked) — engine 433 tests / 416 pass / 0 fail / 6 skip / 11 todo; tsc clean; 5 pins OK. Consolidated full gate running in `scratchpad/final-gate-wt` (`E2E_RUN=final-gate`); W56 writing HISTORICAL_CONTENT.md + banners + HANDOFF/NEXT_SESSION_PROMPT/LAST_MILE status.
- **Consolidated gate GREEN at `1a0b458`** (single run, worktree `final-gate-wt`, report `.cloudflare/gate/2026-09-28T23-33-14-786Z`): unit pass 0.9 s · engine pass 42.6 s · tsc pass · e2e pass 860.7 s · determinism probe pass. Release 8 → W59.

## 2026-09-29 — W56: handoff docs (HISTORICAL_CONTENT.md, "content is parked" banners, HANDOFF, NEXT_SESSION_PROMPT, LAST_MILE status)
- New `docs/engineering/HISTORICAL_CONTENT.md` for the content agent. It covers, per year 2020–2026:
  - scene source, contentHash, north (2022 −101, every other year the global −90), pins, and manifest takes;
  - all 2022 takes and the chapter set `8ce33bee…` are stale against W51's scene; 11 2022 tests are `todo`, and five
    e2e sites are `W51_FIXME`;
  - the 2022 reconciliation status (a/c/e/f/i done; b/d Kit only, with the engine stair rule refusing the new stair
    link and tilted modules read as flat 1.18 m panels; g/h/j not started) and the four houses' state;
  - what each year needs from Gene (open Q20–Q32 by year), the exact re-run recipe, and the engine / content boundary.
- "Content is parked" banners at the top of RECONCILIATION_2022.md (W51's, now pointing here), YEAR_BUILD.md and
  NEXT_SESSION_PROMPT.md.
- NEXT_SESSION_PROMPT is now a pointer: the engine agent uses HANDOFF_PROMPT_ENGINE.md and the content agent uses
  HISTORICAL_CONTENT.md. The usage rules are kept.
- HANDOFF.md has a new top section, "Handoff 2026-09-29 — engine tranche": the lanes since release 7 with commit ids,
  head `1a0b458`, and the consolidated gate table from `report.json`. "Known shortcomings" is now only a LAST_MILE
  pointer.
- LAST_MILE.md: "Status at handoff" at the end, plus a one-line pointer in §11. Counts: 13 fixed, 8 partial,
  1 blocked, 36 re-classified, 167 fix rows remaining.
- Found while reading, not fixed (docs-only worker):
  - `year-build-houses.test.ts`: chiba's full A+B test is not `todo` and still asserts `0ee1da11…`, which was pinned
    on the pre-W51 scene. It is likely red under `YEAR_BUILD_FULL=1` (not run). Its `FULL_RED` doc comment says
    "chiba and west-house green … pinned", but only chiba is.
  - PLANNING_BUDGET.md has no W51 entry for the 2022 pins that are now `todo`.
  - LAST_MILE §1 rows LM-007…LM-017 are duplicated at lines 75–89, and two LM-012 copies still say "in flight".
  - The consolidated gate's `report.json` records `gitDirty: true`.

## 2026-09-28 — release 8: `1a0b458` to production (`79d424e3`), rollback `f709304d`
- Deployed the consolidated-gate head `1a0b458` from `final-gate-wt` (gate not re-run; report
  `.cloudflare/gate/2026-09-28T23-33-14-786Z`, `ok: true`). Live `79d424e3-a243-49ad-8b38-89f016673375` (23:51:36Z);
  rollback target `f709304d-fc55-45f2-a44b-200cfadf4ae1` (release 7, confirmed 100% before the deploy). Not in it: `bc9909e`, `7e799b3`, `5f3bc9b`, `11d1dbd`, `e87f732` (docs only) and `df0ef7f` (docs + one test line: chiba full A+B `todo`; no shipped code). Build 340 files / 821.1 MiB, 0 R2 uploads, 56 new assets, startup 91 ms.
- Green: every route 200 incl. `/studio/2022`, `/studio/2024`, `/questions/` (21/21 images, screenshot reviewed);
  manifest + 11 take files; R2 GLB; `smoke.mjs ALL_ASSETS=1`; director demo 9/9 (7.9 s); headless `/lab` 43/43, 0
  violations, hash `b746b094…` = probe; `/studio` flagship "held" = recorded = manifest `c56ea8da…`; `/studio/2024` front
  eye shows the red Chiba front (screenshot reviewed).
- **Red (reported, not patched):**
  - `simulation-integration.mjs:459` expects a plan bound before an edit to be `plan.stale`; production (W58's
    region-scoped staleness, `ecce5f4`) executes it because the edit is in another region. The registry tool list
    (16 engine tools) and the directed camera passed before it; the pause/resume, isolation and limits sections were not
    reached. A scratch run with that one assert skipped was blocked by the permission classifier, so it was not done.
  - `npm run evidence` exits 1: `evidence-map.json` cites the old `core.test.ts` transcendentals title (moved to
    `source-scan.test.ts` in `05787d2`); capabilities 25 / 2 / 1, milestones 7 / 1 / 0 (rows 17/17 PROVEN; 433 tests,
    416 pass / 0 fail / 17 skip). Committed as generated.
  - `/studio/2022` chapter set: plays to the end, continuity 7/7 ✓, final `ddb634d6…` = A+B pin ✓, but "✗ 0 frames +
    beams + 0 parts at the mars-2022 canonical pose (of 57 + 115, max 5082.94 mm)": the pre-W51 take against the
    reconciled scene (content parked). The new 2022 scene (another house, trailers, "Ba Sing Se") shows around it.
- Record: `RELEASE_CHECKLIST.md` "Production deploy 8"; HANDOFF "Deployment status"; `deployment.json`.
- **W59 landed** `9bd481c` (≈140k tokens, 25 min): **Release 8 live** — production `79d424e3-a243-49ad-8b38-89f016673375` from gated head `1a0b458`; rollback `f709304d…` (release 7; command in RELEASE_CHECKLIST "Production deploy 8"). Smoke: all routes incl. `/questions/` (page + 21 images inspected) 200; manifest + 11 takes 200; R2; ALL_ASSETS 340; director 9/9; prod `/lab` 43/43 hash = probe; `/studio` flagship replay hash = recorded; `/studio/2022` chapter set plays to the end (continuity 7/7, final = A+B pin) inside the new 2022 scene — its canonical-pose check ✗ (take predates W51; content parked, expected); `/studio/2024` new Chiba front inspected. Lead fixes after the release: `simulation-integration.mjs` staleness case updated for region-scoped staleness (a far edit no longer stales — the near case lives in api.test.ts) + calls for the two W58 ops (`engine_store_camera_track` idempotent / take-mismatch refusal, `engine_parse_camera` deictic refusal; camera count 3) → 3/3 PASS against production (16 engine tools, all called); `evidence-map.json` cites `source-scan.test.ts` → evidence 17/17 rows, 26/1/1 capabilities, 8/8 milestones. Docs-only commits after the gated head: `bc9909e`…`e87f732` + `df0ef7f` (chiba full test `todo`).
- **Handoff complete (lead, 2026-09-30 ~00:30 EDT).** Next agent: `HANDOFF_PROMPT_ENGINE.md`; content agent: `HISTORICAL_CONTENT.md`. LAST_MILE at handoff: 13 fixed, 8 partial, 1 blocked, 167 remaining fix rows; 17 content, 18 out-of-scope, 1 struck.

## 2026-09-29 — Astra medium technical takeover, wave1 integration candidate

Baseline main28683cb full gate GREEN: unit77; engine416pass/0fail/6skip/11TODO; tsc; browser78pass/7skip; probe b746b094… . Report `.cloudflare/gate/2026-09-29T00-33-59-072Z`. Main stays unchanged pending the complete integrated gate.

W60–W63 plus lead: byte-safe storage/caps/admission, static fork edits, reconstructed2026 canonical rooms, fixture camera subjects, Studio shared vocabulary, one domain-aware control registry, all-tool MCP + director sentences, lint zero/mandatory gate, gate proof ingestion and flagship recording check. LM005 follow-up fixes actual vehicle-through-fork-load placement. Reports: `briefs/wave1-integration.REPORT.md` and linked worker reports. Candidate counts26fixed/36re-classified/154remaining; no pins moved. Existing content skips stay parked. No historical values touched; excluded photographic-corrections.ts only let→const mechanics.

Quota tally: account weekly meter36%→40%; API supplies no5hour window, so5hour≤50% compliance is unobservable, not asserted. Maximum3parallel helpers. Initial simultaneous full-suite runs caused timing-only failures; serialized combined suite430/0 and original thresholds preserved. Heavy validations are now serialized. Approximate worker token/time estimates live in reports; no remote/push/deployment yet.


Wave1 batching follow-up: LM022 climb-face reservations, LM152 deterministic work budgets, LM012 cancellable camera worker completed focused tests while gate was early in browser stage. Combined candidate28fixed/36re-classified/152remaining. Gate9923eb5 engine438/0, unit91, tsc/lint clean; interrupted to batch follow-ups and avoid two18minute browser runs. Cleanup exposed double-kill EPERM/orphan Vite; repair required before restarting. Explicit unchanged perf thresholds now release-checklisted; no pins moved. Weekly meter43% (start36%);5hour window still unavailable.

Wave1 adversarial follow-up: spawn now rejects effective static obstacle/surface/link IDs with `edit.id-taken`, matching static_add in both batch orders. Refused batches leave the head unchanged; removed static IDs remain reusable. Focused static-edit 6/0, lint/tsc clean; report `briefs/edit-id-namespace.REPORT.md`. No pins or historical values changed; integrated gate remains lead-owned.

## 2026-09-29 — release 9: wave 1 foundations merged and verified

Merged clean `8decb07` after the full gate passed (`viewer/.cloudflare/gate/2026-09-29T01-28-33-861Z/report.json`): lint zero, unit 93/0, engine 447/0 with 6 skips and 11 TODOs, TypeScript clean, browser 82 passed / 7 skipped, byte-identical flagship recording, unchanged `b746b094…` probe, and all 36 tools exercised by local MCP integration. The idle performance benchmark retains its original thresholds and outcomes. Evidence regenerated on the same main head: all 17 rows and 8 milestones PROVEN; capabilities 25/2/1 retain the parked historical exceptions. LAST_MILE: 28 fixed / 36 reclassified / 152 remaining, 15 more fixed than the handoff. No pins or historical values moved.

Release 9 `15c50c30-2e8e-4de5-a862-483abc1a9e47` is live at 100%; rollback is release 8 `79d424e3-a243-49ad-8b38-89f016673375`. Production smoke checked 340 assets. All-tool MCP integration, director demo, two Studio browser tests, and the Lab's 43 steps passed with zero violations. The browser hash matches the Node probe. Three production captures were personally inspected. Full record: RELEASE_CHECKLIST, Production deploy 9. The subsequent documentation/metadata commit records this gated and deployed source; it is not another source rollout.

Quota tally through this milestone: weekly usage 36% → 50%. The API exposes only a 10,080-minute window and no five-hour meter, so compliance with the requested five-hour ceiling cannot be measured or asserted. User clarification remains pending. At most three helpers ran in parallel; broad engine/gate runs were serialized. Follow-on work covers combined camera correction and moving-body safety, staged deadlock recovery, and safe construction cancellation. None is counted fixed before integrated proof.
Wave2 LM038 candidate: five per-verb cancellation regressions cover beam/joist/plywood/tread airborne installation and the stair flight's existing ground-level carried translation. Successful pre-lift cancellation controls, repeated unsafe refusal with exact world and reservation retention, competing-walk refusal, supported completion and released crew; construction/progressive/source-scan30/0 (0skip/0TODO), lint/tsc clean. Test-only; no mechanics/outcome/pin/historical changes. Report `briefs/install-cancel.REPORT.md`; ≈15min/7k worker tokens, integrated gate lead-owned.
Wave2 D1 worker — LM036 controlled raise cancellation (`codex/raise-cancel`, base8decb07): recorded physical choreography reverses at fixed-tick speed with holders/support/resources retained; full-path preflight plus per-segment static/bystander/floor checks refuse or block safely. Bounded trail1024 (actual maximum282frames/150966bytes); only lowering snapshot restore verified (111242bytes). Normal16catalog/crew world/event/take outcomes identical,0violations, no pins. Focused suite42/0 before final small additions; final11lowering cases +1fixture resolution case pass, lint/tsc clean;2isolated browser cases pass and3images inspected. Explicit unlisted hypothetical proof fixture preserves standard probe enumeration; cluttered build-bay refusal retained. Report/captures: `briefs/raise-cancel.REPORT.md`, `raise-cancel-proof/index.html`. ~35k tokens/65min incremental worker estimate,0helpers; lead owns integrated gate/deploy.

Wave2 integration review: accepted LM038 tests, staged LM024 detection/recovery and LM036 lowering into the isolated integration checkout. Combined focused checks67/0 (0skip/0TODO,10.3s). Lead inspected all three lowering captures. Independent review found carried non-human collision omission and explicit cancel-reason snapshot divergence; follow-ups required before full gate/merge. Evidence map now references actual cancellation and conservative deadlock proofs rather than obsolete unsupported-cancel claims. Counts remain28/36/152; no pins changed.
LM036 independent review follow-up: lowering now checks current carried/raising nonhuman and vehicle envelopes omitted by navigation, including reverse frame/holder paths and changes after preflight. Snapshot roundtrip preserves explicit deferred cancellation reasons; absent reason leaves old layout unchanged. Focused21/0/0skip/0TODO, lint/tsc clean; state captures regenerated/inspected, no pins/history. ~7k tokens/12min review-fix estimate,0helpers. See `briefs/raise-cancel.REPORT.md` follow-up.

Wave2 pre-gate review complete: 2d24de8 follow-up closes both independent LM036 findings; second review found no further blocker. Symmetric1e-6 dynamic vertical contact tolerance rejects a19mm held sheet rather than inheriting20mm holder floor allowance. Single informational19ft/4crew late-set cancel preflight17.864ms,0violations (open fixture, additional bodies add work). Camera stack remains isolated for the single wave2 pin window. Weekly usage52%; five-hour meter still unavailable. Starting clean integrated full gate; no candidate rows counted fixed yet.

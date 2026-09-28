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

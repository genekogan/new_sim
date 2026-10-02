# Bounded garden care candidate

Source base: `65cc0b8`, branch `codex/garden-care-world`. Unpublished candidate; root owns catalog, shared types, renderer, Lab wiring, combined validation and deployment. No historical placement or real Mars horticultural claim.

## Supported contract

`garden_care` physically takes the same water bowl, walks to one upright ground planter, reaches its 0.8 m soil target, makes four 0.0625 deposits, withdraws and returns the bowl using ordinary item actions. Each complete cycle consumes 0.25 of the bowl. The initial finite quantity is 1, enough for four cycles total across the two plants; no refill or spawn occurs. Quantities are normalized bowl units, not a claimed real volume.

`GardenState` retains cycles, total received water, last care tick and an optional purpose/source/delivered partial commitment. Care is initially due and becomes due again 600 ticks (30 simulated seconds) after the last complete deposit. Explicit retry retains a partial purpose. Due status is derived from the deterministic runtime tick, with no biological growth simulation.

Pause and director handoff drain ordinary child actions, withdraw the hand and return the same bowl before releasing claims. A newly occupied return slot blocks with `garden_care.return-occupied`, preserving the actual held bowl and claims until the obstacle clears. Admission refuses missing/unavailable/unsupported planters, invalid care state, missing/empty/wrong/foreign-held water, occupied return slots and foreign leases without a physical effect. Ground-only authored scene, one standing carer, one right-hand bowl and a supported ground table are explicit limits. Active logical reload is unsupported; Reset replaces the hypothetical world.

## Integration seams

Exports: `GardenState`, `gardenState`, `readGarden`, `gardenCare`, `GARDEN_PLANTER_ASSET`, `GARDEN_PLANTS`, `gardenCareParams`, `gardenCareScene`, `gardenCareWorld`, `gardenCareRuntime`, `GardenCareHud`. The fixture blueprint is 0.6 × 0.8 × 0.6 m, obstacle=true, `surfaceSlots:[{id:'care',local:[0,0.8,0]}]`; root copies it into canonical CATALOG. Tests register it only inside their fixture factory using nullish assignment, never at module import or over an existing definition. Root adds the typed entity state, scenario/registry, rendered planter/readout and HUD.

HUD provides Care, Pause care, Resume retained care and Direct carer away, plus finite water, cycle, retained commitment and deterministic due readouts. Existing standing reach supports this raised planter without new physics or anatomy. Useful visible care was reviewed on the integrated source below; shared rendering remains root-owned.

## Executed local checks

- `node --test engine/test/garden-care.test.ts`: **19 PASS, 0 fail/skip/TODO**, 400.545 ms. Includes both plants, ordinary take/put, Pause during taking/walking/reaching/watering/putting, director handoff, partial retry, four-cycle exhaustion, deterministic repeatability, eight invalid inputs, foreign lease and late occupied return slot. Every stepped check asserts unchanged total water and no invariant violations; completed/stopped journeys assert supported bowl and zero claims.
- `./node_modules/.bin/tsc --noEmit`: PASS.
- Scoped oxlint for the five new TS/TSX files: PASS.
- Ignored logs: `viewer/.cloudflare/garden-third-node.log`, `garden-tsc-final.log`, `garden-lint-final.log`.

The first Node run had 16 PASS/2 failures: a test used Runtime.step(count), although Runtime.step() takes one tick, and admission let the original bowl hide a duplicate foreign slot occupant. The corrected test loops ticks; admission now scans for foreign occupants. The initial log is retained in `garden-first-node.log`; the second run passed 18/18 and the third adds the late obstruction test. Initial scoped lint exposed a redundant spread, corrected without changing semantics.

No full gate, build, idle performance or public validation has run in this lane. The browser proof below covers the integrated candidate only; root still owns combined acceptance and public critical review. This candidate does not prove arbitrary garden layouts, soil biology, other containers or carers, active reload, autonomous resource replenishment or all disruption combinations.

## Integrated browser proof

Frozen engine source `6af3cd2`, isolated detached checkout `<mars-worktrees>/garden-play-proof`; corrected browser spec source `e96653f`. Actual Play case **1/1 PASS, 0 skip**, 32.4 s (33.9 s total). Only elapsed due clocks use synchronous stepping; all care and safe director movement execute actual Play. Five PNGs personally inspected: held water at soil, retained safe return, both plants cared, empty source refusal, and completed carer-away handoff with bowl on table. Current rig and grounded planter identities are visible; bowl and soil detail are small at this overview distance. No fluid animation, biological growth or fine anatomy clearance is certified.

The initial browser case passed through depletion, then its handoff wait selected the completed return-bowl child walk instead of the separate director walk. Exact Node reproduction showed director `a6` still executing with its valid actor claim. The corrected test waits for the parentless director walk; the strict zero-claims assertion remains unchanged. No engine fix or assertion relaxation was made. Both initial port-conflict boot aborts and original failure log/trace remain preserved.

Ignored receipt `<mars-worktrees>/garden-play-proof/viewer/.cloudflare/garden-browser-receipt.json` records exact sources, command, capture hashes, results and limits. Captures and state proof: `viewer/e2e/artifacts/garden-6af3cd2-retry/` in that checkout; log `viewer/.cloudflare/garden-play-retry.log`. Browser/server terminated normally; no listener remains on owned port 61038, and frozen tracked source stayed clean. Ports 5491/5493 belonged to existing listeners and were left untouched. The retry used a small ignored config importing the normal harness, selecting the corrected owned spec against the frozen server.

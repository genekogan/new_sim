# Bounded garden care candidate

Source base: `65cc0b8`, branch `codex/garden-care-world`. Unpublished candidate; root owns catalog, shared types, renderer, Lab wiring, combined validation and deployment. No historical placement or real Mars horticultural claim.

## Supported contract

`garden_care` physically takes the same water bowl, walks to one upright ground planter, reaches its 0.8 m soil target, makes four 0.0625 deposits, withdraws and returns the bowl using ordinary item actions. Each complete cycle consumes 0.25 of the bowl. The initial finite quantity is 1, enough for four cycles total across the two plants; no refill or spawn occurs. Quantities are normalized bowl units, not a claimed real volume.

`GardenState` retains cycles, total received water, last care tick and an optional purpose/source/delivered partial commitment. Care is initially due and becomes due again 600 ticks (30 simulated seconds) after the last complete deposit. Explicit retry retains a partial purpose. Due status is derived from the deterministic runtime tick, with no biological growth simulation.

Pause and director handoff drain ordinary child actions, withdraw the hand and return the same bowl before releasing claims. A newly occupied return slot blocks with `garden_care.return-occupied`, preserving the actual held bowl and claims until the obstacle clears. Admission refuses missing/unavailable/unsupported planters, invalid care state, missing/empty/wrong/foreign-held water, occupied return slots and foreign leases without a physical effect. Ground-only authored scene, one standing carer, one right-hand bowl and a supported ground table are explicit limits. Active logical reload is unsupported; Reset replaces the hypothetical world.

## Integration seams

Exports: `GardenState`, `gardenState`, `readGarden`, `gardenCare`, `GARDEN_PLANTER_ASSET`, `GARDEN_PLANTS`, `gardenCareParams`, `gardenCareScene`, `gardenCareWorld`, `gardenCareRuntime`, `GardenCareHud`. The fixture blueprint is 0.6 × 0.8 × 0.6 m, obstacle=true, `surfaceSlots:[{id:'care',local:[0,0.8,0]}]`; root copies it into canonical CATALOG. Tests register it only inside their fixture factory using nullish assignment, never at module import or over an existing definition. Root adds the typed entity state, scenario/registry, rendered planter/readout and HUD.

HUD provides Care, Pause care, Resume retained care and Direct carer away, plus finite water, cycle, retained commitment and deterministic due readouts. Existing standing reach supports this raised planter without new physics or anatomy. Useful visible care is still subject to actual browser capture review after integration.

## Executed local checks

- `node --test engine/test/garden-care.test.ts`: **19 PASS, 0 fail/skip/TODO**, 400.545 ms. Includes both plants, ordinary take/put, Pause during taking/walking/reaching/watering/putting, director handoff, partial retry, four-cycle exhaustion, deterministic repeatability, eight invalid inputs, foreign lease and late occupied return slot. Every stepped check asserts unchanged total water and no invariant violations; completed/stopped journeys assert supported bowl and zero claims.
- `./node_modules/.bin/tsc --noEmit`: PASS.
- Scoped oxlint for the five new TS/TSX files: PASS.
- Ignored logs: `viewer/.cloudflare/garden-third-node.log`, `garden-tsc-final.log`, `garden-lint-final.log`.

The first Node run had 16 PASS/2 failures: a test used Runtime.step(count), although Runtime.step() takes one tick, and admission let the original bowl hide a duplicate foreign slot occupant. The corrected test loops ticks; admission now scans for foreign occupants. The initial log is retained in `garden-first-node.log`; the second run passed 18/18 and the third adds the late obstruction test. Initial scoped lint exposed a redundant spread, corrected without changing semantics.

No browser, full gate, build, idle performance or public validation has run for this source. A separate actual-Play browser case will check visible partial care, safe return/retry, both plants, elapsed repeat due, exhaustion and director handoff after root integration. Renderer appearance and severe pose/facing remain review requirements. This candidate does not prove arbitrary garden layouts, soil biology, other containers or carers, active reload, autonomous resource replenishment or all disruption combinations.

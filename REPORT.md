# Edge capability stall — diagnosis and fix

Branch `edge/capability-stall-20261015` (from main `1080cfa9`), local only, nothing pushed or deployed.
All numbers: real `main.ts` server, fake minds, ordinary 20 Hz clock, ports 5380–5389, `eden-district` genesis.
Raw summaries are in `tools/capability-stall/evidence/`.

## TL;DR

* **Yes, ordinary residents pay it.** In a world-engine (god) world, every `ledger.act`, `GET /v1/edge/capabilities`,
  `here` and `observe` rebuilds the Soul's whole capability list synchronously (`EdgeLedger.binds`). The list includes
  `walk:`/`hang-out:` for the nearest ≥120 named things plus every building's rooms within 80 m, and each one needs a
  "standing point" lookup. The lookup rebuilt a 64 m grid tile for every thing outside the Soul's paged window, and it
  built **every upper floor in that tile too, even when only the ground level was asked for, with no cache**.
* Cost: **0.4–0.55 s of frozen world per cold act/listing** in the 150-entity district, **2.0–2.4 s** at ~1600 entities.
  Eight Souls polling every 4 s and acting every ~16 s kept the event loop **101 % busy** (median act 3.5 s, max 9.9 s,
  stalls up to 4.8 s). W4b's 9.5 s is the same stack on a church/gazebo layout (their own profile: 96 % under
  `gridsOver → buildGrids → buildLevel`).
* **Fix (two small, exact changes):** (1) build only the requested level, and keep upper-level grids for the navigation
  epoch (bounded LRU); (2) compute a Soul's place path once per comms-object listing instead of twice per object.
  The offered capability list is byte-identical (416 capabilities compared, before vs after).
  Cold act/listing: **540 → 28 ms** (district + churches), **2.0–2.4 s → 0.15 s** (1.6k entities); 8-Soul load: **101 % → 5 %** busy,
  worst stall 4.8 s → 0.35 s, median act 3.5 s → 60 ms.
* **Found on the way, not fixed (separate, bigger):** every god edit in a built-up world freezes the world for
  **~24 s at ~800 built things, ~50 s at ~1200** (`GodPlaces.derive`, see *Follow-ups*).

## Where the time goes (CPU profile, 8-Soul / church world, share of time inside `binds`)

```
binds                                       100 %
  EngineBridge.capabilities → GodNav.capabilities   94–96 %
    GodNav.goal  (standing point per thing)           91 %
      standableNearV1 → Spatial.levelAt               84–86 %
        GroundNav.gridsOver  (point outside every window)  88 %
          buildGrids → buildLevel                     86 %     ← upper-level flat rasters + EDT, rebuilt every call
            EDT (edtColumns/edtRows)                  54 %
            stampLevel / rasterObb                    31 %
    GodNav.roomGoal (rooms: ≤14 candidate points each) 38 %
```

Path: `act()` → `explicitPlaceCapability` (`edge/boot/world-places.ts:46`, builds the full list even for `sit:`) →
`EdgeLedger.binds` (`ledger.ts:328`; cached per Soul per tick, cleared by every accepted act and ended receipt) →
`worldProfile` chain → `EngineBridge.capabilities` (`god/engine-bridge.ts:710`) → `GodNav.capabilities` (`god/nav.ts:289`) →
`GodNav.goal` (TTL 50 ticks = 2.5 s, so any agent that polls slower than that is always cold) → `standableNearV1` →
`Spatial.levelAt` (`mars/viewer/engine/spatial/service.ts`): a point no window holds called
`GroundNav.gridsOver(rectOf([p]), pages.all)`, which builds level 0 (cached by tile) **and every upper level that touches the
tile (not cached)**, then returns one level. The 14–18 builds of a first listing and the 3–7 of every later cold listing
are these; they are ~100–130 ms each.

W4b's own profile (`.lane/evidence/verify-use-w4b/before-profile.cpuprofile`, which I re-analysed with
`tools/capability-stall/profile.mjs`) has the same shape: 16.7 s in `binds`, 96 % under `gridsOver`, `roomGoal` 25 %.

## Measurements (wall-clock ms the event loop was blocked inside `binds`; medians; 3 reps)

The machine was shared with other sessions (load average 4–130 during runs), so treat absolute values as ±30 %;
ratios and counts are stable. `fixed` = engine fix only, `fixed2` = both fixes.

| world | what | base (`1080cfa9`) | fixed | fixed2 |
|---|---|---:|---:|---:|
| district, 152 entities, 251 caps | cold list / act | 410 (sit 432, walk 409, hang-out 400) | 82 / 75 | – |
| district + 2 churches + gazebo, 278 caps | cold list / act | 540 (sit 548, walk 539, hang-out 534) | 42 / 40–75 | **28** (27–29) |
| same | warm (goals cached) | 21–22 | 22–24 | 16 |
| 1592 entities (+60 houses), 389 caps | cold list / act | 2051 (sit 1679, walk 1855, hang-out 2387) | 242–272 | **144–162** |
| same | warm | 162–261 | ~150 | 56–58 |
| church world, 8 Souls, 60 s | loop busy in `binds` | **101 %** (60.7 s) | 6.4 % | **5.0 %** |
| same | stalls > 500 ms / worst / median act / worst act | 40 / 4.8 s / 3.5 s / 9.9 s | 0 / 0.40 s / 80 ms / 0.59 s | 0 / 0.35 s / 60 ms / 0.50 s |
| Mars camp (base world, no bridge) | cold / warm | 9–16 / 11–20 | – | – |

First listing after boot or after a god edit (still one-off per world edit): 1.5–1.7 s (district/church) and 4.5 s (1.6k
entities) before; **~1.0 s** (church) and **~1.4 s** (1.6k entities) after. What is left of it is GodNav's room reachability (`roomGoal → reachV1`
×25–29 → `pagedRoute → gridsOver` ×11, ~0.65 s), not the grid memo — see *Follow-ups*.

**Acts per minute.** One cold call costs the whole loop `T`, so a world can serve at most `60 / T` cold calls a minute
before it is 100 % blocked: ~110–150 in the district, ~30 at 1.6k entities. Eight attentive Souls (15 listings + ~4 acts
per minute each ≈ 120 calls/min) hit that ceiling at once, which is exactly what the load run shows. After the fix the same
load uses 5 % of the loop; the ceiling is ~2000 calls/min in the district and ~400 at 1.6k entities.

**Which worlds.** `config.ts:18`: every world whose key is not `toy`/`mars`/`littlemartians`/`eden` (or with
`ENABLE_WORLD_ENGINE=1`) is a world-engine world and installs the bridge, with paged ground by default
(`ground-host.ts:49–52`). That is every user/registry-created world. The base worlds do not run `GodNav`: the Mars camp
measured 9–16 ms per listing. I did not touch or query any live world.

## The fix

`mars/viewer/engine/spatial/tiled.ts` — new `GroundNav.levelOver(rect, id, scene)`: exactly
`gridsOver(rect, scene).levels.get(id)` but builds only that level (levels are independent in `buildLevel`).
Level 0 goes through the existing `compose` cache; an upper level only if one of its surfaces touches the tile.
`mars/viewer/engine/spatial/service.ts` — `levelAt` for a point no paged window holds now calls
`outsideLevel`, which memoises upper-level grids per `(epoch, level, tile rect)` in a 12-entry LRU (~2 MB each) and
drops them when the epoch moves (the epoch moves exactly when the static world does, which is what the existing
`aroundCache` and window sets already key on).
`apps/server/src/edge/comms/objects/framework.ts` — `capabilities` and `visibleTo` take the Soul's place path once
(`inPlaceFor`) instead of twice per object (each was every place polygon, sorted).

Why it is behaviour-neutral: same cells as a fresh build (tested); grids are read-only (no code outside `grid.ts` writes
`free`/`clearance`); memo entries are never the live window grids that `updateGrids` patches; the place path cannot
change inside one synchronous listing. Nothing in `GodNav`, the ledger or the vocabulary changed.
End to end: the full offered list (id, verb, availability, blocked code, label, target) of a Soul in a 1.6k-entity
world with churches is **identical** at base and fixed2 (`evidence/base-eq-caps.json` = `fixed2-eq-caps.json`, 416 entries).

Memory: +≤ 12 × ~2 MB per world process; level 0 adds nothing (already cached).

## Tests

* `packages/engine-mars/src/spatial-outside-levels.test.ts` (4): built once per epoch and cell-equal to a fresh build;
  a standing-point search on a far upper floor builds nothing the 2nd–41st time; an edit moves the epoch (rebuilt once,
  shows the edit); the memo is bounded and LRU. All 4 fail on `1080cfa9`.
* `apps/server/src/edge-comms-objects.test.ts` + 1: one `placePathOf` call per listing for 31 objects (62 before) and
  correct visibility for a Soul in two places, one place, and nowhere (a throwing lookup still means "nowhere").
* Run (all pass, 0 skipped): engine-mars `spatial-outside-levels`, `entity-physics`, `doorway-passing`, `ground-paged`
  (imports `ground.test.ts`, incl. snapshot/replay hash equality): 29/29; server `edge-comms-*` + `object-body-atomic`: 48/48;
  server `god/{ground-host,nav,engine-bridge,places,held}`: 9/9; `tsc --noEmit` for `apps/server` and `packages/engine-mars`: clean.
  Not run: soulfix2 (non-paged world, unaffected), full suites.

## Follow-ups (not done here)

1. **God edits freeze built-up worlds (largest finding).** `EngineBridge.afterTick → perceiveSync → GodPerceive.sync →
   GodPlaces.index/derive → describe → seatsIn → worldPose → bake → slotsOf → hashOf` re-derives every place
   from scratch with a SHA-256 of each entity's params per call. Profile of the whole run: 82 % of CPU, 24 s per
   rebuild at ~800 built things (40 houses), ~50 s at ~1200, ~0.15–0.3 s in the 150-entity district. Every god edit (a bench) triggers it. Memoise `bake`/`slotsOf` per entity
   version or derive incrementally from the dirty set. Independent of this fix.
2. **First listing after each world edit still ~0.65 s** (church world): `GodNav.roomGoal` → 25–29 `reachV1` route plans, each
   building a `pagedRoute` grid set; cached per world version. Options: memoise `gridsOver` per (epoch, rect) in
   `pagedRoute` (engine owner review), or defer room reach to act time like `deferRouteChecks` already does for walk/hang-out
   (that one changes which rooms show `available`).
3. Smaller: `GodNav.landmarks` is O(things) per labelled thing per listing (~5 % at 1.6k entities; cache per index);
   comms `Objects.fresh()` opens one SQLite transaction per object per listing; `GodNav.goal` TTL of 50 ticks makes
   every poll slower than 2.5 s cold (the memo makes cold cheap, so the TTL no longer matters much).
4. The 9.5 s W4b case is not reproduced to the second: my church layouts keep their rooms on level 0, so the cost
   showed up as 0.54 s. The mechanism and stack are the same; the number scales with (far tile, upper level) builds ×
   ~0.1–0.2 s, and rooms on upper floors cost up to 14 builds each.

## Reproduce

```bash
git worktree add -b edge/capability-stall-20261015 ../edge-capability-stall 1080cfa9   # then cp -cR node_modules
node tools/capability-stall/measure.mjs --tag base-church --root <unmodified checkout> --near-church 2 --reps 3 --cpu-prof
node tools/capability-stall/measure.mjs --tag fixed-church --near-church 2 --reps 3
node tools/capability-stall/measure.mjs --tag load --near-church 2 --souls 8 --load 60 --reps 0
node tools/capability-stall/profile.mjs .lane/capstall/base-church.cpuprofile binds 40
```
`tools/capability-stall/preload.mjs` wraps the live module prototypes (`binds`, `act`, `GodNav`, engine reads,
`gridsOver`/`levelOver`, `canPerform`) and an event-loop gap timer, without editing the server; see `measure.mjs` for flags
(`--w4b`, `--extra N`, `--edit-tax N`, `--dump-caps`, `--no-god --world-key mars`).

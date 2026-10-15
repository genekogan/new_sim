# Stairs reach: `describe` said "reachable", a resident could not climb (EF1, story run S1)

Branch `godmode/stairs-reach-20261015` (from `godmode/integrate-20261015` c77b2731). Local only; nothing pushed, merged or
deployed. Test servers: none needed (everything ran in the fake-mind fixture in-process).

## Result

`describe`, the engine's route planner and a physically walking probe resident now agree for 3, 4 and 5 floor lighthouses and a
3 floor tower, and for 2 to 6 floors of both. Before, every lighthouse or tower of 4 or more floors failed from floor 3 up
(9.1 m), exactly as S1 saw. Three things were wrong; none was the one S1 suspected ("the generator's room graph"):

| # | What | Where (at c77b2731) | Fix |
|---|---|---|---|
| 1 | The rail round each upper floor's stair well is a hexagon with the edges within 0.45 rad of the arrival left out. Flights turn 320° (`a0 + k·sweep`, `building-plan.ts:233`), so the arrival moves −40° a floor. For the flight into **floor 3** it lands between two edge midpoints (28.7° and 31.4° away): **no edge is open and the landing is inside six rails**. Every other flight keeps its one open edge. | `building-layout.ts:243-244` | open the two nearest edges when none is within 0.45 rad (`building-layout.ts:242-250`) |
| 2 | The bridge hands the planner a helix flight as a **straight link from the first to the last path point**, heading = the chord. The planner stands a body "0.7 m back along the heading" (`path.ts:27-31`) and `withLinkApproaches` only tries a few side steps (`entity-physics.ts:131-148`). For a helix those points are in the tower wall, a rail, the next flight's treads or the outer gallery, and the generator's own landing is only 0.35 m from the first tread, tighter than the planner's 0.34 m body plus margin (`path.ts:153` drops the link edge: approach not passable, exit snapped into the gallery, or segment clearance < 0.306). Which floors fail depends on the rotation, so it looked like "floor 3 and up" (and floor 2 could not be left in lighthouses of 4+ floors). | `engine-bridge.ts:236-243` | `helixEnds` (`engine-bridge.ts:57`): for a helix the landings move 0.2 m in towards the stair well's axis and the planner is given a standing place 0.7 m further in; `withLinkApproaches` (`entity-physics.ts:114`) tries that direction first, then nearer places and the sides, with 0.12 m extra room because the planner's grid reads about 0.1 m tighter than point tests |
| 3 | `describe`'s "reachable from outside: all N rooms" is a flood over the generator's door/stair graph (`building-layout.ts:498`, `reachability.ts`). It never asks the engine, so it could only be right by luck. | `query.ts` describe | `describe` now carries a `walk` report from the engine's own planner (`query.ts:224-247`, shown as the CLI's `walk:` line) |

Neither 1 nor 2 alone is enough: with the rail fix only, floor 2 could not be left and floor 4 could not be reached; with the
bridge fix only, towers still failed on floor 3 (down) and floor 4 (up). Together: 0 failures.

## What `describe` shows now

```
  notes: ... | reachable from outside: all 4 rooms | ...        <- the design graph, unchanged
  walk: all 4 rooms can be walked into from the front door and out again (the engine's own route check: ...)
  walk: NOT WALKABLE — room-3 (floor 3): no way in (route.unreachable), no way out (route.unreachable). This is the engine's own route check ...
  walk: not checked — the engine is still taking in the last edit; describe again in a moment ...
```

The check runs the engine's planner from the stand outside the front door into each room and back out (two route searches per
room; `describe` of a 6-room lighthouse took 43 ms warm / 99 ms cold here), and says `pending` while the engine has not yet taken in the model's latest edit (bridge physics hash vs
the engine's), so it can never answer for the previous version of the building. JSON: `describe --json` → `walk`.
`SKILL.md` tells agents to trust `walk:` over "reachable from outside". Skill bundle rebuilt.

## Evidence

* Minimal reproduction, red before / green after: `packages/generators/src/building.test.ts` "spiral stairs: no rail fences the
  arrival" (fails at `lighthouse w=6 floors=4 … stairs-3 (into floor 3)`), and `apps/server/src/god/stairs-reach.test.ts`
  (4 and 5 floor lighthouses fail with `route.unreachable` on floors 3+, and on leaving floor 2; the design note still says "all N rooms").
* `stairs-reach.test.ts` (7 tests, ~5 s): for lighthouses of 3, 4, 5 floors and a 3 floor tower — `describe` note, `describe.walk`,
  `reach` up and down for every room, and a `verify-use` probe that walks the whole way from outside (explicit `from`) and sits
  in the top room; 2–6 floors, both defs, six yaws, off-grid positions; a legacy wall across the door (note says "all rooms",
  `walk` says failed, the probe cannot enter); `pending` while the engine is behind; `helixEnds` unit test (straight flights untouched).
* Wider sweep (scratch, not committed): 270 towers (lighthouse w 6–10, tower w 5–10, floors 2–6, six yaws, off-grid), every room
  both ways: 0 failures. Lighthouses narrower than 6 m are refused by the generator, as before.
* `node tools/god-gate.mjs`: see the end of this file.

## Not done / found on the way (each its own piece of work)

1. **Furniture on a stand point still blocks.** Stand points are derived once from the building's own solids; a chair put
   exactly on one (tower w=5: 0.2 m from the axis) cuts the floor off. It is no worse than a sofa at the foot of a cottage stair,
   and `describe` now says so (`walk: NOT WALKABLE … no way out`), which is the point; the fix is to re-derive approaches when
   neighbours change or to keep furnishing out of the well (`furnish` recipes).
2. **Placement accepts spots over the stair well.** S1's `lookout-chair --wall back` sat in the lantern room's void (2.4 m from the
   axis; the floor is only the inner disc), probably the cause of its earlier `slot.unreachable`. The compiler checks the room
   polygon, not the floor surface minus the hole.
3. **Narrow round towers refuse with a misleading first line** (`building.no-entrance: no door to the outside` for w 5–5.5; the
   12-gon facets are shorter than a door plus margins). It cost S1 three dry runs.
4. **Helix links animate as a 3 m rise over a ~1 m chord** through the stair well (the bridge interpolates straight between
   the landings). Residents get there; they do not follow the helix. Following `l.path` would fix the look.
5. **Admission still trusts the graph.** `place`/`set` are accepted by the design graph only. EF1's remaining step is to run the
   same planner check on `set`/`place` results and `build step check`, and add `reach`/`clear` verbs; the `walk` report is the
   building block (one function, no new engine code).
6. Existing worlds re-derive their towers on the next boot (the bridge sends only differences), so deployed lighthouses will
   pick up the new links and rails without an edit.

## Files

`packages/generators/src/building-layout.ts` (rails), `apps/server/src/god/engine-bridge.ts` (`helixEnds`, links, `syncProviders`),
`packages/engine-mars/src/entity-physics.ts` (`withLinkApproaches`), `apps/server/src/god/query.ts` (`walk`),
`tools/god-skill/cli.mjs` + rebuilt `eden-god.mjs` + `SKILL.md`, tests as above.

## Gate

`node tools/god-gate.mjs` (Node 22.20, laptop, nothing else started): god 259 pass / 0 fail / 5 skipped (includes the 7 new),
world-compiler 97, catalog 30, generators 22 (includes the new rail test), CLI-lib 124, tsc server / world-compiler /
generators clean, skill bundle fresh. Also run: `packages/engine-mars` `entity-physics.test.ts` and `stair-make-way.test.ts` (11 pass).
Not run: the full engine-mars and monorepo suites (laptop rule).

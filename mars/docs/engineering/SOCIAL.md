# Social / inhabited-scene vocabulary (spec §17, milestone H)

First pass at people *living* on campus, built on the same action runtime as walking and
construction. Code: `viewer/engine/social/` (`slots.ts`, `actions.ts`, `ambient.ts`); tests:
`viewer/engine/test/social.test.ts`; verbs are in the one registry (`api/registry.ts`).

## Interaction slots (Smart Object claims, RESEARCH §8)
A `Slot { id, owner, kind: seat|stand|audience|fire-circle, p, yaw, level, claimedBy? }` is a
place a body occupies, facing `yaw`. Slots are **derived, never stored**:
- **Fixtures** whose catalog def lists `slots` (`world/catalog.ts` `SlotDef`, local x/z + yaw):
  `bench-6ft` (3 seats, 2 ft apart), `camp-chair` (1 seat), `campfire` (8 fire-circle places on a
  1.6 m circle facing the fire). Seats face local +z. Ids are `<entity>#<slot>` (`chair#seat`,
  `fire#ring3`).
- **Place regions** with an audience `layout: { focus, spacing?=0.9, rowGap?=1.0, kind? }`
  (`SocialRegion`, an extra JSON field on the region): rows perpendicular to centroid→focus,
  nearest row first, points kept only inside the polygon with body clearance; ids `r<i>c<j>` of
  the full grid so they stay stable when a point drops out.

A claim is a runtime reservation on `slot:<id>` (exclusive), so two actions can never own one
seat (spec §28 "Reservation conflict"); `claimedBy` is read back from `rt.holder`. A slot is
*free* when unclaimed **and** nobody's body is on it (`occupantOf`). Assignment for groups is
deterministic nearest-first (all actor×slot pairs sorted by distance, ties by list order).

## Verbs
Every verb moves people with child `walk_to` actions (arriving with `face`) and then holds them
in an activity until cancelled. No loads are involved, so every cancel is immediate: people stop
where they are, `activity = 'idle'`, `task` cleared, all actor/slot claims released.

| Verb | Params | Behaviour |
| --- | --- | --- |
| `sit` | `actor, slot \| fixture` | walk to the seat, turn to its yaw, `sit` until `stand`/cancel. Explicit `slot` taken → `reservation.conflict` naming the slot + holding action; `fixture` with no free seat → `slot.none-free` naming the fixture and who holds / stands on each seat |
| `take_slot` | `actor, slot \| owner, activity?` | same for any slot kind; activity defaults by kind (seat→sit, audience→watch, fire-circle→warm) |
| `stand` | `actor` | cancels the actor's `sit`/`take_slot`; `social.in-group` for a converse member |
| `face` | `actor, target: {entity} \| {point}` | turn in place (turn rate 4 rad/s), idle |
| `converse` | `actors[2..6], at?, duration?` | circle of radius clamp(0.4/sin(π/n), 0.6, 1.0) m around `at`, else the nearest fitting centre to the centroid (rings to 3 m); actors keep their angular order (no crossing paths); all face the centre, `talk`. Refuses `actor.holding`, `converse.levels`, `converse.clearance` (names the wall/person) |
| `gather` | `actors, region \| fixture, activity?` | one child `take_slot` per assigned person; people left over get a child that fails `slot.none-free` naming the owner. Ends when all children end |
| `campfire_circle` | `actors, fire` | gather on the fire's fire-circle slots, activity `warm`; `campfire.not-a-fire` otherwise |
| `ambient_wander` | `actors, region, seed?, duration?` | background strolls (below) |

## Ambient autonomy
`ambient_wander` **reserves nothing**. Each tick, in list order, an idle unclaimed person whose
pause is over gets a child `walk_to` (0.9 m/s) to a random point of the region: inside the
polygon, ≥ 0.53 m clearance, ≥ 1.2 m from other people and other wanderers' targets. Draws come
only from `world.rng` (`seed` offsets them), so runs are reproducible and fork-safe. Pauses are
2–8 s (first walks staggered 0–2 s). A person is **released for good** the moment anything else
reserves them, they get a task or grip, or their ambient walk is cancelled by someone else;
`walk.ts` make-way nudges are transient and do not count. Cancel stops new walks; in-flight walks
are cancelled by the runtime (people stop in place).

## Pre-emption rule (spec §17)
Explicit director commands outrank social life, but **there is no automatic pre-emption yet**.
A social action owns its people's `actor:<id>` reservations, so a directed task (carry, raise,
walk) submitted for one of them fails `reservation.conflict` whose message names the social
action (`… reserved by action a7 (sit, executing)`; gather members show their `take_slot`,
wanderers mid-walk show the `walk_to` whose parent is `ambient_wander`). The director must
release them first: `releaseForDirective(rt, actor)` cancels the smallest social unit (their own
`sit`/`take_slot`, their current ambient walk, or the whole `converse`/`face`) and never touches
non-social holders — critical tasks (supporting an upright) are never abandoned for autonomy.
`socialHolder(rt, actor)` reports which social action owns someone.

## Tests (`engine/test/social.test.ts`)
Registry wiring; catalog slot geometry; two sitters on one camp-chair (conflict / none-free /
stand); converse circle (spacing, facing < 0.2 rad, cancel → idle + no claims); converse
refusals (holder, wall); campfire_circle with 10 → 8 warm on their claimed ring places, 2
`slot.none-free`, cancel → no claims; audience-region gather; ambient 6 people × 60 s (targets in
region, 0 violations, directed task takes one and ambient lets go); determinism hash.

## Missing / approximate
- **Sit pose / animation is a renderer concern**: the engine only sets `activity` and yaw; the
  body point is the seat point.
- **No seat geometry collision**: seat fixtures carry no `phase`, so they are not obstacles; a
  walker may path across a chair. A campfire placed with `phase: 'installed'` is an obstacle.
- Seats are occupied at the seat point; there is no separate approach point / sit-down transition.
- No conversation turn-taking, gaze, gestures or group re-forming when a member leaves.
- No automatic pre-emption or resumption; ambient never re-adopts a released person.
- Regions are single-level; audience layouts do not use seats/benches inside the region.
- The engine view (`app/engine-view/humans.ts`) draws `sit` / `talk` / `warm` / `watch` as a
  standing idle pose; the poses are a renderer follow-up.

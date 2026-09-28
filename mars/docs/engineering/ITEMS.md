# Tables, hand-held items and eating (owner feedback §12, 80/20)

Code: `viewer/engine/world/catalog-items.ts` (defs), `viewer/engine/items/` (`body.ts` reach model,
`model.ts` support / surfaces / standing points, `actions.ts` verbs), `viewer/engine/scenarios/meal.ts`;
tests `viewer/engine/test/meal.test.ts`. Verbs are in the one registry (`api/registry.ts` `ITEM_ACTIONS`).

## Catalog (`catalog-items.ts`, all dimensions provisional)
| def | size x·y·z (m) | kg | notes |
| --- | --- | --- | --- |
| `table-6ft` | 1.83 · 0.75 · 0.75 | 18 | fixture, `obstacle`; `surfaceSlots` `r0c0…r2c5`: 3 rows × 6 columns, 0.3 m apart, at the top (y 0.75) |
| `bowl` | 0.16 · 0.07 · 0.16 | 0.3 | container |
| `spoon` | 0.17 · 0.02 · 0.04 | 0.03 | spoon bowl at local +x, held at the handle end |
| `plate` | 0.26 · 0.03 · 0.26 | 0.5 | container |
| `cup` | 0.09 · 0.10 · 0.09 | 0.25 | container |
| `pot` | 0.32 · 0.28 · 0.32 | 4 | container, held by its side handle |

Small items: category `item`, `handling: { hands: 1, small: true, grips: { 1: [{ id: 'hand', local }] } }`.
The single grip slot `local` is where the hand holds the item in the item's frame (base-centre origin):
**item pose = hand point − rot(grip.local, yaw)**. Containers (`CONTAINERS`) may carry
`entity.contents = { food: string, fraction: 0..1 }`.

## Support model (`items/model.ts`)
An item entity (`kind: 'component'`) is exactly one of:
- `resting-on { on: <table>, slot: <surfaceSlot id> }` — pose at the slot point, no `phase` (never rasterised);
- `ground` — `phase: 'staged'`, so like any staged component it is a static obstacle **only if taller than the
  0.22 m step** (the pot is, a bowl / spoon is not);
- `in-hand { by: <person>, hand: 'left' | 'right' }` — no phase, never rasterised. (A new `Support` variant,
  not `held`: `held` means a construction grip — `holdersPresent`, the carry invariants and the sequence
  runner all require `human.grip` for it.)

A surface slot is free when nothing rests on it (`slotOccupant`). Lap support (item on a seated person's knee)
is **not implemented** (spec mentions it; `resting-on.slot` was left general enough for `'lap'`).
`physicalView()` needed no change: it already includes every entity field except label/tags/provenance, so
item `pose`, `support`, `contents` and `human.hands` / `human.baseActivity` are part of what plans depend on.

## Standing points (`reachStation`)
Same pattern as `seatApproach`: for each side of the table top whose edge is ≤ **ITEM_REACH 0.6 m** from the
item, a point `APPROACH_GAPS` (0.35 / 0.40 / 0.45 / 0.50 m) beyond that edge straight opposite the item,
first with ≥ `APPROACH_CLEARANCE` (0.30 m); sides ordered by distance from the person. Ground items: 8 points
0.45 m round the item, the one facing the person first. None → `item.unreachable` naming each blocked
side's blocker (e.g. `wall (test wall)`). A standing person within **HERE_REACH 0.85 m** (horizontal, body
axis → grasp point) reaches without stepping (turns to face it) — e.g. the spoon beside the bowl just taken.

## Verbs
| Verb | Params | Behaviour | Refusals |
| --- | --- | --- | --- |
| `take_item` | `actor, item, hand` | walk to the standing point (child `walk_to`, arriving facing the item) → turn → `reach` 0.4 s (hand point to the grasp point) → grasp (`in-hand`) → withdraw 0.4 s to the carry point → idle. Starts the person's `hold_items`. Reserves `actor:`, `hand:<actor>:<hand>`, `entity:<item>` | `item.held-by`, `item.already-held`, `item.hand-full`, `item.unreachable`, `item.not-handheld`, `item.unsupported-source`; mid-way `item.held-by` / `item.moved` if someone got there first |
| `put_item` | `actor, item, surfaceSlot` (`"<table>#<slot>"` or `'ground'`) | reverse: walk to the edge (table) → reach 0.4 s → release → withdraw 0.4 s (hand no longer published). `'ground'`: 0.55 m in front of a standing person | `item.not-held`, `item.slot-occupied`, `item.unreachable`, `item.no-room`, `item.not-standing` |
| `serve` | `actor, pot, bowl` | bowl in hand, pot ≤ **BODY_REACH 1.10 m** (or in the other hand): other hand to the pot 0.6 s → over the bowl 0.6 s (bowl `contents = { pot food, 1.0 }`, pot −0.25) → back 0.4 s. Overlay (activity `serve`) | `item.out-of-reach` (names the distance), `item.not-held`, `serve.pot-empty`, `serve.not-still` |
| `eat` | `actor, bowl, spoon, cycles?` | seated or standing still, bowl in one hand, spoon in the other: `ready` 0.4 s → cycles of **dip 0.6 → lift 0.6 → pause 0.4 → return 0.8 s (2.4 s)**, −0.2 of the bowl at the end of each dip → `lower` 0.4 s → `completed` `{ cycles, fraction }` when the bowl is empty or `cycles` are done. Overlay (activity `eat`) | `eat.not-still` (walking / sit-down / anything but sit·idle·talk·watch·listen·warm; also mid-eat if the body moves), `item.not-held`, `eat.bowl-empty` |
| `hold_items` | `actor` | internal, started on a grasp: every tick puts each held item at its hand (carry point, or wherever the hand's driver put it) and publishes `human.hands`; eases a seated drop over the 0.6 s sit-down / stand-up; completes when the person holds nothing | — |

**Overlays and groups.** `serve` / `eat` never reserve `actor:<id>`: they reserve `hand:<id>:left|right`
and the items, so they run while `sit` / `take_slot` / `gather` / `converse` hold the person. Those holders
re-set their activity every tick; the overlay is submitted later, steps later, and sets `activity = 'eat'`
(or `serve`) with **`human.baseActivity`** = the holder's activity (`sit` = seated, `talk`, `warm`, …). At the
end the activity returns to the base. `SEATED_ACTIVITIES` (`runtime/invariants.ts`) gained `eat` and `serve`
(a seated eater is inside the chair's footprint; overlays never move the body).
**Resumable**: all five verbs have plain-data execs (`resumable: true`); `meal.test.ts` snapshots mid-eat,
JSON round-trips, restores and compares 400 ticks later.

## Hand points — what the renderer reads
Per tick, world frame (metres, Y up, same frame as `pose.p`):
- **`human.hands = { left?: [x,y,z], right?: [x,y,z] }`** — the palm point of each hand that holds an item or
  is driven by an items verb (also written by `hand_up` for construction holders — one schema). A missing hand
  is free / at rest (renderer default pose). Absent object = no published hands.
- `human.activity`: `reach` (take / put; bend over the table — the engine does not model the torso lean),
  `serve`, `eat`; `human.baseActivity` while `eat` / `serve` run (`sit` → keep the seated pose, arms from
  the hand points).
- Items: `support.kind === 'in-hand'` → attach to the `support.hand` bone with the catalog grip offset
  (`CATALOG[def].handling.grips[1][0].local`), or use `pose` directly (it is exactly hand − rot(grip, yaw),
  yaw = the holder's yaw). `resting-on` / `ground` → render at `pose`. `contents.fraction` → food level.
- Body landmarks (`items/body.ts`, forward f = (cos yaw, sin yaw), right r = (−sin yaw, cos yaw) in x,z;
  heights above the ground point, −0.45 m seated): chest 1.30 m (+0.08 fwd), shoulders 1.42 m ±0.19 m,
  mouth point 1.58 m +0.15 m fwd, carry point 1.00 m +0.28 fwd ±0.16, bowl hand = chest + 0.25 fwd − 0.10.
  Eat: spoon hand rim (bowl hand + 0.12 up, 0.07 to the spoon side) → dip (inside the bowl) → rim → mouth
  point → (pause) → rim. Measured in the meal: bowl hand ≤ 0.4 m from the chest and spoon hand ≤ 0.75 m from
  its shoulder on every eating tick; the spoon hand is exactly at the mouth point through every pause.

## Meal scenario (`scenarios/meal.ts`, `meal.test.ts`)
Proving-ground lawn: table at (−6, −8.5) with a pot of stew (r1c2), 4 empty bowls, 4 spoons; campfire at
(−6, −4) with 4 camp chairs at 2.4 m facing it. Each person: take the inner item, then the outer one without
stepping, serve from the pot, `sit` on their chair (approach → turn → sit-down), `eat` until empty. Result:
5 cycles each, bowls and pot at 0, **0 violations, 689 ticks (34.45 s), hash `baf84de6…ccbfd`** at
walk_to e09a961 (a walk.ts change re-pins it). Also: `eat` inside a `converse` (base `talk`, converse still
holds them, `cycles` limit); put back on the table and on the ground; refusals (serve 2.5 m from the pot,
second item into a full hand, someone else's bowl, a chair, empty bowl, eat while `walk_to` runs, occupied
surface slot, occupied chair → `reservation.conflict`, far row of a table against a wall → `item.unreachable`
naming `wall`).

## Approximate / missing
- Reach over a table assumes a forward bend: shoulder → item can be ~1.1 m during `reach` (only eating is
  checked against the 0.75 m arm envelope). Standing points are not reserved (people yield / replan).
- Items do not collide with each other: a 0.32 m pot on a 0.3 m lattice overlaps its neighbours' footprints.
- `hold_items` steps before the walker that moves the body (it is created earlier), so a carried item trails
  its hand by one tick (≤ 7 cm at walking speed) while walking; eat / serve / take / put write the item
  pose in the same tick as the hand. Cancelling `hold_items` leaves items in hand with a stale pose.
- No lap support, no plate/cup verbs beyond take/put (drinking is not a cycle), no ladle, no food geometry,
  no spill; `contents` is a number. `serve` ladles with whatever the other hand holds.
- The seated drop (0.45 m) is the engine's reach model, not the renderer's rig.

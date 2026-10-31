# The Mars camp

A plain camp of about 42 × 42 m (scene bounds 44 × 44 m) built only from the Mars engine's existing fixtures, items,
regions and construction components. Every activity example is checked by the engine's own plan validation. Source:
`mars/viewer/engine/scenarios/eden-camp.ts`; tests: `mars/viewer/engine/test/eden-camp.test.ts`. Generated here:
[`manifest.json`](manifest.json) (the affordance manifest, schema `eden-camp-affordances/1`) and [`plan.svg`](plan.svg)
(top-down plan). A test fails if either is out of date. The world definition is [`../world.json`](../world.json)
(`scene: "eden-camp"`); the Sim adapter is `packages/engine-mars`.

![plan](plan.svg)

## Export API (`scenarios/eden-camp.ts`)

| Export | What it is |
| --- | --- |
| `edenCampWorld(seed?)` | The camp at genesis: tick 0, no humans, `base.campus = 'eden-camp'`. `seed` changes only `world.rng`; each call returns a fresh copy |
| `EDEN_CAMP_SCENE`, `edenCampScene()`, `EDEN_CAMP_CAMPUS` | The static `SpatialScene` (ground and 2.6 m walls with door gaps); register it with `servicesFor({ [EDEN_CAMP_CAMPUS]: EDEN_CAMP_SCENE })` |
| `CAMP_ARRIVALS` | Four clear arrival points at the south gate, each with a yaw facing the fire |
| `edenCampManifest()` | The manifest data (same as `manifest.json`) |
| `edenCampActivities()` | `CampActivity[]`: `id`, `label`, `verb`, `region`, `roles`, `params` with `$role` placeholders, `needs`, `tags`, optional `requires`, `after` |
| `bindCampActivity(activity, roles)` | Replaces `$role` in strings and object keys; throws on a missing role |
| `campActivityPlayable(rt, activity, roles)` | Whether the activity could start now, without submitting: schema, the verb's own `plan`, current reservation holders |
| `bindCampChess(world, white, black)` | Binds the chess players; an unbound board refuses moves with `chess.wrong-player` |
| `CAMP_BUILDINGS`, `CAMP_DOORS`, `doorPoints(door)`, `CAMP_SPOTS`, `CAMP_MATS` | Buildings, doors (inside and outside standing points), named spots, sleeping mats |
| `CAMP_BUILD_SITE`, `LOOKOUT_BEAMS`, `LOOKOUT_JOISTS`, `LOOKOUT_SHEETS` | The construction blueprint |
| `edenCampPlanSvg()` | Renders `plan.svg` |

## Contents

- **Kitchen**: a prep counter (`supper-pot`, ingredient bowls, `prep-spoon`), a dining table (`stew-pot`, `bowl-1…4`,
  `spoon-1…4`) and a three-seat bench.
- **Living room**: a classroom corner (`class-display`, `class-lectern`, `class-seat-1…6`), two computers with chairs, a
  listening chair, a chess table, a reading table with a book, a drawing table, a bench.
- **Bunk house**: ground mats `mat-1…4`.
- **Fire circle**: `campfire` (eight places) and two benches.
- **Garden**: `water-bowl`, `seed-bowl` and four planters.
- **Yard**: open ground, the arrival strip, material piles (two 8 ft uprights, four 9 ft beams, five 2x4 joists, two 4x6
  sheets) and the build site with a delivered stair flight and ten treads.
- **Regions** (16): rooms `place`, piles `material-pile`, build site and mats `work-area`, the yard `walkable`, the arrival
  strip `staging`.

## Activity examples

75 examples, 34 playable at genesis. `after` names the examples whose completed effects create the precondition; tests use
it to stage state. It is not a schedule: hosts decide when and whether anything is played.

- Anywhere: `walk_to`, `ambient_wander`, `converse`, `group_warmup`.
- Fire: `campfire_circle`, `sit`.
- Kitchen: `prepare_food`, `put_item` (the cook keeps the prep spoon), `shared_food_break`, a one-person meal from single
  primitives (`take_item`, `walk_to`, `serve`, `eat`, `put_item`), `sit`.
- Living room: `work_at`, `computer_music`, `read_book`, `chess_move`, `drawing_work`, `sit`, `converse`; classroom
  corner: `classroom_session`, `display_control`.
- Bunk house: `sleep`. Garden: `garden_care`, `seed_planting`.
- Construction, the lookout bay: `carry` from the piles, `raise_upright` ×2, `connect_beam` ×4, `release_support` ×2,
  `install_joist` ×5, `install_plywood` ×2, `install_stair_flight`, `install_tread` ×10, then `walk_to` onto the deck.

## Assumptions

- The camp contains no humans; hosts seed people at `CAMP_ARRIVALS`. Person ids must not collide with entity ids (all are
  listed in `manifest.json`).
- `world.env` keeps `emptyWorld`'s default date and time; the host's clock owns time of day.
- There is no timetable, routine or driver in the camp. Provenance is `design-edit` / `hypothetical`: an authored camp.

## Tests

`cd mars/viewer && node --test engine/test/eden-camp.test.ts` checks: a pinned genesis hash and seed independence; every
reference (defs, slots, regions, roles, `after` ids, verbs) resolves; each building has exactly one passable door; routes
from every arrival to every named spot; all genesis examples playable without changing the world hash; chess binding;
kitchen, meal, social, garden, sleep and seated activities executed; all construction examples executed in dependency
order with no invariant violation, and a fresh Runtime built from the final world keeps everything installed; generated
files up to date. Regenerate them with `UPDATE_CAMP_MANIFEST=1 node --test engine/test/eden-camp.test.ts`.

## Limitations

- Everything is finite: four 0.25 servings of stew, one 0.5 batch of prepared food, four waterings, two plantings. The
  engine has no refill verb; restocking is the host's job.
- `shared_food_break` fails with `shared_food.interrupted` when a participant is asked to make way; treat it as retryable.
- `prepare_food` and `shared_food_break` require a ground-only scene; they stay playable after the lookout stair exists
  because its link is not part of the base scene.
- Chess needs bound players; promotion is not supported.
- The fire has no lit/unlit state; `campfire_circle` runs until cancelled.
- `sleep` is capped at 600 s per call; a night of sleep means calling it again.
- Construction is one blueprint. The stair flight and treads are delivered beside the site (carrying stair modules is not
  modelled). The engine's disassembly verbs are opt-in and not in the default registry.
- `computer_music` allows at most two listeners; the camp has one listening chair.
- Long durations in the examples (work and reading 240 s, sleep 600 s, music 120 s) are suggestions.

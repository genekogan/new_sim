# Solar panels and painting (owner feedback 2026-09-28 §9, §8) — W8

Code: `viewer/engine/world/catalog-solar.ts`, `engine/construction/solar.ts`, `engine/carry/fragile.ts`,
`engine/work/paint.ts`. Tests: `engine/test/solar.test.ts`, `engine/test/paint.test.ts`. Verbs are in
`api/registry.ts` (MCP exposes them). **Mars work model v1, approximate**: rule-based plausibility.

## Solar (§9)
Catalog (`catalog-solar.ts`, registered by `...SOLAR_ASSETS` in `catalog.ts`):
| id | size (m) | kg | handling |
| --- | --- | --- | --- |
| `solar-panel-100x170` / `solar-panel-100x200` | 1.7 / 2.0 × 0.035 × 1.0 | 20 / 23 | 2-person carry, flat, `fragile: { maxTilt: 30° }` |
| `panel-rail` | 2.1 × 0.04 × 0.04 | 2.5 | 1 person, small load |
| `battery`, `charge-controller`, `inverter` | generic | 22 / 4 / 12 | 1 person; category `equipment`, `equipment: { kind, defaults }` |

Verbs (all publish `human.activity` + `human.hands` every tick; nothing moves without hands on it):
- `install_rail {actor, rail, onto, at:{x,z,yaw}}` — support: a deck (`onto` = an installed plywood sheet;
  the rail lies on the union of installed sheets level with it, no overhang) or installed 2x4 framing
  (`onto` = a member; the rail must cross ≥ 2 installed framing members at one height). Otherwise
  `solar.rail-no-support` ("would rest on nothing", "would overhang deck sheet s1 by 0.31 m", "would rest on
  k3 alone"). The rail must lie within 1 m of its place on the actor's floor (`solar.not-staged`: carry
  it first); person walks to a spot beside it → crouch → lift → place (≤ 0.3 m/s) → set_down → fasten 2 s.
  Installed: `support resting-on`, `connections bears-on` its supports.
- `install_panel {crew:[a,b], panel, rails:[r1,r2], tilt, at?}` — two different installed parallel rails
  level with each other (`solar.panel-rails`, `solar.rail-not-installed`); the panel spans both, edges
  parallel to them (`solar.panel-skew`). Where the panel is:
  - resting on the rails — it arrived by `hand_up` (receivers lay it on them; `handup.ts` now rests loads
    on installed rails) or off the forks (`hand_up via: 'forklift'`);
  - on the floor with the rails ≤ 2.06 m above it (standing reach, `BODY_MODEL.overheadMax`; was 2.1) — the
    crew lays it on the rails at `at` from ≤ 1 m;
  - on the floor with the rails higher — **refused** `solar.panel-too-high` ("…hand it up … or bring it on
    the forklift"); on the forks — `solar.panel-on-forks`.
  Then the crew stands beyond both ends of the tilt axis: `tilt` 2 s (flat → `tilt`° about the rails'
  direction, low edge on the rails; pose `pitch` or `roll`), `fasten` 3 s → `installed`, `bears-on` both rails.
- `place_equipment {actor, item, at, config?}` — on the ground or fully on the deck the actor stands on
  (`solar.no-surface`), from ≤ 1 m; `configure` 1 s → `placed`, entity `equipment: { kind, config }`
  (catalog defaults ⊕ `config`, keys sorted). No electrical simulation.

Fragile loads (`carry/fragile.ts`): a fragile carry between levels is refused when the stair flight is
steeper than `maxTilt` (`carry.fragile-tilt`: "…carried up stairs stairs-a it would tilt 36.9° with the
flight"), checked before the single-carrier level-change rule; invariant `fragileLoadsOk` (in
`CARRY_INVARIANTS`): a held fragile load tilted past maxTilt → `carry.fragile-tilt`, a fragile load with
support `none` → `carry.fragile-dropped`.

## Paint (§8)
`paint {actor, panel, color | texture, face?, band?:{from,to}}` (heights in m above the face's bottom edge).
- Paintable: catalog `paintable: { faces: ['front','back'] }` (front = local +y broad face) on
  `plywood-4x6`, `plywood-4x8`; the face must be upright (`paint.face-not-vertical`).
- The painter walks to a spot 0.4 m in front of the face (one per ≤ 1.0 m column — was 1.3 m, which a
  0.62 m arm cannot cover at the top corners; sidestep walks between, activity `idle` while sidestepping) and paints 0.2 m bands top-down, the brush sweeping at 0.8 m/s, the other hand holding the pot.
- Reach (plan time): 0.5–2.06 m above the floor they stand on; default band = the face's reachable part;
  a band outside it is `paint.out-of-reach` naming the band and its world heights ("…is above that — stand
  on a deck or beam"). A painter on a beam paints from where they stand (no walking).
- Refusals: `paint.not-paintable`, `paint.what` (both / neither of colour and texture), `paint.while-walking`,
  `paint.busy`, `paint.panel-moving`, `paint.no-station`; mid-run `paint.moved` if pushed off the spot.
- Envelope: `BODY_MODEL.posture.painting` — shoulder 0.9–1.48 m above the feet, lean 0.35 m, arm 0.62 m
  (`paintEnvelopeGap`; was 1.5 m / 0.75 m). All reach numbers: `engine/body/model.ts`, BODY_MODEL.md.

### Renderer contract (per tick)
- **Paint progress**: panel `paint = { face, color | texture, coverage, bands: [{from, to, coverage}] }`
  (coverage of the whole face and per 0.2 m band from its bottom edge, 0.01 steps); in a take it is the
  `paint` field (take/recorder.ts FIELDS), so `sampleTake(...).entities[id].state.paint`.
- **Painter's hands**: `human.hands` (live); from a take, `paintHands(panel, painter, grip.slot)` rebuilds
  them exactly (slot `paint:<face>:<u>:<h>` = brush at face coords, u across from the painter's left edge).
- **Panel carry tilt**: the carried panel's pose (`pitch`/`roll` stay 0 on the flat; `tiltOf(pose)` in
  `carry/fragile.ts`); mounted tilt = the installed pose's `pitch` or `roll`. Equipment: entity `equipment`
  (take field `equipment`).

## Approximate / not modelled
- Tilt legs / rear risers of a tilted mount are implied (both rails sit on the deck; the panel's low edge
  on them); the tilt direction is always +pitch / +roll (no azimuth choice).
- Rails / equipment / low panels are set in place from ≤ 1 m (longer moves are `carry`); rails on a deck
  are assumed screwed to the sheets; roof decks with slope are not modelled.
- Painting: flat upright faces only, a single rectangular face per call, no drips / layers / drying; the
  band below 0.5 m (crouching) is out of reach; coverage is an area fraction, not a texture mask.

# SCHEMA — the vocabulary of this world (generated from GET /v1/god/schema)

contract god-schema/1. Regenerate: `node eden-god.mjs schema --md > SCHEMA.md`.

## Conventions
- **units**: metres, radians; +x east, +z south, +y up; origin at the world centre
- **yaw**: rotation about +y; a thing's front faces +z at yaw 0 (buildings: the `front` side); facing a point (dx, dz) is yaw = atan2(dx, dz)
- **position**: p: [x, z] rests on whatever is below (ground, floor, water for anchor float); [x, y, z] keeps y (local to the parent frame)
- **forms**: point defs take p; path defs take shape.path (+ width); area defs take shape.area
- **addressing**: ids (e_…), paths of names (cottage/kitchen/chair-1), flag:<name>; in a batch, tmp ids ($c) refer to things placed earlier in it
- **layers**: solid collides with solid and bodies; surface drapes (roads, lawns); volume is inside-able (water); decor never collides
- **rooms**: buildings expose each room as a slot of kind room: in: {parent: house, slot: "kitchen"}, p local to the room origin
- **library**: search the library first (GET /v1/god/defs?q=duck); define only what is missing; prefer params and presets over new kinds

## Generators (what defs are made of; `params` with range and default)
### box/1 (point, L1)
A plain box (w × h × d). Placeholder for anything; top is a surface slot.
- `w` number 0.05…400 = 1
- `h` number 0.05…120 = 1
- `d` number 0.05…400 = 1
- `color` color = #9a9a9a

### landform/1 (point, L1)
Terrain: point → bump (hill, knoll, mountain); path → ridge; area → plateau (height > 0) or carve (height < 0).
- `height` number -200…400 = 6
- `radius` number 1…2000 = 20
- `peak` number 0.25…6 = 1 — 1 round, 3 alpine
- `edge` number 0.5…200 = 8

### lake/1 (area, L1)
A lake or pond: carves a bed `depth` below `level` and fills it with water.
- `depth` number 0.2…60 = 4
- `level` number -100…400 = -0.3
- `edge` number 0.5…60 = 6

### scatter/1 (area, L1)
Simple scatter over an area (forest, meadow, garden). See scatter/2 for palettes and rules.
- `density` number 0.001…10 = 0.05
- `minSpacing` number 0.2…50 = 2
- `radius` number 0.1…10 = 0.4
- `height` number 0.1…60 = 6

### kit/2 (point, L1)
A prop or creature built from rounded primitives (box, rbox, cyl, cone, capsule, sphere, wedge, arch, ring, torus, lathe, extrude, sweep). Shapes live in make.args; instance params may recolour tints.

### building/1 (point, L2)
A building with floors, rooms, doors, windows, stairs and a roof. Rooms are slots (`in: {parent, slot: "kitchen"}`). Style presets plan the rooms; `plan` overrides.
- `w` number 3…40 = 8 — width (x) in metres
- `d` number 3…40 = 6 — depth (z) in metres
- `floors` int 1…6 = 1
- `floorHeight` number 2.4…5 = 2.8
- `style` enum cottage|townhouse|hall|barn|tower|pavilion|greenhouse|shed|shop|chapel = cottage
- `roof` enum gable|hip|flat|shed|dome|none = gable
- `roofPitch` number 0…60 = 32 — degrees
- `material` enum plaster|brick|stone|wood|glass|metal = plaster
- `wall` color = #f1e7d2
- `trim` color = #6b4a2b
- `roofColor` color = #8a3b2a
- `front` enum s|n|e|w = s — side of the main door (s = +z)
- `porch` number 0…4 = 0 — porch depth in metres (0 = none)
- `balcony` bool = false
- `windows` number 0…1 = 0.6 — window density along exterior walls
- `plan` json — optional explicit plan: {floors:[{rooms:[{id,name,rect:[x0,z0,x1,z1]}],doors:[…],exterior:[…]}],stairs:[…]}
- `wallThickness` number 0.1…0.6 = 0.22

### stairs/1 (point, L2)
A straight flight of stairs from y=0 to `rise`, `run` long, `width` wide; a link between two levels.
- `rise` number 0.3…12 = 2.8
- `run` number 0.5…20 = 4
- `width` number 0.6…6 = 1.1
- `material` enum wood|stone|metal = wood
- `rail` bool = true

### animals/1 (area, L4)
Animals living in an area: species (or a def ref of a kit creature), count, behaviour (wander, graze, swim, perch, sleep, fly). Moves on every viewer identically; no server cost.
- `species` enum dog|cat|pug|duck|goose|chicken|sheep|goat|cow|horse|pig|fox|deer|rabbit|bird|crow|seagull|koi|fish = dog
- `def` ref — use a kit creature def instead of the species mesh (e.g. "core/dog@1")
- `count` int 1…60 = 3
- `behavior` enum wander|graze|swim|perch|sleep|fly|follow = wander
- `speed` number 0.1…6 = 1
- `scale` number 0.3…3 = 1

### road/1 (path, L3)
A road along a spline: width, material, kerbs, shoulders; follows and grades the terrain; auto-bridges water when asked.
- `width` number 2…30 = 6
- `material` enum asphalt|cobble|gravel|dirt|sand = cobble
- `kerb` bool = true
- `shoulder` number 0…4 = 0.6
- `maxGrade` number 0…0.2 = 0.08 — carve/fill to keep slope below this (0 = follow terrain)
- `autoBridge` bool = true
- `lines` bool = false

### path/1 (path, L3)
A footpath: narrow, follows the terrain, gravel or stepping stones.
- `width` number 0.5…6 = 1.6
- `material` enum gravel|dirt|cobble|stone|wood = gravel
- `edging` bool = false

### wall/1 (path, L3)
A freestanding wall along a path (garden wall, partition, rampart) with optional gates at arc-length positions.
- `height` number 0.3…12 = 1.8
- `thickness` number 0.08…3 = 0.3
- `material` enum stone|brick|plaster|wood|hedge|glass = stone
- `color` color = #c9c1b2
- `gates` json — [{at: metres along, width}]
- `cap` bool = true

### fence/1 (path, L3)
A fence of posts and rails (picket, rail, wire). Blocks walking, not sight.
- `height` number 0.4…3 = 1.1
- `style` enum picket|rail|wire|iron = picket
- `color` color = #e9e2d0
- `postSpacing` number 0.5…6 = 2
- `gates` json

### hedge/1 (path, L3)
A clipped hedge along a path.
- `height` number 0.3…4 = 1.2
- `width` number 0.3…3 = 0.8
- `color` color = #3f6b35
- `flowers` bool = false

### river/1 (path, L3)
A river along a path: carves a bed, fills with water flowing from the first point to the last; ends snap to lakes; waterfalls where the bed steps.
- `width` number 1…60 = 6
- `depth` number 0.2…10 = 1.2
- `level` number -50…400 = -0.3 — water level at the source; L3 interpolates along the flow
- `banks` enum grass|sand|stone|reeds = grass

### bridge/1 (path, L3)
A bridge deck along a short path (over water or a gap), with rails and posts; a walkable surface above the water.
- `width` number 1…20 = 3
- `deck` number 0…20 = 0.8 — deck height above the higher end
- `material` enum wood|stone|metal = wood
- `arch` number 0…6 = 0.6 — rise at mid-span
- `rails` bool = true

### power-line/1 (path, L3)
Poles along a path with drooping wires (decor).
- `spacing` number 10…80 = 30
- `height` number 4…20 = 8

### plaza/1 (area, L3)
A paved square with a pattern and an optional kerb.
- `material` enum cobble|stone|tile|brick|gravel|asphalt = cobble
- `pattern` enum grid|herringbone|radial|plain = grid
- `color` color = #b9b2a4
- `kerb` bool = true

### lawn/1 (area, L3)
A mown lawn or painted ground material (grass, sand, gravel, moss, mud, rock, snow).
- `material` enum grass|sand|gravel|moss|mud|rock|snow|dirt = grass
- `color` color = #6aa84f
- `edge` number 0…10 = 1 — soft blend into the ground (m)

### pitch/1 (area, L3)
A sports pitch with line markings and goals/nets: football, tennis, basketball, petanque, volleyball.
- `sport` enum football|tennis|basketball|petanque|volleyball = football
- `color` color = #4f8f3a
- `fence` bool = false

### deck/1 (area, L3)
A raised platform on posts (deck, terrace, pier when narrow) over ground or water; walkable surface with rails.
- `height` number 0…12 = 0.6
- `material` enum wood|stone|metal = wood
- `rails` bool = true
- `color` color = #a07a4f

### parking/1 (area, L3)
A parking area with marked bays.
- `bay` number 2…4 = 2.5

### garden-bed/1 (area, L3)
A planted bed: rows of vegetables or flowers in soil, optional low border.
- `crop` enum flowers|vegetables|herbs|wheat|pumpkins|mixed = mixed
- `rows` number 0.3…3 = 0.7 — row spacing (m)
- `border` bool = true

### orchard/1 (area, L3)
Trees in a grid (orchard, avenue block): species, spacing, age variation.
- `species` enum apple|pear|cherry|olive|lemon|oak|birch|pine|palm = apple
- `spacing` number 2…20 = 5
- `height` number 2…20 = 4.5

### scatter/2 (area, L3)
Ecological scatter: a species palette with weights, clustering, auto-exclusion of solids/roads/water, slope and water-distance rules, age/size variation from the seed.
- `palette` json — [{def, weight, nearWater?: m, minSlope?, maxSlope?, scale?: [min,max]}]
- `density` number 0.0005…8 = 0.03
- `cluster` number 0…1 = 0.4 — 0 uniform … 1 tight clumps
- `minSpacing` number 0.2…30 = 2
- `avoid` json — tags or layers to avoid (default: solid, road, water)

## Kit primitives (define-kit shapes)
kinds: box, rbox, cyl, cone, capsule, sphere, wedge, arch, ring, torus, lathe, extrude, sweep
roles (animation pivots): body, head, neck, tail, ear.l, ear.r, eye.l, eye.r, wing.l, wing.r, leg.fl, leg.fr, leg.bl, leg.br, leg.l, leg.r, arm.l, arm.r, fin, beak, snout, blade, wheel, door, lid, flame, light

shape fields: `kind`, `at` (array), `size` (array), `r` (number), `h` (number), `r2` (number), `scale` (array), `yaw` (number), `pitch` (number), `roll` (number), `color` (string), `material`, `tint` (string), `round` (number), `segments` (integer), `profile` (array), `polygon` (array), `path` (array), `arc` (number), `collide` (boolean), `role`, `pivot` (array), `glow` (number)

gaits: none, quadruped-walk, biped-waddle, bird-fly, fish-swim, hover

## Ops
- `place`: tmp, def, name, in, p, r, s, shape, anchor, params, state, seed, constraints, mode
- `remove`: id, cascade
- `move`: id, in, p, r, s, shape, constraints, mode
- `set`: id, state, params, name, constraints
- `clone`: id, tmp, name, in, p, r, count, step, mode
- `define`: def
- `world`: state
- `expand`: extent
- `answer`: prayer, text

## Constraints (persistent relations on entities)
- `float`: sink
- `ground`: —
- `facing`: ref, offset
- `along`: ref, t, side, offset
- `near`: ref, dist
- `inside`: ref
- `clear`: area

## Components
seat, bed, surface, container, carryable, opening, floor, stairs, ramp, water, landform, scatter, light, display, paint, plant, instrument, readable, workstation, boardGame, venue, carrier, foundation, place, spin, sway, hover, route, behavior, sign, body

## Slot kinds
seat, bed, surface, stand, door, hang, carry, socket, room, floor, roof, wall, post, perch, shelf

## Materials
wood, stone, plaster, brick, glass, metal, fabric, thatch, tile, ceramic, grass, water, sand, gravel, asphalt, cobble, dirt, rock, moss, mud, snow, leaf, bark, fur, feather, paint, plastic, paper, rubber, emissive

## Refusal codes
schema, def.unknown, def.budget, def.expansion, def.invalid, parent.unknown, slot.unknown, slot.incompatible, slot.full, size.range, extent.outside, overlap.solid, support.none, held.by-body, occupied.by-body, constant.immutable, float.no-water, constraint.unsatisfied, architecture.unreachable, architecture.headroom, entity.unknown, entity.limit, name.taken, params.invalid, state.invalid, undo.conflict

## Endpoints
- read: GET /v1/world/snapshot · GET /v1/world/ground · GET /v1/world/tiles/:tx/:tz · GET /v1/world/entities/:path · GET /v1/god/schema · POST /v1/god/query
- god: GET /v1/god/snapshot · GET /v1/god/defs?q=&tag= · POST /v1/god/dryrun · POST /v1/god/preview · POST /v1/god/act · POST /v1/god/undo[?group=] · POST /v1/god/redo · GET /v1/god/edits · GET /v1/god/stream (SSE) · GET /v1/god/prayers · POST /v1/god/answer

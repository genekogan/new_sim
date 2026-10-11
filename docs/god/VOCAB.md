# VOCAB — the universal catalogue, and how to induct a type

Gene (2026-10-11): a large, deeply parameterised vocabulary of object types, so a god can do almost anything up
front in any new world; findable by agents at scale; delivered efficiently. This page is the contract a worker lane
follows to add types. The mechanism lives in:

| piece | where |
|---|---|
| taxonomy (101 categories, synonyms, wanted types, world layers) | `packages/world-compiler/src/vocab/taxonomy.json` |
| conventions, actuators, interfaces, lint, manifest, facets | `packages/world-compiler/src/vocab/index.ts` |
| authoring helpers (`vocabDef`, `presetDef`, `setDef`) | `packages/world-compiler/src/core-kit/authoring/vocab-dsl.mjs` |
| pilot types (one file per worker: `vocab.mjs`, `vocab-2.mjs`, …) | `packages/world-compiler/src/core-kit/authoring/vocab*.mjs` → `core-kit/vocab*.json` |
| search, manifest, taxonomy, recommend, thumbs | `apps/server/src/god/catalog.ts`, `assets.ts` (`searchDefs`) |
| Souls acting on things (actuators) | `apps/server/src/god/actuators.ts` (+ `perceive.ts` built objects) |
| the look of the conventions and states | `apps/web/src/gen-mesh/vocab-look.ts` (wrapped round every mesh builder) |
| proof | `apps/server/src/god/catalog.test.ts`, `tools/god-skill/e2e/vocab-mech.mjs` |

## 1. How gods find things (what you are writing for)

```
eden-god taxonomy                                   # the tree, counts, empty categories, conventions, actuators
eden-god catalog [--category building] [--has slot:sit] [--page 2]   # one line per def (all of it fits in context today)
eden-god find bodega                                # words, synonyms, category words; ranked, with why
eden-god find --has actuator:door                   # by interface: slot:sit|lie|put-on, action:open, comp:light, actuator:power, param:taper
eden-god recommend a cosy corner shop with a bench outside and a street lamp   # needs → picks + an example batch
eden-god defs core/door@1                           # one def in full: params with ranges, slots, actions
```
HTTP: `GET /v1/god/catalog?category=&has=&tag=&form=&page=&per=&format=lines` (ETag; 304 when unchanged),
`GET /v1/god/catalog/taxonomy`, `GET /v1/god/defs?q=&category=&has=&form=&compact=1&offset=`, `GET /v1/god/recommend?intent=`.

A manifest line: `core/door@1 [component.opening] 1.3×2.4×0.2m kit/2 162t {open/close/lock/unlock} (sx∈0.8..1.8 … variant=panel|glazed|plank) aka front door,doorway — A free-standing door…`
(ref, category, size, how it is made, triangles, asset bytes, interfaces, params, synonyms, first sentence). So **the
name, the synonyms and the first sentence of the description are what an agent reads**: make them count.

## 2. Pick the route

| the type is… | route | example |
|---|---|---|
| a prop, fixture, furniture, small object, simple shelter (rigid, ≤ a few metres) | **kit/2 via `vocabDef`** (rounded primitives) | door, desk-lamp, phone-box, traffic-cone |
| a configuration of an existing generator (a building style, a road kind, a landform) | **`presetDef`** (extends + new defaults) | corner-shop = `core/shop@1` with 1 floor, 7 × 8 m |
| several existing defs placed together | **`setDef`** (`make: parts`) | cafe-terrace = 2 parasol tables + 4 chairs |
| something with real architecture (rooms, doors, stairs) or a path/area (roads, rivers, fields) | **a generator** (`packages/generators/src/*.ts` physics + `apps/web/src/gen-mesh/*.mesh.ts`) | building/1, road/1 |
| a sculpted or scanned model | **GLB** (`POST /v1/god/assets` or a core pack + `mesh.json`), then a def with category/synonyms | LM scans |

Prefer kit/2: it is code (tiny to deliver: 0 asset bytes), recolourable, and the look rules below are easy to keep.

## 3. The look (binding)
- Rounded low-poly, never voxel. `cbox` (chamfered box, 28 tris) is the workhorse; `rbox` for big soft masses; `box`
  only for thin boards; `cyl/cone/sph/cap/lathe` with 5–12 segments.
- Origin on the floor at the footprint centre; **front is +z**; y = 0 is the ground; metres.
- Triangle budgets by category (`vocab.triBudget`; build.mjs refuses over): object 400, furniture 600, living 600,
  vegetation/component 1500, vehicle 1200, utility 2000, building/public/transport/terrain/water 6000.
- Colours via tint keys (`'paint'`, `'frame'` …) with a palette; every tint key becomes a colour param (paint slots).
  Use the Eden palettes in the family files (warm stone, oak, sage, cream, iron); avoid pure primaries.
- Def fields that are enums: `layer` = solid · surface · volume · decor (decor = small, never blocks); `anchor` = base ·
  center · conform · drape · float. Component shapes (e.g. `readable: { pages }`, `spin: { axis, rpm, role }`,
  `container: { capacity }`) are in `componentsSchema`, `packages/world-compiler/src/schemas.ts`.
- Primitive gotchas: `cyl(at, r, h, c, { r2 })` — `r` is the bottom radius, `r2` the top; `extrude` lays its polygon
  in x/z and extrudes up `h` — to stand a trapezoid upright use `pitch: -Math.PI / 2` (polygon z becomes height,
  thickness goes towards −z). Parts in a role (`withRole`) move together about the role's pivot; a role with `spin`
  stops while its actuator is off (`on: false` / `playing: false`).

## 4. Parameters: the conventions
Every catalogue type declares its params with ranges and defaults; the compiler refuses anything outside them
(`params.invalid … must be one of …` / `… outside min..max`). `vocabDef` adds the convention groups for you:

| group | params | effect (any def: kit, generator, GLB) |
|---|---|---|
| `stretch` (default on) | `sx sy sz` 0.5–2 | per-axis scale; **physics too** (box, colliders, slots, floors, openings scale in `model.bake`) |
| `warp` (opt in) | `taper` −0.5–0.6, `bend` −0.5–0.5, `skew` −0.4–0.4 | vertex deformation over the height (visual, inside the box) |
| `paint` (default on) | `tint` colour, `vary` 0–1 | multiply every surface; per-instance colour variation from the seed |
| `wear` (default on) | `condition` new · worn · damaged · construction | faded; dark and askew; a scaffold round it |
| paint slots (automatic) | one colour param per tint key | recolour a part: `--param leaf=#2f5d8b` |
| `variants: [...]` | `variant` enum | shapes carry `when: 'variant=glazed'` (or `'variant=a|b'`, `'variant!=round'`) |
| options | any param | `when: 'awning'`, `'!awning'`, `'floors>1'` |

Narrow a range when the full one looks wrong (`ranges: { sy: [0.9, 1.3] }` for a door). A generator's native sizes stay
`w/d/h` in metres. Shapes may also read entity **state** with `@`: `when: '@open'` (viewer only, never a collider).

## 5. Interfaces: slots, actuators, affordances, states
**Slots** (how a body uses it) — Gene's words → slot kinds: sit → `seat`, lie → `bed`, stand-at → `stand`, hold →
`carry`, put-on → `surface`, contain → `shelf` (+ `container` component), mount → `socket`/`post`, attach → `hang`,
enter → `door`, inside → `room`, stand-on → `floor`, perch → `perch`. Helpers: `seat()`, `bedSlot()`, `surface()`,
`shelf()`, `stand()`, `socket()`, `hang()`, `perch()` in dsl.mjs. Souls are offered `sit:<thing>`, `put-on:<thing>`,
`pick-up:<thing>` (carryable component) by the engine bridge.

**Actuators** (state + actions Souls take): `actuators: ['door', 'lock']` with `label: 'the door'`.

| actuator | state | actions | viewer draws it with |
|---|---|---|---|
| `power` | `on` | switch-on / switch-off ("turn off the lamp") | glow parts (and role `light`/`screen`) go dark; a `light` component's lamp logic |
| `door` | `open` | open / close ("shut") | role `door` swings −86° about its pivot (**put the pivot on the hinge edge**); role `lid` tips back |
| `lock` | `locked` | lock / unlock (only while closed; open refuses while locked) | — |
| `fill` | `level` 0–1 | fill / empty | role `fill` scales up from its pivot (put the pivot at the bottom) |
| `ignite` | `lit` | light / put-out ("put out the fire", "blow out") | role `flame` shows only when lit |
| `play` | `playing` | play / stop | — (sound is an open world layer) |

Defaults: `actuators: [['power', { default: true }]]`. Any other declarative def action (`when` on own state, `then`
set/toggle) works the same. What Souls get, with no edge code: in `observe` the thing is an object whose public
`state` shows `{open:false, locked:false}`; `capabilities` offers `object:<entity>:open` (blocked with the reason when
the state forbids it); acting walks the body up to the thing's front and reaches out; the state change is an engine
edit (in the history, broadcast to viewers, not the god's to undo); the words "open the blue door" resolve to it.

**Components** that are affordances by themselves: seat, bed, surface, container, carryable, light, readable, sign,
instrument, workstation, boardGame, venue, carrier, place, water, stairs, ramp (see `COMPONENT_VERBS`).

## 6. Composition
- **Presets** (`presetDef`): `extends: 'core/shop@1'` + new defaults; the god gets a new name, synonyms, a category.
- **Sets** (`setDef`): `parts: [{ id, def, p, r, params?, when?, repeat? }]`; placed as one, each part is its own
  entity afterwards (moveable, sit-able). Parts may sit in slots (`slot: 'top'`) of another part (`in`).
- **Buildings from components**: the building generator places doors/windows/stairs from its plan; free-standing
  component defs (door, window) are for follies, walls and sheds. Rooms are furnished with `furnish` (L2 recipes).

## 7. Induct one: the checklist
1. Name it as people do (`kebab-case`), pick the most specific **category**, write 3–8 **synonyms** (regional words:
   bodega, call box, witches hat) and a first sentence that says what it is, its size and its use.
2. Author it in your worker file (`authoring/vocab-<n>.mjs`) with `vocabDef` / `presetDef` / `setDef`.
3. `node packages/world-compiler/src/core-kit/authoring/build.mjs` — writes the JSON, measures real triangles, runs the
   **lint** (`vocab.lintDef`: category known, description, numeric params ranged with defaults inside, conventions
   typed right, actions use declared state, slots fit the category, tri budget). It exits 1 on any error.
4. Look at it: `node tools/god-skill/scripts/thumbs.mjs --port <yours> --q "<name>" --limit 3` (`--q` is a search,
   one name at a time; it re-renders whatever matches) (real Chrome via the
   lease; PNGs in `.lane/thumbs/`), and for variants/states place them in a dev world and screenshot (see the e2e).
   Fix what looks wrong; never ship a type you have not looked at.
5. Tests: `node --test apps/server/src/god/catalog.test.ts` (it lints every def with a category). Add an e2e step only
   for a new kind of interaction.
6. Take the type out of the category's `want` list in taxonomy.json if it was there.

## 8. Delivery and caching
- Kit and generator types cost **0 asset bytes** (the shape list travels in the def, a few KB). GLBs are content-addressed:
  `/assets/<sha256>.glb`, `cache-control: public, max-age=31536000, immutable`, ETag = sha; a viewer only ever
  fetches the GLBs of defs in use, when it draws them (`gltf-assets.ts`), each once per browser.
- Thumbnails: `/thumbs/<def hash>.png`, immutable (content = the def's hash).
- The manifest has an ETag over the library's def hashes: an agent re-reads it for free (304) until the library changes.
- Bucket plan for when assets leave the box: `tools/god-skill/scripts/bucket-plan.mjs` (dry run; layout, headers).

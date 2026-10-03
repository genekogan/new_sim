# Architecture audit — campus-2026-reconstruction viewer (2026-09-27)

> Inherited native reference: source dates, release IDs and operating instructions
> retain their original scope. For the current Eden fork use [the index](README.md),
> [STATUS](../STATUS.md) and the Sim runbook; this file is not production authority.


Scope: `viewer/app`, `viewer/lib`, `viewer/simulation`, `viewer/deploy`, plus the asset
manifests they depend on. Written for the design of a deterministic Mars world engine
(SPEC §3, 5, 6, 10–13, 21–24). No source was modified by this audit. Line numbers refer
to the tree at commit `3c34ade` plus the lead's later `walking.ts` edit (+3 lines after
line 19).

---

## 0. Headline findings

1. **"Upright" is overloaded.** The stock library (`components/catalog.json`,
   `public/modular/upright_frame_*.glb`) uses *upright frame* = the full two-column
   braced frame (owner's meaning). The procedural kit (`app/history/kit.ts:41`) and the
   2020 scene (`app/studio-2020/scene.ts:43`) name each **single post** `'rack upright'`.
   The 2026 GLB has no frames at all: it has 667 `rack_member` meshes (single posts,
   braces and fragments from CAD). See §2.4.
2. **No 9 ft component exists anywhere.** Nominal sizes in code are 8, 12, 16 and 19 ft
   uprights (4 ft or 3 ft wide) and 12 ft beams. The 2026 CAD posts measure 4.29, 4.88
   and 5.97 m. See §2.4.
3. **The server simulation is analytic, not stepped.** State holds immutable polyline
   paths, each with a start time on an anchored virtual clock. Poses are evaluated on
   demand as `f(path, t)` (`simulation/shared.ts:95`). The server has no tick, alarm or
   per-frame stepping. Browsers poll once per second and evaluate the same functions
   every frame.
4. **Navigation is a 1 m occupancy grid with 8-connected A\*** (`app/studio/ambience-math.ts:21-199`).
   Obstacles are mesh AABBs inflated by 0.4 m. People can use only ±60 m around the
   origin, and EUCs ±220 m. There is no path smoothing for people and no corridor
   structure. Interiors and stairs are not routable.
5. **Two navigation sources can disagree.** The server uses a baseline catalog
   generated offline (`simulation/catalog.json`). The browser rebuilds its own grid from
   live, possibly edited geometry (`campus-life.ts:82`). The EUC perimeter is also
   computed on both sides.
6. ~~**Historical component IDs are order-dependent serials** (`kit.ts:23-24`).~~ Fixed
   2026-09-27, see `HISTORY_IDS.md`: ids are now `${assembly}-${kind}-${placement hash}`
   (or an explicit `Kit.named` pin), and legacy serial ids in saved layouts migrate through
   the frozen `app/history/id-migration.json`.
7. **`app/studio/page.tsx` (1700 lines) is one 935-line `useEffect`** (206–1141). It
   bundles scene loading, editing, layout I/O, GLB export, the remote-snapshot adapter
   and the render loop. It can be separated along clear seams (§11.3).
8. **Test status:** 48/48 pass (§9). `simulation/.wrangler/` DO state files are committed
   to git (hygiene issue). `public/modular` and `public/data` are **symlinks outside the
   repo**, so a clone cannot serve 2026 or regenerate catalogs.

---

## 1. Module map

Sizes are lines / bytes. ★ marks modules the engine should subsume or wrap.

### viewer/app
| File | L / B | Responsibility |
|---|---|---|
| `main.tsx` | 53 / 1.6k | Path router: `/studio`, `/studio/2020…2026` → Studio(year), `/simulation-guide`, `/` → drone reconstruction (29–51). |
| `page.tsx` | 537 / 16.5k | `/` drone-reconstruction comparison viewer. Loads `/data/manifest.json` (67). Independent of the studio. |
| `globals.css` | 595 / 9.7k | Global styles. |
| `simulation-guide/page.tsx` | 121 / 4.7k | Human MCP guide. Renders `definitions` from `simulation/commands.ts`. |
| `studio/page.tsx` ★ | 1700 / 57.7k | Studio shell. Handles renderer and scene, selection and TransformControls editing, cutaway and material modes, layout save/restore, GLB export, stock library, remote-snapshot application and the frame loop (§11.3). |
| `studio/studio.css` | 867 / 15k | Studio styles. |
| `studio/simulation-panel.tsx` | 441 / 14.3k | Room UI: capability creation and hashing, 1 Hz polling with backoff, command sending, spectator links. |
| `studio/ambience-math.ts` ★ | 220 / 7.3k | `GROUND=-0.16`, `daylightAt(hour)`, `CampusPaths` (grid, A\*, BFS wander), `campfireClearing`. Shared by browser and Worker. |
| `studio/campus-life.ts` ★ | 394 / 12.3k | Animated visitors (Quaternius skinned clones, Idle/Walk/Wave mixers). Local dt-stepped roaming or remote analytic poses. Owns scenery and EUC riders. |
| `studio/euc-riders.ts` | 267 / 9.1k | EUC plus rider rigs, riding-stance bone fitting, perimeter path, pose application. |
| `studio/euc-follow-camera.ts` | 72 / 2.4k | Epicycle orbit camera that follows rider 0 with Chiba as backdrop. |
| `studio/camera-ground.ts` | 33 / 0.9k | Keeps the camera near-plane above the ground. |
| `studio/walking.ts` | 358 / 11.1k | First-person WASD: `WalkingBody` (4 m spatial hash of meshes, raycast collisions) and `attachWalking` input. |
| `studio/environment.ts` | 209 / 7.5k | Sky shader, sun/moon/hemisphere lights, stars, soil, fog, grid. Driven by hour and weather. |
| `studio/weather.ts` | 102 / 3.8k | GPU rain line segments with a roof heightmap occluder. |
| `studio/scenery.ts` | 204 / 7.6k | Campfire (flames, embers, light), instanced grass, dust motes. |
| `studio/gallery.ts` | 178 / 6.4k | 2026 hall projector plus 6 gallery monitors (shader programs art/talk/test). |
| `history/kit.ts` ★ | 82 / 9.4k | `Kit`: procedural component builder (assembly/tag/box/rod/frame/deck/wall/stairs/solar/table/screen/kitchen/rv/visitors). `BAY=3.6576`, layer names. |
| `history/scenes.ts` ★ | 136 / 14.2k | `YEARS`, `historyNotes`, `make2021…make2025`, `tag2020`, `createHistoricalScene(year)`, `sceneManifest(root,year)`. |
| `history/photographic-corrections.ts` | 65 / 4.7k | `aluminet2021` (sagging canopy), `frontage2024` (raked PV and glazing façade). |
| `history/details-2026.ts` | 23 / 3.0k | Procedural 2026 kitchen and Mimos café props attached to the `Chiba` node. |
| `history/screens.ts` | 16 / 2.0k | Maps historical display meshes onto the 7 shared screen IDs. |
| `studio-2020/scene.ts` | 387 / 26.6k | `createBrahman2020Scene()` (Portal, Forest, trees, RVs). Used by `scenes.ts:133`. |
| `studio-2020/page.tsx`, `style.css` | 296+53 | **Dead code.** Not imported anywhere. `/studio/2020` renders the shared Studio. |

### viewer/lib
| File | L / B | Responsibility |
|---|---|---|
| `layout.ts` | 78 / 2.4k | Zod schema and `validateLayout` for saved layout JSON (`schema_version:1`, max 300 additions, year check at 57). |
| `layout-transforms.ts` | 43 / 1.2k | Nested child transforms for copied or added assemblies (`path:int[]`). |
| `render-batches.ts` | 123 / 3.8k | Merges static meshes per material and 24 m cell into render-only batches. Originals stay pickable on layer 1. |
| `three-resources.ts` | 107 / 3.5k | `ThreeResources` disposal owner, `loadGltf` (with meshopt decoder), `isVisible`. |
| `snapshot-order.ts` | 8 / 0.3k | `acceptsSnapshot`, which rejects stale poll responses. |

### viewer/simulation
| File | L / B | Responsibility |
|---|---|---|
| `worker.ts` ★ | 383 / 13.5k | `MarsSimulation` Durable Object (SQLite) and `handleSimulation`: auth, HTTP state/command endpoints, MCP server. |
| `model.ts` ★ | 498 / 17k | `createSimulationModel(catalog, year)`: nav grids, `normalizeState`, `initialState`, `move`, the `command` reducer; `modelForYear` cache. |
| `shared.ts` ★ | 248 / 7.1k | State types and pure evaluators: `simTime`, `motionPose`, `hourAt`, `perimeter`, `eucPose`, `riderPose`, `cameraPose`. Imported by browser and Worker. |
| `commands.ts` | 197 / 7.8k | Zod schemas and descriptions for 18 commands. |
| `catalog.json` | 646k | Generated 2026 nav catalog: 18 people (8 roaming), 5390 obstacle AABBs, bounds. |
| `history-catalogs.json` | 591k | Generated 2020–2025 catalogs (people/obstacles: 7/726, 12/766, 16/704, 22/892, 22/923, 22/849). |
| `wrangler.jsonc` | 10 | Isolated local DO worker (`mars-simulation-test`, migration tag `v1`). |
| `env.d.ts` | 584k | Generated Wrangler types. |
| `README.md` | 36 | Control-plane design notes. |
| `.wrangler/state/**` | — | **Local miniflare DO SQLite, committed to git.** Should be ignored. |

### viewer/deploy
| File | L | Responsibility |
|---|---|---|
| `catalog.mjs` | 76 | Strips textures from `public/modular/campus-components.glb` and parses it in Node with GLTFLoader. Adds `details-2026` via esbuild bundling and a canvas stub. Emits `simulation/catalog.json`. |
| `history-catalog.mjs` | 17 | Bundles `scenes.ts` and builds each year in Node. Emits `history-catalogs.json` (roaming = `people.length%4!==0`, line 13). |
| `configure.mjs` | 71 | Post-build step. esbuild-bundles `simulation/worker.ts` and writes `dist/server/cloudflare-entry.js` (routes, R2 downloads) and `cloudflare.json` (DO migration `simulation-v1`, R2 `MODELS`). |
| `prepare.py` | 98 | Stages allowlisted public release to `.cloudflare/public`, splits files >25 MiB into `.cloudflare/large`, scrubs paths, writes release manifest. |
| `browser-model.py` | 22 | Repacks the campus GLB with textures capped at 1024 px into `public/browser/campus.glb`. |
| `compress-browser.mjs` | 111 | Lossless meshopt geometry compression, verified, plus a `.br` variant. |
| `http-compress.mjs` | 21 | Brotli helper. |
| `upload.mjs` | 41 | Resumable R2 upload of large assets keyed by content hash. |
| `downloads.mjs` | 105 | Worker R2 streaming: Range, HEAD, ETag, Brotli negotiation. |
| `smoke.mjs`, `compression-smoke.mjs` | 65, 9 | Post-deploy HTTP smoke checks against `SITE_BASE`. |
| `simulation-integration.mjs`, `history-integration.mjs` | 230, 25 | Real MCP client against a running worker (`SIM_BASE`, default `:8797`). |
| `deployment.json` | 20 | Live URLs and last Worker version `763de986…`. |
| `README.md` | 143 | Release runbook and feature notes. |
| `*.test.mjs` (12 files) | — | See §9. |

### viewer/engine — **new, in progress**
Added by the lead engineer after this audit began: a pure-TS engine core (world model,
history store, action runtime, grid navigation) with `npm run test:engine`
(`node --test engine/test/*.test.ts`). It was not audited here. `package.json` also now
has `e2e` Playwright scripts and lints `engine/`.

---

## 2. Scene graph and component model

### 2.1 Coordinate conventions
Units are metres, Y up, and ground plane `y=-0.16` (`ambience-math.ts:3`; ground mesh
`environment.ts:126`). The 2026 GLB origin is CAD X=177 m, Y=66 m (Blender Z-up →
glTF Y-up; scene extras). Chiba is near `[0,2,8]` in 2026 and near the origin in
historical years (landmarks `worker.ts:294-295`).

### 2.2 The 2026 model (GLB)
- **Runtime asset:** `/browser/campus.glb?v=20260922b` (`studio/page.tsx:489`), 70.8 MB,
  or 38.5 MB with Brotli. It is derived from
  `public/modular/campus-components.glb` by `browser-model.py` and
  `compress-browser.mjs`. It has 6498 nodes, 4772 meshes, 713 materials and 376 images,
  plus `EXT_meshopt_compression`. It has **no GPU instancing** and no animations.
  Root node: `"Mars 2026 • Editable campus"`.
- **Node extras are the component model** (userData after load):
  `component_id` (e.g. `rack_member-0001`), `definition_id` (e.g. `cad-3f2d0e77ea4116`),
  `kind`, `layer`, `assembly_id`, `source_mesh`, `source_parent`, `accuracy`, and
  optionally `finish_status`, `evidence`, `geometry_refinement`.
  Kinds: cad_component 3585, wood_component 1985, rack_member 667, beam_candidate 89,
  transparent_panel 78, solar_assembly 33, context_person 18, context_group 2.
  Layers: `Fittings and furniture`, `Timber, floors and stairs`, `Rack steel`,
  `Walls and screens`, `Roofs and upper floors`, `Glazing`, `Solar and equipment`,
  `People`, `Aerial reference`.
  Assemblies: `chiba`, `north-workshops`, `north-rack-building`,
  `northeast-compound`, `west-rack-building`, `site-context`, `people`.
- **The manifest JSON lives at `public/modular/components.json`** (6.2 MB,
  `schema_version:1`). Its keys are `assemblies[7]`, `definitions[4539]`,
  `instances[6459]`, `counts_by_kind`, `limitations`, `refinements`,
  `coordinate_origin_CAD_m`. Instances carry `cad_bounds_m`, `position_m`,
  `source_ancestors` and `finish_source`. Every definition has
  `nominal_stock_id: null` and `dimension_status: preserved_source_CAD_not_verified_stock`.
  - The generator is `scripts/build_modular.py` (manifest at line 156).
  - **`public/modular` is a symlink** to `<mars-media>/reconstruction/2026-campus/modular/deliverable`,
    outside git. The same applies to `public/data`.
  - **The studio does not read `components.json` at runtime.** It rebuilds a slim
    manifest by traversing the loaded scene (`sceneManifest`, `scenes.ts:136`, called at
    `studio/page.tsx:503`).
- **Procedural additions for 2026:** `add2026Details(root)` (`details-2026.ts:5-23`)
  attaches the kitchen (`kitchen-details`) and café (`mimos-details`) assemblies under
  the `Chiba` node. `createGallery` adds screens as a *non-editable overlay* that tracks
  the Chiba matrix (`gallery.ts`).

### 2.3 Historical scenes (procedural)
- `createHistoricalScene(year)` (`scenes.ts:132-135`):
  - 2020 → `createBrahman2020Scene()` then `tag2020` (131), which retrofits
    assembly/component/layer data using name regexes.
  - 2021–2025 → `make20xx(k)` on a fresh `Kit`, then `k.visitors(n)`.
- **`Kit`** (`kit.ts:6`) caches geometry and material per scene.
  - `assembly(id,name,p,rot,source)` (19–21) creates a Group with
    `userData {assembly_id, source, year}`.
  - `tag(g,o,name,layer,definition)` (22–25) assigns
    `kind = definition_id = name`, `layer` and `source`; `finalize()` then sets a
    stable `component_id = ${assembly_id}-${kind}-${hash}` (HISTORY_IDS.md).
  - Primitives:
    - `box` (26)
    - `rod` (30)
    - `frame(g,nx,nz,h=4.8768,upper,depth)` (34–46)
    - `deck` (47)
    - `wall` (50)
    - `stairs` (51–54): risers carry `walkNoCollision`
    - `solar` (55)
    - `table` (64)
    - `screen` (65)
    - `kitchen` (70)
    - `rv` (80)
    - `visitors` (81): Groups with `kind:'context_person'`, ids `person-N`
- `hall()` (`scenes.ts:14-16`) combines frame, ground deck at 0.22 m and roof deck at
  2.46 m (optionally with an open centre aisle).
- **Materials:** keyed by `color+metalness` (`kit.ts:12-15`). Certain plywood hex
  colours are silently swapped to a shared plywood texture. Photo materials are keyed
  by URL (16–18). Materials carry no semantic identity. Material state is only the
  studio's `source` / `generic` display toggle (`studio/page.tsx:449-478`).
- **Layers** (`kit.ts:3`): `Rack steel`, `Timber, floors and stairs`,
  `Roofs and upper floors`, `Walls and screens`, `Interior details`, `Site context`.
  The same strings are used by cutaways (`studio/page.tsx:433-448`: `inside` hides roofs
  and walls, `frame` keeps only steel and timber), rain roofs (`weather.ts:64`) and
  batching exclusion (`render-batches.ts:47`).
- **ID semantics** (`studio/page.tsx:330-335`): `idOf` = `edit_id` ‖ `component_id` ‖
  (`assembly_id` when the node has no `layer`, i.e. assembly groups). Selection scope
  `assembly` climbs to the nearest assembly group (554–563).

### 2.4 Pallet-rack naming and real dimensions
| Where | Name | Meaning | Dimensions (m) |
|---|---|---|---|
| `components/catalog.json` + `public/modular/stock-library.json` + GLBs | `upright_frame_8ft_4ft` | **Full frame** (two columns plus bracing, one mesh; origin at base of one column) | h 2.4384 × w 1.2192 × 0.07 |
| same | `upright_frame_12ft_4ft` | full frame | 3.6576 × 1.2192 |
| same | `upright_frame_16ft_3ft` | full frame | 4.8768 × 0.9144 |
| same | `upright_frame_19ft_3ft` | full frame | 5.7912 × 0.9144 |
| same | `horizontal_beam_12ft` | orange beam | 3.6576 × 0.16 × 0.076 |
| same | `plywood_panel_template` | 4×8 blank | 1.2192 × 2.4384 × 0.018 |
| same | `timber_template` | 2×4 × 8 ft | 0.089 × 0.038 × 2.4384 |
| `kit.ts:41` | `'rack upright'` | **Single post** (0.075² box); pairs at ±frameWidth/2 | h default 4.8768 (16 ft) |
| `kit.ts:42-43` | `'upright bracing'`, `'upright crossbar'` | separate brace meshes | — |
| `kit.ts:35` | frame width rule | `h>3.66 ? 0.9144 : 1.2192` | 3 ft / 4 ft |
| `kit.ts:45` | `'12 foot orange beam'` | beam, levels at 0.22 / 2.48 / h−0.12 | 3.6576 |
| `scenes.ts:58` | 2021 utility kitchen frame | 8 ft | h 2.4384 |
| `scenes.ts:119` | `'19 foot central upright'` (2025) | single post | 5.7912 |
| `studio-2020/scene.ts:41-48` | `upright()` makes two `'rack upright'` posts plus diagonals; `'12 ft rack beam'` | posts | 4.88 default; Forest 5.7912 (238); 4.05 / 3.06 m (113, non-nominal) |
| 2026 GLB `rack_member` | CAD meshes | single vertical posts (0.09 m section) and brace fragments, **not frames** | posts: 4.29 m (76), 4.88 m (54), 5.97 m (40); ~0.91–1.25 m pieces (bracing/frames). `beam_candidate`: 3.65 m (24) plus ~2.9–3.5 m panels |

Implications:
- The engine needs an `upright_frame` asset definition (owner semantics). It also needs
  an adapter that groups kit post pairs plus bracing into one frame placement for
  2021–2025, or kit changes that emit frames as a unit.
- The 2026 CAD posts are not mapped to stock (`limitations[0]` in `components.json`).
  4.88 m matches 16 ft. 5.97 m is ~19.6 ft (19 ft plus base plate?). 4.29 m (~14 ft) is
  non-nominal. Mark all of these provisional.
- The owner's "8/9/12/19 ft" list conflicts with the catalog's 8/12/16/19 uprights and
  12 ft beams. **9 ft (2.7432 m) appears nowhere.** The owner needs to confirm.

---

## 3. Layout editing, persistence, export, years

- **Editing** is browser-local only (`studio/page.tsx`):
  - TransformControls, snap 0.01 m / 1° (275–281)
  - numeric move / rotate / scale (675–686, 808–822)
  - duplicate (823–836) → `add('copy:<id>')`
  - stock additions from `STOCK` (102–115) loaded from `/modular/<id>.glb` (583–594),
    max 300 (648)
  - `reset` restores `baseline` snapshots taken at load (`remember`, 419–432; 840–867)
- **Edit record** (`lib/layout.ts:22-37`): `{id, position, quaternion, scale, added?, children?[]}`.
  Save (868–884) downloads `{schema_version:1, base_model:'mars-campus-modular-v1', year, units, up, edits:[all objects]}`.
  - Restore (885–928) validates first (unknown IDs, duplicate IDs, cross-year: `layout.ts:57`),
    preloads all additions, then applies everything, so it is atomic.
  - There is no server persistence of layouts. Nothing is versioned.
- **GLB export** (929–974): SkeletonUtils-clones `root` and `additions` with original
  materials, inside `life.withOriginals` so animated people revert to source placements.
  Then `GLTFExporter` produces binary output for a blob download. The default download
  links are `/modular/campus-components.glb` and `component-library.glb` (1430–1437).
- **Room lock:** joining a simulation room forces inspect mode and blocks edits
  (687–706, 645–654, 667–674). Remote simulation always uses the *baseline* catalog.
- **Years:** `YEARS=[2020..2026]` (`scenes.ts:5`). Routes are `/studio` (2026) and
  `/studio/202X` (`main.tsx:39-40`; server allowlist `configure.mjs:35`).
  - The year picker does a full page navigation (`studio/page.tsx:1177`).
  - Per-year: references `/history/<year>/references.json` (198), rider count (506),
    visitors count (`scenes.ts:134`), and localStorage room key
    (`simulation-panel.tsx:115,190`).
- **Historical corrections to preserve (regression-tested, §9):**
  - **2021:** two parallel wings (`make2021`, `scenes.ts:42-61`, wings rotated 90°, 6×2
    bays, wingDepth 4.572) with a *bare-ground* central corridor as wide as a wing.
    `aluminet2021` is a sagging woven canopy at ~4.25 m with `walkNoCollision`
    (`photographic-corrections.ts:5-22`). Also: MARS cutout letters, classroom, library
    nook, outdoor utility kitchen (8 ft frames), container, 15-RV ring.
  - **2022:** four identical 3×2-bay buildings rotated around a courtyard (pinwheel,
    `scenes.ts:62-87`, radius 8.6, shift 3) with four open corner passages. Also:
    per-building stairs, arches photo walls, blue west house, kitchen with smaller high
    roof.
  - **2024:** `frontage2024` (`photographic-corrections.ts:25-65`) is a raked façade
    (rise 4.64 / run 2.65). Stepped PV sits **only on the left**, salvaged glazing on the
    right, and the central flower mural stays exposed. There is a real ground-level
    doorway under the landing and red side stairs on a sheared support (`scenes.ts:102-107`).
  - Tests: `history-geometry.test.mjs:15,23,35`. Provenance text lives in `historyNotes`
    (`scenes.ts:6-13`) and `sceneManifest().limitations`.

---

## 4. Humans

- **Assets:** `public/modular/environment/animated-{casual,punk,woman}.glb` (Quaternius
  Animated Humans, **CC0**; `animated-people-source.json`). There are 67 nodes and one
  skin each. **Clips: `Idle`, `Walk`, `Wave` only** (parsed from the GLB JSON; the same
  for all three).
  - Rig bone names used: `UpperLegL/R`, `LowerLegL/R`, `FootL/R`.
  - Built by `scripts/prepare_animated_people.py` (Mirror modifiers baked).
  - The static stock `person_*.glb` files are unanimated.
- **Sources of people:** scene nodes with `kind:'context_person'`. In 2026 there are 18,
  from GLB extras, ids `context_person-009…`. Roaming means `assembly_id==='people'`,
  giving 8 in the catalog. In historical years they come from `kit.visitors`.
- **`campus-life.ts`:**
  - Clones a template per source using `definition_id → person_<name>`, scales to
    1.75 m and feet-grounds it (139–177). One `AnimationMixer` per actor.
  - Roaming = `assembly 'people' && index%4!==0` (191). The history catalog uses the
    same rule (`history-catalog.mjs:13`); the 2026 catalog uses the assembly rule only.
  - **Local mode** (304–351) is non-deterministic dt-stepping. BFS `paths.route(cell, seed)`
    picks a random cell 6–15 m away (LCG seed 16807). It moves at 0.85 m/s with slerp
    yaw. Crude yielding: stop if another actor is within 0.8 m ahead, re-route after 2 s.
  - **Remote mode** (298–303) uses `motionPose(command, simTime)` to set position and
    yaw directly.
  - Animation blending (352–376): Walk↔Idle crossfade 0.3 s, Wave weight 0.9 for
    `wave`, 0.35 for `talk`, and a periodic wave for non-roaming locals.
    `walk.timeScale=0.85`. There is no foot locking or speed-matched stride.
  - Editing, selection or reduced motion restore the static source people (230–233, 255–258).
- **`euc-riders.ts`:**
  - Up to 6 rigid EUC-plus-rider holders. The rider pose is Idle with fitted
    legs and feet (`fitRidingStance` 42–125).
  - Dismount is a static offset standing pose (246–255).
  - The perimeter path comes from local mesh bounds (139–161) via `shared.perimeter`
    (rounded rectangle 16 m outside the bounds).
  - Asset: Thingiverse 3001166, CC BY 4.0.
- **First-person walking (`walking.ts`):**
  - `WalkingBody.rebuild` (26–61) buckets visible meshes into a 4 m XZ spatial hash by
    world AABB. It skips people, `Aerial reference`, `kind:'reference'`,
    `walkNoCollision`, and anything spanning more than 2500 cells.
  - Movement (`step`, ~104–155) does axis-separated sliding: horizontal rays at 0.45 m,
    1.0 m and 1.65 m over the nearby meshes with 0.22 m clearance. Gravity is 14 m/s²,
    jump 5 m/s.
  - Floor is found by a down-ray, accepting faces with |n.y|>0.55. Step-up is 0.35 m,
    which is how stairs work. Ceiling check on the up-ray.
  - Fixed 1/90 s substeps (~321–343). Eye height 1.7 m. Speed 3 m/s, sprint 6 m/s.
  - Rays hit original meshes on layer 1, so render batching does not break collisions.
- **`camera-ground.ts`** clamps camera y ≥ ground + near-plane radius (+0.02) and the
  target y ≥ ground. It runs every frame (`studio/page.tsx:1091`).
- **`euc-follow-camera.ts`** runs a 60 s orbit with a 3-lobe epicycle at ~9 m radius and
  ~3 m height, with an exponential blend. Local only, and it pauses with the room.

---

## 5. Navigation and movement today

- **Obstacle derivation (offline):**
  - `catalog.mjs:38-66`: every mesh world AABB whose vertical span overlaps
    y∈(0.14, 1.69), excluding people and `Aerial reference`. (It does not exclude
    `site_context`; the history version does.)
  - `history-catalog.mjs:13`: `Box3.setFromObject` per mesh.
  - Output is a flat AABB list. Rotated meshes (Chiba is rotated about −0.44 rad) get
    inflated boxes. Any ground deck at 0.22 m blocks the whole footprint, so **building
    interiors are solid**. Indoor people cannot move (`model.ts:162-165`).
- **Grid (`CampusPaths`, `ambience-math.ts:21-199`):**
  - 1 m spacing, `size = 2·half+1`. People use `half=60` (121²); EUCs use `half=220`
    (441², `model.ts:42`).
  - A cell is blocked if an AABB (filtered to y∈[G+0.3, G+1.85]) inflated by 0.4 m
    covers it (31–37).
  - 8-connected neighbours with no corner cutting (83–105).
  - `pathTo` = A\* with octile heuristic and binary heap (106–171).
  - `route` = BFS wander to a seeded candidate 6–15 m away (172–198).
  - `nearest` = brute-force scan within a radius (47–65).
  - `clearLine` = 0.1 m sampled rasterised line test (67–82).
- **People routes** (`model.ts:153-193`): start = nearest free cell within 2 m of the
  current pose, end = within 1.5 m of the target, then A\*. The route is rejected unless
  both sub-cell connectors pass `clearLine`. Path = `[pose, …cell centres…, target]`.
  - **No smoothing or string-pulling for people.** Paths are 1 m zig-zags with 45°
    vertices, and heading snaps at each vertex (`shared.ts:121`).
  - Groups (`move_group`, 212–233) use a 3-wide formation; `start_activity` uses a
    3.5 m-radius ring. Each member is routed independently, with **no inter-agent
    avoidance or timing**.
- **EUC routes** (`model.ts:50-74`): straight line if clear, else A\* on the 441² grid,
  then greedy line-of-sight shortcutting (up to 24 nodes ahead).
  - Circling = fixed rounded-rectangle perimeter from catalog bounds (`shared.ts:154-182`).
    In 2026 this is ~300 m around, because the bounds span x −179…86 and z −136…59.
  - Heading is smoothed by sampling ±0.5 m (`shared.ts:195-205`).
- **Wander loops** (`model.ts:102-121`): BFS route out and back, looped forever and
  staggered.
- **Pose interpolation:** `motionPose(m, t)` (`shared.ts:95-140`) computes arc length =
  `(t−started)/1000·speed`, looped modulo total or clamped. Position is lerped within a
  segment and yaw = segment direction. Per-path segment lengths are cached in a WeakMap.
  Constant speed with no acceleration, turn radius or arrival orientation. The final
  yaw keeps the last segment's direction.
- **Browser rendering of server motion:**
  - The poll delivers `state`, and the browser keeps `receivedAt`.
  - Each frame computes `remoteNow = snapshot.now + (performance.now() − receivedAt)`
    (`studio/page.tsx:997`). It then evaluates `motionPose`, `riderPose`, `cameraPose`
    and `hourAt` locally (`campus-life.ts:298`, `euc-riders.ts:241`, `page.tsx:1004-1021`).
  - No clock-skew filtering, so a poll can cause a small time jump.
- **Known limitations:**
  - ±60 m walkable window. The 2026 outer compounds (e.g. the west rack building at
    x≈−112) are unreachable.
  - No interiors, stairs or levels.
  - Edits do not affect server navigation.
  - The fire ring is added as a 2×2 m obstacle (`model.ts:33-39`).
  - Two grids (server baseline vs browser live, `campus-life.ts:59-103`) and two EUC
    perimeters. The default circling pose uses the *browser's* path
    (`shared.ts:237-239` called from `euc-riders.ts:241`), while missions use the
    server's `riderPath`, so the two can diverge.
  - Collision-slide-free but visually robotic.
  - `modelForYear(2026)` builds three grids at module import (`model.ts:498`), which is
    a cold-start cost in the Worker.

---

## 6. Simulation control plane

- **Endpoints** (`worker.ts:148-373`): `GET /api/simulation/state[?revision=N]`,
  `POST /api/simulation/command` `{name,args,id:uuid}`, and `/mcp` (Streamable HTTP,
  stateless: `maxSubscriptions:0, keepAliveMs:0` at 359–362). All take `?year=2020…2026`
  (default 2026, 189–190).
- **Auth / capability** (164–180; `simulation/README.md`):
  - The browser generates a 256-bit `key` (`simulation-panel.tsx:181-187`).
    `view = SHA256(key)`, `room = SHA256(view)`.
  - Bearer is `room.key`. Control if `SHA256(SHA256(key))==room`; read-only if
    `SHA256(key)==room` (spectators hold `room.view`).
  - No server-side secrets and no revocation.
  - Also: same-origin check when `Origin` is present (156–158), 32 KiB body cap
    including chunked bodies (195–219), and MCP requires control (246).
- **DO identity:** `idFromName(year===2026 ? room : `${year}:${room}`)` (192). This gives
  year isolation per room. The DO also carries in-memory `year` and `cached` (46–51),
  which are reset on a year switch.
- **Storage schema** (33–43):
  - `state(id INTEGER PK, payload TEXT)`: a single row `id=1` holding
    `JSON.stringify(SimState)`.
  - `commands(id TEXT PK, revision INT, fingerprint TEXT)`: the idempotency receipt log.
- **`SimState`** (`shared.ts:51-77`):
  - `revision`, `epoch` (hour anchor), `motionEpoch`, `pausedAt`
  - `clock {real, virtual, rate}`
  - `people: Record<id, Motion{path, started, speed, loop, yaw, activity}>`
  - `environment {hour, cycle, daySeconds}`
  - `fire: auto|on|off`
  - `euc {count, speed, enabled, distance, at}`
  - `riders: Record<'euc-N', {approach?, motion, action, dismount}>`
  - `screens: Record<screenId, {enabled, program, brightness, title}>`
  - `camera {position, target, revision, route?}|null`
  - `activity {name, people, target}|null`
- **`normalizeState`** (`model.ts:85-96`) is a read-time migration. It fills `clock`
  (from `pausedAt ?? now`), `weather`, `riders` and `screens` defaults. It runs on
  every load (`worker.ts:58`) and on every command (`model.ts:195`).
- **Command application** (`worker.ts:103-138`):
  - Zod parse, then `transactionSync`.
  - Receipt lookup: same id and same fingerprint returns without re-applying. Same id
    with different args throws (110–122).
  - `model.command(read(), name, parsed, Date.now())` then save, insert the receipt,
    and prune receipts with `revision < rev−255`.
  - Invalidate the cache and return a full snapshot.
  - `command` clones first (`structuredClone`, `model.ts:195`), so failures never
    partially mutate state. `apply_scene` recursion is atomic with a single revision
    bump (197–211).
  - **MCP tools mint a fresh UUID per call** (`worker.ts:339`), so MCP retries are *not*
    idempotent.
- **Tools (20)** = `get_state`, `get_capabilities` (MCP-only, `worker.ts:254-327`) plus
  18 from `commands.ts`:

| Tool | Params (bounds) |
|---|---|
| `move_person` | `person_id`, `x`,`z` ∈[−59,59] |
| `set_person_activity` | `person_id`, `activity` idle/wave/talk/wander |
| `set_environment` | `hour?` 0–23.99, `cycle?`, `day_seconds?` 60–86400 |
| `set_fire` | `mode` on/off/auto |
| `set_euc_riders` | `enabled?`, `count?` 0–6, `speed?` 0.5–6 m/s |
| `set_camera` | `position` vec3 (y≥0.05), `target` vec3 (y≥−0.16) |
| `start_activity` | `name` talk/gathering/campfire, `people[1..8]`, `x`,`z` ∈[−55,55] |
| `set_paused` | `paused` |
| `set_weather` | `preset?` clear/cloudy/rainy/windy/dusty, `clouds/rain/wind/dust?` 0–1, `wind_direction?` 0–360 |
| `set_simulation_speed` | `rate` 0.1–8 |
| `move_group` | `people` 'all' or [1..8], `x`,`z`, `spacing` 1–5 (default 2) |
| `set_camera_trajectory` | `target`, `radius`, `end_radius?`, `height`, `end_height?`, `turns` ±1–8, `duration` 5–3600, `loop` |
| `set_camera_path` | `points[2..32] {position,target}`, `duration`, `loop` |
| `stop_camera` | — |
| `command_euc_riders` | `riders` 'all' or euc-1..6, `action` circle/return/stop/dismount, `dismount_on_arrival` |
| `set_screens` | `screens` 'all' or ids, `enabled?`, `program?`, `brightness?` 0.1–2, `title?` ≤100 chars |
| `apply_scene` | `commands[1..12] {name,args}`; no nesting or reset |
| `reset_simulation` | — |

- **Snapshot** (`worker.ts:72-102`) contains `state`, `now`, `year`, `catalog`
  (entities), `eucRiders` poses, `firePosition`, `cameraPose`, `poses` (all people at
  `now`), `hour`, `units` and `limitations`. With `?revision=N` and no change it returns
  `{unchanged, now, revision}` (77).
- **Polling protocol** (`simulation-panel.tsx:140-175`):
  - Visible tabs poll every 1 s. Hidden tabs recheck every 2 s without fetching.
  - Exponential backoff up to 15 s. 12 s abort timeout (68).
  - `acceptsSnapshot` rejects older revisions and older `now` (`lib/snapshot-order.ts`).
  - Generation counter to drop responses from a previous room.
- **Server vs browser:**
  - The server validates, routes (A\*), resolves timings and stores state.
  - The browser renders and evaluates poses, the camera route and the hour.
  - Weather, fire and screens are pure data that the browser interprets.
  - **No per-frame or per-tick server stepping. No DO alarms. No WebSockets.** Time is a
    virtual clock `simTime = virtual + (now−real)·rate` (`shared.ts:85-92`) anchored to
    server `Date.now()`.
  - Pause and rate changes re-anchor the clock (`model.ts:248-253, 466-469`). Changing
    EUC speed rescales `started` to keep continuity (416–424).
- **Determinism:** the reducer is pure given `(state, name, args, now)`, apart from
  float math, and `now` is injected (`Date.now()` only at `worker.ts:123`). There is no
  RNG in the server. Wander seeds are `31+index·171`.
  - There is no input log and no rules version. State is overwritten in place, so
    history, replay and fork are impossible today.

---

## 7. Environment

- **Sun:** `daylightAt(hour)` (`ambience-math.ts:4-17`) is a pure sinusoid. Angle is
  `(hour−6)/24·2π`, with a fixed tilt (direction `(−cos a, 0.9 sin a, −0.38)`).
  **No date, latitude or azimuth model.** The owner-facing text says "not a calibrated
  solar study".
- **Clock:** the local cycle is `hour += dt/20`, i.e. 480 s per day (`studio/page.tsx:1023`).
  Remote uses `hourAt` with `daySeconds` (`shared.ts:141-152`).
- **`environment.ts`:**
  - three.js `Sky` with a `dayBlend` shader patch (12–34).
  - Sun DirectionalLight: 2048² shadow map over ±65 m, with shadow updates limited to
    4 Hz wall-clock (181–190).
  - Hemisphere light, moon, 850 LCG stars, 650 m soil plane with a detile shader, fog.
  - Weather modulates clouds, turbidity, soil wetness and fog (153–180).
- **`weather.ts`:** 2400 rain streaks in one LineSegments draw. A 256² float roof
  heightmap over ±220 m, built from `Roofs and upper floors` meshes, hides rain under
  roofs. Visual only.
- **`scenery.ts`:**
  - Campfire at `campfireClearing` (nearest cell with 3 m clearance to (1,23)):
    13 rocks, 5 logs, 95-point flame shader, flickering PointLight, embers. Auto mode
    follows night via smoothstep.
  - 160 instanced grass tufts outside a 30 m radius with vertex-shader wind.
  - 100 dust motes.
- **Screens:** 2026 uses `gallery.ts` (photo-estimated projector plus 6 monitors,
  programs `art` shader, `talk` canvas title, `test` bars). Other years use
  `history/screens.ts`, which maps up to 7 display meshes onto the same IDs round-robin.
- **Ambience** has no audio.

---

## 8. Rendering, performance, dev and deploy

- **Renderer** (`studio/page.tsx:217-226`): WebGL, antialias, pixel ratio ≤1.6, ACES,
  PCF shadows.
  - Adaptive DPR: if fewer than 150 frames arrive in 5 s, DPR drops by 0.2, down to 0.8
    (1096–1106).
  - Rendering is skipped when hidden or when the context is lost (991–995).
  - Telemetry goes into `canvas.dataset`: drawCalls, geometries, textures,
    renderBatches, cameraPosition, simulationRevision (1024–1059). E2E tests read this.
- **Batching** (`lib/render-batches.ts`): opaque static non-skinned meshes are bucketed
  by `material.uuid × 24 m XZ cell × attribute signature`. Each bucket is
  merged into world space.
  - Originals are disabled on layer 0 (render) but kept on layer 1 (raycast/walk).
  - The selected object is excluded and stays live. Rebuilds are lazy on `invalidate`.
  - **No InstancedMesh for the campus**, even though the manifest records 1695 shared
    mesh instances.
- **`ThreeResources`** centralises disposal.
- **GLB loading:** `fetch` + `GLTFLoader.parseAsync` + meshopt decoder
  (`three-resources.ts:77-92`).
- **Dev:**
  - `npm run dev` runs Vite on 127.0.0.1 with `strictPort`. It proxies `/api/simulation`
    and `/mcp` to `127.0.0.1:${MARS_SIMULATION_PORT||8797}` (`vite.config.ts:3-16`).
  - Run the DO separately:
    `wrangler dev --config simulation/wrangler.jsonc --port 8797 --inspector-port 9237`.
  - `publicDir` becomes `.cloudflare/public` when `CLOUDFLARE_RELEASE=1`.
- **Build / deploy** (`deploy/README.md`):
  1. `browser-model.py`
  2. `compress-browser.mjs`
  3. `prepare.py`
  4. `CLOUDFLARE_RELEASE=1 npm run build` (vite build + `configure.mjs`)
  5. `upload.mjs` (R2)
  6. `wrangler deploy --config dist/server/cloudflare.json`

  Before a build, regenerate catalogs whenever geometry changes: `node deploy/catalog.mjs`
  and `node deploy/history-catalog.mjs`.
- **Release manifests:**
  - `.cloudflare/release.json` and `.cloudflare/large-assets.json` (generated, ignored)
  - `deploy/deployment.json`: live URL and last version `763de986-3bdd-4947-a335-226f28a8ed79`
  - audits: `viewer/AUDIT-2026-09-22*.md`
- **Worker:** `mars-campus-2026` (workers.dev). R2 bucket `mars-campus-2026-models`.
  DO migration tag `simulation-v1` in production vs `v1` in the local test config.

---

## 9. Tests

Working command: **`npm test`** → `node --test deploy/*.test.mjs`.

**Result: 48 tests, 48 pass, 0 fail, ~0.25 s.**
- The original `--experimental-transform-types` flag was rejected by Node 26.8.2.
- Plain `node --test` failed only `walking.test.mjs`, because `walking.ts` used a TS
  parameter property. I verified 48/48 with an esbuild load hook. The lead has since
  switched the script and removed the parameter property.
- `kit.ts:11` still uses `constructor(public year:number)`, a parameter property. Tests
  that load it bundle through esbuild first, so they pass, but a direct strip-types
  import of `kit.ts` (e.g. from engine tests) would fail.
- `tsc --noEmit` is clean. `oxlint` is clean (exit 0).

| File | Covers |
|---|---|
| `ambience.test.mjs` | Daylight continuity; grid routes avoid walls, fire ring and diagonal corners; roofs vs ground obstacles; enclosed starts; people GLBs have working Walk/Idle clips. |
| `audit.test.mjs` | Layout validation; resource disposal; batching preserves picking, hidden layers and export; stale snapshots rejected; atomic group commands; wander from the current pose; arrival yaw and hour wrap; sub-cell connector through a wall rejected; R2 download ranges and validators; nested child transforms; batch invalidation on edit. |
| `camera-ground.test.mjs` | Ground clamping for orbit, pan, walking and wide/steep near planes. |
| `compression.test.mjs` | Brotli negotiation and identity fallbacks in `downloads.mjs`. |
| `control-plane.test.mjs` | New rooms at 16:00; speed/pause/resume/migration continuity; day length vs rate; spiral closure; EUC return/park/dismount/remount; `apply_scene` atomicity; range/duplicate rejection; per-year isolated models. |
| `euc-follow-camera.test.mjs` | Epicycle lap, backdrop bias, entry/pause, frame-rate convergence, bearing seam. |
| `euc-riders.test.mjs` | Shoes stay on pedals; vehicle locked to rider. |
| `history-geometry.test.mjs` | 2021 corridor and canopy; 2022 symmetric footprints and corner gaps; 2024 left-only PV, glazing and mural. |
| `simulation.test.mjs` | Mirrored people meshes; EUC wheel and pedals; perimeter encloses bounds and closes; smooth rider heading; analytic motion arrives, loops and pauses. |
| `walking.test.mjs` | Frame-independent speed; jump; walls vs low stairs; floors and ceilings; key focus/blur handling; arrows plus WASD. |
| `year-layout.test.mjs` | Layouts cannot cross years; legacy layouts count as 2026. |

These were not run: `simulation-integration.mjs` and `history-integration.mjs` (they
need a running worker; a pre-existing `workerd` was listening on :8797, which I left
alone), `smoke.mjs`, and `compression-smoke.mjs` (which targets the live site).

## 10. Dev server check

I ran `MARS_SIMULATION_PORT=8899 vite --port 5199`, which started in 108 ms. Results:
- `GET /studio` → 200 HTML with `<div id="root">`.
- `/app/main.tsx` → 200.
- `/app/studio/page.tsx` → 200.
- `/modular/components.json` → 200 (via the symlink).
- `/api/simulation/state` → 502, the expected `ECONNREFUSED`: the proxy target was
  deliberately unused so no local room was touched.

There were no other errors. I stopped the process and confirmed no listener remained on
:5199. The WebGL runtime was not exercised; that needs a browser.

---

## 11. Seams for a deterministic world engine

### 11.1 Subsume (engine becomes the source of truth)
| Existing | Engine replacement |
|---|---|
| `simulation/shared.ts` evaluators (`simTime`, `motionPose`, `riderPose`, `cameraPose`, `hourAt`) | Take and timeline sampling: `sample(take, t) → poses`. Keep the anchored virtual-clock semantics (tested) but fix the timestep for stepping subsystems. Keep these signatures as thin shims so the browser and tests keep working during migration. |
| `simulation/model.ts` `command` reducer + `normalizeState` | Action runtime (validate → reserve → execute …, SPEC §13) over a world state. The existing 18 commands become actions. The clone-then-commit atomicity and `apply_scene` single-revision semantics must be preserved. |
| `CampusPaths` (`ambience-math.ts`) | Navigation. Retain it as a fallback baseline for regression comparison. Add a corridor/portal structure with smoothing inside clearance, levels, stairs, dynamic obstacles from construction state, and clearance per movement profile. Keep the "no sub-cell connector through walls" invariant (audit test 202). |
| `deploy/catalog.mjs`, `history-catalog.mjs` (AABB lists) | World extraction: GLB/kit → asset definitions, placements and semantic regions. The Node pipeline already works (esbuild bundle, canvas/TextureLoader stubs, GLTFLoader in Node). Replace per-mesh AABBs with oriented footprints or a navmesh bake, and emit stable IDs and provenance. |
| `sceneManifest` / `components.json` | World placement index: definition, placement, assembly, layer, provenance, confidence. |

### 11.2 Wrap (keep, feed from the engine)
- **Rendering** (`studio/page.tsx` loop, `environment`, `weather`, `scenery`, `gallery`,
  `render-batches`): a presentation adapter that consumes `engine.sample(t)`.
- **`campus-life.ts` / `euc-riders.ts`:** keep the mixers and rigs, and replace the
  local roaming (304–351) and the pose source (298–303) with engine poses plus a
  locomotion hint (speed, turn) for stride and clip selection. Local roaming must become
  a deterministic engine run (a seeded local room) instead of dt-stepping.
- **`walking.ts`:** the viewer's avatar stays client-only (SPEC §24: no per-frame
  network). It could later query engine collision instead of raw meshes.
- **Worker / DO:** keep the auth, origin, body limits, receipts, year isolation and
  polling (all tested). Replace the payload:
  - `state` row → `checkpoint(rev, parent, rulesVersion, assetsHash, worldState, rngState)`
  - add an append-only `inputs(rev, commandId, action, args, resolved)` log
  - add `takes`

  Two options for stepping:
  - (a) Resolve ahead at command time. The engine plans and simulates to completion
    deterministically and stores the resolved take; the browser samples it. This matches
    today's model and needs no ticks.
  - (b) Catch-up stepping on read or on a DO alarm from the last checkpoint.

  Prefer (a) for motion and choreography. Use (b) only for recipe or event progression
  that depends on later inputs. **Never** run per-frame server loops.
- **MCP:** keep the tool surface and add new structured actions. Also derive MCP
  idempotency keys from a client-supplied id; currently a random id is minted per call
  (`worker.ts:339`).

### 11.3 Separating `studio/page.tsx`
Extractable units, in the order they appear in the file:
1. `createViewer(host)`: renderer, camera, orbit, resize, context loss (217–258, 976–981).
2. `loadYearScene(year)`: GLB or procedural plus details, gallery, manifest, batches,
   life (488–514). The engine world build should hook in here.
3. `createEditor`: selection and picking (370–391, 515–565), display modes (433–487),
   additions (566–664) and edit API methods (675–867). It becomes a
   *workspace-edit producer*, emitting world-edit operations instead of mutating Three
   objects directly.
4. `layoutIO`: save / restore / export (868–974), which becomes checkpoint import/export.
5. `remoteAdapter`: snapshot intake (687–706) and per-frame remote time plus camera
   follow (997–1022). The engine client lives here.
6. `frameLoop`: 985–1107.

The JSX (1157–1700) only talks to `api.current`, so the `Api` type (68–101) is already
a clean boundary.

### 11.4 Hazards
- **Stable IDs:** fixed, see `HISTORY_IDS.md`. Kit and 2020 ids no longer depend on
  build order; legacy serials were frozen as aliases in `app/history/id-migration.json`.
  Moving or retyping a piece still changes its hashed id — pin plan targets with `Kit.named`.
- **Protected baselines:** `history-geometry` tests and `historyNotes` encode the
  2021/2022/2024 corrections. The engine must load these scenes unmodified and fork from
  them (SPEC §21). Do not regenerate them through new kit code without equivalence tests.
- **Split truth:** server baseline catalog vs browser live geometry. Unify through the
  engine. In particular the EUC perimeter: default circling uses the browser path, while
  missions use the server `riderPath`.
- **Units and ground:** y=−0.16 is baked into schemas (`commands.ts:4,51`), nav and
  animation. 2026 coordinates extend far beyond ±60 m.
- **Float determinism:** V8 in Node and workerd match. Browsers other than Chromium may
  differ in `Math.sin/cos/hypot` ulps. Rely on sampling stored resolved takes, not on
  re-simulating in the browser. three.js `Box3`/`Vector3` are used inside the server
  model, which is fine but couples the engine to three. Consider plain math.
- **Cold start:** `model.ts:498` builds three grids per isolate. A navmesh bake should be
  offline and shipped as data.
- **Payload growth:** full snapshots re-send all paths when the revision changes. Take
  data will be larger, so plan for deltas or content-addressed takes.
- **Strip-types:** keep engine code free of TS-only syntax (parameter properties, enums,
  namespaces) so `node --test` works directly (`kit.ts:11` is a remaining example).
- **Repo hygiene:** `public/modular` and `public/data` symlink outside git. The
  engine's world-extraction inputs should be copied or derived into the repo, or pinned
  by hash. Committed `simulation/.wrangler/state` should be git-ignored.
- **Animation vocabulary:** only Idle/Walk/Wave exist. Carrying, lifting, handoffs and
  climbing need new CC0 clips or procedural IK (SPEC §11, §17).

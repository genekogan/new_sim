#!/usr/bin/env node
// L11 parity proof: the coverage matrix of every feature of Eden, Mars and Little Martians against
// the god-mode vocabulary (genesis/1 + ops + defs + generators + components).
//
//   node tools/god-skill/scripts/parity/matrix.mjs [--write] [--check]
//
// The judgement lives in ROWS (one row per feature family, hand-assessed, honest) and in the
// per-item maps below. The script then proves completeness and consistency against the sources:
//  - every Eden place (worlds/eden/places.v1.json, all kinds), every Eden activity spot verb
//    (activity-spots.v1.json), every Mars camp region / fixture / item / construction part /
//    activity verb (worlds/mars/camp/manifest.json), every Little Martians level / link / kin /
//    building (worlds/littlemartians/scene.json) and every Eden client kit
//    (mars/viewer/app/engine-view/content/assets/*) maps to a row — an unmapped item fails;
//  - every `core/<x>@1` ref and generator id a row names exists in the library (CORE_KIT) or the
//    generator registry — a row that claims "composable" with a missing def fails.
// --write regenerates the matrix block in docs/god/PARITY.md (between the matrix markers);
// --check exits 1 if anything is unmapped or a named ref is missing.
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const json = (p) => JSON.parse(readFileSync(resolve(root, p), 'utf8'));
const { CORE_KIT, GENERATORS } = await import(resolve(root, 'packages/world-compiler/src/index.ts'));
await import(resolve(root, 'packages/generators/src/index.ts'));   // registers every generator
const DEFS = new Set(CORE_KIT.map((d) => `core/${d.name.replace(/^core-/, '')}@${d.version ?? 1}`));
const GENS = new Set(GENERATORS.keys ? [...GENERATORS.keys()] : Object.keys(GENERATORS));

// Status: lib = composable now from the library (defs/generators/ops as they are);
//         def = composable now by `define`-ing a small kit/2 def (≤ 96 rounded shapes, ≤ 400 tris prop);
//         imp = composable via import (GLB → POST /v1/god/assets); `inLib` = already imported as a core def;
//         gap = not yet (names the lane or Stage-B item that closes it).
// Souls: works = a Soul can use it today in an entity world (L8/L9); B4/B5/B6/B7 = the Stage-B item
//        (eden4/31) that gives Souls the use; decor = nothing for a Soul to do; n/a = not a Soul thing.
const ROWS = [
  // ---------------------------------------------------------------- places
  { id: 'world', cat: 'places', f: 'World bounds, ground kind, constitution, day length', w: 'E M L', st: 'lib',
    v: 'genesis/1 `constants` {extent, ground: land|ocean|void}, `expand`, `world` {constitution, time.dayTicks}', souls: 'works' },
  { id: 'districts', cat: 'places', f: 'Named outdoor districts and regions (commons, quarters, 30 regions; Mars yard/arrival/work areas; LM garden)', w: 'E M L', st: 'lib',
    v: 'named area entities: core/lawn@1, core/plaza@1, core/meadow@1, `place` component (plaza, pitch, pier, deck); core/flag@1 labels', souls: 'B4',
    next: 'B4 derives the place tree from `place` areas. A geometry-less `place` area def (a "zone" for a district polygon with no surface of its own) is missing — L1/L4' },
  { id: 'buildings', cat: 'places', f: 'Enterable buildings with rooms (houses, library, office, barn, market, classroom; Mars kitchen, living room, bunkhouse)', w: 'E M', st: 'lib',
    v: 'building/1 (L2): style cottage|townhouse|hall|barn|tower|pavilion|greenhouse|shed|shop|chapel, `plan` rooms, doors, windows; rooms are slots', souls: 'works',
    next: 'Souls enter, climb and sit today (L9); per-room hearing/`here` is B4' },
  { id: 'storeys', cat: 'places', f: 'Upper rooms and multi-storey floors (house upper rooms, office floors 0–2)', w: 'E', st: 'lib',
    v: 'building/1 `floors` 1–6 + stairs; stairs/1 for outside stairs; core/deck@1 balconies', souls: 'works' },
  { id: 'rooms', cat: 'places', f: 'Typed rooms: bedroom, kitchen, studio, shop, chapel, clinic, bathhouse, workshop', w: 'E M', st: 'lib',
    v: 'building/1 `plan` room names/kinds furnished from the library (bed, stove, counter, easel, workbench…)', souls: 'B4' },
  { id: 'courtyard', cat: 'places', f: 'Courtyard houses wrapped round an open-sky court', w: 'E', st: 'gap',
    v: 'approximated today with two to four building/1 wings around a core/lawn@1', souls: 'works', next: 'L2: non-rectangular / courtyard plans in building/1' },
  { id: 'round-buildings', cat: 'places', f: 'Round or curved enterable buildings (yurt, observatory, villa tower, round temple, round windmills)', w: 'E', st: 'gap',
    v: 'closed shells today via `define` kit/2 (cyl, lathe, cone) or core/dome@1; not enterable with rooms', souls: 'decor', next: 'L2: curved wall plans (L2 final report: "no curved wall plans")' },
  { id: 'pavilions', cat: 'places', f: 'Open pavilions, bandstand, tea house, gazebo, pergola court, geodesic dome', w: 'E', st: 'lib',
    v: 'core/pergola@1, core/gazebo@1, core/bandstand@1, core/dome@1, building/1 style pavilion', souls: 'works' },
  { id: 'venues', cat: 'places', f: 'Venues and stages (classroom, amphitheatre, domed hall, church, big top, festival stage)', w: 'E M', st: 'lib',
    v: 'core/stage@1, core/podium@1 (`venue` component), building/1 hall|chapel (+ roof dome), terrace/1 stepped seating; big top by `define` (cone + cyl)', souls: 'B5' },
  { id: 'mats', cat: 'places', f: 'Sleeping mats (30 on the commons, 4 Mars mats)', w: 'E M', st: 'def',
    v: '`define` a flat kit/2 rbox with a `bed` slot (core/bed@1 / core/bunk@1 for indoor beds)', souls: 'B5' },
  { id: 'gardens', cat: 'places', f: 'Gardens, allotments, vegetable terraces, fields, vines, orchard, lavender, zen court', w: 'E M', st: 'lib',
    v: 'garden-bed/1 (flowers|vegetables|herbs|wheat|pumpkins|mixed), orchard/1, core/flower-bed@1, core/hedge@1, terrace/1, crop packs (core/<crop>-pack@1); vines by orchard/1 rows (no vine species)', souls: 'B5' },
  { id: 'squares', cat: 'places', f: 'Squares and plazas (old-town plaza, campus quad, village green, fire circle)', w: 'E', st: 'lib', v: 'plaza/1 (grid|herringbone|radial|plain), core/lawn@1', souls: 'works' },
  { id: 'streets', cat: 'places', f: 'Streets, avenues, quays, residential rows, arcades', w: 'E', st: 'lib',
    v: 'road/1 (core/street@1, core/road@1), path/1, `along` constraint for rows of building/1, core/arch@1 along a path for arcades, core/lamp-post@1', souls: 'works' },
  { id: 'bridges', cat: 'places', f: 'Bridges (canal bridges, red garden bridge, stone bridge)', w: 'E', st: 'lib', v: 'bridge/1 (wood|stone|metal, arch), core/footbridge@1, road autoBridge', souls: 'works' },
  { id: 'piers', cat: 'places', f: 'Piers, boardwalk, jetty, lake dock', w: 'E', st: 'lib', v: 'pier/1, deck/1', souls: 'works' },
  { id: 'beach', cat: 'places', f: 'Beach and shore bands', w: 'E', st: 'lib', v: 'shore/1 (sand|stone|pebble|grass|reeds), lawn/1 sand', souls: 'works' },
  { id: 'pitches', cat: 'places', f: 'Sports pitch, tennis courts, volleyball and pétanque courts, golf', w: 'E', st: 'lib', v: 'pitch/1 (football|tennis|basketball|petanque|volleyball), core/goal@1; golf green by lawn/1', souls: 'B5' },
  { id: 'playground', cat: 'places', f: 'Playground', w: 'E', st: 'lib', v: 'core/swings@1, core/slide@1, core/see-saw@1, core/sandpit@1, core/climbing-frame@1', souls: 'B5' },
  { id: 'attractions', cat: 'places', f: 'Ferris wheel, carousel, helter-skelter', w: 'E', st: 'lib', v: 'core/ferris-wheel@1, core/carousel@1 (`spin`); helter-skelter by `define` (cyl + sweep)', souls: 'B5' },
  { id: 'mural', cat: 'places', f: 'Painted mural wall (artists\' village)', w: 'E', st: 'imp', v: 'wall/1 + a textured panel imported as a GLB (core/picture-frame@1 for small works)', souls: 'decor' },
  { id: 'railway', cat: 'places', f: 'Railway station, platform, the train', w: 'E', st: 'gap',
    v: 'building/1 station, core/platform@1, core/rail-wagon@1 with `route` along a path — but no rail track', souls: 'decor', next: 'L3 backlog: a rail/1 path generator (sleepers + two rails); the train runs today along a core/track@1' },
  { id: 'lm-levels', cat: 'places', f: 'LM glazed rooms at 0.5 / 9 / 16 / 22 m and three temple halls', w: 'L', st: 'imp', inLib: true,
    v: 'core/ceramic-tower@1, core/minaret-temple@1 (footprints carry the rooms as slots)', souls: 'B6', next: 'B6 parity gate: "LM floaters hover in the glazed rooms"' },
  { id: 'lm-shafts', cat: 'places', f: 'LM floater-only shafts between levels (ramp links, unusable on foot)', w: 'L', st: 'imp', inLib: true,
    v: 'carried in the tower/temple footprints (links with usable:false)', souls: 'B6' },
  // ---------------------------------------------------------------- structures
  { id: 'eden-houses', cat: 'structures', f: 'Eden houses with facades (plinth, cornice, quoins, shutters, flower boxes, balconies, porches)', w: 'E', st: 'lib',
    v: 'building/1 cottage|townhouse with porch, balcony, trims (L2 ported dwelling-kit/facades)', souls: 'works' },
  { id: 'lit-windows', cat: 'structures', f: 'Lit windows with a room behind them at night (interior-mapping glass)', w: 'E', st: 'gap',
    v: 'building/1 has real interiors and `light` fixtures; the interior-mapping window shader is not a mesh-half option', souls: 'decor', next: 'B7 / L2 follow-on: port eden-window-interiors into building.mesh' },
  { id: 'special-buildings', cat: 'structures', f: 'Landmark forms: lighthouse, bell/clock tower, pagoda, palm house, warehouse sawtooth, petrol station, watermill, cable-car stations', w: 'E', st: 'lib',
    v: 'building/1 tower|greenhouse|shed|shop (+ roof dome|shed|flat); finials, sails, wheels, clock faces by `define` kit/2 parts placed on the building', souls: 'works',
    next: 'pagoda flared roofs and sawtooth roofs are approximations (roof enum)' },
  { id: 'windmill', cat: 'structures', f: 'Windmills whose sails turn', w: 'E', st: 'def', v: 'building/1 tower + a `define`d sails kit/2 with `spin` {axis z, role blade}', souls: 'decor' },
  { id: 'mars-camp-buildings', cat: 'structures', f: 'Mars camp rooms: open-topped walled rectangles with one door (2.6 m walls)', w: 'M', st: 'lib',
    v: 'building/1 style shed|hall, roof none|flat, front door side; wall/1 for free walls', souls: 'works' },
  { id: 'racks', cat: 'structures', f: 'Pallet racks with beams (Mars build stock)', w: 'M', st: 'lib', v: 'core/pallet-rack@1, core/rack-beam@1 (carryable)', souls: 'works' },
  { id: 'construction', cat: 'structures', f: 'The lookout bay as built (uprights, beams, joists, plywood deck at 2 m, 10-tread stair)', w: 'M', st: 'lib',
    v: 'core/pallet-rack@1 uprights, core/rack-beam@1, deck/1 at 2 m, stairs/1', souls: 'works' },
  { id: 'construction-process', cat: 'structures', f: 'Souls building the lookout (staged parts, raise/connect/install/release with support rules)', w: 'M', st: 'gap',
    v: 'parts carry today (`carryable`); there is no assembly component (part phase, joint, support release) in the vocabulary', souls: 'B5', next: 'B5 + a new `assembly` component (L1 contract); Mars year-build engine stays authoritative until then' },
  { id: 'walls', cat: 'structures', f: 'Garden walls, fences, hedges, gates, cloister walls', w: 'E M', st: 'lib', v: 'wall/1, fence/1, hedge/1 with `gates`, core/gate@1, core/arch@1', souls: 'works' },
  { id: 'lm-buildings', cat: 'structures', f: 'Ceramic Tower and Minaret Temple (Vanessa\'s glazed scans)', w: 'L', st: 'imp', inLib: true, v: 'core/ceramic-tower@1, core/minaret-temple@1', souls: 'B6' },
  { id: 'desert-dressing', cat: 'structures', f: 'Mars desert dressing: shipping container, IBC water totes, low hills', w: 'M', st: 'def',
    v: '`define` kit/2 container and tote (boxes); hills by landform/1', souls: 'decor' },
  // ---------------------------------------------------------------- props
  { id: 'furniture', cat: 'props', f: 'Room furniture (chairs, tables, beds, sofas, shelves, desks, piano, rugs, lamps)', w: 'E M', st: 'lib',
    v: '19 furniture defs (core/chair@1, core/long-table@1, core/bookshelf@1, core/piano@1, core/bed@1…)', souls: 'works' },
  { id: 'kitchen', cat: 'props', f: 'Kitchen fittings and tableware (stove, counter, sink, pots, bowls, cups, plates, bread)', w: 'E M', st: 'lib',
    v: '11 kitchen defs (core/stove@1, core/pot@1, core/bowl@1…) + food packs (core/bread-loaf-pack@1…)', souls: 'works' },
  { id: 'street-props', cat: 'props', f: 'Street furniture (benches, lamps, bins, bollards, mailboxes, hydrants, planters, bike racks, parasols)', w: 'E', st: 'lib',
    v: '21 prop defs (core/bench@1, core/lamp-post@1, core/mailbox@1, core/parasol-table@1…)', souls: 'works' },
  { id: 'signage', cat: 'props', f: 'Signs, finger posts, notice board, "what\'s on" board, banners', w: 'E', st: 'lib', v: '8 signage defs (core/signpost@1, core/notice-board@1, core/banner@1…)', souls: 'B5' },
  { id: 'camp-fixtures', cat: 'props', f: 'Mars camp fixtures (6 ft tables, benches, camp chairs, lectern, standing display, workstations, planters)', w: 'M', st: 'lib',
    v: 'core/long-table@1, core/bench-seat@1, core/chair@1, core/podium@1, core/screen@1, core/desk@1, core/planter-box@1', souls: 'works' },
  { id: 'campfire', cat: 'props', f: 'Campfire / fire circle', w: 'E M', st: 'def', v: '`define` a ring of logs with a `flame` role + `light` (core/hearth@1 is the indoor version; core/firewood@1, core/log@1 around it)', souls: 'B5' },
  { id: 'small-items', cat: 'props', f: 'Small carried items (spoon, book, drawing pad, pencil, letters)', w: 'E M', st: 'def',
    v: '`define` kit/2 items with `carryable` (+ `readable` for books); bowls/cups/plates exist', souls: 'works' },
  { id: 'chess', cat: 'props', f: 'Chess board and piece tray', w: 'M', st: 'def', v: '`define` a board with the `boardGame` component (none in the library)', souls: 'B5' },
  { id: 'event-kit', cat: 'props', f: 'Band backline, mics, PA, festoon lights; computers and laptops', w: 'E', st: 'def',
    v: '`define` kit/2 instruments (`instrument`), core/screen@1 + core/desk@1 for computers', souls: 'B5' },
  { id: 'sports-kit', cat: 'props', f: 'Sports kit: volleyball net, boules, frisbees, outdoor gym bars and benches', w: 'E', st: 'def', v: 'pitch/1 volleyball|petanque marks the court; nets, boules, gym bars by `define`', souls: 'B5' },
  { id: 'harbour-clutter', cat: 'props', f: 'District identity props (lobster pots, rope coils, buoys, anchors, crate stacks, district banners)', w: 'E', st: 'def',
    v: 'core/crate@1, core/barrel@1, core/banner@1 + `define` the rest', souls: 'decor' },
  { id: 'vehicles', cat: 'props', f: 'Parked and moving vehicles (cars, bikes, carts, boats, punt, train wagon)', w: 'E', st: 'lib',
    v: '8 transport defs + packs (core/rowboat-pack@1, core/bicycle-pack@1…)', souls: 'B5' },
  { id: 'monuments', cat: 'props', f: 'Monuments, sculptures, obelisk, ceramic garden ring, totems', w: 'E L', st: 'lib', v: 'core/obelisk@1, core/totem@1, core/arch@1; exact scans via import', souls: 'decor' },
  { id: 'market', cat: 'props', f: 'Market kiosks and stalls', w: 'E', st: 'lib', v: 'building/1 shop|pavilion, core/parasol-table@1, core/crate@1, core/sack@1', souls: 'B5' },
  { id: 'plants', cat: 'props', f: 'Trees, bushes, reeds, flowers, stumps, logs, rocks, mushrooms, cacti', w: 'E M L', st: 'lib',
    v: '18 plant defs + 30 plant packs (core/oak-tree-1-pack@1, core/willow-tree-1-pack@1, core/mossy-rock-1-pack@1…)', souls: 'decor' },
  // ---------------------------------------------------------------- terrain
  { id: 'hills', cat: 'terrain', f: 'Hills, knolls, mountains, plateaus, ridges', w: 'E M', st: 'lib', v: 'landform/1 (core/hill@1, core/knoll@1, core/mountain@1, core/plateau@1), brush/1', souls: 'works' },
  { id: 'cliffs', cat: 'terrain', f: 'Cliffs and cliff village ledges', w: 'E', st: 'lib', v: 'cliff/1 (core/cliff@1)', souls: 'works' },
  { id: 'terraces', cat: 'terrain', f: 'Stepped terraces (vegetables, vineyard, amphitheatre steps)', w: 'E', st: 'lib', v: 'terrace/1', souls: 'works' },
  { id: 'banks', cat: 'terrain', f: 'Sloping pond bank', w: 'E', st: 'lib', v: 'lake/1 edge + shore/1', souls: 'works' },
  { id: 'ground-paint', cat: 'terrain', f: 'Ground materials (sand, gravel, dirt, snow, moss; Mars desert floor)', w: 'E M', st: 'lib', v: 'lawn/1 material, core/ground-paint@1', souls: 'works',
    next: 'a world-wide base ground material is not a constant (Mars paints one big lawn/1 sand area)' },
  { id: 'scatter', cat: 'terrain', f: 'Ecological scatter (north woods, groundcover, creosote shrubs and stones round the camp)', w: 'E M', st: 'lib', v: 'scatter/2 palette with slope/water rules, core/forest@1, core/woodland@1, core/rock-field@1', souls: 'decor' },
  { id: 'heightfield', cat: 'terrain', f: 'Eden\'s authored heightfield (eastern hills, northern mountains, alpine valley) as one exact surface', w: 'E', st: 'gap',
    v: 'rebuilt from landform/1 strokes (equivalent, not exact)', souls: 'works', next: 'B6: a heightfield import op if exactness matters for migration' },
  // ---------------------------------------------------------------- water
  { id: 'ponds', cat: 'water', f: 'Ponds (commons pond, park pond, koi pond, water hazard)', w: 'E', st: 'lib', v: 'lake/1 (core/pond@1), core/lilypad-pack@1, core/koi@1', souls: 'works' },
  { id: 'lakes', cat: 'water', f: 'Lakes (west lake)', w: 'E', st: 'lib', v: 'lake/1 (core/lake@1)', souls: 'works' },
  { id: 'rivers', cat: 'water', f: 'Rivers, streams and waterfalls', w: 'E', st: 'lib', v: 'river/1 (core/river@1, core/stream@1) with waterfalls where the bed steps', souls: 'works' },
  { id: 'canal', cat: 'water', f: 'Canal with stone quays', w: 'E', st: 'lib', v: 'river/1 straight (banks stone) or channel/1 cut + lake/1, wall/1 quays', souls: 'works' },
  { id: 'sea', cat: 'water', f: 'Sea, harbour, marina', w: 'E', st: 'lib', v: 'constants.ground ocean, lake/1 for the marina basin, pier/1', souls: 'works', next: 'not exercised by a template yet' },
  { id: 'fountain', cat: 'water', f: 'Fountains and wells', w: 'E', st: 'lib', v: 'core/fountain@1, core/well@1 (`water`)', souls: 'B5' },
  // ---------------------------------------------------------------- motion
  { id: 'spin', cat: 'motion', f: 'Ferris wheel and carousel turning', w: 'E', st: 'lib', v: '`spin` {axis, rpm, role} on core/ferris-wheel@1, core/carousel@1', souls: 'decor' },
  { id: 'balloons', cat: 'motion', f: 'Hot-air balloons, tethered and drifting aloft', w: 'E', st: 'lib', v: 'core/balloon@1 (`hover` 18 m, `sway`, `route` {ref, altitude} to drift along a path)', souls: 'B5' },
  { id: 'boats', cat: 'motion', f: 'Boats bobbing and sailing', w: 'E', st: 'lib', v: 'core/rowing-boat@1/canoe (`hover` bob), core/sailboat@1 (`route`), boat packs', souls: 'B5' },
  { id: 'water-birds', cat: 'motion', f: 'Ducks on the pond, gulls, bird flocks', w: 'E', st: 'lib', v: 'animals/1 duck|goose|seagull|bird (swim, fly, perch), core/duck@1 gaits', souls: 'decor' },
  { id: 'butterflies', cat: 'motion', f: 'Butterflies', w: 'E', st: 'def', v: '`define` a kit/2 butterfly (wing roles) with `behavior` fly', souls: 'decor' },
  { id: 'herds', cat: 'motion', f: 'Grazing herds kept to their zones (cows, sheep, horses, llamas)', w: 'E', st: 'lib', v: 'animals/1 graze in a radius, `behavior` {kind, radius, ref}; creature packs', souls: 'decor' },
  { id: 'vehicles-moving', cat: 'motion', f: 'Cars, train and cable car moving', w: 'E', st: 'lib', v: '`route` on core/car@1, core/rail-wagon@1; cable car = `define` gondola + `route` altitude along a core/power-line@1', souls: 'decor' },
  { id: 'kin-hover', cat: 'motion', f: 'Floating kin heads (LM)', w: 'L', st: 'imp', inLib: true, v: 'core/kin-<name>@1 (`hover` 0.9 m, bob 0.08)', souls: 'decor' },
  { id: 'sway', cat: 'motion', f: 'Flags, banners, bunting, laundry, sails swaying', w: 'E M', st: 'lib', v: '`sway` on core/flagpole@1, core/banner@1, core/laundry-line@1', souls: 'decor' },
  { id: 'night-lights', cat: 'motion', f: 'Street lamps and windows lit at night', w: 'E', st: 'lib', v: '`light` on core/lamp-post@1, core/lantern@1, core/hearth@1 (night glow)', souls: 'decor' },
  // ---------------------------------------------------------------- weather and sky
  { id: 'weather', cat: 'weather', f: 'Eden weather: clouds, rain, wind, fog, stars, rainbow, cloud shadows', w: 'E', st: 'gap',
    v: '`world` {weather.clouds, wind, rain} is in the schema and stored; the viewer runs Eden\'s own clock-driven atmosphere for every world and ignores world state', souls: 'n/a', next: 'B7 "atmosphere per world state"' },
  { id: 'sky-palette', cat: 'weather', f: 'Per-world sky palette (Mars desert light, LM garden light)', w: 'M L', st: 'gap',
    v: '`world` {sky.palette, sun} stored, not rendered; no palette catalogue', souls: 'n/a', next: 'B7: palette names + the viewer reading world state' },
  { id: 'dust', cat: 'weather', f: 'Mars dust in the air', w: 'M', st: 'gap', v: 'no dust in `world.weather` (clouds, wind, rain only)', souls: 'n/a', next: 'L1 contract: weather.dust; B7 renders it' },
  { id: 'time', cat: 'weather', f: 'Day/night cycle and day length', w: 'E M L', st: 'lib', v: '`world` {time.dayTicks, startTick}', souls: 'works' },
  // ---------------------------------------------------------------- activities
  { id: 'a-sit', cat: 'activities', f: 'Sit (60 Eden spots; Mars benches, chairs)', w: 'E M', st: 'lib', v: '`seat` slots on 16 defs', souls: 'works' },
  { id: 'a-walk', cat: 'activities', f: 'Walk to, wander, converse, group warm-up', w: 'E M', st: 'lib', v: 'Souls walk the built terrain and floors (L8/L9); talk is engine-level', souls: 'works' },
  { id: 'a-carry', cat: 'activities', f: 'Take, put, carry items (bowls, parts)', w: 'E M', st: 'lib', v: '`carryable` (27 defs), `container`, `surface`', souls: 'works' },
  { id: 'a-pray', cat: 'activities', f: 'Pray to the god', w: '—', st: 'lib', v: 'Soul capability; god stream answers', souls: 'works' },
  { id: 'a-sleep', cat: 'activities', f: 'Lie down, sleep', w: 'E M', st: 'lib', v: '`bed` slots (core/bed@1, core/bunk@1, defined mats)', souls: 'B5' },
  { id: 'a-eat', cat: 'activities', f: 'Eat, serve, prepare food, shared food break', w: 'E M', st: 'lib', v: 'core/bowl@1, core/plate@1, core/stove@1 (`workstation`), core/counter@1 (`surface`)', souls: 'B5' },
  { id: 'a-read', cat: 'activities', f: 'Read, write, post a letter', w: 'E M', st: 'def', v: '`readable` (only core/notice-board@1 has it) — books by `define`; core/mailbox@1, core/desk@1', souls: 'B5' },
  { id: 'a-make', cat: 'activities', f: 'Paint, draw, work at a computer or bench', w: 'E M', st: 'lib', v: 'core/easel@1, core/desk@1, core/workbench@1 (`workstation`, `display`)', souls: 'B5' },
  { id: 'a-music', cat: 'activities', f: 'Play piano, play music, sing, listen, computer music', w: 'E M', st: 'lib', v: 'core/piano@1 (`instrument`), core/stage@1 / core/bandstand@1 (`venue`)', souls: 'B5' },
  { id: 'a-class', cat: 'activities', f: 'Classroom session, display control, lectures', w: 'M E', st: 'lib', v: 'core/podium@1 (`venue` presenter/audience), core/screen@1 (`display`)', souls: 'B5' },
  { id: 'a-chess', cat: 'activities', f: 'Chess moves', w: 'M', st: 'def', v: '`boardGame` component on a defined board', souls: 'B5' },
  { id: 'a-garden', cat: 'activities', f: 'Garden care, seed planting', w: 'M', st: 'lib', v: 'garden-bed/1 / core/fruit-tree@1 (`plant` stages)', souls: 'B5' },
  { id: 'a-sport', cat: 'activities', f: 'Volleyball, pétanque, frisbee, gym (pull-ups, dips, sit-ups, bench press, weights, yoga, push-ups)', w: 'E', st: 'gap',
    v: 'courts and kit are composable; no component says "exercise here" or "play this sport"', souls: 'B5', next: 'L1 contract: an `exercise`/`sport` component; B5 activity' },
  { id: 'a-build', cat: 'activities', f: 'Raise uprights, connect beams, install joists/plywood/stairs, release supports', w: 'M', st: 'gap', v: 'see construction-process', souls: 'B5', next: 'B5 + `assembly` component' },
  { id: 'a-schedule', cat: 'activities', f: 'Daily happenings and schedules at places (the "what\'s on" board)', w: 'E', st: 'gap', v: 'venues are composable; schedules are Core social state, not world vocabulary', souls: 'B5', next: 'B5/B6 (Core keeps the schedules; places resolve by name)' },
  { id: 'a-float', cat: 'activities', f: 'LM floater admission (hover in rooms, ride float-only shafts)', w: 'L', st: 'imp', inLib: true, v: 'the shafts in the LM footprints; `floater` body', souls: 'B6' },
];
const ROW = Object.fromEntries(ROWS.map((r) => [r.id, r]));

// ------------------------------------------------------------------ per-item maps (completeness)
const EDEN_PLACE_KIND = {
  world: 'world', outdoor: 'districts', stage: 'venues', pavilion: 'pavilions', 'sleeping-mat': 'mats', water: 'ponds', venue: 'venues',
  building: 'buildings', garden: 'gardens', room: 'storeys', bridge: 'bridges', street: 'streets', 'residential-row': 'streets', square: 'squares',
  arcade: 'streets', playground: 'playground', field: 'pitches', boardwalk: 'piers', pier: 'piers', beach: 'beach', attraction: 'attractions',
  landmark: 'mural', platform: 'railway', vehicle: 'railway', shop: 'rooms', chapel: 'rooms', clinic: 'rooms', bathhouse: 'rooms', workshop: 'rooms',
  bedroom: 'rooms', kitchen: 'rooms', studio: 'rooms',
};
// Specific places whose form is not their kind's general case (checked before the kind map).
const EDEN_PLACE_ID = [
  [/house-[1-4]$/, (p) => /courtyard/.test(p.description) ? 'courtyard' : 'eden-houses'],
  [/courtyard-quarter\.house/, () => 'courtyard'],
  [/yurt|observatory|villa-tower|lookout-temple|windmill-(east|west)/, () => 'round-buildings'],
  [/windmill$/, () => 'windmill'],
  [/lighthouse|bell-tower|clock-tower|pagoda|palm-house|warehouse|petrol|watermill|station$|valley-station|tower-house|a-frame|greenhouse/, () => 'special-buildings'],
  [/canal$/, () => 'canal'], [/marina|southern-sea/, () => 'sea'], [/lake$/, () => 'lakes'], [/river$/, () => 'rivers'],
  [/amphitheatre|big-top/, () => 'venues'], [/helter-skelter|ferris|carousel/, () => 'attractions'], [/fire-circle/, () => 'squares'],
  [/vegetable-terraces|vines/, () => 'gardens'], [/eden-market-kiosks|eden-market-1|fish-market|old-town\.shops/, () => 'market'],
  [/eden-dome$|eden-dome-quarter/, (p) => p.kind === 'outdoor' ? 'districts' : 'pavilions'], [/sports-ground\.pitch|tennis/, () => 'pitches'],
  [/golf-course\.water-hazard|koi-pond|park\.pond|shore-water/, () => 'ponds'],
];
const EDEN_ACTIVITY = {
  read: 'a-read', write: 'a-read', 'post-letter': 'a-read', paint: 'a-make', 'use-computer': 'a-make', eat: 'a-eat', 'play-piano': 'a-music', 'play-music': 'a-music',
  sing: 'a-music', listen: 'a-music', 'play-volleyball': 'a-sport', 'play-petanque': 'a-sport', 'play-frisbee': 'a-sport', 'pull-ups': 'a-sport', dips: 'a-sport',
  situps: 'a-sport', 'bench-press': 'a-sport', 'lift-weights': 'a-sport', yoga: 'a-sport', pushups: 'a-sport',
};
const EDEN_SPOT_BASE = { sit: 'a-sit', idle: 'a-walk', lie: 'a-sleep' };
const MARS_REGION_KIND = { place: 'buildings', walkable: 'districts', staging: 'districts', 'material-pile': 'racks', 'work-area': 'districts' };
const MARS_REGION_ID = { 'fire-circle': 'campfire', garden: 'gardens', 'classroom-corner': 'rooms', 'build-site': 'construction', 'mat-1': 'mats', 'mat-2': 'mats', 'mat-3': 'mats', 'mat-4': 'mats' };
const MARS_FIXTURE = { 'table-6ft': ['camp-fixtures', 'core/long-table@1'], 'bench-6ft': ['camp-fixtures', 'core/bench-seat@1'], 'standing-display': ['camp-fixtures', 'core/screen@1'],
  'speaker-lectern': ['camp-fixtures', 'core/podium@1'], 'camp-chair': ['camp-fixtures', 'core/chair@1'], 'computer-workstation': ['camp-fixtures', 'core/desk@1'], campfire: ['campfire', null],
  'garden-planter': ['camp-fixtures', 'core/planter-box@1'], 'chess-board': ['chess', null], 'chess-tray': ['chess', null] };
const MARS_ITEM = { pot: ['kitchen', 'core/pot@1'], bowl: ['kitchen', 'core/bowl@1'], spoon: ['small-items', null], 'reading-book': ['small-items', null], 'drawing-pad': ['small-items', null], 'drawing-pencil': ['small-items', null] };
const MARS_PART = { 'upright-8ft': ['construction', 'core/pallet-rack@1'], 'beam-9ft': ['construction', 'core/rack-beam@1'], '2x4-6ft': ['construction', 'core/timber-pile@1'],
  'plywood-4x6': ['construction', 'core/plywood-stack@1'], 'stair-flight-10': ['construction', 'stairs/1'], 'stair-tread': ['construction', 'stairs/1'] };
const MARS_VERB = { walk_to: 'a-walk', ambient_wander: 'a-walk', converse: 'a-walk', group_warmup: 'a-walk', campfire_circle: 'a-walk', sit: 'a-sit', prepare_food: 'a-eat',
  put_item: 'a-carry', take_item: 'a-carry', shared_food_break: 'a-eat', serve: 'a-eat', eat: 'a-eat', work_at: 'a-make', computer_music: 'a-music', read_book: 'a-read',
  chess_move: 'a-chess', drawing_work: 'a-make', classroom_session: 'a-class', display_control: 'a-class', sleep: 'a-sleep', garden_care: 'a-garden', seed_planting: 'a-garden',
  carry: 'a-carry', raise_upright: 'a-build', connect_beam: 'a-build', release_support: 'a-build', install_joist: 'a-build', install_plywood: 'a-build',
  install_stair_flight: 'a-build', install_tread: 'a-build' };
// Eden client kits (mars/viewer/app/engine-view/content/assets): each maps to the row(s) it covers.
const KITS = {
  'commons-contrast': ['furniture'], 'commons-prefabs.ts': ['pavilions', 'furniture'], 'courtyard-house-proposal': ['courtyard'], 'covered-market-proposal': ['market'],
  'decorative-motion.ts': ['spin', 'boats'], 'dwelling-kit.ts': ['eden-houses'], 'eden-computers': ['event-kit'], 'eden-districts': ['harbour-clutter', 'signage'],
  'eden-event-kit': ['event-kit'], 'eden-expansion-assets': ['eden-houses', 'storeys', 'fountain', 'piers', 'gardens', 'street-props'], 'eden-facades': ['eden-houses'],
  'eden-imports': ['herds', 'plants', 'vehicles', 'gardens'], 'eden-interiors': ['buildings', 'rooms', 'furniture'],
  'eden-regions': ['districts', 'special-buildings', 'round-buildings', 'canal', 'sea', 'attractions', 'railway', 'heightfield', 'scatter'],
  'eden-sports-kit': ['sports-kit', 'pitches'], 'eden-street-props': ['street-props', 'plants'], 'eden-wayfinding': ['signage', 'a-schedule'],
  'eden-window-interiors.ts': ['lit-windows'], 'farm-barn-proposal': ['buildings'], 'garden-footbridge-proposal': ['bridges'], 'garden-greenhouse.ts': ['special-buildings'],
  'garden-monument.ts': ['monuments'], 'garden-pergola.ts': ['pavilions'], 'garden-quarter.ts': ['gardens'], 'interior-gathering-kit-proposal': ['furniture'],
  'monument-family-proposal': ['monuments'], 'native-shore-supports.ts': ['piers'], 'native-social-kit-actual': ['furniture', 'a-sit'], 'office-building-proposal': ['buildings', 'storeys'],
  'outdoor-stage-proposal': ['venues'], 'pavilion-vines.ts': ['pavilions', 'plants'], 'provisional-commons-rest': ['mats'], 'public-library-proposal': ['buildings'],
  'public-plaza-kit-proposal': ['squares', 'street-props'], 'room-furnishing-kit.ts': ['furniture'], 'seating-prefabs.ts': ['furniture'], 'shore-boat.ts': ['boats'],
  'social-place-kit': ['furniture', 'campfire'], 'transport-prop-family': ['vehicles'], 'vertex-soup.ts': ['props-helper'],
};
const LM_ITEMS = (s) => [
  ...s.scene.levels.map((l) => [`level ${l.id} (${l.label})`, l.id === 0 ? 'districts' : 'lm-levels']),
  ...s.scene.links.map((l) => [`link ${l.id}`, l.usable === false ? 'lm-shafts' : 'lm-levels']),
  ...s.buildings.map((b) => [`building ${b.file}`, 'lm-buildings']),
  ...s.kin.map((k) => [`kin ${k.model}`, 'kin-hover']),
  ...s.regions.map((r) => [`region ${r.id}`, r.kind === 'walkable' ? 'districts' : 'lm-levels']),
];

// ------------------------------------------------------------------ evaluate
const problems = [];
const tally = {};   // source → {lib, def, imp, gap}
const appendix = {};
function count(source, item, rowId, ref) {
  const r = rowId === 'props-helper' ? null : ROW[rowId];
  if (rowId !== 'props-helper' && !r) { problems.push(`${source}: ${item} → unknown row ${rowId}`); return; }
  if (ref && !(DEFS.has(ref) || GENS.has(ref))) problems.push(`${source}: ${item} → ${ref} is not in the library`);
  const st = r ? (r.st === 'imp' ? 'imp' : r.st) : 'lib';
  (tally[source] ??= { lib: 0, def: 0, imp: 0, gap: 0, n: 0 })[st]++; tally[source].n++;
  (appendix[source] ??= []).push([item, rowId, ref, st]);
}
const places = json('worlds/eden/places.v1.json').places;
for (const p of places) {
  const hit = EDEN_PLACE_ID.find(([re]) => re.test(p.id));
  const rowId = hit ? hit[1](p) : EDEN_PLACE_KIND[p.kind];
  if (!rowId) { problems.push(`eden place ${p.id}: kind ${p.kind} unmapped`); continue; }
  count('Eden places (places.v1.json)', `${p.id} [${p.kind}]`, rowId);
}
const spots = json('worlds/eden/activity-spots.v1.json');
for (const s of spots.spots) {
  const rowId = EDEN_ACTIVITY[s.activity] ?? EDEN_SPOT_BASE[s.base];
  if (!rowId) { problems.push(`eden spot ${s.id}: ${s.activity}/${s.base} unmapped`); continue; }
  count('Eden activity spots (activity-spots.v1.json)', `${s.id} [${s.activity ?? s.base}]`, rowId);
}
for (const k of ['interiors', 'shelves', 'solids', 'rings', 'platforms']) count('Eden activity spots (activity-spots.v1.json)', `${k} (${spots[k].length} entries: physical shells)`, { interiors: 'buildings', shelves: 'furniture', solids: 'special-buildings', rings: 'pavilions', platforms: 'pavilions' }[k]);
const mars = json('worlds/mars/camp/manifest.json');
for (const b of mars.buildings) count('Mars camp (manifest.json)', `building ${b.id}`, 'mars-camp-buildings', 'building/1');
for (const r of mars.regions) count('Mars camp (manifest.json)', `region ${r.id} [${r.kind}]`, MARS_REGION_ID[r.id] ?? MARS_REGION_KIND[r.kind] ?? (problems.push(`mars region ${r.id} unmapped`), 'districts'));
for (const f of mars.fixtures) { const m = MARS_FIXTURE[f.def]; if (!m) { problems.push(`mars fixture ${f.def} unmapped`); continue; } count('Mars camp (manifest.json)', `fixture ${f.id} [${f.def}]`, m[0], m[1]); }
for (const i of mars.items) { const m = MARS_ITEM[i.def]; if (!m) { problems.push(`mars item ${i.def} unmapped`); continue; } count('Mars camp (manifest.json)', `item ${i.id} [${i.def}]`, m[0], m[1]); }
for (const c of mars.construction.components) { const m = MARS_PART[c.def]; if (!m) { problems.push(`mars part ${c.def} unmapped`); continue; } count('Mars camp (manifest.json)', `part ${c.id} [${c.def}]`, m[0], m[1]); }
for (const a of mars.activities) { const rowId = MARS_VERB[a.verb]; if (!rowId) { problems.push(`mars verb ${a.verb} unmapped`); continue; } count('Mars camp activities (manifest.json)', `${a.id} [${a.verb}]`, rowId); }
const lm = json('worlds/littlemartians/scene.json');
for (const [item, rowId] of LM_ITEMS(lm)) count('Little Martians (scene.json)', item, rowId);
const kitDir = resolve(root, 'mars/viewer/app/engine-view/content/assets');
for (const k of readdirSync(kitDir).filter((n) => statSync(resolve(kitDir, n)).isDirectory() || n.endsWith('.ts')).sort()) {
  const rows = KITS[k]; if (!rows) { problems.push(`eden kit ${k} unmapped`); continue; }
  for (const rowId of rows) count('Eden client kits (engine-view/content/assets)', `${k} → ${rowId}`, rowId);
}
// every ref a row names must exist
const SCHEMAS = new Set(['genesis/1', 'def/1']);
for (const r of ROWS) for (const ref of (r.v.match(/core\/[a-z0-9-]+@\d+|\b[a-z-]+\/[12]\b/g) ?? []).filter((x) => !SCHEMAS.has(x))) {
  if (ref.startsWith('core/') ? !DEFS.has(ref) : !GENS.has(ref)) problems.push(`row ${r.id}: ${ref} is not in the library`);
}
for (const s of Object.keys(KITS)) if (!existsSync(resolve(kitDir, s))) problems.push(`kit ${s} listed but missing`);

// ------------------------------------------------------------------ render
const ST = { lib: 'now', def: 'now (define)', imp: 'via import', gap: 'not yet' };
const cats = ['places', 'structures', 'props', 'terrain', 'water', 'motion', 'weather', 'activities'];
const rowCounts = Object.fromEntries(cats.map((c) => [c, { lib: 0, def: 0, imp: 0, gap: 0 }]));
for (const r of ROWS) rowCounts[r.cat][r.st]++;
const esc = (s) => String(s).replace(/\|/g, '\\|');
let md = '<!-- matrix:begin (generated by tools/god-skill/scripts/parity/matrix.mjs --write; edit the script, not this block) -->\n';
md += `Library at generation: ${DEFS.size} core defs, ${GENS.size} generators. Status: **now** = composable today from the library; **now (define)** = composable today by defining a small kit/2 def; **via import** = a GLB brought in through \`POST /v1/god/assets\` (*in library* = already imported as a core def); **not yet** = a gap, with the lane or Stage-B item that closes it. **Souls** says whether a Soul can use it in an entity world today (*works*) or which Stage-B item (eden4/31) gives the use.\n\n`;
md += '### Summary by feature family (rows)\n\n| Family | now | now (define) | via import | not yet | rows |\n|---|---:|---:|---:|---:|---:|\n';
const tot = { lib: 0, def: 0, imp: 0, gap: 0 };
for (const c of cats) { const x = rowCounts[c]; for (const k in tot) tot[k] += x[k]; md += `| ${c} | ${x.lib} | ${x.def} | ${x.imp} | ${x.gap} | ${x.lib + x.def + x.imp + x.gap} |\n`; }
md += `| **all** | **${tot.lib}** | **${tot.def}** | **${tot.imp}** | **${tot.gap}** | **${ROWS.length}** |\n\n`;
md += '### Summary by source item (every item in the source files, mapped to a row)\n\n| Source | items | now | now (define) | via import | not yet |\n|---|---:|---:|---:|---:|---:|\n';
for (const [s, x] of Object.entries(tally)) md += `| ${s} | ${x.n} | ${x.lib} | ${x.def} | ${x.imp} | ${x.gap} |\n`;
md += '\n';
for (const c of cats) {
  md += `### ${c[0].toUpperCase() + c.slice(1)}\n\n| Feature | Worlds | Status | Vocabulary | Souls | Next / caveat |\n|---|---|---|---|---|---|\n`;
  for (const r of ROWS.filter((r) => r.cat === c)) md += `| ${esc(r.f)} \`${r.id}\` | ${r.w} | ${ST[r.st]}${r.inLib ? ' (in library)' : ''} | ${esc(r.v)} | ${r.souls} | ${esc(r.next ?? '')} |\n`;
  md += '\n';
}
md += '### Gaps (not yet), in one list\n\n';
for (const r of ROWS.filter((r) => r.st === 'gap')) md += `- **${r.f}** (\`${r.id}\`) — ${r.next}\n`;
md += '\n<details><summary>Appendix: every source item and its row</summary>\n\n';
for (const [s, items] of Object.entries(appendix)) {
  md += `#### ${s}\n\n`;
  const byRow = {}; for (const [item, rowId, , st] of items) (byRow[`${rowId} — ${ST[st]}`] ??= []).push(item.replace(/ \[.*\]$/, '').replace(/ → .*$/, ''));
  for (const [k, l] of Object.entries(byRow)) md += `- \`${k}\` (${l.length}): ${l.join(', ')}\n`;
  md += '\n';
}
md += '</details>\n<!-- matrix:end -->';

if (process.argv.includes('--write')) {
  const doc = resolve(root, 'docs/god/PARITY.md');
  const cur = existsSync(doc) ? readFileSync(doc, 'utf8') : '';
  const next = cur.includes('<!-- matrix:begin') ? cur.replace(/<!-- matrix:begin[\s\S]*?<!-- matrix:end -->/, md) : `${cur}\n${md}\n`;
  writeFileSync(doc, next);
  console.log(`wrote ${doc}`);
}
console.log(Object.entries(rowCounts).map(([c, x]) => `${c}: now ${x.lib}, define ${x.def}, import ${x.imp}, gap ${x.gap}`).join('\n'));
console.log(`rows ${ROWS.length}; ` + Object.entries(tally).map(([s, x]) => `${s.split(' (')[0]} ${x.n}`).join(', '));
if (problems.length) { console.log(`\n${problems.length} problem(s):\n- ` + problems.join('\n- ')); if (process.argv.includes('--check')) process.exit(1); }
else console.log('complete: every source item maps to a row; every named ref is in the library');

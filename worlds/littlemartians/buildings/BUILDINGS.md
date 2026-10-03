# Little Martians buildings — Ceramic Tower and Minaret Temple

A building type of the Little Martians world (`/w/littlemartians`) only. Both are
rebuilt from scratch as clean procedural geometry after Vanessa Rosa's ceramic
sculptures. They do not use the scan meshes and are not decimated scans. Only
the glaze is taken from the scans: the scans' colour and normal texture atlases
are quilted into seamless glaze textures. Generator: `tools/buildings/` (Blender
Python). Regenerate with
`blender -b --factory-startup --python tools/buildings/generate.py` (about 15 s).

| file | what |
|---|---|
| `ceramic-tower.glb`, `minaret-temple.glb` | the buildings: one mesh node each, metres, +Y up, front facing +Z, origin at the centre of the base on the ground. Textures embedded (JPEG). |
| `ceramic-tower.footprint.json`, `minaret-temple.footprint.json` | engine footprint (schema below) |
| `validation.json` | the validator's report on the exported GLBs (re-imported) |
| `textures/*-glaze.jpg`, `*-glaze-normal.jpg` | 1024² seamless glaze colour and normal maps derived from the scan textures (already embedded in the GLBs; kept so the generator runs without the source archive) |
| `previews/` | renders of the exported GLBs and SVG plans (list below) |

## Scale and the envelope

No head size is defined yet, so the design envelope is a floating head of up to
**1.5 m** across (`HEAD_DIAMETER`, `tools/buildings/model.py`). Every door, window
and shaft keeps a clear rectangle of at least **2.2 m × 2.2 m** (`MIN_CLEAR`),
inset 0.15 m from the opening's edges. The orange spheres in the previews are
1.5 m scale heads. If heads end up bigger, scale the GLB and footprint uniformly.
Every footprint quantity is linear in metres, so multiply coordinates, halves,
widths and y values by the same factor.

## Ceramic Tower (`ceramic-tower`)

Pale blue-green glaze. Four stepped tiers, round arches on all four sides of
every tier, drip ribs down the walls, turrets at the four base corners,
pinnacles on the upper tiers, a rounded crown, a ball and a finial spike.
19.0 × 19.0 m footprint (with turrets), **38.3 m** tall. 16.3k triangles, 0.80 MB.

| level | room | floor y | clear height | room width | openings |
|---|---|---|---|---|---|
| 0 | ground hall | 0.5 | 8.0 | 16.8 | 12 arched doors (3.4 wide, 6.8 high) |
| 1 | second room | 9.0 | 6.5 | 13.4 | 8 arched doors onto the terrace (2.8 × 4.8) |
| 2 | third room | 16.0 | 5.5 | 10.0 | 4 arched doors (3.0 × 4.7) |
| 3 | lantern room | 22.0 | 5.0 | 7.0 | 4 arched doors (2.8 × 4.0) |

Each tier's roof is a terrace around the tier above (levels 1–3, 1.5–1.7 m wide,
pinched by the corner pinnacles). Round shafts through floors 0→1, 1→2 and 2→3
(3.4 m, 3.2 m and 3.0 m across) let a floater rise inside.

## Minaret Temple (`minaret-temple`)

Darker blue glaze on a clay plinth. Four legs with flared feet, joined by tall
round arches (an open pavilion). Above that, a domed body that rises nearly
vertically and then draws in, with pinched corner ridges. One side pair has a
tall arched window, the other a twin pair of round windows, and the upper hall
has a round window on each side. Then a lantern with four arches, two stepped
drums with cornices, and a spike. 19.2 × 19.2 m plinth (body 16 m), **45.0 m** tall.
10.5k triangles, 0.58 MB.

| level | room | floor y | clear height | room width | openings |
|---|---|---|---|---|---|
| 0 | pavilion | 0.6 | 13.2 | 14.6 | 4 tall arches (9.0 wide, apex at y 13.6), open on all sides |
| 1 | body hall | 14.3 | 7.7 | 14.8 | 2 arched windows (3.4 × 4.5, sill 1.5), 4 round windows (⌀3.2) |
| 2 | upper hall | 22.5 | 13.0 (into the lantern) | 14.1 at the floor, narrowing upwards | 4 round windows (⌀3.2), 4 lantern arches (2.6 × 3.1) |

Shafts: 3.6 m from the pavilion up into the body hall, 3.4 m from the body hall
into the upper hall. The upper hall rises into the lantern.

## Footprint schema `lm-building-footprint/1`

Engine coordinates: metres, **Y up**, ground plane **(x, z)**, front **+z**, origin at
the base centre (y = 0). The shapes follow the Mars engine where they can
(`engine/spatial/types.ts`, `engine/world/types.ts`, `engine/core/math.ts`). To place
a building, rotate and translate every point, `obb.c` and `obb.yaw`, and add the
placement yaw to every `obb.yaw`.

- `levels[]`: `{id, y, label}` — as engine `Level` (`y` = floor top).
- `rooms[]`: `{id, label, kind:'place', level, y0, y1, polygon, clearHeight}`. A region
  per room. `polygon` is the inner wall face at floor level, counter-clockwise in
  (x, z) (positive shoelace area). `y0`/`y1` are floor and ceiling.
- `terraces[]`: `{id, kind:'walkable', level, y, polygon, hole}`. Tower roofs, a ring
  (outer polygon minus `hole`).
- `obstacles[]`: `{id, kind:'wall'|'solid', obb:{c, half, yaw}, y0, y1, room?, level?}`.
  Exactly the engine `Obstacle` prism (`yaw` rotates (x, z) as `rot2`). Walls come in
  height bands. Within a band a gap is left only where an opening's clear area
  spans the whole band, so every gap is really open and every wall piece is really
  solid. Arch heads and circle caps are followed with 0.6 m steps.
  `solid` = feet, turrets, pinnacles and ribs (bounding boxes).
- `portals[]`: openings. Doors and windows have `{id, kind:'door'|'window', from, to,
  level, center:[x,y,z], normal (outward), width, y0, y1, opening:{shape, width, y0, y1},
  wallThickness}`. `width` × (`y1` − `y0`) is the guaranteed clear rectangle centred
  on `center` in the wall plane. `to` is `'outside'` (a terrace or the ground).
  Shafts have `{kind:'shaft', from (room below), to (room above), center, diameter,
  y0, y1}`.
- `links[]`: one per shaft, shaped like the engine `Link` (`from`/`to` `{level, p, y}`,
  `width`, `path`, `usable`). `kind:'float'` is **not** in the engine's union yet:
  these are float-only (`floatOnly: true`), since floaters rise through a shaft and
  walkers cannot use one. Merge as the floater planner needs.
- `envelope`: `{headDiameter, minClear}`; `bounds`: the GLB's measured bounds.

Floor slabs are not listed as surfaces. Each room's floor is its polygon at
`y0`, with the shafts (portals) as holes.

## Validation (`validation.json`, run on every generate)

Every check runs against the **exported GLB, re-imported**:

1. **No face spans an opening.** A 7 × 7 grid of rays crosses each door and window's
   clear rectangle through the wall, plus a grid of vertical rays across each
   shaft. Tower: 1519 rays, 0 blocked. Temple: 980 rays, 0 blocked.
2. **A head passes through.** A 1.5 m sphere is swept through every portal's centre
   to 1 m beyond both faces. The smallest clearance (radius 0.75 needed) is
   1.40 m for the tower and 1.23 m for the temple.
3. **Rooms are open.** Inside every room, wherever the footprint says it is free, a
   head fits at 1.0 m and 2.5 m above the floor (1572 and 1562 samples, all pass).
4. **The footprint is truthful.** Every wall or solid obstacle has mesh under it
   (384 and 662 obstacles), and no obstacle overlaps a portal.
5. **Portal size.** Every clear rectangle and shaft is at least 2.2 m. Smallest:
   tower doors 2.5 m wide, temple round windows 2.24 m wide and lantern arches 2.26 m high.

`tools/buildings/selftest.py` checks that the validator rejects a falsified footprint
(a door slid into solid wall, an undersized door, a phantom wall).

## Previews

Rendered by `generate.py` from the exported GLBs (EEVEE, sky and sun, 1.5 m heads for scale):

- `~/Eden/.merge-work/buildings/worlds/littlemartians/buildings/previews/both.jpg` — both buildings side by side
- `…/previews/ceramic-tower-front.jpg`, `…/ceramic-tower-back.jpg`, `…/ceramic-tower-section.jpg` (half cut away, rooms and shafts)
- `…/previews/ceramic-tower-inside-L0.jpg` … `-inside-L3.jpg`, `…/ceramic-tower-up-shaft.jpg`
- `…/previews/minaret-temple-front.jpg`, `-back.jpg`, `-section.jpg`, `-inside-L0.jpg` … `-inside-L2.jpg`, `-up-shaft.jpg`
- `…/previews/ceramic-tower-plan.svg`, `minaret-temple-plan.svg` — footprint plans per level (walls cut 1 m above each floor)

(`…` = `~/Eden/.merge-work/buildings/worlds/littlemartians/buildings`; after the
merge, the same paths under the main checkout.)

## Limitations

- These are interpretations, not replicas. The sculptures' hand-made irregularity
  (lumps, drips, leaning walls) is suggested by ribs, ridges and the glaze texture,
  not modelled.
- The glaze is one quilted texture per building, box-projected in world space at
  7 m per repeat. Seams can show where a face's dominant axis changes.
- The temple's tapering body is footprinted in 1.5 m bands, each using the band's
  narrowest inner face, so the upper hall's wall obstacles step inwards.
- Wall bands treat the thin top of an arch (narrower than 0.3 m) as wall.
- Head size is assumed (1.5 m). The lead may rescale.
- The temple's corner ridges and the tower's cornices and crown are ornament.
  They are not listed as obstacles (they sit on or in walls and roofs).

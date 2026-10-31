Kit contract and visual gate
===========================

`make.args.v` is a contract version, separate from `def.version`. Omitted or `1` preserves the shipped
geometry, material grouping, glow, ignored legacy fields and physics estimates. `2` opts into the changes below.
Never migrate retained content implicitly. Unknown versions refuse.

The viewer build includes `kit-contract.json`. Server startup configures generator admission from the manifest in
`WEB_DIR`; absent, malformed or unknown manifests support only contract 1. Offline compiler/studio tools support this
source's version 2. Baking retained content remains available even if admission is limited by an older viewer.
Build and serve the viewer and restart the server together before authoring v2. Already-open older tabs need reload.

Contract 2
----------

* `arc` is radians: `(0,2π]` on lathe, sphere, cyl, cone, ring and torus; `(0,π]` on arch. Defaults retain a full
  revolution, or π for an arch. Revolution arcs begin on +z toward +x; arch arcs trim symmetrically at the crown.
* `glow` zero is off; `(0,.25]`, `(.25,.5]`, `(.5,.75]`, `(.75,1]` use .2, .4, .65, 1 emission. Shapes merge by
  material and level, including within each moving role. Emission uses vertex colours, survives material clones,
  and retains its ratio under the night multiplier. `material: "emissive"` defaults to the highest level.
* Material finishes use their declared roughness/transparency. Kit metal uses roughness .32, metalness .25 so most
  light remains diffuse without an environment map; other users of MaterialLib retain their existing metal look.
* Extrude `holes` contains 1–16 interior outlines (each 3–64 points) in the same x,z coordinates as `polygon`.
  Either winding is accepted. All contours must be simple, disjoint and strictly interior; omit repeated endpoints.
  `round:0` keeps narrow tracery sharp. Holes are visual only: the collider fills the outer box.
* `kind:"loft"` pairs `polygon[i]` at y=0 with `top[i]` at y=`h` (default 1), relative to `at`. Both outlines need
  equal vertex counts and winding. Concave caps triangulate; sides are ruled triangles. Match corresponding vertices.
* Sweep `profile` is a simple closed 2-D outline instead of `r`/`segments`. Its initial +y faces projected world up
  (−z for vertical paths); the frame transports along the Catmull–Rom path. A +z path maps profile +x/+y to world +x/+y.
* Surfaces are presentation only and opt-in, so retained v2 content keeps its look. With kit-level
  `surfaces: true`, opaque unlit shapes of wood, bark, stone, rock, cobble, brick, plaster, tile, thatch, metal, fabric,
  sand, gravel, dirt, mud, leaf, moss and grass take the Eden realism shader by material class. A shape's `pattern`
  (`marble`, `ashlar`, `planks`, `shingles`, `stripes`; `none` = flat) replaces that surface and needs no kit flag.
  A per-vertex `edenSurf` (shape-local metres, stripe count around round shapes, seed) keeps patterns on the shape;
  class looks read the shape-local normal (a pitched slab is treated as level); shingle courses follow world up. Contract 1 refuses `pattern` and
  `surfaces` when defined and draws retained data flat; `?surfaces=0` turns surfaces off. Retained v2 content has
  neither field, so it draws exactly as before.
* Unsupported shape fields refuse with a field path and fix. Segments that would be clamped refuse. Physics includes
  bevels and a conservative spline control hull; all new shapes retain boxes. Triangle estimates cover actual cap,
  bevel and subdivision counts and refuse above 80,000 before meshing.

`gallery-language-examples.json` is a ready-to-define JSON array: slit dome, one-shape rose tracery, one-shape curved
roof, loft canopy and four glow levels. No program or external generator is required for the roof.

Pixel gate (real headless Chrome)
---------------------------------

From the repository root (unset `NODE_USE_SYSTEM_CA` if your environment sets it). Runs take a machine-wide Chrome
lease (`tools/god-skill/lib/chrome-lease.mjs`); output defaults to the ignored `.lane/gallery/`.

```
node tools/god-skill/scripts/gallery.mjs --local --out .lane/gallery-before
# edit the mesher
node tools/god-skill/scripts/gallery.mjs --local --out .lane/gallery-after --compare .lane/gallery-before
```

Each run writes `sheet.png`, `gallery-input.json`, a frozen `studio.js`, per-cell RGBA and `gallery.json`.
The after-run additionally writes `diff.json`: per-def changed pixels/percent/max channel difference and triangle
counts/delta. Any difference or render error fails. An intentional change requires `--allow reasons.json`, a map
from def name (or `name/phase`) to a nonempty explanation. Added and removed defs also require reasons. Labels and
timestamps are excluded. All comparison rows remain in the report, including unchanged defs.

The studio renders at most 128 cells / 60 rows per WebGL canvas, avoiding the full library's >16k height. `--walk` and
`--frames n` include stride captures; both runs need identical options. `--defs file.json` uses a local def array;
`--bundle-only` prepares artifacts without claiming pixels. `--studio-bundle saved/studio.js` replays the exact old
renderer after editing source. `gallery-diff.mjs before after [reasons.json]` compares saved captures without Chrome.

Where Chrome cannot launch, `gallery-geometry.mjs --before-source saved-kit.mesh.ts --out dir` records per-def
geometry/material hashes, shapes, triangles and draws. `--snapshot world.json` selects snapshot kits; `--defs file`
measures examples. This is supplementary evidence, not a passing pixel gate.

`tools/god-gate.mjs` always runs the offline kit and diff tests. Set `GOD_GALLERY_BEFORE` and `GOD_GALLERY_AFTER`
to add the recorded pixel gate (`GOD_GALLERY_ALLOW` optionally supplies reasons). Without captures it explicitly
reports `gallery-pixels: NOT RUN`; an offline green gate does not claim visual approval.

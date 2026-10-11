# CATALOG-PROGRAM: growing the catalogue to 10,000 items

**Status:** design for Gene's review (item 9 of `eden4/37-PM-BRIEF-20261011.md`). No bulk content gets made until this is
approved. Written 2026-10-11 by lane CATPROG on `root/world-engine` @ ac4cee45.
**Builds on:** `docs/god/VOCAB.md` (how one type is inducted today) and the final reports of the VOCAB-MECH, VOCAB-W1/W2/W3,
PERF and LAYERS lanes (`team/lanes/*.md`).

## 0. Summary

Overnight we went from about 30 to 766 catalogue defs. The mechanism works: a taxonomy, ranged params, slots, actuators
that Souls can use, search, lazy GLB loading and a lint. But that mechanism has a ceiling, and three things in it will
not survive 10k items:

1. **Every world copies the whole library.** At genesis and on every load, `GodMode` defines all of `CORE_KIT` into the
   world's own model and commits the defs it lacks (`apps/server/src/god/god.ts` ~L72). Today that is 766 defs and
   1.6 MB of JSON per world. At 10k it would be about 21 MB per world, and each catalogue release would write a commit
   carrying hundreds of defs into every world.
2. **The viewer bundles the whole library.** `animals.mesh.ts` and `humanoid/look.ts` import `CORE_KIT` to look up two
   defs, so all 1.6 MB ships inside the web `Shell` chunk (3.4 MB). At 10k that is about 20 MB of JavaScript.
3. **Adding a type means editing shared files.** Every lane tonight edited `core-kit/index.ts`, `authoring/build.mjs`
   FAMILIES, a family JSON array, and sometimes `schemas.ts`, `catalog.test.ts` or other lanes' family files (W2 added
   sound to fountain, windmill and stream). Def hashes changed under the same `name@1`. That works with three lanes in
   one night. It will not hold up over weeks of autonomous work.

The proposal has four parts:
- **(a)** A catalogue *item* record (`item/1`) wraps an engine *def* (`def/2`, a strict superset of def/1). Identity,
  licence, provenance, budgets, media and test results live on the item. Worlds pin only the def's content hash.
- **(b)** Scale by tiering:
  - agent context gets the taxonomy first, then category pages, then single defs;
  - the server holds one shared, content-addressed library, and each world stores only the defs it uses;
  - assets are immutable on R2 behind a CDN;
  - each world gets budgets that the compiler checks.
- **(c)** The catalogue becomes its own package and registry with a pinned contract to the engine. Automated gates run
  in order, and an item is published by moving a channel pointer, not by a git merge.
- **(d)** Playability is measured from what gods place and keep and what Souls actually use. It feeds search ranking and a
  short daily review queue for Gene.

### What exists today (measured tonight)

| fact | value | source |
|---|---|---|
| defs in the core kit | 766 (81 categories in use; the taxonomy has 101) | measured on ac4cee45 |
| manifest (one line per def) | 179 KB, 44 KB gzipped, 234 B per line (~60 tokens), ~46k tokens in total | same |
| full defs | 1.63 MB, 248 KB gzipped; median def 1.2 KB, p90 4.5 KB, max 13.7 KB (`core-school`, which has contents) | same |
| GLB-backed (`make: mesh`) defs | 319 (Mars, LM, imported packs); kit, preset and set defs cost 0 asset bytes | same |
| GLBs if one of each is placed | 187 files, 87–90 MB; the bucket plan has 281 objects, 92.6 MB | VOCAB-MECH |
| lazy loading, 343 types placed | 2.1 MB of GLB in the first 5 s (89.9 MB before), 10.1 MB at 20 s; snapshot 112 KB gz (581 KB before) | VOCAB-MECH |
| draw calls, busy god-built world (226 things) | 247–272 draws, 1.3–1.5 ms render CPU per frame | PERF |
| draw calls, GLB-heavy (mars-two, 158 things) | 977–1031 draws after merging (2018–2145 before) | PERF |
| texture memory, LM world | ~260 Mpx after fitting (586 Mpx before) | PERF |
| type-induction pace | W1: 98 types and W2: 62 types (kit/preset), W3: 65 furnished buildings and fixtures, each in a 0.5–3 h lane | lane reports |
| defects found only by a human looking | awning underground, dartboard floating, variants all one colour, invisible car windows, motorboat a solid block, police-cell bars unreachable, a desk seat that traps a Soul | W1–W3 |

The last row matters most for (c). Every one of those defects can be checked by a machine, and at 10k items nobody
can look at everything.

---

## (a) A hardened, versioned, extensible item schema

### Two records: the item and the def

- **The def** is what the engine compiles and a world stores: shape, params, physics, interfaces. It is hashed, and a
  world pins the hash forever.
- **The item** is the catalogue's record *about* a def: its name and versions, words, licence, provenance, media,
  budgets, tests, playability stats and review status.

Keeping them apart means a new thumbnail, a better synonym or a test result never changes a def hash, so it never forks
the worlds that use the def. Today `category`, `synonyms` and `description` sit inside the hashed def. Adding a synonym
therefore creates a "new" def under the same `name@1`, so different worlds hold different hashes for `core-fountain@1`.

### Identity and versioning

- **`id`**: `<namespace>/<name>`, for example `eden/cafe`, `lm/arium-tower`, `mars/mimos`. Namespaces are `eden` (the
  public catalogue), pack namespaces (`lm`, `mars`) and later `w/<world>` for things a world owner made.
- **`major`**: an integer, giving the ref `eden/cafe@2`. A world places `@2` and gets the latest revision of major 2. A
  change that can break a world bumps the major:
  - a param removed, renamed, or its range narrowed;
  - a slot, state field or action removed;
  - the box changed by more than 10%;
  - the anchor or form changed.
  A tool (`catalog compat`) diffs two revisions and decides. Nobody judges it by hand.
- **`rev`**: the def's content hash. It is immutable, and worlds pin it. Old worlds keep exactly what they placed, so
  republishing can never move a world's furniture.
- **`status`**: `draft → candidate → stable → deprecated → yanked`, explained in (c).

### The schema (zod-ish; the full version goes in `packages/catalog/src/schema.ts`)

```ts
// ---- the def: what worlds pin. def/2 = def/1 + stricter params + declared interfaces + physics + lod.
const def2 = z.object({
  schema: z.literal('def/2'),
  name: NAME, version: z.number().int().min(1),          // `version` = the item's major
  form: z.enum(['point', 'path', 'area']),
  make: makeSchema,                                       // kit/2 | gen | parts | mesh(+lod1) | none (unchanged)
  // every number has a range and a default; every enum a default (today vocab.lintDef enforces this only for categorised defs)
  params: z.record(ID, z.discriminatedUnion('type', [
    z.object({ type: z.literal('number'), min: num, max: num, default: num, step: num.optional(), unit: z.enum(['m', 'deg', '%', 'rpm', 's', '']).default(''), doc: z.string().max(200), group: z.enum(['stretch', 'warp', 'paint', 'wear', 'variant', 'option', 'own']) }),
    z.object({ type: z.literal('enum'), values: z.array(z.string()).min(1).max(64), default: z.string(), doc: z.string().max(200), group: z.string() }),
    /* int | bool | color | string: same shape, all with default + doc */ ])),
  state: fieldsSchema,                                    // public entity state (open, on, lit, level, …)
  // the interfaces, declared (def/1 expands actuators into state + actions; def/2 keeps the declaration and expands at load)
  slots: z.array(slotSchema),                             // seat, bed, surface, stand, door, hang, carry, socket, room, floor, perch, shelf
  actuators: z.array(z.tuple([z.enum(['power', 'door', 'lock', 'fill', 'ignite', 'play']), z.object({ default: value.optional(), label: z.string().optional() })])).default([]),
  actions: z.array(actionSchema),                         // any other declarative action (when on own state → set/toggle)
  components: componentsSchema,                           // seat, container, light, readable, sound, behavior, spin, venue, … (open set, see below)
  // physics and footprint
  size: z.object({ box: v3, scale: z.tuple([num, num]) }),
  anchor: z.enum(['base', 'center', 'conform', 'drape', 'float']), layer: z.enum(['solid', 'surface', 'volume', 'decor']),
  physics: z.object({
    collide: z.enum(['box', 'walls', 'hull', 'mesh', 'none']),   // walls = wall segments (enterable things never get solid blocks)
    blocksNav: z.boolean(), walkableTop: z.boolean().default(false),
    mass: num.optional(), approach: z.array(v2).optional(),        // where a body stands to use it (tonight's unreachable bars)
  }).optional(),
  contents: z.array(partSchema).optional(), layers: layersDefaults.optional(),   // furnishing; LAYERS defaults (deferred, hidden)
  material: materialEnum.optional(), palette: z.record(z.string(), hex).optional(),
});

// ---- the item: the catalogue's record about a def. Never hashed into worlds.
const item1 = z.object({
  schema: z.literal('item/1'),
  id: z.string().regex(/^[a-z][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/), major: z.number().int().min(1),
  rev: sha256,                                            // = hash(def); filled by the build
  status: z.enum(['draft', 'candidate', 'stable', 'deprecated', 'yanked']),
  supersedes: z.array(sha256).default([]),                // earlier revs of this major
  // words: what agents and gods read (search + manifest)
  text: z.object({
    title: z.string().max(60), first: z.string().max(160),        // first sentence: what, size, use
    description: z.string().max(2000), category: CATEGORY, alsoIn: z.array(CATEGORY).max(3).default([]),
    synonyms: z.array(z.string().min(2).max(40)).min(3).max(24), heldOut: z.array(z.string()).max(8).default([]),  // eval words, not indexed
    i18n: z.record(z.string(), z.object({ title: z.string(), synonyms: z.array(z.string()) })).optional(),
  }),
  affords: z.array(z.string()),                           // derived: sit, lie, open, switch-on, pick-up, buy, … (from slots/actuators/components)
  sound: z.object({ kinds: z.array(z.string()) }).optional(),          // derived from components.sound, for search facets
  behaviour: z.object({ kind: z.string() }).optional(),                // derived from components.behavior
  budgets: z.object({                                     // measured by the build, never typed in
    tris: z.object({ lod0: int, lod1: int.optional() }), draws: int, materials: int,
    bytes: z.object({ def: int, assets: int, textures: int }), texturePx: int,
    limit: z.string(),                                    // the class limit it was checked against, e.g. "object: 400 t"
  }),
  licence: z.object({ spdx: z.enum(['CC0-1.0', 'CC-BY-4.0', 'Eden-internal']), attribution: z.string().optional(), source: z.string().url().optional() }),
  provenance: z.object({
    route: z.enum(['kit', 'preset', 'set', 'generator', 'glb', 'import']),
    author: z.string(),                                   // 'lane:vocab-w2', 'human:gene', 'world:<id>'
    run: z.string(), at: isoDate, parents: z.array(sha256).default([]),   // preset/set ancestry, source scans
    tool: z.string(), sourceHash: sha256,                 // hash of the authoring source (src.mjs / GLB)
  }),
  media: z.object({ thumb: sha256, views: z.array(sha256).max(8), states: z.record(z.string(), sha256).default({}) }),
  tests: z.object({ contract: z.string(), gates: z.record(GATE, z.object({ ok: z.boolean(), at: isoDate, report: z.string(), numbers: z.record(z.string(), num).optional() })) }),
  play: z.object({ placed: int, kept: int, worlds: int, soulUses: int, score: num.optional() }).optional(),   // (d), refreshed nightly
  review: z.object({ by: z.string(), verdict: z.enum(['ok', 'fix', 'reject']), note: z.string().optional(), at: isoDate }).optional(),
});
```

**Extensibility.** Both records reject unknown top-level keys. New *capabilities* go through `components` (an open,
versioned set, the way `sound` was added tonight) and new interface verbs through the `slotKind` and actuator enums. The
contract (part (c)) states which component kinds and generator ids the engine version understands. An item that needs
an unknown one fails G1 with `capability.unknown`, and the request goes to the engine trunk. The pipeline never forks
engine code.

### Migration from def/1

- **Worlds are never rewritten.** They store def/1 records pinned by hash, and def/1 keeps loading forever: the compiler
  keeps its def/1 reader. Replay determinism is kept.
- **`def1to2(d)`** is a pure, deterministic upgrader:
  - fills `min`/`max`/`default` from the conventions (stretch 0.5–2 and so on), or from the generator's own params;
  - sets `doc` from the generator field;
  - recovers `actuators` by recognising the expanded state and action pairs;
  - fills `physics` from `make.collide` and the layer;
  - moves `category`, `synonyms`, `description` and `tags` into the item's `text`.
  A def/2 hash is computed over def/2 canonical JSON, so an upgraded def gets a new rev. That is fine, because only
  *new* placements use it.
- **A one-off script, `catalog import-core`,** writes an `item/1` for each of the 766 core defs:
  - the category (inferred where missing);
  - synonyms (where an item has fewer than 3, it is queued for a text pass, not blocked);
  - licence: `Eden-internal` for `lm/*` and `mars/*`, and `CC0-1.0` for kit types we authored;
  - provenance from the family file and lane;
  - media from the existing `/thumbs/<hash>.png`;
  - the gates as "grandfathered, not yet run".
- **Old worlds keep running unchanged.** They resolve `core/<x>@1` through an alias table (`core/x@1 → eden/x@1`), so
  existing ops and god scripts work.

---

## (b) Scale to 10,000 items

### Search and agent context: tiers, not one manifest

At 234 B per line, a 10k-line manifest is 2.3 MB, about 600k tokens. That does not fit in an agent's context and never
will. A god sees three tiers:

| tier | what | size at 10k | when it is read |
|---|---|---|---|
| T0 | the taxonomy: about 150–300 categories with counts, the conventions and actuators, and **3 exemplar items per category** | ~20 KB, ~5k tokens | once per session (ETag) |
| T1 | one category page: manifest lines, ranked by playability, 50 per page | ~12 KB, ~3k tokens per page | when browsing a category |
| T2 | `defs <ref>`: one def in full, with params, slots and actions | 1–14 KB | before placing something new |
| search | `find <words>` / `--has slot:sit` / `recommend <intent>`: top 10, each with why | ~2.5 KB | most of the time |

**Search** stays lexical first. The current `searchDefs` (name, synonyms, category words, first sentence, facets) plus a
ranking prior from play stats (d) is what we have. Tonight it got every everyday word first: 21/21, 27/27 and 36/36 in
W1–W3, including smokestack, bakfiets and bodega. We should not add embeddings because they sound right; we should add
them only when an eval says lexical search falls short. To that end:

- **The eval is a standing set.** Every item has `text.heldOut`: 2–3 words a person might use that are deliberately not
  in its synonyms. Gate G5 (part (c)) checks that the item ranks in the top 3 for them, and that no existing item loses
  its first-hit word.
- **Zero-result and low-confidence `find` queries from real gods are logged.** They are the demand signal for new items
  and for new synonyms.
- **If held-out recall@3 falls below 90%**, add a small local embedding index:
  - 10k items × 384 dimensions at int8 = 3.8 MB, held in server memory;
  - computed in the build, so there are no runtime model calls;
  - fused with lexical scores.

  That is a contained change behind `find`, so agents see no difference in the interface.

### Delivery, caching and CDN

- **Defs.** A world's snapshot already carries only the defs *in use* (`god.ts` `publicDef` filter). With the shared
  library, the same holds on the server: worlds store refs and hashes, and a def's JSON lives once in
  `library/defs/<hash>.json`. Viewers can also fetch defs by hash (`/defs/<hash>.json`, immutable) instead of in the
  snapshot when a world uses many.
- **Assets.** GLBs, textures and thumbnails are already content-addressed and immutable (`max-age=31536000, immutable`,
  ETag = sha). When they leave the box, they move to R2 with the layout `bucket-plan.mjs` already writes,
  `assets/<sha[0:2]>/<sha>.<ext>`, served from an assets domain behind Cloudflare. R2 has no egress fees. A cache miss is
  a single fetch from R2, and the box is no longer in the path.
- **Thumbnails** become 256 px WebP (about 10–20 KB each), so 10k items with 4 views is roughly 0.6 GB on R2. The god's
  catalogue page and Gene's review queue fetch them once per browser.
- **Kit, preset and set items stay the default route.** They cost 0 asset bytes and ~1.2 KB of def, so 10k of them is
  about 12 MB raw and 2 MB gzipped *for the whole library*. A world that uses 300 of them pays ~350 KB. GLB items are
  the exception and pay their way through the budgets below.

### Per-world payload limits (checked by the compiler, reported to the god)

| budget | limit | today |
|---|---|---|
| eager GLB bytes (before the arrival card closes) | 24 MB (exists: `EAGER_BYTES`) | LM 28 MB at the card |
| distinct GLB bytes in the world | 150 MB (warn), 300 MB (refuse a new GLB type) | everything placed at once: 90 MB |
| def bytes in the snapshot | 1 MB gzipped | 112 KB with 343 types |
| distinct textured materials | 200 | — |
| texture memory (after fitting) | 300 Mpx | LM ~260 Mpx |

A `place` that would cross a refuse line fails with `world.budget` and the reason ("this world already loads 300 MB of
models; use a kit type or remove …"). The `world-status` CLI shows all five numbers.

### Runtime cost per placed thing; instancing; memory

- **Measured today.** A kit-built world costs about **1.1 draws per thing** (226 things, ~260 draws, 1.4 ms CPU): kit/2
  is merged per def, and identical instances share an `InstancedMesh` (`instanceKey`). GLB things cost **about 6 draws
  each** (mars-two) because the static merge keeps one draw per material.
- **Per item.** The build measures `draws`, `materials` and `tris.lod0` and records them in `budgets`. The class limits
  stay as in VOCAB §3 (object 400 t, furniture 600 t, building 6k t), plus **draws ≤ 4 for anything below building
  class** and **materials ≤ 4**.
- **Per world, at the arrival view.** Up to 1,500 draws, 1.5 M visible triangles, and a GPU frame within 10 ms at dpr 2
  on the M3 Max (the probe: `tools/god-skill/e2e/perf-probe.mjs`). The adaptive-resolution safety net protects weak
  laptops beyond that.
- **Two engine items this needs**, filed as capability requests and not done by the pipeline:
  1. Instance static GLBs per sha after `static-merge` (`mesh.mesh.ts` has no `instanceKey` today, so 40 identical
     scanned chairs cost 40× their draws).
  2. A GLB above 5k triangles must carry `lod1` (the field exists in `make.mesh`), and distant things fall back to it.
     Impostors (the thumbnail as a billboard beyond ~150 m) come later, if the probe asks for them.
- **Memory.**
  - Viewer textures are already capped (colour 1024, PBR maps 512). KTX2/Basis compression (brief item 6) would cut GPU
    memory about 4–6× more.
  - Kit geometry is shared through instancing.
  - Server: the shared library at 10k is ~12–25 MB of JSON, about 60–100 MB of heap, held *once* per process instead of
    once per world. For comparison, the current 766 defs plus the compiler already take 35 MB of heap in one process.

### The two blockers to fix first (engine, before any bulk)

1. **Shared library.**
   - `GodMode` stops copying `CORE_KIT` into every world.
   - The model resolves `eden/*` refs through a process-wide, read-only, content-addressed library.
   - A def enters a world's store (and its history) the first time something is placed from it, pinned by hash.
   - "New core types appear in old worlds" keeps working, at zero cost per world.
2. **The viewer stops bundling the library.**
   - `animals.mesh.ts` and `humanoid/look.ts` import only the defs they need, or get them from the snapshot.
   - A size check on the `Shell` chunk fails the web build if a library JSON is bundled.

---

## (c) An autonomous, weeks-long pipeline, isolated from the main release

### Shape: its own package and registry, with a pinned contract

```
packages/catalog/                      # its own package (it could become its own repo later; same layout)
  items/<category>/<name>/
    src.mjs            # authoring source (vocabDef/presetDef/setDef/generator args) or source.glb + mesh.json
    item.json          # item/1 minus the build-filled fields (text, licence, heldOut words, review)
    baseline/*.webp    # approved renders (views, states, variants)
  contract.json        # catalog-contract/1: engine version range, generator ids, component kinds, slot kinds, actuators,
                       #   kit/2 primitive set, def schema version, tri/draw classes
  bin/catalog          # build | gate | publish | yank | compat | import-core | eval
registry/  (output, content-addressed, append-only; on R2 next to the assets)
  defs/<hash>.json   items/<id>/<major>/<rev>.json   media/<sha>.webp   runs/<run>.json
  index/<channel>/<seq>.json          # immutable index snapshots: [{ id, major, rev, status, line }]
  channels.json                       # { stable: <seq>, candidate: <seq> }; the only mutable file
```

- **One directory per item.** Two workers never touch the same file, so the shared JSON arrays, `FAMILIES`,
  `index.ts` imports and cross-family edits that tonight's lanes collided on go away.
- **The engine depends on the contract, not on the content.** The server loads `channels.json`, then the index it
  points to, then defs by hash on demand (polled with an ETag every few minutes, or pushed on publish). New items appear
  in every world **without an engine release or a merge to `root/world-engine`**. The engine repo keeps a frozen
  *seed* index, for tests and offline dev.
- **Contract tests run in both directions:**
  - the engine's CI loads the current `stable` index and places a sample of 200 items, so an engine change that breaks
    items is caught;
  - the catalogue's gates run against a pinned engine build, so an item never relies on unreleased engine behaviour.
- **When an item needs the engine to change**, it waits as `blocked:capability`, and a request goes to the engine
  trunk's inbox. Tonight's examples: a moving excavator arm, a `flee` behaviour, a `lie`/sleep verb, a nav "stand up
  onto free floor", and a second pivot per role.

### Gates (automatic, in order; an item reaches `candidate` only when all pass)

| gate | checks | exists today as |
|---|---|---|
| **G1 schema and lint** | `def/2` + `item/1` parse; category known; ranges and defaults; actions use declared state; slots fit the category; the licence is allowed; the contract knows every capability | `vocab.lintDef`, `build.mjs` |
| **G2 budgets** | tris per class, draws ≤ 4, materials ≤ 4, def bytes ≤ 16 KB, GLB ≤ 2 MB (or `lod1`), texture px; all measured, never typed | tri budget in `build.mjs` |
| **G3 physics and compile** | place at the default, at the min and max of every ranged param and at every variant: compiles; mesh bounds inside the box; origin on the floor; front is +z; nothing more than 2 cm below y = 0; not floating unless anchored float or hang; enterable things have walls, not solid blocks; **every slot and actuator has a standable approach point found by nav, and a body can stand up from every seat** | partly in `compile.ts` / nav tests |
| **G4 headless render** | real Chrome on a GPU (the lease; never swiftshader): 4 views + each variant and state, at fixed light and camera; perceptual diff (SSIM) against the approved baseline. Machine look checks: variants must differ from each other (tonight: "dumpster variants all green"); no view is >90% one colour; glass is not opaque black; the item is not a single solid block where it claims openings. The contact sheet goes to the review queue | `thumbs.mjs`, e2e close-ups (looked at by hand) |
| **G5 findability** | its title and two synonyms put it first; its held-out words put it in the top 3; **no existing item loses a first-hit word** (the whole standing eval runs) | G0 steps of the W1–W3 e2es |
| **G6 Soul use** | for every affordance, a fake-mind Soul in a generated mini-scenario: the capability is offered, the route is reachable, the action commits an engine edit, and the state changes in the viewer. Furnished items also get walk-in + sit. $0 model spend | vocab-w3 Souls 11/12, layers e2e |
| **G7 world regression** | nightly, not per item: a "kitchen sink" world with a random 500 of the candidates, the 30 shared scenarios, and the perf probe within the (b) budgets | `scenarios.mjs`, `perf-probe.mjs` |

Each gate writes its numbers into `item.tests.gates`, so a regression shows up as a number that moved.

### Channels, publishing, rollback, provenance

- **Publish without merges.**
  - A worker's run writes immutable artefacts and a new `index/candidate/<seq>.json`.
  - Promotion to `stable` moves the `channels.json` pointer:
    - **automatically** for low-risk classes (object, furniture, vegetation, component) after 48 h as a candidate with
      no flags and G7 green;
    - **after Gene's or the PM's "ok"** for buildings, vehicles, living things, GLB imports, a new category, and any
      first item of a new kind of interaction.
  - New worlds and gods see `stable`; candidate items are visible to worlds that opt in (`--channel candidate`, used by
    the dev worlds) and to the review queue.
- **Rollback.** Index snapshots are immutable, so a rollback repoints `stable` to the previous `<seq>`. It takes one
  write and takes effect on the next poll.
- **Yank.** A yanked item disappears from search and new placement. **Worlds that placed it keep it**, because they pin
  the hash and blobs are never deleted while any world references them (refcounted GC across worlds). For a licence
  takedown there is a stronger `block`: a tombstone list the viewer honours by drawing the item as a neutral placeholder
  box with the same physics, so no world breaks.
- **Provenance.**
  - Every artefact has a `run` record: worker or lane, the engine contract, source hashes, gate reports and timestamps.
  - All runs are kept in an append-only `ledger.jsonl` in the registry.
  - An item's parents (preset of, set of, scan of) are hashes.
  - Licence is a gate, not a note. `CC0`/`CC-BY` sources must carry a source URL; `Eden-internal` items stay in their
    pack namespace and are not offered to other owners' worlds until Gene decides otherwise (Q2).

### Running it for weeks

- **The work queue** comes from three sources:
  1. the taxonomy's `want` lists;
  2. zero-result `find` queries from real gods, grouped weekly;
  3. Gene's asks.
- **A worker session** takes a batch of about 20 items in one category, authors them, runs G1–G6, publishes to
  candidate, and writes its run report. Workers run in parallel on different categories with no shared files.
- **A nightly session** runs G7, refreshes the play stats (d), promotes eligible items and drafts Gene's review queue.
- Workers are Claude sessions on the subscription, never per-call API pipelines. The cost is lane hours (see Costs).
- **Stop rules.**
  - A category stops receiving new items once it has 3× the items gods actually place there, until its play stats
    justify more. Breadth beats depth.
  - Any gate failure rate above 30% in a batch pauses that worker and files a note. A rising failure rate usually means
    a missing engine capability, not more retries.

---

## (d) Playability: does an item make worlds more fun?

A catalogue of 10k things that nobody uses makes worlds worse: searching gets noisier and choosing gets harder. Each
item earns its place through four signals.

1. **God usage** (cheap, from the edit history):
   - placements, worlds, and **kept rate**: still there 24 h later, as opposed to removed or undone within 10 minutes;
   - `find → place` conversion;
   - `recommend` accept rate.
   A low kept rate means the item is ugly, mis-sized or misnamed.
2. **Soul usage** (from Soul events; no extra model spend):
   - capabilities offered versus taken (sit, open, switch, pick-up, buy);
   - dwell time within 5 m;
   - the item's name or category words in Soul speech and memories;
   - conversations started near it;
   - return visits.
   The useful number is **Soul actions per placed instance per Soul-hour**. Decor will be low, which is fine; the
   comparison is within a category.
3. **Scenario tests** (vignettes): about 30 small playable scenes run on fake minds in G6/G7 for mechanics, e.g.
   - a café morning;
   - a rainy bus stop;
   - a market Saturday;
   - a fire on the beach;
   - a broken-down van;
   - a school day;
   - a night at the theatre.
   Each one asserts that Souls *can* do the scene's verbs with the scene's items. Running vignettes on **real minds**, to
   see what Souls *choose*, is the strongest signal and the only one that costs model time. It needs Gene's go and a
   measured, economical runner (the Soul-runner cost lesson). Proposed: off by default; at most one vignette per week
   per category; reported with its cost.
4. **Gene's review queue.** A private page (an Artifact or `/catalog/review` on the dev site) with one card per item:
   - the 4 views, its states, the stats and the gate numbers;
   - buttons **ok / fix / reject** plus a note.
   It shows every item in a new category or a new kind of interaction, every item that lost a first-hit word or
   failed the look checks, and a **5% random sample** of everything else. Target: 10 minutes a day. Verdicts go into
   `item.review`; "fix" sends the item back to the worker queue with the note. Rejected items stay as drafts, which
   teaches the workers what to avoid.

**The play score** combines the kept rate, conversion, Soul uses per instance-hour (within its category) and Gene's
verdict. It does three things:
- it is the ranking prior in `find` and on T1 category pages;
- it chooses T0's 3 exemplars per category;
- it flags items below the 10th percentile after 30 days of real use for deprecation.
Items with too little data are left alone, so the score never punishes something new.

---

## Phased plan

| phase | when | work | done when |
|---|---|---|---|
| **P0: contract** | 1–2 days | `item/1` + `def/2` schemas; `def1to2`; `catalog import-core` (766 items); the two blockers (shared library, viewer not bundling the library); T0 taxonomy with exemplars; the `core/* → eden/*` alias | the 30 shared scenarios green; no world's stored defs change; the `Shell` chunk loses the library; a world with no new placements stores 0 library defs |
| **P1: gates and registry** | week 1 | `packages/catalog` layout; G1–G5 automated, with baselines rendered for the 766; registry + channels on the box (R2 when Gene approves); the server loads from the registry; the review queue page; zero-result logging | a new item goes from `src.mjs` to `stable` with no edit outside its own directory, and a yank and a rollback are rehearsed |
| **P2: autonomy** | weeks 2–3 | G6 Soul-use generator; G7 nightly; play-stats collector; workers by category; engine requests: GLB instancing, `lod1` rule, KTX2 | ~3,000 stable items; G4 catches the defect classes from tonight's lanes on seeded bad items; perf budgets hold on the kitchen-sink world |
| **P3: 10k** | weeks 4–6 | breadth by demand; embeddings only if held-out recall@3 < 90%; first deprecations by play score; vignette runs if Gene agrees | 10k stable; T0 ≤ 6k tokens; `find` p95 < 50 ms; kitchen sink within budgets |

## Costs (estimates; measured inputs where we have them)

- **Authoring.** Tonight's pace was roughly 100–200 kit/preset types per lane-hour and about 25 furnished buildings per
  lane-hour, *before* gates. Gates and fixes about double that time, so 10k items is on the order of 100–150 lane-hours
  over 5–6 weeks: about 4 parallel workers for a few hours a day. That is subscription time, not API spend.
- **Rendering for G4.**
  - About 5 s of GPU per item (4 views + variants), so ~14 h for 10k, plus re-renders after engine changes.
  - It needs a real GPU: the laptop with the lease (which competes with prod on the laptop's ports and with other
    lanes) or a small cloud GPU box at about $0.5–1/h on demand (Q9). eden2 has no GPU, and swiftshader is not allowed.
- **Storage and CDN (R2).**
  - Assets: ~1–3 GB if about 20% of items are GLBs; thumbnails ~0.6 GB.
  - At about $0.015/GB-month with no egress fees, that is **under $1/month**. Requests cost cents.
- **Server.** One shared library (~100 MB heap) instead of per-world copies, which is a net saving from the first
  world on.
- **Soul vignettes on real minds.** $0 unless Gene opts in (Q5).

## Open questions for Gene

1. **Who publishes?** Is the catalogue core-only (agents + PM + you), or can a world owner's custom item be promoted into
   `eden/*` later (with review)?
2. **Licence policy.** Is the public catalogue CC0-only? Do LM and Mars art stay `Eden-internal` in their own namespaces,
   unavailable to other owners' worlds?
3. **Auto-promotion.** Is "48 h as a candidate, then stable, for low-risk classes" acceptable, with your queue seeing
   all new categories and kinds of interaction and a 5% sample of the rest? Or do you want to see more?
4. **Generated meshes.** Should text-to-3D or scanned GLBs enter the pipeline, or should the bulk stay kit-only? Kit-only
   keeps 0 asset bytes and the Eden look; GLBs bring realism at a payload cost.
5. **Real-mind vignettes.** Is there any budget for watching what Souls choose? (Default: none, until a measured,
   economical runner exists.)
6. **R2 and an assets domain.** Do we go ahead with a Cloudflare R2 bucket and a subdomain (account and DNS steps are
   yours, or the internet session's)?
7. **Text outside the hash.** Do you approve moving names, synonyms and descriptions out of the world-pinned def, so word
   fixes reach every world without forking defs?
8. **Old worlds.** Should old worlds keep receiving new catalogue items automatically (they do today), or only when the
   owner opts in?
9. **Where G4 renders.** Should it run on the laptop with the Chrome lease (free, but it competes with prod ports and
   other lanes), or on an on-demand cloud GPU box (~$0.5–1/h)?
10. **LAYERS defaults** (owner, hours, prices) stay optional and hidden, per brief item 4. Should they be dropped from the
    item schema entirely until economy is designed, or kept as an inert field?

## Gene's answers (2026-10-11 ~20:10 UTC): binding

1. **Who publishes:** core-only for now. Later, probably a CI where world owners and gods create their own objects;
   whether custom items get promoted to core is undecided (they may be very world-specific). Build the structured registry
   with that in mind.
2. **Licences:** permissive with our own assets.
   - Gene must stay free to use restricted third-party assets when he chooses.
   - Every item records its licence and source.
   - The registry enforces only redistribution limits, for example a restricted asset is never offered to other owners'
     worlds or exported.
   - Nothing blocks Gene's own use.
3. **Size and retrieval:** pre-anticipate many kinds of objects, but don't let low-use items clog memory, context or disk.
   - **Hot/cold tiers:** a hot set loaded and in agent context; cold storage promoted on demand.
   - **Retrieval:** go straight to embedding retrieval so agents never need the whole catalogue in context.
4. **Generated meshes:**
   - No text-to-3D in the central pipeline.
   - Do plan agent-uploaded GLBs, onboarded through the gates, so agents can use their own txt2glb tools.
   - Worlds without "the Eden look" are fine, but enforce hard budgets (triangles, bytes, draws) with automatic
     decimation or rejection, so no upload makes a world unplayable for most Souls.
5. **Real-mind vignettes:** no budget; playability uses scripted Souls (the question was about paying for model-driven
   Souls to watch).
6. **Delivery:** go straight to a scalable CDN in Eden's infra. Account and DNS steps belong to Gene / the internet session.
7. **Text outside the hash:** yes. Hierarchy and inheritance are welcome wherever they let things branch efficiently.
8. **Core vs world catalogues:** punt. For now core is available to everyone. First solve the very-large-catalogue context
   problem; it pays off under any later multi-level design. **Roadmap:** decide core vs per-world vs hierarchy later.
9. **G4 renders:** a few dollars of GPU is fine. G4 is a continuous gate, not a one-time event: every new or changed item
   is rendered and checked.
10. **LAYERS fields:** keep them as inert fields, clearly marked inert, so coding agents don't treat them as live.

### Follow-ups (Gene, 2026-10-11 ~20:20 UTC)
- **Q2, licences:** our own assets are **CC0**. Restricted third-party assets still get recorded (licence and source) and
  are kept from redistribution.
- **Q9, G4:** spending on **Modal** GPUs to catch up the initial renders is approved. G4 then runs as a continuous gate.
- **Delivery (raised by Gene):** move blobs to fast CDN storage with real caching. The first measurement: Mars's 67 MB
  `/browser/campus.glb` comes from the laptop through the tunnel at ~3.9 MB/s (about 18 s) with no Cache-Control header.

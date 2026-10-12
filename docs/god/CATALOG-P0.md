# CATALOG P0: what exists and how to use it

Lane CATRUN, 2026-10-12. Design: `docs/god/CATALOG-PROGRAM.md` (Gene's answers there are binding). Lane report:
`<team>/lanes/catrun.md`.

## 1. Engine: one shared core library
- `packages/world-compiler/src/library.ts`: `coreLibrary()` holds the 768 core defs once per process. Its version is
  `core@<hash of def hashes>`.
- `WorldModel.library` sits behind the world's own `defs`. The world's stored hash always wins.
- `compile.plan` adopts a library def into the world's store, pinned by hash, the first time a batch uses it. This
  covers its `extends` chain and any def a param names.
- `GodMode` no longer copies the kit into worlds and no longer commits on load.
- `eden/<x>@v`, `lm/<x>@v` and `mars/<x>@v` are aliases of `core/<x>@v`, `core/lm-<x>@v` and `core/mars-<x>@v`.
- To prove an old world is unchanged, run `node tools/catalog/old-world-check.mjs <COPY of sim.db>`.

## 2. packages/catalog
- `schema.ts`: `def/2` and `item/1`.
  - Words live outside the hash.
  - LAYERS data is kept only as `layersInert` (INERT, not live).
- `def1to2.ts`: the upgrader. `def2to1` gives the engine view. All 768 core defs round-trip exactly.
- `registry.ts`:
  - Every file is content-addressed and written once.
  - `channels.json` (stable/candidate) is the only file that changes.
  - Commands: publish, promote, rollback, yank. A yanked item still resolves by its pinned hash.
  - Redistribution limit: restricted items are never offered to other owners' worlds and never exported.
- `contract.json` is the engine contract. Regenerate it with `catalog contract --write`; a test fails on drift.
- `gates.ts` runs G1 (schema/lint/capabilities/licence/words), G2 (measured budgets) and G3 (placement sweep,
  floor/float, enterable-not-solid, approach points).
- `tiers.ts`:
  - The hot set comes from use (genesis templates now; play stats in P2) plus 3 redistributable exemplars per category.
  - T0 is the context page: about 1.5k tokens for 768 items.
  - `TieredLibrary` promotes cold defs from the registry on first use.
- `embed.ts`:
  - Pluggable retrieval: `lsa-1` (in-process, no download), BM25 and RRF fusion.
  - `VectorIndex` accepts any sentence embedder.

CLI: `node packages/catalog/bin/catalog.mjs import-core --registry .lane/registry` (768 items, about 3 s), then `gate`,
`channels`, `promote`, `rollback`, `yank`, `resolve`, `tiers`, `find`.

## 3. Retrieval: measured, and the decision it needs
`tools/catalog/retrieval-eval.mjs [--nl 1]` runs 94 paraphrase intents (`packages/catalog/eval/intents.json`). Recall@3:

| retriever | recall@3 |
|---|---|
| server `searchDefs` (today) | 0.55 |
| BM25 over item text | **0.79** |
| lsa-1 | 0.53 |
| BM25 + lsa-1 | 0.65 |
| macOS NLEmbedding | 0.26 |

Embeddings trained on the corpus and the OS's built-in ones do not beat lexical search, so `find` defaults to lexical.
A pretrained sentence model needs Gene's OK to add a dependency and download the model, for example
all-MiniLM-L6-v2 int8 via transformers.js: about 23 MB, 384-d, in-process. Plug it in through `VectorIndex` and keep
it only if it lifts recall@3 to 0.9 or more.

## 4. G4 (render gate)
`tools/catalog/g4/g4-render.mjs`:
- **Renderer.** Real GPU Chrome only; the run aborts on SwiftShader.
- **Light and clock.** Fixed light; the entity layer's clock is frozen.
- **Placement.** Spots are deterministic, and other items are hidden while one is shot.
- **Shots.** The default view, up to 3 enum variants and each actuator's "on" state, each from 4 views.
- **Checks:**
  - blank: the object covers less than 0.3% of the view;
  - dark;
  - a variant identical to the default;
  - a state that changes nothing;
  - SSIM against the approved baseline, with a self-noise floor (0.7 for things that move).

It writes `report.json` and `sheet.html`.

Measured on the laptop (M3 Max, Metal):
- 20 items, 216 renders, about 30 s.
- Repeat runs are identical for kit items. Wandering creatures stay noisy at a mark of 0.7.
- It catches that the taxi variant looks like the sedan (diff 1.96).

To run it on Modal (approved spend; the run here was not executed by the lane):
```
tools/catalog/g4/bundle.sh /tmp/g4-bundle.tar.gz
modal run tools/catalog/g4/g4_modal.py --bundle /tmp/g4-bundle.tar.gz --sample 20
```
The container's Chrome must report an NVIDIA renderer. If it falls back to SwiftShader the script exits 3: try the
other ANGLE flags in `g4-render.mjs` (`--use-angle=gl-egl`).

# Archived code

Code that was removed from the tree on purpose. It is still in git history, under a local tag, so you can bring it back.

## The catalogue programme (archived 2026-10-16)

**Why.** Gene, 2026-10-16: "The catalogue has been abandoned. ... archive the catalog somehow (like maybe just in git
history but otherwise delete it?)". No live world used it. A read-only check of eden2's `/worlds` on 2026-10-16 found no
registry fields in worlds.json and no registry or catalogue files in any world directory. It also found no
`CATALOG_*` setting in the launcher config or its processes. Every world uses the core kit.

**Tag.** `archive/catalogue-20261016` is `main` at `1080cfa9`, the last commit that still had the catalogue. The tag is
local to Gene's laptop checkout and has not been pushed.

**What was removed.**
- `packages/catalog` (`@sim/catalog`): the creator registry: items, contract, channels (stable/candidate), gates and
  licence tiers, review queue, BM25 and embedding retrieval, T0 summary, evals.
- `tools/catalog`: the G4 render pipeline, P1 proofs, review queue, retrieval evals and probes, release-registry prep, embeddings.
- `docs/god/CATALOG-PROGRAM.md`, `CATALOG-P0.md`, `CATALOG-P1.md`, `CATALOG-G4.md`.
- The server wiring in `apps/server/src/god`:
  - `registry-catalog.ts` and its test are gone.
  - In `god.ts`, the `RegistryCatalog` use and the `exportBlockedHashes` snapshot field are gone.
  - In `assets.ts` and `catalog.ts`, the registry branches of `/v1/god/defs`, `/v1/god/defs/<ref>` (its `catalogue`
    field), `/v1/god/catalog`, `/catalog/taxonomy` and `/recommend` are gone, along with the `/v1/god/catalog/t0` route.
- The launcher's `CATALOG_REGISTRY_DIR` / `CATALOG_CHANNEL` / `CATALOG_GENE_OWNER_ID` pass-through in
  `tools/world-launcher/children.mjs`. Its tests `creator-registry.test.mjs` and `children-catalog.test.mjs` were also removed.
- The `@sim/catalog` dependency (`apps/server/package.json`, `pnpm-lock.yaml`) and the catalog entry in
  `tools/test-harness/package-suite.sh`.

**What stays.** Several pieces stay because every world uses them:
- The core kit in `packages/world-compiler/src/core-kit`, which Godmode's `find` and `place` use in every world, and its tests.
- The shared library (`library.ts`, including the `eden/<x>@v` → `core/<x>@v` alias).
- The core search (`searchDefs` in `assets.ts`), the VOCAB-MECH manifest, taxonomy and recommend over the core library
  (`apps/server/src/god/catalog.ts`; despite the file name it is not the registry).
- Thumbnails at `/thumbs/<hash>.png` and the content-addressed blob layout.

Some comments elsewhere still cite "CATALOG-PROGRAM" for that blob layout (`assets/<sha[0:2]>/<sha>.<ext>`). That
document now exists only under the tag.

**How to recover it.**
```
git checkout archive/catalogue-20261016 -- packages/catalog tools/catalog \
  docs/god/CATALOG-PROGRAM.md docs/god/CATALOG-P0.md docs/god/CATALOG-P1.md docs/god/CATALOG-G4.md \
  apps/server/src/god/registry-catalog.ts apps/server/src/god/registry-catalog.test.ts \
  tools/world-launcher/creator-registry.test.mjs tools/world-launcher/children-catalog.test.mjs
```
Then put back the wiring by hand. It is small: diff `apps/server/src/god/{god,assets,catalog}.ts`,
`tools/world-launcher/children.mjs`, `apps/server/package.json` and `tools/test-harness/package-suite.sh` against the tag.
After that, run `pnpm install`. To read a removed file without restoring it, run `git show archive/catalogue-20261016:<path>`.

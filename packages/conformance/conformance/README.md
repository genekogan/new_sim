# EF4 library conformance

`@sim/conformance` (was the last piece of `@sim/catalog`; the catalogue registry is archived, see docs/ARCHIVED.md). What it
guards: a change to a core def revision, a generator, the compiler, furnishing or gallery geometry that makes any core def
fail to bake, place, furnish or stay inside its triangle/draw/material budget at a parameter endpoint, enum value, scale
endpoint or seeded joint sample. Known failures are pinned by exact def hash, so a changed revision needs a reviewed record.

The gate discovers `src/conformance.test.ts` automatically. It checks every library revision (777 at integration `3baa4c51`), defaults, every numeric min/max, every enum and boolean value, both scale endpoints, and two seeded joint samples per definition. Each point gets an isolated world with a valid water fixture when needed. It bakes and attempts placement, runs the real furnishing planner and applies its operations for room-bearing buildings, and bundles every gallery mesh registration to build geometry and check finite vertices plus triangle/draw/material budgets.

Full sweep, Node 22.20, without any service or network:

```sh
env -u NODE_USE_SYSTEM_CA nice -n 10 ~/.nvm/versions/node/v22.20.0/bin/node packages/conformance/bin/conformance.mjs --k 32 --out /tmp/ef4-full.json
```

Use `--shard 1/4` through `--shard 4/4` sequentially, or `--filter lighthouse`, for bounded work on the shared laptop. `--seed NAME` is reproducible independently of sharding. Violations return exit 1; `--report-only` explicitly permits a report despite violations. No output artifact can turn a failing full sweep into a conformance certificate.

`known-20261015.json` records the integration-head defects as exact def hash / field / stage / code / detail tuples, grouped only to avoid repetition. It also records full-sweep counts and explicit rendering gaps. The small-K regression gate accepts only those exact documented tuples; a new definition revision or failure detail requires review. The full run found 9,867 violations across 392 revisions, including lighthouse entrance failures at minimum width/depth. Existing published definitions were not narrowed or revised in this lane, which avoids changing old worlds. Generator/catalog owners can use the named fields and raw failure detail to repair ranges in new revisions.

This local lane does not launch a browser (viewer boundary). Geometry checks are not GPU rendering evidence. The 416 recorded gaps cover semantic/prefab objects, async GLB assets, browser text, expanded children/shared surfaces, and terrain drawn in shared ground. The lead must run the actual gallery/browser qualification on 127.0.0.1:5366, including sampled parameter/scale variants and async asset completion, before claiming every advertised point renders. `samplePoints()` provides the exact labelled variants; `--local` on the existing gallery command qualifies defaults only. The report keeps these gaps explicit and the gate fails if their list changes.


M3 integration supplement: `integration-3baa4c51.json` records 49 additional exact findings across 12 definitions already present at the supplied integration head. B1 (`38b90658`) added six boolean building parameters. Their endpoint samples exercise existing over-budget default geometry; consuming new random booleans also shifts later seeded joint samples. The K=2 integration sweep checks 10,334 points across 777 definitions and reports 2,155 findings in total, with the same 416 explicit rendering gaps. Of the 49 additional findings, 42 exceed the gallery triangle budget, five fail architecture checks, and two have sealed entrances. These failures are documented, not fixed. The record pins def hashes, field, stage, code and detail and accepts no other signatures. The original K=32 record remains unchanged. Runtime sources for generators, compiler, gallery geometry, catalog measurement and furnishing match `3baa4c51` exactly; no budgets, samples or rendering-gap checks were relaxed. This supplement is K=2 evidence and does not claim full-sweep or GPU qualification.

Trunk release 3 supplement: `trunk-r3-20261016.json` re-pins the documented tuples of six animals whose revision changed with lane/bugs E2 #3 (flee) and records the excavator's two documented draw overruns one draw higher after E2 #4 (digging arm). Same K=2 sweep, same 416 rendering gaps; nothing relaxed.

Later supplements (`trunk-r32-20261017.json`, `w2-effects-20261019.json`, `z2-catalogue-20261020.json`, `bsgen-20261021.json`, `seatdef-20261022.json`) each carry their own note. `bsgen-20261021.json` re-pins, hash for hash, the 71 documented tuples of three library revisions lane BSGEN changed on 2026-10-21 (apartment block `plan.landing`, office block and hospital contents); no detail differs. `seatdef-20261022.json` re-pins the 15 documented tuples of six revisions lane SEATDEF changed on 2026-10-22 (seat heights: papasan@3, five cab vehicles); no detail differs.

`office-desk-20261028.json` pins the new immutable chair-free `core-office-desk@2` revision’s single existing construction-view draw overrun (`9 > 4`) after a narrow v1+v2 K=2 sweep (34/34 baked, placed and rendered). The old v1 stays byte-identical; no code/detail, budget, sample or rendering gap is relaxed. Separate native activity/browser proof remains required.

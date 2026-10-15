# EF4 library conformance

The gate discovers `src/conformance.test.ts` automatically. It checks every library revision (777 at integration `3baa4c51`), defaults, every numeric min/max, every enum and boolean value, both scale endpoints, and two seeded joint samples per definition. Each point gets an isolated world with a valid water fixture when needed. It bakes and attempts placement, runs the real furnishing planner and applies its operations for room-bearing buildings, and bundles every gallery mesh registration to build geometry and check finite vertices plus triangle/draw/material budgets.

Full sweep, Node 22.20, without any service or network:

```sh
env -u NODE_USE_SYSTEM_CA nice -n 10 ~/.nvm/versions/node/v22.20.0/bin/node packages/catalog/bin/conformance.mjs --k 32 --out /tmp/ef4-full.json
```

Use `--shard 1/4` through `--shard 4/4` sequentially, or `--filter lighthouse`, for bounded work on the shared laptop. `--seed NAME` is reproducible independently of sharding. Violations return exit 1; `--report-only` explicitly permits a report despite violations. No output artifact can turn a failing full sweep into a conformance certificate.

`known-20261015.json` records the integration-head defects as exact def hash / field / stage / code / detail tuples, grouped only to avoid repetition. It also records full-sweep counts and explicit rendering gaps. The small-K regression gate accepts only those exact documented tuples; a new definition revision or failure detail requires review. The full run found 9,867 violations across 392 revisions, including lighthouse entrance failures at minimum width/depth. Existing published definitions were not narrowed or revised in this lane, which avoids changing old worlds. Generator/catalog owners can use the named fields and raw failure detail to repair ranges in new revisions.

This local lane does not launch a browser (viewer boundary). Geometry checks are not GPU rendering evidence. The 416 recorded gaps cover semantic/prefab objects, async GLB assets, browser text, expanded children/shared surfaces, and terrain drawn in shared ground. The lead must run the actual gallery/browser qualification on 127.0.0.1:5366, including sampled parameter/scale variants and async asset completion, before claiming every advertised point renders. `samplePoints()` provides the exact labelled variants; `--local` on the existing gallery command qualifies defaults only. The report keeps these gaps explicit and the gate fails if their list changes.


M3 integration supplement: `integration-3baa4c51.json` records 49 additional exact findings across 12 definitions already present at the supplied integration head. B1 (`38b90658`) added six boolean building parameters. Their endpoint samples exercise existing over-budget default geometry; consuming new random booleans also shifts later seeded joint samples. The K=2 integration sweep checks 10,334 points across 777 definitions and reports 2,155 findings in total, with the same 416 explicit rendering gaps. Of the 49 additional findings, 42 exceed the gallery triangle budget, five fail architecture checks, and two have sealed entrances. These failures are documented, not fixed. The record pins def hashes, field, stage, code and detail and accepts no other signatures. The original K=32 record remains unchanged. Runtime sources for generators, compiler, gallery geometry, catalog measurement and furnishing match `3baa4c51` exactly; no budgets, samples or rendering-gap checks were relaxed. This supplement is K=2 evidence and does not claim full-sweep or GPU qualification.

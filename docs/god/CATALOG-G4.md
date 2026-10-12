# G4 catalogue coverage

The full catchup renders each resolvable core ref or records why it remains
unqualified. It never approves baselines. Passing machine checks is not visual
review or proof of production behaviour.

```sh
node --test tools/catalog/g4/*.test.mjs
node tools/catalog/g4/g4-batch.mjs --plan-only --out .lane/g4/plan
tools/catalog/g4/bundle.sh /tmp/g4-bundle.tar.gz
modal run tools/catalog/g4/g4_modal.py --bundle /tmp/g4-bundle.tar.gz --all --out .lane/g4/modal-full
```

`g4-batch.mjs` uses fresh fake-mind worlds on port 6102, sequential batches of
at most 72 jobs (hard grid capacity 81). The render-only fixtures use the existing
`ENTITY_BRIDGE=0` switch to avoid rebuilding Soul navigation for thousands of
alternatives; compiler admission and visual snapshots remain active. G4 does not
qualify Soul physics/navigation. All enum alternatives are tested
individually, plus default and actuator states. This is not the Cartesian
product of parameter settings. Path/area placement uses the API's example
shape, translated into world coordinates. Prefab children and instance matrices
are isolated when measuring object coverage. Missing draws, missing assets and
asset timeouts fail. Linux Chrome must report NVIDIA; software rendering aborts.

`plan.json` lists every requested ref and batch. `report.json` persists after
each batch and records missing, duplicate, unexpected, rendered, failing and
unqualified counts. `sheet.html` links each actual image. Each rendered item
includes its exact engine `defHash`, and each view its coverage and drawable
status. Exit 2 means qualification failed, including explicit gaps; exit 3 means
infrastructure failed. Item failures do not prevent the remaining batches from
being measured. Infrastructure failures stop the run and leave missing refs
visible. The Modal wrapper preserves these exit codes and evidence.

Body rigs and invisible semantic items need dedicated fixtures. Terrain
mutations drawn through shared ground cannot be qualified by hiding an entity:
they remain explicit gaps. Baseline approval, SSIM comparisons with reviewed
baselines, opaque-glass analysis, claimed-opening visual checks, pairwise variant
comparison and complete actuator semantics remain distinct qualification work.
The current renderer only compares each alternative against the default and
warns when actuator state has no visible effect. Sound/behavior enums are
explicit `unqualifiedClaims`; a static image cannot qualify their semantics.
They are neither visual-difference passes nor proven content defects.

Current comparisons use `fixed-backdrop/1`: after each frame update, terrain,
water, horizon and external scene geometry are hidden and the background/fog
are held constant for the capture. Item geometry, materials and lights are
retained; all visibility and background state are restored afterward. This is
an analytical fixture, not a production appearance change. Earlier world-
background baselines are rejected rather than silently mixed with this method.

## Measured catchup and its holds (2026-10-12)

The original full catchup remains pinned to source **b3525c85** and
`core@33f2559934df9a4d`: **768/768 refs accounted, 750 captured, 656 machine
passes, 94 failures, 18 explicit unqualified refs**, 43 NVIDIA L4 Vulkan batches,
11,604 PNGs, exit 2, 2,667 s including setup/return. No missing, duplicate or
unexpected refs. The file audit verifies every captured engine hash, four-view
set, PNG dimensions and file hash. Evidence:
`<worktrees>/cx-g4/.lane/g4/modal-full-visual/g4/` — `report.json`,
`plan.json`, `audit.json`, `failure-summary.json`, `review-holds.json`, `sheet.html`.

**These are unapproved historical machine scores.** The original comparison
included terrain pixels and passed unchanged supermarket `style=barn` at 4.46,
despite an earlier sample failing it at 1.89. All 290 refs with enum-difference
claims remain held pending capture under the repaired method. No full rerun was
performed after discovering this; the original report was not rewritten.

Failure classes overlap: 73 refs triggered same-variant alerts, 17 blank-crop
alerts, 12 drawable timeouts and one missing-drawable alert. They are not 94
proven content defects. The old run has 259 sound/behavior claims across 37
items that require nonvisual qualification. Five timed-out Mars stools/cushions
are visibly present in their captures: loaded GLB instances can remove the
`asset` child the readiness heuristic expects. This remains a harness hold,
not a Mars content edit. Six Kin captures remain blank; reedbed lacks an
isolatable drawable. Body/semantic/shared-terrain fixtures are still required.

The repaired comparison has a bounded regression proof, not another full run:

| context | unchanged supermarket barn (must fail) | blue dumpster (must pass) | captures |
|---|---:|---:|---:|
| sparse | 0.15 | 4.43 | 32 |
| 48 extra boxes | 0.15 | 4.45 | 32 |

Both used real NVIDIA L4 Vulkan. Sound wind and bird perch were explicitly
unqualified; both commands retained exit 2. Evidence:
`.lane/g4/modal-fixed-sparse/g4`, `.lane/g4/modal-fixed-busy-2/g4`, and
`.lane/g4/regression-proof.json` in the same worktree. The initial busy fixture
was refused for an overlapping extra box and is preserved separately.

Recheck the saved proof without GPU spend:

```sh
node tools/catalog/g4/regression-check.mjs .lane/g4/modal-fixed-sparse/g4/report.json .lane/g4/modal-fixed-busy-2/g4/report.json
```

For future targeted diagnostics, Modal accepts `--variants <labels>` and
`--busy 48`. These are deliberately partial captures, reported as
`selection.targeted`; they must not be used as full item publication receipts.
The full catchup runner refuses automatic `--approve`. No baseline was approved
in this work, and no DPR-2 stranger or production walkthrough was performed.

For unpublished candidates, place a reviewed JSON array of `def/1` inputs inside
the worktree, and run:

```sh
node tools/catalog/g4/g4-render.mjs --port 6102 --defs tools/catalog/g4/candidate.json --out .lane/g4/candidate
```

It defines candidates through the dev world's God API before selecting them.
For Modal, run `bundle.sh /tmp/g4-bundle.tar.gz <reviewed-candidate.json>` then
pass `--defs .lane/g4/candidate-defs.json`. The bundler validates the def-array
shape and adds it at this known path. Outside-tree paths are refused.
Full core catchup (`--all`) cannot be combined with candidate definitions.

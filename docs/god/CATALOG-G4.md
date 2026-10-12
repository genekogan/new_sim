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
at most 72 jobs (hard grid capacity 81). All enum alternatives are tested
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
warns when actuator state has no visible effect.

For unpublished candidates, place a reviewed JSON array of `def/1` inputs inside
the worktree, and run:

```sh
node tools/catalog/g4/g4-render.mjs --port 6102 --defs tools/catalog/g4/candidate.json --out .lane/g4/candidate
```

It defines candidates through the dev world's God API before selecting them.
For Modal, the reviewed candidate file must be included in the bundle, then
pass `--defs tools/catalog/g4/candidate.json`. Outside-tree paths are refused.
Full core catchup (`--all`) cannot be combined with candidate definitions.

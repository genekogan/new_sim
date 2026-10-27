# Unified overnight journey fixtures

These three draft batteries hold four owner requests each. **They are not frozen or runnable measurements yet.** The coordinator must supply the same reviewed physical patched genesis in both arms, verify every setup and target against that model, pin the actual Codex CLI model, and replace `freeze.status` with `ready`. Do not change budgets after measuring baseline.

Run from the frozen baseline source with the harness commits applied:

```
node tools/playtest/playtest.mjs run tools/playtest/scenarios/unified/mars.json --server-root /absolute/baseline-worktree --out /absolute/control-mars-r1
```

Repeat serially for eden, hamlet, then repeat2. Treatment uses exactly the frozen scenario files and physical geometry, with enriched meaning on the new implementation. No CLI default provider fallback; `providers.allowed=[codex]` and deterministic review are mandatory. No automatic model reviews.

`setup.steps` are explicit low-level CLI intentions executed before the owner's request. Every setup has a wall cap and physical start check. Setup failure writes `infrastructure-invalid.jsonl`; it is neither pass nor product miss. Body movements remain actual walks; no server teleport hooks. Duration includes four setup allowances, and request budgets start only after setup. Each next setup waits for the previous model turn to finish.

`expect.journey` binds `receipt.targetRefs` by exact entity path against the fresh-world snapshot, producing `fixture-bindings.json`. The oracle uses numeric regions, ordered phases, exact receipt capability or target IDs and observed posture/activity. It never matches descriptions, aliases or generated names as truth. Target bindings do not change frozen numeric regions. A missing stable path aborts before seat inference.

Record `oracles.jsonl`, `metrics.json.journeys`, setup/invalid receipts, the complete transcript and run `scenario.json` (with scenario hash and generated IDs). `journey-completion`, `journey-truthfulness` and `journey-efficiency` remain separate; unknown never passes. Observer `kinematics` reads current here through the Soul's own CLI, adding heading/seat to public body samples without exposing tokens. Floor y/level absent in the current served perception stays unknown and needs the separate floor oracle/render capture; do not fabricate it from a building label.

Blocked fixture work before freeze:
- Mars: common patched campus (fidelity/rotation82/field/water/gallery/Mimos mat), new actual `campus-swimming-pond` and bank, verified nearest-behind entrance. Existing water patch is a tank, not swim water.
- Eden: common three patches, verified lake bank setup, actual supported seat on west pier. Promenade benches are not a pier substitute.
- Hamlet: common small physical venue/seat and ambiguous second venue created before both arms. The god build-and-label scenario must independently validate its actual edited IDs and affordances. Baseline lacks about; do not treat that expected authoring gap as Soul onboarding failure. Four Soul requests below test the resulting fixed fixture; authoring remains a separate actual god-seat check.
- Pin model/version/effort and all static region positions after deterministic setup smoke. `null` model below deliberately does not claim a frozen model identity.

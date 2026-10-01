# Cold preparation Lab adapter — source snapshot

2026-10-01. Local candidate only; not tested in a browser, integrated, committed,
released or published. Worktree `code/codex-wt/preparation-ui`, branch
`codex/preparation-ui`, exact base
`2851791786aeb7c93f88dcb336d644d08fa26caf`.

Owned files:

- `viewer/app/lab/preparation.ts`
- `viewer/app/lab/preparation-hud.tsx`
- `viewer/e2e/preparation.spec.ts`
- this report

The two hypothetical presets use the existing preparation runtime with unchanged
objects: axis-aligned table at origin, and a 90-degree table at (4,3). Explicit
Start/Interrupt/Resume controls call the same `prepare_food` action. Completed
deposits and mixing stay authoritative on the same pot; the UI shows source bowl
fractions, pot fraction, phase and readiness. The existing spoon can be explicitly
returned to its original table slot using ordinary `put_item`, including after
interruption. No hidden activity executor or object mutation was added.

Scope is two full ingredient bowls into exactly two full servings, cold transfer
and mixing only. No heat/chopping, historical recipe, new rig or anatomy, active
reload restoration or implicit serving. Later existing food routines may consume
the conserved output. Reset replaces the scenario world.

Two browser definitions (one per orientation) require actual Play, fresh Reset and
Step, partial-deposit conservation, interruption retaining exact progress,
unchanged ingredient/pot poses and supports, same-object resume/completion, real
complete pot quantity 0.5 with both original bowls depleted, ordinary spoon
placement and claim release. Each also compares exact geometry/texture counts
across three resets; no thresholds or legacy assertions were changed. Captures
and detached state/resource artifacts are specified but have not been produced.

Source review/validation: `tsc --noEmit -p viewer/tsconfig.json` passed before the
final missing-entity readout guard/HUD optional-state fix. It was not rerun after
that small source change while the owner validation window is active. This config
checks adapter/HUD/core but excludes e2e, so browser-definition typecheck is still
required. `oxfmt` formatted the three source files; `git diff --check` passed.
No engine/browser tests, build, GPU or full suite was run, preserving the historical
owner's exclusive combined validation/performance window. No Git staging/commit.

Root owns shared wiring: import/render `PreparationHud` keyed by scenario epoch;
add `PREPARATION_SCENARIOS` to selectable/by-name presets (and ensure hook
`runScenario` sees them); expose detached `preparationReadout` through hook.
Readout returns undefined if any of these four scenario entities is absent, so
the global hook is safe outside this experience. Supported scenarios retain strict
same-ID quantities and state.
Root also owns global action registration/integration and full-gate validation.

No source changes are needed for broad orchestration. Runtime appearance and
actual interruption/completion/support/resource behavior remain unverified until
the focused browser checks and inspected captures run on the combined candidate.

## Root integration follow-up (unvalidated)

Copied final4-file snapshot by exactSHA into root meal-prep-mvp, originals intact.
Root wires selector/panel/hook/tour and adds explicit ordinary Takeemptybowl/
Takespoon/Serveprepareddish/Eatserving/Returnbowl controls. Same emptied source
bowl is reused, one full serving consumed and the second portion remains in the
same pot. Two Node and extended two browser cases author this actual output-use
path, including object support/ownership/cleanup. These follow-ups have not run
under the historical owner’s serialized gate; no TSc/visual/release acceptance
claim. Earlier helper TSc covered only its pre-guard source snapshot.


## Root focused validation 2026-10-01

36 preparation cases and combined preparation/meal/shared-food/source scan66/66 PASS,0skip. Viewer TSc and scoped lint PASS. Dedicated e2e TSc initially found an optional global-hook return intersecting the fixture contract; Omit replaces only that property for known named fixtures, no runtime assertion weakened; fixed TSc PASS. Actual Play2/2 PASS57.8s across origin/rotated(4,3): firstStep/partialdeposit/cancel/sameobjectresume/completion/bothordinaryservings/cleanup and three exactresource resets. All10captures personally inspected; same existing rig/ordinary item executor. Missing-worktree-browser launch failure retained separately; existing validated cache used, no product bypass. Source-only reviewer found no definite bounded-one-batch blocker. HUD quantity corrected after both servings are eaten; combined candidate gate/publication still required. Draft is not shipped.

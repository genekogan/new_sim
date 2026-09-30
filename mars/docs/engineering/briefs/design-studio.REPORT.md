# Design studio candidate — 2026-09-30

Branch `codex/design-studio`, fresh worktree/base `a6c98852e0a714999fb744b87d9d3a8271aedbb9`; existing worktrees preserved. Local Git only. Root's after-gathering gate/release remains independent and frozen.

## User-visible candidate

Fresh hypothetical independent design studio with nine differently named people, own fixture/item IDs, offset critique seating, east computer/work chair, west lunch table and wider/shallower ground room. Existing classroom/workstation/food/rest and purposeful/after-gathering coordinators execute everything. No activity logic copied, shared factory modified, new capability/imported engine asset introduced or historical claim made.

Exported `DesignStudioBindings` holds roles (two presenters, audience string array with four authored reviewers, worker and companion), typed `workBreak`, `session`, `rest`, `departure`, `followUpWork` and `followUpDiscussion`. `designStudioBindings()` returns fresh clones. `designStudioRoutineParams(session)` and `designStudioContinuationParams(session,routine)` only produce typed ordinary params bound to explicit action identities. `designStudioWorld()` starts no actions and `designStudioScene()` supplies its ground geometry.

Root owns shared Lab binding adapter/admission/HUD/hooks, renderer and optional separately attributed computer appearance. First studio arrangement excludes layout-moving UI. Engine reuses existing generic dimensions/capabilities; the catalog asset's actual dimensions/scale are not certified by this scene.

## Owned paths and validation status

- New `viewer/engine/scenarios/design-studio.ts`: scenario data/world/geometry and typed binding helpers only.
- New `viewer/engine/test/design-studio.test.ts`: full ordinary journey/concurrent continuing purposes, actual seated worker and changing pair floor, local direction/resume, occupied computer/foreign unfinished task, unavailable required display/refusal/remedy, reset isolation and timed deterministic replay.
- This PLAN and REPORT.

Source/tests authored under root's no-heavy-check hold. No tests, TypeScript, lint, browser/build/deploy/full gate process run. No shared APIs, assets, registry/version, pins or baselines changed. Queued focused commands from `viewer/` after slot grant:

```sh
node --test engine/test/design-studio.test.ts
npx --no-install tsc --noEmit -p .
npx --no-install tsc --noEmit -p cinematography/tsconfig.json
npx --no-install oxlint engine/scenarios/design-studio.ts engine/test/design-studio.test.ts
```

No green/release claim or runtime capture yet. Root owns integrated actual browser proof, full gate and release. No shared prerequisite was discovered during bounded authoring; geometry remains unverified until focused tests can run. No extra agents, downloads or network used.

Root expressly requested an UNVERIFIED source candidate commit during the full-gate hold for static wiring in its separate Lab worktree. Exactly these four owned paths were reviewed for secrets and whitespace before staging. This source commit does not certify geometry or replace the queued focused checks.

# W62 — gate foundations (2026-09-29)

Branch `codex/gate-foundations`, base `28683cb0d25ac04967f4790df668a28681657614`.
Managed worktree creation reported “Not a git repository” at chat cwd, so used CODEX's manual worktree recipe at `<mars-worktrees>/gate-foundations`.

## Changes

- Incorporated code from unmerged tooling commit `6ae7f3e`: parser startsWith checks, stale core-test imports, grouping comparators and correctly placed missing-half-extent fallback. Inspected `3010987` (historical reports only); did not replay unrelated report edits.
- Cleared all remaining lint mechanically in engine-view, lab, studio and one unused sequence index. Snapshot-before-mutation semantics are preserved with `Array.from`, and diagnostic string output is unchanged.
- **Historical file touched for renderer mechanics only:** `app/history/photographic-corrections.ts`, `solarRow2022` X/Y bindings `let` → `const`. No historical dimensions, content, coordinates, colours, or facts changed.
- `deploy/gate.mjs` now gates lint with `--max-warnings=0` and always runs simulation integration. When SIM_BASE is unset, it starts isolated local Wrangler with dynamic loopback HTTP/inspector ports, unique per-gate persistence, readiness checking and a server log. An explicit SIM_BASE continues to target the requested server.
- `deploy/gate-runtime.mjs` owns detached process groups, ensuring descendants are killed on step completion/failure, timeout, SIGINT/SIGTERM and gate exit. Startup exit, spawn failure, or readiness timeout fails the step. A closed process scope refuses new spawns after interruption. No dependencies added or installed.
- Node test report parser supports TAP/spec summaries and reports TODO separately from skip (the baseline has 11 TODOs).
- `.gitignore` now ignores `.pw-browsers` including the worktree symlink. Source-scan rules and pins untouched.

## Verification

Commands from this worktree's `viewer/` (main remains base above):

| Check | Result |
| --- | --- |
| `npm run lint` | zero findings |
| `npm run test:engine` | 433 total: **416 pass, 0 fail, 6 skip, 11 TODO**; 60.6 s |
| `npx tsc --noEmit -p .` | clean |
| `npm test` | **81 pass, 0 fail, 0 skip, 0 TODO** |
| `node --test deploy/gate-runtime.test.mjs` | 4 pass: TAP/spec TODO parsing, server readiness+shutdown, missing executable+readiness timeout, descendant process cleanup |
| `node deploy/group-2026-frames.mjs --check` | byte-identical committed outputs |
| `node deploy/determinism-probe.mjs` | completed, 10901 ticks; final hash `b746b0947e651c054506ccdb6568d5216a84c2d0f0304fda1b8261ba62e7f0c3`, take `0977ce205b90f3890dd6afb0` |
| `E2E_VITE_PORT=5491 E2E_RUN=codex-gate-foundations-1 npx playwright test -c e2e/playwright.config.ts lab-poses.spec.ts` | 1 pass |

Actual integration also exercised the new `startLocalSimulation` helper with `root=process.cwd()`, `outDir=.cloudflare/gate-runtime-check`, and its returned base passed as `SIM_BASE` to `node deploy/simulation-integration.mjs`. PASS: 16 registered engine tools, current legacy checks, auth/isolation, refusals, persistence, camera and plan flows; helper then stopped its server. Server log: `viewer/.cloudflare/gate-runtime-check/simulation-server.log`. This was a direct helper+integration check, **not a full release gate**. Lead owns the full gate after integration with other branches.

All active pinned assertions pass unchanged; the 11 existing TODO tests include known failing 2022 content assertions and remain documented as TODO. No baseline images or pins rewritten.

## Final no-op rebase check

After the initial green run and commit, `git rebase main` reported already up to date. The redundant full suite rerun overlapped two other workers' full suites and produced **415 pass / 1 fail / 6 skip / 11 TODO** (98.2 s). The sole non-TODO failure was `planning.test.ts:174`, `stress-30: exact planner keeps the pinned result; per-tick cost bounded; zero violations`: exact maximum tick **369.1 ms** exceeded the existing **250 ms** bound. Pinned outcomes and invariant assertions passed. No threshold was changed.

An isolated `node --test --test-name-pattern='stress-30: exact planner' engine/test/planning.test.ts` then passed: exact maximum **112.3 ms**, mean **0.58 ms**; corridor maximum **55.4 ms**, mean **0.47 ms**. Lead instructed no more overlapping full suites; full merge gate will be serialized. Final `npm run lint -- --max-warnings=0` and TypeScript check are clean.

## Captures inspected

`viewer/e2e/artifacts/poses/hold.png`: support crew hands grip upright rack frame, feet near ground, paused incomplete build status explicitly shown, zero violations.
`viewer/e2e/artifacts/poses/sit.png`: bent knees/seated pose on green chair, scene warm lighting, scripted conflict messages explicitly identified; no pose-layer accumulation evident.

Used the repository's existing Playwright contract from CODEX rather than scaffolding the generic e2e skill harness. Wrangler skill was read and installed CLI help checked before constructing local flags.

## Remaining / lead integration

- Update RELEASE_CHECKLIST and LAST_MILE LM-015/148/149/151 to reflect always-run integration and zero lint; lead owns those docs.
- Integration coverage of newly added tools/legacy routing is the controller worker's scope. The gate automatically executes the merged harness.
- 6 skips and 11 TODOs are baseline engine accounting, not fixed here. Report both honestly.
- No full gate, deploy, merge, push or remote changes performed by this worker.

Approximate work: 25 minutes / 16k tokens (estimate; platform per-agent accounting unavailable).

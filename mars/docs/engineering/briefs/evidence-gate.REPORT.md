# W62 — external gate evidence (LM-154)

Branch `codex/evidence-gate`, base `28683cb`. Code: `viewer/deploy/evidence-report.mjs`, new `evidence-gate.mjs` and `evidence-gate.test.mjs`.

The report consumes the latest gate JSON, or an explicit `--gate <report.json>`. Every executable outsideSuite citation now receives pass/fail/missing/stale/unverified, gate step/log/duration, and contributes to the row's proof count and PROVEN/PARTIAL/UNPROVEN status. Documentation and baseline-folder references are labelled references and never counted as passes.

Freshness requires the gate's exact current commit, a clean gate tree, and no subsequent viewer modifications (the local `.pw-browsers` symlink is excluded). A malformed/latest-red run never falls back to older green evidence. Aggregate e2e green does not prove a skipped/unexecuted cited spec: that spec must have passing lines in the gate log with no skip/fail lines. Unit proofs require the all-deploy-tests command and no skipped/TODO cases. `record-campus-take` is a proof only for an explicit `--check` gate command, not generation. Missing gate stages remain unproven honestly. Gate logs are constrained to `.cloudflare/gate` paths. Engine TODO count is now separate from skips.

Lightweight validation (heavy suites explicitly paused by lead to avoid CPU contention):
- `node --check viewer/deploy/evidence-report.mjs`: pass.
- `node --test deploy/evidence-gate.test.mjs`: 5 pass, covering status accounting, missing/stale/failing proofs, exact Playwright spec execution, take generation vs checking, latest-report selection, dirty/revision freshness, malformed JSON structure and log path boundaries.
- `npx oxlint deploy/evidence-report.mjs deploy/evidence-gate.mjs deploy/evidence-gate.test.mjs` from viewer: clean.
- `npx tsc --noEmit -p .`: clean.
- `npm test`: 82 pass / 0 fail / 0 skipped / 0 TODO (base predates gate-foundations' four helper tests).
- `git diff --check`: clean. No generated EVIDENCE.md/evidence.json written: the lead regenerates after a current clean complete gate. No engine tests, pins, content, schemas, captures, dependencies or releases changed.

Approximate effort 20 minutes / 9k tokens. Full report generation and full gate remain lead validation on integrated branch.

## LM-014 interpretation proposed to lead (approved)

One transport-facing registry in simulation composes engine operations plus the 20 live viewer controls, with explicit `target: engine|viewer`, schema, read-only metadata and one dispatcher. MCP and REST consume it; engine delegates stay engine controller calls, viewer delegates retain the existing model/apply path. This consolidates routing without pretending the two world models are unified. LM-202 remains out-of-scope and the literal claim that live commands are engine-world operations must be reclassified. This work is separate from the evidence commit.

# Astra technical takeover — first integration milestone

Base `28683cb`; lead branch `codex/studio-integration`. Main is unchanged until the clean integrated full gate passes. All commits are local with Co-Authored-By; no remote added or push attempted. Managed worktree creation failed because the chat cwd is not a repository; CODEX manual worktree recipe used.

## Baseline

`viewer/.cloudflare/gate/2026-09-29T00-33-59-072Z/report.json` on main: unit77pass; engine416pass/0fail/6skip/11TODO (433total); tsc clean; e2e78pass/7skip; probe completed `b746b0947e651c054506ccdb6568d5216a84c2d0f0304fda1b8261ba62e7f0c3`. Existing gate omitted lint and local integration, now mandatory. Historical-content skips/TODOs remain documented; no claim they passed.

## Integrated work

- W60/W63: UTF-8 storage byte limits, transaction rollback, bounded room workload admission, protected reconstructed2026 room seeding/migration.
- W61: fixture camera subjects, bounded NL refusal contract, Studio and controller vocabulary parity, stale parse protection and checkpoint geometry for file cameras.
- W62: lint zero; isolated always-run MCP gate with descendant cleanup; truthful gate proof ingestion; one explicit engine/viewer transport registry.
- Lead: fork-local static-prism editing and support/collision refusals; MCP all-tool coverage, valid sentence path, canonical2026, static edit stale/rebind and actual oversized chapter refusal; director sentence identity assertion. Flagship recording --check added to gate.
- LM005 follow-up found a real vehicle edit bug: forklift-carried loads absent from navigation grids allowed overlapping EUC placement. Height-aware load checks now refuse it without mutation. Invalid raw overlaps remain labeled invariant fault injections.
- Reused unmerged tooling code after review; cherry-picked solar-paint description correction. Historical w27-ab content recorder changes not replayed: obsolete content remains parked.

Reports in this directory give file-level proof and limitations. No historical content values changed. The only excluded historical-file edit is photographic-corrections.ts let-to-const lint mechanics, reported explicitly. No planning pins, take recordings, scene JSON or browser baselines rewritten.

## Validation before full gate

- Combined engine intermediate run:430pass/0fail/6skip/11TODO,447total,58.5s. Later additions have focused tests; final gate owns combined count.
- Typecheck and zero-warning lint clean.
- Workerd integration and director demo passed: `.cloudflare/lead-integration-3/{simulation-integration,director-demo}.log`. All20 legacy+16 engine tools called; sentence compiles identically; static edit changes route and stales plan; canonical remains unchanged. Real185step chapter refused at unchanged32KiB transport cap with named code; already-saved chapter workload refusal covered separately over SQLite.
- Flagship `record-campus-take.mjs --check`: take ID, final state, camera track and bytes all match. No recording writes.
- Lead personally inspected static closed/open passage captures and2024 fixture/Studio sink captures. Workers inspected associated refusal/orbit and pose captures. Targeted browser specs passed.
- Initial redundant concurrent full suites produced timing-only stress/grid failures. Re-running serialized preserved thresholds and passed. Follow-on LM152 will retain explicit performance benchmarks while adding deterministic work-budget tests; it is not silently declared fixed here.

## Acceptance and remaining work

Candidate LAST_MILE counts:26fixed /36re-classified /154remaining of216. These take effect at the successful merge, not at helper completion. Remaining partials LM012,106,107; historical fixture-schema block removed. LM014 means unified routing with separate domains; LM202 world-model unification remains OOS. No claim waves2–4 are complete.

Usage meter: weekly36% at start,40% at latest checkpoint; it exposes no5hour window, so the ≤50%5hour budget cannot be measured from this API. At most3helpers ran. Helpers report approximate16k(tooling first tranche)+9k(camera follow-up) token estimates; these are not billing meters. No unbounded heavy test parallelism.

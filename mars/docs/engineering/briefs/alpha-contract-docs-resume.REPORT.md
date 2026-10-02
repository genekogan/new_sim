# Alpha contract navigation resume — 2026-10-02

Bounded authored-documentation update only: INDEX links canonical ENGINE_GUIDE
activity/scenario authoring, renderer ownership, failure/world-liveness and
persistence/acceptance sections; SCENARIO_COVERAGE.json remains the authoritative
inventory and links its existing UI generator. ACTIVE_ROADMAP owns current work.
The dated release39 quota-pause block and old candidate statements are retained
and clearly labeled provenance, with resumed release40-era navigation above them.
The alpha candidate remains unreleased; ongoing coverage does not certify all63.
No parallel catalog/archive or source, browser, performance, AGENTS or PROGRESS
changes; this is authored navigation, not public acceptance.

Source: canonical `world-alpha-stabilization` HEAD `107af96`, read-only INDEX,
ENGINE_GUIDE and ACTIVE_ROADMAP. The prior guide is integrated at `b060398`.
The isolated worktree held an older INDEX, so this update uses the canonical INDEX
as its baseline. A minimal integration patch against107af96 is saved at
`/tmp/alpha-contract-index-107af96.patch` to avoid replaying older status history if
the local commit needs conflict resolution. Existing worktree/source owners remain
untouched.

Validation PASS: all51 local INDEX targets, including four section anchors checked against
canonical107af96; `git diff --check`; manual entry-order review (current scope →
dated checkpoint → implementation/validation → retained reports). No heavy checks
or browser/public proof; no release acceptance claim.

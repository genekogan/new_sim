# Structured engine evidence reuse — bounded candidate

2026-10-01. Isolated `codex/engine-evidence-reuse`, based on functional5111019.
Unreleased; root owns review, playable integration and the next complete gate.
No package, app, engine, activity, camera, historical, main or deployment changes.

Release34 repeated the real engine suite in `npm run evidence` after its clean
gate:179.6seconds in the gate,155.5seconds in evidence. Existing `--gate` reads
external proof statuses; it does not contain the engine test identities needed
by the evidence map. This candidate avoids that second engine execution only
when a new gate has produced a valid structured receipt for the exact clean tree.

## Implementation and boundary

The gate still executes Node's native CLI test runner on every sorted
`engine/test/*.test.ts` file. Default process isolation, concurrency, assertion
semantics, exit status and the existing15minute deadline stay in place. A custom
reporter forwards native `node:test/reporters` TAP and also records per-file/name
pass/fail/skip/TODO events, duration, load failures and test stdout. The ordinary
`npm run test:engine` package script is unchanged. The gate refuses an altered
package test command rather than silently discarding future runner options.

The ignored gate directory receives `engine-proof.json` and its input identity.
The final successful gate report binds the receipt's SHA256 and the complete
native CLI command. Validation requires matching clean full Git HEAD, Node
version, complete test-file list, all files observed, and an aggregate SHA256 of
every tracked source file's path, content and mode. Symlink identity is hashed
without crawling external directories. Named test-affecting environment options
are hashed, not copied; NODE_OPTIONS test-selection/runner overrides are refused.
The gate compares the structured counts with native TAP and refuses source drift
both during engine execution and across the full gate.

Evidence reuses only a complete green, uninterrupted gate with zero cleanup
errors, matching source identity, local sibling receipt, matching checksum and
native execution counts. Dirty/stale/edited/partial/red receipts refuse with a
named explanation. `--gate` explicitly requests this strict reuse; old gates
without a receipt must be rerun or omitted for standalone evidence. Ordinary
standalone evidence without a discoverable structured receipt still executes
the existing real suite. A discoverable invalid receipt never silently becomes
valid evidence by rerunning behind it.

The existing missing/renamed/ambiguous map matching, skip/TODO treatment,
failure/load-error verdicts and external-proof evaluation are retained. Evidence
output names the reused receipt/hash/source and labels wall time as the original
engine execution. Its independent determinism probe still runs normally.

This is a local integrity receipt, not a signed attestation against someone
replacing both JSON files. Source identity covers tracked inputs, lockfiles,
Node and the named environment controls; it does not recursively fingerprint
installed dependencies or external symlink directories. Existing gate asset
and browser checks retain ownership of those separate proofs. A complete real
combined-gate receipt and actual evidence-regeneration parity remain required
before integration/publication. No speedup claim has been measured on the full
117-file suite yet.

## Executed focused validation

After the sleep validator returned the execution slot:

`node --test deploy/engine-proof.test.mjs deploy/evidence-gate.test.mjs`

Final11/11PASS,0fail/0skip/0TODO,406.9milliseconds. Four new cases cover structured
file identity and skip/TODO/failure semantics; incomplete/stale/dirty/missing-file/
summary corruption; gate checksum/source/command/red/interrupted/path checks; and
native CLI fixture parity, including a real failing child with nonzero exit.
Seven retained external-proof cases pass unchanged. The parity fixture runs both
the native TAP reporter and the observing reporter with the same input files.

The first focused attempt was10PASS/1FAIL: a fixture child inherited Node's internal
`NODE_TEST_CONTEXT`, so neither child began the intended independent CLI runner
and no receipt was written. Only fixture setup now clears that internal marker
for both baseline and observing children. Native assertions/expected statuses
were retained. The failure record is preserved in ignored
`viewer/.cloudflare/engine-evidence-reuse/first-failure.json`; final execution log
is `focused-final.log` in that directory.

No full engine suite, full gate, build, browser, performance check, dependency
installation or deployment was run. No new helper agents. Root must critically
review the source and verify full-gate generation/reuse with the next playable
combined candidate. This bounded engineering change does not certify sleep,
prepared-day continuity or any previously skipped historical journey.

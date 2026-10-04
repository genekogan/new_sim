# Refuse unqualified removal-policy history crossings

October4, after73eb85a. This guards the internal crew-removal candidate checkpoint;
it does not migrate a world, qualify a policy transition or activate lifecycle.

## Actual finding

WorldHost.boot checked canRestoreSnapshot, but a denied snapshot fell through to
genesis replay under the new factory. Both legacy→crew-removal and reverse
directions booted the same local twenty-tick history under another policy.
Initial two expected-refusal tests failed0/2. Direct factory restoration had
already refused both directions; that alone did not fence host startup.

EngineFactory now has optional canReplayHistory. Explicit false denies boot
before engine genesis/create/restore or log replay. Both existing world metadata
and latest checkpoint metadata are checked. Mars's hook compares only its explicit
crew-removal policy: no marker for legacy, exactly one +crew-removal/1 marker for
the candidate; unknown or duplicated removal markers are denied. Same-policy
legacy checkpoint/replay compatibility remains. Factories omitting the hook
retain their prior behavior. No body/config/hash/event/schema/capability conversion
is added. This is an internal additive factory contract, not a new wire field.

## Evidence and failures

Corrected focused2PASS. First expanded11 run9PASS/2FAIL: no-snapshot assertions
expected undefined, while actual Db.latestSnapshot returns null. Those fixtures
were corrected without changing the guard. Final29PASS:

`node --test apps/server/src/history-policy.test.ts
packages/engine-mars/src/crew-removal.test.ts
apps/server/src/lifecycle-runner.test.ts`

- New9: both policy directions with and without checkpoint; incompatible checkpoint
  despite matching world metadata; future/duplicate markers; real human-owned
  legacy and candidate restart with identical body/state/kernel/seq/history; hook
  absence compatibility. Negative boot spies verify zero engine construction calls
  and unchanged selected world/event/snapshot/Soul/private journal/take/capture rows.
- Changed factory policy2 and host native runner18 were rerun: actual admission,
  refusal/recovery, safe walking/seated/held-frame cleanup and eight serial child
  exits. Default host movement/replay plus four baseline exit cases also rerun
  separately5PASS; default orphan/ghost reproductions remain unsafe baseline facts.
- Two changed policy-negative tests then strengthened: after the denied target
  boot, source factory resumes the original snapshot with identical state/kernel
  and retained rows; focused2PASS. This is recovery after a refused switch, not
  a successful upgrade followed by compatible rollback.

Server and native tsc passed. New memory DBs and regression temporary DBs/children
close; no listeners/providers/paid calls. Eight candidate exits and four default
exits serialize within their own suites; the two independent regression commands
overlapped. Original local failures remain failures. Prior private-read64 and
WS20/shot-pair25/MCP12 are retained without rerun here.

## Remaining transition gate

No rule bridge or in-place checkpoint conversion is implemented. A future
qualified transition must preserve old-prefix replay, record the policy boundary,
carry actual quiet/resumable physical state and private pending work, compare
hashes and prove restart on both sides plus an explicit compatible rollback.
Relabeling world/checkpoint metadata or copying a current layout is not that proof.
The opt-in candidate cannot now silently boot an old world; installation remains
held. Do not run an old binary against accepted candidate pending work or call
additive SQLite tables alone a compatible downgrade.

These fixtures use local dev owners, not live/Privy owners; no old production DB
or exact live migration was exercised. The hook trusts operator-selected factories
and persisted metadata, and does not authenticate forged metadata, every historical
rule version or direct replayFromGenesis calls lacking a durable world context.
An existing Db constructor may perform additive schema migrations before host
boot; unchanged-row assertions cover already-open migrated fixtures. Full backup
restore/rollback, staging archive, stress/capacity/cohort/fullW/G/release remain.

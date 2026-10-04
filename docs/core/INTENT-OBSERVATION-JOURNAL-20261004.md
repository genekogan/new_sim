# Durable captured controller observations

October 4, Core `core/intent-observation-journal`, parent
`d76030682a93686963d78975b06e681ea73c803c`. Internal V2 producer only;
no endpoint, advertised capability, default choice activation or public grammar
change. This extends the accepted private controller and atomic admission work.

When an actual native action finishes but its canonical history append fails,
the old observer suppresses subsequent observations in that process. A snapshot
after physical completion then retains a permanently “started” private attempt.
The new native fixture reproduced this **0/1** before implementation.

Migration 13 adds an empty private observation table, without old-history
inference/backfill. The host captures actual executing/terminal metadata with
its original observation tick and the exact canonical admission hash. Capture
is not yet a canonical progress fact. Repeated executing frames preserve the
first capture; they cannot substitute a different admitted activity.

Canonical publication and its private publication sequence/hash commit in one
`BEGIN IMMEDIATE` transaction. The writer revalidates strict payload, content
hash, exact admission/world/Soul/purpose version/program/body association,
publication sequence and the pure history fold before appending. Live history
and listeners follow commit. These checks rely on trusted native/server/SQLite
writers; they are not authentication of arbitrary direct database edits or
independent proof of physics.

The host retries captured evidence at or before current world time, oldest
first, at most 20 per reconciliation call. A start and later terminal can both
survive append failures, and publish in that order without changing their
observation ticks. Publication can happen later than observation; the envelope
records publication time in the simulation, not fabricated earlier acceptance.
Boot folds accepted facts without writing these observations. Explicit internal
reconciliation is also possible while paused, without stepping the engine.
The tick path checks only worlds with private activity bindings; normal worlds
with no V2 attempts do not query the outbox each tick.

No recovery issues a decision, moves a body, infers a purpose from idle state,
calls a model, or fulfils an intention. Program completion remains distinct from
purpose fulfilment and from the end of a held body action. Existing public
whitelists and take schemas remain unchanged; the table has no public API.

## Evidence and failures

Final combined **91/91** focused checks: 17 new observation checks plus 74
changed admission/response/publication/history/replay checks. Actual native
start 1 and terminal 331 survive delayed publication, post-terminal snapshot,
model-free genesis restart and a second boot. Paused reconciliation leaves
engine hash/tick unchanged, produces exactly one terminal and keeps the purpose
active. The ordinary sleeper still publishes at 186, decides at 187, walks at
231 and arrives at 682 with its older purpose retained and $0 paid spend.

A separate SQLite reader sees the captured row but neither uncommitted fact nor
publication marker during acceptance. An injected marker-update failure rolls
back both publication writes; later reconciliation commits both before listeners.
22 actual replaced/current programs produce 21 cancellations and one executing
start, draining explicitly in 20 then 2 records without changing the engine hash.
Wrong-world/body/program capture and damaged body/hash/scope fail closed;
stored damaged bytes, live history/sequence and body hash stay unchanged.
Migration 13 is empty/idempotent and preserves retained requests/events/snapshots.

Five new actual native worker exits cover before capture, after committed
capture, before canonical append, after append before commit, and after commit
before live projection. The three uncommitted publication exits preserve the
captured terminal and later publish exactly once; after commit boot reads the
fact. Future capture waits for simulation time. Before capture, a physical
checkpoint can be idle without terminal evidence: it stays uncertain, not
“completed.” The two earlier start-boundary workers now prove capture survives
publication rollback and subsequent original start publication. Four admission
and two publication workers are also retained in the changed combined run:
13 children run serially within that invocation. All fixture databases and
WS4954 close; no provider/listener remains and paid spend is $0.

The first implementation invocation failed before executing a scenario because
Node strip-only TypeScript rejects constructor parameter properties; explicit
fields fixed it. The first new expanded run passed 14/14. The changed existing
selection then failed **73/74** because its old after-append worker asserted an
autocommitted fact. Append now occurs inside the publication transaction, so
exit rolls it back. That assertion was replaced with stronger checks for no
canonical fact, durable capture, and one subsequent start. The original failed
receipt is retained here; the final 91 follows that correction and three added
boundary cases. Separate four changed default replay/boot checks pass; the
withdrawal case passes again after simplifying its test-only edit literal.
Server TypeScript and diff checks pass. No historical full Mars/DJ failure is
relabeled and no broad native gate was repeated.

```sh
node --test --test-concurrency=1 apps/server/src/intent-observations.test.ts apps/server/src/intent-admission.test.ts apps/server/src/intent-response.test.ts apps/server/src/intent-publisher.test.ts apps/server/src/intent-history.test.ts apps/server/src/replay-regressions.test.ts
node --test --test-concurrency=1 apps/server/src/replay.test.ts
pnpm exec tsc -p apps/server/tsconfig.json
```

## Remaining gates

- Physical observation → committed capture still has a crash/write-failure
  gap. The negative native checkpoint deliberately proves idle state supplies
  no replacement evidence. There is no inference/backfill/automatic action retry.
- A newer withdrawal or revision can make a delayed captured start inadmissible
  to the current reducer. The withdrawal negative preserves the pending evidence
  and withdrawn will, with no start or repeated choice. Exact historical-start
  semantics need a separate reviewed checkpoint; this is not full reconciliation.
- Damaged or inadmissible oldest pending evidence blocks its batch, rather than
  being silently skipped or repaired. A generic operator notice reports once per
  fault key per process. Quarantine/fairness/repair policy remains unqualified.
- Published and pending rows are retained. No retention ceiling, sustained tick
  cost during repeated failures, multiprocess world-host operation, all physical
  recovery filters, whole-system card-effect gap or device power-loss guarantee.
  SQLite uses the existing WAL/NORMAL policy. The 20 bound is per call, not a
  global tick cap; new native observations can request additional calls that tick.
- Wait/no-op/unsupported engines still cannot invent an executing start. No new
  physical withdrawal/preemption adapter, group/contact/water/boat permission,
  authenticated V2 transport or consumer adoption is claimed.
- Compatible named readers, pending-outbox rollback/backup and real-owner/cohort
  qualification remain release gates. Older binaries cannot consume this outbox.
  App policy/source counterpart and PM review are requested for this concrete
  isolated producer. Main/push/deploy stay held for Gene's explicit handover.

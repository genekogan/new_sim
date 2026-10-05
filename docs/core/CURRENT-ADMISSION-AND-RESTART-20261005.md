# Current commons admission and restart boundaries

This is the Core response to PM-T031. Local first-player and prior capacity
evidence retain their original scope. No population limit, production setting,
default scene, owner policy or immutable C194 input is changed here.

## Admission constraints

The current native lifecycle path requires an authenticated currently invited
human owner (or existing administrator authority). Its transaction reserves an
owned Soul row and unique selected-world name before physical admission. The
configured default is five **active/pending non-retired Souls per account in the
selected database**: the query filters retired rows but does not filter world.
Deployed worlds use separate databases, so this query is not a universally shared
cross-database quota. It is an account policy within that database, not a world
capacity of five or a cohort allocation.

Admission probes an exact detached checkpoint and rechecks under the canonical
writer lock before logging birth. Non-resumable native work defers admission.
Lost current authority also defers it. Ordinary arrival-unavailable releases the
logical reservation while retaining the private refusal receipt; codec/invariant
failures remain faults. Readiness requires the logged birth, actual matching
native body, Mind/kernel/deck and current owner/control correspondence. A 202
receipt, visible body or invitation alone does not confer control.

For the safe commons native placer, there are 91 ordered candidate positions:
the arrival point plus five rings, radius increments 0.9m. Existing people must
be at least 0.8m from a candidate; the level-zero native grid must have standing
clearance for the body radius (ordinary human 0.28m). Native path feasibility to
the reference or arrival is checked. These geometric samples are **not 91 slots**
and do not promise 20–30 simultaneous births. Current supports, obstacles,
occupancy, paths and resumability determine each result. A full arrival region
can refuse even when the world elsewhere is spacious.

The lifecycle recovery scan is round-robin keyset paging of at most 20 pending
operations per pump. That is a work bound, not a 20-body population maximum.
Retirement revokes control durably before native support/crew/occupancy drains;
incomplete safe removal is not permission to erase a body or grant it new will.
Public take bounds, transport backpressure, API limits and model budget impose
additional workload constraints that the standing-disc test does not measure.
The four current Mars personal mat/utensil sets are a separate resource limit.

## Reused capacity evidence

The accepted d760306 workload uses Greenfield, the native safe-crew policy,
LivingWorld/customs and fake minds: 28 invited friends plus one steward, seven
waves of four, 8400 native ticks, zero violations/lifecycle faults/$0. All bodies
moved in the retained run; the assertion required some movement per wave.
Final 29-body tick p95 was 1.066ms, max 16.659ms; a previous wave reached 24.251ms.
Heap was an unforced-GC observation. Snapshot and inclusive genesis matched.

Its runtime provenance is 5b10be1 plus the retained executed test, not a clean
96ca base despite the raw report's incomplete label. PM's source/provenance review
is `team/reviews/core-eden-capacity-d760306.md`, with the immutable report and
original failure retained. No rerun or metric rewrite was performed here.
Those measurements do not establish current C194 commons/cohort, network/WS/
browser load, dialogue/action mix, held construction, day-long memory or a
capacity ceiling. A current frozen 20–30 workload remains a separate PM gate.

## Reusable current C194 restart input

The manual qualification harness is
`apps/server/test/qualification/me-restart-input.ts`. It deliberately lives
outside the default portable test glob because it requires the existing sealed
local C194 supplier at
`.e2e/exports/core-native-c190-live-me-45b9c986/sim`.
It checks ten directly used source pins against that supplier manifest before
imports and after execution; the supplier and accepted transitive provenance
are unchanged. It reuses the contained native factory/fixture/Auth/HTTP/Hub/
SDK/kernel; there is no dependency install, copied feature overlay or new resolver.

The actual bounded check admits two synthetic invited ordinary owners and owned
bodies, records distinct legacy intents through the real sequencer, advances
40 native ticks and checkpoints. It closes SDK connections, WebSocket server,
native Host and SQLite, then opens the same file with fresh native server objects.
Native/kernel hashes, head tick, intents, private lifecycle receipts and birth
count match. Fresh real WS/SDK connections recover each owner's own control with
a new connection scope. Reciprocal foreign email markers are absent; anonymous
frames retain both public bodies but exclude intent/receipt/email markers.
Actual in-process Hono receipt reads are owner200, foreign404, anonymous401 with
no-store; positive and negative bodies plus full synthetic WS frames are saved.
No compiler/model/brain-call injection is needed; paid spend is zero.

The first run failed on a fixture's `pending === false` assumption: a successful
snapshot omits that optional field. The repair asserts no pending flag and exact
checkpoint tick. Corrected run passed; moving the harness out of the portable
test glob then received one affected path-resolution check, also passed. Initial
type invocation lacked the existing server type root; the scoped invocation uses
it without installing anything. These receipts stay distinct and retained.

This proves SQLite reopen and fresh in-process server objects on C194, **not** an
OS process restart, browser reload/return, current PM candidate restart, real
authentication, comprehensive privacy, V2 intention restart, or cohort capacity.
Existing incremental private-Me and wider API proofs are reused separately.
The missing combined seam is a PM-frozen server lifecycle harness that restarts
the exact compatible candidate while its actual App consumer returns, preserves
pending/completed responsive requests and fences obsolete private sessions.
This input supplies a reusable producer fixture without replaying the stopped
first-player PASS or altering its candidate.

Run only with the existing isolated supplier, free Core port 4959, temporary
SQLite, fake minds/$0 and shared heavy lease:

```sh
python3 <team>/ops/with-heavy-slot.py --owner Core \
  --purpose c194-two-owner-reopen --timeout 50 -- \
  node --test apps/server/test/qualification/me-restart-input.ts
```

Do not publish its synthetic private proof as a public take or recording.

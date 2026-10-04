# Atomic private purpose admission

October 4 Eastern. `core/intent-atomic-admission`, parent `d3aba39`.
Internal opt-in producer; default bridge, REST/MCP operations and capabilities
remain inactive. No database migration, public decision payload or take change.

New explicitly associated purpose decisions and their named private admission
facts now commit in one `BEGIN IMMEDIATE` transaction before live engine effects.
The original caller/body/owner/legacy-will and exact active purpose-version fence
runs under that writer lock. The ordinary decision retains its old public shape;
the adjacent private fact retains its strict grammar and public whitelist.
Association is durable at acceptance rather than depending on a later write of
ephemeral queued context. Both folds finish before applied listeners are called.

The optional engine `previewAdmission(program)` returns detached ID/acceptance/
diagnostic data without consuming an ID, cancelling a program, issuing an action
or advancing time. Native preview and `perform` share their admission calculation.
Construction binds its finite job before replacing an old program. This is an
admission result, not controller execution or purpose fulfilment. The host verifies
the live fold's ID, acceptance and diagnostic against the committed preview before
applying the private projection. No client supplies an activity/admission claim.

Adapters without this capability use a detached restored checkpoint, requiring
checkpoint eligibility, a separate engine/world, matching tick and matching state
hash. Ineligible/inexact fallback checkpoints defer before either write or body
effect. Brain keeps the purpose wake with a 40-tick reconsideration delay only
while the original Mind and will generation remain current; a newer withdrawal
or legacy will is preserved. Arbitrary adapters still need their own conformance.

Native sleep and construction are deliberately not always resumable. They do
not require checkpoint fallback: the native read-only calculation works while
sleeping or while a committed crew holds a load. It admits/refuses the next
program without interrupting those bodies. Existing physical cancellation,
admission and safe committed-construction rules still govern actual `perform`.

## Durable boundary and remaining uncertainty

- Before commit, an admission write error or worker exit leaves neither new fact,
  consumes no sequence/program ID and changes no live program or Mind. A later
  current reconsideration may submit a new choice because none was accepted.
- After commit, before live perform or private projection, both facts survive.
  Model-free boot performs the original decision and folds its exact private
  association; it does not generate another decision or infer purpose identity.
- A committed preview/live mismatch uses the existing attributable-card physical
  fault recovery. Historical admission is retained while the faulty physical
  decision is excluded. The caller receives `PersistedIntentAdmissionFault`;
  Brain reports generic physical reconciliation and does not duplicate work.
  The fixture qualifies this supported recovery, not every unattributable fault.
- Existing older unassociated decisions stay unassociated. There is no safe
  inferred backfill, automatic physical retry or universal legacy reconciliation.
- Controller observation-to-fact persistence, missed/wait/no-op progress,
  unsupported active-index growth, sustained plans/post-start withdrawal,
  authenticated final generation/authority, retention and compatible reader
  rollback remain separate activation gates. Program completion and purpose
  fulfilment remain distinct. No power-loss or live wall-clock claim is made.

## Evidence and failed attempts

Final **111/111** focused backend/native/private/fence/mandate/replay checks and
**4/4** native construction checks pass. Server/native TypeScript and diff checks
pass. Fake/injected local minds only; paid cost **$0**. No broad Mars gate or DJ
repeat; historical broad120/121 remains failed.

The actual sleeper trace remains publication186 → decision187 → walking231 →
arrival682. Native start1 → program completion331 survives snapshot continuation
and genesis replay. Anonymous WS4954, real Hono routes and native takes keep
private markers absent. A separate SQLite reader sees neither half during the
transaction and both before live perform. Repeated/mutated previews leave hash,
world, records, eligible snapshot/counter and current program unchanged. Two
queued pairs have distinct program IDs, ordered sequences and correct replaced
attempt/current attempt observations. All four finite construction phases match
preview to actual admission; committed-load refusal remains read-only.

Four actual native worker exits cover before private append, after append before
commit, after commit before live perform, and after live perform before projection.
The first two restart with neither fact; the last two restart with both, one
original program, one associated attempt and actual subsequent controller start.
Second boot agrees without models or a new decision. Existing controller worker
boundaries and filtered recovery remain covered separately.

The first draft's **21/24** admission run failed three old assertions expecting
the previous orphan-write behavior. The checkpoint-only design then produced
**35/37** response checks: actual non-resumable sleep could not wake toward the
campfire. It was corrected with the shared native calculation, preserving the
original response assertions. A temporary diagnostic had an undefined factory
name; after correction it exposed the named non-resumable sleep refusal. A later
**44/46** run caught deferral retaining `timer` instead of the current purpose
wake (one child plus its parent failed); the guarded wake correction preserves
newer withdrawal. Draft TypeScript optional-result errors and a duplicate test
variable were corrected. None of these failures is relabeled as a pass.

Reproduce the focused suite with Node26.8.2/pnpm10.27.0:

```sh
node --test --test-concurrency=1 apps/server/src/intent-admission.test.ts apps/server/src/intent-response.test.ts apps/server/src/intent-publisher.test.ts apps/server/src/intent-history.test.ts apps/server/src/compile-fence.test.ts apps/server/src/mandate.test.ts apps/server/src/replay-regressions.test.ts apps/server/src/contracts.test.ts
node --test --test-concurrency=1 packages/engine-mars/src/construction.test.ts
pnpm exec tsc -p apps/server/tsconfig.json
pnpm exec tsc -p packages/engine-mars/tsconfig.json
```

App/PM source-policy review of this changed admission boundary is requested before
activation. The earlier [admission](INTENT-ADMISSION-20261004.md) and
[controller](INTENT-CONTROLLER-20261004.md) records remain pinned historical proof.
Main, push and deployment remain PM-owned and held for Gene's explicit handover.

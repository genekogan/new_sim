# LM-026 stage 1: return to the exact seat

Isolated branch `codex/social-resume`, based on main `b457c6b`. This commit does
not include the pending corridor or vehicle stack. LM-026 remains **partial**.

## Behavior and proof

Before this change the existing seated-carry test explicitly expected all actor
and seat claims to disappear after a successful directive; no return intent was
stored. The current conversation regression still proves that pre-empting one
member ends the whole group. This patch addresses occupied standalone `sit` and
seated `take_slot` only, through an optional `ActionDef.resumeIntent` hook.

The hook stores the resolved exact slot id before cancellation. A plain-data
runtime queue admits one new, non-preempting social action after successful
completion of the directive. A pre-empting child is associated with its outer
parent directive so the return cannot race sibling work. Source records remain
cancelled, preserving the event history. Normal seat planning, approach motion,
stand/sit transitions and reservations perform every movement.

Failed or cancelled directives explicitly **skip** returning. Newer explicit
actor claims, including commands that later refuse, and `stand` supersede the
intent. Original directive children and autonomous/social child activity do not.
A busy actor, held load, occupied/deleted seat or inaccessible approach causes a
named refusal, never a stolen reservation or dropped support. Marks report
`social.resume-started`, `social.resume-refused` (with the admission diagnostic),
or `social.resume-skipped` (with the reason). There is no retry loop.

## Inspected capture

`social-resume.capture.json` records four physical stages for both verbs:

| Stage | Tick | Actor position x,z | Activity |
| --- | ---: | --- | --- |
| Initial seat `chair#seat` | 77 | 0,-5 | sit |
| Directive starts after standing | 89 | 0,-4.375 | idle |
| Directive completes | 183 | -4,-7 | idle |
| Exact seat occupied again | 305 | 0,-5 | sit |

All eight states were inspected. The original action remains cancelled, the
walk completes, and the new seat action is occupied with its own reservation.
Both physical runs have zero violations.

## Validation and compatibility

- New focused suite: **8 passed**, zero failures/skips/TODO (~1 s).
- Existing pre-emption regressions: **7 passed** (~0.75 s), with the seated-carry
  expectation updated to verify its physical return. Converse behavior unchanged.
- Source scan, TypeScript and scoped lint pass.
- Tests cover occupied/deleted/unreachable refusal, held-load refusal without
  releasing support, cancellation before/during the directive, plan failure,
  newer rejected instruction, and outer-directive timing. Geometry deletion and
  held-state fixtures exercise invalid-admission guards; they are not claims of
  a new construction or load-transfer capability.
- A queued return survives a version-1 runtime snapshot during the directed walk:
  resumed world hash and complete continuation event stream match, one return.
  Queue-free snapshots also restore identically. The optional plain-data service
  is absent on ordinary runs; no format change or new world field. Snapshot blobs
  with an active intent necessarily contain that additional service state.

No broad suite, pins, gate or deployment here. Conversation member preservation
and re-forming, group-owned seat return, ambient re-adoption and item-overlay
release remain separate work. A returned seat is an ordinary indefinite hold;
callers awaiting only the directive should wait on its id, rather than all live
social work. Lead owns full-gate validation and row scoring. Estimate 25 minutes /
10k tokens, no additional helpers.

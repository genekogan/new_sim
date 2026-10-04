# Native controller evidence for retained purposes

October 4 Eastern. Parent `46eaade`, branch `core/intent-controller-outcomes`.
Internal producer after the accepted admission component; default bridge and
V2 routes/capabilities remain inactive. No public take or renderer change.

Native `programAction(id)` optionally observes the actual current action bound
to a program. It returns detached scalar metadata: program/body/step, tick,
action ID, verb, status and optional phase. It changes no controller, program,
snapshot format, hash, physical rule or motion. Unsupported engines, body
release waits, pure waits and no-op programs return no action observation.

Private accepted admissions create a replayable active-binding index outside
the kernel. The live host records `started` only after observing that program's
actual action in `executing` status. Admission and the native `step` callback
do not establish a start. Terminal program events record `completed` after an
observed start, `blocked` on failure or `interrupted` on cancellation. Each fact
names the exact admission sequence/purpose version/attempt/program/body and
carries the actual action or terminal event observation. Its accepted envelope
supplies sequence/tick; controller evidence references that fact and observation
tick. Strict schemas reject wrong progress/status/kind and future origins.
Host replay verifies the exact scoped canonical admission association. As with
admission, structural checks are not independent proof of a trusted native
observation inserted into the log.

Completion means the admitted **depiction program** ended. It does not fulfil
the owner purpose or assert that every held native activity has ended: a program
can leave a seated/gathering action holding its body. A recorded start means
controller execution, not a measured root displacement or wall-clock latency.
Consumers must preserve these distinctions and use actual current public body
state separately. Transient pause/block phases and group consent are not newly
qualified by this component.

Private bindings survive log/snapshot readers; the per-tick index removes
terminal attempts. Polling reads active private state without cloning all
historical attempts on every frame. Only accepted/started bindings are observed.
Owner-will generation uses revision/status sequences, excluding activity facts;
progress during a delayed model call neither invents a new direction nor
invalidates otherwise current owner intent. Real append/edit/withdraw/legacy
changes retain their admission fences and delayed-wake precedence.

Late actual cancellation after withdrawal or a new revision retains the older
attempt's terminal evidence without reactivating its purpose. Withdrawal itself
does not yet request physical cancellation. A purpose withdrawn/edited before
start receives no new start fact from this observer; its actual failure or
cancellation can still be recorded. Safe post-admission withdrawal/preemption
and full sustained execution remain separate work.

## Proven limits and failures

- Pure wait/no-op or immediately ended programs with no observed executing
  action receive no manufactured start/completion. The test deliberately leaves
  their last history state admitted even after the engine program ends. A wider
  execution-observation contract is needed for those cases.
- Decision→admission remains the previous two-write/ephemeral-association gap.
  Controller terminal observation→fact also has a persistence gap; no atomic
  durable observation journal/reconciliation is claimed. Before/after start-fact
  worker termination recovers only accepted facts and one original program.
- A controller-history write failure reports a generic reconciliation notice
  once, suspends that attempt's observer in the process, and neither invokes
  physical fault recovery nor reissues a decision. Actual motion can complete
  while the last private fact is started. Missing terminal evidence is not
  fabricated or inferred from current idle state.
- Admission preserved through filtered recovery remains historical; missing
  current execution does not manufacture interruption. Full private retention,
  all recovery filters and compatible named-handler rollback remain gates.

The first broader check was **98/99**: the new socket fixture advanced its
world before awaiting the asynchronous anonymous hello. No controller batch
could reach that not-yet-ready client. The fixture now waits for the actual
welcome before generating observations. Changed-path socket1/1 passes; final
99/99 follows that correction and active-index pruning assertion. The failing
receipt is retained here; it is not a production transport defect claim.

## Evidence

```sh
node --test --test-concurrency=1 apps/server/src/intent-admission.test.ts apps/server/src/intent-response.test.ts apps/server/src/intent-publisher.test.ts apps/server/src/intent-history.test.ts apps/server/src/compile-fence.test.ts apps/server/src/mandate.test.ts apps/server/src/replay-regressions.test.ts apps/server/src/contracts.test.ts
pnpm exec tsc -p apps/server/tsconfig.json
```

Final99 focused checks and server tsc pass, fake minds, $0. Actual native probe:
admission0, executing-action start1, program completion331; snapshot at start,
resume to completion, exactly one start, model-free genesis engine/history agree,
no runtime violations and purpose stays active. Detached observation mutation
leaves hash/checkpoint unchanged. Removing the target emits step then failure,
and private history contains blocked with no false start. Ordinary sleeping
body trace stays publication186/admission187/walking231/arrival682, now with
executing-action start evidence instead of treating arrival as completion.

Actual cancelled programs before start and after start/edit/withdraw, delayed
fake mid call during start, terminal writer failure, and two actual native worker
terminations exercise their boundaries. Actual Hono public log/kernel/world/take
routes and anonymous WebSocket4954 carry the new whitelist, excluding words,
interpretation/principal/purpose IDs. Workers/sockets close. No broad server/DJ
repeat; historical full120/121 stays failed. Source/policy counterparts and PM
review requested; no consumer activation, live model or release claim.

# Private native admission evidence

October 4 Eastern. Parent `fad8298`, branch `core/intent-admission-outcomes`.
Internal opt-in component; no route, capability, configuration or live activation.

An understood purpose now has an explicitly associated attempt when its first
qualified immediate choice reaches `Engine.perform`. The existing public
decision payload is unchanged. Private queued server context names the exact
purpose version; it is not inferred from names, timestamps, cards or nearby
events. The ordinary compiler/body/authority fence and a fresh purpose/owner/body/
legacy-will check run under the sequencer's writer lock before the decision.
Only a chosen option actually matching the current immediate purpose receives
this association. Legacy, spontaneous, continue and default private-off choices
keep their prior path.

The sequencer reads the actual fold result and immediately writes a named
`intent-admission-v2` fact before accepting the next queued input. The fact links
world, Soul, purpose revision, deterministic attempt ID, actual native program ID
and canonical decision sequence/tick/entity. It records `accepted` or `blocked`
with the native refusal code. Its sequence/tick come from the fact envelope;
its admission evidence comes from the accepted decision. Strict parsing denies
caller origin, authority, start and completion fields. Persisted admission is a
historical observation, not a claim that the program is currently running.

Named protocol/public/fold/host handlers prevent the private body reaching the
generic public fallback. Public observers see only world/Soul/origin and a
private update. Private histories remain outside the card-readable kernel.
The host verifies the exact scoped canonical decision reference during replay;
the reducer checks purpose/attempt consistency. This structural validation does
not independently prove a native observation inserted by a trusted server.
Only the sequencer producer observes `Engine.perform`; no client operation
accepts an activity or admission claim.

The native sleeper trace remains publication186, decision187, walking231,
arrival682. Its private fact records admission187. Walking and symbolic arrival
leave the attempt `accepted` in this component: neither fabricates a controller
start/completion fact nor fulfils the broader purpose. Actual controller start,
terminal observations, sustained plans and post-start withdrawal follow.
The native `step` callback can precede failed lowering and cannot prove start.

## Crash boundary and compatibility

Decision and admission are two durable writes. Actual worker termination before
the second write leaves one real accepted decision/program and no private
attempt fact. Termination after the second write, before projection application,
recovers the fact from the log. Both cases replay without a model or automatic
new decision. A writer failure returns `UnrecordedIntentAdmission` with the
persisted decision sequence. Brain reports generic reconciliation uncertainty
and preserves the already accepted program rather than scheduling a retry.
The pending purpose association is ephemeral in the first case; durable gap
reconciliation remains required before activation. This is not atomic attempt
publication, durable retry/idempotency or complete lifecycle recovery.

Filtered physical fault recovery preserves the admission as historical truth
while excluding its physical decision. It does not pretend execution survives
the recovery or manufacture interruption. The real recovery fixture retains
that distinction and reboots successfully. Compatible private readers and an
explicit interruption/reconciliation policy remain release gates. Readers
predating the new named handler cannot reconstruct this private fact; preserve
accepted logs and snapshots, and qualify rollback before live emission.

## Evidence

Broader changed-path command:

```sh
node --test --test-concurrency=1 apps/server/src/intent-admission.test.ts apps/server/src/intent-response.test.ts apps/server/src/intent-publisher.test.ts apps/server/src/intent-history.test.ts apps/server/src/compile-fence.test.ts apps/server/src/mandate.test.ts apps/server/src/replay-regressions.test.ts apps/server/src/contracts.test.ts
pnpm exec tsc -p apps/server/tsconfig.json
```

84 checks pass, including actual native admitted/refused programs, unchanged
sleep/wake trace, same-tick withdrawal and legacy precedence, owner loss,
log/snapshot readers, injected writer failure, physical recovery and two real
worker termination boundaries. Real HTTP/anonymous WebSocket4952/kernel/world/
take privacy fixture now emits the admission fact and excludes the private
purpose ID as well as words/principal/request markers. The socket and workers
close; paid spend is $0. A subsequent actual Brain writer-failure regression
confirms its timer/accepted program are retained, no fresh wake is scheduled,
and the error excludes private writer detail. Final admission/native21 and tsc
pass after that assertion. Earlier native9 and interim39 checks passed during
development; the broader84 run includes the service failure/no-retry case.
No broad server/DJ repeat; historical full120/121 remains failed.

App source/policy counterpart and PM review are requested for this bounded
producer. No World rendering, root dependencies, main, push, deploy, paid model,
public setup, admission allocation or production allowance change.

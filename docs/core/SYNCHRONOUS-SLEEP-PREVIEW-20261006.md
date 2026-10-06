# Candidate: share a safety projection within one synchronous read

The measured compiler revalidation constructed the same detached sleep-to-standing
world twice, once for its prepared card and once for the current binding. This
candidate shares that detached rise only during the single synchronous callback.
Every requested programme still gets its own canPerform check on the projected
world. Different programme steps and invalid/foreign targets are not conflated.

withHumanSleepStopReadV1 creates the projection lazily, checks the current native
programme/action/pose/snapshot eligibility, and binds it to the live engine,
factory/restore identity and full source hash. A source change refuses reuse.
The probe expires on callback return; returning a promise is rejected. Separate
reads, ticks, compiler awaits, writer calls and final admission never share this
projection. There is no global cache or persistence. The public single-programme
helper remains a fresh one-read wrapper.

The projected canPerform check must keep the detached hash unchanged; mutation or
error invalidates that projection. The live source hash is also checked at exit.
Existing ownership, purpose-version and writer guards remain at their original
boundaries; this helper creates no admission, stop, effects or new rule/contract.

In one instrumented sample, five standalone reads required five restores/215
copied ticks; one shared synchronous read required one restore/43 ticks. Compiler
revalidation now requires one restore/43 ticks instead of two/86. Its measured
183.088 ms is a local observation, not a statistically qualified speedup or an
end-to-end first-motion claim. Registry/mint/serialization work still remains.

Nine affected native/profile checks pass, plus a separate boundary check. They
retain actual rise→walk, before/during-rise withdrawal, duplicate/stale stops,
missing codec/policy refusal, owner standing context and snapshot/genesis proofs.
The new boundary case proves separate reads restore separately and source mutation
cannot reuse the projection. It deliberately advances only its synthetic fixture
inside the read; that is an adversarial fixture action, not production behavior.
Types pass; source hashes and real sleeper pose/programme stay unchanged in normal
reads; paid cost is zero. Normal hooks and owned diff review remain required.

This is a Source candidate, not an installed or consumer-selected change. The PM's
frozen6254f5b0 consumer input stays unchanged. No moving whole branch, Root restart,
budget/provider activation, main/merge/push/deploy or additional model/worker is
part of this investigation. PM can decide whether the measured candidate warrants
a separately reviewed successor after its current paired input work and resource
gate. The whole first-alpha and larger program remain unfinished.

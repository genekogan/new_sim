# Detached native birth probe

October4, branch `core/native-birth-preview`, parent
`de2c23cb9470ac58d21dcd98816f44fa3d876a19`.

`probeNativeHumanBirth(engine, factory, request)` is an internal Core/native
preparation primitive for the reproduced lifecycle faults. Strict bounded input
accepts only entity id, label and Soul id. Output `detached-native-birth/1` carries
the exact native schema/rules/tick/state hash and detached `ready`, matching
`existing`, `unavailable` or `deferred` result. It is not an owner permission,
capacity reservation, API admission receipt or logged birth.

The probe requires the matching native factory, takes a resumable checkpoint with
zero dropped executions, restores it and verifies exact state hash before running
the existing native placer in that separate engine. The returned pose is detached
data, not an instruction to teleport an actor. Normal out-of-domain arrival yields
`birth.arrival-unavailable`; conflicting body identity yields `birth.identity-conflict`.
Matching identity is explicitly distinguished from legacy spawn’s blind id reuse.
Non-resumable activity yields `birth.checkpoint-required` without serializing it.
Unexpected codec/invariant failures throw; they never masquerade as unavailable
space. No live engine step, actor, recorder/take, RNG change or log write occurs.

Seven focused native tests pass: actual multi-occupant placement matches following
native spawn; eight repeated probes preserve world/hash/records/render/takes and
snapshot; real unusable arrival preserves state; identity conflicts and malformed
private fields refuse; an actually walking actor continues with the same hash as
an untouched restored control; actually non-resumable native sleep remains intact
and defers; advanced checkpoint reconstruction and unexpected codec fault cannot
produce a positive/refusal result. Synthetic checkpoint-fault variants are guards,
not a new qualification of arbitrary native recovery. Contract/native/server
TypeScript pass; fake/$0. No unchanged owner/socket/geometry tests rerun.
Initial native type check failed because a Node assertion narrowed a missing body
to `undefined` across a later mutating spawn call; changed the absence assertion
to `Object.hasOwn`, retaining the same absence requirement. Initial six native
checks and expanded seven passed; no runtime failure or threshold relaxed.

The five previously approved scene-capture leaf files remain unchanged. Internal
contract/main exports are additive. Existing spawn, controller, replay, snapshots,
HTTP/Souls/account policy and database schema are unchanged, and no caller activates
this probe. Next lifecycle acceptance must revalidate its exact base plus current
human ownership/world/request authority in the sequencer and atomically persist
the durable request outcome and birth before making an admitted claim. Durable
pending/removal, historical orphan repair, active retirement cleanup and App’s
allocation/retry/versioned G response review remain. Non-resumable deferral requires
a bounded supported wake/intervention strategy before cohort availability claims.

This does not install terrain/supports, certify population capacity, authorize
private Soul disclosures or claim real owners/live release/rollback. Main held.

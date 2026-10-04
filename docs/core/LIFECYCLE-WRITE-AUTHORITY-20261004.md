# Candidate lifecycle control authority and private-read correction

After0b325ea; scoped G005/C094/C097 implementation. No production installation,
capability, App adoption or main/release action. This qualifies a further internal
human/REST control boundary; it does not close the full lifecycle contract.

## Private reads authorize before decoding

App's exact0b325ea source counterpart found that foreign receipt lookup decoded
and hash-verified the private operation before checking its owner. Actual Hono/
invited ordinary Alice/Bob/native fixtures reproduced generic500 for a foreign
valid-ID receipt with corrupted body or event association. No private contents
leak or live incident is claimed. Initial malformed JSON test input was correctly
rejected by SQLite's json_valid CHECK; replacing it with valid JSON of the wrong
shape established the actual body counterexample.

`operationForReader` now selects only world/current Soul/owner/entity identity
metadata authorized for the current reader/admin, before loading/decoding private
evidence. Current invitation/role is checked by Souls first. Unknown/foreign and
changed identity remain uniform404/no-store with zero private decode calls.
Authorized Alice/admin still receive fail-closed invariant500/no-store. Bob's
own history stays empty and forged owner history denied before any private decode.
Tests intercept only synthetic expected error reporting and assert exactly the
owner/admin invariant reports; corruption is not disguised as ordinary refusal.

## Controls retain authority through acceptance and delivery

Human controls carry captured issuer identity and stable Soul/world/owner/entity
identity; queued guards read the current user/invitation/role/row and fresh actual
body/Mind/kernel readiness. REST agents also carry the captured credential hash;
rotation, revocation, retirement or owner invitation withdrawal invalidates it.
Raw tokens are never serialized into guards' canonical events or printed.

Intent, agenda deal, mandate upsert/status/removal, compiled deck/card mint and
proposed card mint use the existing checked host acceptance with its journal hook.
A no-op transaction hook holds BEGIN IMMEDIATE across the current guard and
canonical append; there is no extra private request row or replay event. Actual
positive intent and card mint observe SQLite isTransaction=true inside the guard.
This is a transaction-boundary check, not multi-process concurrency qualification.
The existing Brain compile/mint guard/journal seam is reused without provider code
changes. Each continuation checks authority again after awaiting interpretation;
retirement cannot turn an old local compiler result into a new intent.

Final HTTP control responses and REST long-poll status refresh the same current
authority before JSON delivery. If an intent was genuinely accepted before
retirement, that immutable fact remains logged, but an artificially held response
cannot later report current success after authority disappears. Default worlds
without the candidate installer retain the previous paths and response behavior.
These are request acceptance guards; they do not consult models during replay.

## Executed proof

Final focused run **34/34 PASS**:

- Existing candidate HTTP10: private/legacy/retirement historical refresh/native
  refusal/local count-name/invitation/socket-loss boundaries remain valid.
- New private-read2: foreign corrupted body/fact404 and zero private decode;
  legitimate owner/admin invariant500 remains visible.
- New control18: human/REST queued retirement races, normal authorized intent,
  current invitation/admin role/owner/world/body mismatch, token rotation and
  withdrawal, actual queued native card mint/mandate, held local compiler results,
  held final delivery, long-poll denial and real transaction-boundary acceptance.
- New terminal/paging4: legacy retirement write200 only after actual removal;
  real2s unconfirmed503 while the body remains; opted-in actual terminal create
  and retirement write200; actual HTTP20+1 opaque cursor traversal over21 real
  native producer operations (11 births, ten confirmed retirements), owner scope
  and admin cursor read. These history fixtures accept through the native service,
  not21 HTTP creates bypassing the unchanged5/hour rate policy. Controlled terminal
  response fixtures run real host acceptance between acceptance and final reply,
  without inventing a fact or advancing world time.

Command: `node --test --test-concurrency=1` with lifecycle-http.test.ts,
lifecycle-private-read.test.ts, lifecycle-write-fences.test.ts and
lifecycle-http-terminal.test.ts in apps/server/src.

Default native-owner-lifecycle regression **10/10 PASS**, rerun because shared
Souls/HTTP method signatures changed. Its positive unsafe orphan/retired-body/
unavailable-birth baseline reproductions remain defects, not repaired defaults.
Earlier native runner/character20 is retained separately; it is unchanged here.
All serialized child fixtures and4956 sockets close; local fake minds and $0.

Failures retained: queued human/REST retirement cases first0/2PASS (late accepted
intent200), then corrected. Privacy fact and corrected body cases reproduced500
before ownership. Initial expanded controls16/17PASS used a card fixture containing
canonical hash/origin metadata forbidden by strict proposal schema; it returned a
normal rejected proposal before queuing. Fixture now strips stored metadata,
validates the proposal and observes actual mint entering the guarded sequencer
before testing retirement. Final34/34 is after this correction and transaction
locking. Initial TypeScript failure was confined to new test helpers' Hono return
union and untyped mock tuples; typed callbacks/async helper corrected it. Final
server TypeScript result is recorded in the MR. No paid model pass or UI run.

## Remaining activation gates

MCP credential/body-read/final-tool delivery, other async private surfaces such as
shots, pair approval/poll races, WS Me/public replica/take privacy and C095 exact
public fixture, multi-process acceptance, admission/retirement race stress,
compatible old-world crew-removal policy transition/rollback, real owner onboarding
and scene capacity remain unqualified. Generic Souls fallback does not establish
MCP's captured token authority. No fullG, cohort or safe live migration claim.
Public/private transport and versioned installation are next; do not advertise or
install this candidate based on these tests alone.

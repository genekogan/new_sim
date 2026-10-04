# Native owner lifecycle baseline

October 4, 2026. Branch `core/native-owner-lifecycle`, parent
`0e67e5c481eb25d0444bfdaa64baaa229a74252c`. Qualification and fault reproduction
only: no production runtime, database migration, account policy or API change.

The actual `marsFactory(GREEN_FIELD_WORLD)` used for current native Eden bootstrap
creates the bodies. This is the flat greenfield, not World’s proposed commons,
shore, expanded Mars camp, Toy or a capacity certificate. Real Hono routes, Auth’s
explicit local dev mode, SQLite, Souls, WorldHost and fake Brain are exercised.
`dev:alice` and `dev:bob` have ordinary user roles; real local admin HTTP invitations
are redeemed through owner HTTP. No Privy verification is claimed.

## What works within this fixture

- Two separately invited ordinary owners create distinct physically separated
  native bodies. Owned row, birth event, native human/Soul association, kernel
  body link and Mind agree. Each owner’s Me contains only their own identity;
  another owner’s detail/perception/timeline/mandate/command routes deny access.
- An owner’s existing intent route accepts a wander direction. Actual fake Brain
  evaluation records a decision, the native controller moves the body, and an
  exact-tick log checkpoint restarts with the same engine and kernel hashes.
  Genesis replay reproduces both hashes without models.
- Discarding a completed create response allows refresh to recover one identity;
  a case-insensitive same-name retry returns 409 without another birth/body.
- A real Hono HTTP server on isolated loopback **4956** destroys the requesting
  TCP socket after the real accepted birth, before sending its response. The
  fetch rejects; a new owner Me request recovers the admitted identity/body/link;
  same-name retry refuses. This proves this completed-write response-loss case,
  not arbitrary network retries or request-id idempotency. Server connections close.
- Actual separate Node process exits immediately after birth append (before
  live application), or after birth application (before response), preserve one
  body/identity/Mind on fresh boot. Each child exits 23, runs serially, and uses
  its own temporary database. No mocked engine or fabricated saved body.
- Completed idle retirement removes Alice, denies her old route, preserves Bob
  and restarts with the same native/kernel hashes. Active seat/movement removal
  cleanup and interrupted committed segments are not qualified by this check.

## Faults reproduced, not repaired

| Actual interruption | Durable result | Fresh boot result |
|---|---|---|
| HTTP creation’s `Db.createSoul` commits, worker exits before enqueue | Active owned row, no birth | Owner allocation occupied; no body/kernel/Mind; no reconciliation |
| HTTP retirement’s row mutation commits, worker exits before retire enqueue | Retired row, birth remains, no retire event | Body and Mind return despite the retired row; owner cannot access it |
| Native placer has no valid arrival | Active row and birth appended; no body | Live drain throws an unattributable fault; boot repeats the native placement failure |

The refusal fixture sets arrival/reference outside the real greenfield domain
([500,500]/[501,500]) and exercises all actual native placement attempts. It does
not inject `spawnHuman` failure and does not measure population capacity. The
public create promise remains unresolved after the live drain fault. Assertions
expect this unsafe baseline so a green test run is **not** safe-refusal or
surrounding-world-liveness qualification.

The two exit hooks call the actual SQLite method and exit after it returns. Birth
append and application hooks similarly target real write/application boundaries;
normal requests otherwise use the unchanged HTTP route. The fixtures make no
production DB, live service, archive, provider or protected-source access.

## Evidence and limits

`node --test --test-concurrency=1 apps/server/src/native-owner-lifecycle.test.ts`:
final **10/10 PASS**, approximately 1.67 s, fake minds and **paid $0**. Server
TypeScript passes. The first narrower run was **7/8 PASS, 1 FAIL**: the harness
incorrectly read nonexistent `replay.hash`/`replay.kernelHash`; corrected to actual
returned engine state hash and kernel hash, without changing replay or assertions.
The first type check also caught those fields and Hono’s sync-or-async return;
the fixture request now returns an explicit Promise. Expanded second 9/9 and final
socket-inclusive 10/10 results are distinct. No failed receipt is relabeled passed.

This does not certify current Eden concurrent capacity, proposed terrain/contact,
active retirement safety, real users, selected-host registration, public V2 intent
activation, sustained operation, budget routing, exact release/rollback or archive.
The earlier Mars DJ failure remains separate and unqualified. Main/release held.

## Proposed next correction for policy review

Keep human ownership, invitations, per-owner count and world/name uniqueness.
Introduce a private durable lifecycle request accepted with its owned row (or
retirement request) in one SQLite transaction. Boot must reconstitute pending work
before serving admission claims. A body birth/removal and its private terminal
receipt share the durable acceptance boundary; the queue becomes a wakeup hint.
Owner refresh should explicitly distinguish pending, admitted, refused and retiring.

Before logging a birth as physical fact, run actual native placement on a detached
exact state/checkpoint, verifying unchanged world sequence at acceptance. A normal
unavailable arrival gets an explicit refusal receipt without an unreplayable birth.
Do not infer usable placement from a database row or decorative World surface,
move/teleport a body around obstacles, or suppress invariant corruption. Core owns
the implementation; App reviews allocation/retirement/retry/response policy and the
versioned G shape before mixed route/Souls changes. Idempotent owner request IDs,
name reservation release on refusal and old-client response compatibility need
explicit decisions rather than being silently introduced by the fix.

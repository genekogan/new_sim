# Candidate private WebSocket invariant containment

Follow-up afterf7078b1, prompted by PM C108's exact735 source finding.
Current Me verifies private journal/body/hash correspondence; corrupt authorized
evidence can throw. Candidate hello previously had an unhandled async rejection,
and periodic private stats refresh could throw outside its timer callback.
No default installation, account/auth/skill/UI or public take change.

## Reproduction

Four serialized actual WebSocket/native/fake/SQLite child checks initially pass
**0/4**: corrupt authorized body or event hash at hello or a captured registered
stats callback. Hello exits1 from unhandled async rejection. Initial periodic
checks explicitly invoked the registered callback. They were then strengthened
to wait for the real two-second setInterval: **0/2**, both actual scheduled
callbacks exit1 with the expected journal decoder/fact verification exception.
These are local executed process failures, not a live incident or human-content
inspection. Red child exit releases its memory DB/listener; no service survives.

## Correction

Only the opt-in candidate catches the hello promise rejection and contains
private authority-refresh exceptions per affected client. It clears cached Me
and readiness, emits an operator console.error with the actual invariant error,
sends a generic existing error frame with code private-view-unavailable, and
closes that connection1011. The error frame contains no decoded private body,
operation ID, hash or raw exception. Closing this private connection does not
remove a physical body, rewrite damaged evidence, release logical reservation,
manufacture an arrival refusal or interrupt the other clients.

The broadcast role filter, final serialization and explicit refreshMe paths
use the same bounded failure result. A client with failed verification cannot
fall back to its old role/Soul list or quietly become a healthy anonymous
connection. Operator reconciliation and subsequent fresh connection are required.
The default Hub path/cached-authority behavior remains unchanged and unqualified.

## Executed proof

`node --test --test-concurrency=1 apps/server/src/lifecycle-ws-containment.test.ts apps/server/src/lifecycle-ws.test.ts`:
**20/20 PASS =8 serialized containment children +12 changed-Hub regression cases**.
Focused correction first4/4, then expanded8 with broadcast and explicit refreshMe.

The eight children exercise authorized corrupt body/hash at actual hello,
real scheduled periodic stats, direct broadcast and explicit refreshMe. Each
affected connection receives the generic failure then closes. One actual operator
error invocation is observed through a local console spy. Bob and an anonymous
viewer remain open, receive subsequent public batch/stats/pong, and both native
bodies remain intact. The private operation still has its existing complete
state: no silent repair/refusal. Private IDs/exception internals stay off the wire.
After the actual scheduled fault, the registered stats callback is additionally
invoked once to prove the remaining viewers continue receiving it.

All eight corrected children exit0 and close their own in-memory DB, actual4958
listener, WebSockets and captured Hub timers. Only serialized test children are
spawned; no agent worker or paid process. Paid spend0. Existing fixture unref
timers end with the child process. The twelve normal Hub tests rerun because
those private delivery paths changed; shot/pair25, MCP12 and earlierHTTP/native
proofs remain unchanged and were not rerun. Server TypeScript/diff pass.

## Limits and next gates

This contains these candidate private-evidence exceptions, not every DB/native
fault, race, resource failure, websocket send failure or operator recovery.
No automatic data repair, process-wide fault manager or health claim is added.
Default cached authority, all private reads/auth-body interleavings, JWT/config
revocation, buffered-byte delivery, multiprocess/high-viewer costs, compatible
old-world transition/rollback, native capacity and real owners remain gates.
Candidate capability/bootstrap/main/release/full W/G adoption remains held.

World's C095 native fixture and C109 exact bound public scene supplement remain
separate unchanged artifacts; their mounted consumer proof is World-owned.

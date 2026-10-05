# Current C194 V2 return producer input

This is the Core response to G-Core154 / PM-T047. It uses the existing sealed
`.e2e/exports/core-native-c190-live-me-45b9c986/sim` directly. Thirteen control,
store, compiler, native and transport source pins are checked against its manifest
before imports and after execution. No source export, dependency, runtime feature,
production bootstrap, quota, budget or authentication policy is changed.

The manual harness is `apps/server/test/qualification/v2-restart-input.ts`, outside
the portable default test glob. It constructs one actual native commons Host,
SQLite, Auth, Brain, Souls lifecycle, IntentControlV2/history, Hub and real
WebSocket/SDK connections per server lifetime. Local invited Alice owns the
admitted Soul; independently invited Bob and anonymous access provide negatives.
The real compiler validation/mint/journal path uses an injected synthetic response
with zero tokens/cost; Jev remains fake with no provider key. Its test budget is
one dollar so the compiler gate can be exercised, but actual paid spend is zero.
This is not a production budget change or paid model pass.

## Two deliberately different reference cases

The **completed case** submits one ordinary owner HTTP V2 request with its original
requestId/body. Actual Brain compilation creates a short native walking card after
checking its destination with the native planner. Real Brain evaluation chooses
the purposeful activity. Native admission, start and completion enter the private
history. The API request receipt stays `understood`; the attempt's `completed`
fact is distinct, and the broader purpose is not declared fulfilled. An additional
optional owner-agent request exercises its separate credential-generation scope.

The **received-only case** records the real canonical acceptance phase through
`service.publisher.receive(currentOwnerScope, originalRequestBody)`, deliberately
without starting an interpreter lease. This is a lower-level producer fixture,
not an interrupted live HTTP submit or compiler. It supplies App a truthful
received-only return/recovery state without inventing worker shutdown behavior,
creating a storage fault or fabricating a completed interpretation.

After a safe SQLite close and reopen with fresh server objects, read-only HTTP
lookup recovers both original owner references: completed interpretation200 and
received-only202. Positive bodies match their original strict receipts; Bob404
and anonymous401/no-store remain private. Canonical history events match exactly,
including the actual accepted/started/completed attempt and optional publication.
The received-only request has no invented upsert/history interpretation. Its
stored request JSON/hash and original private receipts stay unchanged. No request
is resubmitted, and reopen/lookup/history cause no additional compiler call.

Real WS/SDK reconnect gets a new private connection scope and the same current
owned Soul. Explicit close clears the old SDK Me; anonymous Me stays absent.
Native/kernel/head hashes match after reopen. This is in-process supported
server-object/SQLite restart, not an OS process kill, App browser, real sign-in,
installed host, cohort or full privacy qualification.

## Supported shutdown and unresolved seam

`IntentControlV2.settled()` waits for its currently owned interpreter promises.
Keep the sequencer and SQLite alive and advance `host.drainInputs()` until this
drain completes. Then close SDK/WS/server resources and timers, stop Host, close
SQLite, and construct fresh objects on the same database. Do not close the DB
underneath a live interpreter. `host.stop()` alone does not stop these workers.

There is **no current worker abort/stop or pending recovery pump**. A deliberately
held compiler keeps `settled()` pending. Constructor/reopen does not reinterpret
existing reservations. Duplicate request delivery yields no fresh worker lease;
the existing request is looked up instead. A crash-uncertain received-only request
can therefore remain received. This harness verifies that read state at the
canonical acceptance boundary, not a live-worker interruption or automatic resume.
If the combined App gate requires interrupting an active interpreter and still
calling the shutdown supported, an explicit worker-lifetime/reconciliation seam
is missing. This request authorizes no Core feature change to invent it.

Fresh backend owner scope binds current user, invite, owner/body identity and
current Mind object. Old in-memory scope closures are not reused after reopen.
Owner request lookup keys include world/Soul/current user principal. Agent lookup
uses opaque `token_generation`; unchanged credential generation recovers its
original request. Rotation changes principal and refuses old-generation lookup,
even for the same synthetic bearer hash. The test uses the existing local token
setter, never exports bearer/hash material, and makes no OS credential-store claim.
Owner history remains a separate currently authorized view across publications.

## Evidence and consumer use

The focused native/HTTP/WS/SDK fixture passed, with strict scoped types. Initial
synthetic output used `cards` rather than the real `new_cards` compiler field and
was honestly refused. A pure adapter wait then lacked a native start/completion
observation; the fixture now uses real admitted walking. The initial anonymous
status expectation was404 while actual authentication requires401. Type-only
promise annotations were corrected. These failed receipts are retained, and no
production assertion or runtime was weakened.

The saved private proof contains original bodies/receipts, actual history,
positive and negative lookup bodies, raw synthetic WS frames, source pins and
credential-generation identifiers. It contains no bearer token or its hash and
must not be published as a public recording. Team audit supplies exact addresses,
hashes and terminal receipts. The immutable supplier's four metadata seals remain.

App may reuse this supported disposable recipe for its affected returning
consumer after verifying the exact pins. Display received-only uncertainty and
recover by read-only reference lookup; never auto-resubmit, infer interpretation
or claim that it resumed a compiler. Native physical completion, interpretation,
broader purpose and private authority retain their separate meanings.

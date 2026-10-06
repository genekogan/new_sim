# A durable receipt returns before interpretation begins

IntentControl.start called its async interpreter directly. An async function runs
its synchronous prefix immediately, so capability construction and interpretation
setup could delay returning an already durable received receipt. A focused failing
case observed interpreter before receipt. Another failing case revoked the owner
immediately after receipt and still observed one synthetic compiler call.

Upserts now begin interpretation on the next event-loop turn. The same work
promise is registered immediately, so duplicate requests keep one lease and
controlled shutdown drains queued work. Current authority is checked when that
work actually begins and again at existing publication fences. No purpose is
published and no compiler is invoked if authority was revoked in between.
Withdrawal retains its immediate canonical-publication path. No timer/routine
object, new API/schema, model worker, retry or crash-reconciliation policy is added.

Three new checks prove receipt ordering, deferred revocation with zero compiler
calls, and duplicate/controlled-drain ownership. Existing transport tests initially
passed22/23; the remaining test assumed compiler start was synchronous at receipt.
It now waits for that asynchronous start while retaining native sleep/walk,
standing-purpose and model-free replay assertions, and passes. Three actual normal
entry/paused shutdown/restart checks pass; types pass. Historical receipt, terminal
lookup, withdrawal, source provenance and request-id semantics remain intact.

One necessary changed-service four-owner timing sample received HTTP202 in
60.219–62.571 ms (prior source sample985.044–987.067 ms). Native/public response
remained slower: anonymous first rise4051.475–4054.208 ms, public walk-state
5055.050–5057.776 ms at observed rate1. The local first-rise target remains met;
this does not establish an overall motion improvement or a population/real-model
SLA. Chunk cadence and interpreter/writer work still affect later delivery. All
older preferences remain recorded; public canaries are absent; paid cost and
native invariant violations are zero. Own processes/listeners/data close.

Only the opt-in versioned intention service changes; live Root, main, providers,
existing data and settings are untouched. No key/live pass is needed for these
isolated fake-mind checks. PM/App review the exact producer before coordinated
integration. Real owners/hosts/devices, sustained/cohort capacity and combined
release qualification remain separate unfinished requirements.

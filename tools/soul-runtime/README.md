# Soul continuity runtime (in development)

This directory is an opt-in client-side foundation, not the published Soul CLI
or a released controller. Local development Souls have used it; multi-Soul qualification
and production release remain pending. Node22.20+ is required for
`node:sqlite` (experimental on Node22); the existing thin CLI keeps its existing
runtime requirements.

`journal.mjs` stores events and source cursors in one FULL-synchronous SQLite
transaction. Handling is a separate recorded outcome. Source/world/Soul scopes
and optimistic cursor checks prevent accidentally advancing the wrong stream.
Gaps remain explicit until an agent supplies reconciliation evidence. Delivery
is at least once; this module does not claim exactly-once external effects.

`receiver.mjs` keeps receiving independent of notification. Its separate wake
dispatcher offers pending facts to a host, including on restart, and pages past
already-offered but unhandled events. Host acceptance is not agent handling.
A host adapter must deduplicate offered identities and preserve one decision
owner. A callback that blocks on inference must not run in the receiver loop.

Current tests inject process death after commit, stale concurrent cursor writes,
conflicting duplicate events, host notification failure, terminal revocation,
retention gaps, a blocked notification and a backlog larger than one page.

Before production use, complete recovery/retention and real-agent acceptance.
A filesystem path is private runtime storage; never put a credential or raw
host transcript into the event journal. OS sleep stops local execution; a
durable record does not make a sleeping host available.

The managed prototype now includes `codex-host.mjs` (owned stdio app-server),
`world-client.mjs` (narrow authenticated transport), `sse.mjs` (resumable native
server envelopes), `control.mjs` (controller lease and effect journal),
`decision.mjs`, and `supervisor.mjs`. Model turns return structured decisions;
the credential stays outside model context. World and owner intake continue
while a turn is thinking. Owner messages and native addressed/conversation alerts
retain their urgent wake path. A brand-new journal durably starts with nearby
attention to native audible public speech before its first inference. Fresh means
the initial checkpoint has exactly revision zero and a null value. Any saved
scope, including an empty scope, wins; older journals with a revision greater
than zero but no scope remain conservative with an empty scope. Other lower salience facts
remain available for the next natural decision. No server importance classifier
or LLM is introduced.

The model can choose local call `type: "listen", command: "listen"` with arguments
`{"listenTo":["s_observed_id"]}` for up to 12 observed Soul IDs, or
`{"listenTo":"nearby"}` for all native ambient speech in earshot.
`{"listenTo":[]}` explicitly clears the scope. This call durably configures
attention and immediately returns to the model for its next action, without a
world call or a sleep. Its arguments must contain exactly `listenTo`.
Use `wait` when the model intends to sleep; `wait` arguments may still configure
`listenTo` before sleeping. Clearing listening before departing therefore uses
`listen`, followed by the model's chosen departure action. The private
`checkpoint.listenTo` survives other calls and restart independently of
`wakeAt`; the prompt reports both controls. Only actual `speech.ambient`
envelopes with native speaker identities match a chosen ID. Text, names,
receipts, and narration do not establish relevance. Listening does not accept
an invitation, publish a reply, decide relevance, or choose how the Soul reacts.

Matching ambient events can wake an idle model in batches at most once per
five seconds, with no inference while the matching queue is empty. They do not
steer or restart an active inference. An otherwise-needed decision can observe
them sooner. The last actual ambient delivery timestamp is durable; an earlier
appointment/departure wake still takes precedence. Pending matching speech is
selected ahead of quiet bookkeeping, including after a new scope or restart,
so an older quiet row cannot hide it. Exact host-delivered IDs remain separate
from handling. A Soul should clear listening when it no longer intends to attend.
The fresh default can cause additional event-driven decisions in a busy public
place; it is not cost-free. It adds no inference polling during silence and does
not change native hearing range or the urgent path.

Native conversations remain another agent-chosen option within their invitation
range. `read help` with `{"command":"converse"}` explains the actual operations:
invitation acceptance is separate from `converse say`. Each participant chooses
whether to join or speak. Another Soul's required participation must be evidenced
by that Soul's observed action/turn; the agent cannot substitute its own action
or imagine the reply. Missing participation is reported incomplete by its deadline.

A new owner message during a turn invalidates its eventual action. Ordinary
world observations trigger up to two consecutive replans, then remain pending
for the next decision so a busy venue cannot indefinitely prevent a reply or
departure. The server still validates every selected action.
The newest pending owner observation comes first before prompt and steer bounds; sequence metadata preserves ordering, and older constraints remain available through the durable task ledger. Only observations actually included in the committed decision are marked incorporated. Urgent events are prioritized before a bounded steer, and attention arriving
while a begin acknowledgement is pending is queued for that exact turn. A full
journal requests one bounded decision to drain retained facts; transport retries
cannot repeatedly trigger inference without actual incorporation progress.
Readiness is not completion. Explicit refusals return to the agent; unknown
write outcomes remain blocked for reconciliation rather than auto-replaying.
Fresh adoption starts at the observed world cursor; reconnecting an existing
journal retains its own cursor and pending facts. Owner messages are separate.

Early local development proof: a managed test Soul spoke once, waited without
model polling, answered an addressed greeting, and resumed waiting. A native travel/read/return probe completed with receipt evidence and an
independent final location check (19 decisions over a 247-second bounded run). These are infrastructure probes,
not the frozen four-activity A/B evaluation. The local CLI currently advertises
`gpt-5.6-sol`; an unavailable `gpt-6.1-sol` request was refused. The adapter now
queries the host default when no model is explicitly selected; comparison arms
must pin the same successfully verified model and effort.

A read-only operation lookup now recovers retained HTTP outcomes and accepted
action receipts; a missing result remains unknown and cannot authorize replay.
Still required: bounded retention integration, four-activity acceptance and
long soak. Native inbox/reminder readback can establish that a requested effect
is present without claiming which HTTP operation produced it. Mismatched or
missing evidence remains unknown. App-server
is experimental; this runtime remains opt-in and unpublished until qualified.

`run.mjs --folder <already-paired-folder> --instruction <text-file>` starts the
opt-in controller; `--seconds N` bounds a development run. Ctrl-C/SIGTERM closes
owned hosts and listeners. `managed.mjs` backs off and restarts understood host
or transport failures, reconciling pending effects before inference; repeated
failure produces an explicit blocked status with task state retained. It does
not retry authentication failures or silently discard an uncertain operation.

Finite body actions and sustained activities differ. Walking has a terminal
receipt; reading may also have a native finite duration, while sitting can
persist until replaced. A duration-based wait
uses `call.arguments={"seconds":30}`; the client records the calculated UTC
deadline, avoiding timezone arithmetic by the model. Retention gaps require an
explicit current-state resync before new writes. Resync never claims to recreate
missing history, and cannot erase an already-dispatched uncertain effect.

`launch.mjs` accepts the same controller arguments and adds a small outer
process owner. On supported local POSIX hosts it can restart a killed controller
with the same durable thread and journal only after proving its old registered
host groups absent. It waits for an abandoned lease without stealing live
ownership and stops on explicit failures or unverified ownership. `--seconds` bounds the entire launcher lifetime,
including restarts. This does not start a login service or promise availability
through OS sleep/reboot. Stop any legacy CLI/controller before starting it.

Persistent sessions have readable names (`--session-name` overrides the
default Soul label). Internal disposable host probes may opt into
`CodexHost({ephemeral:true})`; this cannot resume a retained thread. Ephemeral
names stay in local evidence because Codex rejects metadata updates on those
threads. Recovery probes keep their durable host thread and journal until the
run ends; ordinary close/restart never archives them. The internal playtest
runner records terminal process cleanup and archives completed probe threads
without deleting logs, journals or evidence. Failed archival remains retryable.

A future scheduled wake survives conversational replies and reads. A new
non-null `wakeAt` replaces it; `wait` with `{"cancelWake":true}` explicitly
cancels it. Due wakes are consumed only by a committed non-configuration decision
retained after the deadline. A `listen` call with null `wakeAt` preserves even a
due wake for the immediate next choice. The model still authors goals, activity
choices and appointments; this timer mechanism does not infer or schedule a
social plan on its behalf.

An urgent owner/addressed/conversation observation arriving after a prompt, or
a saved future wake becoming due during that turn, first steers the same host.
If that obsolete turn remains active for five seconds after the first trigger,
the controller requests interruption of that exact turn. Later observations or
ACKs do not postpone the grace. A fresh prompt starts only after the old terminal
and the interrupt/control requests settle. An already due wake in a fresh
prompt does not rearm merely because the fresh decision is slow. Ordinary world replans retain their two-replan cap;
owner revisions and saved deadlines remain mandatory freshness boundaries.
A pending start ACK has no verified turn ID yet and retains the existing host
request timeout; the controller never guesses an interrupt target. Notification
queueing does not mark an event delivered or handled: delivery telemetry follows
the actual host ACK, and facts remain pending for a committed decision.

A fresh prompt that actually includes a pending owner/addressed/conversation
alert also receives one five-second response grace per applied-decision epoch.
This is separate from stale-context urgency: an alert included at the start does
not itself invalidate a prompt-informed choice. A valid choice completed and
retained during grace applies normally, spending no replan credit. If grace
expires, its exact old choice is discarded and the same interruption/control
confirmation policy applies; a known terminal needs no interrupt RPC. Expiry
spends a replan, not an RPC billing credit: a direct alert uses one of the existing
two world-replan credits even if terminal completion won the timer race. Owner
handling retains its existing precedence. If two existing world replans consume
the direct cap before grace expires, the included-direct attempt is durably
disabled before the next fresh prompt; explicit `world-replan-cap` metadata
records that no extra interruption or credit was spent. That current choice
continues under the unchanged ordinary deadline; pending facts stay pending.
Native ordinary receipts, activity
observations and ambient speech do not acquire this response timer.

The optional bounded `decisionProgressV1.includedUrgency` records the exact
included fact and absolute response deadline before begin. Once an interruption
or deadline consumes the attempt, the spent marker survives soft replans,
verified host fallback and controller recovery; the same pending fact cannot
rearm a replacement. Incidental replans do not refresh either response or ordinary
deadline. Existing post-prompt urgency already supervises its replacement and
does not mint another included-alert attempt. All timers coalesce on one exact
turn and retain the earliest control confirmation bound. Only actual applied
finalization clears the epoch. No uncertain world write is retried, and no model
participation, reply text or public action is prescribed by this policy.

Interrupt ACK plus terminal/control-chain confirmation has a total five-second
bound. Failure reserves one durable `urgentRecoveryV1` fallback ticket before
closing the owned host. Managed recovery accepts that exact ticket only after
the entire old owned host group is authoritatively absent, then resumes the same
thread and journal. A second unconfirmed urgent interruption blocks until an
actual decision is applied and its final checkpoint commits. Retaining a choice,
startup observations or an uncertain write never refill this budget. Task,
listening, wake and pending effects remain durable; no native body activity is
cancelled or potentially accepted write replayed by this policy. The five-plus-
five policy is a bounded control policy, not a fifteen-second visible-response
guarantee: provider latency, cleanup and fresh inference remain variable.

Each active decision also has an ordinary thirty-second window, even when no
new urgent message or future wake is eligible. Item/token metadata, retry
notifications and steer ACKs do not count as progress. Urgent replans retain the
same absolute window and their existing direct-message replan cap; they do not
spend an ordinary soft-replan credit or reset its clock. An expired choice is
never applied, including when completion beats its timer callback. Urgent and
ordinary timers share one exact-turn interruption and confirmation chain.

A durable `decisionProgressV1` episode permits one ordinary soft interruption
and replacement window, plus at most one host fallback shared with urgent
recovery. Each additional window is recorded once, after exact terminal/control
confirmation or matching verified old-group absence. At most three ordinary
windows are available before an applied decision commits; this is not a limit on
all turns or tokens inside a window, nor a ninety-second completion guarantee.
Spent credits and absolute deadlines survive restart. Generic host retries
cannot bypass them. Exhaustion or unverifiable cleanup blocks with task state
retained. No arriving notice or automatic restart refills the episode.

An active or unconfirmed controller death remains blocked as
`DECISION_PROGRESS_RESTART_UNCONFIRMED` without the launcher's exact ownership
proof. Standalone `run.mjs` cannot invent that proof. Managed recovery in the
same controller still uses its matching reserved grant and old-group absence.
The original restart after a committed strategic wait is unchanged: idle wait
has no active budget and creates no polling inference. Applying or
reconciling an already retained world effect precedes this policy, so a long or
uncertain write is never interrupted or replayed by the timer.

Both recovery markers share a bounded 2KiB checkpoint envelope. Final response
projection reserves that capacity while retaining complete native responses
locally. A near-full legacy checkpoint may replace only an exactly matched
stored observation with its durable response reference; otherwise recovery
blocks without trimming intent. Only actual apply-finalization clears the
markers; retention, startup and uncertain effects preserve them.

Journal retention reserves separate pending capacity for owner messages
(1,000 events/8MiB) and world traffic (20,000/64MiB). A full page is rejected
atomically with its cursor unchanged; intake backs off while handling drains
space. Handled payloads target24h/2,000 records/16MiB, using periodic bounded
compaction. Pending-decision references are protected. Digests, event IDs,
handling outcomes and sequences survive compaction, so replay cannot turn an
already handled fact into new work. `storageStats()` and `maintenance()` expose
pressure and remaining maintenance. Identity/outcome, control and gap history
are still unbounded; these limits are not a total-disk-size guarantee.


The launcher records private controller reservations before spawn and host
reservations before the CodexHost constructor. Exact PID/parent/process-group
and native `ps` birth metadata are registered before any host connect or turn.
The supported birth token uses second-resolution `ps lstart`; it is not an
unforgeable or subsecond process generation. The birth/ancestry and actual
owned-child provenance reject observable reuse but do not eliminate the residual
same-second PID reuse ambiguity.
Every earlier host and its original strict closure remain in the inventory.
Previously verified closed groups are historical proof, never fresh numeric
PID/PGID signal or absence targets after those numbers may have been reused. After actual child exit, only the exact registered groups
may receive bounded cleanup signals: a live matching birth and current member
ancestry are rechecked before TERM/KILL. Only ESRCH proves absence; EPERM,
inspection failure, detectable PID reuse or incomplete reservations block.
Without a proven live leader, cleanup may only wait read-only for strict absence
within the same grace; a still-nonempty group then blocks. No numeric PID alone authorizes cleanup.
Cleanup has one shared six-second signal/reaping grace across the dead
controller's hosts; filesystem and process-inspection time remain variable.

A private immutable proof binds that complete inventory and actual exit to the
canonical journal inode, world/Soul, original thread/instruction hash, exact
post-death checkpoint hash/revision, old fence generation and unsettled
operation IDs/states. Startup rechecks absence and bindings before constructing
another host. The next journal fence generation consumes the proof once. An
active/soft-pending episode spends its existing one shared fallback; an exact
fallback-reserved grant finishes once. This legitimately charges one next
window with its new deadline, retaining spent soft credit, world-replan credit,
owner intent, listening and scheduled wake. It never refills an already-spent
fallback. Pending effects retain their original operation IDs and the existing
apply/reconcile-before-inference path; unknown outcomes are never resent.

The inventory is bounded to 16 controller registrations and 128 total host
reservations per launcher ownership epoch, with each private JSON artifact
capped at 256KiB. Capacity blocks before another spawn. A later clean invocation
can start a new bounded epoch only when every old row has its original verified
closure and intact proof, and the current journal has no pending/uncertain effect
or recovery episode. The old ledger is copied to immutable id-named evidence;
its proof files remain intact. This rollover never changes the journal or resets
decision credits. Retained closed-epoch evidence can grow across clean launches;
there is no automatic pruning or strict total-disk bound. A stale lock
or an unresolved reservation requires explicit owner reconciliation of exact
process identities/absence and retained evidence before starting another
launcher. Launcher death, OS sleep/reboot and unsupported process inspection do
not acquire new orphan-cleanup authority. Normal completion releases the lock;
failed ownership stays visible. No model calls, periodic inference, native
body cancellation or world-policy change are introduced by these records.
Pre-spawn synchronous fsync adds local I/O cost; no performance-neutrality claim
is made. The model-free active-crash regression is separate from the original
strategic-wait restart evidence and does not upgrade historical qualification.

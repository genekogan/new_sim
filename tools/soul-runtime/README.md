# Soul continuity runtime (in development)

This directory is an opt-in client-side foundation, not the published Soul CLI
or an enabled controller. No live Soul uses it yet. Node22.20+ is required for
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
retain their urgent wake path. Lower salience facts remain available for the next
natural decision unless the model explicitly chooses to listen to public speech.
No server importance classifier or LLM is introduced.

The model can choose `wait` arguments `{"listenTo":["s_observed_id"]}` for up to
12 observed Soul IDs, or `{"listenTo":"nearby"}` for all native ambient speech
in earshot. `{"listenTo":[]}` explicitly clears the scope. The private
`checkpoint.listenTo` survives other calls and restart independently of
`wakeAt`; the prompt reports both controls. Only actual `speech.ambient`
envelopes with native speaker identities match a chosen ID. Text, names,
receipts, and narration do not establish relevance. Listening does not accept
an invitation, publish a reply, or choose how the Soul reacts.

Matching ambient events can wake an idle model in batches at most once per
five seconds, with no inference while the matching queue is empty. They do not
steer or restart an active inference. An otherwise-needed decision can observe
them sooner. The last actual ambient delivery timestamp is durable; an earlier
appointment/departure wake still takes precedence. Pending matching speech is
selected ahead of quiet bookkeeping, including after a new scope or restart,
so an older quiet row cannot hide it. Exact host-delivered IDs remain separate
from handling. A Soul should clear listening when it no longer intends to attend.

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
process owner. It restarts a killed controller with the same durable state,
waits for an abandoned lease to expire without stealing live ownership, and
stops on explicit failures. `--seconds` bounds the entire launcher lifetime,
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
cancels it. Due wakes are consumed only by a committed decision retained after
the deadline. The model still authors goals, activity choices and appointments;
this timer mechanism does not infer or schedule a social plan on its behalf.

Journal retention reserves separate pending capacity for owner messages
(1,000 events/8MiB) and world traffic (20,000/64MiB). A full page is rejected
atomically with its cursor unchanged; intake backs off while handling drains
space. Handled payloads target24h/2,000 records/16MiB, using periodic bounded
compaction. Pending-decision references are protected. Digests, event IDs,
handling outcomes and sequences survive compaction, so replay cannot turn an
already handled fact into new work. `storageStats()` and `maintenance()` expose
pressure and remaining maintenance. Identity/outcome, control and gap history
are still unbounded; these limits are not a total-disk-size guarantee.

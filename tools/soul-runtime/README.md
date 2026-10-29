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
while a turn is thinking. The native server's salience controls waking; lower
salience facts remain available for the next natural decision. No new server
importance classifier or LLM is introduced.

An event arriving during a turn conservatively invalidates its eventual action
and causes re-planning, even when steering was accepted. This currently adds
latency but prevents a completion race from executing an obsolete action.
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
Still required: retry/restart policy for this recovery, bounded retention,
robust retry/restart supervision, activity acceptance and long soak. App-server
is experimental; this runtime remains opt-in and unpublished until qualified.

`run.mjs --folder <already-paired-folder> --instruction <text-file>` starts the
opt-in controller; `--seconds N` bounds a development run. Ctrl-C/SIGTERM closes
owned hosts and listeners. `managed.mjs` backs off and restarts understood host
or transport failures, reconciling pending effects before inference; repeated
failure produces an explicit blocked status with task state retained. It does
not retry authentication failures or silently discard an uncertain operation.

Finite body actions and sustained activities differ. Walking has a terminal
receipt; reading/sitting can continue until replaced. A duration-based wait
uses `call.arguments={"seconds":30}`; the client records the calculated UTC
deadline, avoiding timezone arithmetic by the model. Retention gaps require an
explicit current-state resync before new writes. Resync never claims to recreate
missing history, and cannot erase an already-dispatched uncertain effect.

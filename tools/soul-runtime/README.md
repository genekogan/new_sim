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

Still required before use: transport integration, fenced controller ownership,
host delivery reconciliation, durable tasks/uncertain action reconciliation,
permission-constrained world tools, bounded journal retention, and real-agent
scenario acceptance. No connection to production should be made from this
foundation alone. A filesystem path is private runtime storage; never put a
credential or raw host transcript into the event journal. OS sleep stops local
execution; a durable record does not make a sleeping host available.

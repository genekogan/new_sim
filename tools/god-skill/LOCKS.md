# Lock contract (eden-lock/1)

All ownership inventories use `holder {pid, host, start, label}`, `heartbeatAt`, `ttlMs`, `liveness`, `stale`, and a break action. Host/start identity distinguishes recycled PIDs. The local process start is captured once. Other PIDs use `ps -o lstart`; if sandbox policy prevents that lookup, liveness is unknown and the bounded TTL applies. EPERM never proves a process dead. Remote machines are never probed over the network.

Local exclusive directories contain a private JSON `holder` record, acquisition time and nonce. Acquisition uses atomic mkdir; reclaimers serialize through a recoverable `.reclaim` lock and recheck inode and holder bytes. Release checks the same ownership and runs on normal exit. SIGKILL leaves a record which the next acquisition reclaims immediately after ESRCH (or at most the 30 s unknown-holder TTL). Live verified local owners remain protected. Legacy Chrome text is accepted during migration, with its existing live-PID protection.

| Ownership | Liveness | Break/recovery |
| --- | --- | --- |
| `/tmp/eden-chrome-lease`, `.1`, `.2` (Chrome slots: `CHROME_LEASE_SLOTS`, default 3; slot 0 is the old single lease, taken last; a slot failing other than busy is skipped) | process identity; 30 s unknown-holder TTL; a team-lease text holder keeps live-PID protection; the heartbeat also touches the directory (the team lease's 15 min mtime check) | next look or `doctor --fix` (every slot) |
| `.eden-god.look.json.lock` / keeper record | process identity, 5 s heartbeat, 30 s unknown-holder TTL | `look --stop` for a verified live keeper; doctor removes a stale record |
| `.eden-god.json.lock`, claim-file `.lock` | process identity; held only over read/modify/atomic rename | next save or `doctor --fix` |
| build lease / claims | caller identity, persisted server activity, world build pause TTL for unknown/remote holders | resume/take, pause/release, or doctor stale repair |
| verify probe | server process identity; 180 s operation deadline; pending physical retirement | server retirement; restart sweeps crashed probes before admitting another |

Workflow files (`.eden-god.json`, per-claim files and their saved steps) are durable state. They survive operator exit; they are not exclusive locks. The build session and claims likewise span multiple CLI invocations: normal command exit releases local write ownership, not the ongoing construction session. An authenticated doctor request lists these server leases without refreshing their activity. Stale build repair pauses the session; stale claim repair releases the claim. Neither deletes a build, edits its geometry, discards steps, nor takes a live lease. A pending native probe is never forcibly unlocked while its body is still present.

`node eden-god.mjs doctor [--fix] [--local] [--json]` includes free known lock slots, present local claim write locks, saved step pointers, and authenticated server ownership. It never prints credentials, raw workflow state, build lease values or token hashes. `--local` requires no server. Incomplete state-write temporary files are not locks and do not block recovery.

Look's wall-clock deadline includes discovery, lease wait (any free slot; the wait stops 10 s before the deadline and names every holder), keeper startup, navigation, settle and capture. It releases Chrome ownership even if browser launch/close hangs. Kept-shot child processes have a matching 30 s kill deadline.

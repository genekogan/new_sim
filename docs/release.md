# /worlds releases without visible downtime

`release.sh <stage>` uploads a release, then runs `activate.sh` on the box. The unit `sim-worlds@<stage>` runs the
**keeper** (`tools/world-launcher/keeper.mjs`). The keeper holds the port and runs the launcher from the release that
`/srv/sim-worlds/<stage>` points at.

## Shipping a release: ship.sh
`deploy/ship.sh --label <n>` runs a whole release in the proven order. Run it from the release worktree, clean, at
the gated head, with `node_modules` and `.lane/mars-web` in place. `<n>` is the release number without dots (353 for
3.53). The steps:

| step | what it does | its bar |
|---|---|---|
| preflight | local checks: clean tree, tools, Mars web assets, required dedicated release-probe god folder; prints the deploy lease | nothing missing |
| backup | `ship/compact-backup.sh` uses the row-verified compact-copy helper with `--keep-takes` for every production + legacy db, then `PRAGMA quick_check` | every copied row matches its source read transaction; every db `ok` |
| legacy-upload | `release.sh legacy` builds and uploads `we-<sha12>-root` without activating it | exit 0 |
| probe-start | `release-probe.mjs` in the background (desktop + phone, CLI edits, `--expect-build`); waits for `probe/ready` | ready within 10 min |
| release | `release.sh production --reload` | exit 0 |
| legacy-activate | `sha256sum -c FILES.sha256`, `activate.sh legacy … --reload`, then the laptop's `LEGACY-RELEASE` | exit 0 |
| released / probe-check | touch `probe/released`; the probe watches 60 s more | exit 0 (1 = visitor bar missed, 3 = rolled back) |
| walks | `ship/walk.mjs`: 7 worlds at desktop dpr 1+2, 3 worlds on a phone | 17 arrivals, 0 errors, 0 resync, picks ok |
| poster | `ship/poster.mjs` x3 on Eden 2026 (phone) + `poster-count.py` | a world frame every run, never blank after it |
| stall | `ship/stall.mjs` x4 on Eden 2026 (phone) | no frame gap over 1 s |
| cdn-walk | `tools/cdn/cdn-walk.mjs` on Eden 2026, /w/mars, /w/eden | PASS |

`ship/checks.mjs` gives each step's verdict. Outputs go to `team/scratch/ship/<n>/`: `STEPS.txt` (one line per step),
`ship.log`, `ROLLBACK.txt`, and each step's logs and shots. Any failure stops the run. ship.sh then prints what is live
at that moment, the rollback commands (the previous production and legacy releases, read before the first change), and
the `--from <step>` that resumes it. It never rolls back on its own: `activate.sh` already does that for a failed
handover, and the probe's exit 3 says it happened.

- `--dry-run` prints every step with its exact commands. Nothing runs, and eden2 is not contacted. It exits 1 when
  preflight would stop a real run.
- `--exclude-world <slug>` omits that registered world from desktop and phone arrival walks when the user has explicitly excluded it. It prints the exclusion and recalculates the arrival count; unknown/duplicate slugs fail. Record the reduced coverage in SHIP-LOG. Other release steps remain mandatory.
- `--from <step>` resumes after a fix (same `--label`, same outputs). `--no-probe` skips the three probe steps.
- The legacy handover itself is `activate.sh`'s job. ship.sh only calls it, so changes to the handover (keeper,
  `children.mjs`) reach ship.sh without touching it.
- The release owner still does the lane-specific live checks, the fast-forward of main and the push, the SHIP-LOG entry and RESUME.
- Tests: `node --test tools/world-launcher/ship.test.mjs` stubs every command (`SHIP_TEST=1`, `SHIP_SSH`, `SHIP_SCP`,
  `SHIP_NODE`, `SHIP_PYTHON`, `SHIP_RELEASE_SH`).

`release.sh` never prunes remote or local releases. Rebuilding a local artifact moves its previous copy to a unique
directory under `~/.Trash`. Destructive retention on eden2 remains a separate operation requiring Gene's approval.
A same-build remote upload is reused only when `RELEASE-MANIFEST.json` matches the new assembly and every artifact,
symlink and file mode still matches that manifest (installed `node_modules` are excluded). Missing manifests,
partial uploads and changed/extra artifacts are retained and refused; use a new commit/build instead of deleting or
overwriting them. Focused checks: `node --test tools/test-harness/release-no-delete.test.mjs`.

To use builds produced on Modal, set `SIM_PREBUILT_WEB_ROOT` to a directory containing `<build>/dist` and
`<build>/WEB-BUILD.json` for both `we-<sha12>` and `we-<sha12>-root`. The receipt is sealed by `prebuilt-web.mjs`
after building and precompressing on Modal. Installation requires the exact full source SHA, build ID, base path,
CDN flags/origin and Eden world pin; every artifact hash is checked before and after copying. The normal prefix,
CDN and world-pin release checks still run. Without the variable the existing build path is unchanged.

## Release-probe world (one-time setup, then every release)
The probe's CLI edits go to its own world, **release-probe**: an unlisted scratch world, flagged test, with no Soul a person
owns. Releases never write to bench-hamlet again (it holds Kwyjibo). ship.sh's god folder is
`<team>/runtime/t4-bench/release-probe` (`SHIP_PROBE_CLI` overrides it). If that folder is missing,
preflight stops before any remote command. There is no fallback to another world.

R does the setup once, on eden2, after a release that carries `op.mjs god-approve` (lane OPS2) is live:
1. `node tools/world-launcher/op.mjs create-world --port 4620 --base /worlds --name "Release probe (scratch)" --template hello-hamlet --owner-of bench-hamlet --slug release-probe --unlisted`
   (`--unlisted` and `set-unlisted` come from lane QA2. If the live op.mjs does not have them yet, leave `--unlisted` off,
   and once QA2 is live run `op.mjs set-unlisted --port 4620 --base /worlds --slug release-probe --unlisted true`.)
2. `node tools/world-launcher/op.mjs set-test --port 4620 --base /worlds --slug release-probe --test true`
3. On the laptop: make the folder, then in it `node <repo>/tools/god-skill/eden-god.mjs register https://sim.eden.art/worlds/w/release-probe/`
   and `node <repo>/tools/god-skill/eden-god.mjs pair` (it prints a `#godpair/<code>` link and waits). On eden2:
   `op.mjs god-pending --port 4620 --base /worlds --slug release-probe` lists it, and
   `op.mjs god-approve --port 4620 --base /worlds --slug release-probe --code <code>` approves it for the world's owner;
   `pair` then exits holding the god token. No signed-in step. Never open the folder's `.eden-god.json`.
4. Live check of the operator TEST-Soul commands: a test agent asks to join release-probe as `TestProbe` (no window code);
   `op.mjs soul-pending --slug release-probe` lists it with `test: true`; `soul-approve --request <ap_…> --name TestProbe`;
   the agent's poll holds a Soul token; `soul-message --soul <s_…> --name TestProbe --text "walk to the well"`, the agent
   acks it, `soul-inbox` shows `acknowledged`; `soul-delete --soul <s_…> --name TestProbe`. `op.mjs audit --slug release-probe`
   shows every call `by: operator`, never the message text.

Guards (op-souls.mjs, apps/server/src/op-souls.ts): operator Soul and god commands are loopback only, on worlds flagged
test (registry `test: true` or `<data>/op-test-worlds.json`), never a product world or an old-world fork. Souls are
approved only for TEST names (`Test…`/`test-…`) as the synthetic account `op:test-operator`. Kwyjibo is refused by id and
name, plus anything in `<data>/op-deny-souls.json`. `god-approve` is also refused while any live Soul in the world belongs
to anyone but `op:test-operator`, and it never claims an unowned world.

## What a release does
1. `activate.sh` points the stage link at the new release, keeping the old one as `<stage>.previous`.
2. It runs `systemctl reload sim-worlds@<stage>` (SIGHUP to the keeper), which starts the handover:
   - **prepare**: the running launcher finishes any world creation, holds new boots and registry writes, and lists its
     running worlds.
   - **start**: the new launcher starts and adopts those worlds. It proxies to them and boots nothing yet.
   - **switch**: new connections go to the new launcher. The old one forwards whatever still reaches it, answering with
     `Connection: close`, so each of its connections ends cleanly after its next response. It does not close idle
     connections at the switch: Caddy may be sending a request on one at that instant, and a POST lost that way cannot
     be replayed (a 502 page). Connections still idle close when the old launcher exits. In steady state the launcher
     keeps idle connections 130 s, longer than Caddy's 2 min, so Caddy closes them, never the launcher mid-request.
   - **take over**: one world at a time, the old launcher stops the world (it saves a snapshot and its process exits),
     then the new launcher boots it on the same data. Requests and viewer sockets for that world wait for it; they do
     not fail. A world never has two writers.
     - **pre-warm**: before the old process stops, the new launcher starts the world's next process in standby
       (`SIM_STANDBY=1`, `apps/server/src/standby.ts`): it loads all its code, then waits for SIGUSR2 without opening
       its database or port. The world keeps serving from the old process meanwhile. After the stop, SIGUSR2 makes it
       open the data and listen, so the pause is the stop plus opening (measured locally 0.3-0.6 s per world instead
       of 1.1-1.7 s). If standby fails, that world boots cold, as before. `SIM_PREWARM=0` (keeper env) turns it off.
       A standby process takes 230-240 MB (new worlds and the eden/mars forks alike, Node 22). A world is pre-warmed
       only when the unit has at least 768 MB under its cgroup memory limit (MemoryHigh 5G / MemoryMax 6G on eden2)
       and the host has that much available above `--min-free-mb`; otherwise it boots cold and `activate.sh` says why
       (`SIM_PREWARM_NEED_MB` changes the 768).
     - **canary**: the first world (not an old-world fork) moves first and must also answer `/v1/config`. If it cannot,
       nothing else moves: the old launcher serves again and boots that world on its own code, requests that waited
       for it are forwarded there, the new launcher exits, and `keeper.json` says `rolled-back`. Only that world paused
       (about 1.5 s locally); no reload, no error page. `SIM_HANDOVER_CANARY=0` (keeper env) turns it off.
   - **exit**: the old launcher finishes its last responses and exits.
3. On `rolled-back` (canary failed) `activate.sh` points the stage link back to `<stage>.previous`, prints the canary
   world's log tail and exits 1: the previous release never stopped serving. Otherwise the same checks as before run: the health check must report the new build, and every registered world must
   answer. If either fails, the stage link goes back to `<stage>.previous` and the unit is reloaded again, which runs
   the same handover in reverse. If that reload fails, the unit is restarted.

If the new launcher fails before the switch, the old one carries on untouched. If a world cannot boot on the new
release, `keeper.json` reports it, the world stays down rather than run twice, and the rollback brings it back.

The keeper writes its state to `<data>/keeper.json`: keeper pid and sha, the active build, and the last handover with
each world's time.

## When it is a restart instead
`release.sh --reload` (and `activate.sh … --reload`) hands over even when the release carries a changed `keeper.mjs`:
the running keeper stays and runs the new launcher (pre-warm works; the canary needs the new keeper, which takes effect
at the next restart). Use it to ship a keeper change without a full restart.

After a `--reload`, keeper.json still names the old keeper's sha, so the next release with an unchanged `keeper.mjs`
would also restart: keep passing `--reload` until a planned `--restart` at a quiet time installs the new keeper.

**A restart without the error page** (optional, `deploy/sim-worlds@.socket`): with the socket unit enabled for a stage,
systemd holds the port, so during a restart new connections wait in the socket's backlog instead of being refused (no
Caddy 502 page; requests wait for the new keeper, 1-1.6 s locally) and viewers reconnect as in a handover. Switching
it on is itself one last restart (commands in the unit file's header). Measured through a Caddy stand-in under a
POST/GET storm: restart without the socket 181 refused requests (502) per restart, with it 1 (a request in flight on
the stopping launcher).

`activate.sh` restarts the unit (all worlds blink, as before) on the first install of the keeper, when the release
carries a changed `keeper.mjs`, or when given `release.sh --restart`. A change to the unit file or to
`/etc/sim-worlds/<stage>.conf` (port, data, caps) also needs `--restart`, because the keeper keeps the arguments it
started with.

## What a viewer sees
The page and the API never get a refused connection, so there is no proxy error page. Each world's viewer socket
drops once, while that world moves; the viewer reconnects by itself. "Reconnecting…" appears only after 3 s down
(`viewer-arrival.ts`). A page running the previous bundle keeps running. It reloads at once only if the protocol
changed; otherwise it swaps bundles after the tab has been hidden for a minute (`useSim.ts`).

## Measuring
`deploy/swap-probe.mjs --origin http://127.0.0.1:<port> --base /worlds --slugs a,b --out probe.json` GETs the homepage
and each world every 100 ms. It holds one viewer socket per world and reports, per target, refused connections, 5xx,
the longest error run, the slowest request, and how long each world's socket was down. `--posts` adds a POST per
world (to an unknown route; any 4xx counts as answered), which is what catches a connection closed under a request.
Locally, put a reverse proxy with Caddy's transport defaults in front of the keeper and probe through it: the proxy's
502s are exactly what a visitor would see (lane W rig: `team/scratch/r31w/`).

## Nightly backups: versioned (restic)
`sim-worlds-backup@<stage>.timer` (03:30 UTC) runs `deploy/backup-restic.mjs backup <stage>` as `simworlds`. It is separate
from ship.sh's compact backup, which a release still takes first. Each night it:

1. copies `accounts.sqlite`, `forks/accounts.sqlite` and every `worlds/<slug>/sim.db` with SQLite's online backup API
   in one step, so the copies are consistent while the worlds run, and runs `PRAGMA quick_check` on each copy;
2. adds `worlds.json`, `audit.jsonl` and the uploaded files in `worlds/assets` (backup.mjs never had these). It copies
   only files that are new or changed into the mirror at `/srv/sim-worlds-backups/staging/<stage>`;
3. takes one restic snapshot of that mirror into `/srv/sim-worlds-backups/restic`, tagged `<stage>`;
4. **deletes** old snapshots: `forget --prune` keeps 7 daily, 4 weekly and 6 monthly snapshots per stage
   (`SIM_BACKUP_KEEP`; `off` skips this step, so nothing is deleted). Then `check` reads a seventh of the data, so all of it is read once a week;
5. copies the snapshots off the box to `SIM_BACKUP_OFFSITE` (an R2 bucket) and applies the same retention there.
   This step runs only when that setting is present.

The script exits 1 if any database fails its check; the other databases are still snapshotted. host-health flags it.

Until restic is set up (no `restic` binary, no password file, or no repository), each run takes the old dated copy
instead (`backup.mjs`, newest 3 nights in `/srv/sim-worlds-backups/<stage>/YYYYMMDD`) and says so on its first line, so
shipping this before the one-time setup never costs a night.

Restic stores only the chunks it has not seen before, compressed. The copies keep the live file's page layout, so
unchanged pages are byte-identical from night to night. Measured on 15 real eden2 backups (lane BK, 2026-10-20):
~13 MB a night for production + legacy, against ~260 MB for a dated full copy. Retention caps the repository at ~240 MB
at today's sizes. The floor is set by each world's 5 MB whole-state JSON snapshot, which it rewrites every 5 minutes.

Settings live in `/etc/sim-worlds/backup.env` (`backup.env.example`). The repository password is
`/etc/sim-worlds/restic.pass`, root:simworlds 0640. Without that password the backups cannot be read. The script
never creates a repository: if the disk or the path is missing, it fails instead of starting an empty one.

- Restore (one command; never overwrites a non-empty directory; quick_checks every database, exit 1 if any is bad):
  `node /srv/sim-worlds/production/tools/world-launcher/deploy/backup-restic.mjs restore production <latest|YYYY-MM-DD|id> <empty dir>`.
  The directory is laid out like `/srv/sim-worlds-data/<stage>`. `... list [<stage>]` shows the snapshots.
- Boot one restored world locally: `ENABLE_WORLD_ENGINE=1 SOUL_LIFECYCLE=1 node tools/god-skill/dev-world.mjs <slug> <port> --data <dir>/worlds/<slug>`.
  Without `SOUL_LIFECYCLE=1`, which the launcher sets, a production world's history refuses the engine
  (`+crew-removal/1`).
- Put a world back live: stop it, swap its `sim.db` for the restored one, start it. Only R does this.
- Rollback to the dated full copies: point the unit's ExecStart back at `deploy/backup.mjs` (kept in the tree).
- Tests: `node --test tools/world-launcher/backup-restic.test.mjs` (real restic; it skips when restic is not installed).
- eden2 has restic 0.16.4 from apt; the script uses only flags that 0.16 has.

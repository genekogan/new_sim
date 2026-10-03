# Runbook (production on eden2)

Sim runs on the eden2 Hetzner box (<eden2-ip>, `ssh root@eden2`) next to the
eden3 alpha and mars-mcp, and touches neither. Root on that box is shared with
a second admin, so every secret there is readable by both.

| Thing | Where |
|---|---|
| Production | `sim.service` (`User=sim`), `127.0.0.1:4500`, https://sim.eden.art (also https://<eden2-sslip-host>) |
| Mars | `sim-world@mars`, port 4502, `/srv/sim-data/mars/sim.db`; staging `sim-world-staging@mars`, port 4512, separate staging file |
| Staging | `sim-staging.service`, `127.0.0.1:4501`, fake brain, own data in `/srv/sim-data-staging`, https://<staging-host> |
| Code | `/srv/sim/releases/<build>`; `/srv/sim/current` → production, `/srv/sim/staging` → candidate, `/srv/sim/previous` → what production ran before the last deploy. Rsynced from a laptop; the box has no GitHub credentials. The 5 newest releases are kept |
| Data | `/srv/sim-data/sim.db` (SQLite, WAL) + hourly `backup-YYYYMMDDHH.db` (6 hourly + 7 daily) |
| Replication | `litestream.service` → R2 `s3://<bucket>/sim/litestream/sim.db`, 10 s sync, 7-day retention; config `/etc/litestream.yml`, credentials `/etc/litestream.env` (root 0600) |
| Watchdog | `sim-watch.timer`, every minute: restarts `sim` if the tick has not advanced on two consecutive checks (unless paused); logs if Caddy is down |
| Env file | `/home/sim/sim.env` (0600). Must set `PORT=4500`, `HOST=127.0.0.1`, `DATA_DIR=/srv/sim-data` (the only writable path for the unit) and `PUBLIC_URL`; plus `ADMIN_EMAILS`, `BRAIN_MODE`, `BRAIN_BUDGET_USD_PER_DAY`, optionally `COMPILER_MODEL` and `TALK_MODEL`, the Privy app id/secret, TypeSafe and Anthropic keys. It also holds the `R2_*` credentials used for verified take archives (only under the existing Sim prefix). Staging: `/home/sim/sim-staging.env` |
| Caddy | `/etc/caddy/sites/sim.caddy`, pulled in by one `import sites/*.caddy` line at the end of `/etc/caddy/Caddyfile` |
| DNS | `sim.eden.art` A record in Route53 (Gene edits DNS) |

## Living-camp activation boundary

`ENABLE_LIVING_WORLD` activates the non-Toy persistent world day; see MERGE-LOG for the
current deployed setting. The playback release understands camp
checkpoints before activation, so it is the compatible code rollback for the subsequent
living-camp milestone. Enable in each non-Toy per-world env after qualification; never in the shared Toy env. The day is 72,000 engine ticks, with
quiet resumable checkpoints, fresh Runtime at first light, private journals and no
activity timetable. Recovery receipts hold a private checkpoint/suffix recipe, exposed
publicly only as card fault counts; three faults quarantine a card.

Take archival requires `ARCHIVE_TAKES=1` in the per-world env; local development
is off by default. Staging must use `R2_PREFIX=sim/staging` with its own data,
never production's take keys. Take chunks keep a rolling 24-hour buffer in compressed SQLite storage (measured
camp ~13 KB/s). Completed five-minute segments are compressed in a worker and
archived under `${R2_PREFIX}/takes/<world-id>/<segment>.json.gz`; manifests stay in
the world database. Upload, metadata receipt and SHA-256 read-back must all pass
before old local chunks are removed. An R2 outage retains local history; recent
rewind needs no R2 request. Older pages verify the manifest checksum before decoding.
The actual R2 proof uploaded/read back 299 camp chunks: 3.84 MB local gzip to
2.78 MB archive. Preserve the take objects alongside the SQLite backup when restoring.
Code rollback to the playback release remains state-compatible, with local rewind
only; re-promoting the archive reader restores older rewind without a data restore. The model ledger is independent of trace pruning and budget changes. Unknown
model prices refuse admission; uncertain transport failures retain the reservation.

## Published Mars registry delta

The browser Lab includes computer workshop and library reading. The additive
registry advances activities29→31. Existing runtime checkpoints retain their
physical state; the successor restored and advanced an old rest checkpoint exactly.
Previously exported bound plans should be rebound against the new registry stamp.
The two composites remain non-resumable while active and are not automatically
started in the persistent camp. They use its ordinary admission/release contracts.

## Owner mandate controls

In a living world, POST `/v1/souls/<id>/mandate` with `{words, strict, id?}` adds
or edits one private rule. GET lists it; DELETE `/v1/souls/<id>/mandate/<rule-id>`
removes it. Ownership is enforced. Paired agents use the corresponding
`/v1/agent/mandate` routes or MCP `soul_steer`, `soul_mandate`, `soul_remove_rule`.
The same endpoints work under the world's API prefix. Existing command and
structured-intent APIs become mandate changes in living worlds; toy keeps its old
command/intent behavior. Rule count is bounded at 24 per Soul. Alignment failure
leaves the rule unchanged. NOW has precedence; a ten-minute unplayable next card
reports blocked, and a newer NOW reports its predecessor replaced. Other triggers
only request thinking. Strict reports are bounded to one per world day.

Owner words and rule internals live in accepted private events/checkpoints, never
public kernel/log views. Preserve the database for rollback. The previous camp
release cannot redact/fold new mandate events. The rollback compatibility guard
refuses any older reader once mandate events exist; choose a mandate-capable
release. Before any such events exist, the preceding camp release remains valid.
Never restore data to erase steering. Successful model replies without a valid usage receipt retain the paid
reservation; investigate the receipt rather than forgiving cost automatically.

## Operations

```bash
infra/deploy.sh --stage         # checks/build → staging + browser proof
infra/deploy.sh --promote BUILD # promote that exact qualified staging release
infra/rollback.sh [<build>]    # production back to /srv/sim/previous (or a named release); running it twice swaps back
ssh root@eden2 'systemctl status sim sim-staging litestream sim-watch.timer --no-pager'
ssh root@eden2 'journalctl -u sim -n 100 --no-pager'
ssh root@eden2 'systemctl restart sim'     # SIGTERM saves a snapshot first; clients reconnect on their own
ssh root@eden2 'bash /srv/sim/current/infra/box-setup.sh'   # idempotent: units, Caddy site, watchdog, Litestream
```

Deploy never flips production if staging fails to start on the new release or
reports a different build id; the rejected release is removed and staging is
pointed back at production's release. Deploy requires a clean committed release. A restart reloads from the latest snapshot and
fast-forwards through later events; open pages reload themselves when the build
id changes.

Admin dials (pause, clock rate, brain live/fake, budget, narrate now, snapshot,
invite codes, connected clients) are in the web app's **admin** tab; cost is in
the **spend** tab. Both need an email listed in `ADMIN_EMAILS`.

## Check that the log still explains the world

`infra/verify-kernel.ts` replays the kernel from the event log (no engine stepping,
no models, read-only) and compares the result with the live server's kernel hash:

```bash
ssh root@eden2 'cd /srv/sim/current/apps/server && sudo -u sim node /srv/sim/current/infra/verify-kernel.ts /srv/sim-data/sim.db http://127.0.0.1:4500'
```

It prints the event counts and `MATCH`, or the things and links that differ. First
run, 2026-10-01: 11,939 events replayed in 35 ms and matched. Run it after any
deploy that touches `packages/kernel` or `apps/server/src/fold.ts`.

## Restore from R2

Tested 2026-09-30: the restored copy was one event behind live, integrity ok.

```bash
ssh root@eden2 'set -a; . /etc/litestream.env; set +a
  systemctl stop sim litestream
  mkdir -p /srv/sim-data/bad && mv /srv/sim-data/sim.db* /srv/sim-data/bad/
  litestream restore -o /srv/sim-data/sim.db "s3://$R2_BUCKET/sim/litestream/sim.db?endpoint=$R2_ACCOUNT_ID.eu.r2.cloudflarestorage.com&region=auto"
  chown sim:sim /srv/sim-data/sim.db; systemctl start sim litestream'
```

For a smaller loss of state, an on-box `backup-*.db` can be copied over `sim.db`
the same way.

## Caveats

- The R2 key is eden3's media-bucket writer key, used under the `sim/` prefix. It
  can write anywhere in that bucket; a dedicated bucket and key would be safer.
- An eden3 deploy or bootstrap may rewrite `/etc/caddy/Caddyfile` from its repo
  copy and drop the `import` line. If the Sim sites stop answering after one,
  rerun `box-setup.sh`.
- After any reboot: `systemctl is-active caddy sim sim-staging litestream`
  (Caddy races Docker at boot on this box; see the eden3 runbook).
- Model spend is capped by `BRAIN_BUDGET_USD_PER_DAY` (0.5 in production). When a
  tier's share is spent, a busy Soul waits, an idle Soul takes a free built-in
  choice, the narrator and director skip, and typed commands ask to retry.
- The budget and the brain mode set in the admin tab last until the next restart
  (the env file is the default). Clock rate persists.
- Pairing codes, pending approvals and agents' `wait` calls live in memory: a
  restart or deploy cancels them, and agents mid-pairing must start again.
- Privy's free tier ends at 499 monthly users.
# Eden4 successor milestone — 2026-10-03

Canonical checkout is `<repo>`; `<old-sim-repo>` stays in place.
Mars engine is required in-repo at `mars/viewer/engine`. No production
dependency on Gene's original Mars checkout or MARS_ENGINE_DIR.

Release flow: `infra/deploy.sh --stage`, review its browser proof, then
`infra/deploy.sh --promote <build>`. Each release is committed first; the
stage receipt pins the same build. If `pnpm check` just passed for this code,
the lead may set `SIM_CHECKS_ALREADY_PASSED=1` with its logged proof to avoid
rerunning three minutes of unchanged engine tests. Smoke always runs on stage.
Browser cache must be explicit (see E2E.md). Deployment does not run box-setup.

| World | Production | Staging | Data | Unit |
|---|---|---|---|---|
| Toy | 4500 | 4501 | `/srv/sim-data/sim.db` | existing `sim` / `sim-staging` |
| Mars | 4502 | 4512 | `/srv/sim-data/mars/sim.db` | `sim-world@mars` / `sim-world-staging@mars` |

Toy's existing units remain selected to preserve its data/service identity;
new worlds use the template. Per-world env overrides live in
`/home/sim/worlds/` and contain the verified owner ID, port and data directory.
No DEV_AUTH on a public host. All stage minds are fake. World API and WS
prefixes are `/w/<id>/`; original root toy API aliases remain compatible.

`/l/mars` and `/w/mars/2020`…`2027` are the original static app. Large
campus derivatives are streamed through a restricted same-origin proxy to
the existing public Worker; no Worker/DNS edits. Never run the original
Mars prepare script against archive symlinks. Current takes/baselines are
vendored, and historical release packaging needs its separate fixture cache.

Ops receipts/consistent pre-release toy backup: `/srv/sim/ops/<build>/`.
Rollback: preserve new-world data, flip `/srv/sim/current` to the previous
release, restart toy and any world supported by that release; if reverting
to pre-merge Sim, stop Mars and restore `caddy.before-promote` from the
receipt before validating/reloading Caddy. Do not restore the toy DB unless
Gene explicitly authorizes a destructive data rollback. `infra/rollback.sh`
handles code/service rollback only. Keep at least the rollback release.

Snapshots now defer non-resumable activities instead of dropping them.
Compaction from WorldState is separately proven only when every controller
has released. `eat` and `hold_items` in this alpha are resumable. Server
TakeRecorder chunks render with TakePeople; no browser Runtime on live pages.

---

The host accepts the qualified activities29 checkpoint under activities31. Unknown
physics versions still replay from genesis. This additive upgrade keeps restarts brief.

## Four persistent worlds

Production ports: Toy 4500, Mars 4502, Little Martians 4503, Eden 4504.
Staging ports: 4501, 4512, 4513, 4514. Each non-Toy world uses its own
`sim-world@<key>` unit (or `sim-world-staging@<key>`), SQLite file under
`/srv/sim-data/<key>` and root-owned 0640 env under `/home/sim/worlds`.
The template inherits Sim's model, Privy and R2 settings, then overrides the
world key/id, owner, data, port and public path. Staging is always fake and its
archive prefix is `sim/staging`. New-world owner IDs are resolved from the
existing single administrator in the Toy DB and never logged. Per-world model
admission retains the existing stricter $0.50/rolling-24-hour budget.

Deployment health and ten-route browser smoke cover all four processes and the
static Lab/year mounts. The watchdog watches all four production clocks.
Promotion takes consistent on-box backups for every existing world DB; Litestream
adds distinct `sim/litestream/{mars,littlemartians,eden}.db` replicas. Take archives
remain separated by world ID. No Eden3, Mars service, Worker or DNS change.

Rollback is code-only. A release lacking the new world definitions stops the
Little Martians/Eden units and preserves their DBs; its older Caddy route exposes
only its supported worlds until the new release is restored. Private mandates
require a mandate-capable rollback: `rollback-compatible.py` checks all four DBs
before any symlink or service changes. Never reset or restore a production DB to
make old code accept it. The world route/API prefix must match its process.

New-world release proof (October 3): Little Martians completed the 48-day fake soak with zero physical recovery and bounded memory; paid proof $0.014983694, server stopped. Three paused Lab snapshots passed actual movement, Play/Pause, Reset and exact initial-state reload. Sim/46 server tests and 1542 Mars engine tests passed; 6 skips/11 TODOs remain upstream. Full Mars gate is reserved for tranche end.

Toy observer release: all four live worlds now have shared 3D playback. Toy retains its original rules/checkpoint format and database. Deploy ensures `ARCHIVE_TAKES=1` in the two Sim process envs, preserving other settings; staging prefix is `sim/staging`, production uses existing scoped R2. This starts recording from the release, without inventing earlier physical takes. 47 server tests, 1542 Mars tests and actual loaded-model selection/follow proof passed.

## Finite camp construction

`build_lookout` phases are finite physical jobs. The accepted leader reserves the
required free ground crew; normal stop requests drain the committed phase before
releasing it. Carrying/raising is not a resumable checkpoint; state resumes by
checkpoint plus logged choices until an ordinary quiet point. A lowering-only
raise codec must not be treated as admitting held or raising states. Unsafe job
failure goes through the existing accepted-baseline fault recovery.

Once any minted card or accepted decision uses `build_lookout`, code rollback must
choose a release with `packages/engine-mars/src/construction.ts`. Never reset a
world database to make an older reader work. The controller-only release precedes
autonomous construction cards to retain that compatible rollback.

The camp pack now offers four finite construction phases to every Soul. Installing
the pack logs normal mint/deck events; existing vocabulary and physical progress
are preserved. A quiet restart does not replenish building parts or dismantle work.
Monitor physical support/part states alongside card choices: a crew refusal is
ordinary admission, while a recovery receipt or stuck quiet barrier needs review.
The controller release `5d3b69c90078` is the compatible rollback for these cards.

A native `sleep` purpose may retain interrupted work indefinitely for explicit
Resume in the Lab. After a logged `rules.runtimePolicy:{sleepBlockTicks:1200}` activation, a sleep
diagnostic blocked for one minute in a persistent body card is cancelled through its ordinary exit and reported as `activity.blocked`.
This prevents an interrupted sleep from stranding a quiet barrier. No native
sleep codec, Lab behavior, or world data is rewritten.

Deploy a policy-capable reader before activation. Prior snapshots without the
policy and replay before its event retain original behavior. The read-only rollback
guard rejects a reader lacking `configureRuntimePolicy` once that event exists.

The activation release logs this policy once on non-Toy living-world startup.
Its compatible rollback is `4919298` (construction pack plus policy reader).
Check recent checkpoints and `living.lastDay` after an interrupted sleep; a
policy receipt should exist once per world, and no policy event exists in Toy.

Native Mars gate fixtures may be hydrated from selected published derivative
URLs in an isolated ignored test checkout. Never deploy that checkout or copy
raw photos, Blender projects, SDK/vendor or the asset archive. The fork's
legacy photo/Blender links point to `sim.mars.college`; runtime GLBs remain
local or available through the allowlisted Sim proxy. Native full-gate and
focused repair receipts are kept separately in MERGE-LOG, without rerunning
passing long browser scenarios after an unrelated packaging repair.

For a quiet barrier blocked by a seat exit, inspect live `sit`/`take_slot`
`stand-up` records and free bystanders before treating it as a card failure.
`quietSeatCourtesy:true`, when explicitly logged with the sleep policy, lets
completed social holds drain and uses native legal `makeWay` walks to clear
the exit. Active programs and borrowed construction actors are protected.
Deploy a courtesy-capable reader before logging the flag. The rollback guard
refuses older readers once that event exists; never remove the policy event or
rewrite production state to make an older rollback fit.

Courtesy activation logs one additional policy event per existing living world,
with both `sleepBlockTicks:1200` and `quietSeatCourtesy:true`. Restart must not log
another courtesy activation. Toy receives none. Reader `9e78ee416a79` is compatible
with the new flag; the earlier sleep-only reader is not.

On graceful shutdown, an unsnappable controller leaves the last safe snapshot
intact and logs `rules:{checkpoint:"unsnappable-head"}` at the current tick.
That accepted marker is the replay destination; do not force a snapshot or
rewind the database to avoid replay. Periodic snapshot retries stay quiet.
Unexpected process loss resumes at the last durable accepted tick, so treat
recorded takes as depiction rather than a substitute event-log replay cursor.

Native gate fixture preparation also needs the three licensed JPEGs under
`public/modular/environment/ground-{color,normal,roughness}.jpg`, committed
`worlds/` mounted as ignored `public/world-assets`, and the matching installed
Draco decoder at `public/mars-assets/draco`. Use an isolated ignored checkout
and never deploy it. Missing JPEGs can draw black ground without failing an HTTP
request because Vite's fallback returns HTML; validate image headers. Exact
fixture receipts and focused original-baseline comparisons are in MERGE-LOG.

The Sim Node adapter installs the native SHA-256 provider for content addressing.
It produces identical UTF-8 hashes; the browser/Worker default stays portable.
No rules version or checkpoint migration is required. Hash equivalence and a
full engine suite with the native provider precede release. Keep soak timing
thresholds intact; CPU measurements are evidence, not permission to weaken them.

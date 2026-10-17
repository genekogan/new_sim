# Old worlds on eden2 (lane CLOUD2 2026-10-11; KIT 2026-10-15; kit v2 on the current release by lane L2 2026-10-17)

These files move /w/eden, /w/mars, /w/littlemartians and the root site from the laptop writers to eden2.
The run copies are in `<team>/runtime/sim-old-cloud/bin/`, which is where the scripts expect to run.
Status, rehearsal evidence, Gene's runbook: `team/lanes/t3-d2-laptop-exit.md` (v2) and `team/lanes/t3-kit.md` (v1).

## v2 (L2): the original worlds on the current release
- eden2 runs them in a world-launcher stage of their own, **`legacy`**: unit `sim-worlds@legacy` (the existing template, its own
  cgroup and memory limit), port 4670 (the port the Caddy switch already used), worlds on 4660-4662, data
  `/srv/sim-worlds-data/legacy` (`worlds/<key>/sim.db`, `forks/{descriptors,artifacts,accounts.sqlite}`), settings
  `/etc/sim-worlds/legacy.conf`. The launcher runs with `--old-worlds-root`: only the forks eden/mars/littlemartians (the same
  old-world fork mode as `/worlds/w/<key>` since Oct 11, `fork-world.mjs`), at `/w/<key>` exactly where the laptop served
  them, the root web build's "Sim" world list at `/`, root paths routed like the laptop proxy, and no world creation.
- Release: `tools/world-launcher/deploy/release.sh legacy` builds the web for `/` and uploads `we-<sha12>-root` to
  `/srv/sim-old/releases/` with `FILES.sha256` (never install.sh, never activated there, never pruned by /worlds releases).
  The run copies' `bin/LEGACY-RELEASE` names the build cutover.sh expects.
- `legacy-stage.sh` (in the release, run on eden2 by cutover.sh): `check`, `setup` (idempotent), `start` (empty launcher),
  `register` (the three worlds, not claimable), `stop`, `status`. `LG_SCRATCH=1` is the rehearsal twin under `/srv/sim-old-l2`
  (transient unit, ports 6320-6323); `legacy-rehearsal.sh up|down|purge` drives it.
- Redirect switch (off): `/srv/sim-worlds-data/legacy/redirects.json`, see `tools/world-launcher/redirects.mjs` and
  `legacy-redirects.sh`. Only page loads of `/`, `/w/<key>`, `/w/<key>/` are redirected (302); `?stay=1` keeps the original.
- Later code updates of the legacy stage: `release.sh legacy`, then on eden2 `ln -sfn <release> /srv/sim-worlds/legacy` and
  `bash <release>/tools/world-launcher/deploy/activate.sh legacy <release>` (keeper handover, no visible downtime).
- `rollback.sh` stops `sim-worlds@legacy` instead of the sim-old units; everything else as v1 (below).
- Not used by v2: `pack-release.py`, `verify-release.py`, `run-world.mjs` on eden2, `port-map.mjs`, the sim-old units
  (v1 artifacts; the laptop side of rollback still uses `run-world.mjs` and the 1080cfa9 descriptors).

## v1 (KIT, 1080cfa9 copies)
- `pack-release.py` assembles `so-<source8>-<overlay8>` from the live laptop runtime (`team/runtime/convergence-1080cfa9`):
  sealed source, web dist, Soul CLI/skill/guides, Mars static, Eden artifacts, the three live descriptors and the live
  `PROXY.json` with only their path fields rewritten for eden2, plus `CONTENT-MANIFEST.json` next to `input/`.
  `verify-release.py` re-checks every file against the live seals (run it on eden2 after upload; cutover preflight runs it).
  `install-deps.sh` installs the server closure on eden2 as simworlds and links it at the tree root.
- `run-world.mjs` is the eden2 (and laptop rollback) runner: the live runner's server entry points and option mapping,
  with gates for Clerk/registry env, no dev auth, history prefix and Soul rows unchanged by boot, sole listener.
- `port-map.mjs` is a preload. The sealed servers and proxy only accept the laptop ports (4950/4963/4964, proxy 4970;
  the only config escape, `basePath`, changes worldPath/publicUrl), so the preload moves them to 4660/4661/4662 and 4670.
- `sim-old@.service` and `sim-old-proxy.service`: systemd units as user simworlds, data in `/srv/sim-old-data/<world>`.
- `compact-copy.py` copies a live DB read-only in one snapshot without the dead take_chunks/take_archives recordings
  (Eden 23.4 GB -> 111 MB in ~3 s) and checks every copied table row by row. `online-backup.py` copies the accounts registry.
- `parity.py` reports event count, max seq, Soul-rows hash, conversations, turns, speech, accounts, snapshots and an
  event-prefix hash. `http-parity.sh` compares the public site with the eden2 proxy (SSH tunnel), path by path.
  `walk-eden2.mjs` walks the worlds in real Chrome at dpr 1 and 2 under the Chrome lease.
- `cutover.sh` (no args = preflight only; `--go "<name>"` = cutover) and `rollback.sh <TS>`.
  Run cutover only with Gene's go and an announced freeze.
- `rollback-rehearsal.sh` rehearses `rollback.sh` **on eden2 only** (scratch tree `/srv/sim-old-rbtest`, ports 4680–4682;
  it refuses macOS). Never run any rollback test mode on the laptop: it shares the machine with the live writers
  (INCIDENT-20261015-MARS-LM). `dbhash.py` hashes the accounts registry for rollback's copy-back decision.

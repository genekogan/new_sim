# Old worlds on eden2 (lane CLOUD2 2026-10-11; rebuilt for source 1080cfa9 by lane KIT 2026-10-15)

These files move /w/eden, /w/mars, /w/littlemartians and the root site from the laptop writers to eden2.
The run copies are in `<team>/runtime/sim-old-cloud/bin/`, which is where the scripts expect to run.
Status, rehearsal evidence and Gene's three commands: `team/lanes/t3-kit.md`.

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

# Old worlds on eden2 (lane CLOUD2, 2026-10-11)

These files move /w/eden, /w/mars, /w/littlemartians and the root site from the laptop writers to eden2.
The live copies are in `<team>/runtime/sim-old-cloud/bin/`, which is where the scripts expect to run.

- `run-world.mjs` is the eden2 runner. It uses the same server entry points and option mapping as Codex's
  `successor-world-run.mjs`. Its gates are a Clerk/registry env, history that never shrinks, and Soul rows that boot leaves unchanged.
- `port-map.mjs` is a preload. The sealed code keeps the laptop ports (4950/4963/4964, proxy 4970, /worlds 5340),
  and this file moves them to 4660/4661/4662, 4670 and 4620. `proxy.mjs` stays byte-identical to `publication-e8bc-001/proxy.mjs`.
- `sim-old@.service` and `sim-old-proxy.service` are systemd units running as user simworlds, with data in `/srv/sim-old-data/<world>`.
- `online-backup.py` makes a consistent copy of a live WAL DB with the SQLite backup API in one step. It only reads the source.
- `parity.py` reports event count, max seq, Soul-rows hash, conversations, turns, speech, accounts, snapshots and an event-prefix hash.
- `http-parity.sh` compares the laptop proxy with the eden2 proxy, path by path. `walk-eden2.mjs` walks the worlds in real Chrome at dpr 1 and 2.
- `cutover.sh` and `rollback.sh` do the cutover and the rollback. Run cutover only with Gene's go and an announced freeze.
  The checklist is in `team/lanes/cloud2.md`.

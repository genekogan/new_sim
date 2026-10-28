# Bounded Linux renderer and Eyes preflight

Release owner runs this only after reviewing the exact candidate and this protocol.
No production unit, live Soul, public route configuration, or existing data is changed
by the runner. Staging and any production Environment/ReadWritePaths changes remain
separate release-owner operations. A daemon-reload does not update running keepers.

## Stage once, before the 190-second measurement

1. Create a fresh candidate directory under `/srv/sim-preflight/releases/` from the
   exact committed candidate archive and the independently verified local web build.
   Preserve its source/build manifest and run the existing release-manifest verifier.
   Do not use a live production data directory or copy a world database.
2. Discover the actual existing **simworlds** pnpm store, rather than guessing a
   `/pnpm-store` path (that path belongs to Modal). `release.sh` runs pnpm under
   `sudo -u simworlds -H` without `--store-dir`. Its installed
   `/srv/sim-worlds/production/node_modules/.modules.yaml` records `storeDir`; root
   may confirm using `COREPACK_ENABLE_NETWORK=0 corepack pnpm store path --silent`
   as that same user. Read only the store setting, never print environment/auth files.
3. Match the candidate lock SHA with the known production lock. Install from that
   actual store with `COREPACK_ENABLE_NETWORK=0 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
   corepack pnpm install --offline --frozen-lockfile --store-dir <verified-store>
   --filter @sim/server... --filter mars-campus-viewer` in the candidate directory.
   Failure means unavailable prerequisites: retain the log, stop, and resume after
   reviewed provisioning. Do not retry online or download browsers automatically.
   As in release.sh, link only web's `@sim/world-compiler` to the **candidate** package
   if server-filter installation omitted it. Never symlink the whole production
   node_modules tree: workspace symlinks can silently select old production source.
4. Configure both candidate units to use the already installed Chromium executable
   `/srv/sim-eyes/ms-playwright/chromium-1243/chrome-linux64/chrome`, browser cache
   `/srv/sim-eyes/ms-playwright`, and the candidate viewer `package.json` for its
   installed Playwright module. Verify the Playwright-selected Chromium revision is
   that existing executable; mismatch is unavailable, not permission to download.
5. Root creates/validates `/srv/sim-render-locks` writable by simworlds, without
   clearing another process's lock. Candidate code and web stay read-only to units.
   Ensure the configured output's parent `/srv/sim-preflight` is traversable by
   simworlds. The runner creates its new run directory and two writable child dirs.
6. Preserve a staging receipt with candidate SHA, archive/build hashes, Node/version,
   dependency-lock hash, offline installation exit/result, canonical package links,
   actual store path and browser path/revision. Supply its SHA to the runner.

## Root-owned invocation

Supply a JSON file with `runId`, `root`, `out` (new path under `/srv/sim-preflight/`),
`sourceSha`, `sourceReceipt`, `sourceReceiptSha256`, `lockSha256`, `node` (existing
Node22), `webDir`, `chrome`, `browserPath`, `eyesPackage`, `lockDir`,
`productionUnits` (actual verified production/legacy systemd names), and
`productionEyesStatus` (loopback URL for Eden's public `/v1/edge/view/status`).
These fields are provenance/configuration only; never include credentials.

Run `node tools/context-views/linux-host-preflight.mjs <config.json>` as root from
the staged candidate. No CLI flag bypasses source, budget, or host guards. Staging
time is excluded; runner work is 180 seconds, cleanup allowance 10 seconds. An
independent operator watchdog may stop only its two exact transient unit names if
the supervising shell disconnects; each unit also has RuntimeMaxSec180 and a
five-second control-group stop timeout. No automatic run retry.

## Evidence and limits

- Two actual main processes, fresh known small fixture/data, ports5986/5987,
  simworlds identity, separate PrivateTmp, production security properties and one
  shared architectural lock. Each cgroup is capped at2560MiB. Baseline admission
  requires6GiB available; below3GiB during work aborts only these two units.
- One published enclosed-room target and one outdoor fountain target. At most four
  actual architectural starts including retries, exactly two successful PNGs.
  Admission overlap, recorded Chrome spawned/stopped intervals, and holder identities
  establish cross-unit serialization; one-second process sampling alone does not.
- One actual EyesWorker against fixture A, one direct fixed-camera job, one JPEG,
  no Soul creation or inference. Its render interval must overlap a context capture.
  No overlap means unqualified active coexistence, not permission for another frame.
- Existing production Eden Eyes is observed via its public status only. Require
  unchanged ready/since/failure counters; baseline-off Mars is not part of this
  predicate. Production/legacy cgroup OOM counters must not increase. Natural
  production Eyes renders may advance, but are never induced by this test.
- Record cgroup current/peak memory, CPU usage, OOM/events, PID/start/executable and
  live query/tick progress. Query latency is descriptive here; this small-fixture
  host proof does not replace the existing full-Eden latency acceptance test.
- Each context image is fetched twice; identical key/URL/byte hash and unchanged
  render count establish reuse. All raw trace/event logs, images and failures remain.
- Cleanup stops/kills only exact newly admitted unit cgroups, checks ports and owned
  lock holders, retains all directories, and never unlinks an existing shared lock.

If either process fails, return unavailable/fail with its evidence. Resume requires
root to diagnose the failure and choose a new run directory; do not widen limits,
restart production Eyes, or substitute another fixture automatically.

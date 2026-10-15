# /worlds releases without visible downtime

`release.sh <stage>` uploads a release, then runs `activate.sh` on the box. The unit `sim-worlds@<stage>` runs the
**keeper** (`tools/world-launcher/keeper.mjs`). The keeper holds the port and runs the launcher from the release that
`/srv/sim-worlds/<stage>` points at.

## What a release does
1. `activate.sh` points the stage link at the new release, keeping the old one as `<stage>.previous`.
2. It runs `systemctl reload sim-worlds@<stage>` (SIGHUP to the keeper), which starts the handover:
   - **prepare**: the running launcher finishes any world creation, holds new boots and registry writes, and lists its
     running worlds.
   - **start**: the new launcher starts and adopts those worlds. It proxies to them and boots nothing yet.
   - **switch**: new connections go to the new launcher. The old one forwards whatever still reaches it and closes
     idle connections.
   - **take over**: one world at a time, the old launcher stops the world (it saves a snapshot and its process exits),
     then the new launcher boots it on the same data. Requests and viewer sockets for that world wait for it; they do
     not fail. A world never has two processes.
   - **exit**: the old launcher finishes its last responses and exits.
3. Then the same checks as before run: the health check must report the new build, and every registered world must
   answer. If either fails, the stage link goes back to `<stage>.previous` and the unit is reloaded again, which runs
   the same handover in reverse. If that reload fails, the unit is restarted.

If the new launcher fails before the switch, the old one carries on untouched. If a world cannot boot on the new
release, `keeper.json` reports it, the world stays down rather than run twice, and the rollback brings it back.

The keeper writes its state to `<data>/keeper.json`: keeper pid and sha, the active build, and the last handover with
each world's time.

## When it is a restart instead
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
the longest error run, the slowest request, and how long each world's socket was down.

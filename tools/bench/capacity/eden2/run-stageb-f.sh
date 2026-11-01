#!/bin/bash
# Stage B part F (Gene, 2026-10-31 14:50Z via the forked session): one N=300 arm, read worker on, to LOCATE the act-cost
# wall on the tick thread (acts ~70 CPU-ms each are the next limit once reads sit on workers; estimated near 300 Souls;
# the act-in-words polish 70 -> 30 ms is what moves it) instead of estimating it. Same columns as A-E; one repeat; the
# 2-core slice and the 3-core slice. Waits for run-stageb.sh's "ALL DONE" so the two never share the slice. If 300
# raw-HTTP Souls do not fit the driver beside production, the run's bench.log and receipt say so — never shrink N silently.
# Usage: run-stageb-f.sh <short sha>   (source at /srv/sim-bench/src-<sha>; main log at /srv/sim-bench/runs/stageb-<sha>.log)
set -u
SHA=${1:?short sha}; S=/srv/sim-bench/src-$SHA; B=$S/tools/bench/capacity/bench.mjs; FX=/srv/sim-bench/fixtures/eden-2026.db; R=/srv/sim-bench/runs/stageb-$SHA
C="--root $S --fixture $FX --world-key eden-2026 --via-launcher --port 5151 --child-range 5152-5159 --heap-mb 2048 --host-label eden2-slice --world-user simworlds --load stageb"
cd "$S" || exit 1
say() { echo "$(date -u +%FT%TZ) $*"; }
say "F waiting for ALL DONE in $R.log"
until grep -q "ALL DONE" "$R.log" 2>/dev/null; do sleep 60; done
say "F start; $(uptime)"
say "F n300 2 cores"; node $B $C --cpus 6-7 --read-worker on --arms n300 --repeats 1 --join-concurrency 8 --out $R-F-n300-2core > $R-F-n300-2core.log 2>&1; say "F1 exit $?"
say "F n300 3 cores"; node $B $C --cpus 5-7 --read-worker on --arms n300 --repeats 1 --join-concurrency 8 --out $R-F-n300-3core > $R-F-n300-3core.log 2>&1; say "F2 exit $?"
say "F ALL DONE; $(uptime)"

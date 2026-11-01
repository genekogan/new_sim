#!/bin/bash
# Stage B capacity bench (lane B-soak) on eden2: read worker off vs on, METRICS v2. Run as root from nohup; the launcher
# and the world run as simworlds; the world process and all its threads (tick thread + read workers) are pinned to the
# slice CPUs with taskset (parts A, B: 6-7 = 2 cores; C, D: 5-7 = 3 cores). Ports 5151-5159 only. Never touches
# production worlds, /opt/eden3 or the mars user. Parts A-D set the world budget to 200 C1/C2 rps (the engine is measured);
# E keeps the launcher's production default (10 rps for main; reads the workers answer are exempt since B-serve). Usage: run-stageb.sh <short sha>   (source at /srv/sim-bench/src-<sha>)
set -u
SHA=${1:?short sha}; S=/srv/sim-bench/src-$SHA; B=$S/tools/bench/capacity/bench.mjs; FX=/srv/sim-bench/fixtures/eden-2026.db; R=/srv/sim-bench/runs/stageb-$SHA
C="--root $S --fixture $FX --world-key eden-2026 --via-launcher --port 5151 --child-range 5152-5159 --heap-mb 2048 --host-label eden2-slice --world-user simworlds --load stageb"
cd "$S" || exit 1
say() { echo "$(date -u +%FT%TZ) $*"; }
say "start; $(uptime)"
say "A sweep";   node $B $C --cpus 6-7 --read-worker off,on --arms n6,n12,n24,n50,n100 --repeats 2 --out $R-A-sweep > $R-A-sweep.log 2>&1; say "A exit $?"
say "B hostile"; node $B $C --cpus 6-7 --read-worker on --arms hostile,incident --repeats 2 --out $R-B-hostile > $R-B-hostile.log 2>&1; say "B exit $?"
say "C 3 cores"; node $B $C --cpus 5-7 --read-worker off,on --arms n100 --repeats 2 --out $R-C-3core > $R-C-3core.log 2>&1; say "C exit $?"
say "D 3 cores, 2 workers"; node $B $C --cpus 5-7 --read-worker on --read-workers 2 --arms n100 --repeats 2 --out $R-D-3core-2w > $R-D-3core-2w.log 2>&1; say "D exit $?"
say "E production budget"; node $B $C --cpus 6-7 --read-worker on --world-budget-rps default --arms n100 --repeats 2 --out $R-E-prod-budget > $R-E-prod-budget.log 2>&1; say "E exit $?"
say "ALL DONE; $(uptime)"

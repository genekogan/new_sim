#!/usr/bin/env bash
# Close one old-world writer by its PID and wait until it is really closed (lane KIT 2026-10-15, final review).
#   bash close-writer.sh --term|--no-term <world> <pid> <port> <dataDir> <receiptDir> <waitSeconds>
# Used by cutover.sh (FREEZE, --term) and rollback.sh (a writer found lingering, --no-term). Exit 0 + one line:
#   "exited"            the process exited by itself (run-world.mjs does after its normal close)
#   "closed-lingering"  it stayed alive, but <receiptDir>/<world>/CLOSURE.json names this PID with normalClosed:true, the
#                       data dir's edge-server.lock no longer names it, and <port> has no listener: the live convergence
#                       runner never calls process.exit after closing (convergence-world-run.mjs:163-174); its DB is
#                       already closed, so it is SIGKILLed then and only then.
# --no-term only: exit 2 "listening" as soon as <port> has a listener (someone is serving the world: never touch it).
# Exit 1 "still-open ..." when neither happened within <waitSeconds> (no kill). The caller must have identified <pid>.
set -uo pipefail
MODE=$1 W=$2 P=$3 PORT=$4 DD=$5 RD=$6 WAIT=$7
listening() { if [ "$(uname)" = Darwin ]; then /usr/sbin/lsof -nP -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null; else ss -ltnpH "sport = :$PORT" | grep -o 'pid=[0-9]*' | cut -d= -f2; fi | grep -q .; }
receipt() { python3 -c 'import json,sys
try: d=json.load(open(sys.argv[1])); sys.exit(0 if d.get("closedPID")==int(sys.argv[2]) and d.get("normalClosed") is True else 1)
except Exception: sys.exit(1)' "$RD/$W/CLOSURE.json" $P; }
lockfree() { python3 -c 'import json,sys
try: sys.exit(1 if json.load(open(sys.argv[1])).get("pid")==int(sys.argv[2]) else 0)
except FileNotFoundError: sys.exit(0)
except Exception: sys.exit(1)' "$DD/edge-server.lock" $P; }
kill -0 $P 2>/dev/null || { echo exited; exit 0; }
[ "$MODE" = --term ] && kill -TERM $P
for i in $(seq 1 $((WAIT*5))); do
  kill -0 $P 2>/dev/null || { echo exited; exit 0; }
  [ "$MODE" = --no-term ] && listening && { echo "listening (port $PORT has a listener again; left alone)"; exit 2; }
  if receipt && lockfree && ! listening; then
    kill -KILL $P; for j in $(seq 1 25); do kill -0 $P 2>/dev/null || break; sleep 0.2; done
    kill -0 $P 2>/dev/null && { echo "still-open: closed-lingering pid $P survived SIGKILL"; exit 1; }
    echo closed-lingering; exit 0; fi
  sleep 0.2
done
echo "still-open: pid $P alive after ${WAIT}s (receipt $(receipt && echo yes || echo no), lock $(lockfree && echo released || echo held), port $(listening && echo listening || echo closed))"; exit 1

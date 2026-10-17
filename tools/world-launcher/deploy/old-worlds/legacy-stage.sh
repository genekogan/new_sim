#!/usr/bin/env bash
# The legacy stage on eden2: the original worlds (eden, mars, littlemartians) at the site root on the current release
# (world launcher --old-worlds-root, fork mode). Lane L2 2026-10-17. Runs AS ROOT ON EDEN2, from inside the release it
# serves (/srv/sim-old/releases/we-<sha12>-root/tools/world-launcher/deploy/old-worlds/legacy-stage.sh); cutover.sh calls it.
#   legacy-stage.sh check      read-only: is everything in place, and is the stage empty and stopped (exit 1 + reasons if not)
#   legacy-stage.sh setup      idempotent: settings, memory drop-in, stage link, data dirs, artifacts, fork descriptors;
#                              never starts anything, never overwrites a world's data, never touches another stage
#   legacy-stage.sh start      start the launcher with no worlds (not public: Caddy routes nothing here until cutover)
#   legacy-stage.sh register   register the three forks onto the data already copied in, not claimable; prints boot ms
#   legacy-stage.sh stop       stop the launcher (each world saves a snapshot and exits); data and registry stay
#   legacy-stage.sh status     unit, launcher health, worlds, memory
# Paths (real run): release link /srv/sim-worlds/legacy, data /srv/sim-worlds-data/legacy, settings /etc/sim-worlds/legacy.conf,
# unit sim-worlds@legacy (the existing template), port 4670 (the port the kit's Caddy switch already uses), worlds 4660-4662.
# REHEARSAL (LG_SCRATCH=1): everything under /srv/sim-old-l2, a transient systemd-run unit sim-old-l2-rehearsal with the
# same keeper command and limits, ports 6320-6323; it refuses the real names, the real ports and /etc.
# Never touched: /worlds (sim-worlds@production, its data and settings), Caddy, /opt/eden3, the mars user, the sim-old units.
set -euo pipefail
CMD=${1:?usage: legacy-stage.sh check|setup|start|register|stop|status}
REL=$(cd "$(dirname "$0")/../../../.." && pwd -P)       # the release this script ships in
BUILD=$(cat "$REL/BUILD"); A=/srv/sim-old/current         # so-1080cfa9: the old-world artifacts and descriptors Codex sealed
AUTH=/etc/sim-worlds/production-auth.env                  # the public Clerk settings (by path; never printed)
WORLDS="eden mars littlemartians"
if [ "${LG_SCRATCH:-}" = 1 ]; then
  ROOT=/srv/sim-old-l2; LINK=$ROOT/current; DATA=$ROOT/data; CONF=$ROOT/legacy.conf; DROPIN=; UNIT=sim-old-l2-rehearsal
  PORT=6320; RANGE=6321-6323; MEMHIGH=${LG_MEMHIGH:-2G}; MEMMAX=${LG_MEMMAX:-2560M}
else
  [ -z "${LG_MEMHIGH:-}${LG_MEMMAX:-}" ] || { echo "LG_MEM* overrides are for the rehearsal only"; exit 2; }
  ROOT=; LINK=/srv/sim-worlds/legacy; DATA=/srv/sim-worlds-data/legacy; CONF=/etc/sim-worlds/legacy.conf
  DROPIN=/etc/systemd/system/sim-worlds@legacy.service.d/10-memory.conf; UNIT=sim-worlds@legacy; PORT=4670; RANGE=4660-4662
  MEMHIGH=2G; MEMMAX=2560M   # measured peak 1.51 GB (3 worlds booted + Chrome walk, L2 rehearsal); whole-box budget in t3-d2
fi
ARGS="--old-worlds-root --port $PORT --range $RANGE --data $DATA --public-origin https://sim.eden.art --auth-env $AUTH --max-worlds 3 --max-running 3 --min-free-mb 1500 --create-limit 0 --mars-web $LINK/mars-web --eager 3"
say() { echo "[legacy $(date -u +%T)] $*"; }
health() { curl -fsS -m 5 "http://127.0.0.1:$PORT/__sim/healthz" 2>/dev/null; }
registered() { [ -f $DATA/worlds.json ] && python3 -c 'import json,sys;print(" ".join(w["slug"] for w in json.load(open(sys.argv[1]))["worlds"]))' $DATA/worlds.json || true; }
listeners() { ss -ltnpH "sport = :$1" | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u; }
mainpid() { systemctl show -p MainPID --value $UNIT 2>/dev/null || echo 0; }
ours() { local m; m=$(mainpid); [ "$m" != 0 ] && { echo $m; pgrep -P $m; for c in $(pgrep -P $m); do pgrep -P $c; done; } 2>/dev/null | sort -u; }
ports() { local a b; a=${RANGE%-*}; b=${RANGE#*-}; echo $PORT; seq $a $b; }

check() {
  local bad=0 own; own=" $(ours | tr '\n' ' ') "
  [ "$(readlink -f $LINK 2>/dev/null)" = "$REL" ] || { echo "CHECK: $LINK does not point at $REL"; bad=1; }
  ( cd $REL && sha256sum -c --quiet FILES.sha256 >/dev/null 2>&1 ) || { echo "CHECK: release files differ from FILES.sha256"; bad=1; }
  [ -d $REL/node_modules ] || { echo "CHECK: release dependencies not installed"; bad=1; }
  [ -f $AUTH ] || { echo "CHECK: $AUTH missing"; bad=1; }
  [ "$(sed -n 's/^SIM_WORLDS_ARGS=//p' $CONF 2>/dev/null)" = "$ARGS" ] || { echo "CHECK: $CONF missing or not the expected settings"; bad=1; }
  [ -z "$DROPIN" ] || grep -q "MemoryMax=$MEMMAX" $DROPIN 2>/dev/null || { echo "CHECK: memory drop-in $DROPIN missing"; bad=1; }
  for w in $WORLDS; do test -s $DATA/forks/descriptors/$w.json || { echo "CHECK: descriptor $w missing"; bad=1; }; done
  for f in places.v1.json regions-boundaries.json activity-spots.v1.json mars-web; do test -e $DATA/forks/artifacts/$f || { echo "CHECK: artifact $f missing"; bad=1; }; done
  for p in $(ports); do for pid in $(listeners $p); do case "$own" in *" $pid "*) ;; *) echo "CHECK: port $p held by pid $pid, not this stage"; bad=1;; esac; done; done
  local r; r=$(registered); [ -z "$r" ] || { echo "CHECK: worlds already registered ($r): a previous run is not cleaned up"; bad=1; }
  return $bad
}

case $CMD in
check) check && say "check ok: $BUILD at $LINK, data $DATA, $UNIT $(systemctl is-active $UNIT 2>/dev/null || true), no worlds registered";;
setup)
  [ "${LG_SCRATCH:-}" = 1 ] && install -d -m 750 -o simworlds -g simworlds $ROOT
  [ -L $LINK ] || [ ! -e $LINK ] || { echo "$LINK exists and is not a link"; exit 1; }
  ln -sfn $REL $LINK.next && mv -T $LINK.next $LINK
  install -d -m 750 -o simworlds -g simworlds $DATA $DATA/worlds $DATA/forks $DATA/forks/descriptors $DATA/forks/artifacts
  for w in $WORLDS; do install -d -m 750 -o simworlds -g simworlds $DATA/worlds/$w; done
  for f in places.v1.json regions-boundaries.json activity-spots.v1.json; do cmp -s $A/artifacts/$f $DATA/forks/artifacts/$f || cp -a $A/artifacts/$f $DATA/forks/artifacts/; done
  [ -d $DATA/forks/artifacts/mars-web ] || cp -aL $A/mars-web $DATA/forks/artifacts/mars-web
  node $REL/tools/world-launcher/deploy/forks/descriptors.mjs $A/descriptors $DATA/forks/artifacts $DATA/forks/descriptors >/dev/null
  chown -R simworlds:simworlds $DATA
  if [ -f $CONF ] && [ "$(sed -n 's/^SIM_WORLDS_ARGS=//p' $CONF)" != "$ARGS" ]; then cp -a $CONF $CONF.before-$(date -u +%Y%m%d-%H%M%S); fi
  printf '# sim-worlds@legacy: the original worlds (eden, mars, littlemartians) at https://sim.eden.art/ (catch-all), lane L2 kit.\nSIM_WORLDS_ARGS=%s\n' "$ARGS" > $CONF
  [ "${LG_SCRATCH:-}" = 1 ] || chown root:simworlds $CONF
  chmod 640 $CONF
  if [ -n "$DROPIN" ]; then install -d $(dirname $DROPIN)
    printf '[Service]\nMemoryHigh=%s\nMemoryMax=%s\n' $MEMHIGH $MEMMAX > $DROPIN.next
    if ! cmp -s $DROPIN.next $DROPIN; then mv $DROPIN.next $DROPIN; systemctl daemon-reload; else rm -f $DROPIN.next; fi; fi
  say "setup done: $LINK -> $REL, $CONF, ${DROPIN:-no drop-in (rehearsal: limits on the transient unit)}, $DATA (descriptors from $A)";;
start)
  check || { echo "start refused: check failed"; exit 1; }
  if [ "${LG_SCRATCH:-}" = 1 ]; then
    systemd-run --unit $UNIT --uid simworlds --gid simworlds -p WorkingDirectory=$LINK -p MemoryHigh=$MEMHIGH -p MemoryMax=$MEMMAX \
      -p KillMode=mixed -p TimeoutStopSec=40 -p NoNewPrivileges=true -p ProtectSystem=strict -p ProtectHome=true -p ReadWritePaths=$DATA \
      -p PrivateTmp=true /usr/bin/node tools/world-launcher/keeper.mjs --link $LINK $ARGS >/dev/null
  else systemctl start $UNIT; fi
  for i in $(seq 1 60); do health | grep -q "\"build\":\"$BUILD\"" && break; [ $i = 60 ] && { echo "launcher not healthy on :$PORT"; journalctl -u $UNIT -n 20 --no-pager -o cat; exit 1; }; sleep 1; done
  say "started $UNIT ($BUILD) on :$PORT with no worlds";;
register)
  health | grep -q "\"build\":\"$BUILD\"" || { echo "launcher not running"; exit 1; }
  for w in $WORLDS; do test -s $DATA/worlds/$w/sim.db || { echo "no data for $w"; exit 1; }; done
  cd $LINK
  for w in littlemartians mars eden; do
    out=$(sudo -u simworlds node tools/world-launcher/op.mjs register-fork --port $PORT --slug $w --descriptor $DATA/forks/descriptors/$w.json --accounts $DATA/forks/accounts.sqlite) \
      || { echo "$out" | head -5; echo "register $w FAILED"; exit 1; }
    sudo -u simworlds node tools/world-launcher/op.mjs set-claimable --port $PORT --slug $w --claimable false >/dev/null
    say "registered $w (boot $(echo "$out" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("bootMs"))') ms, not claimable)"; done;;
stop) if [ "${LG_SCRATCH:-}" = 1 ]; then systemctl stop $UNIT 2>/dev/null || true; else systemctl stop $UNIT; fi; say "stopped $UNIT";;
status)
  echo "unit $UNIT: $(systemctl is-active $UNIT 2>/dev/null || true) enabled: $(systemctl is-enabled $UNIT 2>/dev/null || true)"
  echo "health: $(health || echo none)"; echo "registered: $(registered)"
  echo "memory: $(systemctl show -p MemoryCurrent --value $UNIT 2>/dev/null) bytes; RSS per process:"; for p in $(ours); do ps -o pid=,rss=,args= -p $p | cut -c1-140; done;;
*) echo "unknown command $CMD"; exit 2;;
esac

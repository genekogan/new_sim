#!/usr/bin/env bash
# Old worlds (/w/eden, /w/mars, /w/littlemartians and the root site) -> eden2. Lane CLOUD2, 2026-10-11.
# Run ON THE LAPTOP, only with Gene's go and an announced freeze (~5-10 min of old-world downtime).
#   bash cutover.sh              preflight only (changes nothing)
#   bash cutover.sh --go "who"   preflight, pre-sync, FREEZE (normal-close the 3 laptop writers), final copy,
#                                start eden2 writers + proxy, Caddy catch-all -> eden2 proxy, public check, enable.
# Never touched: the laptop proxy (:4970) and SSH tunnel (eden2:4505 -> :4970) stay up for rollback (rollback.sh);
# /worlds (Caddy -> :4620); /opt/eden3; the mars user; DNS; firewall. No force kill, no lock deletion on the laptop.
set -euo pipefail
H=<team>/runtime/sim-old-cloud; E2=root@eden2; TS=$(date -u +%Y%m%d-%H%M%S); LOG=$H/logs/cutover-$TS.log
GO=""; [ "${1:-}" = "--go" ] && GO="${2:?--go needs a name}"
RUNNER=<team>/pm-integration/auth-account-20261009/runtime-modern-context-prep-001/successor-world-run.mjs
ACC=<team>/runtime/production-accounts/accounts.sqlite
WORLDS="eden mars littlemartians"
port() { case $1 in eden) echo 4950;; mars) echo 4963;; littlemartians) echo 4964;; esac; }
wid()  { case $1 in eden) echo pm-preview-eden-20261005;; mars) echo mars-2026-1;; littlemartians) echo littlemartians-1;; esac; }
ddir() { case $1 in eden) echo <team>/previews/20261007-edge/eden-data;; *) echo <team>/previews/20261010-restoration-auth/canonical-$1-data;; esac; }
writer() { pgrep -f "successor-world-run.mjs $1\$" || true; }   # current writer PID, found by its command line
say() { echo "[$(date -u +%T)] $*" | tee -a "$LOG"; }
die() { say "STOP: $*"; exit 1; }
mkdir -p $H/logs
say "cutover $TS ${GO:+GO by $GO}"

# 0. preflight
for w in $WORLDS; do p=$(writer $w); [ -n "$p" ] || die "no laptop writer for $w"
  [ "$(/usr/sbin/lsof -nP -iTCP:$(port $w) -sTCP:LISTEN -t)" = "$p" ] || die "$w port $(port $w) not owned by writer $p"
  ps -o command= -p $p | grep -q "$RUNNER $w" || die "$w writer $p command differs"; say "laptop $w writer $p :$(port $w)"; done
pgrep -f "4505:127.0.0.1:4970" >/dev/null || say "WARN: laptop tunnel to eden2:4505 not found (rollback needs it)"
ssh $E2 'set -e; test -f /etc/systemd/system/sim-old@.service; test -f /etc/systemd/system/sim-old-proxy.service; test -L /srv/sim-old/current
  [ "$(grep -c "reverse_proxy 127.0.0.1:4505" /etc/caddy/sites/sim.caddy)" = 1 ] || { echo "sim.caddy: expected exactly one 4505 catch-all"; exit 1; }
  free=$(df --output=avail -BG /srv | tail -1 | tr -dc 0-9); [ "$free" -ge 8 ] || { echo "eden2 disk ${free}G < 8G"; exit 1; }
  mem=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mem" -ge 2500 ] || { echo "eden2 MemAvailable ${mem}M"; exit 1; }
  echo "eden2 ok: disk ${free}G free, MemAvailable ${mem}M; sim-old units: $(systemctl is-active sim-old@eden sim-old@mars sim-old@littlemartians sim-old-proxy | tr "\n" " ")"' | tee -a "$LOG"
[ -n "$GO" ] || { say "preflight PASS (no --go: nothing changed)"; exit 0; }

# 1. pre-sync while the site is still up (makes the frozen delta small: Eden ~75 s measured)
say "stop eden2 rehearsal copies"; ssh $E2 'systemctl stop sim-old-proxy sim-old@eden sim-old@mars sim-old@littlemartians'
sync_world() { # $1 world: online backup (read-only on the source) to stage, rsync delta into /srv/sim-old-data/$1/sim.db
  python3 $H/bin/online-backup.py "$(ddir $1)/sim.db" $H/stage/$1/sim.db | tee -a "$LOG"
  ssh $E2 "rm -f /srv/sim-old-data/$1/sim.db-wal /srv/sim-old-data/$1/sim.db-shm /srv/sim-old-data/$1/edge-server.lock /srv/sim-old-data/$1/world-server.lock"
  rsync -az --inplace $H/stage/$1/sim.db $E2:/srv/sim-old-data/$1/sim.db; }
for w in $WORLDS; do say "pre-sync $w"; sync_world $w; done

# 2. FREEZE: normal close (SIGTERM -> the server stops its clock and snapshots), identity-checked, no force kill
say "FREEZE: closing laptop writers"
for w in $WORLDS; do p=$(writer $w); [ "$(/usr/sbin/lsof -nP -iTCP:$(port $w) -sTCP:LISTEN -t)" = "$p" ] || die "$w identity changed"
  kill -TERM $p; for i in $(seq 1 600); do kill -0 $p 2>/dev/null || break; sleep 0.2; done
  kill -0 $p 2>/dev/null && die "$w writer $p did not exit in 120 s (no force kill; investigate, then rollback.sh)"
  [ -z "$(/usr/sbin/lsof -nP -iTCP:$(port $w) -sTCP:LISTEN -t)" ] || die "$w port still listening"
  for l in edge-server.lock world-server.lock; do [ ! -e "$(ddir $w)/$l" ] || die "$w lock $l remains"; done
  say "closed $w ($p)"; done

# 3. final copy + exact parity (events, max seq, Souls hash, conversations/turns/speech, accounts, snapshots, prefix hash)
for w in $WORLDS; do sync_world $w
  a=$(python3 $H/bin/parity.py $H/stage/$w/sim.db $(wid $w)); b=$(ssh $E2 "python3 /srv/sim-old/current/bin/parity.py /srv/sim-old-data/$w/sim.db $(wid $w)")
  say "parity $w laptop $a"; say "parity $w eden2  $b"; [ "$a" = "$b" ] || die "$w parity differs (laptop writers are closed: run rollback.sh)"; done
python3 $H/bin/online-backup.py $ACC $H/stage/accounts/accounts.sqlite | tee -a "$LOG"
ssh $E2 'rm -f /srv/sim-old-data/accounts/accounts.sqlite-wal /srv/sim-old-data/accounts/accounts.sqlite-shm'
rsync -a $H/stage/accounts/accounts.sqlite $E2:/srv/sim-old-data/accounts/accounts.sqlite
ssh $E2 'chown -R simworlds:simworlds /srv/sim-old-data'

# 4. start eden2 writers + proxy, check identities through the proxy
ssh $E2 'set -e; systemctl start sim-old@eden sim-old@mars sim-old@littlemartians
  for w in eden mars littlemartians; do ok=; for i in $(seq 1 100); do journalctl -u sim-old@$w --since "-10min" -o cat --no-pager | grep -q "\"phase\":\"ready\"" && { ok=1; break; }; systemctl is-failed -q sim-old@$w && break; sleep 3; done
    [ -n "$ok" ] || { echo "sim-old@$w not ready"; journalctl -u sim-old@$w -n 20 --no-pager -o cat; exit 1; }; done
  systemctl start sim-old-proxy; sleep 5
  for w in eden mars littlemartians; do curl -sf -H "Host: sim.eden.art" http://127.0.0.1:4670/w/$w/v1/config | python3 -c "import json,sys;d=json.load(sys.stdin);print(\"eden2 proxy\",d[\"worldKey\"],d[\"worldId\"],d[\"build\"])"; done' | tee -a "$LOG" || die "eden2 start failed (run rollback.sh)"

# 5. Caddy: catch-all from the tunnel (4505) to the eden2 proxy (4670); /worlds unchanged
ssh $E2 "set -e; cp -a /etc/caddy/sites/sim.caddy /etc/caddy/sites/sim.caddy.pre-cloud2-$TS.bak
  sed -i 's#reverse_proxy 127.0.0.1:4505#reverse_proxy 127.0.0.1:4670#' /etc/caddy/sites/sim.caddy
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || { cp -a /etc/caddy/sites/sim.caddy.pre-cloud2-$TS.bak /etc/caddy/sites/sim.caddy; echo 'caddy validate failed, restored'; exit 1; }
  systemctl reload caddy; echo caddy reloaded, backup sim.caddy.pre-cloud2-$TS.bak" | tee -a "$LOG" || die "Caddy change failed (file restored; run rollback.sh to restart laptop writers)"

# 6. public check (as a stranger)
sleep 3; for w in $WORLDS; do
  curl -sf https://sim.eden.art/w/$w/v1/config | python3 -c "import json,sys;d=json.load(sys.stdin);assert d['worldId']=='$(wid $w)';print('public',d['worldKey'],d['worldId'],d['build'])" | tee -a "$LOG" || die "public $w check failed (run rollback.sh $TS)"; done
curl -sf -o /dev/null https://sim.eden.art/ && curl -sf https://sim.eden.art/worlds/__sim/healthz | cut -c1-80 | tee -a "$LOG"
[ "$(curl -s https://sim.eden.art/eden-agent.mjs | shasum -a 256 | cut -c1-8)" = bb53a105 ] || say "WARN: public CLI sha differs"

# 7. persist across reboots
ssh $E2 'systemctl enable sim-old@eden sim-old@mars sim-old@littlemartians sim-old-proxy 2>&1 | tail -1'
say "CUTOVER DONE. Laptop writers stopped (data intact), laptop proxy + tunnel untouched. Walk each world dpr 1/2 now. Rollback: bash $H/bin/rollback.sh $TS"

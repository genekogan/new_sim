#!/usr/bin/env bash
# Roll the old worlds back to the laptop after cutover.sh. Lane CLOUD2 2026-10-11; refreshed by lane KIT 2026-10-15
# (source 1080cfa9). Run ON THE LAPTOP.
#   bash rollback.sh <cutover-TS>        (TS from cutover's log name; selects the Caddy backup sim.caddy.pre-kit-<TS>.bak)
# 1 Caddy catch-all back to the tunnel (4505 -> laptop proxy :4970, which cutover never stopped)
# 2 stop + disable eden2 sim-old services (SIGTERM = normal close with snapshot)
# 3 copy eden2's newer history back (compact, read-only snapshot on eden2); the laptop originals are only RENAMED to
#   *.pre-rollback-<ts> (never deleted; they still hold the old recordings)
# 4 restart the laptop writers: same sealed input 1080cfa9, the exact live descriptors (+ account registry path), same
#   Clerk env-file and registry, via bin/run-world.mjs (no port map on the laptop: 4950/4963/4964). The live runner
#   convergence-world-run.mjs can't relaunch (its GO expires after 5 min and its READY receipts are write-once).
#   Relaunch path rehearsed 2026-10-15 on scratch copies (see team/lanes/t3-kit.md).
# If cutover stopped BEFORE the Caddy change (writers closed, Caddy untouched), the same script applies: step 1 finds the
# backup missing and skips, step 3 copies back nothing newer than the laptop (eden2 never served), step 4 restarts.
set -uo pipefail
TS=${1:?usage: rollback.sh <cutover-TS>}; H=<team>/runtime/sim-old-cloud; E2=root@eden2; NOW=$(date -u +%Y%m%d-%H%M%S)
N=~/.nvm/versions/node/v22.20.0/bin/node; ENV=<team>/pm-integration/auth-account-20261009/clerk-publication-types-003/STAGED-PUBLIC-SETTINGS.env
ACC=<team>/runtime/production-accounts/accounts.sqlite; LOG=$H/logs/rollback-$NOW.log; DESC=$H/rollback/descriptors-1080cfa9
wid()  { case $1 in eden) echo pm-preview-eden-20261005;; mars) echo mars-2026-1;; littlemartians) echo littlemartians-1;; esac; }
port() { case $1 in eden) echo 4950;; mars) echo 4963;; littlemartians) echo 4964;; esac; }
ddir() { case $1 in eden) echo <team>/previews/20261007-edge/eden-data;; *) echo <team>/previews/20261010-restoration-auth/canonical-$1-data;; esac; }
say() { echo "[$(date -u +%T)] $*" | tee -a "$LOG"; }
mkdir -p $H/logs
for w in eden mars littlemartians; do [ -z "$(/usr/sbin/lsof -nP -iTCP:$(port $w) -sTCP:LISTEN -t)" ] || { say "STOP: laptop :$(port $w) is already served; nothing to roll back for $w?"; exit 1; }; done
# 1
ssh $E2 "B=/etc/caddy/sites/sim.caddy.pre-kit-$TS.bak; if [ -f \$B ]; then cp -a /etc/caddy/sites/sim.caddy /etc/caddy/sites/sim.caddy.post-kit-$NOW.bak; cp -a \$B /etc/caddy/sites/sim.caddy
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 && systemctl reload caddy && echo caddy restored from \$B; else echo 'no Caddy backup for $TS: Caddy was not changed'; fi
  grep -c 'reverse_proxy 127.0.0.1:4505' /etc/caddy/sites/sim.caddy" | tee -a "$LOG"
# 2
ssh $E2 'systemctl disable --now sim-old-proxy sim-old@eden sim-old@mars sim-old@littlemartians 2>&1 | tail -1; systemctl is-active sim-old@eden sim-old@mars sim-old@littlemartians sim-old-proxy | tr "\n" " "' | tee -a "$LOG"
# 3 (only if eden2 has history the laptop doesn't: compare max seq)
for w in eden mars littlemartians accounts; do
  if [ $w = accounts ]; then src=/srv/sim-old-data/accounts/accounts.sqlite; dst=$ACC
    ssh $E2 "python3 /srv/sim-old/current/bin/online-backup.py $src /srv/sim-old-data/rollback-$w.db" | tee -a "$LOG"
  else src=/srv/sim-old-data/$w/sim.db; dst=$(ddir $w)/sim.db
    a=$(python3 $H/bin/parity.py "$dst" $(wid $w) | python3 -c 'import json,sys;print(json.load(sys.stdin)["maxSeq"])')
    b=$(ssh $E2 "python3 /srv/sim-old/current/bin/parity.py $src $(wid $w)" | python3 -c 'import json,sys;print(json.load(sys.stdin)["maxSeq"])')
    if [ "$b" -le "$a" ]; then say "$w: eden2 maxSeq $b <= laptop $a: laptop DB kept as is"; continue; fi
    ssh $E2 "python3 /srv/sim-old/current/bin/compact-copy.py $src /srv/sim-old-data/rollback-$w.db" | tee -a "$LOG"
  fi
  for f in "$dst" "$dst-wal" "$dst-shm"; do if [ -e "$f" ]; then mv "$f" "$f.pre-rollback-$NOW"; fi; done
  rsync -az $E2:/srv/sim-old-data/rollback-$w.db "$dst" && ssh $E2 "rm -f /srv/sim-old-data/rollback-$w.db"
  [ $w = accounts ] || say "$w now $(python3 $H/bin/parity.py "$dst" $(wid $w))"
done
# 4
for w in eden mars littlemartians; do
  (cd /tmp && AUTH_PROVIDER=clerk ACCOUNT_REGISTRY_PATH=$ACC nohup $N --experimental-transform-types --env-file=$ENV $H/bin/run-world.mjs $DESC/$w.json >> $H/logs/laptop-$w-$NOW.log 2>&1 < /dev/null &)
done
for w in eden mars littlemartians; do for i in $(seq 1 100); do grep -q '"phase":"ready"' $H/logs/laptop-$w-$NOW.log 2>/dev/null && break; sleep 3; done
  say "$w: $(grep -h '"phase":"ready"' $H/logs/laptop-$w-$NOW.log || echo "NOT READY - see $H/logs/laptop-$w-$NOW.log")"; done
for w in eden mars littlemartians; do say "public /w/$w/v1/config $(curl -s -o /dev/null -w '%{http_code}' https://sim.eden.art/w/$w/v1/config)"; done
say "ROLLBACK DONE (laptop proxy :4970 routes to the restarted writers; if it was stopped meanwhile, restart it from team/reviews/convergence-ops-1080cfa9-001/PROXY.json)."

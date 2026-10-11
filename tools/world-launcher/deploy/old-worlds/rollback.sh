#!/usr/bin/env bash
# Roll the old worlds back to the laptop after cutover.sh. Lane CLOUD2. Run ON THE LAPTOP.
#   bash rollback.sh <cutover-TS>        (TS from cutover's log name; selects the Caddy backup)
# 1 Caddy catch-all back to the tunnel (4505 -> laptop proxy :4970, which cutover never stopped)
# 2 stop eden2 sim-old services (SIGTERM = normal close with snapshot)
# 3 copy eden2's newer history back; laptop originals are kept as *.pre-rollback-<ts> (never deleted)
# 4 restart the laptop writers: same sealed input 5e478f8a, Codex's exact descriptors (+ account registry path), same
#   Clerk env-file and registry, via bin/run-world.mjs. Codex's successor-world-run.mjs can't relaunch as is (its READY
#   receipts are write-once and its gates name the 2026-10-10 PIDs and closure receipts). Tested 13:28 UTC on a
#   scratch LM copy (port mapped to 5781): ready in 3 s, /v1/config served.
set -euo pipefail
TS=${1:?usage: rollback.sh <cutover-TS>}; H=<team>/runtime/sim-old-cloud; E2=root@eden2; NOW=$(date -u +%Y%m%d-%H%M%S)
N=~/.nvm/versions/node/v22.20.0/bin/node; ENV=<team>/pm-integration/auth-account-20261009/clerk-publication-types-003/STAGED-PUBLIC-SETTINGS.env
ACC=<team>/runtime/production-accounts/accounts.sqlite; LOG=$H/logs/rollback-$NOW.log
wid()  { case $1 in eden) echo pm-preview-eden-20261005;; mars) echo mars-2026-1;; littlemartians) echo littlemartians-1;; esac; }
ddir() { case $1 in eden) echo <team>/previews/20261007-edge/eden-data;; *) echo <team>/previews/20261010-restoration-auth/canonical-$1-data;; esac; }
say() { echo "[$(date -u +%T)] $*" | tee -a "$LOG"; }
mkdir -p $H/logs
# 1
ssh $E2 "set -e; B=/etc/caddy/sites/sim.caddy.pre-cloud2-$TS.bak; test -f \$B; cp -a /etc/caddy/sites/sim.caddy /etc/caddy/sites/sim.caddy.post-cloud2-$NOW.bak; cp -a \$B /etc/caddy/sites/sim.caddy
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 && systemctl reload caddy && echo caddy restored from \$B" | tee -a "$LOG"
# 2
ssh $E2 'systemctl disable --now sim-old-proxy sim-old@eden sim-old@mars sim-old@littlemartians 2>&1 | tail -1; systemctl is-active sim-old@eden sim-old@mars sim-old@littlemartians || true' | tee -a "$LOG"
# 3
for w in eden mars littlemartians accounts; do
  if [ $w = accounts ]; then src=/srv/sim-old-data/accounts/accounts.sqlite; dst=$ACC; else src=/srv/sim-old-data/$w/sim.db; dst=$(ddir $w)/sim.db; fi
  ssh $E2 "python3 /srv/sim-old/current/bin/online-backup.py $src /srv/sim-old-data/rollback-$w.db" | tee -a "$LOG"
  for f in "$dst" "$dst-wal" "$dst-shm"; do if [ -e "$f" ]; then mv "$f" "$f.pre-rollback-$NOW"; fi; done
  cp -c "$dst.pre-rollback-$NOW" "$dst"            # APFS clone: rsync then pulls only eden2's changed pages
  rsync -az --inplace $E2:/srv/sim-old-data/rollback-$w.db "$dst"; ssh $E2 "rm -f /srv/sim-old-data/rollback-$w.db"
  [ $w = accounts ] || say "$w now $(python3 $H/bin/parity.py "$dst" $(wid $w))"
done
# 4
for w in eden mars littlemartians; do
  (cd /tmp && AUTH_PROVIDER=clerk ACCOUNT_REGISTRY_PATH=$ACC nohup $N --experimental-transform-types --env-file=$ENV $H/bin/run-world.mjs $H/rollback/descriptors/$w.json >> $H/logs/laptop-$w-$NOW.log 2>&1 < /dev/null &)
done
for w in eden mars littlemartians; do for i in $(seq 1 100); do grep -q '"phase":"ready"' $H/logs/laptop-$w-$NOW.log 2>/dev/null && break; sleep 3; done
  say "$w: $(grep -h '"phase":"ready"' $H/logs/laptop-$w-$NOW.log || echo "NOT READY - see $H/logs/laptop-$w-$NOW.log")"; done
for w in eden mars littlemartians; do say "public /w/$w/v1/config $(curl -s -o /dev/null -w '%{http_code}' https://sim.eden.art/w/$w/v1/config)"; done
say "ROLLBACK DONE (laptop proxy :4970 routes to the restarted writers; if it was stopped meanwhile, restart it per team/lanes/release.md)."

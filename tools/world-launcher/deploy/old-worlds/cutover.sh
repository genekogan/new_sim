#!/usr/bin/env bash
# Old worlds (/w/eden, /w/mars, /w/littlemartians and the root site) -> eden2, ON THE CURRENT RELEASE. Lane CLOUD2 2026-10-11;
# lane KIT 2026-10-15 (1080cfa9 copies); lane L2 2026-10-17: eden2 now runs them on this release, in the world launcher's
# old-world fork mode at the site root (stage `legacy`, unit sim-worlds@legacy, port 4670, legacy-stage.sh; README.md).
# Run ON THE LAPTOP, only with Gene's go and an announced freeze (measured in the L2 rehearsal; see t3-d2-laptop-exit.md).
#   bash cutover.sh              preflight only (changes nothing anywhere)
#   bash cutover.sh --go "who"   preflight, stage setup, pre-sync, start the empty legacy launcher, FREEZE (normal-close the 3
#                                laptop writers), final compact copy + exact parity, register the 3 worlds on eden2, Caddy
#                                catch-all -> 4670, public check, enable.
# Data: compact-copy.py (one read-only snapshot; all rows except the dead take_chunks/take_archives recordings, which
# neither the 1080cfa9 servers nor this release read or write; Gene 2026-10-11). The laptop DBs keep every recording, untouched.
# Never touched: the laptop proxy (:4970) and SSH tunnel (eden2:4505 -> :4970) stay up for rollback (rollback.sh);
# /worlds (Caddy -> :4620, sim-worlds@production); /opt/eden3; the mars user; DNS; firewall. No force kill, no lock deletion
# on the laptop.
set -euo pipefail
H=<team>/runtime/sim-old-cloud; . "$(dirname "$0")/../deploy-env.sh"; E2="${RB_E2:-$(deploy_target)}" || exit 2; TS=$(date -u +%Y%m%d-%H%M%S); LOG=$H/logs/cutover-$TS.log
GO=""; [ "${1:-}" = "--go" ] && GO="${2:?--go needs a name}"
RUNNER=<team>/reviews/convergence-world-run.mjs
ACC=<team>/runtime/production-accounts/accounts.sqlite
RECEIPTS=<team>/reviews/convergence-cutover-1080cfa9-001/run   # convergence runner's CLOSURE.json root
BUILD=$(cat $H/bin/LEGACY-RELEASE)   # we-<sha12>-root, the release staged for the legacy stage (release.sh legacy)
REL=/srv/sim-old/releases/$BUILD; LS="$REL/tools/world-launcher/deploy/old-worlds/legacy-stage.sh"
RBIN=$REL/tools/world-launcher/deploy/old-worlds; RDATA=/srv/sim-worlds-data/legacy; LUNIT=sim-worlds@legacy
WORLDS="eden mars littlemartians"
port() { case $1 in eden) echo 4950;; mars) echo 4963;; littlemartians) echo 4964;; esac; }
wid()  { case $1 in eden) echo pm-preview-eden-20261005;; mars) echo mars-2026-1;; littlemartians) echo littlemartians-1;; esac; }
ddir() { case $1 in eden) echo <team>/previews/20261007-edge/eden-data;; *) echo <team>/previews/20261010-restoration-auth/canonical-$1-data;; esac; }
DESC=$H/rollback/descriptors-1080cfa9
writer() { pgrep -f "convergence-world-run\.mjs $1 /|run-world\.mjs $DESC/$1\.json" || true; }   # current writer: live runner, or run-world.mjs after a rollback
say() { echo "[$(date -u +%T)] $*" | tee -a "$LOG"; }
die() { say "STOP: $*"; exit 1; }
mkdir -p $H/logs
say "cutover $TS ${GO:+GO by $GO}"

# 0. preflight (read-only everywhere)
free=$(df -g /System/Volumes/Data | awk 'NR==2{print $4}'); [ "$free" -ge 5 ] || die "laptop disk ${free}G free"
for w in $WORLDS; do p=$(writer $w); [ -n "$p" ] || die "no laptop writer for $w"
  [ "$(echo "$p" | wc -l | tr -d ' ')" = 1 ] || die "$w: more than one writer ($p)"
  [ "$(/usr/sbin/lsof -nP -iTCP:$(port $w) -sTCP:LISTEN -t)" = "$p" ] || die "$w port $(port $w) not owned by writer $p"
  ps -o command= -p $p | grep -qE "$RUNNER $w |run-world\.mjs $DESC/$w\.json" || die "$w writer $p command differs"
  [ -f "$(ddir $w)/sim.db" ] || die "$w data missing"; say "laptop $w writer $p :$(port $w) $(ddir $w)"; done
pp=$(/usr/sbin/lsof -nP -iTCP:4970 -sTCP:LISTEN -t || true); [ -n "$pp" ] && say "laptop proxy $pp :4970 (left running)" || say "WARN: no laptop proxy on :4970 (rollback needs it)"
pgrep -f "4505:127.0.0.1:4970" >/dev/null && say "laptop tunnel eden2:4505 -> :4970 up (left running)" || say "WARN: laptop tunnel to eden2:4505 not found (rollback needs it)"
ssh $E2 "set -e; test -d $REL || { echo 'release $REL not uploaded (release.sh legacy)'; exit 1; }
  ( cd $REL && sha256sum -c --quiet FILES.sha256 >/dev/null 2>&1 ) || { echo 'release $BUILD files differ from FILES.sha256'; exit 1; }
  test -f /etc/systemd/system/sim-worlds@.service && test -f /etc/sim-worlds/production-auth.env
  [ \"\$(grep -c 'reverse_proxy 127.0.0.1:4505' /etc/caddy/sites/sim.caddy)\" = 1 ] || { echo 'sim.caddy: expected exactly one 4505 catch-all'; exit 1; }
  ! grep -q 'reverse_proxy 127.0.0.1:4670' /etc/caddy/sites/sim.caddy || { echo 'sim.caddy already routes to 4670'; exit 1; }
  for m in $RDATA/SERVED-*; do case \"\$m\" in *'*'*|*.rolledback-*) ;; *) echo \"unconsumed \$m from an earlier cutover: finish its rollback first\"; exit 1;; esac; done
  ! systemctl is-active -q sim-old-proxy sim-old@eden sim-old@mars sim-old@littlemartians || { echo 'a 1080cfa9 sim-old unit is running (the old kit): stop it first'; exit 1; }
  free=\$(df --output=avail -BG /srv | tail -1 | tr -dc 0-9); [ \"\$free\" -ge 8 ] || { echo \"eden2 disk \${free}G < 8G\"; exit 1; }
  mem=\$(awk '/MemAvailable/{print int(\$2/1024)}' /proc/meminfo); [ \"\$mem\" -ge 3500 ] || { echo \"eden2 MemAvailable \${mem}M < 3500M (the legacy stage needs ~1.6-3 GB)\"; exit 1; }
  if bash $LS check; then echo \"eden2 ok: stage ready\"; elif [ -n '$GO' ]; then echo 'eden2: stage not set up yet; --go sets it up first'; else echo 'eden2: stage not set up yet (cutover --go runs legacy-stage.sh setup first)'; fi
  echo \"eden2 ok: release $BUILD verified, disk \${free}G free, MemAvailable \${mem}M\"" | tee -a "$LOG" || die "eden2 preflight failed"
HELPERS="parity.py compact-copy.py online-backup.py dbhash.py"
lh=$(cd $H/bin && shasum -a 256 $HELPERS | awk '{print $1" "$2}'); rh=$(ssh $E2 "cd $RBIN && sha256sum $HELPERS" | awk '{print $1" "$2}')
[ "$lh" = "$rh" ] && say "helpers identical on laptop and eden2 ($HELPERS)" || die "eden2 helper scripts differ from the laptop run copies (copy tools/world-launcher/deploy/old-worlds/ of $BUILD into $H/bin)"
for w in $WORLDS; do say "laptop $w now $(python3 $H/bin/parity.py "$(ddir $w)/sim.db" $(wid $w))"; done
[ -n "$GO" ] || { say "preflight PASS (no --go: nothing changed)"; exit 0; }

# 1. stage setup (idempotent), pre-sync while the site is still up (warms rsync so the frozen delta is small), start the
#    legacy launcher with no worlds (not public: Caddy still routes the catch-all to the laptop)
ssh $E2 "bash $LS setup && bash $LS check" | tee -a "$LOG" || die "eden2 stage setup failed (laptop untouched)"
sync_world() { # $1 world: compact read-only copy to stage, rsync into $RDATA/worlds/$1/sim.db
  python3 $H/bin/compact-copy.py "$(ddir $1)/sim.db" $H/stage/$1/sim.db | tee -a "$LOG"
  ssh $E2 "D=$RDATA/worlds/$1; rm -f \$D/sim.db-wal \$D/sim.db-shm \$D/sim.db-journal \$D/edge-server.lock \$D/world-server.lock"
  rsync -az $H/stage/$1/sim.db $E2:$RDATA/worlds/$1/sim.db; }
for w in $WORLDS; do say "pre-sync $w"; sync_world $w; done
ssh $E2 "chown -R simworlds:simworlds $RDATA && bash $LS start" | tee -a "$LOG" || die "eden2 legacy launcher did not start (laptop untouched; nothing is public on eden2)"

# From here on the laptop writers may be closed: any unexpected error says so and points at rollback.
set -E; trap 'say "STOP: unexpected error (line $LINENO) after the freeze began; laptop writers may be closed: run bash $H/bin/rollback.sh $TS"' ERR
# 2. FREEZE: normal close (SIGTERM -> the runner closes the server: clock stops, snapshot saved, CLOSURE.json), no force kill
say "FREEZE: closing laptop writers"
for w in $WORLDS; do p=$(writer $w); [ "$(/usr/sbin/lsof -nP -iTCP:$(port $w) -sTCP:LISTEN -t)" = "$p" ] || die "$w identity changed"
  # SIGTERM; done when the process exits, or (convergence runner, which never exits) when its CLOSURE.json names it, its lock is
  # released and the port is closed: only then is the lingering, already-closed process SIGKILLed. Nothing else is ever forced.
  r=$(bash $H/bin/close-writer.sh --term $w $p $(port $w) "$(ddir $w)" $RECEIPTS 120) || die "$w writer $p: $r (no force kill; investigate, then rollback.sh $TS)"
  say "$w writer $p: $r"
  [ -z "$(/usr/sbin/lsof -nP -iTCP:$(port $w) -sTCP:LISTEN -t)" ] || die "$w port still listening"
  for l in edge-server.lock world-server.lock; do [ ! -e "$(ddir $w)/$l" ] || die "$w lock $l remains (rollback.sh $TS)"; done
  say "closed $w ($p)"; done

# 3. final copy + exact parity (events, max seq, Souls hash, conversations/turns/speech, accounts, snapshots, prefix hash)
for w in $WORLDS; do sync_world $w
  a=$(python3 $H/bin/parity.py "$(ddir $w)/sim.db" $(wid $w)); b=$(ssh $E2 "python3 $RBIN/parity.py $RDATA/worlds/$w/sim.db $(wid $w)")
  say "parity $w laptop $a"; say "parity $w eden2  $b"; [ "$a" = "$b" ] || die "$w parity differs (laptop writers are closed: run rollback.sh $TS)"; done
python3 $H/bin/online-backup.py $ACC $H/stage/accounts/accounts.sqlite | tee -a "$LOG"
ssh $E2 "rm -f $RDATA/forks/accounts.sqlite-wal $RDATA/forks/accounts.sqlite-shm"
rsync -a $H/stage/accounts/accounts.sqlite $E2:$RDATA/forks/accounts.sqlite
ssh $E2 "chown -R simworlds:simworlds $RDATA"

# 4. register the three worlds on the running legacy launcher (each boots on the copied data; fork-world.mjs gates: Clerk +
#    the old account registry, history never shrinks, Soul rows unchanged by boot), then check identities on :4670
ssh $E2 "set -e; bash $LS register
  for w in eden mars littlemartians; do curl -sf -H 'Host: sim.eden.art' http://127.0.0.1:4670/w/\$w/v1/config | python3 -c \"import json,sys;d=json.load(sys.stdin);assert d['build']=='$BUILD' and d['worldPath']=='/w/'+d['worldKey'];print('eden2 legacy',d['worldKey'],d['worldId'],d['build'])\"; done" | tee -a "$LOG" || die "eden2 start failed (run rollback.sh $TS)"

# 5. Caddy: catch-all from the tunnel (4505) to the eden2 proxy (4670); /worlds unchanged
# The SERVED marker (written BEFORE the change) tells rollback.sh that eden2 may have served the public, whatever TS is typed.
ssh $E2 "set -e; touch $RDATA/SERVED-$TS; cp -a /etc/caddy/sites/sim.caddy /etc/caddy/sites/sim.caddy.pre-kit-$TS.bak
  sed -i 's#reverse_proxy 127.0.0.1:4505#reverse_proxy 127.0.0.1:4670#' /etc/caddy/sites/sim.caddy
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || { cp -a /etc/caddy/sites/sim.caddy.pre-kit-$TS.bak /etc/caddy/sites/sim.caddy; echo 'caddy validate failed: file restored (Caddy still on 4505)'; exit 1; }
  systemctl reload caddy || { cp -a /etc/caddy/sites/sim.caddy.pre-kit-$TS.bak /etc/caddy/sites/sim.caddy; systemctl reload caddy && echo 'caddy reload failed: file restored and reloaded on 4505' || echo 'caddy reload failed twice: file restored to 4505, running Caddy state unknown'; exit 1; }
  echo caddy reloaded, backup sim.caddy.pre-kit-$TS.bak" | tee -a "$LOG" || die "Caddy change failed (file restored; run rollback.sh $TS to restart laptop writers)"

# 6. public check (as a stranger)
sleep 3; for w in $WORLDS; do
  curl -sf https://sim.eden.art/w/$w/v1/config | python3 -c "import json,sys;d=json.load(sys.stdin);assert d['worldId']=='$(wid $w)' and d['build']=='$BUILD';print('public',d['worldKey'],d['worldId'],d['build'])" | tee -a "$LOG" || die "public $w check failed (run rollback.sh $TS)"; done
curl -sf -o /dev/null https://sim.eden.art/ && say "public / 200"; say "public /worlds $(curl -s -o /dev/null -w '%{http_code}' https://sim.eden.art/worlds/)"
CLI_SHA=$(ssh $E2 "sha256sum $REL/tools/world-launcher/soul/eden-agent.mjs" | cut -d' ' -f1)
[ "$(curl -s https://sim.eden.art/eden-agent.mjs | shasum -a 256 | cut -d' ' -f1)" = "$CLI_SHA" ] && say "public CLI ${CLI_SHA:0:8} ok (this release's)" || say "WARN: public CLI sha differs from $BUILD's"

# 7. persist across reboots
ssh $E2 "systemctl enable $LUNIT 2>&1 | tail -1; systemctl enable --now sim-worlds-backup@legacy.timer 2>&1 | tail -1"   # nightly 03:30 UTC copies
say "CUTOVER DONE ($BUILD). Laptop writers stopped (data intact), laptop proxy + tunnel untouched. Walk each world dpr 1/2 now. Rollback: bash $H/bin/rollback.sh $TS"

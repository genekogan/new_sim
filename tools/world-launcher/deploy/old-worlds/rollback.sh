#!/usr/bin/env bash
# Roll the old worlds back to the laptop after cutover.sh. Lane CLOUD2 2026-10-11; rewritten by lane KIT 2026-10-15
# after safety review KIT-REVIEW-1 (team/reviews/sim-release-20261015/). Run ON THE LAPTOP. Safe to re-run.
#   bash rollback.sh <cutover-TS>        (TS from the cutover log name, e.g. 20261016-140000)
# 0 Classify each world on the laptop: SERVED (its port still has a listener: left alone), HUNG (a writer for it is
#   alive but not listening: waited for up to RB_HUNG_WAIT s, then SIGKILLed: its close already stopped the world clock,
#   SQLite commits are durable, and the servers treat a lock held by a dead PID as stale), or CLOSED.
# 1 Caddy: the catch-all `reverse_proxy 127.0.0.1:4670` is switched back to 4505 (sed on that line only; other edits made
#   since cutover are kept; backup sim.caddy.post-kit-<now>.bak), validate, reload. Anything else -> STOP before touching
#   eden2 or the laptop data. eden2 is never stopped while Caddy might still route to it.
# 2 Stop + disable the eden2 sim-old units (SIGTERM = normal close with snapshot).
# 3 History back, only if eden2 was public (sim.caddy had 4670 or the cutover backup sim.caddy.pre-kit-<TS>.bak exists)
#   and only for CLOSED/HUNG worlds: full parity JSON compared; eden2 copied back only when it differs AND extends the
#   laptop history (eden2 maxSeq >= laptop, and eden2's event prefix up to the laptop maxSeq hashes the same). A compact
#   snapshot is pulled to <db>.incoming-<now>, verified (parity == eden2's, quick_check), and only then are the laptop
#   originals RENAMED to *.pre-rollback-<now> (never deleted). eden2 unreadable or diverged -> that world's data untouched
#   and its writer NOT restarted (STOP note). Accounts registry likewise by content hash (dbhash.py).
# 4 Restart the writers of CLOSED/HUNG worlds that passed 3: run-world.mjs + the live descriptors, Clerk env-file and
#   registry by path, detached in their own session (setsid via python; immune to closing the Terminal).
# Test hooks (rehearsal on scratch copies only; never set them for the real rollback): RB_E2 RB_RDATA RB_CADDY
# RB_CADDY_VALIDATE RB_CADDY_RELOAD RB_UNITS RB_LAPTOP_ROOT RB_ACC RB_DESC RB_LPORTS RB_PORT_MAP RB_HUNG_WAIT RB_PUBLIC RB_LOG_DIR.
set -uo pipefail
TS=${1:?usage: rollback.sh <cutover-TS>}; H=<team>/runtime/sim-old-cloud; NOW=$(date -u +%Y%m%d-%H%M%S)
N=~/.nvm/versions/node/v22.20.0/bin/node; ENV=<team>/pm-integration/auth-account-20261009/clerk-publication-types-003/STAGED-PUBLIC-SETTINGS.env
E2=${RB_E2:-root@eden2}; RDATA=${RB_RDATA:-/srv/sim-old-data}; RBIN=/srv/sim-old/current/bin
CADDY=${RB_CADDY:-/etc/caddy/sites/sim.caddy}
CVALIDATE=${RB_CADDY_VALIDATE:-caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile}; CRELOAD=${RB_CADDY_RELOAD:-systemctl reload caddy}
UNITS=${RB_UNITS-sim-old-proxy sim-old@eden sim-old@mars sim-old@littlemartians}
ACC=${RB_ACC:-<team>/runtime/production-accounts/accounts.sqlite}; DESC=${RB_DESC:-$H/rollback/descriptors-1080cfa9}
LPORTS=${RB_LPORTS:-eden:4950,mars:4963,littlemartians:4964}; HUNG_WAIT=${RB_HUNG_WAIT:-120}; PUBLIC=${RB_PUBLIC:-1}
LOGD=${RB_LOG_DIR:-$H/logs}; LOG=$LOGD/rollback-$NOW.log
if [ -n "${RB_LAPTOP_ROOT:-}" ]; then   # test mode: everything must point at scratch
  case "$RDATA:$CADDY" in /srv/sim-old-rbtest/*:/srv/sim-old-rbtest/*) ;; *) echo "test mode needs RB_RDATA and RB_CADDY under /srv/sim-old-rbtest"; exit 2;; esac
  [ -n "${RB_ACC:-}" ] && [ -n "${RB_DESC:-}" ] && [ -n "${RB_LPORTS:-}" ] || { echo "test mode needs RB_ACC RB_DESC RB_LPORTS"; exit 2; }
fi
WORLDS="eden mars littlemartians"
wid()  { case $1 in eden) echo pm-preview-eden-20261005;; mars) echo mars-2026-1;; littlemartians) echo littlemartians-1;; esac; }
lport() { echo "$LPORTS" | tr ',' '\n' | awk -F: -v w=$1 '$1==w{print $2}'; }
ddir() { if [ -n "${RB_LAPTOP_ROOT:-}" ]; then echo $RB_LAPTOP_ROOT/$1; else case $1 in eden) echo <team>/previews/20261007-edge/eden-data;; *) echo <team>/previews/20261010-restoration-auth/canonical-$1-data;; esac; fi; }
# Test mode must only ever see its own scratch writers (2026-10-15 incident: the unscoped pattern matched the LIVE
# convergence writers during a rehearsal and SIGKILLed Mars + LM).
writers() { if [ -n "${RB_LAPTOP_ROOT:-}" ]; then pgrep -f "run-world\.mjs $DESC/$1\.json" || true; else pgrep -f "convergence-world-run\.mjs $1 /|run-world\.mjs $DESC/$1\.json" || true; fi; }
listener() { /usr/sbin/lsof -nP -iTCP:$(lport $1) -sTCP:LISTEN -t 2>/dev/null || true; }
lockpid() { python3 -c 'import json,sys,os
try: p=json.load(open(sys.argv[1]))["pid"]; os.kill(p,0); print(p)
except Exception: pass' "$(ddir $1)/edge-server.lock"; }
say() { echo "[$(date -u +%T)] $*" | tee -a "$LOG"; }
e2() { ssh -o BatchMode=yes -o ConnectTimeout=10 $E2 "$@"; }
jget() { python3 -c 'import json,sys
try: d=json.loads(sys.argv[1]); v=d[sys.argv[2]]; assert v is not None; print(v)
except Exception: sys.exit(1)' "$1" "$2"; }
mkdir -p "$LOGD"; say "rollback for cutover $TS (log $LOG)"
st() { eval "echo \${ST_$1:-}"; }; setst() { eval "ST_$1=$2"; }

# 0 classify (changes nothing)
for w in $WORLDS; do
  lp=$(lockpid $w); wp=$(writers $w | tr '\n' ' ')
  if [ -n "$(listener $w)" ]; then setst $w SERVED; say "$w: laptop :$(lport $w) still served by pid $(listener $w) -> left alone"
  elif [ -n "${wp// /}" ]; then setst $w HUNG; say "$w: writer(s) $wp alive but not listening (hung close)"
  elif [ -n "$lp" ]; then setst $w FAILED; say "STOP-NOTE $w: lock names live pid $lp that is not a writer for this world; check by hand (never killed)"
  else setst $w CLOSED; say "$w: closed"; fi
done

# 1 Caddy back to the tunnel (or confirm it already is). Any doubt -> STOP with nothing else changed.
CR=$(e2 "set -e; F=$CADDY; n5=\$(grep -c 'reverse_proxy 127.0.0.1:4505' \$F || true); n6=\$(grep -c 'reverse_proxy 127.0.0.1:4670' \$F || true)
  served=0; [ \"\$n6\" -gt 0 ] && served=1; [ -f \$(dirname \$F)/sim.caddy.pre-kit-$TS.bak ] && served=1
  if [ \"\$n6\" = 1 ] && [ \"\$n5\" = 0 ]; then cp -a \$F \$(dirname \$F)/sim.caddy.post-kit-$NOW.bak; sed -i 's#reverse_proxy 127.0.0.1:4670#reverse_proxy 127.0.0.1:4505#' \$F
    if ! $CVALIDATE >/dev/null 2>&1; then cp -a \$(dirname \$F)/sim.caddy.post-kit-$NOW.bak \$F; echo \"RESULT=validate-failed served=\$served\"; exit 0; fi
    if ! $CRELOAD; then echo \"RESULT=reload-failed served=\$served (file now 4505, running Caddy may still route to 4670)\"; exit 0; fi
    echo \"RESULT=restored served=\$served\"
  elif [ \"\$n6\" = 0 ] && [ \"\$n5\" = 1 ]; then echo \"RESULT=already served=\$served\"
  else echo \"RESULT=unknown n4505=\$n5 n4670=\$n6 served=\$served\"; fi" 2>&1)
say "caddy: ${CR:-<no answer from $E2>}"
case "$CR" in *RESULT=restored*|*RESULT=already*) ;;
  *) say "STOP: Caddy not confirmed back on the tunnel (4505). eden2 left running, laptop untouched. Fix Caddy, then re-run rollback.sh $TS"; exit 1;; esac
SERVED=0; case "$CR" in *served=1*) SERVED=1;; esac

# 2 stop eden2 (Caddy no longer routes to it)
if [ -n "$UNITS" ]; then e2 "systemctl disable --now $UNITS 2>&1 | tail -1; systemctl is-active $UNITS | tr '\n' ' '" | tee -a "$LOG"
  [ "${PIPESTATUS[0]}" = 0 ] || { say "STOP: could not stop eden2 units; laptop untouched"; exit 1; }
else say "(no eden2 units configured: test mode)"; fi

# HUNG writers: wait, then kill (world already down; its close stopped the clock)
for w in $WORLDS; do [ "$(st $w)" = HUNG ] || continue
  p=$(writers $w | tr '\n' ' '); for i in $(seq 1 $HUNG_WAIT); do alive=; for x in $p; do kill -0 $x 2>/dev/null && alive=1; done; [ -z "$alive" ] && break; sleep 1; done
  for x in $p; do kill -0 $x 2>/dev/null && { say "$w: SIGKILL hung writer $x after ${HUNG_WAIT}s"; kill -KILL $x; }; done; sleep 1
  for x in $p; do kill -0 $x 2>/dev/null && { setst $w FAILED; say "STOP-NOTE $w: writer $x survived SIGKILL; not restarted"; }; done
  [ -n "$(listener $w)" ] && { setst $w FAILED; say "STOP-NOTE $w: port :$(lport $w) taken meanwhile; not restarted"; }
done

# 3 history back (only if eden2 was public)
pull() { # $1 world|accounts  $2 laptop dst  $3 remote src  $4 expected-json  $5 verify command, {} = the pulled file
  local w=$1 dst=$2 src=$3 want=$4 inc="$2.incoming-$NOW"
  e2 "rm -f $RDATA/rollback-$w.db; python3 $RBIN/$([ $w = accounts ] && echo online-backup.py || echo compact-copy.py) $src $RDATA/rollback-$w.db >/dev/null" || { say "STOP-NOTE $w: snapshot on eden2 failed; laptop untouched"; return 1; }
  rsync -az $E2:$RDATA/rollback-$w.db "$inc" || { rm -f "$inc"; say "STOP-NOTE $w: copy failed; laptop untouched"; return 1; }
  got=$(eval "${5//\{\}/\"$inc\"}"); ok=$(python3 -c "import sqlite3,sys;print(sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True).execute('pragma quick_check').fetchone()[0])" "$inc")
  [ "$got" = "$want" ] && [ "$ok" = ok ] || { say "STOP-NOTE $w: pulled copy does not verify (got $got, quick_check $ok); kept as $inc, laptop untouched"; return 1; }
  for f in "$dst" "$dst-wal" "$dst-shm"; do [ -e "$f" ] && mv "$f" "$f.pre-rollback-$NOW"; done
  mv "$inc" "$dst" && e2 "rm -f $RDATA/rollback-$w.db"; say "$w: eden2 history copied back (originals kept as *.pre-rollback-$NOW)"; }
if [ $SERVED = 0 ]; then say "eden2 never served the public for $TS: laptop data is authoritative, nothing copied back"
else for w in $WORLDS; do case $(st $w) in CLOSED|HUNG) ;; *) continue;; esac
  dst=$(ddir $w)/sim.db; src=$RDATA/$w/sim.db
  a=$(python3 $H/bin/parity.py "$dst" $(wid $w) 2>/dev/null); b=$(e2 "python3 $RBIN/parity.py $src $(wid $w)" 2>/dev/null)
  am=$(jget "$a" maxSeq) && bm=$(jget "$b" maxSeq) || { setst $w FAILED; say "STOP-NOTE $w: cannot read parity (laptop '${a:0:60}', eden2 '${b:0:60}'); laptop untouched, not restarted"; continue; }
  say "$w laptop $a"; say "$w eden2  $b"
  if [ "$a" = "$b" ]; then say "$w: identical, laptop kept"; continue; fi
  b2=$(e2 "python3 $RBIN/parity.py $src $(wid $w) $am" 2>/dev/null)
  if [ "$bm" -ge "$am" ] && [ -n "$b2" ] && [ "$(jget "$b2" prefixSHA256)" = "$(jget "$a" prefixSHA256)" ]; then
    pull $w "$dst" $src "$b" "python3 $H/bin/parity.py {} $(wid $w)" || setst $w FAILED
  else setst $w FAILED; say "STOP-NOTE $w: eden2 history does not extend the laptop's (maxSeq $bm vs $am or prefix differs); laptop untouched, not restarted"; fi
done
  ha=$(python3 $H/bin/dbhash.py "$ACC" 2>/dev/null); hb=$(e2 "python3 $RBIN/dbhash.py $RDATA/accounts/accounts.sqlite" 2>/dev/null)
  if ! jget "$hb" sha256 >/dev/null; then say "WARN accounts: eden2 registry unreadable; laptop registry kept"
  elif [ "$ha" = "$hb" ]; then say "accounts: identical, laptop kept"
  else pull accounts "$ACC" $RDATA/accounts/accounts.sqlite "$hb" "python3 $H/bin/dbhash.py {}" || say "WARN accounts: laptop registry kept"; fi
fi

# 4 restart laptop writers (detached session)
for w in $WORLDS; do case $(st $w) in CLOSED|HUNG) ;; *) continue;; esac
  L=$LOGD/laptop-$w-$NOW.log
  (cd /tmp && SIM_PORT_MAP=${RB_PORT_MAP:-} AUTH_PROVIDER=clerk ACCOUNT_REGISTRY_PATH=$ACC nohup python3 -c 'import os,sys;os.setsid();os.execvp(sys.argv[1],sys.argv[1:])' \
    $N ${RB_PORT_MAP:+--import=$H/bin/port-map.mjs} --experimental-transform-types --env-file=$ENV $H/bin/run-world.mjs $DESC/$w.json >> $L 2>&1 < /dev/null &)
  setst $w STARTED; done
for w in $WORLDS; do [ "$(st $w)" = STARTED ] || continue; L=$LOGD/laptop-$w-$NOW.log
  for i in $(seq 1 100); do grep -q '"phase":"ready"' $L 2>/dev/null && break; grep -q 'refused\|^Error' $L 2>/dev/null && break; sleep 3; done
  say "$w: $(grep -h '"phase":"ready"' $L | cut -c1-220 || echo "NOT READY - see $L")"; done
[ "$PUBLIC" = 1 ] && for w in $WORLDS; do say "public /w/$w/v1/config $(curl -s -o /dev/null -w '%{http_code}' https://sim.eden.art/w/$w/v1/config)"; done
say "ROLLBACK END: $(for w in $WORLDS; do printf '%s=%s ' $w $(st $w); done)(SERVED=left alone, STARTED=restarted, FAILED=see STOP-NOTE)"
say "Laptop proxy :4970 routes to the restarted writers; if it was stopped meanwhile, restart it from team/reviews/convergence-ops-1080cfa9-001/PROXY.json."
grep -q STOP-NOTE "$LOG" && exit 1 || exit 0

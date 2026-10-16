#!/usr/bin/env bash
# Roll the old worlds back to the laptop after cutover.sh. Lane CLOUD2 2026-10-11; rewritten by lane KIT 2026-10-15 after
# safety review KIT-REVIEW-1 and incident INCIDENT-20261015-MARS-LM (team/reviews/sim-release-20261015/). Run ON THE LAPTOP.
#   bash rollback.sh <cutover-TS>        (TS from the cutover log name, e.g. 20261016-140000). Safe to re-run.
# 0 Classify each world on the laptop: SERVED (its port has a listener: left alone), HUNG (one of its writers is alive but
#   not listening: waited up to RB_HUNG_WAIT s, then SIGKILLed; its close already stopped the world clock, SQLite commits
#   are durable, and the servers treat a lock held by a dead PID as stale) or CLOSED. A lock naming a live PID that is not
#   a writer of that world -> FAILED (never signalled).
# 1 Caddy: the catch-all `reverse_proxy 127.0.0.1:4670` goes back to 4505 (sed on that line only; other edits kept; backup
#   sim.caddy.post-kit-<now>.bak), validate, reload. Anything else -> STOP before touching eden2 or the laptop data.
# 2 Stop + disable the eden2 sim-old units (only now that Caddy no longer routes to them).
# 3 History back, only if eden2 was public (sim.caddy had 4670, or eden2 holds a SERVED-<TS> marker written by cutover before
#   its Caddy change and consumed only by a rollback that completed; independent of the TS you type) and
#   only for CLOSED/HUNG worlds: full parity JSON compared; eden2 copied back only when it differs AND extends the laptop
#   history (eden2 maxSeq >= laptop and eden2's event prefix up to the laptop maxSeq hashes the same). The compact snapshot
#   lands in <db>.incoming-<now>, is verified (parity incl. a row hash == eden2's, quick_check), and only then are the laptop
#   originals MOVED together (db + -wal + -shm) into pre-rollback-<now>/ next to them (never deleted). eden2 unreadable or diverged -> that world untouched and NOT restarted.
#   Accounts registry likewise by content hash (dbhash.py).
# 4 Restart the writers of CLOSED/HUNG worlds that passed 3: run-world.mjs (which ignores SIGHUP) + the live descriptors,
#   Clerk env-file and registry by path, in a new session (python os.setsid; no controlling terminal).
#
# TEST MODE (RB_LAPTOP_ROOT set) exists only for the rehearsal on eden2 (rollback-rehearsal.sh); it refuses to run on macOS.
# In test mode the script signals only PIDs listed in $RB_LAPTOP_ROOT/.pids (written by whoever spawned them) whose args
# name the scratch descriptor and whose cwd is inside the scratch tree, and aborts if any target is a live writer
# (listener on 4950/4963/4964/4970/4660-4662, a convergence/run-world writer outside the scratch tree, or a sim-old unit).
set -uo pipefail
TS=${1:?usage: rollback.sh <cutover-TS>}; H=<team>/runtime/sim-old-cloud; NOW=$(date -u +%Y%m%d-%H%M%S)
KITBIN=${RB_KITBIN:-$H/bin}; N=${RB_NODE:-~/.nvm/versions/node/v22.20.0/bin/node}
ENV=${RB_ENV:-<team>/pm-integration/auth-account-20261009/clerk-publication-types-003/STAGED-PUBLIC-SETTINGS.env}
E2=${RB_E2:-root@eden2}; RDATA=${RB_RDATA:-/srv/sim-old-data}; RBIN=/srv/sim-old/current/bin
CADDY=${RB_CADDY:-/etc/caddy/sites/sim.caddy}
CVALIDATE=${RB_CADDY_VALIDATE:-caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile}; CRELOAD=${RB_CADDY_RELOAD:-systemctl reload caddy}
UNITS=${RB_UNITS-sim-old-proxy sim-old@eden sim-old@mars sim-old@littlemartians}
ACC=${RB_ACC:-<team>/runtime/production-accounts/accounts.sqlite}; PROD_DESC=$H/rollback/descriptors-1080cfa9; DESC=${RB_DESC:-$PROD_DESC}
LPORTS=${RB_LPORTS:-eden:4950,mars:4963,littlemartians:4964}; HUNG_WAIT=${RB_HUNG_WAIT:-120}; PUBLIC=${RB_PUBLIC:-1}
LOGD=${RB_LOG_DIR:-$H/logs}; LOG=$LOGD/rollback-$NOW.log; TEST=${RB_LAPTOP_ROOT:-}
RECEIPTS=${RB_RECEIPTS:-<team>/reviews/convergence-cutover-1080cfa9-001/run}   # convergence runner CLOSURE.json root
if [ -z "$TEST" ] && env | grep -q '^RB_'; then   # KIT-REVIEW-2 #1: the real rollback never obeys test overrides
  echo "REFUSED: RB_* variables are set ($(env | grep '^RB_' | cut -d= -f1 | tr '\n' ' ')) but RB_LAPTOP_ROOT is not: this would be the real rollback."
  echo "Run it from a clean shell: env | grep '^RB_' must print nothing."; exit 2; fi
if [ -n "$TEST" ]; then
  [ "${RB_UNITS+set}" = set ] && [ -z "$RB_UNITS" ] || { echo "test mode needs RB_UNITS set and empty (never the real sim-old units)"; exit 2; }
  case "$E2" in local|*.invalid) ;; *) echo "test mode needs RB_E2=local (or an unresolvable *.invalid host)"; exit 2;; esac
  case "${RB_CADDY_VALIDATE:-}:${RB_CADDY_RELOAD:-}" in true:true|true:false|false:true|false:false) ;; *) echo "test mode needs RB_CADDY_VALIDATE and RB_CADDY_RELOAD set to true/false stand-ins"; exit 2;; esac
  [ "$(uname)" = Linux ] || { echo "test mode runs only on eden2 (never on the laptop)"; exit 2; }
  for v in "$TEST" "$RDATA" "$CADDY" "$ACC" "$DESC" "$LOGD" "$RECEIPTS"; do case "$v" in /srv/sim-old-rbtest/*) ;; *) echo "test mode: $v is outside /srv/sim-old-rbtest"; exit 2;; esac; done
  [ -n "${RB_LPORTS:-}" ] || { echo "test mode needs RB_LPORTS"; exit 2; }
  case "$LPORTS" in *49[0-9][0-9]*|*466[0-9]*|*4670*) echo "test mode: RB_LPORTS must not name live ports"; exit 2;; esac
fi
WORLDS="eden mars littlemartians"
wid()  { case $1 in eden) echo pm-preview-eden-20261005;; mars) echo mars-2026-1;; littlemartians) echo littlemartians-1;; esac; }
lport() { echo "$LPORTS" | tr ',' '\n' | awk -F: -v w=$1 '$1==w{print $2}'; }
ddir() { if [ -n "$TEST" ]; then echo $TEST/$1; else case $1 in eden) echo <team>/previews/20261007-edge/eden-data;; *) echo <team>/previews/20261010-restoration-auth/canonical-$1-data;; esac; fi; }
listeners() { if [ "$(uname)" = Darwin ]; then /usr/sbin/lsof -nP -iTCP:$1 -sTCP:LISTEN -t 2>/dev/null; else ss -ltnpH "sport = :$1" | grep -o 'pid=[0-9]*' | cut -d= -f2; fi | sort -u; }
listener() { listeners $(lport $1); }
args() { ps -o command= -p $1 2>/dev/null; }
cwd() { if [ "$(uname)" = Darwin ]; then /usr/sbin/lsof -a -p $1 -d cwd -Fn 2>/dev/null | sed -n 's/^n//p'; else readlink /proc/$1/cwd 2>/dev/null; fi; }
alive() { kill -0 $1 2>/dev/null; }
# Live writers anywhere on this host, detected generally (never hard-coded PIDs): the test mode must never target one.
live_set() { { for p in 4950 4963 4964 4970 4660 4661 4662; do listeners $p; done
  pgrep -f 'convergence-world-run\.mjs' ; pgrep -f "run-world\.mjs $PROD_DESC/"; pgrep -f 'run-world\.mjs /srv/sim-old/current/descriptors/'
  [ "$(uname)" = Linux ] && for u in sim-old@eden sim-old@mars sim-old@littlemartians sim-old-proxy; do systemctl show -p MainPID --value $u; done; } 2>/dev/null | grep -v '^0$' | sort -u; }
writers() { # $1 world -> PIDs of that world's laptop writers
  if [ -n "$TEST" ]; then
    [ -f $TEST/.pids ] || return 0
    awk -v w=$1 '$2==w{print $1}' $TEST/.pids | while read -r p; do alive $p || continue
      case "$(args $p)" in *"$DESC/$1.json"*) ;; *) echo "REFUSE:$p:args"; continue;; esac
      case "$(cwd $p)/" in "$TEST"/*) ;; *) echo "REFUSE:$p:cwd"; continue;; esac
      echo $p; done
  else pgrep -f "convergence-world-run\.mjs $1 /|run-world\.mjs $PROD_DESC/$1\.json" || true; fi; }
guard_signal() { # $1 pid: last check before any signal
  if [ -n "$TEST" ]; then live_set | grep -qx "$1" && { say "ABORT: test target $1 is a live writer; nothing signalled"; exit 3; }
    awk '{print $1}' $TEST/.pids | grep -qx "$1" || { say "ABORT: $1 not in the test pidfile; nothing signalled"; exit 3; }; fi; }
lockpid() { python3 -c 'import json,sys,os
try: p=json.load(open(sys.argv[1]))["pid"]; os.kill(p,0); print(p)
except Exception: pass' "$(ddir $1)/edge-server.lock"; }
say() { echo "[$(date -u +%T)] $*" | tee -a "$LOG"; }
if [ "$E2" = local ]; then e2() { bash -c "$*"; }; RSRC=; else e2() { ssh -o BatchMode=yes -o ConnectTimeout=10 $E2 "$@"; }; RSRC=$E2:; fi
jget() { python3 -c 'import json,sys
try: d=json.loads(sys.argv[1]); v=d[sys.argv[2]]; assert v is not None; print(v)
except Exception: sys.exit(1)' "$1" "$2"; }
receipt_names() { python3 -c 'import json,sys
try: d=json.load(open(sys.argv[1])); sys.exit(0 if d.get("closedPID")==int(sys.argv[2]) and d.get("normalClosed") is True else 1)
except Exception: sys.exit(1)' "$RECEIPTS/$1/CLOSURE.json" $2; }
st() { eval "echo \${ST_$1:-}"; }; setst() { eval "ST_$1=$2"; }
mkdir -p "$LOGD"; say "rollback for cutover $TS (log $LOG)${TEST:+ TEST MODE root $TEST}"

# 0 classify (changes nothing)
for w in $WORLDS; do
  wp=$(writers $w | tr '\n' ' '); case "$wp" in *REFUSE*) say "ABORT: $w: $wp (pid outside the scratch tree); nothing changed"; exit 3;; esac
  [ -n "$TEST" ] && for x in $wp; do guard_signal $x; done   # self-check before ANY change: no target may be a live writer
  lp=$(lockpid $w)
  if [ -n "$(listener $w)" ]; then setst $w SERVED; say "$w: :$(lport $w) still served by pid $(listener $w | tr '\n' ' ')-> left alone"
  elif [ -n "${wp// /}" ] && [ -n "$lp" ] && echo " $wp" | grep -q " $lp "; then setst $w HUNG; eval "LP_$w=$lp"; say "$w: writer $lp (holds the lock) alive but not listening (hung close)"
  elif [ "$(echo $wp | wc -w | tr -d ' ')" = 1 ] && [ -z "$lp" ] && receipt_names $w $wp; then setst $w HUNG; eval "LP_$w=$(echo $wp)"; say "$w: writer $wp closed normally (CLOSURE.json, lock released) but lingers"
  elif [ -n "${wp// /}" ]; then setst $w FAILED; say "STOP-NOTE $w: writer(s) $wp alive, not listening, not holding the lock, no closure receipt; check by hand (never signalled)"
  elif [ -n "$lp" ]; then setst $w FAILED; say "STOP-NOTE $w: lock names live pid $lp that is not a writer for this world; check by hand (never signalled)"
  else setst $w CLOSED; say "$w: closed"; fi
done

# 1 Caddy back to the tunnel (or confirm it already is). Any doubt -> STOP with nothing else changed.
CR=$(e2 "set -e; F=$CADDY; n5=\$(grep -c 'reverse_proxy 127.0.0.1:4505' \$F || true); n6=\$(grep -c 'reverse_proxy 127.0.0.1:4670' \$F || true)
  served=0; [ \"\$n6\" -gt 0 ] && served=1; [ -f \$(dirname \$F)/sim.caddy.pre-kit-$TS.bak ] && served=1
  for m in $RDATA/SERVED-*; do case \"\$m\" in *'*'*|*.rolledback-*) ;; *) served=1;; esac; done
  if [ \"\$n6\" = 1 ] && [ \"\$n5\" = 0 ]; then cp -a \$F \$(dirname \$F)/sim.caddy.post-kit-$NOW.bak; sed -i 's#reverse_proxy 127.0.0.1:4670#reverse_proxy 127.0.0.1:4505#' \$F
    if ! $CVALIDATE >/dev/null 2>&1; then cp -a \$(dirname \$F)/sim.caddy.post-kit-$NOW.bak \$F; echo \"RESULT=validate-failed served=\$served\"; exit 0; fi
    if ! $CRELOAD; then cp -a \$(dirname \$F)/sim.caddy.post-kit-$NOW.bak \$F; echo \"RESULT=reload-failed served=\$served (file restored to 4670; Caddy unchanged)\"; exit 0; fi
    echo \"RESULT=restored served=\$served\"
  elif [ \"\$n6\" = 0 ] && [ \"\$n5\" = 1 ]; then echo \"RESULT=already served=\$served\"
  else echo \"RESULT=unknown n4505=\$n5 n4670=\$n6 served=\$served\"; fi" 2>&1)
say "caddy: ${CR:-<no answer from $E2>}"
case "$CR" in *RESULT=restored*|*RESULT=already*) ;;
  *) say "STOP: Caddy not confirmed back on the tunnel (4505). eden2 left running, laptop untouched. Fix Caddy, then re-run rollback.sh $TS"; exit 1;; esac
SERVED=0; case "$CR" in *served=1*) SERVED=1;; esac

# 2 stop eden2 (Caddy no longer routes to it)
if [ -n "$UNITS" ]; then U=$(e2 "systemctl disable --now $UNITS >/dev/null 2>&1 || { echo DISABLE-FAILED; exit 1; }; systemctl is-active $UNITS | tr '\n' ' '; true"); rc=$?
  say "eden2 units after stop: $U"
  [ $rc = 0 ] && ! echo " $U " | grep -qE " (active|activating|deactivating|reloading) " || { say "STOP: could not stop eden2 units; laptop untouched"; exit 1; }
else say "eden2 units: none configured (test mode)"; fi

# HUNG writers: wait, then SIGKILL (the world is already down; its close stopped the clock)
# KIT-REVIEW-2 #3: only the PID named in the world's lock is ever signalled, and never once the world is listening again.
for w in $WORLDS; do [ "$(st $w)" = HUNG ] || continue; x=$(eval "echo \$LP_$w")
  # close-writer.sh: returns as soon as x exits, or kills x once it is a closed-but-lingering convergence runner (receipt names it,
  # lock released, port closed), or reports "listening" the moment the world is served again (then x is never signalled).
  guard_signal $x; r=$(bash $KITBIN/close-writer.sh --no-term $w $x $(lport $w) "$(ddir $w)" $RECEIPTS $HUNG_WAIT); rc=$?; say "$w: writer $x: $r"
  if [ $rc = 0 ]; then continue; fi
  if [ -n "$(listener $w)" ]; then setst $w SERVED; say "$w: started listening during the wait (pid $(listener $w | tr '\n' ' ')) -> left alone, not signalled"; continue; fi
  if alive $x; then
    [ "$(lockpid $w)" = "$x" ] && echo " $(writers $w | tr '\n' ' ') " | grep -q " $x " && [ -z "$(listener $w)" ] || { setst $w FAILED; say "STOP-NOTE $w: $x no longer the lock-holding, non-listening writer; not signalled"; continue; }
    guard_signal $x; say "$w: SIGKILL hung writer $x (lock holder) after ${HUNG_WAIT}s"; kill -KILL $x; sleep 1
    alive $x && { setst $w FAILED; say "STOP-NOTE $w: writer $x survived SIGKILL; not restarted"; continue; }; fi
  [ -n "$(writers $w | grep -v REFUSE)" ] && { setst $w FAILED; say "STOP-NOTE $w: other writer(s) $(writers $w | tr '\n' ' ')still alive; not restarted"; }
  [ -n "$(listener $w)" ] && { setst $w FAILED; say "STOP-NOTE $w: port :$(lport $w) taken meanwhile; not restarted"; }
done

# 3 history back (only if eden2 was public)
pull() { # $1 world|accounts  $2 laptop dst  $3 eden2 src  $4 expected-json  $5 verify command, {} = the pulled file
  local w=$1 dst=$2 src=$3 want=$4 inc="$2.incoming-$NOW"
  e2 "rm -f $RDATA/rollback-$w.db; python3 $RBIN/$([ $w = accounts ] && echo online-backup.py || echo compact-copy.py) $src $RDATA/rollback-$w.db >/dev/null" || { say "STOP-NOTE $w: snapshot on eden2 failed; laptop untouched"; return 1; }
  rsync -az $RSRC$RDATA/rollback-$w.db "$inc" || { rm -f "$inc"; say "STOP-NOTE $w: copy failed; laptop untouched"; return 1; }
  got=$(eval "${5//\{\}/\"$inc\"}"); ok=$(python3 -c "import sqlite3,sys;print(sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True).execute('pragma quick_check').fetchone()[0])" "$inc")
  [ "$got" = "$want" ] && [ "$ok" = ok ] || { say "STOP-NOTE $w: pulled copy does not verify (quick_check $ok); kept as $inc, laptop untouched"; return 1; }
  local keep=$(dirname "$dst")/pre-rollback-$NOW; mkdir -p "$keep"
  for f in "$dst" "$dst-wal" "$dst-shm"; do [ -e "$f" ] && mv "$f" "$keep/"; done   # same names: the WAL stays paired with its DB
  mv "$inc" "$dst" && e2 "rm -f $RDATA/rollback-$w.db"; say "$w: eden2 history copied back (originals kept in $keep/)"; }
if [ $SERVED = 1 ]; then for w in $WORLDS; do [ "$(st $w)" = SERVED ] || continue
  b=$(e2 "python3 $RBIN/parity.py $RDATA/$w/sim.db $(wid $w)" 2>/dev/null); bm=$(jget "$b" maxSeq) || { say "WARN $w: served on the laptop; eden2 history unreadable, not compared"; continue; }
  a2=$(python3 $KITBIN/parity.py "$(ddir $w)/sim.db" $(wid $w) $bm 2>/dev/null)
  if [ "$(jget "$a2" maxSeq 2>/dev/null)" -ge "$bm" ] 2>/dev/null && [ "$(jget "$a2" prefixSHA256)" = "$(jget "$b" prefixSHA256)" ]; then say "$w: served on the laptop and its history contains eden2's events"
  else say "WARN $w: left alone because a laptop writer serves it, but eden2 holds event history the laptop lacks (eden2 maxSeq $bm); reconcile by hand"; fi; done; fi
if [ $SERVED = 0 ]; then say "eden2 never served the public (no 4670, no SERVED marker): laptop data is authoritative, nothing copied back"
else
  for w in $WORLDS; do case $(st $w) in CLOSED|HUNG) ;; *) continue;; esac
    dst=$(ddir $w)/sim.db; src=$RDATA/$w/sim.db
    a=$(python3 $KITBIN/parity.py "$dst" $(wid $w) 2>/dev/null); b=$(e2 "python3 $RBIN/parity.py $src $(wid $w)" 2>/dev/null)
    am=$(jget "$a" maxSeq) && bm=$(jget "$b" maxSeq) || { setst $w FAILED; say "STOP-NOTE $w: cannot read parity (laptop '${a:0:60}', eden2 '${b:0:60}'); laptop untouched, not restarted"; continue; }
    say "$w laptop $a"; say "$w eden2  $b"
    if [ "$a" = "$b" ]; then say "$w: identical, laptop kept"; continue; fi
    b2=$(e2 "python3 $RBIN/parity.py $src $(wid $w) $am" 2>/dev/null)
    if [ "$bm" -ge "$am" ] && [ -n "$b2" ] && [ "$(jget "$b2" prefixSHA256)" = "$(jget "$a" prefixSHA256)" ]; then
      pull $w "$dst" $src "$b" "python3 $KITBIN/parity.py {} $(wid $w)" || setst $w FAILED
    else setst $w FAILED; say "STOP-NOTE $w: eden2 history does not extend the laptop's (maxSeq $bm vs $am or prefix differs); laptop untouched, not restarted"; fi
  done
  ha=$(python3 $KITBIN/dbhash.py "$ACC" 2>/dev/null); hb=$(e2 "python3 $RBIN/dbhash.py $RDATA/accounts/accounts.sqlite" 2>/dev/null)
  holders=$(lsof -t "$ACC" "$ACC-wal" 2>/dev/null | sort -u | tr '\n' ' '); [ "$(uname)" = Darwin ] && holders=$(/usr/sbin/lsof -t "$ACC" "$ACC-wal" 2>/dev/null | sort -u | tr '\n' ' ')
  if ! jget "$hb" sha256 >/dev/null; then say "WARN accounts: eden2 registry unreadable; laptop registry kept"
  elif [ "$ha" = "$hb" ]; then say "accounts: identical, laptop kept"
  elif [ -n "${holders// /}" ]; then say "STOP-NOTE accounts: differs, but the registry is open by pid(s) $holders (a served laptop writer); not swapped; reconcile by hand"
  else pull accounts "$ACC" $RDATA/accounts/accounts.sqlite "$hb" "python3 $KITBIN/dbhash.py {}" || say "WARN accounts: laptop registry kept"; fi
fi

# 4 restart laptop writers in a new session (no controlling terminal; run-world.mjs also ignores SIGHUP)
for w in $WORLDS; do case $(st $w) in CLOSED|HUNG) ;; *) continue;; esac
  L=$LOGD/laptop-$w-$NOW.log
  (cd ${TEST:-/tmp} || exit 1; SIM_PORT_MAP=${RB_PORT_MAP:-} AUTH_PROVIDER=clerk ACCOUNT_REGISTRY_PATH=$ACC nohup python3 -c 'import os,sys;os.setsid();os.execvp(sys.argv[1],sys.argv[1:])' \
    $N ${RB_PORT_MAP:+--import=$KITBIN/port-map.mjs} --experimental-transform-types --env-file=$ENV $KITBIN/run-world.mjs $DESC/$w.json >> $L 2>&1 < /dev/null & echo $! > $L.pid)
  [ -n "$TEST" ] && echo "$(cat $L.pid) $w rollback" >> $TEST/.pids
  setst $w STARTED; done
for w in $WORLDS; do [ "$(st $w)" = STARTED ] || continue; L=$LOGD/laptop-$w-$NOW.log
  for i in $(seq 1 100); do grep -q '"phase":"ready"' $L 2>/dev/null && break; grep -q 'refused\|^Error' $L 2>/dev/null && break; sleep 3; done
  if grep -q '"phase":"ready"' $L 2>/dev/null; then say "$w: $(grep -h '"phase":"ready"' $L | cut -c1-200)"
  else setst $w FAILED; say "STOP-NOTE $w: writer NOT READY - see $L"; fi; done
# all worlds settled and eden2's served marker consumed only when nothing failed (a re-run still sees it otherwise)
if [ $SERVED = 1 ] && ! grep -q "] STOP-NOTE " "$LOG"; then e2 "for m in $RDATA/SERVED-*; do case \"\$m\" in *'*'*|*.rolledback-*) ;; *) mv \"\$m\" \"\$m.rolledback-$NOW\";; esac; done"; fi
[ "$PUBLIC" = 1 ] && for w in $WORLDS; do say "public /w/$w/v1/config $(curl -s -o /dev/null -w '%{http_code}' https://sim.eden.art/w/$w/v1/config)"; done
say "ROLLBACK END: $(for w in $WORLDS; do printf '%s=%s ' $w $(st $w); done)(SERVED=left alone, STARTED=restarted, FAILED=see the notes above)"
[ -n "$TEST" ] || say "Laptop proxy :4970 routes to the restarted writers; if it was stopped meanwhile, restart it from team/reviews/convergence-ops-1080cfa9-001/PROXY.json."
grep -q "] STOP-NOTE " "$LOG" && exit 1 || exit 0

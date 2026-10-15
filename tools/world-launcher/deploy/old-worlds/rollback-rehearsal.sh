#!/usr/bin/env bash
# Rehearse rollback.sh against SCRATCH copies only (lane KIT 2026-10-15, after KIT-REVIEW-1). Never touches the live laptop
# writers/DBs/ports, Caddy or the sim-old units: laptop side = $T/laptop on lane ports 5780-5782 (port-map preload),
# eden2 side = /srv/sim-old-rbtest (a fake sim.caddy, scratch DBs), Caddy validate/reload = `true`/`false` stand-ins.
#   bash rollback-rehearsal.sh [S1 S2 ...]     (default: all scenarios)    -> PASS/FAIL per scenario, exit 1 on any FAIL
set -uo pipefail
H=<team>/runtime/sim-old-cloud; T=<team>/scratch/kit/rbtest; RT=/srv/sim-old-rbtest
N=~/.nvm/versions/node/v22.20.0/bin/node; ENV=<team>/pm-integration/auth-account-20261009/clerk-publication-types-003/STAGED-PUBLIC-SETTINGS.env
WORLDS="eden mars littlemartians"; FAILS=0
dport() { case $1 in eden) echo 4958;; mars) echo 4966;; littlemartians) echo 4965;; esac; }
export RB_RDATA=$RT/data RB_CADDY=$RT/sim.caddy RB_CADDY_VALIDATE=true RB_CADDY_RELOAD=true RB_UNITS= RB_LAPTOP_ROOT=$T/laptop \
  RB_ACC=$T/laptop/accounts/accounts.sqlite RB_DESC=$T/desc RB_LPORTS=eden:5780,mars:5782,littlemartians:5781 \
  RB_PORT_MAP=4958:5780,4966:5782,4965:5781 RB_HUNG_WAIT=8 RB_PUBLIC=0 RB_LOG_DIR=$T/logs
stop_test() { pkill -TERM -f "run-world\.mjs $T/desc/" 2>/dev/null; pkill -KILL -f "rbtest-hung" 2>/dev/null
  for i in $(seq 1 30); do pgrep -f "run-world\.mjs $T/desc/|rbtest-hung" >/dev/null || return 0; sleep 1; done; }
reset() { # $1 = caddy catch-all port on the fake eden2 (4670 = eden2 served the public, 4505 = never switched)
  stop_test; rm -rf $T; mkdir -p $T/desc $T/logs
  for w in $WORLDS accounts; do mkdir -p $T/laptop/$w; done
  for w in $WORLDS; do cp $H/stage/$w/sim.db $T/laptop/$w/sim.db; done; cp $H/stage/accounts/accounts.sqlite $T/laptop/accounts/
  python3 - "$T" <<'EOF'
import json,sys
T=sys.argv[1]
for w,p in (('eden',4958),('mars',4966),('littlemartians',4965)):
  d=json.load(open('<team>/runtime/sim-old-cloud/rollback/descriptors-1080cfa9/%s.json'%w))
  d.update(dataDir=f'{T}/laptop/{w}',port=p,accountRegistryPath=f'{T}/laptop/accounts/accounts.sqlite')
  open(f'{T}/desc/{w}.json','w').write(json.dumps(d,indent=2))
EOF
  ssh -o BatchMode=yes root@eden2 "rm -rf $RT; mkdir -p $RT/data/eden $RT/data/mars $RT/data/littlemartians $RT/data/accounts
    printf 'sim.eden.art {\n  handle /worlds* { reverse_proxy 127.0.0.1:4620 }\n  handle { reverse_proxy 127.0.0.1:$1 }\n}\n' > $RT/sim.caddy"
  for w in $WORLDS; do rsync -a $T/laptop/$w/sim.db root@eden2:$RT/data/$w/sim.db; done; rsync -a $T/laptop/accounts/accounts.sqlite root@eden2:$RT/data/accounts/
  sums_before=$(sums); }
sums() { for w in $WORLDS; do shasum $T/laptop/$w/sim.db | cut -c1-12; done; shasum $T/laptop/accounts/accounts.sqlite | cut -c1-12; }
start_writer() { (cd /tmp && SIM_PORT_MAP=$RB_PORT_MAP AUTH_PROVIDER=clerk ACCOUNT_REGISTRY_PATH=$RB_ACC nohup python3 -c 'import os,sys;os.setsid();os.execvp(sys.argv[1],sys.argv[1:])' \
  $N --import=$H/bin/port-map.mjs --experimental-transform-types --env-file=$ENV $H/bin/run-world.mjs $T/desc/$1.json > $T/logs/pre-$1.log 2>&1 < /dev/null &)
  for i in $(seq 1 60); do grep -q '"phase":"ready"' $T/logs/pre-$1.log && return 0; sleep 1; done; echo "pre-writer $1 not ready"; return 1; }
start_hung() { # a process that looks like the world's writer (command line), ignores SIGTERM, holds the lock, never listens
  (cd /tmp && nohup $N -e '/*rbtest-hung*/process.on("SIGTERM",()=>{});setInterval(()=>{},1e3)' run-world.mjs $T/desc/$1.json > /dev/null 2>&1 < /dev/null &)
  sleep 1; p=$(pgrep -f "run-world\.mjs $T/desc/$1\.json" | head -1); echo "{\"pid\":$p,\"startedAt\":\"test\"}" > $T/laptop/$1/edge-server.lock; }
run() { env "${@:2}" bash $H/bin/rollback.sh TEST-$1 > $T/logs/out.txt 2>&1; RC=$?; }
ok() { if eval "$2"; then echo "  ok   $1"; else echo "  FAIL $1"; FAIL=1; fi; }
has() { grep -q -- "$1" $T/logs/out.txt; }
listening() { [ -n "$(/usr/sbin/lsof -nP -iTCP:$1 -sTCP:LISTEN -t 2>/dev/null)" ]; }
caddy_now() { ssh -o BatchMode=yes root@eden2 "grep -o 'reverse_proxy 127.0.0.1:4[56][0-9]*' $RT/sim.caddy | tail -1"; }
scenario() { FAIL=0; echo "== $1: $2"; }
done_s() { [ $FAIL = 0 ] && echo "PASS $1" || { echo "FAIL $1"; FAILS=$((FAILS+1)); sed 's/^/     | /' $T/logs/out.txt | tail -25; }; stop_test; }

S1() { scenario S1 "eden2 unreachable at start (Caddy can't be confirmed)"; reset 4670
  run S1 RB_E2=root@unreachable.invalid
  ok "exit 1 + STOP at Caddy" '[ $RC = 1 ] && has "STOP: Caddy not confirmed"'
  ok "laptop DBs untouched" '[ "$(sums)" = "$sums_before" ] && ! ls $T/laptop/*/*.pre-rollback-* >/dev/null 2>&1'
  ok "no writer started" '! listening 5780 && ! listening 5781 && ! listening 5782'; done_s S1; }
S2() { scenario S2 "partial freeze: eden still served on the laptop, mars writer hung (ignores SIGTERM), LM closed; eden2 identical"; reset 4670
  start_writer eden && start_hung mars; run S2
  ok "Caddy restored 4670->4505 (sed, backup kept)" '[ "$(caddy_now)" = "reverse_proxy 127.0.0.1:4505" ] && has "RESULT=restored served=1"'
  ok "eden left alone (still served)" 'has "eden: laptop :5780 still served" && has "eden=SERVED"'
  ok "mars hung writer killed after wait, restarted" 'has "SIGKILL hung writer" && has "mars=STARTED" && listening 5782'
  ok "LM restarted" 'has "littlemartians=STARTED" && listening 5781'
  ok "identical data kept, nothing renamed" 'has "mars: identical" && has "accounts: identical" && ! ls $T/laptop/*/*.pre-rollback-* >/dev/null 2>&1'
  ok "restarted writers in their own session (pgid==pid) and ignore SIGHUP" 'p=$(/usr/sbin/lsof -nP -iTCP:5781 -sTCP:LISTEN -t); [ "$(ps -o pgid= -p $p | tr -d " ")" = "$p" ] && kill -HUP $p && sleep 2 && kill -0 $p'
  ok "exit 0" '[ $RC = 0 ]'; done_s S2; }
S3() { scenario S3 "Caddy not restored (reload fails; then validate fails)"; reset 4670
  run S3 RB_CADDY_RELOAD=false
  ok "reload failure -> STOP, nothing else" '[ $RC = 1 ] && has "RESULT=reload-failed" && has "STOP: Caddy not confirmed" && ! has "eden2 units" && ! has "=STARTED"'
  ok "laptop untouched, no writer" '[ "$(sums)" = "$sums_before" ] && ! listening 5780 && ! listening 5781 && ! listening 5782'
  reset 4670; run S3b RB_CADDY_VALIDATE=false
  ok "validate failure -> file restored to 4670, STOP" '[ $RC = 1 ] && has "RESULT=validate-failed" && [ "$(caddy_now)" = "reverse_proxy 127.0.0.1:4670" ] && [ "$(sums)" = "$sums_before" ]'
  ok "re-run after a fixed Caddy works (rerunnable)" 'run S3c; [ $RC = 0 ] && has "RESULT=restored"'; done_s S3; }
S4() { scenario S4 "eden2 served and wrote chat rows + an account with NO new event"; reset 4670
  ssh -o BatchMode=yes root@eden2 "python3 - <<'EOF'
import sqlite3
c=sqlite3.connect('$RT/data/eden/sim.db'); r=list(c.execute('select * from edge_comms_speech limit 1').fetchone()); r[1]=r[1]+'-rbtest'; r[6]='rollback rehearsal line'
c.execute('insert into edge_comms_speech values (?,?,?,?,?,?,?,?)',r); c.commit()
a=sqlite3.connect('$RT/data/accounts/accounts.sqlite'); a.execute(\"insert into provider_accounts_v1 values ('acct-rbtest','https://rbtest.invalid','rbtest',0)\"); a.commit()
EOF"
  run S4
  ok "eden: speech differs, prefix extends -> copied back" 'has "eden: eden2 history copied back" && python3 -c "import sqlite3,sys;c=sqlite3.connect(\"file:$T/laptop/eden/sim.db?mode=ro\",uri=True);sys.exit(0 if c.execute(\"select count(*) from edge_comms_speech where text=?\",(\"rollback rehearsal line\",)).fetchone()[0]==1 else 1)"'
  ok "laptop original kept as .pre-rollback" 'ls $T/laptop/eden/sim.db.pre-rollback-* >/dev/null 2>&1'
  ok "accounts copied back" 'has "accounts: eden2 history copied back" && python3 $H/bin/dbhash.py $RB_ACC | grep -q "\"provider_accounts_v1\": 3"'
  ok "mars/LM identical kept; all 3 restarted" 'has "mars: identical" && has "littlemartians: identical" && listening 5780 && listening 5781 && listening 5782'
  ok "exit 0" '[ $RC = 0 ]'; done_s S4; }
S5() { scenario S5 "eden2 unreadable for mars mid-way + eden2 eden history diverged (shorter)"; reset 4670
  ssh -o BatchMode=yes root@eden2 "rm -f $RT/data/mars/sim.db; python3 -c \"import sqlite3;c=sqlite3.connect('$RT/data/eden/sim.db');c.execute('delete from events where seq=(select max(seq) from events)');c.commit()\""
  run S5
  ok "mars: parity unreadable -> untouched, not restarted" 'has "STOP-NOTE mars: cannot read parity" && ! listening 5782 && [ "$(shasum $T/laptop/mars/sim.db | cut -c1-12)" = "$(echo "$sums_before" | sed -n 2p)" ]'
  ok "eden: diverged -> untouched, not restarted" 'has "STOP-NOTE eden: eden2 history does not extend" && ! listening 5780 && [ "$(shasum $T/laptop/eden/sim.db | cut -c1-12)" = "$(echo "$sums_before" | sed -n 1p)" ]'
  ok "LM restarted; exit 1 with notes" 'listening 5781 && [ $RC = 1 ] && ! ls $T/laptop/*/*.pre-rollback-* >/dev/null 2>&1'; done_s S5; }
S6() { scenario S6 "cutover stopped before Caddy (never served) while eden2 copies differ: nothing copied back"; reset 4505
  ssh -o BatchMode=yes root@eden2 "python3 -c \"import sqlite3;a=sqlite3.connect('$RT/data/accounts/accounts.sqlite');a.execute(\\\"insert into provider_accounts_v1 values ('acct-rbtest','https://rbtest.invalid','rbtest',0)\\\");a.commit()\""
  run S6
  ok "Caddy already on 4505, served=0" 'has "RESULT=already served=0" && has "nothing copied back"'
  ok "laptop DBs + accounts untouched; 3 restarted" '[ "$(sums)" = "$sums_before" ] && listening 5780 && listening 5781 && listening 5782 && [ $RC = 0 ]'; done_s S6; }

for s in ${@:-S1 S2 S3 S4 S5 S6}; do $s; done
stop_test; ssh -o BatchMode=yes root@eden2 "rm -rf $RT"; rm -rf $T/laptop
echo "rehearsal done: $FAILS failing scenario(s)"; [ $FAILS = 0 ]

#!/usr/bin/env bash
# Rehearse rollback.sh ON EDEN2 ONLY, against a scratch tree (lane KIT 2026-10-15, after KIT-REVIEW-1 and
# INCIDENT-20261015-MARS-LM). Refuses to run anywhere but Linux. Everything lives under /srv/sim-old-rbtest:
#   kit/ (rollback.sh + helpers)  fixtures/ (copies of the staged DBs)  laptop/ (the simulated laptop, its own .pids)
#   desc/ (scratch descriptors, ports 4958/4965/4966 -> 6330/6331/6332 via port-map)  data/ + sim.caddy (simulated eden2 side)
# The harness signals only PIDs it spawned itself and recorded in laptop/.pids, after re-checking args + cwd.
#   bash /srv/sim-old-rbtest/kit/rollback-rehearsal.sh [S0 S1 ...]   -> PASS/FAIL per scenario; exit 1 on any FAIL
set -uo pipefail
[ "$(uname)" = Linux ] || { echo "rehearsal runs on eden2 only"; exit 2; }
RT=/srv/sim-old-rbtest; K=$RT/kit; L=$RT/laptop; WORLDS="eden mars littlemartians"; FAILS=0
export RB_E2=local RB_KITBIN=$K RB_NODE=/usr/bin/node RB_ENV=/etc/sim-old/clerk-public.env RB_RDATA=$RT/data RB_RBIN=$K RB_CADDY=$RT/sim.caddy \
  RB_CADDY_VALIDATE=true RB_CADDY_RELOAD=true RB_UNITS= RB_LAPTOP_ROOT=$L RB_ACC=$L/accounts/accounts.sqlite RB_DESC=$RT/desc \
  RB_LPORTS=eden:6330,mars:6332,littlemartians:6331 RB_PORT_MAP=4958:6330,4966:6332,4965:6331 RB_HUNG_WAIT=8 RB_PUBLIC=0 RB_LOG_DIR=$RT/logs RB_RECEIPTS=$RT/receipts
own() { # pid -> 0 if it is one of ours: recorded in .pids, args name the scratch tree, cwd inside laptop/
  [ -n "${1:-}" ] || return 1; grep -q "^$1 " $L/.pids 2>/dev/null && case "$(ps -o command= -p $1)" in *"$RT/desc/"*) true;; *) false;; esac && case "$(readlink /proc/$1/cwd)/" in "$L"/*) true;; *) false;; esac; }
stop_test() { [ -f $L/.pids ] || return 0
  for p in $(awk '{print $1}' $L/.pids); do kill -0 $p 2>/dev/null && own $p && kill -TERM $p; done
  for i in $(seq 1 20); do left=; for p in $(awk '{print $1}' $L/.pids); do kill -0 $p 2>/dev/null && own $p && left=1; done; [ -z "$left" ] && return 0; sleep 1; done
  for p in $(awk '{print $1}' $L/.pids); do kill -0 $p 2>/dev/null && own $p && kill -KILL $p; done; }
reset() { # $1 = catch-all port in the simulated sim.caddy (4670: eden2 served the public; 4505: never switched)
  stop_test; rm -rf $L $RT/data $RT/desc $RT/logs $RT/receipts $RT/sim.caddy*; mkdir -p $L/accounts $RT/data/forks $RT/desc $RT/logs $RT/receipts; : > $L/.pids
  for w in $WORLDS; do mkdir -p $L/$w $RT/data/worlds/$w; cp $RT/fixtures/$w/sim.db $L/$w/; cp $RT/fixtures/$w/sim.db $RT/data/worlds/$w/; done
  cp $RT/fixtures/accounts/accounts.sqlite $L/accounts/; cp $RT/fixtures/accounts/accounts.sqlite $RT/data/forks/
  python3 - <<'EOF'
import json
RT='/srv/sim-old-rbtest'
for w,p in (('eden',4958),('mars',4966),('littlemartians',4965)):
  d=json.load(open(f'/srv/sim-old/current/descriptors/{w}.json'))
  d.update(dataDir=f'{RT}/laptop/{w}',port=p,accountRegistryPath=f'{RT}/laptop/accounts/accounts.sqlite')
  open(f'{RT}/desc/{w}.json','w').write(json.dumps(d,indent=2))
EOF
  printf 'sim.eden.art {\n  handle /worlds* { reverse_proxy 127.0.0.1:4620 }\n  handle { reverse_proxy 127.0.0.1:%s }\n}\n' $1 > $RT/sim.caddy
  sums_before=$(sums); ino_before=$(inos); }
inos() { for w in $WORLDS; do stat -c %i $L/$w/sim.db; done; stat -c %i $L/accounts/accounts.sqlite; }
sums() { for w in $WORLDS; do sha1sum $L/$w/sim.db | cut -c1-12; done; sha1sum $L/accounts/accounts.sqlite | cut -c1-12; }
start_writer() { (cd $L || exit 1; SIM_PORT_MAP=$RB_PORT_MAP AUTH_PROVIDER=clerk ACCOUNT_REGISTRY_PATH=$RB_ACC nohup python3 -c 'import os,sys;os.setsid();os.execvp(sys.argv[1],sys.argv[1:])' \
  /usr/bin/node --import=$K/port-map.mjs --experimental-transform-types --env-file=$RB_ENV $K/run-world.mjs $RT/desc/$1.json > $RT/logs/pre-$1.log 2>&1 < /dev/null & echo "$! $1 pre" >> $L/.pids)
  for i in $(seq 1 60); do grep -q '"phase":"ready"' $RT/logs/pre-$1.log && return 0; sleep 1; done; echo "pre-writer $1 not ready"; return 1; }
start_late_listener() { # $1 world $2 port: ignores SIGTERM, holds the lock, starts listening after 4 s
  (cd $L || exit 1; nohup /usr/bin/node -e '/*rbtest-hung*/process.on("SIGTERM",()=>{});setTimeout(()=>require("net").createServer().listen(Number(process.argv.at(-1)),"127.0.0.1"),4000);setInterval(()=>{},1e3)' run-world.mjs $RT/desc/$1.json $2 > /dev/null 2>&1 < /dev/null & echo "$! $1 hung" >> $L/.pids)
  sleep 1; p=$(awk -v w=$1 '$2==w && $3=="hung"{print $1}' $L/.pids | tail -1); echo "{\"pid\":$p,\"startedAt\":\"test\"}" > $L/$1/edge-server.lock; }
start_hung() { # $1 world [$2 extra args]: looks like the world's writer, ignores SIGTERM, holds the lock, never listens
  (cd $L || exit 1; nohup /usr/bin/node -e '/*rbtest-hung*/process.on("SIGTERM",()=>{});setInterval(()=>{},1e3)' run-world.mjs ${2:-} $RT/desc/$1.json > /dev/null 2>&1 < /dev/null & echo "$! $1 hung" >> $L/.pids)
  sleep 1; p=$(awk -v w=$1 '$2==w && $3=="hung"{print $1}' $L/.pids | tail -1); echo "{\"pid\":$p,\"startedAt\":\"test\"}" > $L/$1/edge-server.lock; }
run() { env "${@:2}" bash $K/rollback.sh TEST-$1 > $RT/logs/out.txt 2>&1; RC=$?; cp $RT/logs/out.txt $RT/out-last-$1.txt; }
ok() { if eval "$2"; then echo "  ok   $1"; else echo "  FAIL $1"; FAIL=1; fi; }
has() { grep -q -- "$1" $RT/logs/out.txt; }
listening() { ss -ltnH "sport = :$1" | grep -q .; }
caddy_now() { grep -o 'reverse_proxy 127.0.0.1:4[56][0-9]*' $RT/sim.caddy | tail -1; }
scenario() { FAIL=0; echo "== $1: $2"; }
done_s() { [ $FAIL = 0 ] && echo "PASS $1" || { echo "FAIL $1"; FAILS=$((FAILS+1)); sed 's/^/     | /' $RT/logs/out.txt | tail -25; }; stop_test; }

S0() { scenario S0 "guards: a target that is a live writer, or a pidfile PID outside the scratch tree, aborts with nothing signalled"; reset 4670
  start_hung mars "/srv/sim-old/current/descriptors/mars.json"; decoy=$(awk '$3=="hung"{print $1}' $L/.pids); run S0
  ok "live-writer self-check aborts (exit 3), decoy alive, Caddy untouched" '[ $RC = 3 ] && has "is a live writer" && kill -0 $decoy && [ "$(caddy_now)" = "reverse_proxy 127.0.0.1:4670" ]'
  kill -KILL $decoy; reset 4670; (cd /tmp && nohup sleep 300 > /dev/null 2>&1 & echo "$! littlemartians hung" >> $L/.pids); sl=$(tail -1 $L/.pids | cut -d" " -f1); run S0b
  ok "pidfile PID with foreign args/cwd -> REFUSE abort, not signalled" '[ $RC = 3 ] && has "outside the scratch tree" && kill -0 $sl'
  kill -KILL $sl; ok "laptop untouched" '[ "$(sums)" = "$sums_before" ]'; done_s S0; }
S1() { scenario S1 "eden2 unreachable at start (Caddy can't be confirmed)"; reset 4670
  run S1 RB_E2=root@unreachable.invalid
  ok "exit 1 + STOP at Caddy" '[ $RC = 1 ] && has "STOP: Caddy not confirmed"'
  ok "laptop DBs untouched, nothing renamed" '[ "$(sums)" = "$sums_before" ] && ! ls $L/*/pre-rollback-* >/dev/null 2>&1'
  ok "no writer started" '! listening 6330 && ! listening 6331 && ! listening 6332'; done_s S1; }
S2() { scenario S2 "partial freeze: eden still served on the laptop, mars writer hung (ignores SIGTERM), LM closed; eden2 identical"; reset 4670
  start_writer eden && start_hung mars; run S2
  ok "Caddy restored 4670->4505 (sed, backup kept)" '[ "$(caddy_now)" = "reverse_proxy 127.0.0.1:4505" ] && has "RESULT=restored served=1" && ls $RT/sim.caddy.post-kit-* >/dev/null'
  ok "eden left alone (still served)" 'has "eden: :6330 still served" && has "eden=SERVED"'
  ok "mars hung writer SIGKILLed after the wait, restarted" 'has "SIGKILL hung writer" && has "mars=STARTED" && listening 6332'
  ok "LM restarted" 'has "littlemartians=STARTED" && listening 6331'
  ok "identical data kept, nothing renamed" 'has "mars: identical" && has "accounts: identical" && ! ls $L/*/pre-rollback-* >/dev/null 2>&1'
  p=$(ss -ltnpH "sport = :6331" | grep -o "pid=[0-9]*" | cut -d= -f2 | head -1)
  ok "restarted writer: own session (sid=pgid=pid), survives SIGHUP" 'own $p && [ "$(ps -o sid= -p $p | tr -d " ")" = "$p" ] && [ "$(ps -o pgid= -p $p | tr -d " ")" = "$p" ] && kill -HUP $p && sleep 2 && kill -0 $p && listening 6331'
  ok "exit 0" '[ $RC = 0 ]'; done_s S2; }
S3() { scenario S3 "Caddy not restored (reload fails; validate fails), then a fixed re-run"; reset 4670
  run S3 RB_CADDY_RELOAD=false
  ok "reload failure -> STOP; eden2 not stopped, no writer" '[ $RC = 1 ] && has "RESULT=reload-failed" && has "STOP: Caddy not confirmed" && ! has "eden2 units" && ! has "=STARTED"'
  ok "#4 reload failure leaves the file on 4670 (matches running Caddy)" '[ "$(caddy_now)" = "reverse_proxy 127.0.0.1:4670" ]'
  run S3r; ok "#4 re-run after the reload is fixed restores (not 'already')" '[ $RC = 0 ] && has "RESULT=restored"'
  stop_test; reset 4670
  ok "laptop untouched" '[ "$(sums)" = "$sums_before" ] && ! listening 6330 && ! listening 6331 && ! listening 6332'
  reset 4670; run S3b RB_CADDY_VALIDATE=false
  ok "validate failure -> file back to 4670, STOP, laptop untouched" '[ $RC = 1 ] && has "RESULT=validate-failed" && [ "$(caddy_now)" = "reverse_proxy 127.0.0.1:4670" ] && [ "$(sums)" = "$sums_before" ]'
  run S3c; ok "re-run with Caddy fixed completes" '[ $RC = 0 ] && has "RESULT=restored" && listening 6330 && listening 6331 && listening 6332'; done_s S3; }
S4() { scenario S4 "eden2 served and wrote a chat row + an account with NO new event"; reset 4670
  python3 - <<'EOF'
import sqlite3
RT='/srv/sim-old-rbtest'
c=sqlite3.connect(f'{RT}/data/worlds/eden/sim.db'); r=list(c.execute('select * from edge_comms_speech limit 1').fetchone()); r[1]+='-rbtest'; r[6]='rollback rehearsal line'
c.execute('insert into edge_comms_speech values (?,?,?,?,?,?,?,?)',r); c.commit()
a=sqlite3.connect(f'{RT}/data/forks/accounts.sqlite'); a.execute("insert into provider_accounts_v1 values ('acct-rbtest','https://rbtest.invalid','rbtest',0)"); a.commit()
EOF
  run S4
  ok "eden: speech differs, prefix extends -> copied back, row present" 'has "eden: eden2 history copied back" && [ "$(python3 -c "import sqlite3;print(sqlite3.connect(\"file:$L/eden/sim.db?mode=ro\",uri=True).execute(\"select count(*) from edge_comms_speech where text=?\",(\"rollback rehearsal line\",)).fetchone()[0])")" = 1 ]'
  ok "laptop original kept, DB + WAL together in pre-rollback-<ts>/" 'ls $L/eden/pre-rollback-*/sim.db >/dev/null 2>&1'
  ok "accounts copied back (3 rows)" 'has "accounts: eden2 history copied back" && python3 $K/dbhash.py $RB_ACC | grep -q "\"provider_accounts_v1\": 3"'
  ok "mars/LM identical kept; all 3 restarted; exit 0" 'has "mars: identical" && has "littlemartians: identical" && listening 6330 && listening 6331 && listening 6332 && [ $RC = 0 ]'; done_s S4; }
S5() { scenario S5 "eden2 unreadable for mars + eden2's eden history diverged (shorter)"; reset 4670
  rm -f $RT/data/worlds/mars/sim.db; python3 -c "import sqlite3;c=sqlite3.connect('$RT/data/worlds/eden/sim.db');c.execute('delete from events where seq=(select max(seq) from events)');c.commit()"
  run S5
  ok "mars: parity unreadable -> untouched, not restarted" 'has "STOP-NOTE mars: cannot read parity" && ! listening 6332 && [ "$(sha1sum $L/mars/sim.db | cut -c1-12)" = "$(echo "$sums_before" | sed -n 2p)" ]'
  ok "eden: diverged -> untouched, not restarted" 'has "STOP-NOTE eden: eden2 history does not extend" && ! listening 6330 && [ "$(sha1sum $L/eden/sim.db | cut -c1-12)" = "$(echo "$sums_before" | sed -n 1p)" ]'
  ok "LM restarted; exit 1; nothing renamed" 'listening 6331 && [ $RC = 1 ] && ! ls $L/*/pre-rollback-* >/dev/null 2>&1'; done_s S5; }
S6() { scenario S6 "cutover stopped before Caddy (never served) while eden2 copies differ: nothing copied back"; reset 4505
  python3 -c "import sqlite3;a=sqlite3.connect('$RT/data/forks/accounts.sqlite');a.execute(\"insert into provider_accounts_v1 values ('acct-rbtest','https://rbtest.invalid','rbtest',0)\");a.commit()"
  run S6
  ok "Caddy already on 4505, served=0, nothing copied" 'has "RESULT=already served=0" && has "nothing copied back"'
  ok "laptop DBs + accounts not replaced (same inodes, nothing renamed); 3 restarted; exit 0" '[ "$(inos)" = "$ino_before" ] && ! ls $L/*/pre-rollback-* >/dev/null 2>\&1 && listening 6330 && listening 6331 && listening 6332 && [ $RC = 0 ]'; done_s S6; }

S7() { scenario S7 "#1 RB_* set without RB_LAPTOP_ROOT (would be the real rollback) -> refuses before anything"; reset 4670
  run S7 -u RB_LAPTOP_ROOT RB_E2=root@unreachable.invalid
  ok "exit 2, REFUSED, nothing logged/changed" '[ $RC = 2 ] && has "REFUSED: RB_\* variables are set" && [ "$(caddy_now)" = "reverse_proxy 127.0.0.1:4670" ] && [ "$(sums)" = "$sums_before" ] && ! ls $RT/logs/rollback-* >/dev/null 2>&1'
  done_s S7; }
S8() { scenario S8 "#2 test mode refuses real units, a real eden2 host, or real Caddy commands"; reset 4670
  run S8a -u RB_UNITS; ok "RB_UNITS unset -> refused" '[ $RC = 2 ] && has "needs RB_UNITS set and empty"'
  run S8b RB_E2=root@box.example; ok "RB_E2=root@box.example -> refused" '[ $RC = 2 ] && has "needs RB_E2=local"'
  run S8c "RB_CADDY_RELOAD=echo would-reload"; ok "non-stand-in reload command -> refused" '[ $RC = 2 ] && has "true/false stand-ins"'
  ok "nothing changed" '[ "$(caddy_now)" = "reverse_proxy 127.0.0.1:4670" ] && [ "$(sums)" = "$sums_before" ]'; done_s S8; }
S9() { scenario S9 "#3 a hung writer that starts listening during the wait is not killed"; reset 4670
  start_late_listener mars 6332; lp=$(awk '$2=="mars" && $3=="hung"{print $1}' $L/.pids); run S9
  ok "classified hung (lock holder), then left alone once listening" 'has "mars: writer $lp (holds the lock) alive but not listening" && has "started listening during the wait" && has "mars=SERVED"'
  ok "never signalled: still alive and listening" 'kill -0 $lp && listening 6332 && ! has "SIGKILL"'
  ok "eden/LM restarted; exit 0" 'listening 6330 && listening 6331 && [ $RC = 0 ]'; done_s S9; }
S10() { scenario S10 "#5 re-run with a mistyped TS after Caddy was already restored: the SERVED marker still drives copy-back"; reset 4505
  touch $RT/data/SERVED-20991231-000000
  python3 -c "import sqlite3;c=sqlite3.connect('$RT/data/worlds/eden/sim.db');r=list(c.execute('select * from edge_comms_speech limit 1').fetchone());r[1]+='-rbtest10';r[6]='marker line';c.execute('insert into edge_comms_speech values (?,?,?,?,?,?,?,?)',r);c.commit()"
  run TYPO
  ok "served=1 from the marker, eden copied back" 'has "RESULT=already served=1" && has "eden: eden2 history copied back"'
  ok "marker consumed after a clean rollback" '! ls $RT/data/SERVED-20991231-000000 >/dev/null 2>&1 && ls $RT/data/SERVED-20991231-000000.rolledback-* >/dev/null && [ $RC = 0 ]'; done_s S10; }
S11() { scenario S11 "#6 a restarted writer that never becomes ready is a STOP-NOTE"; reset 4505
  python3 -c "import json;p='$RT/desc/mars.json';d=json.load(open(p));d['seedCast']=True;open(p,'w').write(json.dumps(d))"
  run S11
  ok "mars NOT READY -> STOP-NOTE, FAILED, exit 1" 'has "STOP-NOTE mars: writer NOT READY" && has "mars=FAILED" && [ $RC = 1 ]'
  ok "eden/LM still restarted" 'listening 6330 && listening 6331'; done_s S11; }

start_standin() { # $1 world $2 port: convergence-like runner that never exits after its normal close
  (cd $L || exit 1; nohup /usr/bin/node $K/standin-runner.mjs run-world.mjs $RT/desc/$1.json $2 $L/$1 $RT/receipts $1 > /dev/null 2>&1 < /dev/null & echo "$! $1 standin" >> $L/.pids)
  for i in $(seq 1 20); do listening $2 && break; sleep 0.5; done; awk -v w=$1 '$2==w && $3=="standin"{print $1}' $L/.pids | tail -1; }
S12() { scenario S12 "final review: Eden's runner never exits after its normal close (stand-in on eden2)"; reset 4505
  sp=$(start_standin eden 6330); r=$(bash $K/close-writer.sh --term eden $sp 6330 $L/eden $RT/receipts 30); rc=$?
  ok "cutover path: SIGTERM -> receipt + lock released + port closed -> lingering PID killed, 'closed-lingering'" '[ $rc = 0 ] && [ "$r" = closed-lingering ] && ! kill -0 $sp 2>/dev/null && ! listening 6330 && [ ! -e $L/eden/edge-server.lock ]'
  start_hung mars; hp=$(awk '$2=="mars" && $3=="hung"{print $1}' $L/.pids | tail -1); r=$(bash $K/close-writer.sh --term mars $hp 6332 $L/mars $RT/receipts 4); rc=$?
  ok "no receipt (truly hung) -> 'still-open', never killed" '[ $rc = 1 ] && case "$r" in still-open*) true;; *) false;; esac && kill -0 $hp'
  stop_test; reset 4505; sp=$(start_standin eden 6330); kill -TERM $sp; sleep 2
  run S12
  ok "rollback path: lingering closed writer detected by its receipt, killed, eden restarted; exit 0" 'has "closed normally (CLOSURE.json, lock released) but lingers" && has "writer $sp: closed-lingering" && ! kill -0 $sp 2>/dev/null && has "eden=STARTED" && listening 6330 && [ $RC = 0 ]'
  done_s S12; }
S13() { scenario S13 "L2: eden2 history written by the current release (legacy stage): copied back only where the 1080cfa9 code opens it"
  L2D=/srv/sim-old-l2/data; for w in $WORLDS; do test -s $L2D/worlds/$w/sim.db || { echo "  FAIL no legacy rehearsal data in $L2D (run legacy-rehearsal.sh first)"; FAILS=$((FAILS+1)); return; }; done
  ! systemctl is-active -q sim-old-l2-rehearsal || { echo "  FAIL the legacy rehearsal unit is still running"; FAILS=$((FAILS+1)); return; }
  reset 4670; for w in $WORLDS; do rm -f $RT/data/worlds/$w/sim.db; python3 $K/compact-copy.py $L2D/worlds/$w/sim.db $RT/data/worlds/$w/sim.db > /dev/null; done
  run S13
  ok "mars/LM: copied back and open on 1080cfa9" 'has "mars: eden2 history copied back" && has "littlemartians: eden2 history copied back"'
  ok "eden: the punt event does not open on 1080cfa9 -> laptop data kept (same inode), eden2 history kept on eden2" 'has "WARN eden: eden2.s newer history does not open" && [ "$(stat -c %i $L/eden/sim.db)" = "$(echo $ino_before | cut -d" " -f1)" ] && ls $RT/data/kept-eden-*.db >/dev/null && ! ls -d $L/eden/check-* >/dev/null 2>&1'
  ok "all three writers ready (history-prefix + Soul gates), exit 0" 'has "eden=STARTED" && has "mars=STARTED" && has "littlemartians=STARTED" && listening 6330 && listening 6331 && listening 6332 && [ $RC = 0 ]'
  done_s S13; }

for p in 6330 6331 6332; do listening $p && { echo "port $p busy; abort"; exit 2; }; done
for s in ${@:-S0 S1 S2 S3 S4 S5 S6 S7 S8 S9 S10 S11 S12 S13}; do $s; done
stop_test; echo "rehearsal done: $FAILS failing scenario(s)"; [ $FAILS = 0 ]

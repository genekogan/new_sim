#!/usr/bin/env bash
# Rehearse the legacy stage ON EDEN2 ONLY, in scratch (lane L2 2026-10-17): the same release, keeper, launcher, fork mode and
# legacy-stage.sh code path as cutover.sh, on /srv/sim-old-l2 (data seeded from /srv/sim-old-rbtest/fixtures, compact copies of
# the laptop worlds), a transient unit sim-old-l2-rehearsal and ports 6320-6323. Nothing public; Caddy, /etc, /worlds untouched.
#   bash <release>/tools/world-launcher/deploy/old-worlds/legacy-rehearsal.sh up     setup, seed, start, register, measure
#   bash <release>/tools/world-launcher/deploy/old-worlds/legacy-rehearsal.sh down   stop the transient unit (data kept for S13)
#   bash <release>/tools/world-launcher/deploy/old-worlds/legacy-rehearsal.sh purge  stop and remove /srv/sim-old-l2
set -euo pipefail
[ "$(uname)" = Linux ] || { echo "eden2 only"; exit 2; }
HERE=$(cd "$(dirname "$0")" && pwd -P); export LG_SCRATCH=1; LS="bash $HERE/legacy-stage.sh"
FX=/srv/sim-old-rbtest/fixtures; D=/srv/sim-old-l2/data; WORLDS="eden mars littlemartians"
wid() { case $1 in eden) echo pm-preview-eden-20261005;; mars) echo mars-2026-1;; littlemartians) echo littlemartians-1;; esac; }
ms() { echo $(( $(date +%s%N) / 1000000 )); }
case ${1:?up|down|purge} in
up)
  ! systemctl is-active -q sim-old-l2-rehearsal || { echo "already running: down first"; exit 1; }
  $LS setup
  t=$(ms); for w in $WORLDS; do rm -f $D/worlds/$w/sim.db*; python3 $HERE/compact-copy.py $FX/$w/sim.db $D/worlds/$w/sim.db | tail -1; done
  rm -f $D/forks/accounts.sqlite*; python3 $HERE/online-backup.py $FX/accounts/accounts.sqlite $D/forks/accounts.sqlite >/dev/null
  rm -f $D/worlds.json $D/keeper.json $D/children.json; chown -R simworlds:simworlds /srv/sim-old-l2; echo "seed $(( $(ms) - t )) ms"
  for w in $WORLDS; do echo "fixture $w $(python3 $HERE/parity.py $FX/$w/sim.db $(wid $w))"; done
  t=$(ms); $LS start; echo "start (launcher, no worlds) $(( $(ms) - t )) ms"
  t=$(ms); $LS register; echo "register all three $(( $(ms) - t )) ms"
  for w in $WORLDS; do curl -sf -H 'Host: sim.eden.art' http://127.0.0.1:6320/w/$w/v1/config | python3 -c "import json,sys;d=json.load(sys.stdin);print('config',d['worldKey'],d['worldId'],d['worldPath'],d['publicUrl'],d['build'])"; done
  for p in / /w/eden/ /w/mars/ /w/littlemartians/ /__sim/worlds.json /eden-agent.mjs /skill.md /instructions.md /w/mars/2020/ /modular/humanoid/kit.json /mars-assets/; do
    printf 'http %-28s %s\n' $p "$(curl -s -o /dev/null -w '%{http_code} %{content_type}' -H 'Host: sim.eden.art' -H 'Accept: text/html' http://127.0.0.1:6320$p)"; done
  r=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Host: sim.eden.art' http://127.0.0.1:6320/__sim/worlds -d '{}'); echo "create refused: $r"
  sleep 20; $LS status;;
down) systemctl stop sim-old-l2-rehearsal 2>/dev/null || true; sleep 1; ! systemctl is-active -q sim-old-l2-rehearsal && echo "stopped (data kept in /srv/sim-old-l2)";;
purge) systemctl stop sim-old-l2-rehearsal 2>/dev/null || true; rm -rf /srv/sim-old-l2; echo "removed /srv/sim-old-l2";;
esac

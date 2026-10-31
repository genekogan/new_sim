#!/usr/bin/env bash
# Lane FORKS (2026-10-11): fork the old worlds onto eden2 under /worlds/w/{eden,mars,littlemartians}. NOT a cutover:
# the laptop keeps serving /w/*; Caddy, DNS, firewall, /opt/eden3, the mars user and the laptop writers are not touched.
# Run on the laptop from this worktree (clean, at the root/forks commit to ship):
#   bash tools/world-launcher/deploy/forks/deploy-forks.sh            # all steps
#   bash tools/world-launcher/deploy/forks/deploy-forks.sh --data     # 1 only (upload; no service change)
# Steps: 0 preflight · 1 upload the fresh copies (recordings dropped), the fork account registry, descriptors and the
# old-world artifacts into /srv/sim-worlds-data/production (new paths only) · 2 release.sh production (boot-tests every
# registered world, auto-rollback; /worlds restarts for a few seconds) · 3 register the three forks (operator, loopback)
# · 4 public checks.
# UNDO (order matters: unregister forks BEFORE any code rollback, or an older launcher would boot them as new worlds):
#   ssh "$(deploy_target)" 'cd /srv/sim-worlds/production && for w in eden mars littlemartians; do sudo -u simworlds node tools/world-launcher/op.mjs remove-fork --port 4620 --base /worlds --slug $w; done'
#   ssh "$(deploy_target)" 'ln -sfn /srv/sim-worlds/releases/we-2375f5cc0b06 /srv/sim-worlds/production && systemctl restart sim-worlds@production'
#   ssh "$(deploy_target)" 'rm -rf /srv/sim-worlds-data/production/worlds/{eden,mars,littlemartians} /srv/sim-worlds-data/production/forks'
set -euo pipefail
. "$(dirname "$0")/../deploy-env.sh"; E2="$(deploy_target)"; F=<team>/runtime/forks-data; D=/srv/sim-worlds-data/production; A=/srv/sim-old/current
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"; cd "$ROOT"
say() { echo "[$(date -u +%T)] $*"; }

say "0 preflight"
for w in eden mars littlemartians; do test -s $F/$w/sim.db; done; test -s $F/accounts/accounts.sqlite; test -d $F/descriptors-eden2
ssh $E2 "set -e; for w in eden mars littlemartians; do test ! -e $D/worlds/\$w || { echo \"$D/worlds/\$w exists: refusing\"; exit 1; }; done
  python3 -c 'import json;d=json.load(open(\"$D/worlds.json\"));s=[w[\"slug\"] for w in d[\"worlds\"]];assert not set(s)&{\"eden\",\"mars\",\"littlemartians\"},s'
  test -d $A/artifacts/mars-static-composed-1694
  free=\$(df --output=avail -BG /srv | tail -1 | tr -dc 0-9); mem=\$(awk '/MemAvailable/{print int(\$2/1024)}' /proc/meminfo)
  [ \$free -ge 5 ] && [ \$mem -ge 3000 ] || { echo \"disk \${free}G / MemAvailable \${mem}M too low\"; exit 1; }; echo \"eden2 ok: disk \${free}G, MemAvailable \${mem}M\""

say "1 upload data (new paths only)"
ssh $E2 "install -d -o simworlds -g simworlds -m 750 $D/forks $D/forks/descriptors $D/forks/artifacts $D/worlds/eden $D/worlds/mars $D/worlds/littlemartians"
for w in eden mars littlemartians; do rsync -az $F/$w/sim.db $E2:$D/worlds/$w/sim.db; done
rsync -az $F/accounts/accounts.sqlite $E2:$D/forks/accounts.sqlite
rsync -az $F/descriptors-eden2/ $E2:$D/forks/descriptors/
ssh $E2 "set -e; cp -a $A/artifacts/places.v1.json $A/artifacts/regions-boundaries.json $A/input/worlds/eden/activity-spots.v1.json $D/forks/artifacts/
  cp -aL $A/artifacts/mars-static-composed-1694 $D/forks/artifacts/
  chown -R simworlds:simworlds $D/forks $D/worlds/eden $D/worlds/mars $D/worlds/littlemartians; du -sh $D/forks $D/worlds/eden $D/worlds/mars $D/worlds/littlemartians"
[ "${1:-}" = "--data" ] && { say "data uploaded; stopping (--data)"; exit 0; }

say "2 release.sh production"
bash tools/world-launcher/deploy/release.sh production

say "3 register forks"
for w in littlemartians mars eden; do
  ssh $E2 "cd /srv/sim-worlds/production && sudo -u simworlds node tools/world-launcher/op.mjs register-fork --port 4620 --base /worlds --slug $w --descriptor $D/forks/descriptors/$w.json --accounts $D/forks/accounts.sqlite" | head -8
done

say "4 public checks"
for w in eden mars littlemartians; do
  printf '%s config %s page %s cli %s\n' $w "$(curl -s -o /dev/null -w '%{http_code}' https://sim.eden.art/worlds/w/$w/v1/config)" \
    "$(curl -s -o /dev/null -w '%{http_code}' https://sim.eden.art/worlds/w/$w/)" "$(curl -s -o /dev/null -w '%{http_code}' https://sim.eden.art/worlds/w/$w/eden-agent.mjs)"
  printf '  laptop /w/%s config %s\n' $w "$(curl -s -o /dev/null -w '%{http_code}' https://sim.eden.art/w/$w/v1/config)"
done
ssh $E2 "curl -s http://127.0.0.1:4620/worlds/__sim/launcher | python3 -c 'import json,sys;[print(c[\"slug\"],c[\"status\"],c.get(\"port\")) for c in json.load(sys.stdin)[\"children\"]]'; systemctl status sim-worlds@production --no-pager | sed -n 7p"
say "done: walk with node tools/world-launcher/deploy/forks/walk-forks.mjs https://sim.eden.art <team>/lanes/forks-shots/prod"

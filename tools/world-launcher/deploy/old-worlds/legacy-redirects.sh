#!/usr/bin/env bash
# Old->new redirect switch for the original worlds (lane L2 2026-10-17). Run AS ROOT ON EDEN2 after the laptop move.
# Off until Gene's comparison verdict. Flips without a restart (the launcher re-reads the file when it changes).
#   bash legacy-redirects.sh status
#   bash legacy-redirects.sh on  [eden=/worlds/w/eden-2026/] [mars=/worlds/w/my-mars-college-2026-3/] [littlemartians=/worlds/w/little-martians-arium/] [home=/worlds/]
#   bash legacy-redirects.sh off
# `on` with no arguments uses the defaults above (every world, and / -> /worlds/); name only the worlds Gene approved, e.g.
#   bash legacy-redirects.sh on mars=/worlds/w/my-mars-college-2026-3/ littlemartians=/worlds/w/little-martians-arium/
# Only a person opening a page is redirected (302, never cached); agents, the API and live viewers keep the original world,
# and /w/<key>/?stay=1 always opens it. Each target must answer 200 first (checked through the public site).
set -euo pipefail
F=${LG_REDIRECTS:-/srv/sim-worlds-data/legacy/redirects.json}
cmd=${1:-status}; shift || true
case $cmd in
status) [ -f $F ] && cat $F || echo "off (no $F)";;
off) [ -f $F ] && cp -a $F $F.before-$(date -u +%Y%m%d-%H%M%S); printf '{"enabled": false, "worlds": {}}\n' > $F.next; chown simworlds:simworlds $F.next; mv $F.next $F; echo "redirects off";;
on)
  args=("$@"); [ ${#args[@]} -gt 0 ] || args=(eden=/worlds/w/eden-2026/ mars=/worlds/w/my-mars-college-2026-3/ littlemartians=/worlds/w/little-martians-arium/ home=/worlds/)
  json=$(python3 - "${args[@]}" <<'PY'
import json, sys
out = {"enabled": True, "worlds": {}}
for a in sys.argv[1:]:
    k, _, v = a.partition("=")
    if k == "home": out["home"] = v
    elif k in ("eden", "mars", "littlemartians"): out["worlds"][k] = v
    else: sys.exit(f"unknown: {a}")
print(json.dumps(out, indent=2))
PY
)
  for t in $(echo "$json" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(" ".join(list(d["worlds"].values())+([d["home"]] if "home" in d else [])))'); do
    c=$(curl -s -o /dev/null -w '%{http_code}' "https://sim.eden.art$t"); [ "$c" = 200 ] || { echo "target $t answers $c, not 200: nothing changed"; exit 1; }; done
  [ -f $F ] && cp -a $F $F.before-$(date -u +%Y%m%d-%H%M%S)
  echo "$json" > $F.next; chown simworlds:simworlds $F.next; mv $F.next $F
  sleep 1; for w in eden mars littlemartians; do echo "/w/$w/ -> $(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -H 'Accept: text/html' https://sim.eden.art/w/$w/)"; done
  echo "redirects on ($F)";;
*) echo "usage: legacy-redirects.sh status|on [k=path ...]|off"; exit 2;;
esac

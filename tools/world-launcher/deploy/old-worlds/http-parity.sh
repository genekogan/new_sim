#!/usr/bin/env bash
# HTTP parity: same paths on the public site (https://sim.eden.art = laptop proxy, as a stranger sees it; never the
# laptop ports directly) and on the eden2 proxy through an SSH tunnel (127.0.0.1:5771 -> eden2:4670), Host sim.eden.art.
# Prints sha256-prefix per path per side; volatile JSON fields (tick/time/online counts) are stripped.
A=${A:-https://sim.eden.art}; B=${B:-http://127.0.0.1:5771}
norm='import json,sys
raw=sys.stdin.buffer.read()
try:
  d=json.loads(raw)
  def strip(x):
    if isinstance(x,dict): return {k:strip(v) for k,v in x.items() if k not in ("tick","now","serverTime","at","online","uptime","ts","time","clock")}
    if isinstance(x,list): return [strip(v) for v in x]
    return x
  raw=json.dumps(strip(d),sort_keys=True).encode()
except Exception: pass
import hashlib;print(hashlib.sha256(raw).hexdigest()[:12],len(raw))'
for p in / /w/eden /w/mars /w/littlemartians /__sim/worlds.json /eden-agent.mjs /w/eden/eden-agent.mjs /skill.md /instructions.md \
  /w/eden/v1/config /w/mars/v1/config /w/littlemartians/v1/config /w/eden/skill.md /w/mars/skill.md /w/littlemartians/skill.md \
  /w/eden/instructions.md /w/mars/instructions.md /w/littlemartians/instructions.md /w/mars/v1/skill.md "$@"; do
  a=$(curl -s -H 'Host: sim.eden.art' "$A$p" | python3 -c "$norm"); b=$(curl -s -H 'Host: sim.eden.art' "$B$p" | python3 -c "$norm")
  [ "$a" = "$b" ] && echo "SAME $p $a" || echo "DIFF $p public=$a eden2=$b"
done

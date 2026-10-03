#!/usr/bin/env bash
# Outside-in watchdog, run by sim-watch.timer every minute as root.
# Restarts sim if the tick has not advanced for two consecutive checks
# (and the world is not paused), and reports Caddy if it is down.
set -u
for spec in toy:4500:sim mars:4502:sim-world@mars littlemartians:4503:sim-world@littlemartians eden:4504:sim-world@eden; do
IFS=: read -r world port unit <<< "$spec"
systemctl is-active --quiet "$unit" || continue
STATE="/run/sim-watch-$world.tick"
h=$(curl -fsS -m 5 "http://127.0.0.1:$port/healthz" 2>/dev/null) || h=''
tick=$(echo "$h" | sed -n 's/.*"tick":\([0-9]*\).*/\1/p'); paused=$(echo "$h" | grep -c '"paused":true')
prev=$(cat "$STATE" 2>/dev/null || echo "")
echo "${tick:-x}" > "$STATE"
if [ "$paused" = "0" ] && [ -n "$prev" ] && [ "$prev" = "${tick:-x}" ]; then
  echo "$world tick stuck at ${tick:-none} twice: restarting $unit"; systemctl restart "$unit"; logger -t sim-watch "restarted $unit: tick stuck at ${tick:-none}"
fi
done
systemctl is-active --quiet caddy || { echo "caddy is not active"; logger -t sim-watch "caddy inactive"; }

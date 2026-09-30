#!/usr/bin/env bash
# Outside-in watchdog, run by sim-watch.timer every minute as root.
# Restarts sim if the tick has not advanced for two consecutive checks
# (and the world is not paused), and reports Caddy if it is down.
set -u
STATE=/run/sim-watch.tick
h=$(curl -fsS -m 5 http://127.0.0.1:4500/healthz 2>/dev/null) || { echo "healthz unreachable"; echo "x" >> "$STATE"; }
tick=$(echo "$h" | sed -n 's/.*"tick":\([0-9]*\).*/\1/p'); paused=$(echo "$h" | grep -c '"paused":true')
prev=$(cat "$STATE" 2>/dev/null || echo "")
echo "${tick:-x}" > "$STATE"
if [ "$paused" = "0" ] && [ -n "$prev" ] && [ "$prev" = "${tick:-x}" ]; then
  echo "tick stuck at ${tick:-none} twice: restarting sim"; systemctl restart sim; logger -t sim-watch "restarted sim: tick stuck at ${tick:-none}"
fi
systemctl is-active --quiet caddy || { echo "caddy is not active"; logger -t sim-watch "caddy inactive"; }

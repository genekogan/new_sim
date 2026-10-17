#!/usr/bin/env bash
# Activate a world-launcher release ON THE BOX (release.sh runs it over ssh as root after the upload; also by hand):
#   bash activate.sh <staging|production> <release dir> [--restart|--reload]
#
# Without visible downtime (lane C4, backlog G9): when the running unit is the keeper (keeper.mjs) and this release
# carries the same keeper, it switches the stage link and runs `systemctl reload`: the keeper hands the worlds over to
# the new launcher one at a time; the port never closes and viewers reconnect by themselves. Otherwise (first install
# of the keeper, a changed keeper, or --restart) it restarts the unit as before (all worlds blink).
# Then, as before: health with this build, every registered world must answer, else roll back to <stage>.previous by
# the same route (reload, or restart) and exit 1. A failed reload rollback falls back to a restart.
#
# Overrides, for a local rehearsal only: SIM_WORLDS_ROOT (/srv/sim-worlds), SIM_WORLDS_CONF (/etc/sim-worlds/<stage>.conf),
# MAINPID_CMD / RELOAD_CMD / RESTART_CMD (systemctl show -p MainPID / reload / restart sim-worlds@<stage>).
set -euo pipefail
STAGE="${1:?stage}"; REL="${2:?release dir}"; FORCE="${3:-}"
case "$STAGE" in staging|production) ;; *) echo "stage: staging or production"; exit 2;; esac
ROOT="${SIM_WORLDS_ROOT:-/srv/sim-worlds}"; CONF="${SIM_WORLDS_CONF:-/etc/sim-worlds/$STAGE.conf}"; UNIT="sim-worlds@$STAGE"
mainpid() { if [ -n "${MAINPID_CMD:-}" ]; then eval "$MAINPID_CMD"; else systemctl show -p MainPID --value "$UNIT"; fi; }
reload_unit() { if [ -n "${RELOAD_CMD:-}" ]; then eval "$RELOAD_CMD"; else systemctl reload "$UNIT"; fi; }
restart_unit() { if [ -n "${RESTART_CMD:-}" ]; then eval "$RESTART_CMD"; else systemctl restart "$UNIT"; fi; }
BUILD="$(cat "$REL/BUILD")"
ARGS="$(sed -n 's/^SIM_WORLDS_ARGS=//p' "$CONF")"
port="$(echo "$ARGS" | sed -n 's/.*--port \([0-9]*\).*/\1/p')"; data="$(echo "$ARGS" | sed -n 's/.*--data \([^ ]*\).*/\1/p')"
base="$(echo "$ARGS" | sed -n 's/.*--base \([^ ]*\).*/\1/p')"
[ -n "$port" ] && [ -n "$data" ] || { echo "no --port/--data in $CONF"; exit 1; }
# one field of <data>/keeper.json (empty when absent)
kj() { node -e 'try{let v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for(const k of process.argv[2].split("."))v=v?.[k];process.stdout.write(v==null?"":String(v))}catch{}' "$data/keeper.json" "$1"; }
sha() { node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$1"; }
# atomic: a new symlink renamed over the stage link (rename(2) replaces it on Linux and macOS alike)
point() { node -e 'const fs=require("fs");const t=process.argv[2]+".next";try{fs.unlinkSync(t)}catch{};fs.symlinkSync(process.argv[1],t);fs.renameSync(t,process.argv[2])' "$1" "$2"; }

MODE=restart
if [ "$FORCE" != --restart ] && [ -f "$data/keeper.json" ] && [ "$(mainpid)" = "$(kj keeper.pid)" ] && [ "$(kj keeper.sha)" = "$(sha "$REL/tools/world-launcher/keeper.mjs")" ]; then MODE=reload; fi
# --reload: hand over even though this release carries a different keeper. The running (older) keeper stays and runs the
# new launcher: worlds are pre-warmed but there is no canary; the new keeper takes effect at the next restart.
if [ "$FORCE" = --reload ] && [ -f "$data/keeper.json" ] && [ "$(mainpid)" = "$(kj keeper.pid)" ]; then MODE=reload; fi

# reload: wait for the keeper's handover to finish (keeper.json handover.startedAt changes, then done|failed)
activate() {
  if [ "$1" = reload ]; then
    local before; before="$(kj handover.startedAt)"; reload_unit
    local st=""; for i in $(seq 1 1800); do
      if [ "$(kj handover.startedAt)" != "$before" ]; then st="$(kj handover.state)"; case "$st" in done|failed|rolled-back) break;; esac; fi; sleep 1
    done
    node -e 'const h=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).handover;console.log(`handover ${h.from} -> ${h.to}: ${h.state} in ${h.ms} ms`+(h.error?` (${h.error})`:"")+(h.canary?` (canary ${h.canary})`:"")+Object.entries(h.worlds||{}).map(([s,w])=>`\n  ${s}: ${w.ok?w.ms+" ms"+(w.warm?.ok?` (pre-warmed ${w.warm.ms} ms)`:w.warm?.error?` (not pre-warmed: ${w.warm.error})`:"")+(w.canary?" canary":""):"FAILED "+w.error}`).join(""))' "$data/keeper.json"
    # canary failed: the keeper already handed back to the previous release, which serves every world; only the link moves back
    if [ "$st" = rolled-back ]; then canary_back; fi
    [ "$st" = done ]
  else
    restart_unit
  fi
}
canary_back() {
  local prev; prev="$(readlink "$ROOT/$STAGE.previous" 2>/dev/null || true)"
  [ -z "$prev" ] || point "$prev" "$ROOT/$STAGE"
  echo "canary world $(kj handover.canary) could not run on $BUILD: the previous release ($(kj active.build)) serves on, link back to ${prev:-?}; nothing else moved"
  tail -15 "$data/logs/$(kj handover.canary).log" 2>/dev/null || true
  exit 1
}
rollback() {
  local prev; prev="$(readlink "$ROOT/$STAGE.previous" 2>/dev/null || true)"
  [ -n "$prev" ] || { echo "no $STAGE.previous to roll back to"; exit 1; }
  point "$prev" "$ROOT/$STAGE"
  echo "rolling back to $prev ($MODE)"
  if ! activate "$MODE"; then echo "reload rollback incomplete: restarting"; restart_unit; fi
  echo "rolled back to $prev"; exit 1
}

cur="$(readlink "$ROOT/$STAGE" 2>/dev/null || true)"
[ -z "$cur" ] || [ "$cur" = "$REL" ] || point "$cur" "$ROOT/$STAGE.previous"
point "$REL" "$ROOT/$STAGE"
echo "== activate $STAGE -> $BUILD ($MODE)"
t0=$(date +%s)
if ! activate "$MODE"; then echo "the new launcher did not take every world over"; rollback; fi
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$port$base/__sim/healthz" 2>/dev/null | grep -q "\"build\":\"$BUILD\""; then echo "healthy on 127.0.0.1:$port"; break; fi
  [ "$i" != 60 ] || { echo "no healthy $BUILD on :$port"; rollback; }; sleep 1
done
# boot smoke: every registered world must answer on the new release, else roll back (2026-10-11)
for slug in $(node -e 'const d=require(process.argv[1]);for(const w of (Array.isArray(d)?d:(d.worlds||Object.values(d))))console.log(w.slug)' "$data/worlds.json" 2>/dev/null); do
  ok=0; for i in $(seq 1 90); do if curl -fsS -m 5 "http://127.0.0.1:$port$base/w/$slug/v1/config" >/dev/null 2>&1; then ok=1; break; fi; sleep 1; done
  if [ "$ok" = 1 ]; then echo "world $slug boots"; else echo "world $slug FAILED to boot on $BUILD"; tail -15 "$data/logs/$slug.log" 2>/dev/null || true; rollback; fi
done
echo "activated $BUILD on $STAGE by $MODE in $(( $(date +%s) - t0 )) s"

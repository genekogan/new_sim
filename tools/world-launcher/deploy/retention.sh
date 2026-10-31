#!/usr/bin/env bash
# Keep-N retention for eden2's two unpruned piles (OPS, 2026-10-20):
#   - routine compact backups  /srv/sim-worlds-data/release-backups/pre-r<release>-<production|legacy>-<YYYYmmdd-HHMMSS>
#     keep the newest --keep-backups (default 10) PER STAGE; one-off backups with any other name (pre-archive-*, pre-cleanup-*,
#     pre-e1-*, pre-mars-* ...) are never touched and are listed as kept;
#   - legacy releases          /srv/sim-old/releases/we-<sha12>-root (+ its .deps.log), which release.sh legacy never prunes
#     keep the newest --keep-releases (default 5) by mtime PLUS every release a link points at (legacy, legacy.previous,
#     /srv/sim-old/current, any other link in /srv/sim-worlds or /srv/sim-old) PLUS every release a running process uses
#     (cwd/exe/mapped files: the legacy keeper keeps the cwd it started in across reloads, e.g. a 3-day-old release).
#     Other names (so-* kit releases) are never touched.
# DRY RUN IS THE DEFAULT: it only lists what --apply would delete and the bytes freed. --apply deletes (rm -rf); the first real
# prune on eden2 needs Gene's typed yes.
#   tools/world-launcher/deploy/retention.sh --host <user@box>                 dry run on the box (read-only)
#   tools/world-launcher/deploy/retention.sh --host <user@box> --apply         delete (Gene's yes first)
#   tools/world-launcher/deploy/retention.sh --root <fake-tree> --proc <fake-proc>   local test (paths are <root>/srv/...)
set -euo pipefail
KEEP_BACKUPS=10; KEEP_RELEASES=5; APPLY=0; HOST=""; R=""; PROC=/proc
usage() { echo "usage: $0 [--host user@box] [--apply] [--keep-backups N] [--keep-releases N] [--root DIR] [--proc DIR]"; exit 2; }
ARGS=("$@")
while [ $# -gt 0 ]; do case "$1" in
  --apply) APPLY=1;; --dry-run) APPLY=0;;
  --keep-backups) KEEP_BACKUPS="${2:-}"; shift;; --keep-releases) KEEP_RELEASES="${2:-}"; shift;;
  --host) HOST="${2:-}"; shift;; --root) R="${2:-}"; shift;; --proc) PROC="${2:-}"; shift;;
  *) usage;; esac; shift; done
case "$KEEP_BACKUPS$KEEP_RELEASES" in *[!0-9]*|"") usage;; esac
[ "$KEEP_BACKUPS" -ge 3 ] && [ "$KEEP_RELEASES" -ge 2 ] || { echo "refusing: keep at least 3 backups per stage and 2 releases"; exit 2; }
if [ -n "$HOST" ]; then
  # run this same file on the box: strip --host and pass the rest through
  REST=(); skip=0; for a in "${ARGS[@]}"; do if [ $skip = 1 ]; then skip=0; continue; fi; [ "$a" = --host ] && { skip=1; continue; }; REST+=("$(printf %q "$a")"); done
  exec ssh -o BatchMode=yes "$HOST" "bash -s -- ${REST[*]:-}" < "$0"
fi
case "$R" in ""|/*) ;; *) echo "--root needs an absolute path"; exit 2;; esac
BK="$R/srv/sim-worlds-data/release-backups"; REL="$R/srv/sim-old/releases"
MODE=$([ $APPLY = 1 ] && echo APPLY || echo DRY-RUN)
echo "== retention $MODE on $(hostname) $(date -u +%FT%TZ): keep $KEEP_BACKUPS routine backups per stage, $KEEP_RELEASES legacy releases + linked + in use"
DROP=""; COUNT=0
drop() { # path [companion file]: collected first, sized together (releases share inodes via rsync --link-dest), then deleted
  DROP="$DROP
$1"; [ -z "${2:-}" ] || [ ! -e "$2" ] || DROP="$DROP
$2"; COUNT=$((COUNT + 1)); echo "$([ $APPLY = 1 ] && echo 'delete      ' || echo 'would delete') $1"
}

# ---- compact backups
if [ -d "$BK" ]; then
  for stage in production legacy; do
    n=0
    # newest first by the timestamp in the name (not mtime: a copy or chown must not reorder them)
    for d in $(ls -1 "$BK" | grep -E "^pre-r[0-9a-z]+-$stage-[0-9]{8}-[0-9]{6}\$" | awk '{print substr($0, length($0)-14) " " $0}' | sort -r | awk '{print $2}'); do
      n=$((n + 1)); [ -d "$BK/$d" ] || continue
      if [ $n -le "$KEEP_BACKUPS" ]; then echo "keep      $BK/$d"; else drop "$BK/$d"; fi
    done
  done
  ls -1 "$BK" | grep -vE '^pre-r[0-9a-z]+-(production|legacy)-[0-9]{8}-[0-9]{6}$' | sed "s:^:keep (one-off, never pruned) $BK/:" || true
else echo "no $BK"; fi

# ---- legacy releases
if [ -d "$REL" ]; then
  KEEP=""
  for l in "$R"/srv/sim-worlds/* "$R"/srv/sim-old/*; do [ -L "$l" ] && KEEP="$KEEP
$(readlink -f "$l" 2>/dev/null || true)"; done
  INUSE=""
  if [ -d "$PROC" ]; then
    for p in "$PROC"/[0-9]*; do
      for f in cwd exe root; do t=$(readlink "$p/$f" 2>/dev/null || true); case "$t" in "$REL"/*) INUSE="$INUSE
$t";; esac; done
      [ -r "$p/maps" ] && INUSE="$INUSE
$(grep -o "$REL/[^ ]*" "$p/maps" 2>/dev/null || true)"
    done
  fi
  n=0
  for d in $(ls -1dt "$REL"/we-*-root/ 2>/dev/null | sed 's:/$::'); do
    case "$(basename "$d")" in we-[0-9a-f]*-root) ;; *) continue;; esac
    if echo "$KEEP" | grep -qxF "$d"; then echo "keep      $d (a link points here)"; continue; fi
    if echo "$INUSE" | sed 's: (deleted)$::' | grep -qE "^$d(/|\$)"; then echo "keep      $d (a running process uses it)"; continue; fi
    n=$((n + 1))   # linked and in-use releases are kept on top of the newest N
    if [ $n -le "$KEEP_RELEASES" ]; then echo "keep      $d"; else drop "$d" "$d.deps.log"; fi
  done
  ls -1 "$REL" | grep -vE '^we-[0-9a-f]+-root(\.deps\.log)?$' | sed "s:^:keep (not a we-*-root release, never pruned) $REL/:" || true
else echo "no $REL"; fi

# Bytes freed = bytes only the dropped entries hold: du counts each inode once per invocation, so size(kept + dropped) - size(kept).
KEPT=$(for d in "$BK" "$REL"; do [ -d "$d" ] && ls -1 "$d" | sed "s:^:$d/:"; done | grep -vxF "$(echo "$DROP" | sed '/^$/d')" || true)
sz() { [ -z "$1" ] && echo 0 || { echo "$1" | tr '\n' '\0' | xargs -0 du -skc 2>/dev/null | tail -1 | awk '{print $1}'; }; }
ALL_KB=$(sz "$(printf '%s\n%s' "$KEPT" "$(echo "$DROP" | sed '/^$/d')" | sed '/^$/d')"); KEPT_KB=$(sz "$(echo "$KEPT" | sed '/^$/d')")
FREED_MB=$(( (ALL_KB - KEPT_KB) / 1024 ))
if [ $APPLY = 1 ] && [ -n "$(echo "$DROP" | sed '/^$/d')" ]; then
  echo "$DROP" | sed '/^$/d' | while read -r p; do
    case "$p" in "$BK"/pre-r*|"$REL"/we-*-root|"$REL"/we-*-root.deps.log) rm -rf -- "$p";; *) echo "refusing to delete $p"; exit 1;; esac
  done
fi
echo "== $MODE total: $COUNT entries, $FREED_MB MB$([ $APPLY = 1 ] && echo ' freed' || echo ' would be freed (rerun with --apply after Gene says yes)')"
[ $APPLY = 0 ] || df -h "${R:-/}" | tail -1

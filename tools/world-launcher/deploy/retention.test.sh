#!/usr/bin/env bash
# Local test of retention.sh against a fake eden2 tree (no network, no box). bash tools/world-launcher/deploy/retention.test.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; T="$(mktemp -d "${TMPDIR:-/tmp}/retention-test.XXXXXX")"
R="$T/root"; P="$T/proc"; BK="$R/srv/sim-worlds-data/release-backups"; REL="$R/srv/sim-old/releases"
mkdir -p "$BK" "$REL" "$R/srv/sim-worlds" "$R/srv/sim-old" "$P/100" "$P/200"
fail() { echo "FAIL: $*"; exit 1; }
# 14 routine releases' backups (both stages) + one-offs
for i in $(seq 10 23); do
  for s in production legacy; do mkdir -p "$BK/pre-r3$i-$s-20261020-${i}0000"; echo x > "$BK/pre-r3$i-$s-20261020-${i}0000/sim.db"; done
done
for o in pre-archive-production-20261019-054812 pre-cleanup-20261016-230711 pre-mars-20261017-012717; do mkdir -p "$BK/$o"; done
# an old backup whose mtime is newest must still go by its name's timestamp
mkdir -p "$BK/pre-r310-production-20261020-090000"; touch "$BK/pre-r310-production-20261020-090000"
# 12 legacy releases, oldest first (mtime order); plus a kit release
i=0; for sha in aaaaaaaaaaa1 aaaaaaaaaaa2 aaaaaaaaaaa3 aaaaaaaaaaa4 aaaaaaaaaaa5 aaaaaaaaaaa6 aaaaaaaaaaa7 aaaaaaaaaaa8 aaaaaaaaaaa9 aaaaaaaaaab0 aaaaaaaaaab1 aaaaaaaaaab2; do
  i=$((i + 1)); d="$REL/we-$sha-root"; mkdir -p "$d"; echo log > "$d.deps.log"; touch -t "2026102001$(printf %02d $i)" "$d"
done
mkdir -p "$REL/so-1080cfa9-63acd353"
ln -s "$REL/we-aaaaaaaaaab2-root" "$R/srv/sim-worlds/legacy"
ln -s "$REL/we-aaaaaaaaaab1-root" "$R/srv/sim-worlds/legacy.previous"
ln -s "$REL/so-1080cfa9-63acd353" "$R/srv/sim-old/current"
ln -s "$REL/we-aaaaaaaaaaa3-root" "$P/100/cwd"            # an old keeper still running from an old release
ln -s "/usr/bin/node" "$P/200/exe"; echo "7f00 r-xp 0 0:0 1 $REL/we-aaaaaaaaaaa2-root/node_modules/x.node" > "$P/200/maps"

before=$(find "$R" | wc -l)
out=$(bash "$HERE/retention.sh" --root "$R" --proc "$P"); echo "$out" | tail -1
[ "$(find "$R" | wc -l)" = "$before" ] || fail "dry run changed the tree"
echo "$out" | grep -q "DRY-RUN total: 12 entries" || fail "dry run count (want 5+4 backups + 3 releases): $(echo "$out" | tail -1)"

bash "$HERE/retention.sh" --root "$R" --proc "$P" --apply > "$T/apply.log"
for s in production legacy; do [ "$(ls -1 "$BK" | grep -cE -- "^pre-r[0-9]+-$s-2026")" = 10 ] || fail "$s backups != 10"; done
[ -d "$BK/pre-r323-legacy-20261020-230000" ] && [ ! -d "$BK/pre-r313-production-20261020-130000" ] || fail "kept the wrong backups"
[ ! -d "$BK/pre-r310-production-20261020-090000" ] || fail "mtime-touched old backup kept"
for o in pre-archive-production-20261019-054812 pre-cleanup-20261016-230711 pre-mars-20261017-012717; do [ -d "$BK/$o" ] || fail "one-off $o deleted"; done
for sha in aaaaaaaaaab2 aaaaaaaaaab1 aaaaaaaaaab0 aaaaaaaaaaa9 aaaaaaaaaaa8 aaaaaaaaaaa7 aaaaaaaaaaa6 aaaaaaaaaaa3 aaaaaaaaaaa2; do [ -d "$REL/we-$sha-root" ] || fail "release $sha deleted"; done
for sha in aaaaaaaaaaa1 aaaaaaaaaaa4 aaaaaaaaaaa5; do [ ! -e "$REL/we-$sha-root" ] && [ ! -e "$REL/we-$sha-root.deps.log" ] || fail "release $sha kept"; done
[ -d "$REL/so-1080cfa9-63acd353" ] || fail "kit release deleted"
bash "$HERE/retention.sh" --root "$R" --proc "$P" | grep -q "DRY-RUN total: 0 entries" || fail "second run not idempotent"
bash "$HERE/retention.sh" --root "$R" --keep-releases 1 >/dev/null 2>&1 && fail "accepted keep-releases 1" || true
mv "$T" "${TMPDIR:-/tmp}/retention-test-done.$$" 2>/dev/null || true
echo "PASS retention.sh (dry run unchanged; 10/stage backups; 5 newest + linked + in-use releases; one-offs and kit kept)"

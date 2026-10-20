#!/bin/bash
# Compact (VACUUM INTO) copy of every /worlds world + registries on eden2. Usage: compact-backup.sh <label> [production|legacy] (default production)
set -euo pipefail
L="$1"; STAGE="${2:-production}"; D=/srv/sim-worlds-data/$STAGE; B=/srv/sim-worlds-data/release-backups/$L-$STAGE-$(date -u +%Y%m%d-%H%M%S)
mkdir -p "$B/worlds" "$B/forks"
cat > /tmp/r33-bk.mjs <<'JS'
import { DatabaseSync } from 'node:sqlite';
const [src, dest] = process.argv.slice(2);
// VACUUM INTO: one read transaction, compact, never restarts under concurrent writes (the backup API does on a busy world)
const db = new DatabaseSync(src, { readOnly: true }); db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`); db.close();
const c = new DatabaseSync(dest, { readOnly: true }); const r = c.prepare('PRAGMA integrity_check').get(); c.close();
console.log(dest, Object.values(r)[0]);
JS
for w in "$D"/worlds/*/; do s=$(basename "$w"); [ -f "$w/sim.db" ] || continue; mkdir -p "$B/worlds/$s"; node /tmp/r33-bk.mjs "$w/sim.db" "$B/worlds/$s/sim.db"; done
for f in accounts.sqlite forks/accounts.sqlite; do [ -f "$D/$f" ] && node /tmp/r33-bk.mjs "$D/$f" "$B/$f"; done
[ -f "$D/worlds.json" ] && cp "$D/worlds.json" "$B/" || true
chown -R simworlds:simworlds "$B"; chmod -R go-rwx "$B"; du -sh "$B"; echo "$B"

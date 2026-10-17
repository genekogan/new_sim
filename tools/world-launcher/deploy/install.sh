#!/usr/bin/env bash
# One-time, idempotent setup of the world launcher on eden2. Run as root ON THE BOX:
#   bash install.sh            (release.sh copies it to /srv/sim-worlds/install.sh and runs it)
# Creates the unprivileged user, its dirs, the systemd unit and per-stage settings. It never starts
# anything, never edits an existing settings file, and never touches /opt/eden3, the sim or mars users,
# the existing release's /srv/sim and /srv/sim-data*, Caddy, DNS or the firewall.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
UNIT_SRC="${UNIT_SRC:-$HERE/sim-worlds@.service}"

id simworlds >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/simworlds --shell /usr/sbin/nologin simworlds
install -d -o simworlds -g simworlds -m 750 /srv/sim-worlds /srv/sim-worlds/releases
install -d -o simworlds -g simworlds -m 750 /srv/sim-worlds-data /srv/sim-worlds-data/staging /srv/sim-worlds-data/production
install -d -o root -g simworlds -m 750 /etc/sim-worlds

# Per-stage settings: ports and caps only (no secrets). Existing files are kept as they are.
# eden2 (cpx42): 16 GB RAM, ~10 GB available with eden3 + the existing Sim release running; a new world's
# server idles at ~250-350 MB RSS. Production: 24 running worlds in a 6 GB cgroup (~250 MB each), 60
# registered (sleeping worlds cost only disk), and no world boots while the host has under 2.5 GB free.
# Staging: small, for the rehearsal party; stop it when production is live.
if [ ! -f /etc/sim-worlds/staging.conf ]; then
  cat > /etc/sim-worlds/staging.conf <<'CONF'
# sim-worlds@staging: localhost only, dev auth (staging check before the account provider is merged).
SIM_WORLDS_ARGS=--base /worlds --port 4600 --range 4601-4619 --data /srv/sim-worlds-data/staging --dev-auth --max-worlds 20 --max-running 8 --min-free-mb 2500 --world-heap-mb 768 --create-limit 20 --mars-web /srv/sim-worlds/staging/mars-web --eager 2
CONF
fi
if [ ! -f /etc/sim-worlds/production.conf ]; then
  cat > /etc/sim-worlds/production.conf <<'CONF'
# sim-worlds@production: behind Caddy on https://sim.eden.art for /worlds* only (one prefix; nothing else of the origin).
# /etc/sim-worlds/production-auth.env is a PLACEHOLDER path: Codex or Gene provisions it (CLERK_PUBLISHABLE_KEY,
# CLERK_ISSUER_URL=https://clerk.eden.art, CLERK_AUTHORIZED_PARTIES=https://sim.eden.art; no secret key). Each world's node
# loads it by path (--env-file); the launcher only reads the publishable key and issuer. Never copied from /opt/eden3.
SIM_WORLDS_ARGS=--base /worlds --port 4620 --range 4621-4659 --data /srv/sim-worlds-data/production --public-origin https://sim.eden.art --auth-env /etc/sim-worlds/production-auth.env --max-worlds 60 --max-running 24 --min-free-mb 2500 --world-heap-mb 768 --create-limit 6 --mars-web /srv/sim-worlds/production/mars-web --eager 4
CONF
fi
chown root:simworlds /etc/sim-worlds/*.conf && chmod 640 /etc/sim-worlds/*.conf
# The Soul CLI 1.9 and its guides ship inside each release (tools/world-launcher/soul/, pinned by sha in SOURCES.json),
# so no --soul-* flags are needed. Nightly backup destination:
install -d -o simworlds -g simworlds -m 750 /srv/sim-worlds-backups

install -m 644 "$UNIT_SRC" /etc/systemd/system/sim-worlds@.service
# Memory budget per stage: written once, never overwritten (release.sh runs this on every release; an operator's raise,
# e.g. production 8G/9G on 2026-10-17, must survive it). legacy = the three original worlds (old-worlds/README.md).
mem() { local d=/etc/systemd/system/sim-worlds@$1.service.d; install -d "$d"; [ -f "$d/10-memory.conf" ] || printf '[Service]\nMemoryHigh=%s\nMemoryMax=%s\n' "$2" "$3" > "$d/10-memory.conf"; }
mem staging 2500M 3G; mem production 8G 9G
install -m 644 "$HERE/sim-worlds-backup@.service" /etc/systemd/system/sim-worlds-backup@.service
install -m 644 "$HERE/sim-worlds-backup@.timer" /etc/systemd/system/sim-worlds-backup@.timer
install -m 644 "$HERE/sim-worlds-health@.service" /etc/systemd/system/sim-worlds-health@.service
install -m 644 "$HERE/sim-worlds-health@.timer" /etc/systemd/system/sim-worlds-health@.timer
systemctl daemon-reload
echo "installed: user simworlds, /srv/sim-worlds{,-data}, /etc/sim-worlds/{staging,production}.conf, sim-worlds@.service, sim-worlds-{backup,health}@.{service,timer} (nothing started)"

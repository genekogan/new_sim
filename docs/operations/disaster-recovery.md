# Sim disaster recovery: a blank Hetzner box to a serving sim.eden.art

Lane DR, 2026-10-21. Drilled against the 2026-10-21 04:18Z restic snapshots (production `47dd1793`, legacy `9e507420`),
restored on eden2 into a scratch dir and booted on the laptop. Evidence: `team/scratch/t4/dr/` and `team/lanes/t4-dr.md`.
This file is the recipe; `RUNBOOK`-style one-liners for the running box stay in `RELEASES.md` and `old-worlds/README.md`.

What "serving" means here: `https://sim.eden.art/worlds/` (stage `production`, the god-mode worlds) and
`https://sim.eden.art/` + `/w/eden|mars|littlemartians` (stage `legacy`, the three original worlds), both with Clerk sign-in,
on the release `main` was at, with every world's history as of the last nightly backup (03:30Z).

## 0. What you need before you start (and where it lives today)

| Thing | Today | Needed for |
|---|---|---|
| the restic repository | `/srv/sim-worlds-backups/restic` **on eden2 only** | every world's data |
| the restic password | `/etc/sim-worlds/restic.pass` **on eden2 only** | opening the repository |
| a clean `main` checkout + `.lane/mars-web` | Gene's laptop (`<repo>`) | `release.sh` |
| SSH key for root on the new box | Gene | everything below |
| Clerk public settings | Gene (Clerk dashboard) | sign-in |
| Cloudflare DNS for `eden.art` | Gene | the name pointing at the new box |

**If eden2 is lost entirely, today the backups are lost with it** (see Gaps). The steps below assume the repository and its
password reached the new box somehow: an off-box copy (R2, `SIM_BACKUP_OFFSITE`), or eden2's disk still readable.

Secrets are named here, never copied into this file; Gene provisions each by name.

## 1. The box (~10 min, not measured: no blank box was drilled)

Hetzner Cloud: Ubuntu 24.04, x86, CPX42 class (16 GB RAM; production is capped at 8G/9G, legacy at 2G/2560M). Firewall:
inbound 22, 80, 443 only. As root:

```sh
apt-get update && apt-get -y upgrade
apt-get install -y curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https rsync sqlite3 python3 restic
# Node 22 (nodesource, as on eden2: v22.23.2)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs
corepack enable    # pnpm comes from the repo's packageManager field (eden2: corepack 0.34.6)
# Caddy (caddy-stable, as on eden2: 2.11.4)
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy
restic version    # eden2: 0.16.4 (Ubuntu apt); the repository format needs >= 0.14
```

eden2 also runs eden3 (`/opt/eden3`), the Mars MCP (`mars` user) and its own Caddyfile entries for them: none of that is
part of Sim and none of it is rebuilt here.

## 2. Releases (measured on eden2: production 78 s, legacy upload 27 s + activate 19 s)

From Gene's laptop, a clean checkout at the commit to restore (normally `main` = what was live; `RELEASES.md` lists it),
with `.lane/mars-web` present. `SIM_WORLDS_HOST` points `release.sh` at the new box (default `root@eden2`):

```sh
cd <repo> && git status --porcelain --untracked-files=no   # must be empty
SIM_WORLDS_HOST=root@<new-ip> tools/world-launcher/deploy/release.sh production --no-activate
SIM_WORLDS_HOST=root@<new-ip> tools/world-launcher/deploy/release.sh legacy        # never activates
```

`release.sh production` runs `install.sh` on the box: user `simworlds`, `/srv/sim-worlds{,-data,-backups}`, `/etc/sim-worlds/`
with `production.conf` + `staging.conf`, the unit `sim-worlds@.service`, the backup and health timers, and the production
memory drop-in (8G/9G). `--no-activate` matters: activating now would start production on an empty data dir.

## 3. Secrets and settings Gene provisions (by name; root:simworlds 0640)

- `/etc/sim-worlds/production-auth.env`: `CLERK_PUBLISHABLE_KEY`, `CLERK_ISSUER_URL` (https://clerk.eden.art),
  `CLERK_AUTHORIZED_PARTIES` (https://sim.eden.art). Public settings only, no Clerk secret key. Legacy reads the same file.
- `/etc/sim-worlds/restic.pass`: the repository password (the same one, or the backups cannot be opened).
- `/etc/sim-worlds/backup.env`: from `backup.env.example`; the retention line as on eden2
  (`SIM_BACKUP_KEEP="--keep-daily 7 --keep-weekly 4 --keep-monthly 6"`); for the off-box copy `SIM_BACKUP_OFFSITE` plus the R2
  key pair `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.
- `/etc/sim-worlds/legacy.conf` (not secret; `legacy-stage.sh setup` would write it, but it reads the old sealed kit
  `/srv/sim-old/current`, which a rebuilt box does not have). Write the line `legacy-stage.sh` defines:

```sh
cat > /etc/sim-worlds/legacy.conf <<'CONF'
SIM_WORLDS_ARGS=--old-worlds-root --port 4670 --range 4660-4662 --data /srv/sim-worlds-data/legacy --public-origin https://sim.eden.art --auth-env /etc/sim-worlds/production-auth.env --max-worlds 3 --max-running 3 --min-free-mb 1500 --create-limit 0 --mars-web /srv/sim-worlds/legacy/mars-web --eager 3
CONF
chown root:simworlds /etc/sim-worlds/legacy.conf && chmod 640 /etc/sim-worlds/legacy.conf
install -d /etc/systemd/system/sim-worlds@legacy.service.d
printf '[Service]\nMemoryHigh=2G\nMemoryMax=2560M\n' > /etc/systemd/system/sim-worlds@legacy.service.d/10-memory.conf
systemctl daemon-reload
```

Never recreate `sim-worlds@production.service.d/20-catalog.conf` (eden2 still has it; nothing reads `CATALOG_*` any more).
From the first backup after this file's commit ships, each snapshot also carries these non-secret settings under
`host-config/` (step 4): compare against them rather than retyping.

## 4. Data (measured: restore 2 s per stage, 8/8 + 4/4 quick_check ok)

The repository at `/srv/sim-worlds-backups/restic` (or point `RESTIC_REPOSITORY` at the R2 copy, with its key pair in the
environment). The restore refuses a non-empty dir; `install.sh` left the production dir empty.

```sh
R=/srv/sim-worlds/releases/we-<sha12>          # the release just uploaded
cd $R && set -a && . /etc/sim-worlds/backup.env && set +a
node tools/world-launcher/deploy/backup-restic.mjs list
node tools/world-launcher/deploy/backup-restic.mjs restore production latest /srv/sim-worlds-data/production
node tools/world-launcher/deploy/backup-restic.mjs restore legacy latest /srv/sim-worlds-data/legacy
for s in production legacy; do d=/srv/sim-worlds-data/$s; [ -d $d/host-config ] && mv $d/host-config /root/host-config-$s; done
chown -R simworlds:simworlds /srv/sim-worlds-data
```

Each stage's snapshot holds `accounts.sqlite`, `forks/accounts.sqlite`, `worlds/<slug>/sim.db` (online-backup copies, every
one quick_checked), `worlds.json`, `audit.jsonl`, `worlds/assets` (uploads + the wire `.br` cache), and from the first night
after `eb4783de7` ships, `forks/descriptors` + `forks/artifacts` (Mars web 76 MB, places, regions, activity spots,
upper-floor facts). **Legacy needs those fork files to boot**: a snapshot from before that release does not have them, and the
only other copies are eden2 itself and an older laptop copy (`team/runtime/forks-data`, partial). `worlds.json` names
descriptor paths under `/srv/sim-worlds-data/legacy/forks/`, the same on the new box. Ports in `worlds.json` are reassigned
by the launcher.

What a restore brings back: each world's event log, Souls, accounts and uploads as of 03:30Z. What it does not: the hours
since (activity after the last nightly run is lost: RPO up to 24 h), sessions (people sign in again), and live pairing tokens.

## 5. Start (measured on the laptop: 6/6 production worlds listening in 2.0-4.3 s each from their snapshots)

```sh
systemctl enable sim-worlds@production sim-worlds@legacy
bash /srv/sim-worlds/releases/we-<sha12>/tools/world-launcher/deploy/activate.sh production /srv/sim-worlds/releases/we-<sha12> --restart
L=/srv/sim-old/releases/we-<sha12>-root
(cd $L && sha256sum -c --quiet FILES.sha256) && bash $L/tools/world-launcher/deploy/activate.sh legacy $L --restart
systemctl enable --now sim-worlds-backup@production.timer sim-worlds-backup@legacy.timer \
  sim-worlds-health@production.timer sim-worlds-health@legacy.timer
curl -fsS http://127.0.0.1:4620/worlds/__sim/healthz; curl -fsS http://127.0.0.1:4670/__sim/healthz
```

`activate.sh` checks health and boots every registered world, else exits 1 (on a first install there is no `.previous`).
Each legacy world checks its durable clock frontier at boot (the engine and kernel hashes recorded at the last handover):
a world that boots has replayed its history to the same hashes.

## 6. Caddy

Copy the two files from the snapshot's `host-config/` (or, before that exists, from eden2 / the text below):
`/etc/caddy/sites/sim.caddy` and `/etc/caddy/sim-blobs.snippet` (the repo copy: `deploy/blobs/sim-blobs.snippet`). **The
repo's `infra/sim.caddy` is stale** (ports 4500-4504 of the pre-launcher release): do not use it. The live site file:
imports `/etc/caddy/sim-blobs.snippet`; a `(sim_client_ip)` snippet that trusts `CF-Connecting-IP` only from Cloudflare's
published ranges (else the peer address) and passes it as `X-Forwarded-For`; `https://sim.eden.art` with `encode zstd gzip`,
`X-Robots-Tag noindex`, `/worlds*` -> `127.0.0.1:4620`, `import blobs`, everything else -> `127.0.0.1:4670`.
`/etc/caddy/Caddyfile` needs only `{ admin 127.0.0.1:2019 }` and `import sites/*.caddy`. Rename the eden2 sslip name
(`<eden2-sslip-host>`) to the new IP's, or drop it. Then `caddy validate --config /etc/caddy/Caddyfile &&
systemctl reload caddy`, and after any reboot check `systemctl is-active caddy`.

Blobs (`/srv/sim-blobs`, 590 MB, 70 objects) are not in any backup: 29 have a CDN copy (assets.eden.art, manifest keys) and
are served from there by the web build; of the rest, 36 are named nowhere in the repo and 5 are named in the repo with no CDN
key (`team/scratch/t4/dr/blobs-nokey.txt`). Accept CDN-only (those 5 answer 404 until re-staged) or re-stage from a copy.

## 7. Gene: DNS and Cloudflare (~5 min + propagation)

1. Cloudflare, zone `eden.art`: record `sim` A -> the new IP, proxied (orange cloud); keep the zone's SSL mode as it is.
2. Hetzner firewall on the new box: 22, 80, 443.
3. Caddy then gets its certificate on the first request (HTTP-01 through Cloudflare); watch `journalctl -u caddy`.

## 8. Check, as a stranger

`https://sim.eden.art/worlds/` lists the worlds; open one, it renders and its clock moves; sign in with Clerk; open
`https://sim.eden.art/w/eden` (and mars, littlemartians). Then `sim-worlds-backup@production.service` once by hand
(`systemctl start`), and `backup-restic.mjs list` shows a new snapshot from this host.

## Measured times (2026-10-21 drill)

restic list: instant; restore: 2.06 s production (250 MB), 2.02 s legacy (139 MB); copy to the laptop: 38 s (405 MB); world
boot from snapshot: 2.0-4.3 s; release production: 78 s; legacy upload 27 s, activate 19 s. Not measured: a blank box's
package install and the DNS change. Estimated total with the backups at hand: under an hour, most of it hands-on.

Verification of the restored data: the event-log prefix hash of all 9 worlds equals live's (every seq up to the restored
head); idle worlds' snapshot rows equal live's row for row; a production rewind-replay (drop each world's newest snapshot,
boot from the one before, let the laptop write its own at the same tick) is recorded in `team/scratch/t4/dr/rewind-result-prod2.txt`.

## Gaps (and the cheap fixes)

1. **The repository and its password live only on eden2.** Losing eden2 loses every backup. Fix (Gene's decision, open):
   an R2 bucket + key pair in `backup.env` (`SIM_BACKUP_OFFSITE`, already supported: each night copies the new snapshots
   and applies the same retention), and a copy of `restic.pass` somewhere off the box (a password manager).
2. **Fork inputs were not backed up** before `eb4783de7`: fixed there (descriptors + artifacts mirrored each night; static,
   so about 0 MB per night after the first).
3. **Host settings were not backed up** (`/etc/sim-worlds/<stage>.conf`, the memory drop-ins, the Caddy site and snippet;
   eden2 only, and the repo's `infra/sim.caddy` is stale). Fixed with this file: each stage's snapshot carries an exact
   allowlist of them under `host-config/` (never `production-auth.env`, `restic.pass`, `backup.env` or `20-catalog.conf`).
4. **Blobs** (`/srv/sim-blobs`, 590 MB) are not backed up and 41 of 70 have no CDN copy. Cheapest fix: put the 5 that the
   repo names on the CDN (the CDN lane's upload), and decide whether the 36 unreferenced ones are kept at all.
5. **Archived worlds** (`/srv/sim-worlds-data/production/archive`, 500 MB) and the dated pre-restic sets
   (`/srv/sim-worlds-data/legacy/backups`, 318 MB) are not in the restic snapshots. Archive = worlds taken down; restoring them is rarely wanted.
6. **The sealed old kit** `/srv/sim-old/current` (`so-1080cfa9`) is not rebuildable; nothing in a restore needs it once the
   fork files are in the backups (`legacy-stage.sh setup` does read it, hence the hand-written `legacy.conf` above).
7. **RPO is a day** (03:30Z nightly). More often costs little (13 MB/night measured) if wanted.
8. Restore-then-boot is not bit-identical to running on: boot-time checks that log events (e.g. NAV's once-per-boot
   cut-off rescue, `edge-relocate`) can add events a continuously running world would not. The added events are logged
   and replay deterministically; live restarts do the same.

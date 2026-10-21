# Sim successor checkout

Canonical code home: `<repo>`. Strategy: `<eden4>/`.
Gene authorized the merge in `23-MERGE-KICKOFF-PROMPT.md`; execute plan 22 v3
with the kickoff's corrections. Read `docs/sim/RUNBOOK.md` before running
services. Original `<old-sim-repo>`, `~/Mars`, `~/Dev/littlemartians` are references;
Mars and Little Martians are read-only during this tranche.

Never touch eden3 (`/opt/eden3`), the Mars service/user, unrelated server
users, DNS or Cloudflare. Only Sim's Caddy site, units, data and Litestream
entries are in scope. No raw media/source archives/vendor SDK. Never stage,
commit or push secrets, and never bypass the global pre-commit hook.

Local development/test minds are fake. Model budget <=$1 per world per
rolling real 24 hours; keep the existing stricter default $0.50. New worlds
require the verified human owner. Toy retains `toy-1` and its database.
No timetable/routine object. World customs and perception inform decisions;
triggers cause thinking, and only an explicit NOW instruction runs directly.

## Releases (current since 2026-10-20; the old `pnpm check` / staging / `/srv/sim/ops` recipe is retired)

Only the release owner (R, id on the top line of `<team>/lanes/ROSTER.md`, holding `team/lanes/DEPLOY.lock`) ships,
writes to eden2 and pushes. A lane hands R `branch@sha` + a gate receipt; R ships it on current main.
- **Gate (Modal; never full suites on the laptop):** `tools/test-harness/release-gate.sh <head> --baseline <main sha>
  --out <dir>`. Clean = 0 new failures, 0 blockers, 0 unexpected skips; the standing quarantine
  (`tools/test-harness/quarantine.json`) has **9 entries** (11 retired). GitHub Actions runs fail at start (account
  billing, Gene's); the Modal gate is the release check.
- **Walkability is gated (V3-walk):** the gate audits fixed copies of eden-2026, bench-eden, bench-hamlet and a fresh Eden 2026
  genesis (`apps/server/src/god/walk-audit.ts`: bad destinations, one-ways, goalless things, floats per place) and fails when any
  place is worse than `tools/test-harness/walk/baseline/`. Check locally in ~1 min: `node tools/test-harness/walk/walk.mjs`. A
  deliberate change (better or worse) updates the baseline as a reviewed file change: `walk.mjs --write`, or
  `walk.mjs --from <gate out>/candidate/out/suite/walk --write`.
- **Build:** `tools/world-launcher/deploy/release.sh production --reload` (exactly HEAD of a clean tree). The asset CDN is
  ON by default (`SIM_ASSETS_CDN_ENABLED=0` opts out for one release; other values refused); the build fails without the CDN
  origin + `cdn-manifest-*.json` in dist, or without the Eden experience pin call. It keeps the stage links + 3 newest
  `/srv/sim-worlds/releases`. New CDN objects go up first with `tools/cdn/publish.mjs` (R only; key by path, never read).
- **Order per ship:** compact backups of production and legacy (`pre-r<NNN>-<stage>-<ts>`) → `release.sh legacy`
  (upload only) → [live probe: `deploy/release-probe.mjs ... --expect-build we-<sha12>`, wait for `<dir>/ready`] →
  `release.sh production --reload` → legacy: `sha256sum -c FILES.sha256` in `/srv/sim-old/releases/<build>-root`, then
  its `activate.sh legacy <rel> --reload`, update `LEGACY-RELEASE` → [touch `<dir>/released`] → healthz (build, 6/6,
  hostOk) → walks (all worlds, desktop + phone, poster + stall) → `node tools/cdn/cdn-walk.mjs <out>
  https://sim.eden.art/worlds/w/eden-2026/ https://sim.eden.art/w/mars https://sim.eden.art/w/eden` (must PASS) → lane
  live checks → fast-forward main + push → SHIP-LOG (`<team>/reviews/sim-release-20261015/SHIP-LOG.md`) with the
  rollback commands (`activate.sh <stage> <previous release> --reload`).
- **eden2 retention:** `tools/world-launcher/deploy/retention.sh --host root@eden2` lists what keep-N would delete
  (10 routine backups per stage; 5 legacy releases + linked + in use). Dry run is the default; `--apply` needs Gene's yes.
- **One command:** `tools/world-launcher/deploy/ship.sh --label <n>` runs that order from backups to cdn-walk (`--dry-run`
  first; see `tools/world-launcher/deploy/RELEASES.md`); R still does lane checks, main + push, SHIP-LOG.
- Do not replay passing checks without a source change or unresolved finding that warrants it.

Imported `mars/AGENTS.md` carries original-checkout history; its prohibitions
on authorized Eden fork work are superseded by Gene's kickoff, while engine
determinism, geometric and evidence safeguards remain useful.

Parallel helpers: bounded Opus tasks in successor worktrees only. Lead owns
import, server, persistence/day/steering and deployment. Before adding helpers,
check subscription quota. Do not import computer workshop/library reading
candidates; wait for the read-only boundary's final publication receipt and
import both activities plus six shared wiring files as one unit.

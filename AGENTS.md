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
  --out <dir>` (`--dry-run` first: it shows whether main's run comes from the gate cache; see REMOTE-SUITE.md). Clean = 0 new failures, 0 blockers, 0 unexpected skips; the standing quarantine
  (`tools/test-harness/quarantine.json`) has **9 entries** (10 retired); a clean gate reports `quarantined 8`, because the
  east-house phase A whole-skeleton entry now runs and passes (kept only for older baselines; see the file's 2026-10-21
  note). GitHub Actions runs fail at start (account billing, Gene's); the Modal gate is the release check.
  At most 3 gates in flight across tranches (Modal workspace limit is 100 containers; one gate = 15); ledger
  `team/lanes/GATES.inflight` (append a line before you start, remove it when receipt.json exists).
- **Conformance re-pins:** known library failures are pinned by exact def hash, so a changed def revision fails
  `conformance` until a reviewed supplement `packages/conformance/conformance/<lane>-<date>.json` re-pins its documented
  tuples hash for hash (e.g. `bsgen-20261021.json`, `seatdef-20261022.json`), listed with a note in that folder's
  README. A re-pin is made by the lane that changed the behaviour, in the same change, with its reason in that record note;
  no approval is needed (Gene, 2026-10-23: no approval gates for test expectations, baselines or skill bumps). Never edit older supplements.
- **Walkability is gated (V3-walk):** the gate audits fixed copies of eden-2026, bench-eden, bench-hamlet, a fresh Eden 2026
  genesis and the generated fuzz world (`tools/test-harness/walk/fuzz-world.mjs`, `walk-audit.ts --fuzz`: every building type
  x 5 yaws x 3 grounds, packed rows, furnished, stacked, nested; also scores seats and beds a Soul cannot use) with
  `apps/server/src/god/walk-audit.ts` (bad destinations, one-ways, goalless things, floats per place), and fails when any
  place is worse than `tools/test-harness/walk/baseline/` (incl. `fuzz.json`). Check locally in ~1 min:
  `node tools/test-harness/walk/walk.mjs` (`--world fuzz,bench-hamlet` for a subset). A deliberate change (better or worse)
  updates the baseline as a reviewed file change, in its own commit before the final gate: `walk.mjs --write`, or
  `walk.mjs --from <gate out>/candidate/out/suite/walk --write`.
- **Bundle size is gated (V3-bundle):** `tools/test-harness/bundle-budget/bundle-gate.test.mjs` measures the web build
  (code files; keyed by chunk name without its hash, raw + gzip) against the reviewed
  `tools/test-harness/bundle-budget/baseline.json` and fails on +10% or more for any chunk (over 4 KB slack) or the total,
  or on a new chunk of 100 KB+ the baseline does not know. Local check: `node tools/test-harness/bundle-budget/budget.mjs
  --build --check`. A deliberate change updates the baseline in its own reviewed commit: `budget.mjs --build --write`, or
  `budget.mjs --from <gate out>/candidate/out/suite/bundle/current.json --write`; the gate never writes it.
- **Godmode build safety (BUILDSAFE, `buildsafe/1`):** god `commitBatch` repairs at commit time what an edit newly cuts off
  (a 1 m gate or a nudge, in the same batch, on the shared clearance rule); leftovers come back as one actionable line plus
  a tested op, and a sealed refusal stands unless the repair reopens it. Never add a separate post-hoc walk fix for a
  fence or wall that cuts off a way.
- **Seats (SEATDEF):** core seat heights come from the def's model geometry (a change is a new def revision; old revisions
  keep their bytes). The edge sit capability refuses only `seat.too-high`; a low seat is sat on.
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

## Visitor analytics

GoatCounter site `simeden`, dashboard **https://simeden.goatcounter.com** (Gene's account; the `site-analytics` skill
covers it beside genekogan.com and mars.college). `apps/web/src/visitor-counts.ts` sends the counts itself (no GoatCounter
script): page views as `/w/<slug>` (or `/` for the world list; never a query, hash, Soul id or token), referrer origin,
screen width (the dashboard's phone/desktop split), and events `enter world <slug>` (arrival card gone), `soul paired`,
`god connected`. Cookieless. Not counted: local/private/tailnet hosts, `navigator.webdriver` (all ship.sh walks, probe,
poster, stall, cdn-walk), `?shot`, a browser with `localStorage.skipgc = 't'`. Build env `SIM_GOATCOUNTER` = a code or a
full count URL (default `simeden`; `off` disables). The world pages' only CSP is `frame-ancestors 'none'`; a fetch
directive added there must allow `https://simeden.goatcounter.com`.

Imported `mars/AGENTS.md` carries original-checkout history; its prohibitions
on authorized Eden fork work are superseded by Gene's kickoff, while engine
determinism, geometric and evidence safeguards remain useful.

Parallel helpers: bounded Opus tasks in successor worktrees only. Lead owns
import, server, persistence/day/steering and deployment. Before adding helpers,
check subscription quota. Do not import computer workshop/library reading
candidates; wait for the read-only boundary's final publication receipt and
import both activities plus six shared wiring files as one unit.

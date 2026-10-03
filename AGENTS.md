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

Before releases: `pnpm check` (Sim + Mars engine), focused browser smoke;
full Mars release gate once at tranche end. Staging precedes production.
Keep rollback receipts under `/srv/sim/ops/<build>`, and update STATUS,
runbook and `<eden4>/MERGE-LOG.md`. Do not replay passing checks without
a source change or unresolved finding that warrants it.

Imported `mars/AGENTS.md` carries original-checkout history; its prohibitions
on authorized Eden fork work are superseded by Gene's kickoff, while engine
determinism, geometric and evidence safeguards remain useful.

Parallel helpers: bounded Opus tasks in successor worktrees only. Lead owns
import, server, persistence/day/steering and deployment. Before adding helpers,
check subscription quota. Do not import computer workshop/library reading
candidates; wait for the read-only boundary's final publication receipt and
import both activities plus six shared wiring files as one unit.

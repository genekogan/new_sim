# Documentation map

Reviewed against the delivered merge code and receipts on **2026-10-03**.
Releases, the release gate and walkability (V3-walk): [../AGENTS.md](../AGENTS.md); conformance pins:
[packages/conformance/conformance/README.md](../packages/conformance/conformance/README.md). Live version: `https://sim.eden.art/worlds/__sim/healthz`.
Sim runs four persistent worlds; the Mars engine is vendored under `mars/`.
The canonical checkout is `<repo>`. Original `<old-sim-repo>`, `~/Mars` and
`~/Dev/littlemartians` are read-only references for this tranche.

## Read by task

| Task | Start here |
|---|---|
| Understand what is live and what remains | [STATUS](STATUS.md) → [qualification](MERGE-QUALIFICATION-20261003.md) |
| Change the shell or engine adapter | [architecture](sim/ARCHITECTURE.md) → [development](sim/DEVELOPMENT.md) → [contract](sim/ENGINE-CONTRACT.md) |
| Operate, release or roll back | [runbook](sim/RUNBOOK.md) |
| Steer a Soul or integrate an agent | [API](sim/API.md), [protocol](sim/PROTOCOL.md), the selected world's `/skill.md` and `/cards.md` |
| Know what Souls can do by hand (lamps, doors, water, carrying, boards, music, play, tea) | [Soul Actions](SOUL-ACTIONS.md); changes in [CHANGELOG](../CHANGELOG.md) |
| Work on choices, private rules or spend | [brain](sim/BRAIN.md), [data](sim/DATA.md) |
| Resume the authorized merge | [kickoff](eden4/23-MERGE-KICKOFF-PROMPT.md) → [plan v3](eden4/22-MERGE-PLAN.md) → STATUS; local running log `<eden4>/MERGE-LOG.md` |
| Understand design intent | [strategy index](eden4/README.md), [worlds/bodies](eden4/20-WORLDS-BODIES-AND-LIBRARIES.md), [decision ledger](eden4/06-DECISIONS-AND-OPEN-QUESTIONS.md) |
| Discuss later designs | [frontier](frontier/README.md), [cloud discussion onboarding](ONBOARDING-CLOUD.md) |
| Read inherited native engine documentation | [Mars index](mars/README.md), then the actual fork source under `mars/` |
| Interpret older status claims | [historical milestone notes](MERGE-MILESTONES-20261003.md) and the currency notes in each strategy document |
| Look up terms | [glossary](GLOSSARY.md) |
| Review this docs sprint and its limits | [review record](DOCS-REVIEW-20261003.md) |

## Authority and currency

For behavior, code wins; `docs/sim/` describes that code. For deployment identity,
query the selected world's `/healthz` and use the release receipts in
`/srv/sim/ops/<build>/` plus the local running log. STATUS summarizes delivered
scope and open checkpoints without treating an old build number as current.

For Gene's decisions, use `eden4/06` and the explicitly adopted kickoff/plan.
Only Gene moves an item to Decided. Other documents can contain proposals,
interviews or historical instructions; their presence is not new authorization.
Broader economy, terrain and ontology proposals remain distinct from delivered
construction, physical rooms and independent world processes.

`docs/eden4/` is a selected strategy mirror from `<eden4>`; its local source
log is deliberately not copied. Its README's source-log links point to STATUS
in this mirror. Research `_handoff` files, databases and raw proof stay local.
`docs/mars/` contains dated inherited reference material, indexed separately from
current fork behavior. SNAPSHOT records provenance; a refresh date does not mean
that every historical claim has become a present-day fact.

## Refreshing the mirrors

Run `infra/sync-docs.sh` from this checkout, review the diff, scan for secrets and
commit. It selects README and numbered strategy files, published top-level research
reports/tours and the historical report. It excludes MERGE-LOG, raw proof, audit
scripts/databases and media. Native docs refresh from the in-repo `mars/` fork;
local Mars original paths are read-only and are not a runtime dependency.
Sim-authored reference introductions and the research index are maintained here
and are not overwritten. The retained exact integration boundary keeps its original
source-relative links; use the native index for their source context.

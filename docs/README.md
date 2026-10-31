# Sim documentation

The code is the authority. When a doc and the code disagree, the code wins: fix the doc in the same change.

## Read by task

| I want to… | Read |
|---|---|
| run Sim locally | [development](development.md) |
| understand how it fits together | [architecture](architecture.md), then the [glossary](glossary.md) |
| change the server API or protocol | [API](architecture/api.md), [protocol](architecture/protocol.md), [contracts](architecture/contracts.md) |
| work on Souls or the Soul client | [Souls at the edge](architecture/souls.md) |
| work on god mode | [god mode](architecture/godmode.md), [safety](architecture/safety.md) |
| work on worlds or the launcher | [worlds](architecture/worlds.md), [data](architecture/data.md) |
| touch an engine | [engine contract](architecture/engine-contract.md), the [Mars engine docs](mars/README.md) |
| touch model calls or the budget | [brain](architecture/brain.md) |
| know which tests to run | [testing](testing.md) |
| run a playtest or direct a cast | [playtests](testing/playtests.md), [swarm director](testing/swarm-director.md) |
| ship a release | [release](release.md) |
| operate the production host | [operations](operations.md) |
| take an issue to a merged PR as an agent | [agent lifecycle](process/agent-lifecycle.md) |

## Contents

- [architecture.md](architecture.md): system overview
  - [architecture/](architecture/): [api](architecture/api.md), [protocol](architecture/protocol.md),
    [engine contract](architecture/engine-contract.md), [brain](architecture/brain.md), [data](architecture/data.md),
    [worlds](architecture/worlds.md), [souls](architecture/souls.md), [god mode](architecture/godmode.md),
    [contracts](architecture/contracts.md), [safety](architecture/safety.md)
- [glossary.md](glossary.md)
- [development.md](development.md): setup, environment variables, local worlds, media
- [testing.md](testing.md): unit tests, gates, e2e, playtests, proof tiers
  - [testing/](testing/): [e2e](testing/e2e.md), [remote gate](testing/remote-gate.md),
    [playtests](testing/playtests.md), [cloud playtests](testing/playtests-cloud.md),
    [swarm director](testing/swarm-director.md)
- [release.md](release.md): the release workflow, `ship.sh`, rollback
- [operations.md](operations.md): services, health, backups
  - [operations/](operations/): [runbook](operations/runbook.md), [disaster recovery](operations/disaster-recovery.md),
    [CDN](operations/cdn.md), [auth](operations/auth.md), [analytics](operations/analytics.md)
- [process/](process/): how work gets done
  - [agent lifecycle](process/agent-lifecycle.md), [review](process/review.md),
    [playtest method](process/playtest-method.md), [Modal policy](process/modal-policy.md),
    [lessons](process/lessons.md), [PROOF-POLICY.yml](process/PROOF-POLICY.yml)
- [design/vision.md](design/vision.md): where Sim is heading
- [mars/](mars/README.md): the vendored deterministic engine

Docs that belong to one folder stay next to its code as that folder's `README.md` (for example
`tools/core/multiworld/`, `tools/cdn/`, `packages/conformance/conformance/`, `vendor/sim-score/`). Files the server
serves to agents (`tools/edge-skill/SKILL.md`, `tools/god-skill/SKILL.md`, `tools/world-skill/SKILL.md`, the
playtest personas and rubric) are product content, not documentation: change them like code.

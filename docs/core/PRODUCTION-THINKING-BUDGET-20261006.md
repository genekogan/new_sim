# Explicit normal-server thinking ceiling

Source preparation for T101; no live settings or deployment performed.
The default remains target0.50 and hard1 for every world. A larger normal-server
ceiling requires operator configuration WORLD_THINKING_CEILING_USD_PER_DAY=3,
WORLD_KEY=eden, ENGINE=mars, ENABLE_EDEN_CORE=1, ENABLE_EDEN_LIFE=1, an explicit
WORLD_ID, and EDEN_THINKING_AUTHORIZED_WORLD_ID exactly matching that ID.
BRAIN_BUDGET_USD_PER_DAY selects the target within the authorized ceiling; an
omitted target still selects0.50. This is a source-configured operator pin, not a
browser, Soul-agent or model authorization. PM reviews the exact release setting
against Gene's approved world before any real change. The localhost-only override
is not called by this normal path and still refuses an HTTPS configuration.

The pure config parser rejects malformed ceilings and missing/mismatched world
pins. Brain separately validates the actual host/DB/world binding for ceiling3,
initializes its governor within that ceiling and passes the same ceiling to the
existing durable reservation gate. An injected high ordinary target is clamped1.
The existing authenticated admin budget action uses that same Brain setter,
records both requested and effective amounts, and reports budgetCeiling. Private
spend reports add ceilingPerDay. Auth, owner/invite/token rules and other admin
actions remain unchanged. Lowering a target is allowed; a client cannot raise
the operator ceiling. Restart continues to use normal configured target semantics.

Three focused source cases pass: defaults and malformed/world-pin negatives;
authorization with an HTTPS configured URL, actual in-process Hono admin/user
checks, aligned setter/governor/Db reservation and an effective budget event;
and an injected ordinary/cross-host mismatch negative. After synthetic charged1.2
plus uncertain1.8 fills the allowance, another reservation refuses without changing
those rows. An actual human-owned native rest programme completes while40 ordinary
native ticks continue. Existing local reservation/over-bound/uncertain-hold
regressions3 also pass. Type checking passes.

The first body-continuation fixture expected terminal state at20ticks, before
native lowering/one-second rest finished; it failed. The corrected ordinary
40tick bound passes without forcing or cancelling the actor. An early test used
ES2023 findLast under ES2022 types and was corrected to filter/at without changing
the project target. Failures remain in the source qualification record.

These are fake/in-memory synthetic cost-ledger checks. No provider API call,
real bill, historical paid row/hold refund, real SSO, socket TLS session or live
world setting was involved. The component proves the normal source path accepts
an HTTPS configuration; it does not qualify real HTTPS deployment. The existing
one-world-per-process/database layout remains in use; no fleet-price promise.
A complete selected dependency/client release, PM/App policy review and Gene's
merge-closure handover remain required. Default and current Root inputs remain
unchanged until a separately qualified handoff is accepted.

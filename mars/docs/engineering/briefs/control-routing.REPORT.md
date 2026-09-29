# W62 — unified transport routing (LM-014)

Branch `codex/control-routing`, base `28683cb`. Lead approved a transport registry with explicit engine/viewer targets; LM-202 world/editor unification remains out-of-scope.

- New `simulation/control.ts` composes the engine registry with 20 live viewer tools, exposes exact schemas/read-only metadata/domain, and dispatches every MCP invocation and REST viewer mutation through the same function.
- MCP registrations now use the schema listing adapter for legacy tools too. Malformed legacy arguments reach dispatcher validation and answer `legacy.command-failed`, matching backend and query failures instead of a plain SDK error.
- Engine invocations still reach the engine controller (which owns their validation and error envelopes); viewer mutations still reach existing Durable Object apply/idempotency logic. REST preserves its viewer-mutation-only contract, UUIDs, and success snapshot shape. REST failures retain `error` for existing clients plus the shared named legacy envelope. Capability/auth checks remain before dispatch. Read-only REST state/take fetches retain existing endpoints.
- `simulation/engine-tools.ts` now contains only the shared schema listing adapter; removed unused duplicate engine registration code. `legacy.ts` documents the two state domains accurately. `commands.ts` uses an explicit .ts import for strip-types unit coverage.
- Worker capability metadata moved into a context closure with all historical landmark values unchanged.
- At lead request, both existing HTTP413 body-limit paths now include `code: room.request-too-large`. The 32768-byte cap stays unchanged.

Validation: four focused `deploy/control-routing.test.mjs` tests pass (complete registry, schema exposure, exact domain dispatch/UUIDs, REST-scope refusal, malformed/backend envelopes, engine result preservation and mock MCP registration). Focused oxlint and `npx tsc --noEmit -p .` clean. `npm test`: 81 pass / 0 fail / 0 skip / 0 TODO (base predates other W62 tooling commits). No engine/full browser suites run: lead requested serialized integrated validation due host contention. Actual worker/MCP auth+all-tools integration is lead acceptance; no live deployment by this worker.

No engine semantics, pins, content values, viewer behavior or dependencies changed. No captures required for transport-only changes. The capability is **one transport registry/dispatch path**, not one unified live/engine world; the latter remains the existing explicit out-of-scope ruling.

Approximate effort 15 minutes / 7k tokens.

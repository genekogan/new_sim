# Steering policy retained-reader boundary

Normal source startup previously called execution-policy installation whenever
registered steering was opted in, including EDEN_CORE_RETAIN_READER=1. That
could append the policy to a history lacking it, despite the reader-only recipe.
The steering bootstrap now separates keep from install: retained mode requires
intentExecutionRetentionV1 already recorded and otherwise refuses. It does not
append or synthesize that fact. Ordinary explicit paired steering startup records
it idempotently. Defaults/old histories/owner authority remain unchanged.

Two causal component checks pass: missing retained policy refuses with identical
old facts/engine hash; ordinary installation records it once, and retained plus
ordinary repeated calls preserve the exact prefix. Actual normal main /2 process
restarts with EDEN_CORE_RETAIN_READER=1 against its original DB; owner/body/private
receipt, native rest program and old event prefix remain, orderly exit0. The
operational flag/life negatives also pass. Source/main types pass. Fake0 provider
calls, only own4957/temp DB processes, cleaned. No real SSO/Root settings changed.

The combined ec7 frozen packet is retained as preceding evidence, not silently
modified. A new exact keeper-aware projection and paired review follow. This
corrects the steering installer boundary; it is not a claim of a universally
read-only database, arbitrary old-client rollback, archive/crash/real-account or
whole-alpha proof. Current live and old published/fixture coordinates remain.

# Candidate private HTTP reads use current authority

October4 Eastern, after87f6dc8; internal G005 candidate only. Installer/capability,
main/bootstrap and consumers remain unactivated. Auth/skill/UI are unchanged.

## Reproduction and correction

Actual local Auth, Hono, SQLite, native engine and fake Brain: hold the real
userFromToken result after authentication, change the current admin role in
SQLite, then release that result to the route. Dashboard and originating prompt
both returned200 under the cached admin role: initial0/2. Synthetic prompt text;
no live service, real JWT, provider or human content.

The candidate now rereads the authenticated identity immediately before private
read serialization. Soul reads require current invitation/owner or admin and
fresh admission/body correspondence. Me still works for an uninvited signed-in
user, truthfully returning current role/invitation and no usable Souls or private
operation history. Missing current users receive401. Brain/prompt reads require
current invitation; owners receive only usable selected-world identities. Brain
SQL optionally restricts selected world; prompt SQL optionally intersects the
originating-call authorization with current ready identities. Current admins
retain selected-world model-call/prompt history, including global calls under the
existing originating-reference policy. Optional query fields leave legacy calls
unchanged. No events, operation evidence, private history or bodies are rewritten.

First correction1/2: the downgraded original dev admin also had no invitation,
so403 was the correct current-invitation denial rather than the test's expected
prompt404. Strengthened role-only fixtures use an actually invited operator then
a local DB admin role; downgrade preserves that invitation. This isolates role
loss from separate invitation tests. Revised expansion27/27, final combined64/64.

## Actual evidence

`node --test apps/server/src/lifecycle-private-authority.test.ts
apps/server/src/prompt-authority.test.ts
apps/server/src/lifecycle-write-fences.test.ts
apps/server/src/lifecycle-http.test.ts` — **64PASS**:

- New28 checks: nine private routes across held-auth role and invitation loss;
  deleted issuers; current owner/admin positive reads; own retired/missing-body/
  wrong-world prompt and call exclusions; foreign-world calls; pending reservation
  supplies receipts without a private playable identity.
- Existing prompt8 rerun because the SQL/private prompt path changed: default
  ownership/admin/global/foreign/pruned/lookalike/malformed/upgrade behavior.
- Existing write-fences18 and HTTP10 rerun because shared ownSoul changed: actual
  sequenced writes, compiler/results, token/wait guards, allocation/terminal and
  actual TCP lost-response recovery remain valid. The HTTP legacy case waits the
  real two seconds. Other unchanged WS/MCP/shot/pair/native suites are retained.

New fixtures close28 in-memory DBs, do not listen or spawn workers, and assert
zero paid cost. Existing changed-path regressions close their own DBs/TCP4956
and temporary SQLite directory. Server tsc, diff check, credential-pattern scan
and normal commit hooks are required separately; no bypass.

## Limits

The auth barrier holds a real local dev-auth result; it does not qualify Privy
verification/profile caching, JWT/config changes or identity-provider delivery.
No universal admin/account/invite/pair-info route audit, multipart/body scheduler,
last socket byte atomicity, buffered response recall, multi-process interleaving,
all malformed DB/native faults, high-load capacity or real-owner proof. Admin
history access is not ordinary Soul control. Public WS/take resources are separate
retained proofs; no canonical geometry/replay/body removal behavior changed here.
Known unsafe defaults remain unchanged, and version transition/rollback/fullG/
capability/cohort/release still require qualification.

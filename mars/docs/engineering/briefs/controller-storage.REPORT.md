# W60 controller storage / workload admission

2026-09-29. Branch `codex/controller-storage`; base `28683cb0d25ac04967f4790df668a28681657614` (rebase onto main was already up to date). Scope: LM-018 and the named-refusal path of LM-019. No historical content, pins, engine/controller mechanics or shared release docs changed.

## Changes

- `viewer/simulation/storage-bytes.ts`: true UTF-8 accounting; 512 KiB chunks never split a surrogate pair; default per-blob cap 8 MiB and aggregate room/year cap 64 MiB.
- `viewer/simulation/engine-room.ts`: SQLite byte accounting uses `LENGTH(CAST(data AS BLOB))` throughout, including ledger and metadata. Blob/aggregate overruns return `room.storage-bytes`, roll back all writes, clear success-write metadata and discard ahead-of-storage controller state. Includes old-history migration and seed refusal. Read-only calls can inspect an already-over-cap persisted room. Existing count-based eviction is retained; referenced history is never deleted to satisfy a byte cap.
- `viewer/simulation/workload.ts`: DO host admission before bind/rehearse/execute/resume: at most **96 steps / 128 entities** in each relevant world. Resume counts appended commands, and old stored plans also pass admission. Uses the existing input bounds before schema parsing. Over-limit returns `room.workload-limit` with counts and named workspace/checkpoint subjects, before simulation or persistence. The 96-step limit accommodates the 66-step flagship v2. Existing tick budgets remain unchanged.
- `viewer/engine/test/room-storage.test.ts`: Unicode split/storage byte proof, oversized take transactional rollback, aggregate/migration byte refusal, actual 2022 east-house first-bay chapter refusal, invalid and boundary admission tests.
- `viewer/simulation/README.md`: operational contracts, explicit conservative admission limits, remaining CPU limitation, official Cloudflare limit reference.

## Evidence and limits

The real current `yearBuildSetup(2022, 'east-house', ..., {bays: 1})` produces **185 steps / 16 entities**. It is refused on bind, and on both rehearsal and execution of an already-stored plan in migrated SQLite history; all three leave persistent rows unchanged. This is a named refusal for a genuine chapter, not a size-only post-computation cap. A normal one-minute rehearsal remains admitted. The lead owns a real MCP/workerd integration proof before marking LM-019 PROVEN.

The workload counts are conservative **product admission limits, not a mathematical or measured promise that all smaller inputs consume less than 30 seconds CPU**. No Cloudflare CPU limit was raised. Broader campus chapter support requires a measured workerd acceptance case or segmented execution. Cloudflare's current docs were checked: default 30-second invocation CPU allowance and 2 MB SQLite row/value limit (<https://developers.cloudflare.com/durable-objects/platform/limits/>).

The byte test puts a supplementary-plane emoji across the old UTF-16 row boundary and follows it with over 512 Ki characters of three-byte text. SQLite round-trips it exactly and every row stays at or below 512 KiB. The oversized real take test injects a 20,000-byte cap (production default 8 MiB), verifies a named take-key refusal, byte-for-byte identical persistent rows, unchanged workspace head, and empty `_meta.stored`.

No render changes or visual captures. Reviewed the targeted test output and the SQLite assertions. No UI acceptance is claimed.

## Validation

- `node --test engine/test/room-storage.test.ts`: **5 pass, 0 fail, 0 skip/todo** (after the final 96-step limit).
- `npx tsc --noEmit -p .`: **PASS**.
- `npx oxlint simulation/engine-room.ts simulation/storage-bytes.ts simulation/workload.ts engine/test/room-storage.test.ts`: exit **0**.
- `git diff --check`: **PASS**.
- `npm run test:engine`: **420 pass / 1 fail / 6 skip / 11 todo**, 438 total, 151.8 seconds. The only non-TODO failure is `stress-30: exact planner keeps the pinned result; per-tick cost bounded; zero violations` (`planning.test.ts:191`): **exact max tick 323.0 ms** exceeded its wall-time threshold under concurrent full-suite load. The lead independently saw the same timing failure and asked workers to stop parallel runtime loads. Historical W51 TODOs and six skips remain unchanged. No pin was edited; semantic pin assertions passed.
- Lead then assigned an exclusive rerun slot. Final `npm run test:engine`: **421 pass / 0 fail / 6 skip / 11 todo**, 438 total, **59.25 seconds**. All pinned tests pass unchanged; existing historical TODOs remain documented above. Log: `/tmp/controller-storage-engine-serial.log`. No runtime test remains running.

Approximate worker effort: 12k reasoning/output tokens, 25–35 minutes wall time including engine test waits; no helpers spawned. Lead must tally actual aggregate work in PROGRESS.md.

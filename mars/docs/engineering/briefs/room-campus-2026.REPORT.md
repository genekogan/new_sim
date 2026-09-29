# W63 — LM-006: reconstructed 2026 in engine rooms

Branch `codex/room-campus-2026`, based on W60 storage commit `0be64680003cb1f4ee79c7335ff9bce29930627b`; pending rebase/integration onto the lead's first merged milestone. No changes to historical content JSON, geometry, canonical world values or pins.

## Changes and contract

`engine/api/seeds.ts` accepts either the historical `CampusYearFile` or reconstructed `CampusSceneFile`. A supplied 2026 file publishes protected `mars-2026` via the existing `loadCampus2026(..., {flagshipInventory:false})`, preserving exactly the existing canonical world and scene hashes. It retains the six existing generic context people and adds no hypothetical stock or flagship fork. `publishCampus2026` was deliberately not called because it also creates a flagship workspace and inventory. Existing synthetic seeds remain unchanged, as does a controller/room whose test loader is omitted.

`simulation/campus-years.ts` bundles the existing `public/engine/campus-2026.json` alongside the historical years; the Worker's existing callback wiring requires no `worker.ts` edit. The added raw JSON source is 982,684 bytes; the release build will measure the bundled/compressed Worker. `simulation/engine-room.ts` widens loader typing and keeps the existing transactional add-on-first-load migration pattern. Existing room workspaces/heads survive; subsequent restarts do not rewrite the history.

An old editable workspace already named `mars-2026` cannot safely become the protected reconstruction. `ensureCampusYear` refuses with `room.campus-conflict` when an existing id is unprotected or belongs to a different campus. All persistent rows remain intact. **This conflict prevents that room's engine from loading until an operator resolves the conflicting id; using a new room works, but automatic rename/recovery/export is not implemented.** The lead approved this conservative preservation policy. No user work is overwritten.

Tests cover query protection, editable fork and region edit, unchanged canonical head, hash-equivalent existing world/scene, restart idempotence, prior workspace preservation, all six historical years remaining isolated, malformed file/year rejection and legacy-id conflict rollback. The old API test's synthetic-only-2026 expectation was updated narrowly to include `mars-2026` when a file loader is supplied.

## Verification

- `node --test viewer/engine/test/room-campus-2026.test.ts`: **4 pass / 0 fail / 0 skip/todo**, 0.54 seconds.
- `npx tsc --noEmit -p .` from viewer: **PASS**.
- `git diff --check`: **PASS**.
- Captured API output reviewed in `/tmp/room-campus-2026-focused.log`: `{"campus":"mars-2026","protected":true,"entityCount":6,"forkProtected":false,"canonicalUnchanged":true}`. No visual behavior changed; no screenshot claim.
- Full engine/gate deferred to the lead's serialized combined validation. Lead explicitly authorized committing focused-tested work while the combined suite runs, avoiding concurrent timing-test interference. Do not mark LM-006 PROVEN until the real MCP room query and full gate pass.

Approximate worker effort: 5k tokens / 10–15 minutes; no helpers. No runtime suites left running at handoff.

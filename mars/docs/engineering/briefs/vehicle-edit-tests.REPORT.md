# LM-005 — checked vehicle placement and explicit invariant fault injection

Branch `codex/vehicle-edit-tests`, based on W63 `4a88bdde6882010895242995c539540a3d163f69`. Changes are limited to `viewer/engine/api/edit.ts`, `viewer/engine/test/forklift.test.ts` and this report. No trajectory/pin/content changes.

Inspection found the remaining raw traffic edits only in the forced-overlap invariant test. Those corrupt the world intentionally to prove the runtime catches a collision. Converting them into successful public edits would weaken the invariant test or permit an unsafe operation. The lead approved retaining clearly labeled fault injection after a checked public-API refusal.

The new regression exposed a real issue: `edit_world` previously **succeeded** in moving a parked EUC into plywood carried on forklift forks. Such loads are omitted from the static navigation grid. `placementIssue` now checks held/fork-supported load OBBs and their vertical intervals when placing a nonhuman entity. An intersection returns `edit.blocked`, naming the moved vehicle, load and forklift. A load raised above the EUC remains clear. Existing static geometry checks run first and are unchanged.

The traffic test now parks the riderless EUC legitimately through controller `edit_world`, then attempts the unsafe overlap through the same API and proves the refusal leaves the complete world hash and checkpoint head unchanged. Only afterward does a separately labeled corruption fixture bypass validation to test `collision.vehicle-vehicle`. The old false comment “edit_world itself refuses to move vehicles” was removed. The evidence test title prefix is preserved so current evidence-map lookup continues to resolve.

## Verification

- First targeted run reproduced the bug: the overlap returned `ok:true`, creating a checkpoint. This assertion now passes with `edit.blocked` and subjects `["e1","ply1","f1"]`.
- `node --test --test-name-pattern='traffic|edit_world' engine/test/forklift.test.ts engine/test/api.test.ts`: **9 pass / 0 fail / 0 skip/todo**, 2.51 seconds. Covers ordinary traffic, determinism, checked parked/ridden vehicle edits, collision fault injection, held-load overlap and raised-load clearance.
- `npx tsc --noEmit -p .`: **PASS**.
- `git diff --check`: **PASS**.
- No full engine suite launched: lead explicitly requested focused validation and owns the combined full gate before merge. No pins changed. No runtime suites remain running.
- API/test output reviewed in `/tmp/vehicle-edit-focused.log`; no renderer/UI changes or screenshot claims.

Lead follow-up: remove obsolete `edit_world cannot move vehicles` wording from the vehicle-traffic capability approximation in `engine/test/evidence-map.json` (near line 652), and adjust LAST_MILE acceptance to retain deliberate invalid-state injection as approved. That evidence file remains in the lead's lane.

Approximate effort: 4k tokens / 8–12 minutes; no helpers.

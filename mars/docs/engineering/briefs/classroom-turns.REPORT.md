# Classroom group turns checkpoint

Source `a4078c6`; branch `codex/classroom-turns`, raise-cancel checkout. Studio integration/release candidate untouched. Registry rules version bump remains the lead's integration responsibility.

## Behavior

A tiny reusable deterministic `TurnState` utility accepts eligible member IDs, a physically-talking flag, and fixed dt. It has no world or pose access. The bounded classroom assigns group-specific 3 / 3.45 / 3.9 / 4.35 second periods, with stable initial speaker offsets. The clock remains zero while gathering and starts only after the active converse child reports `talking`. A floor is eligible only while at least two participants still belong to that physically executing child. Existing converse actions own all gathering, positions, orientations, membership release, and cleanup.

Classroom readout exposes groups `{action,members,status,floorHolder?,attentionTarget?}`. Group status is gathering/talking/ended. Speaker changes and floor clearing create `classroom.group-floor` marks. Excluded/departing members immediately disappear from eligibility/readout; existing child reform and independent departure logic continues unchanged. Cancel/end clears the floor and attention immediately while parent cleanup retains its existing ownership rules.

Lab HUD lists each group's membership/status/floor. Renderer head attention uses each group's speaker coordinates through the existing bounded head-target service. No actor pose, physical yaw, or activity writes are added; no new dialogue, gesture, LLM, or general conversation system.

## Verification

- TypeScript and focused oxlint pass.
- 37 focused classroom tests pass: coordinator, joining, real maps, plus 7 new turn tests. New checks cover utility groups of 2/4 members; real 4/8 guest maps; clock admission; valid floor membership; departure/cancel without ghost speakers; deterministic repeated marks; and unchanged authoritative actor poses during actual turn transitions.
- Camera-independent browser journey passes on isolated port 5495, run `classroom-turns-2026-09-30-group`: two physically formed groups, different turn states, same authoritative positions/yaws, renderer head attention, floor-holder departure, cancellation, no failed records, no invariant violations, and no claimed interaction slots after cleanup. Server teardown completed.

Inspected both final runtime captures:

- `<mars-worktrees>/raise-cancel/viewer/e2e/artifacts/classroom-turns-2026-09-30-group/conversation-turn-one.png`
- `<mars-worktrees>/raise-cancel/viewer/e2e/artifacts/classroom-turns-2026-09-30-group/conversation-turn-two.png`

They show all three members of the audience group clearly inside the room; HUD floor changes guest2 to guest4, and a member's head direction changes while body positions remain unchanged. JSON proof is adjacent as `conversation-turns-proof.json`. Initial overview framing missed the groups at the image edges; corrected close framing changed only the capture camera. Initial test assumptions were corrected to fixed-tick loops, audience departure (host departure intentionally ends the existing session), and sufficient conversation duration for staggered group arrivals.

## Limits

Turn state conveys floor/attention, not generated speech or hand gestures. Existing head rotation remains bounded and visually approximate. Periods vary deterministically by bounded group index; no psychology or unscripted dialogue is inferred. Active classroom snapshots still explicitly refuse resume under the existing contract. No full gate, deployment, shared roadmap, camera policy, registry, or golden changes.

## Question readout correction

The public session floor now reports the audience questioner during question phase; additive `presenter` retains the current presenter identity for camera/readout consumers. Returning to presenting restores the public floor to that presenter. Internal presenter rotation, display service focus/resource behavior, and actor poses remain unchanged. Existing two-arrangement question regressions assert question floor, retained presenter, and restored floor. Focused classroom tests/typecheck/oxlint pass for this correction.

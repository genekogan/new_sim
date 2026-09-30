# Autonomous cinematography workstream

Gene scope, 2026-09-29 America/New_York. Branch codex/autonomous-camera;
worktree <mars-worktrees>/autonomous-camera, initial base 2d83e92; now rebased onto a4078c6
with the integration owner’s d98d9e5 camera hooks cherry-picked for development. Local Git only.

## Ownership and coordination

Engine chat: Continue 3D Studio engine work,01a0ea92-d0f1-74e0-a0e1-d764b8a2bf63.
Explicit user authorization permits messages both ways. Engine owner confirmed
new viewer/cinematography/**, viewer/app/camera-lab/**,
viewer/e2e/autonomous-camera.spec.ts, this brief and its REPORT.
Existing engine/camera/** and app/lab/** remain theirs pending narrow agreement.
Engine owner integrates/gates/releases. Historical main dirt preserved.
Reserved ports5593(dev),5591(e2e),7393(optional server); checked free.
Global max3 helpers; engine uses1, camera may use2; currently camera uses0.

Pending older camera correction/cache branches remain isolated; reuse released
geometry, candidates, shots, readability and tracks without modifying them.
No universal renderer rewrite, simulation changes, new activity model or pin edits.

## Architecture / milestone

Versioned read-only causal observation → semantic intentions → director provider
(local baseline or optional Jev) → validated physical execution → presentation.
New adapter uses classroom(), state() and scene geometry; authoritative Runtime
never receives camera decisions. Existing EUC follow remains available.
Coverage vocab: group establishing, speaker medium, speaker/display, questioner,
two-person conversation, individual/group follow, safe context. Clear coverage
prefers current focus; restrained observation holds contextual/two-person shots
longer. Minimum holds/recent coverage/consistent room side prevent chatter.
Operator precedence: valid manual pose > pinned shot/subject/style > auto;
safety veto applies everywhere. Overrides have explicit expiry/release and epoch.
Expired/released control returns through a validated handoff; no API can win over it.
Invalid geometry refuses named diagnostics. Disconnected viewpoints require cuts.

First milestone: runtime baseline MP4 early; autonomous classroom with question,
presenter change, departure, operator takeover/return, and clearly labeled
camera-owned occlusion fixture. Same recorded observations filmed under both
policies, plus separate live intervention. Log all cuts/recovery and limitations.
30–90s MP4s in ignored e2e/artifacts/codex-autonomous-camera-* with commands,
commit/provenance, decision JSON; inspect footage including transitions.

## TypeSafe experiment

Read typesafe AGENTS/research read-only and installed typesafe-ai skill
~/.claude/plugins/cache/typesafe-ai/typesafe/0.5.7/skills/typesafe-ai/SKILL.md.
Live official api/models/choice/function-calling docs verified2026-09-29:
jev-1.13.0, POST /v1/systemone, Choice answers + usage.input_tokens;
$0.042/M input, output free. Pin model/config; log response model.
https://docs.typesafe.ai/models ; https://docs.typesafe.ai/api .
Provider chooses feasible candidate IDs or HOLD, never coordinates.
Event-trigger cap1Hz, single in-flight request, timeout/abort, state version +
operator epoch staleness checks, revalidation at application. Render never waits.
Accepted decisions/application times replay without new calls. Server-side key
loaded only from approved environment; never browser/log/committed.
Initial bounded evaluation max12 calls and $0.01 conservative reservation;
no indefinite paid loop. Sustained ceiling asked of Gene, currently pending.

## Validation and release

Focused camera tests: invalid placement/sweep, occlusion, min hold, override
precedence, stale/invalid/failed/timed-out replies, cleanup, decision replay,
identical world outcomes. Measure camera overhead and API latency/token cost.
Typecheck includes camera modules explicitly until shared tsconfig integration.
Full engine+typecheck before commits; main owner fullgate before integration.
Report implemented / inspected / tested / integrated / released separately.

# Music gathering — reviewed implementation candidate

The browser proof addendum below supersedes the initial pending visual-proof
notes. This remains an unpublished candidate, with integrated release validation
owned by root.

## 2026-10-02 focused handoff

Worktree `<mars-worktrees>/music-dance-world`, branch
`codex/music-dance-world`, exact base `65cc0b8a1433f69d19b1380ebf88dd57b552c970`.
This owner-authorized tranche supersedes the earlier stop marker for this bounded
candidate only. Nothing here is deployed or a universal party framework.

The hypothetical four-person example uses one computer musician, one seated
listener, one initial dancer and a second explicitly joining dancer. Existing
`computer_music`/`work_at` and `sit` retain audio, score progress and supported
seat stopping. New `grounded_dance` walks to a clear ordinary-ground place through
`walk_to`, then publishes alternating reach-bounded semantic hand points to the
score; actor roots, feet, support and rig anatomy are unchanged. Floor attention
rotates among performer/active dancers with existing deterministic turn state.
Independent Join/Leave preserves the performer and other participants. Safe hand
lowering lasts up to 0.4s before release/director takeover; Pause drains owned
children, and explicit Resume preserves score, duration, places and withdrawals.

Owned files:

- `viewer/engine/activities/music-gathering.ts`: three action exports, individual
  control, ordinary child execution, floor-envelope admission, readout/attention.
- `viewer/engine/scenarios/music-gathering.ts`: reusable binding/factory with yaw;
  four hypothetical people and existing fixtures on the existing ground scene.
- `viewer/engine/test/music-gathering.test.ts`: completion, disruptions, refusal,
  cleanup, retained purposes, per-tick hands and determinism.
- `viewer/app/lab/music-gathering-hud.tsx`: existing audio adapter, clear controls,
  per-person state/refusal feedback and explicit scope instructions.
- `viewer/e2e/music-gathering.spec.ts`: actual Play/audio/grounded rhythm, late
  Join/Leave, safe Pause/Resume/completion/Reset and planned captures. **Not run yet.**

## Shared integration contract — root owns these patches

No shared files were edited. Root approved this contract before implementation:

1. Registry imports `MUSIC_GATHERING_ACTIONS` and includes its three verbs once;
   root decides the activity rule bump. The scenario factory extends the same
   registry only while production wiring is absent, without an alternative mover.
2. Scenario index exposes `music-dance`, using `musicGatheringRuntime()` and its
   ground scene with an appropriate continuous Lab tick budget. Bindings are
   `MUSIC_GATHERING_BINDING` / `musicGatheringBinding(yaw)`.
3. `app/lab/panel.tsx` mounts `MusicGatheringHud`, keyed by scenario epoch, alongside
   existing HUDs. Hook may expose `readMusicGathering(rt, action)`; the new browser
   spec uses existing music/audio/bones/humanFields/records hooks.
4. Existing attention aggregation merges `musicGatheringAttention(rt, action)`
   (actor → ground point) for active gathering records into `setAttention`.

Readout is `{ action,status,mode,phase,bindings,floorHolder,music,dancers }`;
dancers contain `{ actor,at,child,invited,withdrawn,state }`. Control parameters are
`{ gathering,actor,command:'join'|'leave' }`. Resume parameters are
`{ ...prior.bindings,resume:true,resumeFrom:prior.action }`; the same stopped
Runtime record must exist. No central world field, catalog or Runtime redesign is
needed. If visual inspection requires torso rhythm, root may add only a small
read-only current-rig expression; no feet/root movement, rig or camera redesign.
Arm-only naturalness remains **unverified until actual Play capture inspection**.

## Exact focused validation

From this worktree's `viewer/`:

- `node --test engine/test/music-gathering.test.ts engine/test/source-scan.test.ts`
  — **31 passed, 0 failed, 0 skipped, 0 TODO, 806.124ms** (30 gathering cases plus
  the source scan). Both yaw layouts complete; initial/late member admission,
  individually departing dancer/listener, performer/dancer director handoff,
  safe cancellation during approach/awaiting/playing, same-score Resume,
  foreign actor/workstation purpose preservation and pending floor overlap pass.
  Per-tick hand continuity uses the existing 0.15m physical step threshold;
  no tolerances in existing tests changed. Exact duplicate executions hash equally; active logical snapshot restoration refuses explicitly.
- `node_modules/.bin/tsc --noEmit --incremental false -p .` — clean.
- `node_modules/.bin/oxlint engine/activities/music-gathering.ts
  engine/scenarios/music-gathering.ts engine/test/music-gathering.test.ts
  app/lab/music-gathering-hud.tsx e2e/music-gathering.spec.ts` — clean.

Initial new tests exposed an incorrectly oriented authored listener chair,
assertion/helper mistakes and a retained-listener read occurring before resumed
children started. These were corrected in owned fixture/tests; no inherited test,
expected pin or physical threshold was changed. Focused output is in
`/tmp/music-gathering-focused.log`; no full engine gate, build, server, browser or
public/deployment check ran here. Existing pinned suites were not executed, so no
claim that all pins pass is made. Root re-gates the integrated candidate.

## Bounds and remaining proof

Admission requires ordinary ground, empty hands, usable computer/chairs, clear
0.60m planted dance envelopes, distinct places at least 1.20m apart and reachable
ordinary paths. Structured diagnostics name affected actors, claims and floor
places; foreign commitments are never overwritten. There is no travelling
choreography, foot IK, fine finger performance, crowd planning or arbitrary terrain.
Normal global Pause freezes the authoritative clock and audio; activity Pause
safely releases resources while retaining the purpose. Active reload/snapshot
restoration is explicitly unsupported; same-runtime Resume is distinct from it.

Root browser slot/shared wiring is required for actual Play, sound, reach/grounded
appearance, attention and Reset resource captures. The authored e2e writes four
PNGs to its run directory; none has been produced or personally inspected yet.
Stop/escalate if believable medium-distance rhythm needs bespoke anatomy rather
than a small current-rig expression. No new helper, full gate, main merge or deploy
is authorized in this lane. All older worktrees and drafts remain intact.

## 2026-10-02 actual Play proof — passed, browser slot returned

Source implementation commit `6dfda9c905f703e3171b859ed83e94176eee9e03`;
owned browser setup/attention assertion correction
`f8a97ef0800ebb2951ee1bced1a97649630ac380`. Root integrated canonical registry,
scenario/HUD and renderer attention into frozen runtime/shared source
`5608442fa512bd3957ad1196f94817c4361910ec`.
Detached capture worktree `<mars-worktrees>/music-play-proof` tested
capture HEAD `6e9a0520eb094dc608b4f77499641796c51461ce`: frozen runtime/shared
source plus only the owned spec fix (12 lines). Copied/frozen browser assets:
`campus.glb` SHA256 `675f4bebed89d73fb579493e708476f0dfd4c44c0106958a1aad1a92c932a8c4`;
`campus.glb.br` SHA256 `36ad67f72f9b1f1678a5293c735b5667cfb8053c3a1f8b6981d6340af436f304`.
All original worktrees remain preserved.

Exact command in capture `viewer/`:

```sh
E2E_VITE_PORT=62028 E2E_RUN=codex-music-play-proof-2 PLAYWRIGHT_JSON_OUTPUT_NAME=<mars-worktrees>/music-play-proof/viewer/.cloudflare/music-play-proof-2.json node_modules/.bin/playwright test -c e2e/playwright.config.ts e2e/music-gathering.spec.ts --reporter=list,json
```

**1 passed, 0 failed, 0 skipped, 0 flaky, 51.956s**; actual test 50.4s.
Actual Play produces audio RMS >0.005; global Pause silences it below 0.001.
Authoritative hands change to the score, both current-rig dancers publish rendered
hand targets within the existing 1.02 arm-length reach boundary, and rendered floor
attention has at least two targets including a dancer/performer. Late Join and
individual Leave preserve other commitments; safe activity Pause lowers hands,
stands seated participants and retains the unfinished bright score; Resume
finishes the same score at exactly 36s. Zero invariants, empty seat/hand release,
Reset audio-resource closure and empty records all pass. Director precedence and
rotated reuse remain explicitly Node-focused proof, not new browser claims.

Personally inspected all four captures in
[evidence gallery](<mars-worktrees>/music-play-proof/viewer/e2e/artifacts/codex-music-play-proof-2/index.html):
`music-dance-live-four-person.png`, `music-dance-grounded-pose.png`,
`music-dance-safe-pause.png`, `music-dance-complete.png`. At medium distance,
separated planted dancers visibly alternate bounded arm gestures while the
performer/listener use supported chairs. Release shows lowered hands and standing
participants; completion shows 36/36 retained score. This supports a deliberately
limited upper-body rhythm, without travelling choreography, fine anatomy or a
new torso/foot adapter. Sound was verified through browser audio measurements;
this is not a claim of personally listening to a recording.

[Machine receipt](<mars-worktrees>/music-play-proof/viewer/.cloudflare/music-play-proof-receipt.json)
records exact source/test delta, commands, checks, asset hashes, captures and
limits. First frozen 6af3cd2 attempt failed because the owned spec assumed a paused
URL boot while Lab was already running, so Play was absent. Its log/JSON/a11y/trace
remain preserved in the capture tree. Correction uses the established explicit
`runScenario('music-dance', { paused:true })` initial setup, without weakening any
behavior assertion. Source inspection also identified missing shared renderer
attention aggregation; root added the approved `musicGatheringAttention` merge
before this fresh passing run. No shared file was edited by this helper.

Harness exited; isolated 62028 has no listener, and other sessions 5491/5493 were
preserved. Capture tree is clean. Slot is returned; no passing rerun, full gate,
deployment or further scope is performed here. Root owns subsequent integration
and release proof.

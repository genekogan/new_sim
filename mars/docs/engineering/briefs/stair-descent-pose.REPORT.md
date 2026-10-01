# Stair descent anatomical foot-side repair

2026-10-01: codex/stair-descent-pose in its own worktree, based on checkpoint90b834a. Bounded current-rig renderer correction; no authoritative execution, support, claims, activity definitions, physics, geometry, body-model parameters, history or existing baselines changed. Root owns combined gate/integration/deployment. All prior worktrees and dirty main preserved.

## Source cause and correction

humans.ts stairLegs correctly selects the anatomical left/right foot from g.feet and already reverses axial heel offset/toe-off when facing downhill. Its lateral ankle targets, however, were permanently assigned left→negative/right→positive relative to the flight's ASCENT axis. The actor's world-facing frame reverses downhill, so those targets sent each ankle across the actor. The issue is visual target mapping, not foot identity, activity movement or stair support.

stair-gait.ts now exposes a small pure stairFootTarget mapping that preserves g.feet identity/parity/support height and maps anatomical side into the ascent-axis lateral coordinate using body-facing sign. humans.ts supplies each existing rig leg's side, measured rest stance width, and rendered holder yaw. Only the lateral sign changes downhill. Existing axial offset, cadence, clearance, heel pitch, pelvis adjustment, leg solver, model/rig library and clip blending remain intact; ascent targets are unchanged.

## Permanent animation boundary

Authoritative activities own intent, physical actor movement, support and resource claims. Their spatial stairs links provide usable tread/support geometry. Renderer gait interprets that geometry and maps stable physical left/right identities into the current rig, then applies visual pose/IK over the existing clip. Rig dimensions/stance width, joints, poles and skinning belong to the renderer adapter; activities must not encode this rig's anatomy or foot-bone targets. Readers observe rendered bones; they do not move actors or rewrite support. A future rig adapter can replace visual mapping without introducing a second mover or changing ordinary activity semantics.

The approved boundary improvement is one shared pure target mapping plus the existing humans adapter call. No universal IK/anatomy system, new locomotion planner, authored animation library or activity protocol was introduced. Gait parity is never swapped on descent.

## Focused evidence

Before applying the lateral-facing factor, the new source-equivalent target helper reproduced the original error: Node2/3pass,1fail, `left target crossed at yaw=0, descending=true, u=2`,83.95ms. Retained log: viewer/.cloudflare/stair-descent-pose/negative-before.log. After correction, `node --test deploy/stair-descent-pose.test.mjs`:3/3pass,0skip/fail,66.67ms. The regression sweeps45 gait phases across six world axes, ascent/descent, and yaw wrapping. A retained negative control proves the former ascent-fixed mapping crosses both anatomical sides downhill. Another check preserves exact foot-state object identity, support/cadence data and the original axial heel shift.

Serial browser command on alternate port5491:
`E2E_VITE_PORT=5491 E2E_RUN=stair-descent-pose-2026-10-01 ./node_modules/.bin/playwright test -c e2e/playwright.config.ts e2e/stair-descent-pose.spec.ts e2e/stairs.spec.ts e2e/lab.spec.ts --grep 'anatomical foot sides|stair foot IK|stair gait capture|lab stairs: completes as expected'`

7/7pass in1.1min. New actual UI Play ascent and descent each sampled209 fully weighted gait ticks using the current woman rig; physical left foot's closest right-axis dot was-0.0917m, physical right+0.0800m. Every sample meets left<-0.04/right>0.04, with0invariants and successful scenario checks. Tests click Play, pause the real journey mid-flight for capture, then resume to ordinary completion; no synthetic actor placement or swapped bone ordering.

Existing tread tests: ascent15plants, descent14plants, worst sole→tread error0.0cm,0sinks in both. Existing take replay42frames, worst replay/live sole difference0.0cm,0bad frames. Existing lab-stairs screenshot and ascent mid-flight screenshot baselines pass unchanged. For that baseline run only, root's exact checkpoint-tour.tsx693354d was temporarily copied into this isolated tree to avoid its already-known unrelated sidebar regression, then restored to base; it is not in this commit. No baseline updates/suppression/tolerance changes.

Personally inspected captures under viewer/e2e/artifacts/stair-descent-pose-2026-10-01/:
- stair-descent-anatomical-feet.png: current woman rig on actual stair treads; boots/ankles visibly separate, no crossed-ankle mapping. Mid-journey UI expectations remain red until completion, with zero violations; final checks pass.
- stair-ascent-anatomical-feet.png: ordinary ascending pose, knee raised; foreground stringer hides lower feet in this angle, so foot-side readout is the evidence for ascent side ordering. Existing unchanged ascent captures also pass.

Actual Play foot-side JSON samples are attached by the browser tests to viewer/test-results/. Node/browser heavy slot returned immediately after these proofs. Viewer TSC, cinematography TSC, scoped oxlint on four source/test files and gitdiff--check pass. Initial lint requested explicit void for Node test registration promises; no check was disabled. No build, full gate or deployment run by this worker.

## Limits and bounded post-MVP Eden comparison

This corrects anatomical side ordering for aligned ascending/descending stair travel at arbitrary world yaws. It is not full anatomical validation, toe/heel/skin collision certification, stair sidestepping, turning in place on a tread, or a guarantee for every future skeleton. Current targets still use ascent-axis facing sign and existing rig proportions/clip blending; arbitrary sideways turning deserves a separate bounded visual contract. Current production-rig physical soles/side ordering and ordinary replay are verified here. Other characters remain supported by the same existing adapter, but were not claimed separately captured in this tranche.

For Eden after MVP, compare three bounded options on one short activity and one supplied rig: (1) retain procedural pose over existing clips—lowest integration cost, adapts to actual object/tread geometry, but stylized dynamics; (2) one authored ascent/descent motion with limited retargeting—better intentional weight/timing, asset/rig and stair-pitch constraints; (3) authored motion plus constrained contact IK—best bounded foot/hand placement across modest geometry variation, additional joint/pole/clip calibration and validation cost. Keep authority unchanged in every option. Measure visible plausibility at the featured camera distance, side identity, major clipping/contact, interruptions and reset/replay before selecting. A one-experience prototype should inform that decision; no universal retargeter or unconstrained anatomy redesign is warranted by this lateral-frame defect.

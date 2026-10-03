# Purposeful communal routine — bounded next slice

2026-09-30. Activated after release23 was deployed and production-verified (engine source `cb37603`). The original read-only preparation at `bde7e3f` preceded that milestone; implementation now builds on main `67e2e3e` (docs atop `a57de2a`). Root explicitly authorized the bounded engine coordinator and focused checks; UI, browser, full gate and release remain root-owned.

## Playable intent and committed binding

Start with one directed/mixed routine: **“Join this planned gathering, then finish my interrupted Sketch notes.”** This advances purposeful continuity through existing activities; it is not needs-driven autonomy, sleep or a scheduling framework.

Bind once to worker, the chosen classroom session ID, food companion visitor, the actual spare seat and the existing workstation task identity: station, user, task and total duration. Read current elapsed work from workstation equipment. Do not replace the task, randomly reselect destinations, adopt a later unrelated classroom or invent unfinished progress. Use current capabilities and layout state to determine eligibility and explain waits.

Two top-level obligations:

1. **Participate in the planned gathering.** Require the existing notes already unfinished and the actor standing idle/unowned; join and actually sit; ask one authored question; observe both presenters and formed smaller conversations; wait for classroom departure; complete the existing shared food break; sit quietly for a bounded fixed duration, then physically stand.
2. **Finish the committed notes.** Submit ordinary `work_at` with the original actor/task/duration and `resume:true`, retaining actual elapsed progress until completion.

The first obligation is a bounded composition of already supported verbs, not a new general planner. Quiet rest measures authored dwell ticks, without claiming sleep or recovery. Manual controls can intervene throughout.

## Authoritative execution and cancellation boundary

A small registered coordinator tracks obligation/subphase, committed bindings, completed effects, child action IDs and pause/wait diagnostics. It submits ordinary children with `preempt:false`; children retain all movement, support and resource ownership. Do not reserve the actor for the whole routine or add a second movement controller. Permit only one active intent for the explicit actor through bounded routine admission, without a global actor-reservation redesign.

**A joined classroom actor is owned by the classroom session. Routine cancellation or departure must use ordinary `classroom_control` leave/depart for that actor, wait for its physical release and preserve the unrelated session and other participants. Never cancel the whole classroom merely because the routine stops.** The routine may observe and command its bound session but does not acquire ownership of it or its foreign children.

Cancel only directly owned children and groups; do not cancel independent directives or adopt another panel's rest/work action. A routine-owned nested rest uses its explicit sit/stand lineage rather than competing with standalone rest's voluntary-return queue. If entry encounters an existing standalone rest, require its ordinary safe release before taking ownership.

Pause retains the live intent and unfinished obligation after owned children drain. Resume is an explicit retry; terminal End drains and releases the logical intent and cannot later resume. An independent direction takes priority: pause the routine, drain owned children and preserve the unfinished obligation. Classroom worker departure remains the bound session's ordinary physical directive; it can still be getting up/walking after logical cleanup, and Resume refuses until the actor is actually standing idle and unowned. Resume is explicit after the directive and physical cleanup finish. Read actual held items, support, food quantity, seat occupancy and task progress before continuing. Retain owned serving/eating lineage: a served bowl may be consumed before its action finishes, and a consumed empty bowl must never be treated as unserved. After an interrupted meal, compose ordinary remaining takes/serving, pair conversation/eating, group release and returns; do not resubmit the entire shared food break. Do not replay transferred food, duplicate serving, overwrite partial food, force a seat release or resume work while another controller owns the actor. Rebind only after an explicit user decision if a committed object/session can no longer serve the intent.

Reset invalidates the intent's world identity and child IDs. Active snapshot restoration and durable routine persistence are outside this slice; no workstation or persistence redesign is required.

## Exact acceptance: two arrangements

Use the existing hypothetical `work-break-4` default arrangement and `work-break-8` side arrangement. Prepare furniture through released ordinary setup actions; keep the world and scenario epoch intact throughout each journey.

- One Start carries the worker through actual classroom seating/question/second presenter, formed conversations, departure, physical shared food/utensil returns, bounded quiet rest/get-up and completion of the same notes. Verify stable task/user/duration and nondecreasing actual elapsed progress, unchanged world identity, and no duplicate phase effects.
- Interrupt during classroom participation: issue an independent direction or Stop routine. Only worker leaves through ordinary classroom control; the existing session and other participants continue. Resume uses the same committed session when eligible, or exposes its ended/unavailable state rather than silently selecting another session.
- Interrupt after some food is transferred: stop/drain only the owned break, retain the true bowl contents and supported/held utensils. Explicit Resume continues from actual partial state, with no duplicated food and no work/rest admission until required hands/returns are safe. A lower-level child refusal remains visible as the cause of the routine wait.
- Interrupt occupied quiet rest: ordinary get-up/cancellation retains the seat claim through physical release. Resume rest uses the retained remaining dwell budget and the same available seat; resume notes uses the original unfinished task and elapsed progress. No foreign seat action is adopted.
- Occupied/reserved spare seat, missing/unavailable display or food, held utensils, blocked route and unavailable workstation produce named diagnostic waits/refusals with actor/object/action subjects. The binding and unfinished obligation stay stable. Routine retries occur only on explicit Retry/Resume after a meaningful remedy, not by submitting the same failing request every tick. Preserve the failed child record/cause and distinguish waiting on its own cleanup from waiting on a foreign holder.
- Completion/cancellation leaves no leaked claims, groups or unsupported objects and no invariant violations. Inspect actual captures showing real seating, shared attention/conversation floors, utensil returns, continuous departures and truthful paused/resumed state in both arrangements.

## Existing implementation anchors and stop conditions

- `viewer/engine/scenarios/work-break.ts`: explicit actor/item/service/return/work bindings.
- `viewer/engine/objects/workstation.ts`: authoritative unfinished user/task/duration/progress and explicit same-task resume.
- `viewer/engine/activities/classroom.ts` and `types.ts`: session/control/readout, member departure, join and social phases.
- `viewer/engine/activities/shared-food-break.ts`: ordinary child dispatch, independent intervention detection and truthful partial effects.
- `viewer/app/lab/work-break-hud.tsx`, `classroom-hud.tsx`, `rest-hud.tsx`: current explicit controls and actual rest lineage/readouts.
- Existing work-break, continuing-classroom and quiet-rest proofs provide the baseline; new focused intent proofs must add continuity/intervention evidence rather than loosen them.

Stop and report if this needs global actor reservation, shared Runtime cancellation redesign, new workstation/persistence semantics or another movement executor. Keep camera, fine furniture, history, needs and sleep outside this brief. Do not expand into another planning tranche or spawn additional agents. Root owns combined gate, integration, release and production proof.

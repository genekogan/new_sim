# LM-024: mover wait reporting, stage 1

Branch `codex/deadlock-detection`, based on integrated `9923eb5`. No historical
content, planner caps, pins, support rules or deployment changes. LM-024 remains
**partial**; this is the approved reporting stage, not early execution refusal.

## Change

Explicit walkers (including carry gather sub-walks), carry people/stair waits and
ride people/vehicle waits publish mover identities and concrete dependencies.
Gather walkers sharing an action id remain distinct. Crew/rider aliases resolve
to moving loads/vehicles; ambiguous aliases are excluded rather than guessed.
Idle people/static geometry remain sinks. Each end-of-tick graph removes stale
or finished samples and deterministically identifies strongly connected groups.

After 200 consecutive ticks with the same cycle, poses and dependencies,
`deadlock.cycle` names movers, owner actions, original codes and directed edges.
The report stays stable while existing local retries continue. Progress clears
it. The runtime never cancels actions or frees support/resources for reporting;
walker's reciprocal-passage recovery still sees the original wait beneath the
overlay. Live StepReport diagnostics are now copied from ActionRecords.

Plain runtime-service episode state is included in snapshots. Legacy snapshots
with no tracker remain valid and start new episodes. Neither WorldState nor the
snapshot format version changes; existing service-bag fields are extensible.

## Focused validation

- New deadlock suite: **11 passed**. Forced three-cycle at exactly tick 200;
  stable event count; broken-edge recovery; retained reservations; acyclic/static
  sinks/self aliases/ambiguous aliases rejected; shared-owner gather nodes;
  vehicle/load aliases; movement resets; future cancellation cue preserved;
  exact JSON pause/resume threshold; actual waiting walker resume; legacy missing
  tracker restores; actual held carry stays supported and result unsettled; same-tick peer cancellation cannot resurrect a record.
- Combined deadlock/walk/resume/carry/vehicles/source-scan run before adding the
  final compatibility/cancellation tests: **44 passed, 0 failed, 0 skipped, 0 todo**,
  6.32 s. The final new-suite run passed all eleven in 0.64 s.
- `npm run typecheck`: passed. Scoped oxlint: 0 warnings/errors.
- Full gate is intentionally reserved for the lead's integrated branch. No
  independent full engine run or pin change performed.

The physical passage fixture completes at tick **239**, with exactly the same
world hash `6b4055949d6b025c0db12888eb316fe5168ae6079640cb7c8bc17ec5b0a0a373`
and event hash `0ba3c1b38192a28f5801cee3078979f5c2d4669c42e93df70a1f1b6f79e18b87`
as integrated `5cd7404`. Mid-wait snapshot blob hash changes from
`2facff0b586d0b0690f53e0fe293f1547e24ede9e9caf15428cd3f5f7a143c72` to
`8d0ce2ab7e538e5b28e2939708a36d7c2e384efac867f9828fc672cdf1cedb72`,
because waiting episode state must survive restoration. Reported to the lead;
no existing pin was edited.

## Inspected capture and limits

[JSON capture](deadlock-detection.capture.json) was read directly: at tick 742,
real carried beam `b1` waits on the stationary test producer `bystander`, which
publishes a reverse dependency on `b1`. Cycle onset tick 543 + 200 samples gives
742. The load still has `support: held` by p1/p2; its reservation remains owned;
there are **zero invariant violations**, live steps are blocked, result is
`partial` and `settled: false`. This proves supported held-load reporting. It is
not a physical three-vehicle proof or an execute endpoint refusal test.

Remaining before LM-024 can be fixed: bounded one-per-episode explicit recovery
request; safe early `blocked` result only when no future cue/independent work can
clear it; exhausted acyclic waits; physical unresolvable passage and actual
gather-stall cases; execute refusal integration; any forklift-specific waits.
LM-020 co-planning, LM-025 back-out and LM-043 physical three-vehicle evidence
remain separate. No row is reclassified or scored fixed by this commit.

# LM-043: a physical three-vehicle cycle

On `codex/deadlock-tails`, following `f3ef307`. Narrow LM-024 certification change
plus LM-043 proof; no walker changes, pins, new motion planner or snapshot codec.

## Actual fixture and behavior

A 2 m wide four-way junction has four 7x7 m corner obstacles centered at
(+/-4.5,+/-4.5), bounded by [-8,-8,8,8]. Three EUCs mount through public verbs:

| Vehicle | Initial x,z / heading | Destination x,z | Speed |
| --- | --- | --- | --- |
| v0 | -5,0 / 0 | 1.2,0 | 0.8 m/s |
| v1 | 0,-2 / pi/2 | 0,5 | 2 m/s |
| v2 | 3,0 / pi | -1.2,0 | 2 m/s |

Actual lane/footprint behavior creates v0 -> v2 -> v1 -> v0, stable from tick 151.
The existing detector reports the cycle at tick 350 with zero violations. v0/v1
attempt their existing route replanners and refuse unsafe routes; v2's extra
recovery correctly reports unavailable during its pull-over. Previously all
three stayed still yet the runner remained partial at tick 694 because any
`yielding` state prevented certification.

Now an exhausted stationary mid-pull-over can certify quiescence if it has no
pending cancel/replan, is in ride phase, and remains strictly outside both 0.06 m
endpoint tests (1e-9 conservative numerical boundary guard). Endpoint/resume
waits still have independent retry/give-up timing and cannot certify. No attempt
is invented, no pose is moved, and no resource/support is released by this hook.
The real fixture returns **blocked at tick 550**, retaining all rider supports and
actor/vehicle ownership. A 240-tick continuation (550 through 790) checks every
entity and actor/vehicle reservation on every tick; all remain unchanged.

The generic follower still has autonomous stuck-route retries after 60 ticks;
this patch does not disable or pretend to exhaust that clock. The capture records
v0's actual retries at ticks 573, 634, 695 and 756 (`stuck` 60 -> 0, successful
`replans` stays 0). All refuse. v2's lane-yield wait does not trigger that branch.
`replan` deterministically uses current rider pose/profile, remaining targets,
static grids, standing people and other vehicle boxes. Those inputs are unchanged
in this closed fixture; elapsed time is not a planner input, and a failed call
does not replace the route. Repeating those calls therefore cannot clear this
fixture without external change. The 200-tick episode policy exceeds the
61-tick retry interval. This evidence is specific to the certified unchanged
physical episode, not a claim that every yielding vehicle has no retry clock.

## Proof and scope

- New focused vehicle-deadlock suite: **4 passed**, 0 failures/skips/TODO (extended continuation: 2.92 s).
- Existing vehicles + forklift + source-scan: **23 passed**, 0 failures/skips/TODO
  (3.04 s). Typecheck and scoped lint clean.
- Independent future cancel prevents early termination and executes. A subsequent
  public ride moves that blocker away; the old cycle disappears, zero violations.
- Active speed, pivot, pending replan/cancel, non-exhaustion and both endpoint
  boundaries refuse certification. Unknown live work and live step timeout also
  prevent termination. Existing tail logic remains unchanged.
- Live rides remain explicitly non-resumable: snapshot refusal leaves world hash
  unchanged. No broad codec/resumption claim. Existing rider support is retained.
- [Inspected JSON capture](vehicle-deadlock.capture.json) records named edges,
  recovery results, poses, supports, owners, zero violations and snapshot refusal.

This proves the requested real three-vehicle cycle can be detected and reported
blocked. It does not prove all traffic deadlock-free or cover mixed forklift-load
cycles, forklift manipulation waits, lane replanning (LM-046), or physical reverse
maneuvers (LM-042). The fixture has no fork load; no fork-load proof is claimed.
LM-024's other remaining limits are unchanged. Lead owns row closure after the
integrated full gate; no broad suite, gate or deploy was run here. Estimate:
25 minutes / 10k tokens, no extra helpers.

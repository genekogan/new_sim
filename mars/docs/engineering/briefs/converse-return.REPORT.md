# LM-026 — conversation preservation and physical return

Candidate on codex/converse-return, depending on 59dc505, 7854e1d and 21caa1e.
A formed three-person conversation now retains two talking members while the third
executes a directed task, then returns through normal walking to the original circle
station. Group members keep their positions/resources throughout. The runtime previews
all conflicts before new member detachment; reclaim uses ordinary exclusive ownership
checks and never overrides a newer command. No new public verb or explicit action id.

Eight focused tests cover physical departure/return; failed, cancelled and newer
instructions; ended group; deleted actor; occupied return station; held-load refusal;
all-conflicts-before-detachment; newer instruction during return; finite-duration
cleanup; outer-directive completion; exact snapshot continuation while away/returning;
and invalid/omitted/duplicate member queues. Twelve seat-return/snapshot tests,
ten existing converse/pre-emption tests and source scan pass as well (31 total).
TypeScript and lint pass. No pins changed; full integrated gate and browser proof
remain with the lead. No ordinary conversation world/event changes are intended.
Snapshot format stays version 1; optional action state appears only after departure.

Personally inspected the three JSON capture states: formed at tick 72, directed walk
completed at tick 161, rejoined at tick 284. Both remaining people retain identical
positions/activity/task across all three. The departed actor walks from approximately
[-5.045,0,-5.6] to [-9,0,-8] and back to the original planned station [-5,0,-5.6].
The 4.5 cm difference is existing walk arrival tolerance, not a pose assignment.
The test checks all remaining-member poses and resources every tick and all default
invariants report zero violations. The held-load negative case is explicitly a
world-invalidation fixture and proves refusal/support retention, not a new lifting flow.

Limits: two-person and still-gathering conversations still cancel as a unit. Group-owned
fixture seats, ambient re-adoption, item overlay release, gaze/gestures, and the manual
releaseForDirective cancellation helper are not broadened. The preserved pair keeps
its old circle positions rather than moving to a new two-person circle. Three-person
re-forming is demonstrated; no general crowd choreography claim is made.

Integration overlap: root 641741f owns duplicate-id handling at Runtime.submit entry
and seat-return explicit-id refusal. This branch does not edit those lines and group
return walks use automatic ids, covered by that root allocation rule.

Review correction: selective member detachment now commits only after every other
social hold has accepted cancellation, including the deferred stand-up path. A mixed
request with a cancellation-refusing social holder proves the directed action fails
while all conversation membership, actor ownership and world state remain unchanged.
Nine focused converse tests now pass; tsc/lint pass. Existing behavior for partial
cancellation among older whole-action social holds is not broadened by this change.

### Review follow-up: ordinary hand items

Conversation re-entry now checks small-item `in-hand` support as well as the
construction grip. A completed public `take_item` directive leaves the actor
holding the bowl and emits `converse.return-refused` / `actor.holding`; it does
not start a return walk or reclaim actor ownership. The other two members keep
speaking. Ten focused conversation tests pass, including the actual pickup
negative control, with zero invariant violations; TypeScript and lint pass.

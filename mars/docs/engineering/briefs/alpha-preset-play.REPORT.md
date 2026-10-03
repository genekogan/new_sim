# Alpha scripted presets: actual UI Play coverage (authored, unexecuted)

The new `viewer/e2e/alpha-preset-play.spec.ts` declares 23 native cases: 21
scripted selectable presets, the intentional incomplete-stairs diagnostic,
and stress-30 sustained execution. Browser execution and image inspection
are pending the explicitly serialized browser slot. Source existence and
successful test listing are not actual Play proof.

Original requested base: 470e9c54d21d8351d91a95555e9d1eb0f8d061fa.
The authoring branch was rebased onto root-reviewed
2c81504a340613b153901988e8d0f82435dc11b2, which includes grouped contracts,
world-clock liveness and the explicit sustained-dispatch exemption. The first
base advanced its clock after 60 simulated seconds but stopped stress retargeting;
this spec would fail its strict fresh post-budget commitments assertion there.
The separate eight manual-journey spec commit c00041d remains preserved.

## Supported contracts

Every physical action advances through the actual Play button and ordinary
frame-driven clock. Speed is selected using the existing UI: 4x except 8x for
hand-up/build-bay. No step/advance/runToEnd or direct pose write is used. Actual
selected year presets await their real asynchronous preparation and visible
backdrop, and retain all four route completion/original expectation checks.

All 21 authored endpoints assert every original `Scenario.expect` result,
finite authoritative poses, zero invariants/halt/errors, actual actor displacement,
and named records. Additional effects include climb/level transitions, the
construction panel and exact one replan, all three trio arrivals, installed
build uprights/deck sheets and visitor deck arrival, the same staged prone sheet
resting on joists, both original mural coverage checks and moved solar panel,
and four completed meals with four empty retained bowls. Completed ordinary
scripts must have completed physical records and release held items/observed
actor/entity/hand claims.

Campfire’s 75s authored endpoint intentionally retains gather/conversation/seated
and wandering holds. It is not an all-records-completed contract. The test retains
all original social/facing/spacing checks, exactly two expected refusals
(slot.none-free/reservation.conflict), seven fire claims and the one-person
scripted pull-away. Only afterwards it uses ordinary cancelAction on live roots,
Play drains all physical children, verifies released holds/claims and advances
the usable world clock. It does not introduce a new product End control.
Meal intentionally retains seated people and their same empty bowls/spoons;
Reset stages their original resources rather than inventing utensil putaway.

Incomplete-stairs asserts exactly the named route.link-unusable refusal,
stair identity, unchanged actor, visible alert, and subsequent usable Play clock
and enabled controls. This is diagnostic proof, not a successful deck journey.
Stress takes actual Play snapshots at 600, 1250 and 2000 ticks (30/62.5/100 simulated seconds),
requires completed walks/progress, new commitments requested after 1250 and one
such new completion, 30 actual actors, at most 30 live walk records and observed
actor claims, finite poses and named refusal diagnostics. Historical record
count is not treated as a live-resource leak; the observer records it separately.

All cases retain initial/progress/endpoint or live-window screenshots with
paired detached runtime JSON and accessibility snapshots. Source HEAD, spec SHA,
run label, failures and native status are recorded in an attached proof JSON;
finally attempts failure capture. Reset checks original authored physical state
and exact geometry/texture counts. No camera-quality or fine-contact claim is
made from these frames.

## Budget and validation

The original 120s per-case, 15s expectations and zero retries remain fixed.
Retained hand-up Node/browser pose proof ended at 16374 ticks (818.7 simulated seconds): 4x
would require about 205 wall seconds, while 8x theoretically requires 102.3 seconds
before loading/captures. This is a concrete risk within 120 seconds, not proof of
an 8x pass. Build-bay also uses 8x as authorized. Actual timeout, unusable year data
or runtime failure must be preserved and escalated, not relabeled or extended.
The two full 2022 construction presets remain outside this spec; their existing
long actual Play evidence and custom budgets are separate.

Source-only checks: strict standalone browser TypeScript, type-aware/type-check
lint, formatter and native listing of 23 cases. No browser, performance test,
asset copy, gate or deployment was launched for this authoring task.

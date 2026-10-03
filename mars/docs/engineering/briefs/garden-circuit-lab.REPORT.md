# Finite garden circuit Lab authoring — future candidate

Owned new paths: `viewer/app/lab/garden-circuit-hud.tsx`,
`viewer/e2e/garden-circuit.spec.ts`, this report. Isolated
`codex/garden-circuit-lab`, base `5f1dc2e`, reviewed core dependency `a26c54d`
(local cherry `13e6afb`). Integrate only the final owned UI/spec commit after core.
No shared registry/stamp/scenario selector/panel/hook/renderer or engine edits.
This is explicitly unshipped hypothetical staging, not historical placement.

## UI and minimal integration

Export `GardenCircuitHud({sim,refresh})`, visible for `garden-circuit` only.
The HUD submits the same registered `garden_circuit` and
`garden_circuit_control {circuit,intent:pause|resume|end}`. It checks authoritative
admission, exact latest circuit, Runtime/epoch freshness and pending controls;
Start requires a fresh world without an earlier circuit. Ended and finished are
separate, and physical draining does not pretend to be released. Named wait/refusal
and later ordinary direction diagnostics remain visible.

Safely paused Direct carer away submits normal `walk_to` to [-5,3]. It requires
registered walking and no competing player walk/control, without raw walk preflight
that could falsely reject a supported held-item handoff. Resume stays the core's
actual admission decision after the independent request. No world pose/support writes.

The readout shows the actual source pot/bowl identities, finite contents/support,
held IDs/hands, ordinary current child/phase and retained history, six care cycles,
per-bed real received material/pending purpose/last deposit tick, and genuine due
waiting. A due wait is distinct from explicit intervention waiting: a supported
idle circuit waits for the existing 600-tick interval, and Play advances that clock.
Global Pause freezes it. Vessel normalization is explicit: .25 pot supplies 1 bowl;
initial .5 pot is 2 bowl units. Six .25 care cycles deliver 1.5 and leave .5 bowl.
There is no unlimited refill, alternate source, growth, spawned plant, washing,
anatomy redesign, universal planner or active reload restoration.

Root needs canonical action/preset/panel wiring plus the detached latest read-only
hook `gardenCircuit(): readGardenCircuit(rt, latestActualCircuitId) ?? null`.
Existing state/records/heldItems/slots/humanFields/bones/cameraEntities/camera hooks
supply all additional capture facts; no new mutation or logical claim hook is needed.

## Authored acceptance — NOT EXECUTED

Two default-only actualPlay cases keep ordinary 4x speed, 120 seconds per whole
case, 15 seconds per named phase and retries zero. Fresh load/Reset/readiness Step
is allowed; all journey work advances through actual Play. No programmatic stepping,
raw material/pose/timing writes, alternate executors or relaxed outcome assertions.

1. Actual first serve commit (.25 pot / 1 bowl, back phase) → Pause → real table
   return → Resume without duplicate serving. Actual partial first care → safe
   Pause → ordinary carer direction → explicit Resume retains the exact pending
   purpose/material. Capture the genuine first-bed idle due wait, assert the exact
   `lastCareTick + 600 - currentTick` remainder, then prove the next care request
   starts no earlier than the due tick. Distinct second/third-bed due and second
   finite resupply checkpoints precede final six cycles, .5 received per bed, empty
   same pot, .5 same bowl on its declared table slot and zero active/held/claims/
   violations. Histories require two actual committed fills (first may be cancelled
   after commit), six completed ordinary care leaves, retained partial-cancel history,
   unchanged source pose/support/definition/provenance and no entity replacements.
2. End before first step creates no phantom physical history. Reset, actually hold
   the first committed refill, End safely returns the same bowl with unchanged
   finite water and no fake cycles. Reset again, reach genuine first-bed due waiting,
   End preserves actual care/material/history without another child, remains ended
   rather than finished, and final Reset has no records/held/slot state or violations.

Each meaningful stage writes PNG, a11y YAML and JSON with actual git HEAD/run,
engine state/records, exact source/bowl/support/finite quantities, own child history,
claims, planter purpose/clock facts, held rendered/engine/palm data and hand/bone
readouts. Errors and failure captures are durable and separately named. Exact
conservation is `4*pot + bowl + sum(received) = 2`; there are no tolerances or refill
assumptions. Cameras use actual fixture positions for capture framing only.

Fine fingers, sparse gestures and continuous camera quality are explicitly outside
these assertions. PNGs require personal review by the later serialized browser
owner. No screenshot inspection, actualPlay pass, performance gate, shipping or
public proof is claimed here; root's release38 gate/public lane stays independent.

## Authoring checks

Viewer TypeScript, strict standalone e2e TypeScript with project esnext/DOM libraries,
focused type-aware Oxlint, Oxfmt and diff checks pass. The core report separately
records 24 new / 57 combined Node cases; this UI lane did not rerun Node or any
browser/performance/full gate. No prerequisite expansion was needed.

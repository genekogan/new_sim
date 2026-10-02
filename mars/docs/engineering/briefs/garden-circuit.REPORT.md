# Finite garden watering circuit — future candidate

Base: `5f1dc2edc90888f8470fc50e14ca3db1cef4ae4d`; isolated `codex/garden-circuit`.
This is hypothetical flat-ground staging, not historical placement, botanical growth,
a new fluids model or a camera-quality claim. No shared registry/catalog/UI or legacy
executor changes; no browser, performance or full gate executed in this lane.

## API and physical scope

- `gardenCircuit` / `garden_circuit`: `{actor, water, source, returnSlot,
  plants:[string,string,string]}`. Start admits one idle ground actor with free
  hands, an empty right-hand bowl at the declared table return slot, a supported
  same-table water pot with exactly `.5` pot, and three distinct grounded usable
  planters. Initial pending care is refused. Parent reserves only its logical
  `garden-circuit:<water>` claim; ordinary registered children own physical work.
- `gardenCircuitControl` / `garden_circuit_control`: `{circuit,intent:
  'pause'|'resume'|'end'}`. Control intent commits at accepted start. Pause drains
  current child and physically returns the bowl. Resume uses the same live parent,
  original fixture binding and actual quantities; it never repeats serving when
  the bowl is nonempty. End drains safely, retains actual material/history and
  reports `mode:'ended', finished:false`; runtime cancellation additionally records
  cancelled status. Completion reports `mode:'completed', finished:true`.
- `readGardenCircuit(rt,id)` is detached: real mode/index/next planter, original
  bindings, current child, owned action IDs/records, actual pot/bowl state, three
  `readGarden` facts, held IDs and all touched resource holders, diagnostics and
  explicit stopped-return retry flag. No renderer or UI authority.
- `gardenCircuitWorld/Scene/Binding/Runtime()` stage `carer`, `water-pot`,
  `water-bowl`, `water-table#r0c2`, pot at `water-table#r1c2`, `plant-a [-2,2]`,
  `plant-b [2,2]`, `plant-c [0,4.5]`. Table remains `[0,-1.5]`, ordinary classroom
  flat floor. Factory uses canonical `createRegistry(extra)` without shared edits.

Existing serving units deliberately differ by vessel capacity: `.25` pot supplies
`1` bowl unit. Initial `.5` pot is therefore **two bowl units**. Six care cycles
use `6 × .25 = 1.5` bowl units and leave `.5` in the same bowl, source pot `0`,
and `.5` received by each planter. Tests check `4*pot + bowl + received = 2` after
EVERY tick, unchanged object IDs and actual supported same-pot pose/slot. No spawn,
refill, raw material mutation, support overwrite or due-time writes by parent.

The finite sequence is A,A,B,B,C,C. Each second visit waits for the ordinary
600-tick interval after the first actual final deposit. Bowl rests on its table
and actor stands idle during due waiting. The world must run for this clock;
global Pause freezes it. A round-robin draft exceeded 600 ticks in transit and
never visibly waited; this bounded declared ordering demonstrates the existing
contract instead of changing its interval. Measured final journey: **3651 ticks**
(182.55 simulated seconds), including **1362 due-wait ticks**; hypothetical 4x
Play would take about46s before UI overhead, but browser timing is unexecuted.

## Interruption and refusal

Actual `serve` commits atomically before its back phase; cancelling that overlay
preserves the full bowl and reduced pot. A regression pauses during this committed
back phase, returns bowl ordinarily, then resumes without duplicating water.
Pre-deposit Pause retains empty bowl/full pot and may retry the unfinished serve.
Partial `garden_care` keeps its existing pending purpose/deposits and safe withdrawal
return; cancelled final withdrawal is accounted by actual cycle state exactly once.

Ordinary actor directives notify this parent to pause; accepted active-care direction
finishes the ordinary care cleanup before walking. Safely paused direction is also
supported. Actor must finish foreign ordinary directives before Resume/release;
no automatic return to the circuit. Original actor/fixtures/materials stay bound.

Child admission is previewed before normal submit; missing actions, unavailable
planters, source/slot/support changes, occupied resources and conservation changes
wait with named diagnostics and explicit Resume after actual restoration. There
is no automatic failed-child retry. Due waits are the sole clock-driven retry.
An occupied End return retains actual bowl ownership, creates no failed-child spam,
and proceeds when support is restored. If the coordinator's ordinary return is
cancelled/failed, it requires explicit retry End/Pause after drain/restoration;
repeated End while active is idempotent. Independent ordinary physical return
can also satisfy End without rewriting the stopped child's historical status.

Scope limits: same Runtime, fixed three-bed authored layout, finite two visits per
bed. No active save/load, automatic source replacement, alternate planter routing,
continuous maintenance, growth or fresh restart of an unfinished circuit. Current
ordinary child executors retain their existing refusal/cleanup contracts; parent
never overrides a blocked physical executor or claims cleanup from a child flag.

## Focused evidence

26 new Node cases cover full chain/replay, every-tick conserved material/support
and zero violations, both sides of serve commit, partial care, accepted direction,
600-tick waiting, End beforeStep/serve/care/due, occupied return restoration,
unavailable planter, changed source support/material, seven invalid bindings,
detached readout, active End idempotence, stopped return explicit retry and physical
independent return. Ordinary garden-care and meal regression suites run alongside.
Focused combined result: **59/59 pass**, zero failures/skips/todos, 2.09s
(26 new circuit + existing garden-care/meal cases). Viewer TSc, own-file
type-aware lint, formatter and diff checks **PASS**. Actual Play/HUD/camera/public proof remains root-owned and unexecuted here.

## Root review follow-up

The resupply reach preview originally dereferenced `registry.get('serve')!`
before dispatch's missing-action guard. Removing serve after the ordinary empty
bowl take could therefore throw. It now enters named
`garden_circuit.action-missing` waiting with the same actual held empty bowl and
full `.5` pot, no throw or failed-record spam. Restoring the exact action and
explicit Resume completes the conserved/supported journey with two servings.

Existing `garden_care` cannot terminate normally before its declared physical
return, and an ordinary external take/walk claims the actor, causing this parent
to pause/drain rather than continue to completion. No ordinary accepted path was
found that leaves final held water in running mode. Nevertheless completion now
explicitly requires the declared resting-on bowl support, no held items and no
foreign actor action. If actual final water is held, a normal `put_item` is
dispatched; completion is checked again after it drains. No support overwrite.
A regression pauses after the sixth committed care cycle, takes the same final
bowl through an ordinary external action, verifies unfinished parent while held,
then observes the ordinary safe return and explicit Resume before clean completion.

Review follow-up: two added regressions, **59/59 combined Node PASS**, 2.09s;
viewer TSc, own-file type-aware lint, formatting and diff checks PASS. No browser,
performance, shared file or dependency changes.

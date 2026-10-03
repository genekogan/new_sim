# Shared food: explicit retained continuation

Future candidate only; base `21e2809`, branch `codex/shared-food-continuation`.
No browser proof, public release, shared registry stamp, UI or scenario wiring is
included. Staging uses the existing hypothetical work-break fixture and unchanged
food units, ingredients, serving ratio and ordinary action geometry.

## Supported contract

`SharedFoodBreakParams.resumeFrom?: string` explicitly names the **latest safely
cancelled shared_food_break in this same Runtime**. The new action requires the
exact original ordered participants, pot, bowls, spoons, service positions,
conversation point and ordered return placements. Accepted continuation consumes
that checkpoint (`continuedBy`); another interruption continues from the newest
cancelled action while retaining the original `purpose` ID.

The existing leaf still dispatches ordinary take, walk, serve, converse, eat and
stow actions. Receipts come from its own child histories: ordinary serve's committed
`back` phase and ordinary eat's distinct committed `lift` transitions. Cancellation
first drains children, then retains a detached checkpoint. Completed consumption
of an empty bowl is therefore distinct from an unserved empty bowl: it skips another
serving/consumption but still takes any returned utensils, gathers and performs the
ordinary stow sequence. No food writes, refill, entity creation, deletion, pose
assignment or replacement executor was added.

`readSharedFoodBreak` adds `purpose`, `resumeFrom`, `continuedBy` and detached
`receipts: SharedFoodReceipt[]`. Each receipt exposes actor/bowl/spoon IDs, optional
food, `served`, original accepted/served `portion`, `remaining`, `consumed`,
`consumptionCompleted`, and actual `serves`/`eats` child IDs. Quantities are bowl
fractions; an ordinary full serving consumes .25 pot fraction. Historical receipts
remain fixed when later actions use the same utensils. Existing participant
held/food/returned fields remain live physical observations.

Admission rejects missing, active, completed, failed or superseded sources, foreign
bindings, altered retained item/material/support, moved supporting fixtures and
subsequent unrelated material use, with named diagnostics and no admission writes.
An unrelated take/put that restores the exact initial pose/support is still rejected
by action provenance. Continued execution also checks actual committed material
against its own receipts; replacement food cannot silently become consumption.
Held utensils may follow an independent player walk with the same actor and hand;
anchored material and declared fixtures must keep their exact placement.

## Interruption boundaries and exclusions

There is no Pause control in this leaf. A future parent may deliberately cancel,
wait for terminal cancellation, expose the supported partial checkpoint, and later
submit the same binding with `resumeFrom`. Ordinary holds can remain active after
cancellation because the items really remain in those hands. Continuation releases
those holds through ordinary stow; successful final cleanup leaves no held items,
active actions or actor/hand/item/slot/shared-food claims.

Fresh-break semantics remain unchanged, including legacy external-directive failure
behavior. Voluntary direction uses cancel → ordinary walk → wait for that walk →
explicit continuation; actor-busy admission prevents premature reclaim. An
uncancelled legacy player directive can fail the parent and that failed action is
explicitly ineligible as a continuation source. Active save/load, cross-Runtime
receipt reconstruction, changed actors/resources, automatic retry and resuming a
completed meal are excluded. A fresh meal remains a fresh meal and needs real food.

## Validation

The first new consumed-empty-bowl regression was RED before the implementation
(`resumeFrom` was rejected by the strict schema), then GREEN after the same leaf
accepted retained receipts. The original 15 shared-food cases were not edited or
weakened. New tests cover pre-first-step cancellation, taking, serving before and
after deposit, partial eating, one person finished, both finished before stow,
partial stow, repeated interruption, cancellation of an accepted continuation before
its first tick, cancelled voluntary direction and legacy failed direction.

Further tests cover exact binding changes, quantity/material/definition/support/
fixture changes, unrelated later meal and normal material take/put, occupied returns,
foreign Runtime, corrupt contents during continuation, exact conserved finite food,
same identities/support, detached history, deterministic chained replay and final
resource cleanup. Every ordinary stepped valid path checks zero engine invariants.

Focused checks: **92/92 Node tests passed** (including all original 15 shared-food
cases and 30 new continuation cases): shared-food + continuation + purposeful-routine +
prepared-day-core + prepared-day-scenarios. Viewer TypeScript, focused
Oxlint, Oxfmt and diff whitespace all passed. Browser/performance/full gate were not run because
root owns the serialized gate lane.

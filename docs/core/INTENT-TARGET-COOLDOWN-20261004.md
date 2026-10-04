# Failed target availability and the Mars DJ gate

Core component correction, October 4, 2026. No activation or release claim.

`optionsFor` ranked available cards and marked the choices that served the
owner's plan before `Brain.evaluate` removed the last runtime-failed option.
If that removal eliminated the only serving choice, waiting retained no intent
signal. The remaining choices could include the same card on another host's
gathering. Fake Jev then had no serving flag to distinguish waiting from an
unrelated spontaneous choice; live evaluation had the same incomplete context.

The cooldown now excludes the failed card/target before look-ahead, ranking,
cap and waiting fallback. It expires at the existing world tick. Cards, targets,
controller physics and accepted historical events keep their existing meaning.

`apps/server/src/intent-options.test.ts` creates two actually hosted gatherings,
mints a DJ request card, directs Wren specifically to Rob's gathering and
marks that exact option avoided. The corrected fixture failed on the previous
implementation (`wait.servesIntent` false) and passes after the correction;
the exact target becomes available again at expiry. The first fixture draft
used the Mars anchor `fire` in Toy; correcting it to `campfire` establishes the
intended availability counterexample before testing the production change.

After the change, one bounded native server invocation passed:

```
node --test --test-name-pattern='mars: the DJ story' --test-timeout=60000 apps/server/src/mars.test.ts
```

One test passed in 22.1 seconds; the owned fake server on 4950 shut down by
SIGTERM at tick 1505. No provider or paid call. The bridge switch remains absent
from production construction, so that invocation exercises the legacy path.

This proves a concrete availability defect and one corrected native DJ run.
The historical parent broad result remains **120/121**, with Wren selecting
Rowan's gathering before Rob's expected agreement. That run used different
random Soul IDs and shared prior activity. Its complete failing decision state
was not retained. The new counterexample is a plausible causal mechanism, not
proof that this was the historical run's sole cause. No unchanged broad rerun
or universal target-binding/physical-clearance claim is made.

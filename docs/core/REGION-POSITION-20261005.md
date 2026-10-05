# Native region positions and retained-direction limits

`apps/server/src/deck.ts` previously resolved a regional place to its native
region ID, then looked up only entities for its position. Regional destinations
therefore had no position even when the engine published a physical anchor.
Distance fell back to one million metres, affecting option ranking, distance
labels and `$target.x` / `$target.z` bindings.

The lookup now retains entity-pose precedence and, for a real native region,
reads the engine adapter's current anchor point. It returns a detached finite
coordinate pair. A missing or malformed anchor remains unknown. `engineRef`
continues returning the stable region ID for native traversal. The anchor is a
destination reference point, not the shortest distance to a region boundary or
proof of occupancy, route feasibility or arrival.

Three new tests use an actual safe-commons native host with an owned Soul,
SQLite and no providers. They check region positions, detached coordinates,
coordinate binding, live body/fixture precedence and the actual serving
presentation-deck option's distance label and native target. Reads leave the
engine/kernel hashes and canonical sequence unchanged. The missing/malformed
anchor test explicitly uses mocked descriptors; it is fail-closed lookup proof,
not a changed-topology native journey.

The commons test reproduces the boundary behind the eight no-attempt directions
in `ACTIVE-COMMONS-COHORT-20261004.md`: birth records the Soul at commons, but its
physical position lies beyond the go-to card's 1.2-metre anchor standoff. The
pinned card's `notAt` membership guard still forbids that play. This correction
does not bypass the guard, move a Soul, create an attempt, record fulfilment or
rewrite vocabulary/history. A grounded explanation of this no-action decision
and progress semantics for retained intentions remain unfinished work.

Validation: initial focused three tests passed; final region-position plus
retained-response and target-scope suites passed 22 tests. Server TypeScript
check passed. The final command also named a nonexistent history-HTTP test path;
Node did not include it. The 22 count contains no history-reader suite, and no
history-reader rerun is claimed. Existing response tests exercise actual native
movement and model-free replay. The 24-resident recovery fixture was not rerun;
its earlier seven completed, nine blocked and eight no-attempt outcomes remain
historical evidence, not results from this change.

No wire schema, capability, engine rule/version, checkpoint, budget, ownership,
default feature activation or frozen App producer input changes. Future candidate
choices can differ because distance ranking is corrected; existing logged
decisions replay unchanged. No latency/capacity/cohort/device/default rollout,
compatible rollback or full G-002 sign-off. Paid spend is zero.

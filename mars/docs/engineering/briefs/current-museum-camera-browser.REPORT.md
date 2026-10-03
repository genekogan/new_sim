# Current museum camera browser integration

The reviewed 2024 reconstruction removed the unsupported fictional sink and moved Freeside. Browser camera fixtures now use the current rendered scene. Separately byte-verified source-era Node fixtures preserve algorithm golden provenance. Only browser test inputs and their hypothetical action-free take helper change; camera policy, production code, historical geometry and algorithm goldens remain unchanged.

The current fixture is `chiba-kitchen-kitchen-counter-f36f13fb`, in `chiba-kitchen`, centred at x 1.829 / z -2.479 with top y 0.99. The supported typed direction is a fixture `fly_through` from `[1.829,1.44,-0.9]`, interior `chiba-kitchen`, lookAt the exact counter and duration 20 seconds. The helper records the actual full current `loadCampusFile(2024)` world and requires successful ordinary compilation for its initial track. No old kitchen geometry or crop is injected. The first six-second initializer correctly refused the motion cap (needed at least 12 seconds); the unchanged 20-second direction succeeded.

The parsed fixture-resolution test, real-mesh hidden/framing checks, synchronous/actual-worker result and track hashes, UI frames during compilation, worker lifecycle and cancellation checks retain their assertions. Existing flagship bay orbit, corrected carry hold and Chiba sunset-pan verification remains intact. New current-scene negatives assert the missing sink's useful `camera.direct.unknown` and the actual counter automatic hold's `camera.direct.uncorrectable`/occluded refusal.

The counter approach is a valid routed motion, not an always-framed hold. Whole-route planner/real readability was 0.2878/0.2927; the camera initially faces along its approach, then turns. At 15 seconds the actual countertop-facing sample is 0.6 readable; a separate assertion and inspected capture prove that visible phase without replacing the original worst-disagreement capture. No default-counter-hold or fully framed path claim is made.

Validation on isolated port 5491, serial browser execution:

- Fixture/current refusal/worker:3/3 passed 24.7 seconds, artifact run `current-camera-museum`.
- Directed verification (unchanged bay/carry/sunset plus current counter):1/1 passed 30.7 seconds, run `current-camera-museum-verify`; all four tracks have zero hidden-by-real-mesh samples and no framing-model mismatch. Bay planner/real 0.9227/0.9442, carry 0.9545/0.9818, sunset 0.8/0.8.
- Added facing assertion/capture:1/1 passed 9.1 seconds, run `current-camera-facing`. Personally inspected `camera-fixture-current-counter-facing.png`: brown countertop and red refrigerator present in the actual current room.

All screenshots are inspection captures (`compare:false`); no visual baselines changed. Scoped lint also removes a pre-existing unused hook and replaces an invalid readonly-array cast with the same elements copied to an ordinary argument array. The untouched whole flagship take test remains for root's integration gate. Root owns release/full-gate and future camera development. Heavy slot returned immediately after focused browser completion.

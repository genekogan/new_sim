# Codex camera natural-language parser report

## 2026-09-28, 17:20 UTC

- Branch: `codex/camera-nl-parse`; rebased onto `main` at `5a129ec28b4f4b895c138ae3b849145b483cb040`.
- Feature commit: `06d5fcc Parse camera directions from bounded natural language`. This report is the following commit.
- `viewer/engine/camera/parse.ts` adds pure `parseSentence` and `parseSentences`. It imports the frozen `cameraDirectionSchema` and validates every success. It reads no world state and performs no I/O.
- `viewer/engine/test/camera-parse.test.ts` tests the four owner sentences, 52 additional successful sentences, 20 deliberately refused sentences, schema round-trips, repeatability, and multi-direction text.
- Lexical rule: in a fly-through, “kitchen” denotes the `kitchen-interior` region; the caller may supply the same region in `vocab.regions`. The parser leaves physical name resolution and context feasibility to `direct.ts`.

### Verification on the rebased branch

- `cd viewer && npm run test:engine`: **384 pass, 0 fail, 3 skip** of 387. Existing camera tests and all pinned tests pass unchanged; no pin was edited.
- `cd viewer && npx tsc --noEmit -p .`: clean.
- `cd viewer && node --test engine/test/camera-parse.test.ts`: 4 test groups pass (the 55 success examples and 21 refusals are table rows within them).
- Playwright: not applicable; this brief changes no renderer or app path. Captures: none.

### Complete sentence → object table (as tested)

| Sentence | `CameraDirection` | Notes |
| --- | --- | --- |
| do a pan across Chiba with the sunset in the background | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"pan"},"context":{"sunBehind":{"sunset":true}}}` |  |
| do a 270° revolution around the main pallet racks over 2 minutes | `{"subject":{"kind":"assembly","ref":"rack bay"},"motion":{"verb":"orbit","degrees":270},"duration":120}` |  |
| go inside the kitchen and face the sink | `{"subject":{"kind":"region","ref":"kitchen-interior"},"motion":{"verb":"fly_through"},"context":{"interior":"kitchen-interior","lookAt":"sink"}}` |  |
| pan across Chiba | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"pan"}}` |  |
| pan left across Chiba | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"pan","direction":"left"}}` |  |
| pan 45° across Chiba | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"pan","degrees":45}}` |  |
| pan 45 degrees across Chiba | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"pan","degrees":45}}` |  |
| tilt up over Chiba | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"tilt","direction":"up"}}` |  |
| tilt down 30 degrees over Chiba | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"tilt","direction":"down","degrees":30}}` |  |
| dolly left past the racks | `{"subject":{"kind":"assembly","ref":"rack bay"},"motion":{"verb":"dolly","direction":"left"}}` |  |
| dolly right 5 meters past the racks | `{"subject":{"kind":"assembly","ref":"rack bay"},"motion":{"verb":"dolly","direction":"right","distance":5}}` |  |
| orbit 270° around the racks | `{"subject":{"kind":"assembly","ref":"rack bay"},"motion":{"verb":"orbit","degrees":270}}` |  |
| revolve 90 degrees around the racks | `{"subject":{"kind":"assembly","ref":"rack bay"},"motion":{"verb":"orbit","degrees":90}}` |  |
| do a full circle around the racks | `{"subject":{"kind":"assembly","ref":"rack bay"},"motion":{"verb":"orbit","degrees":360}}` |  |
| do a revolution around the racks | `{"subject":{"kind":"assembly","ref":"rack bay"},"motion":{"verb":"orbit","degrees":360}}` |  |
| orbit three quarters of a turn around the racks | `{"subject":{"kind":"assembly","ref":"rack bay"},"motion":{"verb":"orbit","degrees":270}}` |  |
| orbit 90° clockwise around the racks | `{"subject":{"kind":"assembly","ref":"rack bay"},"motion":{"verb":"orbit","degrees":90,"direction":"cw"}}` |  |
| orbit 90° counterclockwise around the racks | `{"subject":{"kind":"assembly","ref":"rack bay"},"motion":{"verb":"orbit","degrees":90,"direction":"ccw"}}` |  |
| crane up over Chiba | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"crane","direction":"up"}}` |  |
| crane down 2 meters over Chiba | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"crane","direction":"down","rise":2}}` |  |
| rise over Chiba | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"crane"}}` |  |
| push in on Chiba | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"push_in"}}` |  |
| move in toward Chiba | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"push_in"}}` |  |
| pull out from Chiba | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"pull_out"}}` |  |
| back away from Chiba | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"pull_out"}}` |  |
| fly through the kitchen | `{"subject":{"kind":"region","ref":"kitchen-interior"},"motion":{"verb":"fly_through"},"context":{"interior":"kitchen-interior"}}` |  |
| fly into the kitchen and look at the sink | `{"subject":{"kind":"region","ref":"kitchen-interior"},"motion":{"verb":"fly_through"},"context":{"interior":"kitchen-interior","lookAt":"sink"}}` |  |
| hold on Chiba | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"hold"}}` |  |
| watch the crowd of people eating | `{"subject":{"kind":"group","ref":"eat"},"motion":{"verb":"hold"}}` |  |
| pan across Chiba over 2 minutes | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"pan"},"duration":120}` |  |
| pan across Chiba for 30 s | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"pan"},"duration":30}` |  |
| pan across Chiba in ten seconds | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"pan"},"duration":10}` |  |
| pan 45° across Chiba at 10 deg/s | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"pan","degrees":45},"speed":10}` |  |
| tilt 45° over Chiba at 5 degrees per second | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"tilt","degrees":45},"speed":5}` |  |
| orbit 90° around the racks at 5 deg/s | `{"subject":{"kind":"assembly","ref":"rack bay"},"motion":{"verb":"orbit","degrees":90},"speed":5}` |  |
| dolly across Chiba at 2 m/s | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"dolly"},"speed":2}` |  |
| crane up over Chiba at 1 m/s | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"crane","direction":"up"},"speed":1}` |  |
| push in on Chiba at 1 m/s | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"push_in"},"speed":1}` |  |
| pull out from Chiba at 1 m/s | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"pull_out"},"speed":1}` |  |
| go inside the kitchen at 1 m/s | `{"subject":{"kind":"region","ref":"kitchen-interior"},"motion":{"verb":"fly_through"},"speed":1,"context":{"interior":"kitchen-interior"}}` |  |
| orbit 90° around the racks at 1:30 | `{"subject":{"kind":"assembly","ref":"rack bay"},"motion":{"verb":"orbit","degrees":90},"at":90}` |  |
| pan across Chiba wide shot | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"pan"},"framing":{"size":"wide"}}` |  |
| pan across Chiba medium framing | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"pan"},"framing":{"size":"medium"}}` |  |
| hold on Chiba close-up | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"hold"},"framing":{"size":"close"}}` |  |
| pan across Chiba rule of thirds left | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"pan"},"framing":{"thirds":"left"}}` |  |
| pan across Chiba rule of thirds right | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"pan"},"framing":{"thirds":"right"}}` |  |
| hold on Chiba from the north-east | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"hold"},"framing":{"side":"north-east"}}` |  |
| pan across Chiba with the sun behind | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"pan"},"context":{"sunBehind":true}}` |  |
| pan across Chiba fov 50 | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"pan"},"fov":50}` |  |
| hold on Chiba 35° fov | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"hold"},"fov":35}` |  |
| hold on Chiba with a wide lens | `{"subject":{"kind":"region","ref":"chiba"},"motion":{"verb":"hold"}}` | wide lens has no numeric fov; lens choice left to the engine |
| hold on Venus | `{"subject":{"kind":"region","ref":"Venus"},"motion":{"verb":"hold"}}` |  |
| pan across the north rack building | `{"subject":{"kind":"assembly","ref":"north rack building"},"motion":{"verb":"pan"}}` |  |
| watch the crowd of people eating | `{"subject":{"kind":"group","ref":"eat"},"motion":{"verb":"hold"}}` |  |
| go inside the kitchen and face the sink | `{"subject":{"kind":"region","ref":"kitchen-interior"},"motion":{"verb":"fly_through"},"context":{"interior":"kitchen-interior","lookAt":"sink"}}` |  |

### Refusal table (as tested)

| Sentence | Code | Question / candidates | Span |
| --- | --- | --- | --- |
| look at this crowd of people having this activity | `camera.parse.deictic` | Which activity are the people doing? | `8:12` |
| orbit the racks | `camera.parse.missing` | How many degrees should the camera orbit, or is it a full circle? | `0:5` |
| pan left across Chiba to the right | `camera.parse.conflict` | Should the camera move left or right?; candidates: left, right | `29:34` |
| orbit 90° around the racks over 2 minutes at 10 deg/s | `camera.parse.conflict` | Give a duration or a speed, not both.; candidates: duration, speed | `45:53` |
| zoom in on Chiba | `camera.parse.unknown-verb` | Which camera move do you mean?; candidates: fly_through, push_in, pull_out, orbit, crane, dolly, tilt, pan, hold | `0:4` |
| look at that | `camera.parse.deictic` | What does "that" refer to? | `8:12` |
| look at the crowd of people | `camera.parse.missing` | Which activity are the people doing? | `12:17` |
| hold on a sculpture | `camera.parse.ambiguous` | Is this a region, assembly, or entity?; candidates: region:sculpture, assembly:sculpture, entity:sculpture | `5:19` |
| pan and tilt over Chiba | `camera.parse.ambiguous` | Which one move should this direction use?; candidates: tilt, pan | `0:3` |
| orbit 2000° around the racks | `camera.parse.invalid` | Which numeric constraint should be changed? | `0:5` |
| pan 200° across Chiba | `camera.parse.invalid` | Which numeric constraint should be changed? | `0:3` |
| dolly past the racks at 10 deg/s | `camera.parse.invalid` | Use degrees per second for pan, tilt or orbit; metres per second for moves. | `24:32` |
| orbit 90° clockwise and counterclockwise around the racks | `camera.parse.conflict` | Which orbit direction?; candidates: cw, ccw | `24:40` |
| tilt up and down over Chiba | `camera.parse.conflict` | Should the camera move up or down?; candidates: up, down | `12:16` |
| pan up across Chiba | `camera.parse.invalid` | Which direction is intended for pan? | `4:6` |
| pan 2 meters across Chiba | `camera.parse.invalid` | Should this be a dolly or crane move? | `4:12` |
| hold on Chiba at 2 m/s | `camera.parse.invalid` | Should this be a moving shot? | `17:22` |
| hold on Chiba at 1:90 | `camera.parse.invalid` | What start time in minutes:seconds did you mean? | `14:21` |
| pan across Chiba over 2 minutes for 30 seconds | `camera.parse.conflict` | Which duration should apply?; candidates: over 2 minutes, for 30 seconds | `32:46` |
| pan across Chiba at 10 deg/s and 5 deg/s | `camera.parse.conflict` | Which speed should apply?; candidates: 10 deg/s, 5 deg/s | `33:40` |
| (empty) | `camera.parse.missing` | What should the camera do? | `0:0` |

### Deliberate limits and lead integration

- An orbit without a stated angle, “zoom in,” an unbound “this/that,” conflicting direction or numeric constraints, and a generic unnamed subject are refused. A numeric angle outside the frozen schema is refused instead of clipped. “Wide lens” records a note and does not invent a numeric field of view.
- `cameraDirectionSchema` has no fixture subject kind. A fixture can be named through `context.lookAt` within an interior, as with the kitchen sink; a standalone fixture subject remains unresolved. The lead would have to change the frozen schema/resolver to add fixture subjects. No such edit was made.
- Claude-owned wiring needed: export the parser from `viewer/engine/camera/index.ts`; have `viewer/engine/api/**` or the Studio Direct-camera panel pass a `ParseVocab` from its `SemanticWorld`, call `parseSentences`, display each structured refusal’s question/candidates/span, and send successful typed directions to the existing `engine_direct_camera` path. Keep the existing resolver and context checks authoritative.
- Approximate effort: 35 minutes wall-clock and 31k model tokens. The grammar is intentionally bounded; untested paraphrases may be refused until added with fixtures.

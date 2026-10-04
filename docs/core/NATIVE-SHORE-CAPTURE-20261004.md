# Captured native shore and boat journeys

Additive Core producer for World CWorld100. This publishes the actual registered
native terrain and water, the registered boat layout, and immutable public authored
appearance inside a hash-addressed render scene. The existing flat clearance grid
does not stand in for the sloping triangle bed. It is an isolated native fixture,
not a commons overlay, living WorldHost adoption or an installed World consumer.

`RenderScene.shore` is optional (`native-shore-scene/1`). It records exact runtime
rules and physical base, bounded terrain samples/triangulation, water datum/domain,
and optional boat layout/appearance. Existing unbound captures, hashes and recording
generators remain unchanged. `captureRenderScene` requires matching shore rules;
strict decoding rejects unknown/private fields, altered geometry and invalid hashes.
The runtime constructors return detached registered projections; reading or sampling
them does not change canonical physical state.

Boat appearance is the exact reviewed public UTF-8 JSON from World
`fd27a26096bc445d07483525c487f2906e6a9325`,
`worlds/eden/assets/fixtures/shore-dock-proposal.v1.json`, 12596 bytes,
SHA256 `ad33cee15e66b56e7b1de01de573807e4091faf0cbeae1a9d1eca28f8d97f754`.
The bytes are embedded once per static capture and strictly authenticated.
`decodeShoreAppearanceSourceV1` resolves the appearance without a mutable filename
fetch. Native layout and recorded boat/contact/passenger state continue to govern
physics and occupancy. Decoration never grants contacts, pilots or navigation.

`nativeShoreCaptureFixture()` provides two actual native recorded journeys. Each
contains a world-enveloped capture and a standard recorded take chunk; the take's
renderSceneRef, rules and registered physical base match that capture. Anonymous
native fixture actors are not Souls. Commands, traces and final native state match
the prior unbound journey; only capture reference and derived take identity differ.

Frozen file: `apps/server/test/fixtures/native-shore-capture/journeys.v1.json`,
1002593 bytes, SHA256
`60f7b53faa422db22536518a5864b7d9b22deb68808085272297feb0674aecfa`.

| Journey | Native ticks | Capture hash | Final native state hash |
|---|---:|---|---|
| Shore | 604 | ebbfb980ed98a96ed0f17c8858a288d44baa90c5195f7257fe65bc7c0a40d43d | 0a7f3a49f75ae4c6e2a15cabffda4be8cae2992ade790616854dff0e757138ea |
| Boat | 2900 | dc9dc277fa37e0006edb9153ee6122e77706335af7d48d0a46a23770459818d8 | db1bd46ce25848a56424d1ad6770d1771ba82af9aa59723cbe4c208da812abd8 |

Proof covers actual native execution, mid-run snapshot restoration and genesis
command replay, exact final hashes, unchanged legacy recordings, strict public
capture/chunk decoding, every sampled frame, shoreline wade/swim/tread/bed/buoyancy,
and boat boarding/seated/underway/leaving phases. Paid spend is zero. The default
engine-mars type check still encounters the inherited ES2022 `findLast` library
mismatch in unchanged computer-workshop.ts; the scoped ES2023 library check passes.
No root/config/dependency change is included to conceal that inherited result.

World owns ordinary LiveWorld capture consumption, exact terrain/water/dock/boat
appearance and contact-aware body rendering. Core still owes admitted persistent
commons-to-shore topology, ordinary owner/compiler access and retained intention
journeys, living-world persistence/rollback qualification. These recorded fixtures
do not qualify those paths or broad W/G conformance.

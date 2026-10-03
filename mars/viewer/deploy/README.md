# Cloudflare deployment

The user authorized public Cloudflare hosting on2026-09-05 and final simulation
publication at sim.mars.college on2026-10-02. The existing Pages gateway/CNAME
already serves the Worker application; preserve it and verify exact new assets
after publication. Its editable source/ownership is not yet established; do not
replace it blindly. Only allowlisted viewer/model assets are public; the private
Mars archive remains local. Current release truth is deployment.json and the
[release checklist](../../docs/engineering/RELEASE_CHECKLIST.md).

Run from the viewer directory:

```sh
# Required clean combined gate before functional main integration/publication:
npm run gate
# Rebuild browser CAD only for an intended model change; normally reuse verified assets.
# python3 deploy/browser-model.py
# node deploy/compress-browser.mjs
python3 deploy/prepare.py
CLOUDFLARE_RELEASE=1 npm run build
WRANGLER_WRITE_LOGS=false node deploy/upload.mjs
WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler deploy --config dist/server/cloudflare.json
```

Cloudflare Worker: `mars-campus-2026`. R2 bucket: `mars-campus-2026-models`.
Use Wrangler's OAuth login when authentication expires. Never copy credentials
into the project or read credential files directly.

`prepare.py` stages its allowlist (explicit `FILES` plus directory `GLOBS` such as
`engine/**`; `python3 deploy/prepare.py --list` prints the resolved set) to `.cloudflare/public`
and separates
files exceeding 25 MiB into `.cloudflare/large`. It sanitizes public JSON source
paths and adapts local-only report links/text in generated copies. Original
deliverables and their provenance remain unchanged. The manifest records
sizes and SHA-256 hashes of the release.

Small assets are served by Cloudflare static assets. The Worker streams only
allowlisted large objects from R2, with byte ranges, HEAD and ETag support.
R2 keys include the content hash, so uploading a new release cannot replace
an older deployment's large model bytes. Upload receipts allow an interrupted
upload to resume. Do not clear the bucket during deployment.

Routes include `/studio` and `/studio/2020`–`/studio/2027` (year models),
`/photo` (photogrammetry comparison), `/lab` (playable engine), and `/simulation-guide`.
Worker `/` and sim.mars.college `/` preserve the restored campus homepage.
The engine entry is explicit `/lab`; select a preset at `/lab?scenario=<id>`.
The earlier release36 root-to-Lab entry was superseded by release40 homepage repair.
Supported alpha42 is published and verified from `043957e` after the clean nine-stage gate and bounded public
acceptance. See [current engineering status](../../docs/engineering/INDEX.md)
for executed proof/limits and the release checklist for final publication receipts.
The existing gateway omits campus-model HEAD size metadata; exact fullGET/ranges
and backend controls are verified. See the final handoff for this retained limitation.
No mars.college/simulation page is provided. Browser layouts are downloaded JSON.
Shared server rooms are persistent Durable Objects using the baseline campus;
that does not establish active browser Lab save/load, which is owner-deferred.

The studio's **Walk · WASD** button enters first-person navigation. WASD moves; left/right arrows turn and up/down arrows look, Space jumps, Shift runs, and dragging looks around. Optional
mouse locking allows continuous mouse look. Escape or **Exit walk** restores
the previous orbit camera. Input fields and loss of focus do not retain movement
keys. Walking uses a 1.70 m eye height, gravity and spatially indexed mesh queries
for basic floor/wall/ceiling collisions and low steps. Collisions follow visible
draft geometry, so holes and incomplete structure can still affect navigation.
The index rebuilds on entry after layout edits.

Walking regression checks:

```sh
node --experimental-transform-types --test deploy/walking.test.mjs
```

Validation: TypeScript check, production build, Wrangler deployment dry run,
release file/link audit, and streamed-download behavior checks passed before
initial publication. The September 26 Brahman geometry correction and its
remaining photographic-fit limitations are recorded in
`../../research/2020/EVIDENCE.md`.

## Campus life (2026-09-22)

The studio has a separate illustrative atmosphere layer: eight outdoor walkers,
idle/waving people in the other existing placements, drifting clouds, sparse
wind-blown desert grass and dust, a sun/daylight cycle, stars, moonlight, and a
small campfire with flames, embers and local flickering light. The three small
skinned GLBs reuse the existing Quaternius CC0 sources and their Idle/Walk/Wave
clips. Regenerate them with Blender running `../scripts/prepare_animated_people.py`.
The `environment/` deployment allowlist already includes these assets.

`Campus life` controls motion, an eight-minute illustrative day (not a calibrated
solar study), manual time presets and fire visibility. The scene starts at 16:00
with time passage off; the **Time passes · day–night cycle** checkbox turns it on.
People and breeze start disabled for reduced-motion preferences. New shared rooms
also start at 16:00 with time passage off and expose their own checkbox.
Background tabs suspend rendering and polling; shared rooms keep their server clock.
`Visit campfire` selects an evening viewpoint. The master people/breeze switch
also hides atmospheric set dressing and restores original static people.

Animations never alter the editable campus transforms. Selecting a component or
entering an edit tool pauses the animated visitors and reveals original people;
clearing selection in Inspect resumes. Layout saves and GLB exports contain only
the editable replica and proposed additions, without fire/grass or moving poses.
Outdoor routes conservatively avoid expanded ground-level mesh bounds, and the
navigation grid rebuilds after edits. This is illustrative circulation, not an
accessibility, egress, survey, fire-safety or solar simulation. Interior visitors
idle in place; there is no inferred interior navigation mesh.

Checks: `node --experimental-transform-types --test deploy/ambience.test.mjs
 deploy/camera-ground.test.mjs deploy/walking.test.mjs` (as one command), TypeScript,
production build, and browser review of daylight/night, campfire and still mode.

## Audit and verification

See `../AUDIT-2026-09-22.md` for findings and remaining limits. Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run test:simulation`. Use `SITE_BASE=https://your-host ALL_ASSETS=1 node deploy/smoke.mjs` after deployment. The standard Vite dev proxy targets port 8797; override with `MARS_SIMULATION_PORT` when running an isolated server.

## Second audit and control plane v2

See `../AUDIT-2026-09-22-CONTROL-PLANE.md` and `../public/simulation-agent-guide.md`.
`browser-model.py` needs Pillow and derives a 1024px-texture copy under `public/browser/`;
`compress-browser.mjs` then losslessly compresses geometry with meshoptimizer and compares
every decoded buffer against its input. Run these two in sequence when rebuilding the
browser asset, before staging. Neither changes the source GLB or textures. Edited browser
exports use the reduced textures; full-texture source downloads and Blender remain intact.

The optional standalone e2e harness is not installed. Browser verification uses the
in-app browser; automated model/clock/navigation/resource tests run through `npm test`.

The compressor also writes a verified lossless Brotli delivery variant. Normal browser
GETs negotiate it through `Accept-Encoding`; clients without Brotli and ranged
downloads retain the original GLB representation. The Worker streams precompressed
bytes using `encodeBody: manual`, so compression adds no per-request CPU or buffering.

## EUC follow camera (2026-09-24)

**Ride EUC** / **Ride with an EUC** now follows the existing first active rider with
a 60-second orbit, a 1.1 m secondary epicycle and gentle elevation variation.
The horizontal distance is approximately 8–10 m and the height is 2.55–3.45 m
above the rider base. The orbit is biased relative to Chiba's current world-space
bounds: roughly 77% of each lap is on the outward side, and 60% is within
36 degrees of the camera → rider → Chiba alignment. This favors Chiba as the
backdrop; it cannot guarantee visibility through intervening structures.

Offsets and bearing are smoothed with frame-rate-independent exponential blends.
Entry blends from the current shot; dragging the viewport or choosing another
view exits following. It remains a local viewer camera, temporarily taking
precedence over a followed remote shot, and freezes with a paused room. Its
60-second period uses active viewing time rather than the shared simulation rate.
The browser stops advancing it while hidden. Ground clearance still applies;
building collision avoidance is not added by this feature.

Regression checks cover full laps and background preference from all four campus
sides, loop continuity, entry, pause, 30/60/120 Hz consistency and bearing seams.

## EUC turn smoothing and helmet removal (2026-09-24)

Rounded perimeter segments caused a 7.5-degree yaw jump at each vertex, at
roughly 0.4-second intervals at normal riding speed. Shared EUC pose evaluation
now derives heading from positions half a metre before and after the rider,
without changing the rider's route or speed. At 3 m/s and 60 FPS, the measured
maximum heading change on the arc fell below 0.4 degrees per frame. Local and
remote rider missions use the same smoother. The synthetic helmet meshes and
body roll were removed; the unicycle wheel still spins. All 41 regression tests,
TypeScript, lint, build and Wrangler dry run passed. The live studio was checked
with the helmet absent and no console errors.

## Recorded camera tour packaging (release18 candidate)

`npm run dev` generates the six-scene replay at ignored `public/camera-demo/suite.json`. Direct Vite users run `node deploy/prepare-camera-demo.mjs` first. This is labeled recorded playback, separate from the live authoritative /lab and /cinematography/review.html classroom.

Normal release sequence remains `python3 deploy/prepare.py`, then `CLOUDFLARE_RELEASE=1 npm run build`. The build's prebuild hook freshly records/validates all six cases, checks zero recorded violations/failures and all three camera policies, stages the JSON with a content hash in `.cloudflare/release.json`, then Vite bundles the suite HTML. No ignored developer artifacts are fetched in production; no MP4 or generated JSON is committed. The 18.4MB replay stays under the25MiB static limit and changes no large-object manifest or R2 receipt.

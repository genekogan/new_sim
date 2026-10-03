# Second major audit and simulation control plane v2

Published: 22 September 2026. Worker version `e10c1094-553c-4ccf-8b8a-28d53ca8a6b8`.

[Live studio](https://mars-campus-2026.<workers-subdomain>.workers.dev/studio) · [External-agent manual](https://mars-campus-2026.<workers-subdomain>.workers.dev/simulation-agent-guide.md) · [Human-readable overview](https://mars-campus-2026.<workers-subdomain>.workers.dev/simulation-guide)

Scope: material reliability, rendering/memory/network cost, browser usability, shared simulation correctness, and the requested MCP controls. This supplements the first `AUDIT-2026-09-22.md`; it is not a new survey or proof that the campus geometry is historically exact.

## Significant findings fixed

| Finding | Change and evidence |
|---|---|
| Embedded textures risk exhausting browser/GPU memory. | The 376 embedded images include five 4096×4096 textures. Estimated uncompressed RGBA texture storage with mipmaps falls from **582.2 MiB to 182.2 MiB** after capping browser textures at 1024 px. This is a texture estimate, not a measurement of total GPU usage. Original source GLB, textures and Blender downloads are unchanged. |
| Large cold download delays rendering and increases decoding pressure. | The browser GLB is **70,772,556 bytes**, down from approximately 126.9 MB. Geometry uses lossless EXT_meshopt_compression. The build decoded and compared every one of 18,429 encoded views byte-for-byte. No geometry simplification, position quantization or removal of editable nodes. Browser asset rendering checked locally and live. |
| Selecting one component disabled batching across the entire campus. | The selected subtree stays editable; unrelated static components remain batched. Restoring selection rebuilds affected batch membership. A regression checks rendered layers and restoration. Whole large assemblies still cost more to edit than individual parts. |
| Fixed pixel ratio and no context-loss feedback/recovery path. | Sustained slow rendering lowers pixel ratio in bounded steps to 0.8. Hidden/context-lost periods reset that budget. WebGL loss suspends rendering and displays status; restoration invalidates shadows and resumes. Context recovery hooks are implemented, but forced driver loss was not exercised with the browser tool. |
| Time speed/pause mixed wall time and animation time. | An anchored virtual clock controls all shared timelines, preserving position/hour across rate changes and pauses. Existing persisted rooms normalize lazily without resetting their state. Separate day length changes only the sky cycle. Unit tests cover old paused rooms, rate changes while paused, resume, and hour continuity. |
| Faster simulation could multiply expensive shadow passes. | Shadow refresh is budgeted against wall time at 4 Hz, independent of virtual time speed. Explicit layout invalidation can still request an immediate refresh. |
| Large unchanged state was transferred every polling cycle. | A revision-matched read returns only `{unchanged,revision,now}`. The DO caches its loaded state, invalidated after successful transactions. Browser heartbeat updates retain the same immutable routes and resynchronize the server clock. |
| Long EUC return routing could flood a large navigation grid. | A* with an octile heuristic searches the 441×441 campus grid; neighbor clearance prevents cutting blocked diagonal corners. Clear-line route simplification bounds network payloads. Existing near-Chiba walking remains within its smaller mapped area. |
| Phone sidebar consumed most of the viewport. | Collapsible overlay controls leave the 3D viewport full width. Verified at 390×844 with controls closed and opened. No claim of physical-phone GPU performance. |
| Agents could issue misspelled fields without discovering they were ignored. | Strict command schemas reject unknown fields. Atomic batches validate every child and roll back entirely on a failure. Tool discovery returns full JSON schemas and known landmarks/IDs. |

## Controls delivered

The production MCP endpoint exposes **20 tools**, including discovery:

- Hour, day/night cycle, day length, simulation rate, pause/resume.
- Clear/cloudy/rainy/windy/dusty weather presets and independent cloud/rain/wind/dust intensities and wind direction.
- Static shots, orbit/spiral trajectories, explicit keyframe paths, optional looping, duration and stop-at-current-pose.
- Individual walkers, groups/all eight outdoor walkers, stationary indoor activities, gatherings and campfire activities.
- Per-rider or all-enabled EUC circle, return, stop and dismount commands. Return routes to distinct docks; remount routes join the perimeter without teleporting. Dismount uses a static standing pose next to the parked wheel.
- Campfire on/off/after dusk.
- Portrait projector and six gallery displays: on/off, procedural art, title slides, test patterns and brightness.
- `apply_scene` for a single atomic update across up to twelve commands; `get_capabilities` for schemas, IDs and landmarks.

Weather uses a fixed 2,400-streak rain budget in one draw call, a coarse roof-height mask, existing sky/cloud lighting, wet-looking soil and wind-driven grass/dust. It does not add unbounded emitters or particle arrays each frame. Gallery textures, shaders, roof mask and rain buffers have explicit cleanup owners.

Gallery presentation was compared against existing selected reference photos `ref-110` (portrait projector, racks, small displays) and `ref-011` (two gallery levels, pale panels, string lights). A browser check caught a rotated projection overlay; its alignment was corrected from the original wall geometry. Fixture locations remain approximate and screen artwork is illustrative. The off projector remains a pale projection surface; monitors turn dark. Overlays follow Chiba transforms, but are not part of construction inventory or edited GLB export.

## Verification

- **35 regression tests passed**, covering existing walking/jump/body completeness/ground constraints and new virtual clocks, pause/rate migration, camera loop closure, invalid camera/target crossings, EUC return from multiple perimeter quadrants, parked poses, remount/speed continuity, batch rollback and selection batching.
- TypeScript, lint and production build passed. `npm audit` reported zero vulnerabilities when adding the build-time meshoptimizer dependency.
- Actual MCP Streamable HTTP handshake and **all 20 tools** passed locally and in production, including spectator restrictions, isolation, invalid inputs, command idempotency, rollback and request limits.
- Production HTTP checks cover five application route forms, **102 published assets**, referenced JS/CSS, no-cache HTML, 404/405/401 behavior, and GLB range downloads. The new compressed GLB range and Markdown agent guide were checked separately.
- Live browser: compressed campus loaded without reported console errors; rain and a moving spiral camera rendered; returned riders stood beside their parked EUCs; gallery projection/art and two-level displays were visually reviewed locally, and the title-slide program was confirmed in the final production build; responsive panel checked at phone width. Rendering diagnostics showed the adaptive pixel ratio in use. These are functional observations, not an FPS improvement claim or cross-device benchmark.
- Source backup: `.cloudflare/audit2/code-before.tgz`. Logs: `.cloudflare/audit2/tests.log`, `mcp-local.log`, `mcp-live.log`, `http-smoke.json`, `build.log`, `deploy.log`. Test capability files remain local and are not published.
- The optional standalone e2e harness is absent. Checks use regression tests and the available in-app browser; no claim that that harness or a long-duration heap soak ran.

## Remaining major limits

1. **Navigation/physics:** indoor stairs are not mapped, routes use the baseline rather than collaborative geometry edits, and EUCs/people do not implement traffic physics or mutual avoidance. Camera trajectories enforce ground clearance but can cross buildings. These are explicit constraints, not silently accepted impossible routes.
2. **Heavy assets:** even after compression and the texture reduction, a 70.8 MB decoded campus (38.5 MB Brotli transfer) and hundreds of materials are substantial. Low-memory phones may still struggle; LOD, compressed GPU texture formats, and spatial streaming are the next substantial rendering investments. No guarantee of leak-free operation or universal device performance.
3. **Rooms/access lifecycle:** capability-protected community rooms have no accounts, token expiry/revocation, quotas, automatic retention/deletion or per-agent write arbitration. Leaving does not revoke a capability. This is documented and should be addressed before offering an unrestricted public multi-tenant service.
4. **Reconstruction accuracy:** hidden interiors, some building dimensions and gallery placement remain provisional. Weather, people, activities and display artwork are presentation elements, not a record of historical events or a construction inventory.

## Rebuild and connection documentation

Run `python3 deploy/browser-model.py` then `node deploy/compress-browser.mjs` to regenerate the derived browser model. Python requires Pillow; the compressor uses the pinned build dependency. Then use the deployment steps in `deploy/README.md`.

External agents should receive the public manual plus the private MCP configuration copied from **Studio → Simulation & MCP**. The configuration grants only the room capability; no Cloudflare account credentials are needed. Spectators receive the separate viewing link. Enable **Follow remote camera** in each viewer that should follow directing commands.

Compression format reference: [Khronos EXT_meshopt_compression](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_meshopt_compression/README.md). Worker review reference: [Cloudflare Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).

Temporary local audit servers were stopped after verification. The final live studio was left open in daylight, outside the disposable test room.


## Additional asset delivery pass

The main browser GLB now transfers as **38,494,104 bytes** through prebuilt Brotli, compared with **70,772,556 bytes** after the earlier texture/mesh optimization and **126,892,472 bytes** for the original full-texture model. This delivery layer is lossless: the complete production response was decompressed and its SHA-256 checked against the local browser GLB. No geometry or pixels changed in this pass. Full-resolution originals remain available.

The current model contains only 6.4 MB of embedded images, so further lossy texture compression would have offered less download benefit than this lossless delivery improvement. The earlier 1024 px cap reduced estimated RGBA texture allocation including mipmaps from 582.2 MiB to 182.2 MiB; these are texture estimates, not measured total GPU memory. Brotli itself reduces transfer bytes, not GPU memory or draw calls.

`deploy/http-compress.mjs` produces and round-trip verifies the `.br` file; the model rebuild pipeline invokes it automatically. R2 retains both representations. Workers stream the selected object with `encodeBody: manual`, variant-specific ETags, and `Vary: Accept-Encoding, Range`. Range requests use the identity representation. Identity/gzip-only clients and missing compressed objects fall back safely. The Worker honors zero quality values when received, but a live diagnostic found Cloudflare normalizes `br;q=0` to `br` in `cf.clientAcceptEncoding`; this edge limitation is not presented as a passing production negotiation case. Temporary diagnostic headers were removed.

Validation: 37 regression tests passed, TypeScript/lint/build passed, 103 published assets passed HTTP checks, and the live campus rendered with no reported browser console errors. `deploy/compression-smoke.mjs` checks the full decoded model hash, Content-Length, identity/gzip fallback, identity byte ranges and conditional 304 responses. Results are in `.cloudflare/compression-audit/live.json`. Final deployment: `844ca82a-8ad0-4a12-9c10-2ef82eff78d8`.

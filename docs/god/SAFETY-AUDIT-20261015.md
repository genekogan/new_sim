# God authoring safety audit — S1, 2026-10-15

Local implementation and read-only audit for `S1-SAFETY-BRIEF.md`, branch `godmode/safety-20261015`. Lead reviews and commits. No git writes, external network, browser, service deployment, dependency install or paid calls. Tests use Hono in-process requests and fake native minds; URL strings in those fixtures do not open sockets.

## Admission and creation rules

- `packages/generators/src/creation-limits.ts` exports the shared `CREATION_LIMITS`. Server ingestion/assets/rates/store, compiler admission/schema/spatial cells, and generator kit/JSON schemas import it. `/v1/god/schema.limits` includes the effective world overrides for entity count, bounds and mesh budget.
- The building generator preserves opening adjacency (`from`, `to`, `exterior`). Its design check and compiler admission use the same outside flood. Admission removes obstructed exterior edges and refuses a newly unreachable room with `architecture.sealed`, naming the building, room and blocked openings. Check runs on the final scratch world, including moves, clones, expanded contents, definition rebinds and dependent edits. A second usable exterior entrance preserves admission.
- Approach: 1.5 m outside an opening; minimum body width 0.75 m and headroom 2 m. Vertical obstacles above the standing body or below a 0.15 m step allowance do not obstruct it. Obstacles retain yaw, are expanded for body clearance, clipped to the corridor, and form a seal when a connected barrier joins its two sides. Solid colliders carried by surface-layer generators are included too, matching engine bridge collision behavior. This permits winding clear approaches instead of conflating projections of disconnected obstacles. Existing sealed rooms can be repaired without refusing unrelated edits. Sidecars without adjacency infer neighboring rooms from their opening normal; openings already narrower/shorter than the minimum body are not counted as previously usable routes.
- Engine physics supports yaw boxes plus height spans, not arbitrary pitch/roll boxes. Each tilted kit primitive therefore uses at most eight slices along its greatest vertical span; target rise per slice 0.25 m. Upright output remains unchanged. Tilted slices are never recombined into the old enclosing box. With at most 96 shapes, absolute per-kit cap is 768 colliders.
- Furnish layout now bakes actual item physics and explicit recipe params at build time and runtime, rotates collider offsets, rounds the candidate pose exactly as emitted, and rejects actual collisions with walls or earlier pieces. Conservative visual bounds still separate pieces. The bar counter recipe keeps its aisle clear after baking the bar variant's footrail. Regenerated `vocab-w3.json` changes 17 building contents records. Church contents already become non-overlapping with the corrected tilted colliders; the same source layout code prevents future recurrence.
- Re-admission compares an existing pair's total yaw-box intersection volume to its pre-batch value. Equal/reduced existing penetration is allowed. A new pair or increased penetration is refused. No overlap exemption is created for new entities. This also covers unchanged footprints during shared definition rebinds.
- Budgets refuse growth, with `measured` and `limit`, without deleting history: 50,000 entities (or the world's stricter existing limit), 10,000 retained definition contents, 50 million instance triangles; 1,024 solid entities per conservative 16 m collision-hash cell; 10,000 uploaded asset hashes and 2 GB attributed asset bytes. Core shared assets do not consume upload quota. Aliases do not multiply retained definition content counts. Upload/sidecar budget checks precede store writes.
- Authoring journal: 1,000,000 entries / 512 MiB of stored ops, inverse and note payloads. A durable SQL aggregate is seeded for old worlds and maintained transactionally by an insert trigger. Engine cleanup that removes existing entities without creating entities/defs has a bounded extra reserve of 50,000 entries / 64 MiB so a full creation journal does not strand retirement. The payload ceiling does not measure SQLite index/page overhead or the separate engine event log. No automatic history pruning or archive workflow is introduced.
- Compiler input is iteratively checked before recursive schema/hash work: depth 32, 100,000 values, finite numeric envelope, 2 MiB JSON. Definitions have an independent 256 KiB input ceiling; batches have 256 ops and at most 4,096 upserted entities. Malformed local objects, cycles, huge numbers and deep JSON return typed refusals. The HTTP act and preview entry points check before their own schema parsing too.

## Measured sizing

All six shipped `genesis/1` templates built locally with the corrected source and fake/no minds. The library has 776 definitions. Every one of its 28 furnished building types placed successfully; maximum per furnished type: 116 entities, 45 solids in a collision cell, 26,498 triangles.

| Genesis template | Entities | Retained defs | Solid entities | Triangles | Maximum solids/cell |
|---|---:|---:|---:|---:|---:|
| eden-district | 151 | 39 | 117 | 59,334 | 33 |
| hello-hamlet | 6 | 5 | 2 | 2,328 | 2 |
| littlemartians-garden | 32 | 22 | 12 | 333,401 | 2 |
| littlemartians-two | 432 | 128 | 96 | 3,484,286 | 5 |
| mars-camp | 78 | 33 | 43 | 27,966 | 11 |
| mars-two | 167 | 133 | 133 | 1,221,823 | 28 |

Measurements count expanded contents and retained content once. `mars-camp` removes some initial entities; its 88 source ops are not its final entity count. The upgrade batch list is not a separate genesis world. Region admission intentionally uses the collision index's conservative cells, including an entity whose footprint touches several cells once in each cell.

## Route audit

`G` means any paired god token present in this world's token table; there is no per-agent read/write role separation. Wrong-world god tokens fail the same way as missing tokens. `U` means the signed-in human identity supplied by `requireUser`; owner-gated routes also accept server admins via `canApprove`, except `claim` refuses an already owned world belonging to another user. All `/v1/god/*` requests have streamed byte accounting before JSON/multipart decoding. Ordinary bodies are 2 MiB; raw assets use the world's mesh-byte limit (3 MB default); multipart additionally allows a 1 MB footprint and 64 KiB envelope. Oversized bodies can therefore return 413 before an auth error. The generic HTTP 64 KiB middleware is registered after god handlers and does not override their earlier limiter.

Rate windows below are real 60-second sliding windows using the existing `RateLimit`. Per-token buckets store a token hash, authenticate before allocation, are scoped by route mount/world, and return 429 `rate-limited`; production HTTP includes `Retry-After`. Invalid requests consume a slot too. There is no server renderer endpoint: previews return data, and thumbnail routes store pre-rendered PNGs.

| Route(s) | Authority / missing or wrong-world result | Body / additional field bounds | Rate |
|---|---|---|---|
| GET `/v1/god/schema`, `/god/SCHEMA.md` | Public, 200; effective creation limits are public | No normal body | None |
| GET `/v1/god/status` | Public, 200; wrong token is anonymous/visitor; pending pairings and agent count only for owner/G | No normal body | None |
| GET `/god/SKILL.md`, `/god/skill.md`, `/god/eden-god.mjs`, `/god/kit-primitives.png`, `/god/examples/:file` | Public, 200 or 404 for absent static file; filename pattern constrains examples | Static files; PNG served as bytes | None |
| GET `/v1/god/welcome`, `/v1/god/pairings` | U + owner/admin (`canApprove`); 401 absent user, 403 other owner | No normal body | None |
| POST `/v1/god/pair/start` | Public; creates pending request, never grants a token | 2 MiB; agent label retained at 60 chars | 6/IP |
| GET `/v1/god/pair/:code` | Any U; 401 absent; unknown/expired code 404 | No normal body | None |
| POST `/v1/god/pair/approve` | U + owner/admin; 401 absent, 403 stranger | 2 MiB; code 4–12 chars | None |
| POST `/v1/god/pair/poll` | Secret poll token; no god token; unknown poll fails 404 | 2 MiB; requires string poll_token | 60/IP |
| POST `/v1/god/claim` | U; unowned world can be claimed; other owner 403 | No fields used | None |
| POST `/v1/god/mint` | U + owner/admin; 401 absent, 403 other owner; claims unowned world | 2 MiB; label retained at 60 chars | None |
| POST `/v1/god/verify-use` | G; 401 missing/wrong-world; engine absent returns typed unavailable verification receipt | 2 MiB; strict schema, refs 200 chars, timeout <=180 s | 6/token; also one active probe/world |
| POST `/v1/god/query` | Public; returns public world geometry/vocabulary | 2 MiB; query-specific validation | 60/IP |
| POST `/v1/god/preview` | G; 401 missing/wrong-world | 2 MiB + compiler limits; 100 previews retained, 10-minute expiry | 30/token |
| GET `/v1/god/preview/:id`, `/v1/god/previews` | G; 401 before lookup; unknown/expired id 404 | No normal body; list <=20 | None |
| GET `/v1/god/snapshot` | G; 401 missing/wrong-world | No normal body | None |
| POST `/v1/god/dryrun` | G; 401 missing/wrong-world | 2 MiB + compiler limits | 60/token |
| POST `/v1/god/act` | G; 401 missing/wrong-world | 2 MiB + compiler limits; typed failures use HTTP 200 | 120/token |
| GET `/v1/god/requests/:clientRef`, `/v1/god/requests/` | G; 401 missing/wrong-world, 404 absent/evicted receipt; every G in this world can read it | Last 1,000 accepted client refs, outcome <=256 KiB | None |
| POST `/v1/god/undo`, `/v1/god/redo` | G; 401 missing/wrong-world | No body fields used; undo group in query | None |
| GET `/v1/god/edits`, `/v1/god/prayers` | G; 401 missing/wrong-world | Edits page <=200; prayers <=100 | None |
| POST `/v1/god/answer` | G; 401 missing/wrong-world; unknown prayer 404 | 2 MiB; answer 1–4,000 chars | None |
| GET `/v1/god/stream` | G; 401 missing/wrong-world | SSE; replay ring bounded in GodMode | No connection cap |
| POST `/v1/god/pray` | World-local Soul token; god/wrong-world Soul token 401 | 2 MiB; prayer 1–2,000 chars | 3/Soul |
| GET `/v1/god/prayers/mine` | World-local Soul token; otherwise 401 | <=20 own prayers | None |
| POST `/v1/god/assets` | G; 401 missing/wrong-world before asset parser (after wire limiter) | Raw/multipart limits above; GLB/texture/footprint checks; world aggregate quotas | 12/token |
| GET `/v1/god/assets` | G; 401 missing/wrong-world | <=100 world uploads, optional shared core list | None |
| GET `/assets/:sha.ext`, `/v1/god/assets/:sha` | Public content-addressed bytes/facts across worlds; 200 or 404 (matching ETag may return 304) | Read-only; no provenance list exposed by asset hash route | None |
| GET `/v1/god/defs` | G; 401 missing/wrong-world | Search result limit <=500; catalog pagination | None |
| GET `/v1/god/defs/:ref` | G for known defs; missing/wrong-world 401 for known ref, unknown ref 404 before auth | Read-only full def and example | None |
| GET `/v1/god/defs/:ref/thumb.png`, `/thumbs/:hash.png` | Public 200/304 or 404 absent thumbnail | Read-only PNG | None |
| POST `/v1/god/defs/:ref/thumb.png` | G; 401 missing/wrong-world | 2 MiB wire, then PNG <=512 px and <=400 KB | 30/token |
| GET `/v1/god/catalog`, `/catalog/taxonomy`, `/catalog/t0`, `/recommend` | G; 401 missing/wrong-world | Catalog page <=2,000; recommendation intent <=400 chars, <=8 picks/need | None |
| POST `/v1/god/land` | G; 401 missing/wrong-world | 2 MiB; translates to normal compiler-admitted edits | 30/token |
| POST `/v1/god/strike`, `/v1/god/env` | G; 401 missing/wrong-world | 2 MiB; existing coordinate/weather/time validation, compiler-backed mutation | None |
| GET `/v1/god/layers` | G; 401 missing/wrong-world; 404 no engine layer | Read-only wallets/refs and layer view | None |
| GET `/v1/god/layers/zone-suggest` | Public; 200, invalid use 400 | Small category suggestions | None |
| GET `/v1/world/snapshot`, `/seq`, `/ground`, `/tiles/:tx/:tz`, `/entities/:path`, `/constitution`, `/env`, `/layers` | Public viewer information; absent entities/tiles/layer 404, bad tile indices 400 | Read-only; tile bounds; public layer excludes private wallets | None |
| GET `/v1/world/layers/me` | World-local Soul token; otherwise 401 | Read-only own layer view | None |

The preview-by-id read previously omitted `requireGod`; corrected here. Public asset bytes, topology, schema, skill and primitive reference are deliberate viewer/onboarding surfaces, not world-private endpoints. God token validation is a world-scoped stored hash lookup, rather than trusting a world name in the bearer string or request payload.

## Read-only probe retirement review

Protected implementations (`god/verify-use.ts`, `verification-probe.ts`, probe portions of `souls.ts`) were inspected and not edited.

1. Normal/error paths enter `finally`, detach the observation listener, journal `retire`, drain pending inputs, and wait up to five seconds for native physical cleanup. If a paused body remains, a tick listener holds the busy lock until body/model removal. Existing tests cover timeout, seated cleanup and busy release after resuming.
2. A process crash bypasses `finally` and loses the WeakSet and cleanup listeners. The probe's reserved identity persists in accepted birth/checkpoint data. No startup retirement sweep was found. A restored probe mind makes a fresh verification refuse `verify.busy`; it does not autonomously disappear. Reserved-prefix Brain and pairing guards still prevent paid model work/pairing after restart.
3. There is a gap between inserting the Soul database row and accepting birth. An asynchronous birth rejection after a crash can leave an unretired row without a live mind. There is no startup row-to-birth/probe reconciliation in the reviewed paths.
4. `Souls.retire` marks the row retired before awaiting queued retirement acceptance. A crash or enqueue failure between these operations needs durable reconciliation; the row alone does not prove body/controller removal. In-process cleanup failure only waits for later body removal; it does not retry a failed retirement enqueue.
5. `await created.ready`, relocation acceptance and `await retired` are not themselves wrapped in the request's wall-time deadline. A halted/non-draining host can therefore exceed the nominal timeout before reaching the later bounded wait.

These are handoff findings for the probe worker, not implemented recovery claims. The blocked-entry test now first asserts the new admission refusal, then explicitly seeds a legacy sealed fixture to retain the verifier's negative navigation coverage; production probe implementation is unchanged.

## Other audit findings / scope limits

- Per-token limits are process-local and reset on restart. They limit each authorized agent, not the owner's combined token pool. Creating many tokens remains an owner/admin capability.
- SSE has no per-token connection cap; its existing array of write promises is retained for the stream lifetime. Pairing/token/prayer retention and the separate accepted engine-event log are outside the new creation-journal quota. The world owner needs an archival policy before the journal ceiling is reached.
- Mesh sidecar adjacency inference cannot prove full physical connectivity inside every irregular mesh. The new guard protects the short exterior approach and the declared door/stair room graph; it is not an all-world pathfinding certification. The native furnished-room test supplies a separate route check for all 167 authored rooms.
- Tilt slicing remains conservative at its eight-slice cap. It approximates pitches/rolls using supported yaw boxes rather than adding a new collision representation.

## Validation and skill handoff

Before edits: brief reports god 124/124, compiler 72/72, catalog 30/30, CLI/lib 59/59. Generators were measured before edits at 18/18. Final reviewed gate: **god 131/131, compiler 87/87, catalog 30/30, generators 21/21, CLI/lib 59/59**, all three typechecks and skill bundle freshness pass; zero failures/skips/cancellations. Stable receipt: [SAFETY-GATE-20261015.json](SAFETY-GATE-20261015.json). Full log location and item/file inventory are in `STATUS-AGENT.md`.

`tools/god-gate.mjs` runs only the requested focused suites, three package typechecks and the skill bundle freshness check, each under `nice -n 10`, with one count summary per suite and nonzero exit on any failure. Default selects installed Node 22.20; `GOD_GATE_NODE` is an explicit diagnostic override. This sandbox's Node 22.20 exits on JavaScript execution with `SecItemCopyMatching failed -67674`; verification uses working Node 26.8.2. macOS also denies `setpriority`, though each `nice` invocation continues and runs its suite. No Node-22 or lowered-priority pass is claimed.

Suggested skill text (lead-owned skill/reference files were not edited):

> Read `GET /v1/god/schema` → `limits` before construction. `architecture.sealed` names the building, room and opening whose final exterior route your solid would block. Move the solid clear and leave a body-width approach (default 0.75 m wide for 1.5 m outside an opening), or preserve another usable exterior entrance. `budget.world` and `budget.region` include `field`, `measured`, `limit` and a repair; reuse definitions/assets, split large expansions, remove unnecessary entities or spread dense solids across 16 m cells. Cosmetic edits can preserve legacy overlaps, but increasing penetration or creating a new overlap still refuses. Expensive endpoints return HTTP 429 `rate-limited`; honor `Retry-After`. Preview payloads require a god token. A failed verification with `probe.removed:false` requires confirmed native cleanup; do not treat it as successful proof.

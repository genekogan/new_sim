# Mars World alpha performance audit

## Executed bounded pass — published release40, 2026-10-02

Measurements target the exact frozen published40 source05370e8c, Workerbb946d3c,
served small-JS hashes verified against its frozen build. They are published40
observations, not an alpha publication claim. Canonical release/source/rollback
remain in [release checklist](../RELEASE_CHECKLIST.md). All browser/performance
execution was serialized; assets, quality and physical outcomes stayed unchanged.

| Context | Cold transferred / ready | Ordinary warm transferred / ready | Interpretation |
| --- | --- | --- | --- |
| Design studio, isolated Chromium |3.47MB /3.63s|5.2KB /2.60s|27cached responses;3strict resets within original resource ceilings|
| Living-day studio, isolated Chromium |3.33MB /2.90s|2.5KB /2.61s|27cached responses; actualPlay advances fixed ticks without violations|
| Historical2022, isolated Chromium |14.27MB /6.11s|Not measured|Cold backdrop/request graph only|
| Campus2026, non-persistent Chromium |48.88MB /10.63s|38.51MB /9.95s|Large38.5MB compressed model downloaded again; retained finding|
| Campus2026, fresh persistent profile |Model38.5MB /11.53s|Model0B /9.51s|Same-version model fromDiskCache true; no cache-size override|

Transfers are CDP encoded-length observations including response overhead; ready
is browser asset/adaptive-resolution readiness, not Worker startup. Byte-hashes
for large assets remain inherited verified manifest evidence; no audit model-body
materialization. Fresh context isolates cache; ordinary warm reload never disables
or artificially enlarges it. Persistent probe uses its own ignored profile, never
Gene's browser. One dependency-path launch failed before any page/request; retained
separately, not counted as a passing observation.

The context distinction matters: [Playwright's non-persistent contexts](https://playwright.dev/docs/api/class-browsercontext)
do not write browsing data to disk. Persistent-profile proof demonstrates effective
repeat-visit model delivery here, without assuming every browser/cache policy will
retain a large object. Current model URL revision20260922b and manifest keys are
unchanged across38/40; stable URLs must receive a revision bump when model bytes
change. Do not make stable model paths immutable. HTML revalidates; hashed JS
uses long-lived caching; R2 model streams use one-hour ETags/Brotli/ranges.

8s SwiftShader windows: design studio218paused/210Play frames,33.4ms median and
~50ms p95 RAF intervals; living-day139/139frames,66.6/66.7ms. Campus2026 rendered
24frames/~416.6ms intervals with1354calls/880566triangles. These are CPU software
rendering observations, not Gene's hardware FPS. Rendered-frame counts are separate
from RAF intervals and authoritative fixed ticks. Heap samples varied (no forced
GC/native-GPU-byte measurement); they do not establish a long-run memory plateau.
No frame/bundle/mesh optimization is justified by these isolated measurements alone.
Existing route chunk splitting works; largest frozen chunk727549B, shared Three
module/core343807/280284B are separate modules, not established duplication.

Material repairs completed in the alpha candidate: world-owned transient component
geometries, campfire stone/log geometries, historicalLineSegments, cutting blades
and paint-overlay image leases now release at the correct lifecycle boundaries.
Native disposal/alias/late-load/repeated-world regressions pass; actual strict
Play/Reset counters pass on construction, fire, meal, solar and historical worlds.
No claimed FPS gain; no original assets, attribution or historical values changed.
Verified upload-cache reuse already avoids8same-key R2 writes at release40.

Direct Worker MCP/security integration36tools PASS. Observed representative remote
wall times: rehearsal561ms, execution496ms, camera819ms; these include network and
are not CPU. Printed operation elapsed0 is unusable for CPU accounting: synchronous
engine-room timing usesperformance.now(), and [Cloudflare's production timers](https://developers.cloudflare.com/workers/runtime-apis/performance/)
advance only after I/O. Local workerd/native measurements remain separate. Existing
isolated stress and historical-grid budgets PASS unchanged (exact stress mean
~.688ms; all6year grid builds<1000ms), pinned state/zero violations. Production
platform CPU distribution remains unknown; no inferred zero or billing estimate.
Release40's135ms Wrangler startup remains a deployment statistic.

Ignored exact receipts in alphaWT viewer/.cloudflare: performance-alpha/
release40-baseline/result.json; release40-campus-cold-warm/result.json;
release40-campus-persistent-fresh/result.json; performance-alpha-release40-server.log;
alpha-perf-stress-budget.log. Harness hashes/browser/profile/timestamps/requests
and captures retained. Root inspected the warm campus, design-studio and
living-day captures against paired measurements; no missing scene or major visible
support/continuity issue. These capture observations do not establish anatomical
precision or social quality. Final alpha gate/publication remain pending.

Deferred: broad dirty-render/parsed-model caching, scenario chunk refactoring,
texture/mesh reductions and productionCPU observability changes. Current assets
are accepted; profiling did not establish a bounded low-risk material frame fix.
Gateway modelHEAD-length limitation remains unchanged and explicit.

## Earlier preparation — dated source/provenance, superseded by executed pass


Audit source: `b7128256a196cd0a4a9d7eef422e51d3a9e68d39`, isolated
`codex/performance-alpha` worktree. Inspected 2026-10-02. Public evidence belongs
to release38 functional source `5f1dc2edc90888f8470fc50e14ca3db1cef4ae4d`,
Worker `7616e47a-9149-4b71-ba14-2ea8e5bc6660`. Release39's serialized gate
was running during this audit. No new browser, benchmark, stress, full gate,
large download, build, deployment or functional change was performed.

The only confirmed substantial waste is eight identical R2 uploads when a fresh
worktree lacks its local upload cache. Root already plans to copy the verified
cache for release39. Two runtime candidates merit measurement; source alone does
not justify changing them. Original assets and quality remain intact.

## Delivery and saved evidence

Ignored receipts are in `viewer/.cloudflare/performance-alpha/` in this worktree:
`network-headers.json`, `curl-headers.json`, `brotli-head.json`,
`bundle-source-observations.json`, and `audit-summary.json`. These record source,
URL, timestamps, transport, headers, published manifest hashes and limits.
Initial Python-agent requests returned 403; that evidence is retained. Subsequent
ordinary curl succeeded. The transport difference was not diagnosed as an origin
outage. No credentials or cookies were used.

Curl checks at 14:34:05–14:34:09 UTC and the clean Brotli HEAD at 14:35:10 UTC:

| Check | Observed result | Boundary |
| --- | --- | --- |
| Worker browser GLB identity HEAD | 200; 70,772,556 B; `public, max-age=3600, no-transform` | Metadata only |
| Worker browser GLB Brotli HEAD | 200; 38,494,104 B; `Content-Encoding: br`; same one-hour policy | Clean single encoding header; no content GET |
| Worker conditional browser HEAD | 304 with actual ETag | HTTP validator path, not browser warm-cache proof |
| Gateway browser GLB HEAD | 200; missing Content-Length | Existing assertion failure retained; gateway ownership unavailable |
| Gateway modular GLB HEAD/range | 126,892,472 B; 206 with 12-byte GLB-v2 header | Only 12 body bytes read in the entire audit |
| Gateway Lab HTML / hashed main JS HEAD | `no-cache` / one-year immutable | No actual browser request graph or downloaded byte measurement |

The earlier duplicate encoding-header probe was inconclusive; the clean Brotli
probe supersedes only its encoding interpretation, not the retained receipt.

`deploy/prepare.py` maps eight large assets to content-hash R2 keys; public model
URLs remain stable. `deploy/downloads.mjs` streams bodies, negotiates Brotli only
without Range, supports identity byte ranges and conditional ETags, and serves
one-hour public model cache headers. Hash-key freshness is not versioned browser
URL freshness. Blindly making stable model URLs immutable could retain old bytes
across a future asset update. Current release38/39 large keys are unchanged; this
is a future constraint, not an observed freshness defect.

Published release38 receipts in the integration worktree record 522 Worker static
assets, 24 HTML routes and 696 network checks PASS; MCP36 and director9 PASS.
Director wall time was 8,991 ms; operation CPU timing was unavailable. Wrangler's
136 ms startup is a deployment dry-run statistic, not browser readiness or Durable
Object request CPU. The original gateway HEAD-length failure remains explicit.

## Three bounded candidates

1. **Confirmed, already addressed operationally: duplicate large uploads.**
   `deploy/upload.mjs` trusts only `.cloudflare/uploaded.json`, with no remote
   existence probe. The saved release38 upload log records eight re-puts of the
   same accepted hash keys after a fresh worktree had no cache. Verify copied
   release39 keys against its exact large-assets manifest before upload. Do not
   infer billing or elapsed-time savings, or add a remote upload framework now.
2. **Unmeasured: idle visible-frame and HUD work.** `app/lab/lab-view.ts` keeps
   rendering visible paused/completed worlds: spatial/pose/fixture synchronization,
   overlays, WebGL and CSS labels; `app/lab/page.tsx` refreshes UI every 250 ms.
   Engine stepping already stops when paused, hidden-document frames already skip,
   and activity attention is tick-bound rather than recomputed every frame.
   Measure paused versus Play traces before considering a bounded dirty-render
   change. Preserve orbit controls, cameras, async model arrivals, resize, observed
   current poses/markers and reset cleanup. No current frame-time benefit is proved.
3. **Unmeasured: Lab startup composition.** `app/main.tsx` already lazily splits
   major routes. Lab's scenario registry eagerly imports many families. Saved
   release38 build artifact `page-ryuPjbdS.js` is 661,374 B (188.16 kB build-log
   gzip); main is 213,438 B (67.06 kB gzip). These are artifact sizes, not a cold
   download graph, parse-time measurement or promised savings. Record actual
   coverage/readiness before proposing a small scenario-family split; synchronous
   factories and hooks constrain such a change. No blanket chunk-warning fix.

## Lifetime and server constraints

`lib/three-resources.ts` owns and disposes geometry/material/texture/skeleton
resources and ImageBitmaps, rejects late aborted loads, and supports idempotent
cleanup. Lab disposal aborts loads, cancels RAF, removes subscriptions and tears
down views/renderers. Imported workstation appearances have per-instance abort
and resource ownership; resets can repeat parsing even if HTTP bytes are cached.
A parsed-model cache trades retained memory for parse work; defer it unless traces
show material cost. Do not replace original assets or rigs.

The published repeated-reset test `e2e/workstation-appearance.spec.ts` checks
geometry/texture counters after three delayed resets and a scenario switch; its
release38 gate row passed (6.4 s). Download/upload/resource/main/Lab-view sources
and this test have no diff between the published functional source and audit
source. This is inherited regression evidence, not a fresh measurement. Counters
alone do not prove JS heap/native GPU byte stability or a long-run memory plateau.

`simulation/engine-room.ts` caches controllers and content-addressed history,
flushes only pending storage and bounds plans/takes. Its operation `elapsedMs`
excludes later storage flush work; `loadMs` covers lazy loading. Neither is complete
platform CPU billing. Network latency, missing timing metadata and printed zero
fallbacks must not be treated as zero CPU. Existing opt-in runtime profiling and
`deploy/perf-stress.mjs` were inspected, not executed. Historical planning-budget
numbers are not current alpha measurements.

## One serialized measurement pass, pending root authorization

After release39 public verification, freeze the exact published source/version,
browser/GPU, viewport/DPR and network conditions. Root owns timing slot and backend
scope. Keep original assertions and assets; collect a compact receipt rather than
run an overlapping stress lane.

- Cold versus warm same-URL loads: explicit cache state, request/resource timings,
  transferred/encoded bytes, validators/cache attribution, load-to-hook/asset-ready
  and first rendered frame. Separate network, decode, JS work and render readiness.
  Include a small Lab and a representative busy existing scene; do not extrapolate
  all-campus performance from one view.
- Actual Play versus paused same world: short bounded recordings, median/p95 frame
  intervals, long tasks, render calls/triangles and existing engine tick costs.
  Attribute spatial, posing, overlays, UI and drawing work before changing code.
- Repeated reset/route switches: existing strict resource regression, then bounded
  heap/counter samples with sampling/GC limitations documented. Native GPU memory
  is unknown when unavailable; stable counters are supporting evidence only.
- Server: separately collect network wall time and available operation/load/storage
  metrics from root-approved representative calls. Full platform CPU requires
  appropriate observability owned by root; missing metadata remains unknown.

Only a measured dominant cost warrants a functional follow-up. Defer broad
caching, planner, renderer, bundle, pooling and allocation micro-optimizations.
No gateway/DNS/private credential work is authorized. Future workshop drafts stay
unverified/deferred and were not resumed by this audit.

## Validation and disposition

Initial docs-only audit: source reads, saved-receipt inspection, small unauthenticated HTTP
metadata/range checks, explicit source-inheritance diff and `git diff --check`.
No TypeScript/test run was appropriate for that initial Markdown-only checkpoint. Runtime
cold/warm/frame/memory/server performance remains unmeasured pending the serialized
pass. No functional recommendation is approved or implemented here.

## Prepared executable harness (not executed)

`viewer/deploy/performance-alpha.mjs` is separate from the app and normal gate.
Its default/`--plan` path only prints the plan; Chromium is dynamically imported
and launched only with explicit `--execute`. Root must grant the serialized slot
after publication. No functional optimization has been added.

The execution contract requires a full published SHA matching supplied deployment
metadata, the frozen deployed Vite build and its large-assets manifest. It records
input hashes, harness SHA/source, publication version, timestamps and browser/GPU
profile. Operator-supplied publication provenance is explicit: HTTP does not
independently attest a Worker version. Existing body content hashes for large
models stay inherited manifest evidence. The script verifies already-fetched
small same-origin JS response hashes against the frozen build and refuses missing
fetched asset scripts; it never fetches GLBs just to hash them.

Fixed scope is two Lab worlds, `design-studio` and `living-day-studio`, each with
one isolated cold context followed by an ordinary warm reload in that same
context. No route interception or cache bypass is used. CDP cache-disabled is
explicitly false. Request receipts retain server headers, validators, disk-cache/
service-worker flags, timings and encoded transfer lengths alongside Resource
Timing (whose zero values can reflect cache/TAO restrictions). Readiness separates
DOMContentLoaded, actual hook-render readiness, backdrop/imported appearance
readiness and network-idle wall times. These are observation milestones, not CPU.

Warm worlds sample eight seconds paused, start ordinary notes/connected-day
controls, and sample eight seconds of actual Play through UI buttons. No fixed
ticks are injected. Paused ticks must stay fixed, actual Play must advance, and
errors/violations must stay clear. RAF scheduling intervals and median/p95 are
reported separately from rendered hook-frame deltas, renderer calls/triangles,
long tasks and optional JS heap. The profile is fixed 1280×800/DPR1, headless,
reduced motion; SwiftShader is default to match existing tests. Explicit native
renderer is a separate profile whose results must not be treated as equivalent.

Design studio adds three ordinary resets against a fresh same-world baseline,
with the original strict geometry/texture ceilings and zero violations. This does
not replace or claim execution of the existing delayed-load regression. The final
isolated museum cold visit is `/studio/2022` once, waits for real scene frames and
adaptive pixel ratio, and records a short static sample. There is no second cold
museum, warm museum or stress loop. Aggregate encoded data observed is capped at
300 MiB by stopping the context without retry; bytes in flight may exceed that
threshold slightly. Each visit has JSON, PNG and a11y receipts; failure evidence is
saved, and output directories with an existing result cannot be overwritten.

Run from `viewer/` only after root supplies the exact newly verified release inputs:

```sh
node deploy/performance-alpha.mjs --execute --base https://sim.mars.college \
  --deployment /absolute/verified/deployment.json --source FULL_PUBLISHED_SHA \
  --build-root /absolute/frozen/viewer/dist \
  --large-manifest /absolute/frozen/viewer/.cloudflare/large-assets.json
```

Preparation checks: `node --check`, safe `--plan`, focused oxlint and oxfmt checks,
and diff check PASS. This harness is authored and statically checked, not browser
validated. Its practical timings/tool compatibility will be diagnosed in the
single authorized baseline pass; no automatic retry or blanket timeout change.
No backend calls or server CPU sampling are hidden in this browser harness.

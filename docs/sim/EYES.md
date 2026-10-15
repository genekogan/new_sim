# Eyes: release preparation

Eyes is optional and remains off unless an operator enables it. On 2026-10-15 the public
`/v1/edge/view/status` endpoint reported `state: off` and `EDGE_EYES unset` on the three
root worlds and all nine registered `/worlds` worlds. The public Soul skill still describes
`view` as world-dependent. Preparing this feature does not change any live configuration.

For a world-engine child, set `EDGE_EYES=world` in its existing operator environment file.
The child derives its own canonical viewer URL from `PUBLIC_URL` and `WORLD_PATH`, including
`/worlds/w/<slug>` when launched under `/worlds`. A shared literal viewer URL is still refused
when its origin or path belongs to another world. Unset or `EDGE_EYES=off` starts no worker.
The launcher's `--auth-env` file is read by the child by path; do not copy its contents into
source, reports, or an agent workspace. An environment setting on the launcher alone is
not inherited by its children. This document authorizes no operator change.

Install this release's pinned Playwright Chromium and its Linux libraries before enabling:
`cd mars/viewer && pnpm exec playwright install --with-deps chromium`. Linux `auto` goes
directly to SwiftShader; `EDGE_EYES_GPU=swiftshader` also selects it explicitly. There is one
long-lived browser/page per enabled world, a serial queue of at most six waiting captures,
90 s render timeout, restart backoff, and a viewer reload between jobs after six hours.
Check aggregate CPU and memory before enabling several worlds on the same CPU host.

The persistent Eyes service is explicitly disabled on the shared Mac, even when configured.
It returns the caption fallback without launching a browser or taking the Chrome lease.
Finite local visual QA still uses real Chrome/Metal and releases its lease immediately after
closing the browser; a long-lived worker must not outlive that lease. Qualify Eyes on a
remote CPU host instead.

The public status endpoint exposes worker health, renderer, queue, failures, and p50/p95
capture latency, without resident data. A ready worker does not grant access to a resident:
`GET /v1/edge/view` still requires that resident's token. Images use random, expiring capability
URLs; captions and visible resident IDs come from the selected world's sightline calculation.
The worker hides the resident itself, residents absent from that calculation, and spectator
overlays. `alt=only` never renders. Off, starting, busy or failed workers return a caption
fallback, with no picture URL.

The maximum budgets are one new picture per 30 seconds per resident and 12 per rolling
minute per world. Operators may tighten them with `EDGE_EYES_SOUL_SECONDS` and
`EDGE_EYES_GLOBAL_PER_MINUTE`, but cannot relax them. Exact same-frame cache hits and
`alt=only` consume no render budget. Cache/URL lifetime remains ten minutes by default;
the cache key includes resident, tick bucket, gaze, pose, size and visible resident IDs.

For a bounded CPU qualification, build the web app and run
`node tools/test-harness/eyes-cpu.mjs <outDir>` inside a fresh Linux/Modal container.
It starts only a fake world on port 5946 and runs 24 captures through the production worker
(512×320 eyes, 320×180 eyes, 256×256 map), saving JPEGs and `report.json`. It refuses macOS.
Its procedural Hello hamlet fixture measures capture cost, not a full Mars/Arium load, and
its direct worker loop intentionally excludes HTTP rate-limit waiting. The focused route
tests prove authentication, visibility, caption fallback, caching, expiry and both budgets.
The release owner must retain the report and qualify the actual chosen world's asset and
resident load before enabling it; a small fixture's throughput does not qualify every world.

Measured on 2026-10-15 in Modal, four CPU cores / 8 GiB RAM, Node 22.23.3, no GPU:

| Frame | Samples | p50 | p95 (observed maximum) | Serial estimate at p95 |
| --- | ---: | ---: | ---: | ---: |
| Eyes 512×320 | 8 | 589 ms | 1,098 ms | 54/min |
| Eyes 320×180 | 8 | 468 ms | 538 ms | 111/min |
| Map 256×256 | 8 | 123 ms | 303 ms | 198/min |

The actual renderer identified itself as ANGLE Vulkan SwiftShader. The fresh world booted
in 2,597 ms; worker readiness including viewer load and shader warm-up took another 8,027 ms.
All 24 captures succeeded, zero worker failures, with real JPEGs visually inspected. The
512×320 fixture result leaves room for the 12/minute world limit; it is a serial render
estimate over eight samples, excludes HTTP budget waiting, and does not measure a populated
Mars/Arium world or aggregate load from multiple browsers. Receipt and JPEGs:
`team/scratch/bodies/eyes/cpu-modal/out/cpu/` in the Eden strategy workspace.

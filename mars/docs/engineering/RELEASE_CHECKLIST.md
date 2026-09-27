# Release checklist: Mars Studio Worker (`mars-campus-2026`)

Prepared 2026-09-27 against HEAD `19aa5b6`, with the `prepare.py` allowlist change committed
alongside this file. **Nothing has been deployed.** This file covers the release build, the
dry run and a local smoke of the built worker. The production deploy is left for Gene to run.

- Worker: `mars-campus-2026` at https://mars-campus-2026.<workers-subdomain>.workers.dev
- R2 bucket: `mars-campus-2026-models`
- Wrangler: 4.136.2 (repo-pinned). Auth uses the existing OAuth login; never read credential files.
- Procedure source: `viewer/deploy/README.md`

## Release gate (required before deploying)

A deploy must start from a green `npm run gate` report (run from `viewer/`). The gate runs, in
order: `npm test`, `npm run test:engine`, `npx tsc --noEmit -p .`,
`npm run e2e -- --workers=1`, `node deploy/determinism-probe.mjs`, and
`deploy/simulation-integration.mjs` too when `SIM_BASE` is set. It stops at the first failure
(`npm run gate -- --continue` runs every step) and exits non-zero if any step fails.

- Report: `viewer/.cloudflare/gate/<ISO timestamp>/report.json`, with one `<step>.log` per step
  in the same folder (gitignored). Each step records pass/fail, duration and its parsed summary.
  The top level records `ok`, `gitHead`/`gitDirty` and the probe's `finalStateHash`.
- Before deploying, check that `ok: true`, that `gitHead` matches the commit you are deploying
  with `gitDirty: false`, and that `finalStateHash` matches the previous release unless the
  engine change was intended to move it. Record the report path under Results.
- With each release, regenerate the milestone evidence report (`npm run evidence` from `viewer/`,
  ~1 min) and commit `docs/engineering/EVIDENCE.md` + `evidence.json`; it exits non-zero if a test
  cited in `viewer/engine/test/evidence-map.json` was renamed or removed. It is not part of the gate.

## Rollback target (record before deploying)

| Source | Version id |
|---|---|
| `wrangler deployments status` (live, 100%, created 2026-09-26T22:45Z) | **`de2dddaa-0fab-477c-8b8f-cb1c579efba5`** |
| `viewer/deploy/deployment.json` `version` | `763de986-3bdd-4947-a335-226f28a8ed79` (**stale**: 20:20Z deploy, superseded by `11817b82…` and then `de2dddaa…`) |

Roll back to **`de2dddaa-0fab-477c-8b8f-cb1c579efba5`**. After the new deploy, update
`deployment.json` so its `version` field holds the new id.

## Deploy (from `viewer/`)

```sh
# 0. Only if the browser model must be rebuilt (not needed this release; public/browser/campus.glb{,.br} exist, 2026-09-22)
#    python3 deploy/browser-model.py && node deploy/compress-browser.mjs
# 1. Stage the allowlisted public release (.cloudflare/public, .cloudflare/large, manifests) — engine/** and other asset dirs are glob rules; `npm test` (deploy/prepare-allowlist.test.mjs) fails if app/engine reference an unstaged asset URL
python3 deploy/prepare.py
# 2. Release build (vite with publicDir=.cloudflare/public, then deploy/configure.mjs → dist/server/)
CLOUDFLARE_RELEASE=1 npm run build
# 3. Large objects → R2. Resumable and content-hash keyed. Currently a no-op (see below).
WRANGLER_WRITE_LOGS=false node deploy/upload.mjs
# 4. Optional last check
WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler deploy --config dist/server/cloudflare.json --dry-run --outdir /tmp/mars-dry
# 5. Deploy
WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler deploy --config dist/server/cloudflare.json
# 6. Post-deploy verification
SITE_BASE=https://mars-campus-2026.<workers-subdomain>.workers.dev ALL_ASSETS=1 node deploy/smoke.mjs
SIM_BASE=https://mars-campus-2026.<workers-subdomain>.workers.dev node deploy/simulation-integration.mjs
WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler deployments status --name mars-campus-2026
```

R2 upload status: after staging, all 8 large objects in `.cloudflare/large-assets.json` are
already recorded in `.cloudflare/uploaded.json`. The large-asset manifest is byte-identical to
the previous release, so `upload.mjs` will skip every object (`Already uploaded`). The objects:
`/browser/campus.glb(.br)`, `/modular/{campus,chiba}-components.glb`,
`/modular/mars-2026-modular.blend`, `/data/campus.{glb,blend}`, `/data/chiba.blend`.

## Rollback

Syntax taken from `wrangler rollback --help` and `wrangler versions deploy --help` (4.136.2):

```sh
cd viewer
WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler rollback de2dddaa-0fab-477c-8b8f-cb1c579efba5 \
  --name mars-campus-2026 -m "rollback: <reason>"
# equivalent, via versions (100% traffic to the prior version):
WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler versions deploy de2dddaa-0fab-477c-8b8f-cb1c579efba5@100 \
  --name mars-campus-2026 -m "rollback: <reason>"
# inspect
./node_modules/.bin/wrangler versions list --name mars-campus-2026
./node_modules/.bin/wrangler deployments list --name mars-campus-2026
```

A rollback restores the Worker code and its static assets. It does not undo Durable Object
storage writes or R2 objects. R2 keys are content-hashed, so the old version's large files are
still present. The new release adds no DO migration: `migrations` still lists only
`simulation-v1`. `engine_blobs` is created lazily by the engine code in the DO. Rolling back
leaves those rows unread; they do no harm.

## Allowlist change in this release

`deploy/prepare.py` previously staged no `engine/` namespace. As a result,
`/engine/campus-2026.json` (the browser fetch URL `CAMPUS_2026_URL` in `engine/campus/load.ts`)
would 404 in production. Added one allowlist line: `'engine': ['campus-2026.json']`. The file
passes through `scrub()` (no `/Users/` or localhost strings are present) and is re-serialized
(982,684 → 1,081,647 B; static asset, under 25 MiB). `/lab` itself only needs
`/modular/environment/animated-*.glb`, which the existing `environment/` rglob already covers.
Release: 304 files, 788.4 MiB staged (8 large → R2).

## Results (2026-09-27, local)

**Build.** `CLOUDFLARE_RELEASE=1 npm run build` exited 0. The only warning is the known
three-resources chunk over 500 kB.
- `dist/client`: 187 MB, 312 files. The largest JS chunk is `three-resources` at 679 kB
  (173 kB gzip).
- Worker: `dist/server/simulation.js` 3.25 MB and `cloudflare-entry.js` 2.8 kB. The bundled
  dry-run output is 3.36 MB (`/tmp/mars-dry/cloudflare-entry.js`).
- `/lab` and `/lab/` appear in the SPA route list in `dist/server/cloudflare-entry.js`,
  alongside `/`, `/studio`, `/studio/202x` and `/simulation-guide`.
- `dist/client/engine/campus-2026.json` is present.

**Dry run.** `wrangler deploy --dry-run --outdir /tmp/mars-dry` exited 0. It read 331 asset
files. Total upload 3285.64 KiB (676.33 KiB gzip). Bindings: `SIMULATIONS`
(DO `MarsSimulation`), `MODELS` (R2 `mars-campus-2026-models`), `ASSETS`.

**Local smoke.** Ran `wrangler dev --config dist/server/cloudflare.json --port 8901`. The
server was stopped afterwards.

| Path | Status | Content-Type | Bytes |
|---|---|---|---|
| `/` | 200 | text/html; charset=utf-8 | 579 |
| `/studio` | 200 | text/html; charset=utf-8 | 579 |
| `/studio/2020` | 200 | text/html; charset=utf-8 | 579 |
| `/lab` | 200 | text/html; charset=utf-8 (Cache-Control: no-cache, X-Robots-Tag: noindex) | 579 |
| `/simulation-guide` | 200 | text/html; charset=utf-8 | 579 |
| `/simulation-agent-guide.md` | 200 | text/markdown; charset=utf-8 | 19,520 |
| `/engine/campus-2026.json` | 200 | application/json (parses; keys schema, campus, generator, …) | 1,081,647 |
| `/assets/*.js` | 200 | text/javascript; immutable cache; nosniff | n/a |
| `/nope` | 404 | n/a | n/a |
| `/browser/campus.glb` | 404 "Model unavailable" (expected locally: the local R2 is empty) | n/a | n/a |

`SIM_BASE=http://127.0.0.1:8901 node deploy/simulation-integration.mjs` exited 0 and printed
two PASS lines. The first covers the MCP handshake, 20 legacy tools, 9 engine tools
(bind/rehearse/execute/take/camera), room isolation, read-only access, invalid camera,
idempotency, walking, activities, pause and persisted state. The second covers auth before
body parsing, method limits, prototype keys and body-size limits. Engine timings in DO:
rehearse 269 ms, execute 230 ms, camera 245 ms; take 33,656 B.

**Tests.** `npm test` passed 48/48. `tsc --noEmit -p .` is clean. `npm run test:engine` has
**1 failure that predates this change** at HEAD: `engine/test/progressive.test.ts:100`, test
"progressive floor: after 1 of 2 sheets only the installed sheet is walkable". The assertion
"standing on the deck (y 1.949…)" fails and the failure reproduces in isolation. The MCP
integration run above still passed. Nothing in this commit touches engine code.
Decide whether to fix it before deploying.

## Production deploy (2026-09-27)

Deployed from committed tree `2ecff4b` (code identical to `00337c6`; the extra commit is docs only).

- **New version: `d33a4d6b-d4ae-4535-a818-0e5c329e9b4f`** (replaces `de2dddaa…`, which was confirmed
  live at 100% via `wrangler deployments status` immediately before the deploy).
- Gates: `npm test` 48/48; `npm run test:engine` 127 tests, 126 pass / 0 fail / 1 skip (the
  `progressive floor` failure noted above is fixed); `tsc --noEmit -p .` clean; `npm run e2e --
  --workers=1` 26/26 (studio + lab + lab-build-bay; no baseline refresh needed).
- Build: `prepare.py` + `CLOUDFLARE_RELEASE=1 npm run build` exit 0; route list includes `/lab`,
  `/lab/`; `dist/client/engine/campus-2026.json` present (1,081,647 B). Dry run exit 0 (331 assets,
  3298.37 KiB / 679.69 KiB gzip). `upload.mjs`: 0 uploads, all 8 large objects `Already uploaded`.
  Deploy uploaded 11 new asset files (300 already present); startup 88 ms.
- Live smoke: `/`, `/studio`, `/studio/2024`, `/lab`, `/simulation-guide` 200 text/html;
  `/simulation-agent-guide.md` 200 (19,520 B); `/engine/campus-2026.json` 200 application/json
  (1,081,647 B, parses); `HEAD /browser/campus.glb` 200 model/gltf-binary from R2.
- `SIM_BASE=… node deploy/simulation-integration.mjs`: both PASS lines (MCP handshake, 20 legacy +
  9 engine tools, isolation, read-only, idempotency, …; auth/method/prototype/body limits). Engine
  in DO: rehearse 849 ms wall, execute 738 ms, camera 731 ms; take 44,806 B.
- Browser: the Playwright config has no base-URL override, so the specs were not run against
  production. A headless script opened `/lab?scenario=build-bay`, ran `runScenario('build-bay')` +
  `runToEnd`: tick 10553, done, all 5 expectations met (43/43 steps, zero violations, visitor on
  deck), 0 console errors, state hash `b42df0ac…c635`. Screenshot:
  `viewer/e2e/artifacts/prod-smoke/build-bay-end-oblique.png` (gitignored).

Rollback (from `viewer/`):

```sh
WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler rollback de2dddaa-0fab-477c-8b8f-cb1c579efba5 \
  --name mars-campus-2026 -m "rollback: <reason>"
```

## Production deploy 2 (2026-09-27)

Deployed from committed tree `6593a06` (clean `git status`). Contents: review fixes
(teleport/holder/load invariants), raise choreography, swept lifts, deterministic trig
(`engine/core/math.ts`).

- **New version: `6f1200ce-ed10-467b-8d7f-a683f91292db`** (created 18:49Z). It replaces
  `d33a4d6b-d4ae-4535-a818-0e5c329e9b4f`, which `wrangler deployments status` confirmed live at
  100% just before the deploy. `d33a4d6b…` is the new rollback target.
- Gates: `npm test` 48/48; `npm run test:engine` 142 tests (141 pass, 0 fail, 1 skip);
  `tsc --noEmit -p .` clean; `npm run e2e -- --workers=1` 26/26 in 5.1 min (no baseline refresh).
- Build: `prepare.py` staged 304 files (788.4 MiB, 8 large objects). `CLOUDFLARE_RELEASE=1 npm run build`
  exited 0 (only the known chunk-size warning). The route list includes `/lab` and `/lab/`, and
  `dist/client/engine/campus-2026.json` is present (1,081,647 B). Dry run exited 0 (332 assets,
  3325.93 KiB / 687.95 KiB gzip; bindings SIMULATIONS, MODELS, ASSETS). `upload.mjs` made 0 uploads
  (8 × `Already uploaded`). The deploy uploaded 7 new asset files (305 already present); startup 85 ms.
- Live smoke:
  - `/`, `/studio`, `/lab` and `/simulation-guide` returned 200 text/html.
  - `/simulation-agent-guide.md` returned 200 (19,520 B).
  - `/engine/campus-2026.json` returned 200 application/json (1,081,647 B, parses).
  - `HEAD /browser/campus.glb` returned 200 model/gltf-binary.
- `SIM_BASE=… node deploy/simulation-integration.mjs` printed both PASS lines. Engine timings:
  rehearse 1012 ms wall, execute 787 ms, camera 889 ms; take 44,806 B. The first attempt hit an MCP
  `REQUEST_TIMEOUT`. It ran at the same time as the headless browser run below. Run alone, it passed.
- Browser: a headless Chromium (SwiftShader) opened production `/lab?scenario=build-bay` and ran
  `runScenario('build-bay')` + `runToEnd`.
  - Result: tick 10918, done, all 5 expectations met (43/43 steps, 0 violations, visitor on level 4).
  - 0 console errors.
  - Screenshot: `viewer/e2e/artifacts/prod-smoke-2/build-bay-end-oblique.png` (gitignored).
    The first attempt timed out on `page.goto` 'load' at 30 s while the integration run was also
    going. The rerun used `domcontentloaded`; readiness is still gated on the hook.
- **Cross-host determinism in production:** the live lab's `window.__marsEngine.stateHash()` =
  `5c29efcf86065fa84f74f74dff1ae922d7ca1c2fa67962b4737d112c20391c96`. `node
  deploy/determinism-probe.mjs` gives the same `finalStateHash` on node 26.8.2, also at 10918 ticks
  (take `bf7c878a441a1667c2832d6d`). **They match.**

Rollback (from `viewer/`):

```sh
WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler rollback d33a4d6b-d4ae-4535-a818-0e5c329e9b4f \
  --name mars-campus-2026 -m "rollback: <reason>"
```

## Production deploy 3 (2026-09-27)

Deployed from committed tree `3f5ece7` (clean `git status`). Contents: crews accompany lifted parts
(`engine/construction/liftcrew.ts`), the `lift.hands-out-of-reach` invariant, `RULES_VERSION`
`mars-assembly/2` (`497e913`; plans bound under `/1` now report `plan.stale`), and the release gate
script (`npm run gate`).

- **New version: `17f7c9aa-84d1-437d-b1d6-287c85e553fe`** (created 21:13Z). It replaces
  `6f1200ce-ed10-467b-8d7f-a683f91292db`, which `wrangler deployments status` confirmed live at 100%
  just before the deploy. `6f1200ce…` is the new rollback target.
- **Gate:** `viewer/.cloudflare/gate/2026-09-27T21-06-25-559Z/report.json`: `ok: true`, `gitHead`
  `3f5ece7`, `gitDirty: false`. Results: `npm test` 48/48; `test:engine` 144 pass / 1 skip; `tsc`
  clean; e2e 26/26 in 275 s; determinism probe completed, `finalStateHash` `d54eca7c…f610` at 11522
  ticks. The hash moved from `5c29efcf…` on purpose: crews now walk during lifts, so the sequence runs
  longer (10918 → 11522 ticks).
- **Baseline refresh (`3f5ece7`):** the first gate run failed only on `build-bay-visitor-oblique.png`
  (2.74 % of pixels differed, above the 1.5 % limit). The held and raise captures stayed within
  tolerance. Visual review: the end state is unchanged (43/43 steps, 0 violations, deck complete,
  visitor on the deck). The idle crew stands in different places. Engine positions put nobody inside
  the stair or rack footprints; the nearest person is 0.30 m away. The baseline was refreshed with
  `npm run e2e:update-baselines -- -g build-bay --workers=1`, which rewrote only that PNG, and the
  gate was rerun green.
- **Build:** `prepare.py` staged 304 files (788.4 MiB, 8 large objects). `CLOUDFLARE_RELEASE=1 npm run
  build` exited 0 with only the known chunk-size warning. The route list includes `/lab` and `/lab/`,
  and `dist/client/engine/campus-2026.json` is present (1,081,647 B). The dry run exited 0 (332 assets,
  3336.26 KiB / 690.90 KiB gzip; bindings SIMULATIONS, MODELS, ASSETS). `upload.mjs` made 0 uploads
  (8 × `Already uploaded`). The deploy uploaded 6 new asset files (306 already present); startup
  85 ms.
- **Live smoke:** `/`, `/studio`, `/studio/2024`, `/lab` and `/simulation-guide` returned 200
  text/html. `/simulation-agent-guide.md` returned 200 (19,520 B). `/engine/campus-2026.json`
  returned 200 application/json (1,081,647 B, parses). `/nope` returned 404. `HEAD /browser/campus.glb`
  returned 200 model/gltf-binary from R2.
- **Integration:** `SIM_BASE=… node deploy/simulation-integration.mjs` printed both PASS lines. Engine
  timings: rehearse 1224 ms wall, execute 1081 ms, camera 775 ms; take 44,806 B. It ran on its own,
  before the browser run.
- **Browser:** headless Chromium (SwiftShader) on production `/lab?scenario=build-bay` ran
  `runScenario` + `runToEnd`: tick 11522, done, 5/5 expectations (43/43 steps, 0 violations, visitor
  on level 4), 0 console errors. Screenshot: `viewer/e2e/artifacts/prod-smoke-3/build-bay-end-oblique.png`
  (gitignored). Reviewed: it matches the new baseline.
- **Cross-host determinism:** the production `stateHash()` is
  `d54eca7c402a4c3a92ff82ed2466fd2e354cd9ded9ee0f01fa1bed8fc7f0f610`, the same value
  `node deploy/determinism-probe.mjs` gives (node 26.8.2, 11522 ticks, take `8f65762a1ec91b82ba4e93c0`).
  **They match.**

Rollback (from `viewer/`):

```sh
WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler rollback 6f1200ce-ed10-467b-8d7f-a683f91292db \
  --name mars-campus-2026 -m "rollback: <reason>"
```

## Production deploy 4 (2026-09-27)

Deployed from committed tree `9561854` (clean `git status`). Contents: studio take replay
(`/studio` "Replay take", with the engine-planned camera and scrubber), social vocabulary and the
campfire-evening lab scene, the review fixes M3/M5/M6 and DO caps, deterministic head-on passing,
the evidence report, and the gate.

- **New version: `89e65c8c-5abb-4377-a693-3689de30d465`**. It replaces
  `17f7c9aa-84d1-437d-b1d6-287c85e553fe`, which `wrangler deployments status` confirmed live at 100%
  just before the deploy. `17f7c9aa…` is the new rollback target.
- **Allowlist (`72bb2ad`):** `prepare.py` now stages `engine/takes/*.json` (manifest + flagship take)
  via one line. Without it, `/engine/takes/*` would 404 and the studio picker would be empty. The take
  is re-serialized by `scrub()` (1,424,001 → 1,615,368 B, content identical). The loader checks
  the schema, the camera/take id and the final-state hash, not the byte size.
- **Gate:** `viewer/.cloudflare/gate/2026-09-27T23-03-25-583Z/report.json`: `ok: true`, `gitHead`
  `9561854`, `gitDirty: false`. Results: `npm test` 48/48; `test:engine` 177 pass / 1 skip; `tsc`
  clean; e2e 28/28 in 306 s (studio 11, lab 13, lab-build-bay 2, lab-social 1, studio-take 1; no
  baseline refresh); probe `finalStateHash` `79447f75…6129` at 11403 ticks. A first green run at
  `72bb2ad` came before the evidence commit.
- **Evidence (`9561854`):** `npm run evidence` gave 17/17 rows and 8/8 milestones PROVEN.
- **Build:** `prepare.py` staged 306 files (789.9 MiB, 8 large objects). `CLOUDFLARE_RELEASE=1 npm run
  build` exited 0 with only the known chunk-size warning. The route list includes `/lab` and `/lab/`.
  `dist/client/engine/campus-2026.json` (1,081,647 B), `engine/takes/manifest.json` (926 B) and
  `engine/takes/flagship-campus-2026.json` (1,615,368 B) are present. The dry run exited 0 (335 assets,
  3399.28 KiB / 708.50 KiB gzip; bindings SIMULATIONS, MODELS, ASSETS). `upload.mjs` made 0 uploads
  (8 × `Already uploaded`). The deploy uploaded 13 new asset files (301 already present); startup
  77 ms.
- **Live smoke:** `/`, `/studio`, `/lab` and `/simulation-guide` returned 200 text/html.
  `/simulation-agent-guide.md` returned 200 (20,394 B). `/engine/campus-2026.json` returned 200 (parses).
  `/engine/takes/manifest.json` and `/engine/takes/flagship-campus-2026.json` returned 200
  application/json. `/nope` returned 404. `HEAD /browser/campus.glb` returned 200 model/gltf-binary
  from R2.
- **Integration:** `SIM_BASE=… node deploy/simulation-integration.mjs` printed both PASS lines, run on
  its own. Engine timings: rehearse 797 ms wall, execute 566 ms, camera 1127 ms; take 45,386 B.
- **Browser `/lab`:** headless Chromium (SwiftShader) on production `/lab?scenario=build-bay` ran
  `runScenario` + `runToEnd`: tick 11403, done, 5/5 expectations (43/43 steps, 0 violations, visitor
  on level 4), 0 console errors. Screenshot: `viewer/e2e/artifacts/prod-smoke-4/build-bay-end-oblique.png`.
- **Cross-host determinism:** the production `stateHash()` is
  `79447f7507797d3b2cfcb4ed01a1880538b06b4c36249a392b9f3f4c46f96129`, the same value
  `node deploy/determinism-probe.mjs` gives (11403 ticks). **They match.**
- **Browser `/studio`:** selected take `c531eaf4…`, then scrubbed to "held" (t 227.6 s) with the engine
  camera on (shot "orbit the raise"). 37/37 entities were drawn. The final-state hash equals both the
  recorded and the manifest hash (`b159317e…0bda`). The HYPOTHETICAL banner is visible and there
  were 0 console errors. Screenshot: `viewer/e2e/artifacts/prod-smoke-4/studio-take-held.png`. Reviewed:
  it matches the `studio-take-held` baseline (bay among the trailers, crew holding both frames).
  Note: `/studio` needs about 2+ minutes to become ready from this host because the 38.5 MB
  `/browser/campus.glb` downloads at about 310 KB/s. A 180 s wait timed out once, and the rerun with a
  600 s wait passed. This is a network cost, not a regression.

Rollback (from `viewer/`):

```sh
WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler rollback 17f7c9aa-84d1-437d-b1d6-287c85e553fe \
  --name mars-campus-2026 -m "rollback: <reason>"
```

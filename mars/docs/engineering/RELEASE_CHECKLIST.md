# Release checklist: Mars Studio Worker (`mars-campus-2026`)

Current deployment metadata is `viewer/deploy/deployment.json`; the latest dated production record below is authoritative. **Release 15 is live.** Initial preparation results and older rollback examples are retained as historical records; use the latest release record for the current rollback target.

- Worker: `mars-campus-2026` at https://mars-campus-2026.<workers-subdomain>.workers.dev
- R2 bucket: `mars-campus-2026-models`
- Wrangler: 4.136.2 (repo-pinned). Auth uses the existing OAuth login; never read credential files.
- Procedure source: `viewer/deploy/README.md`

## Release gate (required before deploying)

A deploy must start from a green `npm run gate` report (run from `viewer/`). The gate runs, in
order: zero-warning lint, `npm test`, `npm run test:engine`, `npx tsc --noEmit -p .`,
`npm run e2e -- --workers=1`, `node deploy/record-campus-take.mjs --check` (flagship only; historical chapters remain parked),
`node deploy/determinism-probe.mjs`, and `deploy/simulation-integration.mjs`.
Without `SIM_BASE`, the gate starts an isolated local Wrangler server and cleans up its process group; an explicit `SIM_BASE` targets that server. It stops at the first failure
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

Before a performance-affecting release, also run `node deploy/perf-stress-budget.mjs` on an otherwise idle host. It retains the original timing limits outside the concurrent engine test runner; deterministic work ceilings remain inside the full gate. Record this result with the gate table.

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

## Production deploy 5 (2026-09-28, session checkpoint)

Deployed from committed tree `d5d2f84` (clean `git status`). The gate ran at `26acb78`. The commits
after it (`71efed0`, `6ad36f0`, `d5d2f84`) change only docs and the regenerated evidence, so the code
is identical. Contents: pause/resume, `engine_edit_world` and the list/delete ops over MCP; forklift;
EUC/bicycle riders; social scenes; carrying loads on stairs; engine year scenes 2020–2025 and year rooms;
stable historical ids; camera occluders; region-local grid updates; renderer sit/hold poses; flagship v2.

- **New version: `cebd5827-b08d-4224-a320-afba968a1352`** (created 02:28Z). It replaces
  `89e65c8c-5abb-4377-a693-3689de30d465`, which `wrangler deployments status` confirmed live at 100%
  just before the deploy. `89e65c8c…` is the new rollback target.
- **Gate:** `viewer/.cloudflare/gate/2026-09-28T02-12-46-239Z/report.json`: `ok: true`, `gitHead`
  `26acb78`, `gitDirty: false`. Results: `npm test` 56/56; `test:engine` 243 pass / 1 skip / 1 todo (the
  known `campus-full.test.ts` todo: grid origin); `tsc` clean; e2e 37/37 in 385 s (studio-years 11,
  lab 13, lab-years 7, lab-build-bay 2, lab-social 1, lab-poses 1, studio-take 1, camera-verify 1; no
  baseline refresh); probe `finalStateHash` `79447f75…6129` at 11403 ticks (unchanged since deploy 4).
- **Evidence (`d5d2f84`):** `npm run evidence` gave 17/17 rows, 11/12 capabilities (1 PARTIAL) and
  8/8 milestones PROVEN.
- **Build:** `prepare.py` staged 312 files (791.8 MiB, 8 large objects). `CLOUDFLARE_RELEASE=1 npm run
  build` exited 0 with only the known chunk-size warning. The route list includes `/lab` and `/lab/`.
  `dist/client/engine/campus-2020…2026.json` (219–309 KB each for 2020–2025, 1,081,647 B for 2026),
  `engine/takes/manifest.json` (921 B) and `engine/takes/flagship-campus-2026.json` (2,038,943 B) are
  present. The dry run exited 0 (344 assets, 5119.02 KiB / 922.23 KiB gzip; bindings SIMULATIONS,
  MODELS, ASSETS). `upload.mjs` made 0 uploads (8 × `Already uploaded`). The deploy uploaded 20 new
  asset files (303 already present); startup 117 ms.
- **Live smoke:** `/`, `/studio`, `/lab` and `/simulation-guide` returned 200 text/html.
  `/simulation-agent-guide.md` returned 200 (28,275 B). `/engine/campus-2026.json` (parses),
  `/engine/campus-2022.json`, `/engine/takes/manifest.json` and `/engine/takes/flagship-campus-2026.json`
  returned 200 application/json. `/nope` returned 404. `HEAD /browser/campus.glb` returned 200
  model/gltf-binary from R2.
- **Integration:** `SIM_BASE=… node deploy/simulation-integration.mjs` printed all three PASS lines
  (§28 replay/fork/plan-invalidation through the room; MCP handshake + 20 legacy + 13 engine tools
  including pause/resume/edit/list/delete, and the 2022 year room; auth/method/prototype/body limits).
  Engine timings: rehearse(keep) 565 ms wall, execute 535 ms, attach camera 997 ms; take 46,642 B.
- **Director demo:** `node deploy/director-demo.mjs --base https://mars-campus-2026.<workers-subdomain>.workers.dev`
  exited 0: all 9 steps (53 calls) asserted, including step 9 pause → fork → resume both branches;
  total 7.4 s.
- **Browser `/lab`:** headless Chromium (SwiftShader) on production `/lab?scenario=build-bay` ran
  `runScenario` + `runToEnd`: tick 11403, done, 5/5 expectations (43/43 steps, 0 violations, visitor on
  level 4), 0 console errors. Screenshot: `viewer/e2e/artifacts/prod-smoke-5/build-bay-end-oblique.png`
  (reviewed: deck, stair and visitor on the deck).
- **Cross-host determinism:** the production `stateHash()` is
  `79447f7507797d3b2cfcb4ed01a1880538b06b4c36249a392b9f3f4c46f96129`, the same value
  `node deploy/determinism-probe.mjs` gives (11403 ticks). **They match.**
- **Browser `/studio`:** take `c531eaf4…` scrubbed to "held" (t 227.6 s), engine camera on (shot "orbit
  the raise"). 37/37 entities drawn; the final-state hash equals the recorded and the manifest hash
  (`b159317e…0bda`); HYPOTHETICAL banner visible; 0 console errors. Screenshot:
  `viewer/e2e/artifacts/prod-smoke-5/studio-take-held.png`. Reviewed: it is visually identical to the
  `studio-take-held` baseline.

Rollback (from `viewer/`):

```sh
WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler rollback 89e65c8c-5abb-4377-a693-3689de30d465 \
  --name mars-campus-2026 -m "rollback: <reason>"
```

## Production deploy 6 (2026-09-28, bleeding edge)

Gene authorised a production deploy of the bleeding edge ("pre-release, ok to break stuff"). Deployed by W34 from
committed tree `27e04f6` in a detached worktree (clean; the `.pw-browsers` symlink excluded through a scoped
`core.excludesFile`, no repo config change). Contents: the overnight tranche and checkpoint-1 work up to `27e04f6`:
hand-up + forklift, one body model, splined walking with no jumps, stair IK, the 2022 year build (phases A + B), paint
and solar, meals, fire, camera direction (`engine_direct_camera`), takes `mars-take/4`, studio "Watch it being built"
for 2022, and the flagship v3 take. **Not included** (landed on `main` during the gate): `0cd2f19` W32 prone model =
the measured rig (engine), `f350896` / `ce74ba0` W32 docs, `848b895` merge, `858946e` docs.

- **New version: `07dce638-2950-444f-823f-0e19b8f62320`** (created 16:28:17Z). It replaces
  `cebd5827-b08d-4224-a320-afba968a1352`, which `wrangler deployments status` confirmed live at 100% just before the
  deploy. `cebd5827…` is the new rollback target.
- **Gate:** `viewer/.cloudflare/gate/2026-09-28T16-12-39-722Z/report.json` in the W34 worktree (gitignored): `ok:
  true`, `gitHead` `27e04f6`, `gitDirty: false`. Results: `npm test` 56/56; `test:engine` 370 pass / 0 fail / 3 skip
  (373); `tsc` clean; e2e 64 passed / 1 skipped in 729 s (`--workers=1`, `E2E_VITE_PORT=5591`, no baseline refresh);
  probe `finalStateHash` `b746b0947e65…62e7f0c3` (= the "no walker jumps" pin; it moved from `79447f75…` on purpose
  overnight). Evidence was not regenerated in this release (W34's commit scope excludes `EVIDENCE.md`); the last run is
  the W26 one at `1395dd4`.
- **Build:** `prepare.py` staged 315 files (799.6 MiB, 8 large objects; `large-assets.json` byte-identical to release
  5). `CLOUDFLARE_RELEASE=1 npm run build` exited 0 with only the known chunk-size warning. The route list includes
  `/lab`, `/lab/`, `/studio`, `/simulation-guide`. `dist/client/engine/campus-2020…2026.json` and all five
  `engine/takes/*` files are present. The dry run exited 0 (356 assets, 5527.78 KiB / 1033.32 KiB gzip; bindings
  SIMULATIONS, MODELS, ASSETS). `upload.mjs` made 0 uploads (8 × `Already uploaded`). The deploy uploaded 26 new asset
  files (309 already present); startup 134 ms.
- **Live smoke:** `/`, `/studio`, `/studio/2022`, `/lab` and `/simulation-guide` returned 200 text/html.
  `/simulation-agent-guide.md` returned 200 (28,275 B). `/engine/campus-2026.json` (1,081,647 B, parses) and
  `/engine/campus-2022.json` (238,055 B) returned 200 application/json. `/engine/takes/manifest.json` (4,120 B; takes
  `d2f16bd3`, `64c3331c`; otherYears `b7b882fd`, `69c41651`), `flagship-campus-2026.json` (1,812,545 B),
  `build-bay-v3-campus-2026.json` (2,418,487 B), `year-build-2022-east-house-bay1.json` (1,543,958 B) and
  `year-build-2022-east-house.json` (4,451,737 B) returned 200 application/json. `/nope` returned 404. `HEAD
  /browser/campus.glb` returned 200 model/gltf-binary from R2. `SITE_BASE=… ALL_ASSETS=1 node deploy/smoke.mjs` exited
  0 (19 routes 200, 315 assets, GLB range header verified, anonymous state denied).
- **Integration: the committed script FAILS against production on a stale expectation.**
  `deploy/simulation-integration.mjs:62` asserts the 13 engine tool names of release 5; production (correctly) also
  lists `engine_direct_camera` (camera direction phase 1, `649bc72`), so the assert fails before any engine call. The
  gate does not run this script (no `SIM_BASE`), which is why it was not caught. A scratch copy with only that list
  extended (not committed) printed all three PASS lines (§28 replay/fork/plan invalidation; MCP handshake + 20 legacy +
  engine tools incl. pause/resume/edit/list/delete and the 2022 year room; auth/method/prototype/body limits) in 30 s.
  Engine timings: rehearse 611 ms wall, execute 449 ms, camera 922 ms; take 22,918 B. **Follow-up for the owner of
  `deploy/`:** add `'engine_direct_camera'` to that list (and the "13 engine tools" PASS text).
- **Director demo:** `node deploy/director-demo.mjs --base https://mars-campus-2026.<workers-subdomain>.workers.dev` exited 0:
  all 9 steps asserted, including step 9 pause → fork → resume both branches; total 7.96 s.
- **Browser `/lab`:** headless Chromium (SwiftShader) on production `/lab?scenario=build-bay` ran `runScenario` +
  `runToEnd`: tick 10901, done, 5/5 expectations (43/43 steps, 0 violations, visitor on level 4), 0 console errors.
  Screenshot: `viewer/e2e/artifacts/prod-smoke-6/build-bay-end.png` (reviewed: deck, stair, visitor on the deck).
- **Cross-host determinism:** the production `stateHash()` is
  `b746b0947e651c054506ccdb6568d5216a84c2d0f0304fda1b8261ba62e7f0c3`, the same value the gate's
  `deploy/determinism-probe.mjs` gives. **They match.**
- **Browser `/studio`:** `/studio/2022` shows the **Watch it being built** picker with both 2022 year-build takes
  ("first bay … 41,317 ticks", "the whole house … 117,277 ticks"). On `/studio`, the Replay take picker lists flagship
  and flagship v3; flagship `d2f16bd3…` scrubbed to "held" (t 209.6 s), engine camera on (shot "orbit the raise"):
  37/37 entities drawn, final-state hash = recorded = manifest (`c56ea8da…7157`), HYPOTHETICAL banner visible, 0 console
  errors. Screenshots: `viewer/e2e/artifacts/prod-smoke-6/studio-take-held.png` (reviewed: crew holding both frames
  among the trailers; "final state = recorded · last frame = final state (0.69 mm)"), `studio-2022-picker.png`.
- Compression audit: not required (the browser model was not rebuilt; `large-assets.json` unchanged).

Rollback (from `viewer/`):

```sh
WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler rollback cebd5827-b08d-4224-a320-afba968a1352 \
  --name mars-campus-2026 -m "rollback: <reason>"
```

## Production deploy 7 (2026-09-28, Watch it being built)

Gene authorised production deploys of the bleeding edge. Deployed by W40 from committed tree `d91057b` in a detached
worktree (`scratchpad/w40-wt`, same recipe as deploy 6: CODEX.md symlinks; `.pw-browsers` excluded through
`GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.excludesFile GIT_CONFIG_VALUE_0=<exclude file>` on the gate process only, no
repo config change; `E2E_VITE_PORT=5601`, `E2E_RUN=w40-gate`). Contents since `27e04f6`: W32 prone model = the measured
rig (`0cd2f19`), the prone layer in the viewer (`9ddd6d8`), prone fields in takes (`6fc9b46`, `mars-take/4` additive),
2×4 roof framing verbs (`03bed33`), chapter takes (`6a7fadb`) and the 2022 east-house A+B as 7 chapter takes
(`3afc6fb`, set `8ce33bee`, final `ddb634d6` = the A+B pin), studio chapter-set playback "Watch it being built"
(`295632c`, `c283820`), and the 14-tool integration fix (`fda800c`). The flagship and v3 take files are unchanged since
release 6. No later `main` commits were left out
(none landed during the gate).

- **New version: `f709304d-fc55-45f2-a44b-200cfadf4ae1`** (created 17:54:08Z). It replaces
  `07dce638-2950-444f-823f-0e19b8f62320`, which `wrangler deployments status` confirmed live at 100% twice before the
  deploy (last at 17:53:31Z). `07dce638…` is the new rollback target.
- **Gate:** `viewer/.cloudflare/gate/2026-09-28T17-38-47-294Z/report.json` in the W40 worktree (gitignored): `ok: true`,
  `gitHead` `d91057b`, `gitDirty: false`. Results: `npm test` 56/56; `test:engine` 380 pass / 0 fail / 3 skip; `tsc`
  clean; e2e 69 passed / 1 skipped in 759 s (`--workers=1`, no baseline refresh); probe `finalStateHash`
  `b746b0947e65…62e7f0c3` (unchanged since release 6).
- **Evidence (`d91057b`):** `npm run evidence`: 383 engine tests (380 pass / 0 fail / 3 skip); rows 17 PROVEN / 0 PARTIAL /
  0 UNPROVEN; capabilities 27 / 1 / 0; milestones 8 / 0 / 0. `EVIDENCE.md` + `evidence.json` committed with this record.
- **Build:** `prepare.py` staged 322 files (816.3 MiB, 8 large objects; `large-assets.json` byte-identical to release 6).
  `CLOUDFLARE_RELEASE=1 npm run build` exited 0 with the known chunk-size warning plus one new, harmless
  `INEFFECTIVE_DYNAMIC_IMPORT` note (`app/studio/chapter-set.ts` is imported both statically and dynamically). The route
  list includes `/lab`, `/lab/`, `/studio`, `/studio/202x`, `/simulation-guide`; `chapter-set.worker-*.js` is emitted;
  `dist/client/engine/takes/` holds the manifest + 11 take files. `upload.mjs` (with the main checkout's `uploaded.json`
  copied into the worktree's `.cloudflare/`) made 0 uploads (8 × `Already uploaded`). The dry run exited 0 (363 assets,
  5646.27 KiB / 1064.57 KiB gzip; bindings SIMULATIONS, MODELS, ASSETS). The deploy uploaded 25 new asset files (317
  already present); startup 113 ms.
- **Live smoke:** `/`, `/studio`, `/studio/2020`, `/studio/2022`, `/lab` and `/simulation-guide` returned 200 text/html.
  `/simulation-agent-guide.md` 200 (28,275 B). `/engine/campus-2026.json` (1,081,647 B) and `/engine/campus-2022.json`
  (238,055 B) 200 application/json. `/engine/takes/manifest.json` 200 (15,103 B; JSON-equal to the repo file) and every
  file it lists 200 application/json: `flagship-campus-2026.json` (1,812,545 B), `build-bay-v3-campus-2026.json`
  (2,418,487 B), `year-build-2022-east-house-bay1.json` (1,543,958 B), `year-build-2022-east-house.json` (4,451,737 B) and
  the 7 chapters `year-build-2022-east-house-ab-{a,d0,d1,d2,s,w,p}.json` (4,036,903 / 2,475,693 / 2,601,402 / 2,816,338 /
  2,355,412 / 2,198,075 / 991,829 B), which the chapter set entry references. `/nope` 404. `HEAD /browser/campus.glb`
  200 model/gltf-binary from R2. `SITE_BASE=… ALL_ASSETS=1 node deploy/smoke.mjs` exited 0 (19 routes 200, 322 assets,
  GLB range header verified, anonymous state denied).
- **Integration:** `SIM_BASE=… node deploy/simulation-integration.mjs` (the committed script, now 14 engine tools) printed
  all three PASS lines in 33 s, run on its own. Engine timings: rehearse 565 ms wall, execute 551 ms, camera 1491 ms;
  take 22,918 B.
- **Director demo:** `node deploy/director-demo.mjs --base https://mars-campus-2026.<workers-subdomain>.workers.dev` exited 0: all 9
  steps asserted, including step 9 pause → fork → resume both branches; total 8.77 s.
- **Browser `/lab`:** headless Chromium (SwiftShader) on production `/lab?scenario=build-bay`: tick 10901, done, 5/5
  expectations (43/43 steps, 0 violations, visitor on level 4), 0 console errors. Screenshot:
  `viewer/e2e/artifacts/prod-smoke-7/build-bay-end.png`.
- **Cross-host determinism:** the production `stateHash()` is
  `b746b0947e651c054506ccdb6568d5216a84c2d0f0304fda1b8261ba62e7f0c3`, the same value as the gate's probe. **They match.**
- **Browser `/studio/2022` chapter set:** "Watch it being built" offers the set entry first: "2022 east-house: skeleton,
  decks, stair, walls, solar — from the piles · 8 h 20 min · 7 chapters", then the bay-1 and whole-skeleton takes. The
  whole-set checks were done 9.1 s after load. Scrubbed to the end (8:20:29 of 30,029.95 s): chapter 7/7 P, 221/221
  entities drawn, shot "solar: done", every chapter hash + start ✓ (A, D0, D1, D2, S, W, P), and the checks line reads
  "✓ continuity: 7 / 7 chapter starts · ✓ final state ddb634d6… = A+B pin · last frame = final state (0.64 mm) · ✓ 66
  frames + beams + 145 parts at the mars-2022 canonical pose (≤ 1 cm, 1°; max 0.57 mm)"; 0 console errors. Screenshot
  `viewer/e2e/artifacts/prod-smoke-7/studio-2022-set-final.png` (reviewed: the finished two-storey east-house with deck,
  wall panels and three solar panels on the roof, crew of 8 stood down in front; chapter bar all ✓; seam "W → P: ✓
  9b16f8c3…"; banner; Diagnostics 0 violations · 105 refused/failed · 769 blocked waits). The log still shows `$crew[n]`
  placeholders (known; W39).
- **Browser `/studio`:** Replay take lists flagship and flagship v3; flagship `d2f16bd3…` scrubbed to "held" (t 209.6 s),
  engine camera on (shot "orbit the raise"): 37/37 entities drawn, final-state hash = recorded = manifest
  (`c56ea8da…7157`), HYPOTHETICAL banner visible, 0 console errors. Screenshot
  `viewer/e2e/artifacts/prod-smoke-7/studio-take-held.png` (reviewed: crew holding both frames among the trailers,
  "final state c56ea8da… = recorded · last frame = final state (0.69 mm)").
- Compression audit: not required (the browser model was not rebuilt; `large-assets.json` unchanged).

Rollback (from `viewer/`):

```sh
WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler rollback 07dce638-2950-444f-823f-0e19b8f62320 \
  --name mars-campus-2026 -m "rollback: <reason>"
```

## Production deploy 8 (2026-09-28, handoff head)

Gene requires a deploy at each green milestone. Deployed by the release-8 worker from committed tree `1a0b458` in the
detached worktree `scratchpad/final-gate-wt`, the same tree the consolidated gate ran in (`git -C <wt> rev-parse HEAD` =
`1a0b458cfaf3…`; the only untracked entry is the `viewer/.pw-browsers` symlink). Contents since `d91057b`: the W58
controller lane (region-scoped plan staleness, `rebind: 'auto'`, `engine_parse_camera`, `engine_store_camera_track`,
parked vehicles), W57 lint 123 → 25 with the integration/director scripts reading the op registry, `directCamera` 25×,
the W48 set player, the Codex tranche, per-year north (−90, 2022 −101), W51's 2022 reconciliation a–f + i (content
parked: the 2022 takes and chapter set are stale against the new scene), W47's houses, the 2024 Chiba front, the prone
receiver, framing verbs and the `/questions/` page. **Not in it:** `bc9909e`, `7e799b3`, `5f3bc9b`, `11d1dbd`, `e87f732` (docs only) and `df0ef7f` (docs + one test line: chiba full A+B `todo`; no shipped code).

- **New version: `79d424e3-a243-49ad-8b38-89f016673375`** (created 23:51:36Z). It replaces
  `f709304d-fc55-45f2-a44b-200cfadf4ae1` (release 7), which `wrangler deployments status` confirmed live at 100% twice
  before the deploy. `f709304d…` is the new rollback target.
- **Gate:** the consolidated run `viewer/.cloudflare/gate/2026-09-28T23-33-14-786Z/report.json` in `final-gate-wt`
  (not re-run): `ok: true`, `gitHead` `1a0b458`, `gitDirty: true` (the untracked `.pw-browsers` symlink only; this
  run did not use the `core.excludesFile` recipe). Results: `npm test` 77/77; `test:engine` 416 pass / 0 fail / 6 skip;
  `tsc` clean; e2e 78 passed / 7 skipped; probe `finalStateHash` `b746b0947e65…62e7f0c3` (unchanged since release 6).
- **Evidence (`1a0b458`):** `npm run evidence` exited **1**: 433 engine tests (416 pass / 0 fail / 17 skip); rows 17
  PROVEN / 0 PARTIAL / 0 UNPROVEN; capabilities 25 / 2 / 1; milestones 7 / 1 / 0. The drop from 27 / 1 / 0 and 8 / 0 / 0
  is a stale map entry, not a lost test: `evidence-map.json` still cites `core.test.ts :: "engine source never calls the
  host transcendentals"` (capability "Deterministic trig across hosts" and §30 A), which `05787d2` replaced with
  `source-scan.test.ts :: "engine production source excludes host Math transcendentals …"` (passes). **Follow-up for the
  owner of `engine/test/evidence-map.json`:** point both entries at the new title.
- **Build:** `prepare.py` staged 340 files (821.1 MiB, 8 large objects). `CLOUDFLARE_RELEASE=1 npm run build` exited 0
  with the known chunk-size warning and `INEFFECTIVE_DYNAMIC_IMPORT` note. `dist/client/engine/takes/` holds the
  manifest + 11 take files; `dist/client/questions/` holds `index.html` and its images. `upload.mjs` (main checkout's
  `uploaded.json` copied in) made 0 uploads (8 × `Already uploaded`). The dry run exited 0 (386 assets, 5733.01 KiB /
  1085.08 KiB gzip; bindings SIMULATIONS, MODELS, ASSETS). The deploy uploaded 56 new asset files (306 already present);
  startup 91 ms.
- **Live smoke:** `/`, `/studio`, `/studio/2020`, `/studio/2022`, `/studio/2024`, `/lab` and `/simulation-guide` 200
  text/html; `/questions/` 200 (56,600 B) and `/questions` 301. `/simulation-agent-guide.md` 200 (28,275 B).
  `/engine/campus-2026.json` (1,081,647 B) and `/engine/campus-2022.json` (255,547 B) 200 application/json.
  `/engine/takes/manifest.json` 200 (15,373 B, byte-identical to the build) and all 11 take files it lists 200
  application/json. `/nope` 404. `HEAD /browser/campus.glb` 200 model/gltf-binary from R2. `SITE_BASE=… ALL_ASSETS=1 node
  deploy/smoke.mjs` exited 0 (19 routes 200, 340 assets, GLB range header verified, anonymous state denied).
- **`/questions/` (browser):** "Questions for Gene", 21 images all decoded, no ≥ 400 responses, 0 console errors.
  Screenshot `viewer/e2e/artifacts/prod-smoke-8/questions-top.png` (reviewed: intro "13 open questions…", Q20 pinwheel
  handedness with its three pictures, "0 of 13 answered · Export answers" bar).
- **Integration: RED.** `SIM_BASE=… node deploy/simulation-integration.mjs` exits 1 at line 459:
  `execute plan bound before the edit must be refused` (production executed the early plan instead of returning
  `plan.stale`). Before that it passed the MCP handshake, 20 legacy tools, **the registry tool list (16 engine tools, =
  `engineTools()`)**, the engine section (rehearse 521 ms, execute 535 ms, camera 978 ms, take 22,918 B) and the directed
  camera in the room (track `dir-61e7d8cef6fb`, 33 samples; p1 orbit occluded → cut). Cause: the script's expectation
  predates W58's region-scoped staleness (`ecce5f4`): the edit touches yard B / `yb-staging` and the early plan walks p1 to
  (3, 3), so the plan is no longer stale. The gate does not run this script (no `SIM_BASE`). The sections after line 459
  (pause/resume, isolation, limits) were not reached. **Follow-up for the owner of `deploy/`:** make the early plan touch
  the edited region, or assert the new region-scoped result.
- **Director demo:** `node deploy/director-demo.mjs --base https://mars-campus-2026.<workers-subdomain>.workers.dev` exited 0: all 9
  steps, including step 9 pause → fork → resume both branches; total 7.9 s.
- **Browser `/lab`:** headless Chromium (SwiftShader) on production `/lab?scenario=build-bay`: tick 10901, done, 5/5
  expectations (43/43 steps, 0 violations, visitor on level 4), 0 console errors. Screenshot
  `viewer/e2e/artifacts/prod-smoke-8/build-bay-end.png`.
- **Cross-host determinism:** the production `stateHash()` is
  `b746b0947e651c054506ccdb6568d5216a84c2d0f0304fda1b8261ba62e7f0c3`, the gate probe's value. **They match.**
- **Browser `/studio/2022` chapter set (stale content, still plays):** the set entry is offered first (7 chapters,
  8 h 20 min), then the bay-1 and whole-skeleton takes; whole-set checks done 8.6 s after load. Scrubbed to the end
  (8:20:29): chapter 7/7 P, 221/221 drawn, shot "solar: done", every chapter hash + start ✓, and the checks line reads
  "✓ continuity: 7 / 7 chapter starts · ✓ final state ddb634d6… = A+B pin · last frame = final state (0.64 mm) ·
  **✗ 0 frames + beams + 0 parts at the mars-2022 canonical pose (of 57 + 115) (≤ 1 cm, 1°; max 5082.94 mm)**"; 0
  console errors. The ✗ is the expected face of "content parked": the set replays the pre-W51 east-house while the
  canonical pose is now W51's reconciled scene (beams ≈ 5 m away). Screenshot
  `viewer/e2e/artifacts/prod-smoke-8/studio-2022-set-final.png` (reviewed: the finished east-house with deck, tan wall
  panels and roof solar, crew stood down in front; the new 2022 scene around it — another reconciled house with a blue
  wall and a large solar array behind, trailers, "Ba Sing Se" in the header; chapter bar all ✓).
- **Browser `/studio`:** Replay take lists flagship and flagship v3; flagship `d2f16bd3…` scrubbed to "held" (t 209.6 s),
  engine camera on (shot "orbit the raise"): 37/37 drawn, final-state hash = recorded = manifest (`c56ea8da…7157`),
  HYPOTHETICAL banner visible, 0 console errors. Screenshot `viewer/e2e/artifacts/prod-smoke-8/studio-take-held.png`.
- **Browser `/studio/2024` front eye** (`__marsStudio.look([0,1.6,24],[0,2.4,5.5])`, the `studio-years` e2e view):
  0 console errors. Screenshot `viewer/e2e/artifacts/prod-smoke-8/studio-2024-front-eye.png` (reviewed: the red Chiba
  front — vertical inset with straight central stairs to the "Chiba" door landing, leaning PV flaps with stepped panels
  on the left, the plexiglass solarium on the right, a walker in front).
- Compression audit: not required (the browser model was not rebuilt; 8 large objects all already in R2).

Rollback (from `viewer/`):

```sh
WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler rollback f709304d-fc55-45f2-a44b-200cfadf4ae1 \
  --name mars-campus-2026 -m "rollback: <reason>"
```

## Production deploy 9 (2026-09-29, controller foundations)

Deployed clean gated source **`8decb07`**, fast-forwarded to local main after the full gate. The subsequent commit records generated evidence and deployment documentation only; it is not a different deployed source revision. No remote or push. Historical content values and all pins are unchanged; the sole excluded-path change is mechanical `let` → `const` in `photographic-corrections.ts`.

- **Live version:** `15c50c30-2e8e-4de5-a862-483abc1a9e47`, created 01:47:57Z / deployed 01:48:00Z, confirmed at 100% by Wrangler.
- **Rollback:** `79d424e3-a243-49ad-8b38-89f016673375` (release 8), confirmed at 100% immediately before rollout. No new Durable Object migration. Rollback restores code/assets, not persisted room edits.
- **LAST_MILE after merge:** **28 fixed / 36 reclassified / 152 remaining**, of 216; +15 fixed since handoff. LM012 remains partial; LM106/107 remain content-gated. Follow-on camera/deadlock/lowering branches are not in this release.

| Required check | Result |
| --- | --- |
| Full gate | GREEN, `viewer/.cloudflare/gate/2026-09-29T01-28-33-861Z/report.json`; head `8decb07`, gitDirty:false, cleanupError:null |
| Lint | 0 warnings/errors |
| Unit | 93 pass / 0 fail / 0 skip / 0 TODO |
| Engine | 464 total: 447 pass / 0 fail / 6 skip / 11 TODO |
| TypeScript | clean |
| Browser | 82 passed / 7 documented skips; 897.4s |
| Flagship recording | `--check` byte-identical: take/final-state/camera IDs preserved |
| Determinism | completed; `b746b0947e651c054506ccdb6568d5216a84c2d0f0304fda1b8261ba62e7f0c3` unchanged |
| Local MCP integration | PASS, isolated Wrangler; all 20 viewer + 16 engine tools exercised |
| Separate idle performance benchmark | PASS original limits: exact peak 101.43 ms / mean 0.517 ms; corridor peak 50.29 ms / mean 0.372 ms; historical grids 81–137 ms; zero violations and pinned outcome |
| Regenerated evidence | exit 0; engine 447/0; §28 rows 17 PROVEN / 0 PARTIAL / 0 UNPROVEN; milestones 8/0/0; capabilities 25/2/1 |

Capability exceptions are historical-build A/B proofs and take-schema evidence citing a spec with parked historical skips. They remain visible; references or skipped tests do not count as executed proof. Existing six engine skips, eleven historical TODOs and seven browser skips remain documented, not silently removed or repinned.

Build from the same clean integration worktree: prepare 340 public files / 821.1 MiB, 8 large objects already uploaded (0 R2 writes); release build and dry-run passed (385 assets, 6808.19 KiB / 1217.37 KiB gzip; SIMULATIONS/MODELS/ASSETS). Actual deploy uploaded 18 new assets (343 already present), startup 95 ms. Known build chunk-size/dynamic-import warnings remain. Logs under `code/codex-wt/studio-integration/viewer/.cloudflare/`: `build-wave1-reviewed.log`, `dry-wave1-reviewed.log`, `deploy-release-9.log`, `status-release-9.log`.

Production verification, all passed:
- `ALL_ASSETS=1 deploy/smoke.mjs`: 19 route variants 200, 340 public assets, valid GLB range header, anonymous state denied; questions page/redirect and invalid route/method checks. `.cloudflare/audit/http-smoke.json`.
- `SIM_BASE=production deploy/simulation-integration.mjs`: all 36 tools, region staleness/auto-rebind, static close/reopen route, canonical protection, camera sentence/typed identity, persisted pause/resume, room/read-only isolation and named chapter admission refusal. `integration-release-9.log`.
- Director demo all steps including sentence camera and pause/fork/resume, 9.427 s. `director-release-9.log`.
- Production Studio direct form/refusal/play and save/download/reopen/file-track verification: 2/2 browser tests, 41.3 s. Actual compiled browser worker exercised. `browser-release-9.log`.
- Production Lab build-bay: tick 10901, 43/43 steps, 5/5 expectations, 0 violations/errors; final hash exactly equals the Node gate probe. `lab-release-9.log` and `.cloudflare/audit/prod-lab-9.json`.
- Lead personally inspected production captures `e2e/artifacts/prod-smoke-9/studio-direct-playing.png`, `studio-direct-file-track.png`, and `build-bay-end.png`: directed crew framing and replay hash green; completed supported bay/stair and green expectations. The new sink-worker/static-edit captures were also inspected before merge.

Rollback from viewer:

```sh
WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler rollback 79d424e3-a243-49ad-8b38-89f016673375 --name mars-campus-2026 -m "rollback release 9: <reason>"
```

## Production deploy 10 (2026-09-29, supported cancellation and wait recovery)

Clean source **`3881c91`** passed the full gate before fast-forward merge to local main. The subsequent documentation/evidence/metadata commit only records that source; it is not a second source rollout. No remote/push, pins or historical values changed.

- Live **`f7ea9962-0d5e-4af5-afc5-9b433e4c49da`**, created 02:33:33Z / deployed 02:33:35Z, confirmed 100%.
- Rollback **`15c50c30-2e8e-4de5-a862-483abc1a9e47`** (release 9), confirmed 100% immediately before deploy. Code/assets rollback does not undo persisted room edits.
- LAST_MILE **30 fixed / 36 reclassified / 150 remaining**: LM036/038 closed; LM024 remains partial. Isolated camera, tail and rafter follow-ups are not deployed.

| Required check | Result |
| --- | --- |
| Full gate | GREEN, `viewer/.cloudflare/gate/2026-09-29T02-13-35-768Z/report.json`; head `3881c91`, gitDirty:false, cleanupError:null |
| Lint / TypeScript | clean, zero lint warnings/errors |
| Unit | 93 pass / 0 fail / 0 skip / 0 TODO |
| Engine | 502 total: 485 pass / 0 fail / 6 skip / 11 TODO |
| Browser | 84 passed / 7 documented skips; 904.1 s |
| Flagship recording | byte-identical `--check` |
| Determinism | `b746b0947e651c054506ccdb6568d5216a84c2d0f0304fda1b8261ba62e7f0c3`, unchanged |
| Local MCP integration | all 20 viewer + 16 engine tools passed |
| Idle performance | original limits PASS: exact peak 107.863 ms / mean 0.536002 ms; corridor peak 49.901 ms / mean 0.390266 ms; grids 82.9–136.6 ms; 0 violations, pinned outcomes |
| Regenerated evidence | 485/0; rows 17 PROVEN / 0 PARTIAL / 0 UNPROVEN; milestones 8/0/0; capabilities 25/2/1 |

Six engine skips, eleven TODOs and seven browser skips retain the documented historical exceptions; no skipped case is claimed as executed proof. Capabilities 25/2/1 retain historical-build and take-schema exceptions. Evidence was regenerated against the explicit current green report after copying it to main. The earlier failed gate on `6c55285` is retained at `2026-09-29T02-09-55-146Z`: one long-wait test needed the new post-threshold named deadlock diagnostic; production code/pins/tolerances were not changed to fix it.

Build: 340 public files / 821.1 MiB, eight large objects already uploaded, zero R2 writes. Release build/dry run passed: 388 assets, 6829.04 KiB / 1223.33 KiB gzip. Deploy uploaded 20 new assets (344 existing), startup 94 ms. Known chunk-size/dynamic-import warnings remain.

Production verification all passed:

- Full asset smoke: 340 assets, 19 routes, GLB range and anonymous-state denial.
- MCP integration: all 36 tools including staleness/rebind, edits, camera parsing, persistence/resume and isolation.
- Director demo: all steps including sentences and pause/fork/resume, 9.699 s.
- Browser: 4/4 tests, 46.5 s; supported raise lowering, unsafe reverse-path refusal, Studio direct/refusal/play and save/download/reopen/file-track verification.
- Lab: 10901 ticks, 43/43 steps, 5/5 checks, zero violations/errors, exact Node probe hash.
- Lead personally inspected all six `viewer/e2e/artifacts/prod-smoke-10/` captures: lowering holders, grounded cancelled frame, clutter refusal retaining support, Studio directed playback and reopened track with green hashes, completed supported build bay/stair. Captures and audit JSON copied to main.

Logs: `viewer/.cloudflare/*release-10.log`; audit `viewer/.cloudflare/audit/{http-smoke,prod-lab-10}.json`. Build/deploy source checkout remains `code/codex-wt/studio-integration`.

Rollback from viewer:

```sh
WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler rollback 15c50c30-2e8e-4de5-a862-483abc1a9e47 --name mars-campus-2026 -m "rollback release 10: <reason>"
```

## Production deploy 11 (2026-09-29, staging camera verification and vehicle cycles)

Clean source **1859a8c** passed the full gate before fast-forward merge. Live **4de6d265-4292-4e20-88c2-e85dda7a5488**, created04:22:15Z/deployed04:22:17Z, confirmed100%. Rollback **f7ea9962-0d5e-4af5-afc5-9b433e4c49da** (release10), confirmed100% before rollout. The documentation/evidence commit records that source; it is not a different deployed build. No remote/push, pins or historical values changed.

LAST_MILE **33 fixed /36 reclassified /147 remaining**. LM100/137/043 close; LM024 tails improve but remain partial. Carry bystander safety is excluded after its two-tick probe change; retained for the single wave2 pin window. Earlier failed gate/evidence attempts remain documented in PROGRESS.

| Check | Result |
| --- | --- |
| Full gate | GREEN `viewer/.cloudflare/gate/2026-09-29T03-56-35-186Z/report.json`;1859a8c,gitDirty:false,cleanupError:null |
| Lint / TypeScript | clean,0warnings/errors |
| Unit |93pass/0fail |
| Engine |515total:498pass/0fail/6skip/11TODO |
| Browser |84pass/7documented skips;916.6s |
| Recording / determinism |byte-identical flagship;unchanged b746b0947e651c054506ccdb6568d5216a84c2d0f0304fda1b8261ba62e7f0c3 |
| Local MCP |all36tools pass |
| Idle performance |original limits pass;exact peak108.766ms/mean0.544816ms;corridor peak49.2585ms/mean0.418019ms;grids81.6–141.0ms;zero violations,pinned outcomes |
| Evidence |498/0;17rowsPROVEN,8milestonesPROVEN;capabilities25/2/1 |

Historical skips/TODOs and capability exceptions remain explicit; no skipped case is claimed as executed proof. Generated evidence used the exact final green report. Build/dry-run passed:340publicfiles/821.1MiB,8largeobjects already uploaded,zeroR2writes;388buildassets,6831.50KiB/1223.92KiBgzip. Actual rollout uploaded14assets(350existing),startup100ms. Known chunk-size/dynamic-import warnings remain.

Production verification all passed:340assets/19routes/GLBrange/auth;all36MCPtools;director demo all steps;Studio direct/refusal/play and save/download/reopen/file-track2/2(42.1s);Lab10901ticks,43/43steps,5/5checks,zero violations/errors and exact Node probe hash. Lead personally inspected all three production PNGs:directed playback,reopened file track with green hash,completed supported bay/stair. Captures/audit copied to main. Logs in integration `viewer/.cloudflare/*release-11*.log`; audit `http-smoke.json` and `prod-lab-11.json`.

Rollback from viewer:
```sh
WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler rollback f7ea9962-0d5e-4af5-afc5-9b433e4c49da --name mars-campus-2026 -m "rollback release11: <reason>"
```

## Production deploy 12 (2026-09-29, history integrity and social resume)

Clean source **7e5ff0a** passed the full gate before fast-forward merge. Live **f63d5e1a-556b-4379-b61c-2f7fa60a42e4**, created04:53:08Z/deployed04:53:10Z, confirmed100%. Rollback **4de6d265-4292-4e20-88c2-e85dda7a5488** (release11), confirmed100% immediately before rollout. This metadata/evidence commit records the deployed source, not a different build. No remote/push, pins or historical values changed.

LAST_MILE **35 fixed /36 reclassified /145 remaining**: LM075 history integrity and LM029 queued-directive snapshots close. LM026 seat return improves but conversation re-forming remains isolated. Staged-support checks were removed after detecting real existing fixture overlap; the guard and corrected delivery sequence remain queued for the single wave2 pin window.

| Check | Result |
| --- | --- |
| Full gate | GREEN `viewer/.cloudflare/gate/2026-09-29T04-29-41-263Z/report.json`;7e5ff0a,gitDirty:false,cleanupError:null |
| Lint / TypeScript | clean, zero warnings/errors |
| Unit | 93 pass /0 fail |
| Engine | 533 total:516 pass /0 fail /6 skip /11 TODO |
| Browser | 84 pass /7 documented skips;938.0s |
| Recording / determinism | byte-identical flagship; unchanged b746b0947e651c054506ccdb6568d5216a84c2d0f0304fda1b8261ba62e7f0c3 |
| Local MCP | all36 tools pass |
| Idle performance | original limits pass; exact peak109.723ms/mean0.564034ms; corridor peak52.783ms/mean0.430892ms; grids87.2–151.3ms; zero violations, pinned outcomes |
| Evidence | 516/0;17 rows PROVEN,8 milestones PROVEN; capabilities25/2/1 |

Historical skips/TODOs and capability exceptions remain explicit and are not counted as executed proof. Evidence was regenerated against the final green gate. Build/dry-run passed:340 public files/821.1MiB,8 large objects already uploaded,zero R2 writes;388 build assets,6847.36KiB/1227.50KiB gzip. Rollout uploaded15 new assets(349 existing),startup115ms. Known chunk-size/dynamic-import warnings remain.

Production verification passed:340 assets/19 routes/GLB range/auth;all36 MCP tools;director demo all steps;Studio direct/refusal/play and save/download/reopen/file-track2/2(46.0s);Lab10901 ticks,43/43 steps,5/5 checks,zero violations/errors and exact Node probe hash. Lead personally inspected all three production PNGs:directed playback,reopened file track with green final hash,completed supported bay/stair. Also inspected all six before/mid-stand-up snapshot continuation records and15 history-integrity records. Captures/audits copied to main. Logs: integration `viewer/.cloudflare/*release-12*.log`; audit `http-smoke.json` and `prod-lab-12.json`.

Rollback from viewer:
```sh
WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler rollback 4de6d265-4292-4e20-88c2-e85dda7a5488 --name mars-campus-2026 -m "rollback release12: <reason>"
```


## Production deploy 13 (2026-09-29, social return and live-link safety)

Clean source **b0f7419** passed the full gate before fast-forward merge. Live **3b93cbd2-bc84-4484-a3e8-21705a069b25**, created06:02:35Z/deployed06:02:37Z, confirmed100%. Rollback **f63d5e1a-556b-4379-b61c-2f7fa60a42e4** (release12), confirmed100% immediately before rollout. Metadata/evidence records the deployed source, not another build. No remote/push, pins or historical values changed.

LAST_MILE **38 fixed /36 reclassified /142 remaining**: LM026 conversation return, LM027 ambient re-adoption and LM076 unique action ids/live link validation close. Body, solar and walking follow-ups remain isolated; no wave2 re-pin consumed.

| Check | Result |
| --- | --- |
| Full gate | GREEN `viewer/.cloudflare/gate/2026-09-29T05-36-51-650Z/report.json`;b0f7419,gitDirty:false,cleanupError:null |
| Lint / TypeScript | clean, zero warnings/errors |
| Unit | 93 pass /0 fail |
| Engine | 557 total:540 pass /0 fail /6 skip /11 TODO |
| Browser | 84 pass /7 documented skips;919.8s |
| Recording / determinism | byte-identical flagship; unchanged b746b0947e651c054506ccdb6568d5216a84c2d0f0304fda1b8261ba62e7f0c3 |
| Local MCP | all36 tools pass |
| Idle performance | original limits pass; exact peak105.226ms/mean0.671940ms; corridor54.6825ms/0.537779ms; grids103.2–176.3ms; zero violations, pinned outcomes |
| Evidence | 540/0;17 rows PROVEN,8 milestones PROVEN; capabilities25/2/1 |

Historical skips/TODOs and capability exceptions remain explicit, not counted as executed proof. The previous gate's shot-hold sampling failure and its frame-specific correction are recorded in PROGRESS and STUDIO_REPLAY; no hold duration, pin or product behavior was relaxed. Evidence uses the exact final green gate.

Build/dry-run passed:340 public files/821.1MiB,eight large objects already uploaded,zero R2 writes;388 assets,6862.90KiB/1230.53KiB gzip. Rollout uploaded20 new assets(344 existing),startup93ms. Known chunk-size/dynamic-import warnings remain.

Production verification passed:340 assets/19 routes/GLB range/auth;all36 MCP tools;director demo all steps(8.446s);Studio direct/refusal/play and save/download/reopen/file-track2/2(41.3s);Lab10901 ticks,43/43 steps,5/5 checks,zero violations/errors and exact Node probe hash. Lead personally inspected all three production PNGs:directed playback,reopened file track with green final hash,completed supported bay/stair. Captures/audits copied to main. Logs: integration `viewer/.cloudflare/*release-13*.log`; audit `http-smoke.json` and `prod-lab-13.json`.

Rollback from viewer:
```sh
WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler rollback f63d5e1a-556b-4379-b61c-2f7fa60a42e4 --name mars-campus-2026 -m "rollback release13: <reason>"
```

## Production deploy 14 (2026-09-30, first playable classroom)

Clean source **f40f659** passed the full gate on the rebased classroom branch before fast-forward merge into local main. Live **c0522537-d4e4-4a64-9bd3-c52b711eecd4**, created00:24:36Z/deployed00:24:38Z, confirmed100%. Rollback **3b93cbd2-bc84-4484-a3e8-21705a069b25** (release13), confirmed100% before deploy. The subsequent metadata/evidence commit records that source rather than changing the deployed build. No remote/push, pin/golden or historical values changed; unrelated dirty main changes preserved.

What works: hypothetical /lab classroom-4 and classroom-8; staggered real seating, presenter/host roles, owned powered display, questions/shared attention, presenter rotation, director intervention, small conversations and departure/cleanup. Runtime execution uses existing physical actions and resource ownership. Ground floor/fixed furniture only; held objects/missing equipment refuse. Late joining and resumable computer work are tested isolated follow-ups, not this release. Active classroom snapshots explicitly refuse; live head attention is not a validated take-replay feature. Exact hands, richer gestures/dialogue and moving-furniture rebinding remain deferred.

Original LAST_MILE accounting stays **38 fixed /36 reclassified /142 remaining**. All216 IDs and candidate provenance remain in RAINY_DAY_BACKLOG; this narrower playable increment does not close the broader original social requirements.

| Required check | Result |
| --- | --- |
| Full gate | GREEN `.cloudflare/gate/2026-09-30T00-00-40-560Z/report.json`; f40f659,gitDirty:false,cleanupError:null |
| Lint / TypeScript | clean, zero warnings/errors |
| Unit |93 pass /0 fail |
| Engine |587 total:570 pass /0 fail /6 documented skips /11 historical TODO |
| Browser |86 pass /7 documented historical skips;920.1s |
| Flagship recording / determinism |byte-identical take/camera/final-state; unchanged b746b0947e651c054506ccdb6568d5216a84c2d0f0304fda1b8261ba62e7f0c3 |
| Local MCP |all36 tools pass |
| Idle performance |original limits pass: exact peak111.201ms/mean0.717142ms; corridor52.666ms/0.541603ms; grids104.1–180.2ms; zero violations,pinned outcomes |
| Regenerated evidence |570/0;17 rows PROVEN,8 milestones PROVEN; capabilities25/2/1 retain documented historical exceptions |

No skipped case is counted as executed proof. Focused classroom/object/map checks include missing/occupied equipment, cancellation, directed departure and complete conversations. Capture inspection exposed failed ambient nudges against parent-owned actors; the selected claim guard corrects that behavior, with no-failed-record assertions retained. No baselines were changed.

Build/dry-run passed:340 public files/821.1MiB,eight large objects already uploaded,zero R2 writes;388 build assets,6895.13KiB/1237.13KiB gzip. Rollout uploaded22 assets,startup110ms. Known chunk-size/dynamic-import warnings remain. No new DO migration.

Production verification passed:340 assets/19 routes/GLB range/auth;all36 MCP tools;director demo all steps(10.059s);classroom2/2 and Studio direct/refusal/save/download/reopen/file-track2/2, combined4/4(50.6s);build-bay10901ticks/43steps/5checks/zero violations/errors and exact Node probe hash. Lead personally inspected seven production captures:presenting,question,rotation,three formed conversation groups,directed Studio playback,reopened track,and completed supported bay. Original history reconstruction remained outside this release. Captures/audits copied to main; logs integration `viewer/.cloudflare/*release-14.log`, captures `viewer/e2e/artifacts/prod-smoke-14/`.

Rollback from viewer:
```sh
WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler rollback 3b93cbd2-bc84-4484-a3e8-21705a069b25 --name mars-campus-2026 -m "rollback release14: <reason>"
```


## Production deploy 15 (2026-09-30, classroom work continuity)

Clean source **a4078c6** passed the full gate before local-main fast-forward. Live **284cdc8f-2d8c-4e73-a7f8-d058afe1727f**, created01:02:07Z/deployed01:02:10Z, confirmed100%. Rollback **c0522537-d4e4-4a64-9bd3-c52b711eecd4** (release14), confirmed before rollout. Metadata/evidence records the deployed source. Unrelated historical-agent working changes preserved; no remote, push, pins or golden changes.

What works: late audience joining/rejoining during presentation/questions, a real seated computer workstation with visible task progress, safe interruption, classroom attendance or courtyard direction, and explicit return to the same unfinished task. Quiet seated work/reading is supported; typing animation is not claimed. Ground-floor fixed arrangements, one available spare audience seat, at most12 distinct lifetime audience members, audience-only joining; held items refuse. Active activity snapshots remain explicitly nonresumable. Broader autonomy, furnishing edits, precise hand expression and take-replay head attention remain deferred.

Original LAST_MILE accounting stays **38 fixed /36 reclassified /142 remaining**; all216 IDs remain recoverable. These narrower capabilities do not close broad original requirements.

| Required check | Result |
| --- | --- |
| Full gate | GREEN `viewer/.cloudflare/gate/2026-09-30T00-39-26-235Z/report.json`; a4078c6,gitDirty:false,cleanupError:null |
| Lint / TypeScript | clean, zero warnings/errors |
| Unit |93 pass /0 fail |
| Engine |603 total:586 pass /0 fail /6 documented skips /11 historical TODO |
| Browser |89 pass /7 documented skips;999.3s |
| Flagship recording / determinism |byte-identical flagship; unchanged b746b0947e651c054506ccdb6568d5216a84c2d0f0304fda1b8261ba62e7f0c3 |
| Local MCP |all36 tools pass |
| Idle performance |original limits pass: exact peak112.619ms/mean0.714948ms; corridor54.360ms/0.582276ms; grids111.5–198.7ms; zero violations,pinned outcomes |
| Regenerated evidence |586/0;17 rows PROVEN,8 milestones PROVEN; capabilities25/2/1 retain documented exceptions |

Skipped/TODO cases are not counted as executed proof. Focused valid/invalid tests cover joining eligibility, occupied seats, held objects, cancellation/resource cleanup, directive precedence and task identity/elapsed continuation. No test thresholds or baselines changed.

Build/dry-run passed:340 public files/821.1MiB,eight large objects already uploaded,zero R2 writes;6912.20KiB/1241.14KiB gzip. Rollout uploaded21 assets(343 existing),startup125ms. Existing chunk-size/dynamic-import warnings remain; no new DO migration.

Production verification passed:340 assets/19 routes/GLB range/auth,all36 MCP tools,director all steps(14.314s),classroom2/2+work continuity3/3+Studio2/2 (7/7),build-bay10901ticks/43steps/5checks/zero violations/errors and exact Node probe hash. Lead personally inspected production captures of clear seated work and resumed progress, directed unfinished work, late visitor seating, questions/rotation/formed conversations, Studio playback/reopened track and completed supported bay. Work captures show quiet hands resting rather than typing. Captures/audits retained under `viewer/e2e/artifacts/prod-smoke-15/` and `viewer/.cloudflare/*release-15.log`.

Rollback from viewer:
```sh
WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler rollback c0522537-d4e4-4a64-9bd3-c52b711eecd4 --name mars-campus-2026 -m "rollback release15: <reason>"
```

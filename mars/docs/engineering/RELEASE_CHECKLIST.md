# Release checklist: Mars Studio Worker (`mars-campus-2026`)

Current deployment metadata is `viewer/deploy/deployment.json`; the latest dated production record below is authoritative. **Release35 is live. Owner authorized a subsequent living-world tranche; its completion/publication is pending.** Initial preparation results and older rollback examples are retained as historical records; use the latest release record for the current rollback target.

- Worker: `mars-campus-2026` at https://mars-campus-2026.<workers-subdomain>.workers.dev
- R2 bucket: `mars-campus-2026-models`
- Wrangler: 4.136.2 (repo-pinned). Auth uses the existing OAuth login; never read credential files.
- Procedure source: `viewer/deploy/README.md`

## Release gate (required before deploying)

A deploy must start from a green `npm run gate` report (run from `viewer/`). The gate runs, in
order: zero-warning lint, `npm test`, `npm run test:engine`, `npx tsc --noEmit -p .`, the separate cinematography TypeScript check,
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

What works: late audience joining/rejoining during presentation/questions, a real seated computer workstation with visible task progress, safe interruption, classroom attendance or courtyard direction, and explicit return to the same unfinished task. Quiet seated work/reading is supported; typing animation is not claimed. Ground-floor fixed arrangements, one available spare audience seat, at most12 distinct lifetime audience members, audience-only joining; construction holds refuse. A subsequent review found small in-hand items were not separately refused; correction is pending the next green milestone. Active activity snapshots remain explicitly nonresumable. Broader autonomy, furnishing edits, precise hand expression and take-replay head attention remain deferred.

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

Skipped/TODO cases are not counted as executed proof. Focused valid/invalid tests cover joining eligibility, occupied seats, construction holds, cancellation/resource cleanup, directive precedence and task identity/elapsed continuation. No test thresholds or baselines changed.

Build/dry-run passed:340 public files/821.1MiB,eight large objects already uploaded,zero R2 writes;6912.20KiB/1241.14KiB gzip. Rollout uploaded21 assets(343 existing),startup125ms. Existing chunk-size/dynamic-import warnings remain; no new DO migration.

Production verification passed:340 assets/19 routes/GLB range/auth,all36 MCP tools,director all steps(14.314s),classroom2/2+work continuity3/3+Studio2/2 (7/7),build-bay10901ticks/43steps/5checks/zero violations/errors and exact Node probe hash. Lead personally inspected production captures of clear seated work and resumed progress, directed unfinished work, late visitor seating, questions/rotation/formed conversations, Studio playback/reopened track and completed supported bay. Work captures show quiet hands resting rather than typing. Captures/audits retained under `viewer/e2e/artifacts/prod-smoke-15/` and `viewer/.cloudflare/*release-15.log`.

Rollback from viewer:
```sh
WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler rollback c0522537-d4e4-4a64-9bd3-c52b711eecd4 --name mars-campus-2026 -m "rollback release15: <reason>"
```


## Production deploy 16 (2026-09-30, shared floor and free hands)

Clean source **3134294** passed the full gate before local-main fast-forward. Live **7f910ca6-a3b6-4309-bb25-de9cb330fb56**, created01:57:34Z/deployed01:57:36Z, confirmed100%. Rollback **284cdc8f-2d8c-4e73-a7f8-d058afe1727f** (release15), confirmed before deploy. Metadata/evidence records the deployed source. Main historical-agent changes preserved; no remote/push, pins/goldens or historical values changed. Camera implementation remains separate.

What works: formed conversation groups take staggered stable turns and clear departed/cancelled attention; questioner temporarily holds the floor while actual presenter identity remains available; class/work initial/join/resume refuse held bowl/spoon without support or progress changes. Explicit physical put permits later admission. Render-only reset/geometry/FOV hooks are frozen. Surface stow UI is a subsequent candidate. Ground-floor fixed layouts, bounded head gaze, quiet work rather than typing; no active activity snapshot resumption, furniture recovery or take-replay gaze claim.

| Required check | Result |
| --- | --- |
| Full gate | GREEN `.cloudflare/gate/2026-09-30T01-26-16-361Z/report.json`;3134294,gitDirty:false,cleanupError:null |
| Lint / TypeScript | clean |
| Unit |96 pass /0 fail |
| Engine |619 total:602 pass /0 fail /6 documented skips /11 historical TODO |
| Browser |91 pass /7 documented skips;945.7s |
| Flagship / determinism |byte-identical; unchanged b746b0947e651c054506ccdb6568d5216a84c2d0f0304fda1b8261ba62e7f0c3 |
| Local MCP |all36 tools pass |
| Idle performance |original ceilings/outcomes:exact peak110.926125ms/mean0.710742996ms;corridor52.329834ms/0.554328080ms;grids107.54–186.70ms;zero violations |
| Regenerated evidence |602/0;17 rows PROVEN,8 milestones PROVEN;capabilities25/2/1 retain exceptions |

Skipped/TODO cases are not executed proof. Original accounting **38fixed/36reclassified/142remaining**, all216 recoverable. Focused valid/invalid tests and actual runtime inspection cover turns/departure/cancel, admission preservation and atomic camera refusals. No thresholds changed.

Prepare/build/dry-run passed:340public files/821.1MiB; eight existing content-addressed R2 objects reuploaded (fresh worktree lacked local ignored receipts), unchanged keys/content. Worker6915.42KiB/1242.25KiB gzip;7new assets/357existing,startup114ms. Known chunk/import warnings remain, no new migration.

Production passed:340assets/19routes/GLB range/auth;all36MCPtools;director allsteps9.527s;classroom2+continuity3+groupturn1+camera hooks1+Studio2 =9/9(1.2min);build-bay10901ticks/43steps/5checks/zero violations/errors/exact probe hash. Root inspected production turn-one/turn-two, reset/FOV and supported bay captures. Captures/audits in viewer/e2e/artifacts/prod-smoke-16 and viewer/.cloudflare/*release-16.log.

Rollback from viewer:
```sh
WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler rollback 284cdc8f-2d8c-4e73-a7f8-d058afe1727f --name mars-campus-2026 -m "rollback release16: <reason>"
```


## Production deploy 17 (2026-09-30, belongings and optional camera)

Clean source **d04271d** passed the full gate before local-main fast-forward. Live **7b809dd0-7655-4192-b968-5eb35d83df40**, created02:30:58Z/deployed02:31:00Z, confirmed100%. Rollback **7f910ca6-a3b6-4309-bb25-de9cb330fb56** (release16), confirmed before deployment. Metadata/evidence records the deployed source. Historical-agent dirty main paths preserved; no remote/push, pins, goldens or historical values changed.

What works: hypothetical four/eight-person classrooms have an authored table/bowl/spoon; take both, receive honest held-item admission refusal, cancel preparation safely, retry physical surface puts, explicitly resume the same unfinished notes or join the running class. HUD exposes returned/remaining/waits. Optional Manual/Clear/Restrained camera observes the existing world; separate review entry uses its own explicitly labeled classroom. Camera corrections through a6cc661 remain owner-owned. No eating, ground stow, automatic activity handoff, typing, physical furniture moving or active-snapshot resumption claim. Fine fingers remain unproved; previous refusal banner persists after remedy.

| Required check | Result |
| --- | --- |
| Full gate | GREEN `.cloudflare/gate/2026-09-30T02-09-45-173Z/report.json`;d04271d,gitDirty:false,cleanupError:null |
| Lint / both TypeScript configs | clean |
| Unit |96 pass /0 fail |
| Engine |687 total:670 pass /0 fail /6 documented skips /11 historical TODO |
| Browser |97 pass /7 documented skips;964s |
| Flagship / determinism |byte-identical; unchanged b746b0947e651c054506ccdb6568d5216a84c2d0f0304fda1b8261ba62e7f0c3 |
| Local MCP |all36 tools pass |
| Idle performance |original ceilings/outcomes:exact peak117.163875ms/mean0.7351517075ms;corridor55.327583ms/0.5780176467ms;grids107.325333–180.74525ms;zero violations |
| Regenerated evidence |670/0;17 rows PROVEN,8 milestones PROVEN;capabilities25/2/1 retain documented exceptions |

Skipped/TODO cases are not executed proof. Original accounting **38fixed/36reclassified/142remaining**, all216 recoverable. Focused58 physical checks and22 camera offline checks pass; actual valid/refusal/cancel/retry/resume captures inspected. No tolerances/baselines changed.

Prepare/build/dry-run passed:340public files/821.1MiB; eight existing large objects use verified receipts, zero R2 writes.392 build files; Worker6928.27KiB/1245.18KiB gzip;22new assets/345existing,startup209ms. Known chunk/import warnings remain; no new migration.

Production assets340/19routes/GLB range/auth,all36MCPtools,director allsteps10.501s,build-bay10901ticks/43steps/5checks/zero violations/errors/exact probe hash pass. Browser attempt:14 pass/1 fail (2.1min). The failed camera test dynamically imports unbuilt `/cinematography/lab-driver.ts`, which the bundled production deployment does not serve; it passes locally in the full gate. Its failed log/trace is preserved, not counted as production proof. A separate ignored production harness verifies the actual published `/cinematography/review.html` runtime: follow/return unchanged paused-world hash, questioner, portrait actual aspect0.5232558139534884, same-tick resets, disposal, zero diagnostics/errors and hidden disabled Jev with no provider request. `.cloudflare/audit/prod-camera-17.json` and `public-camera-release-17.log` retain that proof. Provider failure injection remains local22/22 proof; production provider is disabled.

Root personally inspected eight new production captures: held items, first reach, cancelled reach, returned surface, prepared visitor seating, public questioner/portrait and same-world optional camera. Captures show credible bounded interactions at the supported viewing distance; exact skin contact is not certified. Captures/audits copied to main; logs `viewer/.cloudflare/*release-17.log`, captures `viewer/e2e/artifacts/prod-smoke-17/`. Camera MP4 production remains with its owner.

Rollback from viewer:
```sh
WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler rollback 7f910ca6-a3b6-4309-bb25-de9cb330fb56 --name mars-campus-2026 -m "rollback release17: <reason>"
```


## Production deploy 18 (2026-09-30, checkpoint tour)

Clean source **b2928ef60f7df31c23d2efc5db6ffbe2b7667bd9** passed the full gate before local-main fast-forward. Live **4e77562e-9dc4-4f76-890b-22bc188d8ed7**, created04:11:45.252Z/deployed04:11:47.436Z, confirmed100%. Rollback **7b809dd0-7655-4192-b968-5eb35d83df40** (release17). Historical-agent dirty main paths and unfinished branches remain preserved. No remote/push, pins, goldens, tolerances or historical values changed.

Open `/lab?scenario=classroom-4` for the top-panel quick tour and four/eight-guest room launches. Start, question, rotate presenters, join/leave, direct actors and watch smaller conversations. Quiet computer work retains unfinished progress across explicit interruption/return. Explicit bowl/spoon preparation, spare-chair carry/cancel/reseat and two-person cleared-table carry/cancel/returned surface use are playable. Camera owner reviewed work through bf24353 is selected; live review offers Clear/Restrained/Continuous and operator follow/return. `/app/camera-lab/suite.html` exposes six **recorded** comparisons with scenario selection/play/pause/restart. Actual recorded world execution and synthetic camera attention cues are labeled; this is not six additional live activities or recorded head-attention proof.

| Required check | Result |
| --- | --- |
| Full gate | GREEN `.cloudflare/gate/2026-09-30T03-47-46-115Z/report.json`;b2928ef,gitDirty:false,cleanupError:null |
| Lint / both TypeScript configs | clean, zero lint warnings |
| Unit |99 pass /0 fail |
| Engine |762 total:745 pass /0 fail /6 documented skips /11 historical TODO |
| Browser |103 pass /7 documented skips;1019.7s |
| Flagship / determinism |byte-identical; unchanged b746b0947e651c054506ccdb6568d5216a84c2d0f0304fda1b8261ba62e7f0c3 |
| Local MCP |all36 tools pass |
| Idle performance |original ceilings/outcomes:exact peak110.315958ms/mean0.6810769592ms;corridor50.086333ms/0.5242200317ms;grids103.043375–174.7925ms;zero violations |
| Regenerated evidence |745/0;17 rows PROVEN,8 milestones PROVEN;capabilities25/2/1 retain exceptions |
| Production browser |20/20 pass,3.5min; real published classroom/work/items/chair/table/tour/replay/camera hooks/Studio journeys |
| Published camera entry |follow/return/Continuous leave paused world unchanged; questioner, portrait aspect0.5232558139534884, reset epochs/disposal, zero diagnostics/errors; Jev hidden/disabled, zero provider requests |
| Production infrastructure |341 assets/19 routes/GLB range/auth;all36 MCP tools;director all9 steps9.105s |
| Production build bay |10901ticks/43steps/5checks;zero violations/errors;exact unchanged probe hash |

First combined gate7df5510 was red/partial: global quick tour altered old nonclassroom screenshots. Root stopped the owned gate; cleanupError:null. Narrowing discovery to classroom4/8 in b2928ef preserved every baseline. Representative old/new browser3/3 then full gate passed. Original failure report03-39-28-889Z remains retained. No expected outcome was edited to obtain green. The dev-source URL/provider injection camera test remains locally proven and is excluded from production-only run because production serves bundled entries; actual published runtime is separately verified rather than counting that test as a production pass.

Prepare/build/dry-run415files pass; Worker6940.45KiB/1248.44KiB gzip;46new assets/341existing,startup99ms. Eight content-addressed large objects and manifest unchanged, verified receipts, **zero R2 writes**. Reproducible18.4MB camera replay generated from exact release source is ignored and staged with a static receipt; no MP4 or large replay JSON is committed. Known bundle/import warnings remain.

Root personally inspected nine new production PNGs: tour, chair held/reseated, table held/returned surface, replay controls, public questioner/portrait and completed supported bay. Captures in `viewer/e2e/artifacts/prod-smoke-18/`; audits in `.cloudflare/audit/prod-camera-18.json` and `prod-lab-18.json`; helper release logs `*release-18.log`. Camera-specific MP4 work stays with its owner.

Supported boundary: ground-floor upright empty camp-chair/table; explicit tabletop removal; two free empty-handed table carriers. Occupied/reserved furniture, contents migration, arbitrary room optimization, fine finger/clothing contact, autonomous routines and active activity snapshot restore remain unsupported or deferred. Previous refusal banners persist after remedies. Bounded coordinated room setup is an **unreleased candidate**, not part of18. Original inventory remains **38fixed/36reclassified/142remaining**, all216 recoverable.

Rollback from viewer:
```sh
WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler rollback 7b809dd0-7655-4192-b968-5eb35d83df40 --name mars-campus-2026 -m "rollback release18: <reason>"
```


## production-deploy-19-2026-09-30-usable-room-setup

Clean source **1eee5c6ecfde607ddc742763c4b07b9d59a0c60e** passed the full rebased gate before local-main fast-forward. Live **ce6daf22-caa7-4698-8b28-6b2a2935b7d3**, created05:35:14.086Z/deployed05:35:16.295Z, confirmed100%. Rollback **4e77562e-9dc4-4f76-890b-22bc188d8ed7** (release18), confirmed before rollout. Subsequent metadata/evidence/camera-retirement documentation changes do not alter the deployed source. Historical-agent dirty main paths and unfinished branches remain preserved; no remote/push, pins, goldens, tolerances or historical values changed.

**Playable boundary:** explicit default/side layouts in four/eight-guest rooms drive ordinary physical table/chair actions with chosen crews. Readonly preflight refuses loaded/occupied/unavailable setups; stop waits for actual safe lowering and preserves partial placements. Retry/restore and current readiness remain visible. Moved spare seating and relocated table surfaces are used in the subsequent full talk/question/presenter-rotation/conversation journey. No arbitrary optimizer, automatic contents removal, occupied-seat transport or active-activity restore claim.

| Check | Result |
|---|---|
| Full gate | GREEN `.cloudflare/gate/2026-09-30T05-09-24-342Z/report.json`;1eee5c6,gitDirty:false,cleanupError:null |
| Lint / both TypeScript configs | Clean |
| Unit |99 pass /0 fail |
| Engine |786 total:769 pass /0 fail /6 documented skip /11 TODO |
| Browser |105 pass /7 documented skip,1152.1s |
| Flagship take / probe | Byte-identical; completed hash b746b0947e651c054506ccdb6568d5216a84c2d0f0304fda1b8261ba62e7f0c3 |
| Local control-plane integration | All36MCP tools, isolation/auth/method/limits pass |
| Idle performance | Original250/120ms peak,3ms mean and pinned outcomes pass; exact peak113.782834ms/mean0.7187029942ms, corridor57.533167/0.5679969042; zero violations. Historical grids113.172–186.81125ms (<1000ms) |
| Regenerated evidence |769/0;17 rows and8 milestones PROVEN; capabilities25/2/1 retain exceptions |
| Production |341assets/19routes/range/auth;36MCPtools; director9steps8264ms;22browser journeys pass(3.2min) |
| Compiled live camera / bay | Published camera follow/return/Continuous/portrait/reset/dispose, unchanged paused world,0diagnostics/errors; bay10901ticks/43steps/5checks/zero violations/errors/exact probehash |

The first full reviewed gate04-42-29-214Z had104passes/1failure/7skips: the existing Studio shot-hold sampler had a400ms global RAF gap above its unchanged375ms cadence limit in a final incomplete shot. Original trace/samples retained. The unchanged focused test passed1/1(2.2min), then the unchanged full gate passed105/7. No cadence, hold-duration, baseline or physical outcome was edited. An earlier04-32-40-308Z gate was deliberately stopped to strengthen new-layout presenter/social proofs; it is retained as partial, not counted green. Earlier test-order/actor-filter mistakes and traces remain in the room-setup report.

Build/dry415files,6947.91KiB/1249.84KiB gzip; rollout9new assets/378existing,startup105ms. Eight content-addressed large objects and their verified receipt are unchanged: **zero R2 writes**. Known chunk/dynamic-import warnings remain. Actual published camera entry is separately tested; only the dev-source URL/provider-injection test is excluded from production because production serves bundled entries (local full gate proves it). Jev stays disabled, recorded tour is explicitly replay.

Root personally inspected nine new production PNGs: held table, both ready layouts, moved-seat question, both formed-group conversations, questioner/portrait camera and bay. Captures `viewer/e2e/artifacts/prod-smoke-19/`; gate/performance/evidence/browser/camera/bay logs and audits under `.cloudflare/`; deployment helper report `briefs/room-setup-release.REPORT.md`. Prior-refusal global banner remains visible after remedy; fine fingers and broader camera composition are not certified. Camera owner retired with docs-only handoff; no further camera implementation added.

Original inventory remains38fixed/36reclassified/142remaining (216 recoverable); broad deferred rows were not closed to count this bounded capability. Furniture/setup tranche exits here. Next6–10working-hour bounded food-break increment assumes existing passing bindings need no shared physical redesign; full communal day/autonomy/reuse are subsequent outcomes.


## production-deploy-20-2026-09-30-shared-food-break

Exact source **043806eacd6d8284885513e7d220c25193116c6f** passed the clean rebased gate before local-main fast-forward. Live **ec7ff2a6-4a8d-41e8-95ae-3bf920931dfe**, created06:45:48.789Z/deployed06:45:50.850Z, confirmed100%. Rollback **ce6daf22-caa7-4698-8b28-6b2a2935b7d3** (release19). Subsequent metadata/evidence/docs commits do not alter deployed source. Historical-agent dirty changes and all unfinished worktrees are preserved; no remote/push, pins, goldens or tolerances changed.

**Playable boundary:** /lab work-break-4 and8 keep one Runtime for interrupted notes → shared food → explicit same-task resumption. One registered shared_food_break intent takes utensils, serves, gathers, eats and returns to approved slots through existing physical actions. Safe Stop drains actual children; ordinary courtyard commands preserve independent player control. Held items and partial food persist; retry does not duplicate takes/serves. Actual floor/wait/return state is visible; renderer attention observes currently group-owned listeners. Manual steps remain available. Explicit refusal dismissal retains diagnostics/history and cannot hide invariants/render failures.

| Check | Result |
|---|---|
| Full gate | GREEN .cloudflare/gate/2026-09-30T06-22-38-018Z/report.json;043806e,gitDirty:false,cleanupError:null |
| Lint / both TypeScript configs | Clean |
| Unit |99 pass /0 fail |
| Engine |807 total:790 pass /0 fail /6 documented skip /11 TODO |
| Browser |109 pass /7 documented skip,1063.2s |
| Flagship / probe |Byte-identical; unchanged b746b0947e651c054506ccdb6568d5216a84c2d0f0304fda1b8261ba62e7f0c3 |
| Local control plane |All36 MCP tools pass |
| Idle performance |Original250/120ms peak,3ms mean/pins pass; exact107.234167ms/0.6904529142ms, corridor53.22275ms/0.5391477792ms;0violations. Historical grids103.771–175.457ms (<1000ms) |
| Regenerated evidence |790/0;17 rows/8 milestones PROVEN,capabilities25/2/1 retain exceptions |
| Production |341assets/19routes/range/auth;all36tools;director9steps8895ms;26 browser journeys pass(3.2min) |
| Compiled camera / bay |Published camera read-only follow/return/Continuous/portrait/reset/dispose,0diagnostics/errors; bay10901ticks43steps5checks0violations/errors/exact hash |

Prepare340files/821.1MiB; dry415files,6963.59KiB/1253.65KiB gzip;5new assets/382existing,startup90ms. Eight verified large-object receipts unchanged: **zero R2 writes**. Release helper found no build warning/error matches. Dev-source/provider-injection camera test is excluded only from production because it imports unbundled source; full local gate proves it, compiled public entry is independently verified. Jev remains disabled. No new camera implementation or paid calls.

Root inspected9productionPNG: six meal/rotating-floor/resumed-notes captures, questioner/portrait and build-bay. Captures e2e/artifacts/prod-smoke-20; audits .cloudflare/audit/prod-camera-20.json and prod-lab-20.json; root shared-food-production logs; helper *release-20.log and briefs/work-break-release.REPORT.md. First focused UI proof incorrectly required a nonzero head angle for already-facing people; original failures retained, corrected proof measures real targets and bounded finite turns without changing simulation/limits.

Supported standing pair, ground-floor authored service/return points, abstract portion fractions, separate explicit work resume. No seated dining, nutrition/needs, autonomous day scheduling, arbitrary serving-table rebind or active-activity snapshot restore. Fine finger/clothing precision remains deferred. The existing classroom and food presets are separately selectable; connected same-world attendance is the next candidate, not a released20 claim. Original216 rows remain recoverable:38fixed/36reclassified/142remaining.

Rollback from viewer:
```sh
WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler rollback ce6daf22-caa7-4698-8b28-6b2a2935b7d3 --name mars-campus-2026 -m "rollback release20: <reason>"
```


## production-deploy-21-2026-09-30-continuing-classroom-day

Clean source **8d214a5c250243da7e7b7a08ac7a3a9dfbf68f3d** passed the full rebased gate before local-main fast-forward. Live **3238c275-9311-436a-9a75-9526aa4a02ab**, created07:27:47.362Z/deployed07:27:49.444Z,100%. Rollback **ec7ff2a6-4a8d-41e8-95ae-3bf920931dfe** (release20). Subsequent documentation/evidence/metadata do not change deployed source. Local-only Git; historical dirty main and unfinished candidates preserved. No pins, goldens, tolerances, historical values or camera implementation changes.

**Playable boundary:** both hypothetical work-break4/8 rooms expose the actual classroom/setup in the same Runtime. Worker interrupts notes, joins the spare seat, asks/questions, observes presenter rotation and smaller conversations/departure, shares food with visitor and returns utensils before resuming the same notes. Physically prepared side layout is demonstrated. Manual food-conversation ending targets only the actual food pair; busy-worker notes and one-control-path room-count mapping are guarded. No autonomous phase chaining/day scheduler, nutrition model, arbitrary layout optimizer or active-activity snapshot restoration. One spare audience seat and authored ground arrangements remain constraints.

| Check | Result |
|---|---|
| Full gate | GREEN `.cloudflare/gate/2026-09-30T07-04-25-430Z/report.json`;8d214a5,gitDirty:false,cleanupError:null |
| Lint / both TypeScript configs | Clean |
| Unit |99 pass /0 fail |
| Engine |807 total:790 pass /0 fail /6 documented skip /11 TODO |
| Browser |112 pass /7 documented skip,1089.4s |
| Flagship / determinism | Byte-identical; completed b746b0947e651c054506ccdb6568d5216a84c2d0f0304fda1b8261ba62e7f0c3 |
| Local integration | All36MCP tools, isolation/auth/method/limits PASS |
| Original idle ceilings | Zero violations; exact peak109.394792ms/mean0.6757439367ms; corridor53.698084/0.5372689542ms; historical grids102.480375–174.5675ms. Existing250/120ms peak,3ms mean and1000ms grid limits retained |
| Regenerated evidence |17rows/8milestones PROVEN; capability25/2/1 and documented exceptions retained |
| Production infrastructure |341assets/19routes/GLB range/auth; all36tools; director9steps9378ms PASS |
| Production browser |29/29(3.5min), new continuity journeys and existing classroom/food/furniture/Studio/camera hooks |
| Published camera | Paused-world observational controls/reset/portrait aspect0.5232558;0diagnostics/errors. Dev-source provider-injection case stays local-only and excluded by exact title from production, not counted as pass |
| Production bay |10901ticks/43steps/5checks/0violations/errors; exact unchanged b746 hash |
| Visual inspection | Root inspected11production PNGs:8continuity question/groups/food/resumed plus2camera/1bay |
| Build/deploy | Prepare340files/821.1MiB; dry415files/6963.59KiB/1253.65KiBgzip;4newassets/383existing; startup97ms;0R2writes (8verified existing objects) |

Logs/audits/captures: `viewer/.cloudflare/continuing-day-*.log`, `viewer/.cloudflare/audit/prod-{camera,lab}-21.json`, `viewer/e2e/artifacts/prod-smoke-21`. Helper deployment receipts/report: `briefs/continuing-day-release.REPORT.md`. Tag `release-21-continuing-classroom-day` identifies exact validated/deployed source.

Rollback from viewer:
```sh
WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler rollback ec7ff2a6-4a8d-41e8-95ae-3bf920931dfe --name mars-campus-2026 -m "rollback release21: <reason>"
```


## production-deploy-22-2026-09-30-quiet-seated-rest

Clean source **aa3317ad98a09ae1febe07ffc1b5ebcdc506f70f** passed the full rebased gate before local-main fast-forward. Live **8695c09e-1ae8-4315-bcc7-1572189722fb**, created08:15:35.216Z/deployed08:15:37.413Z,100%. Rollback **3238c275-9311-436a-9a75-9526aa4a02ab** (release21). Later metadata/docs/evidence do not change deployed source. Historical-agent dirty main and all prior candidates preserved; local Git only, no pins/goldens/tolerances/history/camera implementation changes.

**Playable boundary:** quiet seated rest in work-break4/8 uses ordinary registered sit/stand/cancel at the real spare chair, including physically prepared side layout. Hands-free preference explains utensil returns. Actual occupancy/claims and proven own root-action return lineage drive controls; foreign/classroom sits are never adopted. Get up/Stop safely release seating before explicit notes return or permanent direction. Ordinary temporary direction retains existing engine return. Same unfinished notes survive food/rest and resume2.1/30s from2s. Ephemeral panel identity is not GUI snapshot/browser-reload restoration; no sleep, recovery timer, nutrition or autonomy model. Initial duplicate sibling React key failure4failed/5passed retained and corrected by unique panel key without assertion/tolerance changes.

| Check | Result |
|---|---|
| Full gate | GREEN `.cloudflare/gate/2026-09-30T07-51-05-026Z/report.json`;aa3317a,gitDirty:false,cleanupError:null |
| Lint / both TypeScript configs | Clean |
| Unit / engine |99pass/0fail;807engine total:790pass/0fail/6documentedskip/11TODO |
| Browser |116pass/7documentedskip,1118.7s |
| Flagship / probe | Byte-identical; completed b746b0947e651c054506ccdb6568d5216a84c2d0f0304fda1b8261ba62e7f0c3 |
| Local integration | All36MCP tools/isolation/auth/method/limits PASS |
| Original idle ceilings | Zero violations/pinned outcomes; exactpeak110.37375ms/mean0.6844038175ms; corridor53.475625/0.5389009183ms; historicalgrids103.776959–194.966166ms. Existing250/120ms peaks,3ms mean and1000ms grids unchanged |
| Regenerated evidence |17rows/8milestonesPROVEN; capability25/2/1 and documented exceptions retained; no missing/ambiguous/file/failing-test problems |
| Production infrastructure |341assets/19routes/GLB range/auth;36tools; director9steps7648ms; live100% |
| Production browser |33/33(4.0min), including4rest cases plus existing classroom/continuity/food/setup/Studio/observer camera |
| Published camera | Paused-world controls/reset/portrait0.5232558;0diagnostics/errors. Exact dev-source provider-injection title excluded only from production; local fullgate covers it, compiledentry checked separately |
| Production bay |10901ticks/43steps/5checks/0violations/errors; unchanged exactb746 hash |
| Visual inspection | Root9productionPNG:4restseated/resumed,2continuing8question/groups,2camera/1bay. Worker4androot2finalcombined rest captures inspected as well |
| Build/deploy | Prepare340files/821.1MiB;dry415files/6963.59KiB/1253.65KiBgzip;4newassets/383existing;startup96ms;0R2writes/8verifiedexistingobjects |

Proofs `viewer/.cloudflare/quiet-rest-*.log`, `viewer/.cloudflare/audit/prod-{camera,lab}-22.json`, `viewer/e2e/artifacts/prod-smoke-22`; preserved original failure/focused bundles `codex-quiet-rest-{1,2}`. Helper receipt/report `briefs/quiet-rest-release.REPORT.md`. Tag `release-22-quiet-seated-rest` identifies exact validated source.

Rollback from viewer:
```sh
WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler rollback 3238c275-9311-436a-9a75-9526aa4a02ab --name mars-campus-2026 -m "rollback release22: <reason>"
```

Recorded camera replay comparison with release21: only top-level branch/commit provenance differs; all other case/record data is identical. The static payload SHA changes for that provenance, not camera behavior, take outcomes or golden baselines.


## Production deploy 23 (2026-09-30, exposed Lab repairs)

Clean exact source **cb376037d3b63173cda30a9642ad18e8d9076cff** passed gate before deployment. Live **d88e1112-a018-4f08-9ed0-350c6f0b63ee**, created 16:49:25.879Z / deployed 16:49:28.354Z, confirmed 100%. Rollback **8695c09e-1ae8-4315-bcc7-1572189722fb** (release 22), confirmed before rollout. Metadata/evidence/report commits do not change built source. All historical dirty paths and prior worktrees preserved; no remote/push.

Safe body first-Step/Play/Reset and detached synthetic probes are repaired. Atomic staging refusal prevents orphan climbs. Pile/component palette matches existing renderer colors; aggregate extraction remains unanimated. **Current reconciled 2022 first-bay/full layouts remain unsupported with three/nine named blocked beams, zero actions before refusal.** Original W51 FIXMEs remain. Supported exact historical-source full completion is separate mandatory proof, not current-layout acceptance.

| Check | Result |
| --- | --- |
| Exact-source full gate | GREEN `.cloudflare/gate/2026-09-30T16-20-40-253Z/report.json`; cb37603, gitDirty:false, cleanupError:null |
| Lint / both TypeScript | clean |
| Unit / engine | 99 unit; 797 engine pass / 0 fail / 6 skip / 11 TODO |
| Browser | 126 pass / 7 skip, 1225.6s |
| Historical full completion | 55.8s / 117277 ticks / 66 parts/zero violations/clean crew; unchanged d382e461…0617 |
| Flagship / probe / local MCP |unchanged flagship/b746b094…f0c3; all 36 tools |
| Original idle performance | exact 103.568166ms peak/0.6586651475ms mean, corridor 50.58925/0.5199626625; grids 103.056666–173.63225ms; zero violations/original ceilings/pins retained |
| Regenerated evidence | 797/0; 17 rows / 8 milestones PROVEN; capabilities 25/2/1 retained |
| Build / rollout | prepare 340 files / 821.1 MiB; dry 415 files / 6963.59 KiB / 1253.65 KiB gzip; 18 new assets / 369 existing; startup 114 ms; zero R2 writes |
| Production infrastructure | 341 assets / 19 routes / range / auth; 36 tools; director nine steps, 13186 ms PASS |
| Frozen compiled camera / exact bay |published observer hash unchanged/portrait/reset/dispose/0diagnostics/errors/disabled Jev; bay 10901 ticks / 43 steps / five checks / zero violations/errors/exact b746 hash |
| Production repair browser / fresh URLs |5/5 focused 34.4s;3/3 fresh direct URLs, zero violations/errors |
| Visual inspection | root 12 PNGs across repair/lifecycle/camera/bay |

Both prior RED gates retained. First bde7e3f color proof incorrectly executed unsupported current house; explicit exact historical fixture now uses one separately named inspected baseline, preserving original baseline/tolerances. Second 3108f08 reached aggregate 1200s watchdog after 116 passed cases/no test failure; later stages not run, cleanupError:null. cb37603 raises only serialized whole-suite watchdog 20→25min for 133 cases; green 1225.6s confirms capacity need. Individual deadlines/assertions/pins/performance ceilings remain unchanged. Original harness/cold-guard attempts stay preserved.

Fresh production body: automatic tick 15→Step 16,Reset 0→Step 1→Play 20. Current houses: 0→Reset 0→Step 1→Play remains 1, zero action records/movement, named 3/9 refusals. **Manual Step advances one fixed tick even when admission declined.** Initial fresh audit assumed tick 0 after Step/Play and failed; corrected audit matches normal clock behavior. Preserved `.cloudflare/repair-failures/prod-fresh-clock-assumption`; no source/physics change. Final captures wait for rendered HUD.

Root personally inspected 12 PNGs in `viewer/e2e/artifacts/prod-repair-23` and `prod-repair-23-fresh-3`, including three frozen helper camera/bay captures under `prod-smoke-23`. Helper logs/audits `.cloudflare/*release-23.log` and `audit/{http-smoke,prod-camera-23,prod-lab-23}.json`. Details: `briefs/live-lab-repairs-release.REPORT.md`. Paid provider/MP4/camera iteration absent; dev-source injection remains local proof. BUILD-02 off-axis staging/delivery and unanimated extraction remain limitations; no historical geometry/color facts or state pins changed.

Rollback from viewer:
```sh
WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler rollback 8695c09e-1ae8-4315-bcc7-1572189722fb --name mars-campus-2026 -m "rollback release23: <reason>"
```


## Production deploy 24 (2026-09-30, purposeful routine)

Exact clean source **7648dbfb1a9963df0c63e3c3e380b724389e9cb2** passed full gate before main integration/deployment. Live **0bb846b0-25de-4db3-9f3e-7e0ae5409dcc**, created 18:48:53.181Z/deployed 18:48:55.603Z, confirmed 100%. Rollback **d88e1112-a018-4f08-9ed0-350c6f0b63ee** (release 23), confirmed before rollout. Root main integration retained historical dirty binary diff/inventory byte-identically; helper never touched dirty main. Local Git only, no remote/push; metadata/evidence commits do not change deployed source.

One explicit bound intention joins the actual classroom, asks worker's question, observes both presenters/formed conversation, departs, performs one shared meal/utensil returns, five-second occupied quiet rest/get-up, then completes the same unfinished notes. Start/Pause/Resume/End and retained obligation readouts are exposed in work-break 4 / physical-side 8 rooms. Children retain ordinary physical authority; unrelated directives win. Activities version 8→9 is an additive capability. Ended routines retain their own task progress even when a new task uses identical labels. No physical pins/goldens/tolerances/history changed.

| Check | Result |
| --- | --- |
| Full exact-source gate | GREEN `.cloudflare/gate/2026-09-30T18-19-37-557Z/report.json`; 7648dbf, gitDirty:false, cleanupError:null |
| Lint / unit / both TypeScript | clean; 99 unit passes |
| Engine |821 pass / 0 fail / 6 skip / 11 TODO |
| Browser |130 pass / 7 skip, 1242.6s |
| Flagship / probe / local MCP |unchanged flagship/b746b094…f0c3;all 36 tools |
| Original idle ceilings |zero violations/pinned outcomes;exact peak 107.662833ms / mean 0.6849538975ms, corridor 51.810458/0.5383040483ms;original 250/120ms peak, 3ms mean,<1000ms historical grids |
| Regenerated evidence |821/0;17 rows / 8 milestones PROVEN;capabilities 25/2/1 retained |
| Build / rollout |340 files / 821.1 MiB;dry 415 files / 6990.09 KiB / 1258.91 KiB gzip;4 new assets / 383 existing; startup 120ms;zero R2 writes |
| Production infrastructure |341 assets / 19 routes/range/auth;36 MCP tools;director nine steps 10251ms PASS |
| Frozen compiled camera / exact bay |unchanged paused hash f7db899e…065/portrait/reset/dispose/zero diagnostics/errors/hidden Jev;bay 10901 ticks / 43 steps / five checks/0violations/errors/exact b746 hash |
| Published browser |14/14 in 1.8min:purposeful 4, quiet-rest 4, body 2, tour 1, bay 1, current unsupported-house 2 |
| Visual inspection |root 27 production PNGs (24 journey + 3 helper camera/bay) |

Prior 2acb72b gate was deliberately SIGINT-interrupted after read-only review found reused-station progress defect; RED report 17-53-23-398Z/clean cleanup retained,not green. Corrected getter retains ended-task progress with distinct and identical actor/task/duration reuse regressions. Incorrect hidden-button reuse harness failed before product assertion; preserved `.cloudflare/repair-failures/purposeful-reuse-ui-assumption`. Actual exposed Start notes proof passed; no deadline/outcome changes. Existing release 23 RED/watchdog/fixture history remains retained.

Root actual production 14 journeys cover both purposeful layouts, partial-meal Pause/End, quiet rest, body controls/probe isolation, discovery, supported component identity/install and both current-house actual Play/Step/Reset refusals. Same-label new notes task progresses while completed routine remains 30s. Root inspected 24 PNGs in `viewer/e2e/artifacts/prod-purposeful-24` plus three helper camera/bay under `prod-smoke-24`. Root ignored config `.cloudflare/prod-routine-24.config.ts`; helper logs `.cloudflare/*release-24.log`; audits `audit/{http-smoke,prod-camera-24,prod-lab-24}.json`; report `briefs/purposeful-routine-release.REPORT.md`.

Supported boundary remains authored directed intentions, not autonomous needs or sleep. Active snapshots/persistence unsupported; other attendees park at authored departure positions, next slice unverified. Current reconciled 2022 first-bay/full houses remain unsupported with 3/9 named blocked beams; original skips/FIXMEs are not passes. Recorded camera comparison remains replay; provider disabled/local injection proof retained; no new camera/MP4/paid provider work. Eight verified unchanged content-addressed large objects yielded zero R2 writes; no new migration. Build log has no warning/error matches.

Rollback from viewer:
```sh
WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler rollback d88e1112-a018-4f08-9ed0-350c6f0b63ee --name mars-campus-2026 -m "rollback release24: <reason>"
```


## Failed release 25 and rollback (2026-09-30)

Local clean candidate **73eda3931e791706db5386cf67c438a39ab11284** passed full gate `.cloudflare/gate/2026-09-30T20-11-03-728Z/report.json`: 99 unit / 845 engine passes, zero fail / six skip / 11 TODO, 137 browser passes / seven skip in 1300.8s, clean lint/both TypeScript/unchanged flagship/probe/all 36 local MCP tools. Original idle ceilings and regenerated LOCAL evidence passed; these do not certify production. Prior 19-13-27 RED and 19-50-00 SIGINT RED reports remain retained. Candidate adds bounded attendee follow-ups and independent fixed primitive studio; imported appearance/autonomy remain excluded. Current historical house 3/9 refusals and original skips remain.

Temporary deployment **2edcf368-baeb-4dbf-aea7-da48ccccee62** uploaded four new assets / 383 existing, startup 115ms; dry 415 files / 7005.18 KiB / 1261.22 KiB gzip. Eight verified existing large objects skipped, zero R2 writes. HTTP 341 assets / 19 routes / range / auth passed. Production MCP failed after direct-camera checkpoint with **Cloudflare 1102 Worker resource limits / HTTP 503**, ray `a43611434c821f8d`, timestamp 20:44:45Z. Serial checks stopped: director/status/camera/bay and root production journeys did not run; no all-36 production MCP pass or release 25 PROD_VERIFIED claim. Failure retained in `viewer/.cloudflare/mcp-release-25.log`.

Root explicitly authorized rollback to verified release 24. Wrangler 4.136.2 rollback succeeded; **actual live version 0bb846b0-25de-4db3-9f3e-7e0ae5409dcc is 100%**, rollback deployment created **2026-09-30T20:46:47.577Z**. HTTP 341 assets / 19 routes / GLB range / auth passed at 20:49:17.609Z; separate main page 200 in 0.864s. No MCP retry, source change or DO-state rollback claimed. Source 73eda39/worktrees/failed attempts/logs preserved. Metadata identifies live 24 and explicit failed-25 rollback receipt; candidate EVIDENCE.md/evidence.json remains local proof, not live-24 validation. No successful release-25 tag implied.

Logs: `viewer/.cloudflare/{mcp,rollback,rollback-status,rollback-http}-release-25.log`; local gate/perf/evidence/build/upload/dry logs retained beside them. Chronological disposition: `briefs/after-gathering-release.REPORT.md`. Root investigates resource limits with fresh isolated baseline-24 rooms before choosing further source/deployment work.

## Production deploy 26 (2026-09-30): degraded computer appearance

Actual live **26 version `01a29ba2-76cd-4b26-8a64-02c77d4f5f22`**, exact source `c43e382cd2c1f8ec7915b613edbd2b71569e5fd0`, deployed 21:50:54.558Z at 100%; rollback **24 `0bb846b0-25de-4db3-9f3e-7e0ae5409dcc`**. Local exact clean gate `2026-09-30T21-21-39-867Z` GREEN: 115 unit, 845 engine/0 fail/6 skip/11 TODO, 140 browser/7 skip, lint/both TypeScript/unchanged flagship/probe/all36 local MCP, cleanup null. Original idle ceilings and local regenerated evidence passed; local proof does not certify all published assets.

Build/dry passed; replay 18,404,147 bytes verified static/source receipt. Prepare 340 files/821.1MiB; dry 7005.85KiB/1261.40KiB gzip. Deploy 13 new assets/374 existing, startup94ms. Eight manifest/receipt objects unchanged and skipped, **zero R2 writes**. HTTP341 assets/19 routes/range/auth, traced production all36MCP, director9steps9194ms, frozen compiled camera and exact bay passed. Safe tail retained only outcome/cpuTime/wallTime/scriptVersion: 213 events allok, maxCPU752ms/maxWall874ms, exact26version. This is a sampled tail, not complete CPU attribution or proof of an1102fix; failed25 exact tool/CPU-v-memory cause remains unknown.

Root production browser disposition is **13 passed, one failed, one interrupted**: 12 activity/Reach journeys and injected fallback passed; loaded-computer case **FAILED404**, primitive fallback shown. Reset case **INTERRUPTED SIGINT130** after the known cause. Model/attribution were absent from `prepare.py` allowlist and prepared manifest, so the341-asset sweep did not check them. No full production pass, loaded appearance success or successful26appearance tag claimed. Release26 remains live with coherent primitive fallback; explicit two-file packaging repair `17e5962` is pending its required full gate and later publication.

Logs/captures preserved: helper `.cloudflare/*release-26.log`, `tail-safe-release-26.jsonl`, `audit/prod-{camera,lab}-26.json`, `e2e/artifacts/prod-smoke-26`; root `studio-computer-appearance/viewer/e2e/artifacts/codex-production-combined-26` and `.cloudflare/prod-combined-26-results`. Details: `briefs/studio-computer-release.REPORT.md`. No camera development, provider calls, retries, pins/goldens or historical changes.

## Production deploy 27 (2026-10-01): verified museum and playable checkpoint

Live version **ef61dfc5-e0b7-469b-ab61-3b61f8b8b5cd**, deployed08:13:38.798507Z at100%; exact clean functional source **879c88ac0354b47eee81ce766401160d2503753d**. Actual prepublish rollback **ad241a52-e8d6-4c47-831e-557df9d5692a** retains the interim historical museum. Main fast-forwarded only after source gate GREEN and a verified278-file preservation snapshot:191 pending files already included,38 distinct future files restored,46 noncolliding files untouched,3 shared intent merges. No other agent work was discarded; dirty future historical geometry is not this release. Clean release build is isolated from dirty main.

| Required check | Executed result |
|---|---|
| Lint / unit |PASS /206PASS,0fail |
| Engine |860PASS,0fail,6documentedskip,11TODO |
| Viewer + camera TypeScript |bothPASS |
| Browser gate |147PASS,0fail,7documentedskip;28.5min |
| Flagship take / deterministic probe |PASS /10901ticks, unchangedb746b094…7f0c3 |
| Local MCP |20legacy+16engine eachcalled;isolation/authPASS |
| Idle performance |original peak/mean/grid ceilingsPASS, no tolerance changes |
| Production |500assets/19HTMLroutes/range/auth/exactmodel+creditSHA, all36MCP,9directorstepsPASS |
| Published UI |16/16PASS plus exact bay and frozen camera proofs;34actualPNGs reviewed |

Gate report: viewer/.cloudflare/gate/2026-10-01T07-18-41-571Z/report.json (oktrue,gitDirtyfalse,cleanup/interruptionnull). Releaseworktree viewer/.cloudflare contains build/prepare/performance/deploy/status/curl/MCP/director logs and audit receipts. Prepare499files841.4MiB; dry580staticfiles8143.95KiB/1423.86KiBgzip; deploy31new/515existing,97msstartup. Eight unchanged large objects skipped,zeroR2writes. Selected computer139184bytes and credit813bytes match exact manifest SHA/provenance.

Published tests exercise actual Play stair ascent/descent (209 weighted samples each, closestleft−.0917m/right+.0800m,0violations), loaded/fallback computer and strict delayed-reset disposal, tour, Reach freshStep/Reset/Play and renderer isolation, actual designated Chiba WASD tiers and thin-table obstacle,4/8 purposeful routines and partial-mealPause/End, and current2022firstbay/whole through s0021 plus fixed-tick completion with canonical24/66identities,201/555steps and exact Node hashes. Full automatic current2022completion at normalUI8x passed separately LOCAL2/2 in21.5min; published completion proof combines actual Play through s0021 with responsive500tickchunks. Do not imply the entire published house was watched through automatic Play here. Oldsource-era W51FIXMEs remain excluded, not certified fine-pose fidelity. Frozen compiled camera controls/portrait/reset/dispose preserve paused authority; no camera development.

Initial nativeNode HTTP sweeps failed before response with connectiontimeouts; all attempts retained, no1102observed. Curl's first no-Accept-Encoding request differed from nativefetch and failed the large-model length assertion; explicit native-equivalentgzip,deflate returned exact70772556byte identity headers and passed the complete unchanged sweep. First productionMCP/director passed under documentedNodeIPv4flags. Sanitized sampledtail202events allok,maxCPU475ms/maxWall634ms/exactversion; not complete CPU attribution or proof that failed25's unknownresource cause is fixed. No repeated deployment or hidden failure suppression.

Included ready furniture/classroom/questions/rotation/conversation,4/8 unfinished-work→gathering→food/rest→return, independent fixed studio, computer and safe-drop/reset repairs, frozen museum, designated access and current-rig stair correction. Excluded: unverified paired-day integration and future historical/sourcevisibility corrections, broad autonomy/needs, reading/chess/music/mealpreparation/sleep breadth, fine anatomy and construction roof/plywood choreography. The aggregate stock-to-individual conversion is explicit; identity persists after extraction, not physical pile-removal fidelity. Whole Mars MVP estimate remains45–75workinghours,medium-lowconfidence; October5 is tight if a new physical prerequisite appears. Prefer bounded interactions over expanding rig/furniture fidelity. Paired regroup recovery is already under focused validation, not shipped in27.

Evidence refresh:860PASS/0fail/6skip/11TODO; two stale citation names corrected to the actual unchanged source-era tests. Strict external-proof policy marks uncommitted viewer receipt/citation edits stale relative to the deployed879 gate: generated14PROVEN/3PARTIAL rows,18PROVEN/9PARTIAL/1UNPROVEN capabilities. Preserve that distinction; the exactclean879 gate and published proofs above remain valid. The next functional candidate’s clean gate will refresh current-document external provenance; no evidence guard was weakened.

## Production deploy 28 (2026-10-01): shared-walk continuity

- Live: https://mars-campus-2026.<workers-subdomain>.workers.dev/lab?scenario=work-break-4
- Version100%: `657cce5b-14d4-467c-8550-26db10423d5f`; deployed09:42:00.232051Z.
- Exact functional source: `9b857930507a6bd03100d4d4ab5a9255888bc118`; rollback release27 `ef61dfc5-e0b7-469b-ab61-3b61f8b8b5cd`, verified100% immediately before publishing.
- Clean gate: `paired-regroup-continuity/viewer/.cloudflare/gate/2026-10-01T08-57-39-002Z/report.json`, copied into isolated release28worktree; HEAD9b,dirtyfalse,oktrue,interruptednull,cleanupnull.

| Required check | Executed result |
|---|---|
| Lint | zero warnings/errors |
| Unit |206pass,0fail |
| Engine |893pass,0fail;6skip,11TODO not proven |
| Both TypeScript projects |0errors |
| Browser |150pass,0fail;7documented skips,28.8min |
| Flagship take |unchanged checkPASS |
| Determinism probe |completed10901ticks, unchanged `b746b0947e651c054506ccdb6568d5216a84c2d0f0304fda1b8261ba62e7f0c3` |
| Local simulation |all36MCP/isolation/auth/method/body checksPASS |
| Idle performance |originalstress30state/0violations and250/120ms peak,3ms mean; everyyeargrid<1000msPASS |

New playable scope: optional samefree-handedpair regroups/walks down the authored
ground aisle before existing sharedmeal/rest and same unfinishednotes, Mars4/8 and
independentstudio. Pause/Resume/playerhandoff/end retain coherent progress/cleanup.
Only regroup's owned ordinary `traffic.person` walker waits for existing recovery;
unchanged100tickno-progress failure/harddiagnostics prevent indefinite strands.
No arbitrary escort, loaded/stairpair walking or guaranteed persistentcrowdcompletion.

Prepare499files841.4MiB; dry580assets8161.90KiB/1428.22KiBgzip;4new542existing
uploads,94msstartup. All8largeobjects unchangedSHA17a92…/8skipped/0R2writes.
Exact27staged browsercache copied locally and SHAchecked; futureownerexport cache
changes cannot affect this clean source release. Computer139184bytesSHA6f36…bf5
and exact813byteCC-BY4.0credit preserved; sixcase18404144bytecamera replay freshly
built/validated. Camera policies/experiments untouched.

Production: root3/3actualPlay proofs (Mars4/8 plus actualstudio crossing),32.6s
combined; all7captures/contactsheet inspected.500assets19routes642curlrequests,
range/auth and exactcomputer+creditSHA PASS. FIRSTall36MCP/isolation/auth PASS using
documented `--no-network-family-autoselection --dns-result-order=ipv4first`;
FIRSTdirector9stepsPASS13388ms. Safe sampled186tailoutcomesallok exact657version,
maxCPU929/maxWall1071ms. This sample is not a complete trace or proof of old25's
precise resource cause. NativeNodeHTTPsweep not rerun; successfulcurl uses equivalent
explicitAccept-Encodinggzip,deflate and original assertions.27transportREDs retained.

Evidence: isolated `<mars-worktrees>/mars-mvp-release28/viewer/.cloudflare/`
containsperf-release28.log, frozen-browser-cache.json, prepare/build/upload/dry/deploy/
status/curl-verification-ae/mcp/mcp-tail/director-release-28 logs, curl-28-ae/receipt.json
andtail-safe-release-28.jsonl; published3Play logs production-paired.log and
production-studio-paired.log, PNGs e2e/artifacts/release28-production. Main89owner
paths remain byte-identical/staged0; guardedsnapshot/audit in pairedcandidate
.cloudflare/main-preservation-paired-20261001. Savedfailedrecovery/setup reports
remain preserved. GeneratedEVIDENCE provenance has not been refreshed in this
receipt-only window; retain its PARTIAL flags, with clean9b gate/publicproof separate.

Excluded: unreviewed futurehistoricalgallery/sourcevisibility/export corrections,
reading draft, chess/music/preparation/sleep, broad autonomy and fine anatomy.
Next playable reading uses existingrig/support/seat execution and retainedbookmark.
WholeMVP forecast40–70workinghours medium-lowconfidence, bounded scope required.

## Production deploy 29 (2026-10-01): reading with a retained bookmark

Live: https://mars-campus-2026.<workers-subdomain>.workers.dev/lab?scenario=quiet-reading
Version100% `4fc6d1d6-2eba-494e-afa3-1a6a78a4ea85`, deployed11:03:29.172043Z;
exact functional09da6a000e445a7547d94dcdbb33031d823095ff. Rollback28
657cce5b-14d4-467c-8550-26db10423d5f verified100% immediatelybeforepublish.

| Required check | Executed result |
|---|---|
| Lint |zero warnings/errors |
| Unit |206pass,0fail |
| Engine |903pass,0fail;6skip/11TODO not proven |
| Both TypeScript projects |0errors |
| Browser |151pass,0fail;7documented skips,29m26s |
| Flagship take |unchangedPASS |
| Determinism probe |10901ticks, unchangedb746b0947e651c054506ccdb6568d5216a84c2d0f0304fda1b8261ba62e7f0c3 |
| Local simulation |all36MCP/isolation/auth/body/method checksPASS |
| Idle performance |originalpins/ceilingsPASS, exactpeak108.462ms/corridor50.968ms |

Clean gate seated-reading/viewer/.cloudflare/gate/2026-10-01T10-14-00-959Z/report.json:
HEAD09da,dirtyfalse,oktrue,interruptednull,cleanupnull. Guarded mainFF retains89
ownerpendingfiles/status; music and future museum source/export work excluded.

Now initiate reading at a real table/chair/book, interrupt safely, inspect retained
page/progress and resume the same unfinished purpose. Two physical orientations and
two independent readers have focused coverage; the exposed captured preset is one
small ground arrangement. No held-book reading, finger contact, newrig/library/IK,
arbitrary access links or active-session restoration. Safe quiescent JSON bookmark
restore supports explicit same-person/task resumption. Generic unsafe-drop guard
covers active reading equipment as well as computer work. Stair ankle correction
and shared-walk/camera/museum checkpoint remain unchanged; no new anatomy work.

Build/dry580assets8174.60KiB/1430.70gzip,28new/518existing uploads,87msstartup.
Eightlargeobjects verified unchanged/8skipped/0R2writes. Immutable browsercache
675f4beb/36ad67f7 copied before build, futureownerexports excluded. Exact selected
139184Bcomputer and813Bcredit SHA pass. Production500assets19routes642requests,
range/auth/allowlist and original equivalentgzip,deflate transport assertions PASS.
FIRSTall36MCP/isolation/auth/invalidrequests PASS with documentedIPv4Node options;
FIRSTdirector9stepsPASS13682ms. Safe131sampledtailoutcomesallok only29version,
maxCPU823/maxWall937ms; not complete attribution or diagnosis of old25resourcefailure.
Root actual published Play3/3PASS51.6s: reading/reset/firstStep/interrupt/resume,
retained4/8work-food-return. All11PNGs/contactsheet inspected. Frozen camera and
stairs have unchanged combined-gate coverage and earlier published27 proofs;
not falsely counted as new29publicbrowser cases.

Ignored receipts/logs in isolated mars-mvp-release29/viewer/.cloudflare/:
release29-network-receipt.json,curl-29-ae/receipt.json, prepare/build/upload/dry/deploy/
status/MCP/director/tail and production-reading-walk.log; captures in
viewer/e2e/artifacts/release29-production. Generated EVIDENCE externalprovenance
has not been regenerated in this receipt-only window; original partialflags remain.
Music is a separate focused draft, chess/mealprep/sleep unstarted. Whole MVP40–70
workinghours medium-low confidence, existingrig/bounded interactions; targetOct5
requires surfacing newphysicalprerequisites early rather than expanding silently.


## Production deploy 30 (2026-10-01): computer music and independent listening

Verified100% `da02879a-bdf1-4896-975a-066eedb1da2e` at12:08:59.975443Z from
clean `479329689780bf30079bdc4bb54f2d35396fc006`; rollback29
`4fc6d1d6-2eba-494e-afa3-1a6a78a4ea85`. Public entry:
https://mars-campus-2026.<workers-subdomain>.workers.dev/lab?scenario=computer-music.

| Required validation | Result |
|---|---|
| Lint / both TypeScript projects | clean |
| Unit |207pass /0fail /0skip /0TODO |
| Engine |915pass /0fail /6documented skips /11TODO |
| Browser |152pass /0fail /7documented skips;29m56s |
| Flagship take |unchangedPASS |
| Determinism probe |10901ticks; unchangedb746b0947e651c054506ccdb6568d5216a84c2d0f0304fda1b8261ba62e7f0c3 |
| Local simulation |all36MCP tools/isolation/auth/body/method checksPASS |
| Idle performance |originalpins/ceilingsPASS; exactpeak114.329ms / corridor51.075ms |
| Published HTTP |500assets /19routes /642requests, exactcomputer+creditSHA/range/authPASS |
| Published control plane |FIRSTall36MCP/isolation/authPASS; FIRSTdirector9steps13451msPASS |
| Published actualPlay |music+reading2/2PASS; all6captures inspected |

Clean combined report: computer-music/viewer/.cloudflare/gate/2026-10-01T11-22-37-536Z/report.json,
HEAD4793296,dirtyfalse,oktrue,interruptednull,cleanupnull. Guarded main functionalFF
preserved99ownerpendingpaths/status/SHA/staged0. Browser aggregate watchdog32min
accommodates the extra required39.6s case; individual deadlines/assertions/outcomes,
performance ceilings, pins, tolerances and exclusions unchanged.

Now initiate original electronic music at the existing usable computer, enable
sound, hear simulated note progression, pause/mute, direct one listener away,
interrupt and resume the same score for the remaining audience. Two groundtable
orientations and0–2listeners have focused coverage; one exposedpreset. Current
computer/rest poses and bounded gaze only: no acoustic-instrument/fingerchoreography,
newrig/IK/library or active-session restoration claim. Safe quiescent bookmarks
persist; explicit same-person/score/task resumption still runs normal admission.
Reading/bookmarks, shared walk and previous stair ankle repair remain unchanged.

Build/dry581assets8185.77KiB/1432.80gzip,23new/524existinguploads,104msstartup.
Eightlargeobjects exactly unchanged/8skipped/0R2writes; frozen browsercache675f4beb/
36ad67f7 retained. Selectedcomputer139184B andcredit813B match prior verified SHA.
Equivalentcurl gzip,deflate original checks PASS; nativeNodeHTTP not rerun.
Safe147sampled host outcomes allok/exact30version,maxCPU1145/maxWall1326ms;
this is not a complete trace, resource-ceiling guarantee or diagnosis of old25failure.
Actual public music41.3s/reading31.7s Play verifies nonzeroaudio/silentPause,
independent departure, safe interruption/resumption, nine opened/nine closed contexts
across Reset, reading firstStep/bookmark/same-book completion and0invariants.
Root inspected all6PNGs/contactsheet in release30-production. Camera/stair public
proof remains release27; this gate passes their retained tests, not new30publiccases.

Ignored receipts: mars-mvp-release30/viewer/.cloudflare/release30-network-receipt.json,
curl-30-ae/receipt.json, deploy/status/build/upload/dry/perf/MCP/director/sanitizedtail
and production-music-reading.log. Chess draft and historical e029f90 are preserved,
unmerged and excluded. Full historical combined validation remains its prerequisite.
Generated legacy EVIDENCE provenance flags remain explicit; no backlog completion
claim. WholeMarsMVP40–70workinghours, medium-low confidence with boundedchess,
mealprep/sleep/currentrig scope; October5 requires early tradeoffs for newprerequisites.

## Production deploy 31 — 2026-10-01 — 2026 accuracy checkpoint

- Source64517945c0bf0e109fb0a836611de9f4128d6362; version8f794aad-ddd7-4439-a840-707937429d54; published13:36:45.198Z,100%.
- https://mars-campus-2026.<workers-subdomain>.workers.dev/studio; rollbackda02879a-bdf1-4896-975a-066eedb1da2e.
- Clean full gate `.cloudflare/gate/2026-10-01T12-39-50-382Z/report.json`:241unitPASS,919enginePASS/6skip/11TODO,152browserPASS/7skip; TSc/lint/replay/independentprobe/MCP pass. Idleperformance zero violations. Build/dry/deploy pass;8largeR2 keys reused,0uploads.
- Public19routes/507assets/auth/method/range/computerSHA/credit pass649boundedcurl requests; nativeNodeETIMEDOUT retained. PublicMCP+director pass nativeIPv4first. `.cloudflare/curl-31-ae/receipt.json`, `mcp-accuracy31.log`, `director-accuracy31.log` retain proof. Fresh publicroomvisual not repeated; source combined runtime verified.
- Main645 with56unverified pending variants preserved; historical paired specialist additions excluded. Interimrelease, not seven-year completion. See historical-accuracy-2026.REPORT.md for observed/fitted uncertainties and accepted corrections.

## Production deploy 32 (2026-10-01): physical tabletop chess

Verified100% `c24b42b3-ff1f-4eea-8965-86c3ab4eb080`, deployed15:59:41.295Z.
Exact clean functional `084f4929fcf7c6d01113d99a4746d88bc47cdf1a`; rollback31
`8f794aad-ddd7-4439-a840-707937429d54` independently checked100% before publish.
Metadata-only31receipts preserved separately; frozen source/browser cache retained.

| Required check | Executed result |
|---|---|
| Unit |243PASS/0fail/0skip|
| Engine |941PASS/0fail/6skip/11TODO|
| Browser |154PASS/0fail/7skip|
| Lint / bothTSc |PASS/zero warnings|
| Flagshiptake / deterministicprobe |PASS/unchangedb746b0947e65…|
| LocalMCP / originalidleperf |all36PASS / original limits and pinsPASS|
| Publicactualchess |2PASS/0fail34.2s;5captures inspected|
| Publicassets / MCP / director |507assets/19routes/649requests;all36/9stepsPASS|

Standing players use 32 chess pieces, ordinary take and put, and the supported board/tray;
legal alternatives, same-token captures, interrupted physical rollback and director
handoff, quiescent board persistence and named cleanup-required recovery. No seated
chess/castling/physicalpromotion/strongAI/finefingers or active-session reload claim.
Retains historical31, audiblemusic/reading, classroom/setup/sharedwalk/camera and
downhillfoot fix. Mealprep/conservation/sleep drafts and futurehistorical changes
excluded. Two current2022 completion journeys executePASS; twooldW51FIXMEs and
other listed skips remain exclusions. First gateRED missing ignored CADcache
retained, fixed exact frozen31SHA files; no weakened assertions/pins/baselines.

Build588files8348.37KiB/1485.62gzip,29new/525existing uploads,140msstartup.
8largeobjectsunchanged/8skip/0R2writes. Published3resets exactly51geometries/
26textures; heldpawn pose target and renderedpalm match. Exact computer/credit
SHA/range/authpass. Curlgzip,deflate equivalent assertions pass; nativeNodeHTTP
not rerun. PublicMCPIPv4first flags documented; director actualpublic15042ms.
No new tail sample or failed25resourcecause claim. Evidence locations in
briefs/chess-table.REPORT.md and release32-network-receipt.json. WholeMVP40–70
workinghours/medium-lowconfidence; next physicalprep/sleep rather than chess polish.


## Production deploy33 — 2026-10-01 alumni presentation

Published100% `01437b0b-09de-48bc-99bb-ace4c03642bb` at18:18:56.229Z, functional source `7a2c826`, rollback32 `c24b42b3-ff1f-4eea-8965-86c3ab4eb080`. Root is fullscreen shared Studio with collapsible year/aerial/WASD/reviewed-room/time/EUC controls; photo retained at `/photo`, editor `/studio`, scenarios `/lab`. Reviewed historical source retained; meal/sleep drafts excluded. No DNS or Git remote changes.

Clean full gate:281unit PASS;943engine PASS,6skip11TODO;164browser PASS,7skip; lint0, both TSc, take, unchanged b746 probe and all36 local MCP PASS. Report `viewer/.cloudflare/gate/2026-10-01T17-33-53-236Z/report.json`. Original idle performance ceilings/pins unchanged PASS. Evidence17rows PROVEN, capabilities25PROVEN/2PARTIAL/1UNPROVEN; this does not certify skipped scenarios.

Public verification:21routes/521assets/677requests, exact computer/credit SHA, GLB range/auth; all36 MCP and director9steps PASS.12public browser checks PASS;20reviewed room views and controls/mobile/night/EUC/Reach/build captures inspected. Additional `YEAR_BUILD_FULL=1` public automatic Play2/2 PASS19.1min: first-bay201steps/24parts, whole555steps/66parts/123818ticks, zero violations, same identity/support and canonical pose. Both final captures personally inspected. Original W51 legacy FIXMEs stay excluded; skeleton completion does not certify plywood/roof or fine anatomy.

Main integration preserves48other owner pending paths byte/status/mode/mtime;8superseded selected originals retained with SHA audit in `viewer/.cloudflare/main-preservation-release33`.8large objects unchanged/0new R2 writes. Source-identified limitation: Aerial after EUC may leave rider following; WASD or Go inside releases it. Bounded handoff fix/regression queued with next meal batch, not a camera redesign. Whole Mars MVP40–70working hours, medium-low confidence, assumes bounded preparation/sleep and combined continuity. Continue immediately with saved preparation/output conservation, then supported sleep/unfinished-purpose day; no Eden expansion.


## Production deploy 34 (2026-10-01): proposed2027 and conserved cold preparation

Verified100% `515f3742-d764-4804-b545-f32b2e3cc22d` at20:47:17.403580Z from
exact clean functional `511101939f52a1d77814d4682331d5d125aee04e`.
Rollback33 `01437b0b-09de-48bc-99bb-ace4c03642bb` was independently confirmed100%
before publication. Proposed2027 is online at
https://mars-campus-2026.<workers-subdomain>.workers.dev/studio/2027 and
https://mars-campus-2026.<workers-subdomain>.workers.dev/?year=2027; default2026 stays retained.
Cold preparation: https://mars-campus-2026.<workers-subdomain>.workers.dev/lab?scenario=cold-preparation.

| Required validation | Executed result |
|---|---|
| Lint / both TypeScript projects |PASS/zero warnings|
| Unit |286PASS/0fail/0skip/0TODO|
| Engine |987PASS/0fail/6documented skips/11TODO|
| Browser full gate |168PASS/0fail/7documented skips;38m42.5s|
| Flagshiptake / determinism |PASS/unchangedb746b0947e651c054506ccdb6568d5216a84c2d0f0304fda1b8261ba62e7f0c3|
| LocalMCP / originalidleperf |all36PASS / exact111.961ms,corridor54.994ms peak;originallimits/pinsPASS|
| PublicactualPlay /2027 |preparation2/2PASS27.8s+27.5s;2027 2/2PASS8.9s+24.3s|
| Publicpresentation |freshunchanged3/3PASS3.5min, includingEUC→Aerial handoff|
| PublicHTTP /MCP /director |522assets/24routes/696requests;all36/9stepsPASS16861ms|

Clean combined gate `.cloudflare/gate/2026-10-01T20-02-20-385Z/report.json`
records5111019,dirtyfalse,oktrue,interruptednull,cleanupnull. Sixengine skips/11TODO
retain extraction and parkedW51 historical/fullA+B/kitchen/west-house diagnoses;
sevenbrowser skips retain parkedquestioncaptures/chapterbuilds and bothlegacyW51
FIXMEs. Current-source firstbay/whole-house automaticPlay throughs0021 and completion
executePASS in this gate. Release33 fullautomatic publicPlay2/2 proof remains prior
coverage; no new34construction publicbrowser run or plywood/roof certification.

Two finite ingredient bowls become exactly two prepared servings through the same
supported pot and heldspoon. Partial deposits survive interruption; explicit retry
continues the same objects. Ordinary take/serve/eat/put consumes bothservings without
filled-bowl overwrite, insufficient-portion creation or last-portion duplication.
Bothtable orientations pass actualPlay, Reset/Step and threereset resource lifetimes.
Scope is one hypothetical cold batch at an authored groundtable; no heat/chopping,
finefinger physics, historical recipe or active-session reload guarantee. Depleted
pot HUD may still sayreadyforserving despite0remaining and disabledservecontrols;
bounded readonly wording polish is deferred. Proposed2027 retains explicit concept,
fittedscale/unassignedcamp and drainage labels; no factualbuilt2027 claim.

First publicbrowser attempt retained4PASS and3failures during network loss:
yearnavigation received emptyURL, thenERR_NETWORK_CHANGED andERR_INTERNET_DISCONNECTED.
Read-only HTML/assets200 preceded one fresh unchangedpresentation retry3/3PASS.
No assertions/deadlines/source/pins/baselines were weakened. Initial log/traces remain
in `.cloudflare/release34-public-browser.log` and
`.cloudflare/test-results-release34-production`; fresh results in
`.cloudflare/release34-public-presentation-retry.log` and
`.cloudflare/test-results-release34-presentation-retry`.

Normalprebuild camera suite,prepare/build/dry/deployPASS:606dryassets,
8969.41KiB/1570.26gzip,19newassetuploads,161msstartup. Eightlargeasset manifests and
hashkeys exactly unchanged; priorverified receipt reused,8skips/0R2writes. Frozen
CAD/browser675f4beb/36ad67f retained. Equivalentcurlgzip,deflate originalsmokeassertions
PASS; additionalLabroute/2027JSON and exactcomputer139184B+credit813BSHA match.
GLBrange/auth/method assertionsPASS. NativeNodeHTTP timeout was not rerun;
IPv4first Nodeoptions retained for originalMCP/director. No newtail sample or old25
resourcefailure diagnosis claim. All10prep+2public2027+6freshpresentation PNGs
personally inspected; paths in `release34-network-receipt.json`.

Guarded mainfunctionalFF ce1c8af→5111019 preserved all48otherownerpending paths,
status/SHA/bytes/mode/mtime/staged0; zero changedcandidate overlap. Originalselected8
backups retained in alumni `main-preservation-release33`; newbefore/after34receipts
in main `.cloudflare/main-preservation-release34`. LocalGit only; noDNS/remotechange.
Sleep and prepared-day drafts remain separate/excluded. WholeMarsMVP40–70working
hours,medium-low confidence; next supported sleep and connected unfinishedpurpose
proof, no MarsMVP completion or Eden expansion claim.

## Production deploy 35 (2026-10-02): Mars MVP

Mars MVP accepted against the owner-approved bounded closing contract, publicly
accessible at **https://mars.college/simulation**. Worker release35 is100%
`adaf98f2-65d1-43b3-9c5d-761d555f2d5e`, published2026-10-02T02:39:46.918Z;
functional source `9958ed4a97f2cb5c7189ea7796b6502a0b9910de`.
Website source `1e3f005630bb9ea5aafb339904244c315b3df9a4`, deployment
https://mars-v2-pweg6frsu-gene-kogans-projects.vercel.app, aliasedmars.college.
Rollback: verified34 `515f3742-d764-4804-b545-f32b2e3cc22d`, existing
Wrangler rollback / versions deploy procedure; do not deploy a dirty working tree.

| Required final check | Executed result |
| --- | --- |
| Lint / viewer TSc / camera TSc | PASS, lint0 |
| Unit | 290PASS,0FAIL,0SKIP |
| Engine | 1053PASS,0FAIL,6SKIP,11TODO;122files |
| Browser | 173PASS,0FAIL,7SKIP;2255.404s |
| Take / determinism | PASS; b746b0947e651c054506ccdb6568d5216a84c2d0f0304fda1b8261ba62e7f0c3 |
| Local and public MCP | PASS; all36original tools/isolation/auth/invalid cases |
| Public director | Original9stepsPASS6458ms |
| Public HTTP | 522assets/24routes/696requests; GLBrange/authPASS |
| Fresh public browser | 8PASS,0FAIL,0SKIP:3prepared days,2sleep rigs,busycomputer,2stairs |
| Website | Build10routesPASS; public11links/footer/3actualdaynavigations/desktop+mobile/errors0PASS |

Exact clean nine-stage gate:
`viewer/.cloudflare/gate/2026-10-02T01-51-54-812Z/report.json`; source unchanged,
dirtyfalse, interruption/cleanupnull. Frozen CAD675f4beb/36ad67f retained.
Original assertions, individual deadlines, performance limits and planning pins
unchanged. The aggregate browser allowance was42minutes, justified before gate
by measured extra95.3s exceeding prior40minute capacity. Sixengine skips/11TODO
and sevenbrowser skips (including twolegacyW51FIXMEs) remain unproved; a green
total is not proof for them. Current-source firstbay/whole-house tests execute;
fullautomatic public33 proof is inherited, not rerun35. Production loaded-layout
unsupported preflight remains explicit; no arbitrary historical geometry guarantee.

Idle exact/corridor max112.032/54.444ms and historicalgridmax298.441ms pass original
ceilings,0violations. Strict exact-source native engine-proofSHA
`6fb2a96fe289d03aa9fc4503a10ff865a87200f40d3433d86abf9b3a5d02058a` permits evidence
regeneration4.167s reusing actual159.444s execution, not an inferred test pass.
Generated evidence references functional995, not the following metadata-only commit.
Initial RED356 SIGINTfixture failure and intermediate faf gate/evidence are retained;
fixture prerequisites repaired without weakening interrupt/cleanup assertions.

New supported sleep uses ordinary walking, grounded mat claims,2.1s lie/wake,
retained18s rest, coherent safe interruptions/directives and take replay. Three
prepared-day presets retain the same notes2s→30s through gathering, pairedwalk,
actual finite two-ingredient preparation/two shared meals/sleep, with independent
12s/20s discussion/work continuations. Mars8 physically prepares its side layout;
the independent studio shares mechanisms with distinct people/objects/project.
Repeated Reset keeps21geometry/22texture counts for bothsleep rigs. Stairposing
retains209samples in eachdirection and originalanatomical bounds; authorityunchanged.
The depletion label and conflicting prepared-day instructions are resolved.

Root/helper inspected all27 fresh enginePNGs+2liveinstructioncaptures, all7website
PNGs+4mobilecrops. Receipts/logs: `viewer/.cloudflare/release35-network-receipt.json`,
`release35-production-browser-receipt.json`, `release35-website-public/receipt.json`,
`prepared-day-final9958ed4-validation-receipt.json`, and release35deploy/build/HTTP/
MCP/director/website logs. Original normalCLI nonTTYauth rejection is retained as
context; existingOAuth TTYdeploy/status succeeded, no credentialfiles read/changed.
Extra-check mistaken nonexistent2027 URL/rawreferences comparison corrected to
real stagedallowlist bytes, no content edit. Exactcomputer139184B/credit813BSHA
match. NativeNodeHTTPsweep not rerun; curlgzip,deflate executes originalassertions.

Build521allowlistedfiles842.3MiB;8largeobject hashkeys/manifests exactly unchanged,
8skip/0R2writes. Dry605files8995.46KiB/1576.95gzip;29newassets539retained,134msstartup.
Website normalVercelbuild/IndexNow200PASS, noDNS/newproject/librarydependency.
Guarded functional mainFF62b→995 preserved48otherowner paths/status/SHA/bytes/mode/
mtime/staged0; final docs-only FF re-verifies same manifest. No stash/reset/push/remote.
Otherowner history/camera/testdrafts remain excluded/preserved, not called shipped.

[Final handoff](MARS_MVP_HANDOFF.md) records allfamilies/eightdisruptions, inherited
publicsource provenance, limits and reusable seams. Authored4/8groundlayouts,
coldfood, onegroundmat/currentrigs, standingboundedchess and computer-audio are
supported; arbitrary rooms/terrain, heat/chopping, active-sessionreload, universal
planning/autonomousneeds/fineanatomy remain deferred. Completed sleepreturn is
asserted but outofthefixedmatcamera; no destinationvisualclaim. Busycomputer is
freshpublicproof; unavailabledisplay isNode-only. Hypotheticalstaging is explicit.

**Mars MVP complete. Remaining accepted implementation hours0. Stop feature
expansion; do not start Eden.** Final proof/publication completed within the24h
window ending2026-10-03T01:31UTC. Legacy rowcounts do not define this acceptance.

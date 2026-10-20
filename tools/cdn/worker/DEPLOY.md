# Deploying the god-uploads Worker (coordinator, in Gene's Chrome)

Gene, 2026-10-20: "Yes: build the pull-through Cloudflare Worker for god uploads on assets.eden.art; do the Cloudflare step
in my Chrome." Lane CDN4 built and tested it locally; nothing has been deployed. The coordinator does the steps below in
the Cloudflare dashboard, then runs the verification, then tells R to ship the client.

## Values

| Field | Value |
|---|---|
| Worker name | `eden-god-uploads` |
| Script | `tools/cdn/worker/god-uploads.js` (ES module, one file, no imports, no secrets) |
| Compatibility date | `2026-10-01` (no compatibility flags) |
| R2 binding | variable name **`ASSETS`** -> bucket **`eden-assets`** (the bucket `assets.eden.art` serves) |
| Route | **`assets.eden.art/w/*`**, zone `eden.art`, failure mode **Fail open** |
| workers.dev / preview URLs | **disabled** (the route is the only entry point) |
| Environment variables, secrets | none |

### Why `/w/*` cannot collide

Every object published so far (CDN1, CDN2, CDN3, world-scoped) has a key starting `assets/`: `assets/<aa>/<sha>.<ext>`,
`assets/br/<aa>/<sha>.<ext>` and `assets/w/<world>/<sha>.<ext>`. The custom domain maps a URL path to the same key, so all
of them live under the URL path `/assets/`, which the route `assets.eden.art/w/*` does not match. Checked on 2026-10-20:
the receipts under `team/scratch/cdn/` contain no key outside `assets/`, the client manifest's 3,040 keys all start with
`assets/`, and `https://assets.eden.art/w/...` answers 404 today. The Worker writes only `w/<slug>/assets/<sha>.<ext>`
(the URL path without its leading slash), a prefix nothing else uses.

## Steps (click-level)

1. dash.cloudflare.com -> the account that owns `eden.art` -> **Workers & Pages** -> **Create** -> **Create Worker**
   (start from "Hello World"). Name: `eden-god-uploads`. **Deploy** (deploys the placeholder; it has no route yet).
2. **Edit code**. Select all of `worker.js` in the editor and replace it with the full contents of
   `tools/cdn/worker/god-uploads.js` from the branch (copy with `pbcopy < <worktrees>/t4-cdn4/tools/cdn/worker/god-uploads.js`
   or the merged path). **Deploy**.
3. Back on the Worker -> **Settings** -> **Bindings** -> **Add** -> **R2 bucket**. Variable name `ASSETS`, bucket
   `eden-assets`. **Deploy** / Save.
4. **Settings** -> **Runtime** (or "Compatibility date") -> set **Compatibility date** `2026-10-01`. Save.
5. **Settings** -> **Domains & Routes** -> **Add** -> **Route**. Zone `eden.art`, route `assets.eden.art/w/*`,
   failure mode **Fail open (proceed)**. Add route.
   - On the same panel, **workers.dev**: **Disable**; **Preview URLs**: **Disable**.
   - Do not add any other route (never `assets.eden.art/*` or `/assets/*`).
6. Nothing else changes: no DNS record, no CORS or cache rule edits, no R2 token. The R2 bucket's CORS policy does not
   apply to Worker responses; the Worker sets `Access-Control-Allow-Origin: https://sim.eden.art` itself.

## Verify (coordinator, right after step 5)

```sh
# a fresh god upload to the scratch world bench-hamlet (its god folder is read by path; nothing secret is printed)
node <worktrees>/t4-cdn4/tools/cdn/worker/verify-worker.mjs \
  --god <team>/runtime/t4-bench/bench-hamlet \
  --out <team>/scratch/t4/cdn4/verify-live-$(date -u +%Y%m%dT%H%M%SZ).json
```

PASS means: the upload's origin route serves it; HEAD before any GET is 404 (HEAD never pulls); the first GET is
`x-eden-cdn: miss` with the right bytes, immutable cache, `model/gltf-binary` and CORS for sim.eden.art; a following GET is
`hit` (R2) or `edge` (edge cache) with the same bytes; malformed path 400, query 400, unknown sha 404; a core sha whose origin
sends a rendition (bytes that do not hash to the URL) is 502 `refused:sha-mismatch` twice, so nothing was stored; a
published `assets/...` object still answers from R2 without the Worker. The upload is not placed or defined (no world edit).

By hand, for one upload `<sha>` of a /worlds world `<slug>`:

```sh
curl -sI https://assets.eden.art/w/<slug>/assets/<sha>.glb -H 'Origin: https://sim.eden.art'      # 404 before, 200 hit after
curl -s -o /dev/null -D - https://assets.eden.art/w/<slug>/assets/<sha>.glb -H 'Origin: https://sim.eden.art' | grep -i -E 'x-eden-cdn|cache-control|access-control'
```

### If it fails

| Symptom | Meaning / fix |
|---|---|
| every `/w/` request 404 `text/html` without `x-eden-cdn` | the route is missing or did not attach: step 5 |
| `x-eden-cdn: refused:binding` (500) | the `ASSETS` binding is missing or misnamed: step 3 |
| miss is `refused:origin-403` / `origin-503` | Cloudflare security on sim.eden.art refused the Worker's subrequest (WAF/Bot rule): allow the user agent `eden-assets-pull/1` or skip that rule for `/worlds/w/*/assets/*` |
| second GET still `miss` after 10 s | the R2 write failed: check the Worker's logs (Workers -> eden-god-uploads -> Logs) |

## Rollback

Delete the route (Settings -> Domains & Routes). Clients then get a 404 for `/w/...` from the bucket and fall back to the
origin after that one failed request (the same hash-verified fallback as every CDN object). Objects already stored under
`w/` are inert and may stay. A release can also turn the client side off: `SIM_GOD_UPLOADS_CDN=0 release.sh ...`, or a
visitor `?godcdn=0`.

## Order

1. Coordinator: steps 1-5, then the verification above (PASS receipt).
2. Coordinator tells R; R ships the branch (the client routes god uploads to the Worker; default on).
3. After the ship: `tools/cdn/cdn-walk.mjs` on a /worlds page that places a god upload counts `cdnUploads` per page
   (`cdnUploadStates`: miss/hit/edge) and fails on a god upload fetched from the origin with no Worker attempt.

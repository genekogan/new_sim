# Asset CDN

`https://assets.eden.art` is a Cloudflare R2 bucket on a custom domain. It holds immutable, content-addressed copies of
assets the origin (`sim.eden.art`) already serves publicly, so they load from the nearest edge. The origin always
remains the fallback.

## Keys

| Key | Holds |
|---|---|
| `assets/<sha[0:2]>/<sha>.<ext>` | The file's bytes (identity encoding) |
| `assets/br/<sha[0:2]>/<sha>.<ext>` | The file stored as quality-11 brotli with `Content-Encoding: br` |
| `assets/w/<world>/<sha>.<ext>` | A world-scoped copy, mapped only on that world's own page |
| `w/<slug>/assets/<sha>.<ext>` | A god upload, written only by the uploads Worker |

`<sha>` is the SHA-256 of the decoded file. Objects are written once (`If-None-Match: *`) with
`Cache-Control: public, max-age=31536000, immutable` and are never overwritten. A changed file is a new key.

## What goes on the CDN

An immutable file the origin already serves publicly goes on the CDN when it loads faster from there. Rights stay with
their holders: the CDN is a transport, not a licence. The records that admit a file are checked in:

| Record | Covers |
|---|---|
| Licence sources CSV (`DEFAULT_SOURCES` in `inventory.mjs`) + `approved-derivatives.json` | CC0 and own-work models and their derived LOD meshes, pinned by SHA and bytes |
| `served-public.json` (`served-public.mjs --write`; without `--write` it checks the file is current) | Every file of the server's core asset set that `GET /assets/<sha>` serves, the `/modular` set, with each index's licence text kept |
| `served-blobs.json` | The `/blobs/assets/<sha>` files the client names (a test fails when a literal in `apps/web/src` has no record) |
| `world-scoped.json` | Per-world files, with their world, served URL and authorisation, used only under `assets/w/<world>/` |

Vite bundles stay on the origin: they ship with every release and a second host adds connection setup on the boot
path. Compressible objects (GLB, bin, HDR, EXR) are stored precompressed when brotli saves at least 3%; Cloudflare
decodes a stored br body for a client that does not accept br. Never set `Cache-Control: no-transform` on them.

## Repository media

Git holds no binary media. `tools/assets/manifest.json` lists every media file by repository path with its SHA-256,
size and CDN URL, and `pnpm assets:pull` puts each one back at its path (`pnpm assets:check` verifies without
network). Tests, the web build and the release check or pull it themselves; see `tools/assets/README.md`. These
pull-only objects are published with `publish.mjs --repo-media`, validated against the asset manifest instead of the
licence records, and never enter the client `cdn-manifest.json`.

## The client

The web build carries `apps/web/src/cdn-manifest.json`, which maps origin URLs (in both the root and `/worlds`
namespaces, with exact version queries) to keys:

```json
{"version":1,"assets":{"/world-assets/core-assets/packs/example.glb":{"key":"assets/aa/<sha>.glb","sha256":"<sha>","bytes":123,"licence":"CC0-1.0"}}}
```

`cdnRoute` in `apps/web/src/cdn-assets.ts` resolves each request; GLBs download in a worker
(`apps/web/src/gen-mesh/asset-fetch.ts`). The client fetches the CDN copy without credentials or referrer, checks the
exact length and SHA-256 of the decoded body, and on any error, timeout (12 s of body idle) or mismatch retries the
original URL. Unlisted, missing and invalid entries stay on the origin. `window.__assetWorker.cdn` counts CDN
deliveries.

The switch is build-time: `SIM_ASSETS_CDN_ENABLED=1` (off when absent in a plain `vite build`; `release.sh` defaults it
on and fails a build without the origin or the manifest). `SIM_ASSETS_CDN_ORIGIN` defaults to
`https://assets.eden.art`; the client accepts only that origin or a loopback `http` origin for tests.

## Publishing

`tools/cdn/publish.mjs` uses Node's built-in fetch and crypto. The dry run uses no network and no credentials:

```sh
node tools/cdn/publish.mjs --dry-run --out <dir>/cdn-plan.json --manifest <dir>/cdn-manifest.json
```

The plan records each object's path, bytes, SHA-256, licence evidence, encoding and encoded hash, plus excluded files
and totals. It inventories `mars/viewer/public`, the Mars web overlay, `worlds/` and `apps/web/public`. Hidden
entries, secret-named files, nested symlinks and `node_modules` are never opened. Brotli output is cached in
`$EDEN_CDN_BR_CACHE` (default a temp directory). `--identity` writes an identity-only plan; `--base <manifest>` keeps
that manifest's world-scoped section.

Uploading needs `CF_ACCOUNT_ID` (the Cloudflare account that owns the R2 bucket) and the R2 credentials file named
by `EDEN_ASSETS_CREDENTIALS`, both from the environment or the untracked `deploy.env` (template
[`deploy.env.example`](../../deploy.env.example)); a real `--apply` without the account id stops before any request.
The variable holds the absolute path of a single-link regular file owned by the current user, mode 0600, containing exactly `R2_ACCESS_KEY_ID=...` and `R2_SECRET_ACCESS_KEY=...`.
Nothing else (environment keys, `~/.aws`, rclone config) is read. In CI, write the secret to a temporary 0600 file
and point the variable at it. `tools/cdn/install-key.py <path>` creates such a file from hidden
prompts without echoing the values.

```sh
# 1. one object first, then prove it live
EDEN_ASSETS_CREDENTIALS=<file> node tools/cdn/publish.mjs --apply --plan <plan> --only <key> --receipt <new>/receipt-test.json
node tools/cdn/verify.mjs https://assets.eden.art <plan> --key <key> --out <new>/proof-test.json
# 2. the whole plan (existing objects are verified and skipped), then a cache proof
EDEN_ASSETS_CREDENTIALS=<file> node tools/cdn/publish.mjs --apply --plan <plan> --receipt <new>/receipt.json
node tools/cdn/verify.mjs https://assets.eden.art <plan> --key <k1>,<k2>,<k3> --out <new>/proof.json
```

Before any network access every object is rehashed and its licence evidence revalidated. Publishing always uses the
default licence sources (`--sources` is dry-run only). HEAD precedes PUT; existing objects must have matching
metadata or the run stops without overwriting; every uploaded or skipped object is read back through the
authenticated endpoint and its bytes verified. Receipts hold keys, hashes and dispositions, never credentials. The
`--receipt` and `--out` paths are reserved with exclusive creation, so use a new path per attempt; a partial run can
be repeated safely.

The publisher never uploads the manifest. Commit the new `apps/web/src/cdn-manifest.json` and ship it with the web
build after its objects are verified. Rolling back is shipping the previous manifest; unreferenced objects are inert.

### World-scoped objects

```sh
node tools/cdn/world-scoped.mjs plan --out <dir>/plan.json                          # dry run
node tools/cdn/world-scoped.mjs evidence --plan <dir>/plan.json --out <dir>/evidence.json   # public GETs; must say ok:true
EDEN_ASSETS_CREDENTIALS=<file> node tools/cdn/world-scoped.mjs apply --plan <dir>/plan.json --receipt <dir>/receipt.json
node tools/cdn/world-scoped.mjs manifest --receipt <dir>/receipt.json --base apps/web/src/cdn-manifest.json
```

`apply` re-fetches each served URL and uploads exactly those bytes; a path that no longer serves the recorded bytes
is skipped. `manifest` merges only receipt-verified paths into the manifest's `worlds` section.

## Verifying

- `node tools/cdn/verify.mjs <cdn origin> <plan> [--key a,b] [--sample N] [--allow-warm] --out <file>`: no
  credentials. For each object: a first GET that must MISS, a second that must HIT with an `Age`, CORS for the app
  origin, MIME type, the immutable cache policy, ETag and the decoded SHA-256. A `br` key is also fetched with
  Chrome's `Accept-Encoding` (must stay br), identity and gzip (must arrive decoded). `--allow-warm` labels a recheck
  of an already warm object.
- `node tools/cdn/cdn-walk.mjs <outDir> <url>... [--manifest <file>] [--wait <ms>] [--devices desktop1,phone2]`: the
  release's runtime check. Real Chrome, desktop and phone, asset worker on. It fails when the origin answers an asset
  the manifest maps, a CDN request is not 200, a `br` object arrives without `Content-Encoding: br`, the worker
  delivered GLBs but none from the CDN, a god upload came from the origin without a Worker request first, or a
  same-origin immutable response lacks a long-lived cache policy (`origin-cache.mjs`).
- Local tests (no credentials or network): `node --test tools/cdn/cdn.test.mjs tools/cdn/manifest-integrity.test.mjs
  tools/cdn/world-scoped.test.mjs tools/cdn/origin-cache.test.mjs` and `python3 -B tools/cdn/install_key_test.py`.
  `manifest-integrity.test.mjs` checks every manifest alias against the repository files.
- Local browser proofs against stand-ins: `tools/cdn/browser-proof.mjs serve|check` (CDN delivery, a closed CDN and
  corrupt bodies falling back to the origin, at dpr 1 and 2) and `tools/cdn/world-scoped-proof.mjs`; their headers
  give the exact commands.

## The uploads Worker

`tools/cdn/worker/god-uploads.js` is a Cloudflare Worker (one ES module, no imports, no secrets) on the route
`assets.eden.art/w/*`. It serves exactly `GET /w/<slug>/assets/<sha256>.<ext>` (`glb`, `png`, `jpg`, `json`):

- **R2 hit:** the stored object with the CDN headers (immutable, Content-Type, CORS for `https://sim.eden.art`,
  `Content-Encoding: br` when stored so, ETag `"<sha>"`), also kept in the edge cache.
- **Miss:** it fetches the god world's own route `https://sim.eden.art/worlds/w/<slug>/assets/<sha>.<ext>`, hashes the
  body while reading it (32 MiB cap), and stores and returns it only when the digest equals the path's sha. The R2
  write completes before the 200, so `x-eden-cdn: miss` means stored.
- **Refusals** (`no-store`, `x-eden-cdn: refused:<reason>`): a malformed path or a query is 400, origin 404 is 404, a
  hash mismatch, redirect, other origin status or oversize body is 502. Nothing refused is stored.

The client routes a god upload to the Worker only when the world's snapshot gives its size, so the same length and
SHA checks apply. `SIM_GOD_UPLOADS_CDN=0` at build time turns that off; a visitor can add `?godcdn=0`.

**Deploying** (Cloudflare dashboard, once):

| Setting | Value |
|---|---|
| Script | `tools/cdn/worker/god-uploads.js` |
| Compatibility date | `2026-10-01` or later, no flags |
| R2 binding | variable `ASSETS` → the bucket behind `assets.eden.art` |
| Route | `assets.eden.art/w/*`, failure mode **Fail open** |
| workers.dev and preview URLs | disabled (the route is the only entry point) |
| Variables and secrets | none |

Add no other route: published keys all start with `assets/`, and the Worker writes only under `w/`, so the two cannot
collide. No DNS, CORS-rule or token change is needed; the Worker sets its own CORS header.

**Proving it:** `node tools/cdn/worker/verify-worker.mjs --god <god folder of a scratch world> --out <receipt>`
uploads one fresh GLB and checks the origin route, HEAD before any GET is 404, the first GET is a verified `miss`, an
immediate HEAD is `hit`, a second GET is `hit` or `edge`, the refusals above, and that a published `assets/` key still
answers from R2. `--self-test` runs the same checks against loopback stand-ins. Unit tests:
`node --test tools/cdn/worker/god-uploads.test.mjs`.

| Symptom | Cause |
|---|---|
| Every `/w/` request is a 404 page without `x-eden-cdn` | The route is missing |
| `refused:binding` (500) | The `ASSETS` binding is missing or misnamed |
| `refused:origin-403` / `origin-503` | The origin's WAF or bot rules refused the Worker (user agent `eden-assets-pull/1`) |
| `miss-unstored` | The R2 write failed; the client still got verified bytes; see the Worker logs |

**Rollback:** delete the route. Clients get a 404 from the bucket and fall back to the origin. Objects under `w/` are
inert and may stay.

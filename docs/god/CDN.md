# CDN publishing path (lane cdn, 2026-10-15)

`assets.eden.art`, its R2 bucket, CORS and cache rule have been active since October 13. Publishing credentials have
not been installed or used by this lane. No real uploads or live cache proof are claimed. The older plan below is
historical; use [`tools/cdn/README.md`](../../tools/cdn/README.md) for the current runnable publisher and checker.

The prepared path ports `db11f401`'s immutable metadata/checksum design to built-in S3 signing. Dry-run is the default;
`--apply` is an explicit release-owner action. It requires only `EDEN_ASSETS_CREDENTIALS=/absolute/path/to/file`, refuses
unsafe file permissions, HEADs before conditional PUT, refuses conflicting immutable keys and verifies every readback.
No ambient AWS/rclone credentials are consulted. Gene's hidden-prompt installation command is:

```sh
python3 <worktrees>/lane-cdn/tools/cdn/install-key.py <private-secrets>/eden-assets-r2.env
```

The existing key expires October 20. If its one-time secret was lost or expired, Gene creates a replacement 7-day
Object Read & Write key scoped only to `eden-assets`. Agents must not retrieve, display or install its values.

The local inventory covers the three root worlds' public sources, the immutable release overlay and `/worlds` assets.
Unknown/restricted assets remain explicit exclusions. A reviewed 76-model CC0 derivative allowlist is tied to the
source-pack records in `team/asset-scouting/SOURCES.csv`; it permits 3,337,244 bytes. The measured campus is
70,772,556 bytes (67.49 MiB) and is excluded pending explicit publication provenance. This work does not by itself
move the large private Mars or Little Martians files to the CDN.

The web switch is **off by default**. After upload and the public cache/hash checker pass, release the reviewed public
manifest at `apps/web/src/cdn-manifest.json`, then build both root and `/worlds` web artifacts with
`SIM_ASSETS_CDN_ENABLED=1`. `SIM_ASSETS_CDN_ORIGIN` defaults to `https://assets.eden.art`; only this origin and explicit
loopback HTTP stand-ins are accepted. Vite emits the manifest as a hashed `/assets/cdn-manifest-*.json` file, so both
existing static servers can serve it and immutable caching cannot retain a prior release's manifest. The same client
entry point handles both builds. Content-hashed world asset
routes resolve only to explicit approved hash aliases; mutable path/query aliases must match exactly. A missing or
invalid manifest leaves the origin transport active.

The client verifies CDN byte count and SHA before exposing data to loaders, then retries the exact original request
on HTTP, CORS, connection, body, timeout or integrity failure. Standalone ImageLoader textures use the same transport.
Caller cancellation is preserved; CDN requests omit origin credentials/headers and referrers. The CDN attempt is
bounded to 12 seconds, including its body. Integrity checking buffers one asset before decoding, so large approved
files would add transient memory and the arrival byte meter advances after verification. No new large-file speed or
memory improvement is claimed. External-resource `.gltf` files remain on origin.

Local proof uses only fake worlds on 5810–5812, real Chrome with the `cdn` lease and hardware rendering. The repeatable
fixture checks successful CDN delivery, refused connections and same-size corrupt bytes for GLB and standalone PNG
textures at DPR 1 and 2. Run instructions are in the publisher README. No server-core files changed, so the server-core
Modal suite condition does not apply to this bounded deliverable.

## Historical October 11 design

Status: **plan only.** No account, bucket, DNS record or Cloudflare setting has been created. The steps that need
Gene or the internet session are listed at the end, in order.

## Where we are now

| Stage | Who serves blobs | Caching | Mars campus on the wire |
|---|---|---|---|
| Before (until 20:41 UTC Oct 11) | the laptop, through the SSH tunnel (~3.9 MB/s) | none (only Last-Modified) | 70.8 MB, uncompressed |
| Now (Caddy on eden2) | `/srv/sim-blobs` on eden2, Caddy `file_server` | hashed: `max-age=31536000, immutable`; legacy names: `max-age=600` + ETag | 34.1 MB br (legacy name) |
| After 004 + /worlds release | same | same | **17.8 MB br** (`/blobs/assets/64/64b8838c….glb`, quantized + WebP + meshopt filters) |
| CDN (this plan) | Cloudflare edge in front of R2 | same headers, served from the visitor's nearest PoP | 17.8 MB, no eden2 or laptop in the path |

The eden2 store already uses the CDN layout. That makes the move to a bucket a copy, not a re-architecture:

```
/srv/sim-blobs/assets/<sha[0:2]>/<sha>.<ext>          bytes (sha256 of the bytes = the name)
/srv/sim-blobs/assets/<sha[0:2]>/<sha>.<ext>.{br,zst,gz}  precompressed sidecars (Caddy only; not uploaded)
/srv/sim-blobs/legacy/<public path>                  hardlinks for un-hashed legacy names (/browser, /modular, …)
```

This is the `assets/<sha[0:2]>/<sha>.<ext>` scheme from `docs/god/CATALOG-PROGRAM.md` ("Delivery, caching and CDN")
and `tools/god-skill/scripts/bucket-plan.mjs`. The catalogue's GLBs, thumbnails and (later) `registry/defs/<hash>.json`
go in the same bucket under the same rule.

## Recommendation: Cloudflare R2 + a custom domain on Cloudflare's CDN

Why R2:
- **No egress fees.** Our cost is storage plus requests, independent of how many visitors download a 17.8 MB campus.
- It is S3-compatible (rclone, wrangler, any S3 SDK), and CATALOG-PROGRAM already assumes it (Gene's answer 6:
  "go straight to a scalable CDN in Eden's infra").
- Cloudflare is already in use: `sim.mars.college` runs as a Cloudflare Worker (`<workers-subdomain>.workers.dev`).

Cost at our size (list prices as I know them; check them on the pricing pages before signing up):
- Storage $0.015/GB-month, first 10 GB free. Today's store is 0.14 GB; CATALOG-PROGRAM projects 1–3 GB of GLBs plus
  ~0.6 GB of thumbnails. That is **$0 now and under $0.05/month later.**
- Class A (writes) $4.50/million, Class B (reads) $0.36/million, with 1M/10M free per month. Edge cache hits never
  reach R2, so reads stay in the free tier.
- Egress $0. Cloudflare's CDN in front of an R2 custom domain is included on the Free plan.

Alternative: **Bunny Storage + Bunny CDN.** Storage is ~$0.01–0.02/GB-month; CDN egress is ~$0.01/GB in EU/NA and up to
~$0.06/GB elsewhere, with a $1/month minimum. 1,000 cold Mars visits ≈ 18 GB ≈ $0.18–1. It is cheap and fast, but
egress grows with traffic, and it would be a second vendor next to Cloudflare. Choose it only if eden.art's DNS can't
use a Cloudflare custom domain (see step 2).

Not recommended: putting Cloudflare's proxy in front of all of sim.eden.art. It would cache blobs, but it would also
proxy the WebSocket/SSE streams and the auth pages, and it needs a DNS change for the whole host. The bucket on its own
subdomain keeps the CDN away from the app's live traffic.

## Design

- **Domain:** `assets.eden.art` (an R2 custom domain). The public `r2.dev` URL is rate-limited and not for production.
- **Objects:** `assets/<sha[0:2]>/<sha>.<ext>`, with `Cache-Control: public, max-age=31536000, immutable` and the
  right `Content-Type` set at upload. Objects are never overwritten or deleted while any world references them
  (refcounted GC, CATALOG-PROGRAM).
- **Compression:** upload the raw bytes and let the edge compress. Add a Cloudflare **Compression Rule** that enables
  Brotli/Zstandard for `model/gltf-binary`, `application/wasm` and `application/json`. GLB is not in Cloudflare's default
  compressible list, and the shrunk campus is 41.8 MB raw vs 17.8 MB br, so this rule is worth 2.4x on the campus.
  Fallback if compression rules don't apply to R2 custom domains: upload the `.br` bytes with
  `Content-Encoding: br`. That only works for clients that accept br, so verify on the real domain before relying on it.
- **CORS (R2 bucket policy):** `GET, HEAD` from `https://sim.eden.art` (and `https://sim-staging…` if needed),
  `Access-Control-Allow-Origin` per origin, max-age 86400. three's `GLTFLoader` fetches cross-origin. Range requests
  are not needed.
- **Cache Rule:** for `assets.eden.art/assets/*`: eligible for cache, Edge TTL = respect origin (1 year immutable),
  Browser TTL = respect origin.
- **Client switch:** the frontends reference `/blobs/assets/<aa>/<sha>.<ext>` (`BACKDROP_BLOBS` in
  `apps/web/src/WorldGeometry.ts`; later the catalogue's asset URLs). Moving to the CDN is a one-line origin change:
  `/blobs/assets/` → `https://assets.eden.art/assets/`, with a fallback to the eden2 path on failure (the existing
  fallback to the legacy name stays). eden2 keeps serving `/blobs/assets/*` as the origin of last resort, so a CDN outage
  degrades to today's speed.
- **Upload:** `tools/blobs/cdn-upload.mjs <store> [--bucket eden-assets] [--remote r2] [--apply]`. The default is a dry
  run. It re-hashes every store file (the name must equal its sha256), skips the sidecars, writes a `cdn-plan-*.json`
  and prints one `rclone copyto … --header-upload Content-Type/Cache-Control` per object. Dry run on eden2 today:
  65 objects, 140.3 MB (the 64 verified legacy blobs + the shrunk campus). `--apply` needs an rclone remote named
  `r2` that Gene configures. The credentials live in rclone's config or environment on the uploading machine, never in
  the repo.

## Steps for Gene / the internet session (in order; nothing here has been done)

1. **Cloudflare account:** in Eden's Cloudflare account (or Gene's, wherever `<workers-subdomain>` lives), enable R2 (needs a
   payment method on file; the free tier still applies). Create bucket **`eden-assets`**, location hint ENAM or WEUR
   (eden2 is in Germany; most visitors are in the US).
2. **Domain:** check where `eden.art` DNS is hosted.
   - If the zone is on Cloudflare: R2 → `eden-assets` → Settings → Custom Domains → add `assets.eden.art`.
     Cloudflare creates the record.
   - If it is not: either move only a subdomain (`assets.eden.art` NS delegation to Cloudflare, or a CNAME setup on a
     paid plan), or use a domain already on Cloudflare (for example `assets.mars.college`, if that zone is there).
     Tell the lead which domain was chosen.
3. **Bucket CORS policy** (R2 → bucket → Settings → CORS):
   `[{"AllowedOrigins":["https://sim.eden.art"],"AllowedMethods":["GET","HEAD"],"AllowedHeaders":["*"],"MaxAgeSeconds":86400}]`
4. **Rules on the zone:**
   - a Compression Rule (Rules → Compression Rules) for hostname `assets.eden.art`: Brotli + Zstandard (+ gzip
     fallback), content types `model/gltf-binary`, `application/wasm`, `application/json`, `model/gltf+json`;
   - a Cache Rule for `assets.eden.art/assets/*`: eligible for cache, respect origin TTLs.
5. **API token:** R2 → Manage API tokens → "Object Read & Write", scoped to `eden-assets` only. Put it on eden2 as an
   rclone remote (`rclone config create r2 s3 provider Cloudflare access_key_id … secret_access_key … endpoint
   https://<accountid>.r2.cloudflarestorage.com`). Run it as root, in root's rclone config, never in a repo or a lane file.
   Then tell the lead "R2 ready: <domain>".
6. **Lead (after 5):** on eden2,
   `cd /tmp && node /srv/sim-blobs/bin/cdn-upload.mjs /srv/sim-blobs` (dry run, read the plan),
   then `… --apply`. Verify with
   `curl -sI -H 'Accept-Encoding: br' https://assets.eden.art/assets/64/64b8838cdc76a048843ab293f3d74ad985293ad621ea7587e092098117bd1034.glb`
   (200, `content-encoding: br`, `cache-control: …immutable`, `cf-cache-status: HIT` on the second request,
   `access-control-allow-origin` for sim.eden.art). Then ship the one-line client origin switch through the normal
   paths (/worlds release.sh, old-world hotfix-integration-NNN promote) and walk /w/mars and /worlds/w/mars on the
   real URL at dpr 1 and 2.

## Measured (sim.eden.art, real Chrome, cold cache; tools/blobs/inventory.mjs)

| Page | Before (laptop, 70.8 MB raw) | eden2 Caddy, legacy name (34.1 MB br) | + shrunk campus (17.8 MB br) |
|---|---|---|---|
| /w/mars, unthrottled | 37.4 s | 12.7 s | 6.0–9.5 s (local candidate 004, dpr 2/1) |
| /worlds/w/mars, unthrottled | 25.3 s | 8.8 s | pending /worlds release |
| /w/mars at 50 Mbit/s | (laptop-bound, ≈ unthrottled) | 15.6 s | ≈ 3 s less transfer (17.8 vs 34.1 MB) |
| campus fetch alone (curl from the laptop) | 18 s | 5.1 s | 2.5 s |

A CDN mainly helps visitors far from Germany: a nearby PoP plus immutable caching means a returning visitor never
downloads the campus again.

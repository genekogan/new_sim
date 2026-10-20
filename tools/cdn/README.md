# Immutable CDN publisher

This is the reviewed successor to `db11f401`'s `tools/blobs/cdn-upload.mjs` and `cdn-verify.mjs`.
It uses Node's built-in fetch/crypto, without rclone or ambient AWS credentials. Dry runs use no network and never open a credential file.
Only the release owner runs real uploads. This lane has not uploaded anything or proved the live bucket.

From this worktree, write a local inventory and public client manifest:

```sh
node <worktrees>/lane-cdn/tools/cdn/publish.mjs --dry-run --out <team>/scratch/cdn/cdn-plan.json --manifest <team>/scratch/cdn/cdn-manifest.json
```

The plan records paths, bytes, SHA-256, licence evidence, excluded files, missing roots, totals and the 20 biggest files.
It inventories the repo's `mars/viewer/public`, the read-only `.lane/mars-web` release overlay, `worlds/`, and optional
`apps/web/public`, with root and `/worlds` URL aliases. It does not fetch live worlds or enumerate remote user uploads.
The existing Mars campus version query has its own exact alias; query parameters are never silently discarded.
Hidden files/directories, secret/token/credential-named entries, nested symlinks and node_modules are never opened.
Reviewed core models also receive explicit `/assets/<sha>.glb` and `/worlds/assets/<sha>.glb` aliases for the runtime mesh
endpoints; world-scoped mesh requests can use these exact SHA-pinned aliases without publishing arbitrary world files.
The client manifest includes only GLB/bin/KTX2, PNG/JPEG/WebP/AVIF and HDR/EXR assets. GLTF, WASM, JSON and SVG may appear
in the upload inventory when approved, but never in the client manifest. They remain on origin; GLTF external-resource paths require separate treatment.

The public manifest is deliberately small and contains no local filesystem paths:

```json
{"version":1,"assets":{"/world-assets/core-assets/packs/example.glb":{"key":"assets/aa/<64-char-sha>.glb","sha256":"<64-char-sha>","bytes":123,"licence":"CC0-1.0"}}}
```

Licence checks accept exact SHA/bytes matches in `team/asset-scouting/SOURCES.csv` with CC0 or own-work records.
Publishing always reads the canonical `DEFAULT_SOURCES` CSV, ignoring a plan's `sources` field. `--sources` is dry-run
only; the function-level override exists for isolated tests. The upload receipt records its actual `sources` path and
`sourcesSha256`, calculated from the same raw CSV bytes parsed for approval, so the policy snapshot is auditable.
`approved-derivatives.json` additionally pins the 76 reviewed CC0 split models from `worlds/core-assets/index.json`
to the source families in `tools/god-skill/scripts/import-packs.mjs` and exact CSV source-pack rows, plus (CDN1, 2026-10-20)
the 20 CC0 lod1 meshes in `worlds/core-assets/lods/` (`tools/core-lods`), each pinned to its own bytes and to its approved
parent model (`lodOf`, same source family); `lodsIndexSha256` pins `lods.index.json`. Changed/missing source records,
changed derivative bytes, unknown or restricted licences are excluded from this CC0 list.

## The CDN rule (Gene, 2026-10-20) and served-public records

Gene, 2026-10-20, verbatim: "yes put it on cdn. anything that loads faster from cdn should be on cdn. as a rule. i dont
know why you are asking me questions like this. i want to make the best possible loading app."

This supersedes the earlier rule that private-project derivatives (Little Martians, Mars College) never get shared
`/assets/<sha>` aliases. Those files are already served publicly from the origin by hash, so the CDN adds speed, not
exposure. The test for any asset class is now speed alone: an immutable file the origin already serves publicly goes on
the CDN when it loads faster from `assets.eden.art`; otherwise the reason it stays on origin is recorded (the audit table in
`docs/god/CDN.md`). Rights stay with their holders: the CDN is a transport, not a licence.

`served-public.json` (`node tools/cdn/served-public.mjs --write`; without `--write` it checks the file is current) records,
with exact SHA-256, bytes and the index's licence text unchanged (`rights`), every file of the server's core set that
`GET /assets/<sha>` serves and the CC0 list does not cover: `worlds/core-assets/index.json` plus every other
`worlds/core-assets/*.index.json` (lods, littlemartians-two, mars-fidelity). That includes the 125 private lod1 meshes
(103 Little Martians, 22 Mars College), the 242 Mars College models and the Little Martians art: 477 objects,
127,111,668 bytes. It pins each index and `renditions.json` by hash. Objects are uploaded with licence label
`served-public`; the publisher and the client accept it next to `CC0-1.0` and `own-work`.

Hash aliases name exactly the bytes the origin route sends. For a core GLB with a rendition (`renditions.json`, W3b) the
origin sends the smaller rendition under the source sha, so `/assets/<sha>.glb` maps to the rendition's object and the
entry carries `of: <sha>` (the client checks the alias against `of`). A rendition sha itself has no alias (the origin has
no route for it). Every core-set file also gets its two named aliases (`/world-assets/...`, `/worlds/world-assets/...`).

Why this class is faster from the CDN (measured 2026-10-20 from the laptop, `team/scratch/t4/cdn2/`): Cloudflare caches
the origin's `/assets/<sha>` route uncompressed (no `content-encoding` even when br is accepted), while `assets.eden.art`
sends brotli. The 76 CC0 models fetched in parallel: 3,336,012 -> 1,392,741 wire bytes, 0.18 -> 0.14 s (median of 5).
Live evidence: all 571 core-set hash aliases served by https://sim.eden.art matched the manifest bytes exactly.

## Excluded large assets and world-scoped publication

Since CDN3 the prepared manifest contains 3,017 aliases for 806 objects (215,060,804 decoded bytes, 138,477,901 stored):
96 CC0 (76 models, 20 lod1 meshes), 477 served-public core-set files, 3 BLOBS and 230 `/modular` GLBs; 742 of them are
precompressed (below). These stay on origin because the origin is as fast or faster (see the audit in `docs/god/CDN.md`):

| Asset | Why it stays on origin |
|---|---|
| Vite bundles (`/assets/*.js`, css) | Same edge, origin q11 brotli, and a second host adds 31-51 ms of connection setup on the boot path. |
| Mars campus `/browser/campus.glb?v=20260922b` | Already on the CDN, world-scoped (below). |

The `/blobs/assets/<sha>` files the client names (Mars backdrop base and detail tiers, the Mars fork campus) ARE on the CDN
(coordinator, 2026-10-20: /w/mars loads its campus from them): `served-blobs.json` records them (exact sha/bytes, a local
copy of the bytes for the publisher, which file names them), and a test fails when a `/blobs/assets/` literal in
`apps/web/src` has no record. Measured trade-off: the origin sends them as quality-11 brotli (base tier 1,407,181 B) and the
CDN at about quality 4 (1,554,144 B, +10%); stored precompressed (CDN3, below) they are byte-for-byte the origin's 1,407,181 B.

## Precompressed objects and `/modular` (CDN3, 2026-10-20)

`assets.eden.art` compresses on the fly at about brotli quality 4; the origin sends `/blobs`, `/modular` and the Vite
bundles as precompressed quality 11. So every compressible object is now stored as its **quality-11 brotli bytes**
(lgwin 24, the largest window browsers decode) with `Content-Encoding: br`, under its own key namespace
`assets/br/<sha[0:2]>/<sha>.<ext>`. The CDN then sends exactly the origin's smallest encoding from the nearest edge, with
no per-request compression at the edge.

- **When:** GLB/bin/HDR/EXR (and JSON/GLTF/WASM/SVG if ever approved) whose q11 output saves at least 3%. Images and the
  64 core GLBs that do not compress (meshopt/KTX-heavy) stay identity under their CDN1/CDN2 keys, already uploaded.
- **Why a new key:** the 576 identity objects CDN1/CDN2 uploaded are immutable (`If-None-Match: *`, metadata must match),
  and the releases that reference them keep working. A br key never collides with them. 742 new objects, 0 overwrites.
- **Integrity:** `sha256`/`bytes` in the plan and the client manifest are the decoded file's. `fetch` decodes
  `Content-Encoding` in the page and in the asset worker alike, so the client's length and SHA-256 checks run on the
  decoded bytes (shown in real Chrome by `browser-proof.mjs`, whose stand-in sends br for br keys: the worker fetched an
  `assets/br/` lod with `content-encoding: br`, verified it and rendered it; a valid br stream of wrong bytes fell back to
  the origin). The plan records `encoding: 'br'`, `encodedBytes`, `encodedSha256`.
- **Clients without br:** Cloudflare decodes a stored br body for a client that does not accept br. Measured live on the
  same edge (sim.eden.art `/blobs` base tier, a cached br variant): a br client got 1,407,181 B `content-encoding: br`;
  no `Accept-Encoding`, `identity` and `gzip` clients got the decoded 4,585,464 B (weak ETag, HIT, correct sha). The R2
  custom domain is the same edge; the release owner's one-object test (below) proves it for an R2 object before the full
  upload. Every browser sends br over HTTPS, and a wrong body fails the client's hash and falls back to the origin, so
  the Sim client is safe either way. Never set `Cache-Control: no-transform` on these objects (it would stop the decode).
- **Publisher:** `inventory` writes the q11 bytes to a content-addressed cache (`$EDEN_CDN_BR_CACHE`, default
  `$TMPDIR/eden-cdn-br`; the plan records it) and `publish --apply` uses an entry only after it decodes to the plan's sha256
  and its own sha256 equals `encodedSha256` (otherwise it recompresses, deterministically on the same Node). PUT carries
  `Content-Encoding: br`, `Content-Length` = encoded size and `x-amz-meta-encoded-sha256`; HEAD/readback metadata must match
  both, and the readback asks for br and hashes the decoded stream. `--only <key>[,<key>]` publishes just those keys of the
  reviewed plan; `--identity` writes a CDN2-style plan; `--base <manifest>` keeps that manifest's world-scoped section.
- **Checker:** for a br key, `verify.mjs` GETs with `Accept-Encoding` br (MISS), br (HIT: must be `content-encoding: br`,
  the stored length), Chrome's `gzip, deflate, br, zstd` (must stay br, not be transcoded), identity (must arrive
  decoded) and gzip, hashing the decoded body each time. `--key a,b,c` checks
  several keys.

`/modular` (`served-public.json`, class `modular`, generated by `served-public.mjs`): every GLB under
`mars/viewer/public/modular` (14 environment files: the three wire meshes, two clips files, three single-file fallback
characters, six Eden packs; 216 humanoid kit parts and rigs). Each record carries the exact version query the client puts
on it (`queries`), read from the client's own pinned URL expressions (`character-wire.ts` sha prefixes, `people.ts`
`?v=ual-1`, `IMPORTS_TAG`), and the manifest gets that query alias in the root and `/worlds` namespaces next to the bare
names (`/modular/**`, `/worlds/modular/**`, `/mars-assets/modular/**`). Rights text: CC0 (Quaternius, Kenney), kept.

Paired wire bytes, 2026-10-20 (Chrome's `Accept-Encoding: gzip, deflate, br, zstd`, 8 parallel transfers, median of 3;
`team/scratch/t4/cdn3/measure/`): origin = sim.eden.art through Cloudflare; CDN today = the identity objects on
assets.eden.art (q4 on the fly); CDN3 = the stored q11 bytes, served by a local stand-in (its times are loopback only).

| Class (objects) | Origin | CDN today | CDN3 | CDN3 vs origin |
|---|---|---|---|---|
| Core CC0 by hash (94) | 3,718,359 B, 0.88 s | 1,612,393 B, 0.84 s | 1,354,633 B | -63.6% |
| Core served-public by hash (477) | 118,074,262 B, 5.61 s | 110,899,453 B, 5.82 s | <= 108,086,573 B (64 stay identity, still q4 at the edge) | -8.5% |
| /blobs Mars backdrop + fork campus (3) | 22,097,032 B, 0.70 s | 25,992,771 B, 1.05 s | 22,097,032 B | 0.0% (same bytes) |
| /modular arrival set: wire meshes, clips, Eden packs (11) | 1,459,486 B, 0.19 s | not on CDN | 1,370,104 B | -6.1% |
| /modular fallback characters (3) | 1,209,736 B, 0.13 s | not on CDN | 1,209,736 B | 0.0% |
| /modular humanoid kit (216) | 4,814,562 B, 1.85 s | not on CDN | 4,356,965 B | -9.5% |

Release owner, two steps (`P` = the reviewed dry-run plan, `T` = a fresh dated directory; the key is used by path only):

```sh
# 1. one new br object, then prove it live with and without br
EDEN_ASSETS_CREDENTIALS=<private-secrets>/eden-assets-r2.env node tools/cdn/publish.mjs --apply --plan $P --only <br key> --receipt $T/receipt-test.json
node tools/cdn/verify.mjs https://assets.eden.art $P --key <br key> --out $T/proof-test.json        # MISS br, HIT br, Chrome's header, identity, gzip
curl -s -o /dev/null -w '%{size_download} %header{content-encoding}\n' -H 'Accept-Encoding: br' https://assets.eden.art/<br key>   # stored size, br
curl -s https://assets.eden.art/<br key> | shasum -a 256                                             # no Accept-Encoding: decoded sha256
# 2. the full set (existing objects are verified and skipped), then a cache proof on three new br keys
EDEN_ASSETS_CREDENTIALS=<private-secrets>/eden-assets-r2.env node tools/cdn/publish.mjs --apply --plan $P --receipt $T/receipt.json
node tools/cdn/verify.mjs https://assets.eden.art $P --key <k1>,<k2>,<k3> --out $T/proof.json
```

If step 1 shows a non-br client receiving br bytes, stop before step 2: the Sim client is still correct (browsers decode
br; a wrong body falls back to the origin), but record it and decide with the coordinator.

World-scoped objects (Mars campus, Little Martians scans) stay identity: the current client requests none of them (CDN2
capture: 0 requests); precompress them the same way if a world starts loading them again.

Before the CDN rule above, the release owner's default permitted assets already served publicly to a world to use CDN
delivery **for that same world under a world-scoped path** (the records below are still live and still valid). Since
2026-10-20 such files may also take shared aliases when that loads faster. Existing reviewed world-owner/public-serving authorization can establish the basis within its recorded limits;
it does not turn the art into CC0 or extend its audience or reuse rights.
The authorization record may cite this release-owner default together with evidence of existing same-world public
serving; it does not require a new open licence for that scoped delivery.

Before such publication, retain a reviewed per-file provenance record containing all of the following:

- The world ID, slug, deployment namespace (root or `/worlds`), exact world URL and permitted audience/scope. Record the
  exact existing public **asset URL**, including any version query, and dated evidence that the identified bytes are
  already served for that world. A source-code URL reference alone is not a live-serving verification.
- The local public file/derivative path, complete SHA-256, byte count and MIME type; source/derivation records; the
  recorded licence or rights status, rights holder, attribution requirements and any project, redistribution or reuse
  constraints. Preserve these terms rather than replacing them with `CC0-1.0` or assuming `own-work`.
- The reviewed world-owner/public-serving authorization reference and what it permits, plus the reviewer's identity and
  UTC review date. The record must explain why CDN delivery remains within that authority and the existing audience.
- The exact source-to-CDN mapping and a dedicated world-scoped immutable key, for example
  `assets/worlds/<reviewed-scope-id>/<slug>/<sha-prefix>/<sha>.<ext>`. Bind the scope ID to that specific world and
  namespace; a matching slug or byte hash in another world does not inherit authorization. A legacy shared source URL
  such as `/browser/campus.glb?v=20260922b` needs a mapping restricted to its reviewed world page, not a global alias.

### World-scoped publication (implemented, lane cdn2)

`world-scoped.json` is that reviewed record for 17 objects / 128,764,392 bytes / 23 served paths: the Mars campus
(`/browser/campus.glb?v=20260922b`, 675f4beb…, 70,772,556 B) and its BLOBS copy (`/blobs/assets/64/64b8838c….glb`,
41,803,240 B) for `/w/mars`, and 13 Little Martians scans plus 2 ceramic buildings for `/w/littlemartians`. The Mars fork's
corrected campus (909504a4…) is held. Keys are `assets<world>/<sha256>.<ext>` (e.g. `assets/w/mars/675f4beb….glb`), licence
`world-scoped`, metadata `x-amz-meta-world`. The client maps them only from the manifest's `worlds['<world>']` section, by exact
path and version query, on that world's own page; they never enter `assets` or the shared hash aliases.

`world-scoped.mjs`: `plan` (dry run, no network or credentials) · `evidence` (read-only public GET of every served path) ·
`apply` (re-fetches each served URL and uploads exactly those bytes; a path that no longer serves the recorded bytes is
`not-served`, never uploaded or mapped; HEAD → `If-None-Match: *` PUT → authenticated readback, as above) · `manifest`
(merges only receipt-verified paths into `worlds`). `verify.mjs` accepts the world-scoped keys.

Local proof (no credentials, no R2): `world-scoped-proof.mjs serve` runs the Mars launcher on lane port 6140 (port-remap
preload; never the live 4963), the real `publishScoped` into an on-disk stand-in bucket, and serves it as the CDN on 6141;
`check` loads `/w/mars` in real Chrome at dpr 1 and 2 with the CDN up (campus from the CDN, origin campus never requested),
unreachable and corrupt (origin fallback). See the file header for the exact commands.

Release-owner commands (from a checkout with this branch merged; `T=<team>/scratch/cdn/world-scoped-<UTC stamp>`,
a new directory per attempt; `apply`'s evidence GETs ~135 MB from https://sim.eden.art):

```sh
mkdir -p $T
node tools/cdn/world-scoped.mjs plan --out $T/plan.json                                   # dry run; review it
node tools/cdn/world-scoped.mjs evidence --plan $T/plan.json --out $T/evidence.json       # read-only; must say ok:true
EDEN_ASSETS_CREDENTIALS=<private-secrets>/eden-assets-r2.env \
  node tools/cdn/world-scoped.mjs apply --plan $T/plan.json --receipt $T/receipt.json      # the only credentialed step
node tools/cdn/verify.mjs https://assets.eden.art $T/plan.json --sample 17 --out $T/cache-proof.json
node tools/cdn/world-scoped.mjs manifest --receipt $T/receipt.json --base apps/web/src/cdn-manifest.json
```

Then commit the merged `apps/web/src/cdn-manifest.json` (it gains only a `worlds` section) and ship the web build through the
normal release path. Rollback is the previous manifest; the uploaded objects are immutable and unreferenced without it.

## Upload and verification

Gene installs the key by running this directly in his own terminal (both values are hidden):

```sh
python3 <worktrees>/lane-cdn/tools/cdn/install-key.py <private-secrets>/eden-assets-r2.env
```

The helper refuses to open/replace an existing destination. It creates the file exclusively with mode 0600, never echoes
either value, and does not place them in arguments, shell history or source. The publisher accepts only
`EDEN_ASSETS_CREDENTIALS` pointing to a current-user-owned regular single-link mode-0600 file containing exactly
`R2_ACCESS_KEY_ID=...` and `R2_SECRET_ACCESS_KEY=...`. It never reads `~/.aws`, rclone config or credential env values.
The account ID/endpoint and bucket are fixed public configuration in `publish.mjs`.
Permissions are set through the still-open descriptor before writing. On write/flush/fsync failure or interruption,
the installer removes only its own created inode; it preserves a replacement pathname and existing files/symlinks.
The Oct 13 key expires Oct 20. If its one-time secret was lost or expired, the release owner needs a new 7-day Object
Read & Write key scoped only to `eden-assets`; do not create duplicates merely because this lane never saw the key.

After reviewing the dry-run plan and installing the key, the release owner runs:

```sh
EDEN_ASSETS_CREDENTIALS=<private-secrets>/eden-assets-r2.env node <worktrees>/lane-cdn/tools/cdn/publish.mjs --apply --plan <team>/scratch/cdn/cdn-plan.json --receipt <team>/scratch/cdn/cdn-upload-receipt.json
```

Before any network access, every object is rehashed and its licence evidence revalidated. HEAD precedes PUT. A new object
is written with `If-None-Match: *`, the correct Content-Type, SHA/licence metadata, and
`Cache-Control: public, max-age=31536000, immutable`. Existing metadata must match exactly; mismatches stop the run without
overwriting. A racing 412 is also verified. Every uploaded or skipped object is read back through the authenticated S3
endpoint and its bytes/SHA verified. Receipts include only object keys, hashes, counts and dispositions, never credentials
or signed request headers. A partial run can be repeated safely. The publisher does not upload the mutable client manifest;
release the reviewed `cdn-manifest.json` with the web app through the normal release path, after upload verification.
Both upload `--receipt` and checker `--out` paths are reserved with exclusive creation before credentials/network work.
An existing file or symlink stops the command without touching the earlier receipt. Use a fresh, dated filename for
every attempt. Failed operations retain a labelled incomplete receipt because partial remote work may exist; rerunning
with a new receipt path still safely verifies/skips immutable objects. Receipt contents are written through the reserved
descriptor, and a replaced pathname cannot be reported as a saved receipt.

One command after a fresh upload proves cache MISS then HIT/Age, app-origin CORS, MIME, immutable cache policy, ETag and
decoded bytes/SHA on the three smallest uploaded objects:

```sh
node <worktrees>/lane-cdn/tools/cdn/verify.mjs https://assets.eden.art <team>/scratch/cdn/cdn-plan.json --out <team>/scratch/cdn/cdn-cache-proof.json
```

Use `--key assets/aa/<sha>.glb` to check a particular model, `--sample N` for more objects. The first GET must report MISS;
the second must report HIT and a numeric Age. GET primes the actual body cache. If someone already warmed the object,
strict fresh-MISS proof fails honestly; `--allow-warm` permits a separate warm recheck, labelled as such in its report.
No cache purge or cache-busting query is performed. These checks use no credentials. Hashes are for decoded bytes. An
identity object is checked with identity requests; a precompressed (`assets/br/`) object with br, br, Chrome's header, identity and gzip
requests (CDN3 above).

Focused local verification (synthetic fixtures and mocked HTTP; no real credential/network access):

```sh
node --test <worktrees>/lane-cdn/tools/cdn/cdn.test.mjs
python3 -B <worktrees>/lane-cdn/tools/cdn/install_key_test.py
```

Verify the checked-in prepared manifest independently against actual repo files (no network or credentials):

```sh
node --test <worktrees>/lane-cdn/tools/cdn/manifest-integrity.test.mjs
```

This checks every alias (3,017 today, `/modular` included), and that each hash alias carries the bytes the origin route sends. Named `/world-assets/` and `/worlds/world-assets/` entries resolve to their
literal files under repo `worlds/`; canonical hash aliases resolve through the reviewed core index. Unknown, unsafe,
unresolvable or symlinked paths fail, and every entry must match an independently computed file SHA-256 and byte count.

Protocol references: [AWS SigV4 signed payloads](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html),
[R2 conditional PutObject](https://developers.cloudflare.com/r2/api/s3/extensions/),
[R2 atomic conditional writes](https://developers.cloudflare.com/r2/api/s3/api/).

## Web switch and local browser proof

GLB downloads run in a worker (`apps/web/src/gen-mesh/asset-fetch.ts`), outside the page's `window.fetch` transport; 3.50
shipped with every core GLB bypassing the CDN that way. Since CDN2 the page resolves each job through the manifest
(`cdnRoute` in `cdn-assets.ts`) and the worker fetches the CDN copy, checks its exact length and SHA-256, and falls back to
the original URL on any failure (`asset-fetch-cdn.test.ts` runs the worker's own source against fake fetches).
`window.__assetWorker.cdn` counts the worker's CDN deliveries.

**Runtime check for every release walk** (release.sh only proves the build contains the CDN code):

```sh
node tools/cdn/cdn-walk.mjs <team>/scratch/<run>/cdn-walk https://sim.eden.art/worlds/w/eden-2026/ https://sim.eden.art/w/mars https://sim.eden.art/worlds/w/little-martians-arium
```

Real Chrome, desktop and phone at dpr 1 and 2, worker on. It exits 1 when the origin answers any asset the shipped
manifest maps, when an `assets.eden.art` request is not 200, or when the worker delivered GLBs but none from the CDN.
Against live 3.50 it FAILS on /worlds/w/eden-2026 (6 listed core GLBs from the origin) and passes with `?assetworker=0`.

The site switch is build-time `SIM_ASSETS_CDN_ENABLED=1`, **off when absent** in a plain vite build. `release.sh` (production,
staging, legacy, `--local`) defaults it **on** since CDN1 (3.20-3.49 shipped without it) and fails a build that lacks the
origin or `cdn-manifest-*.json`; `SIM_ASSETS_CDN_ENABLED=0 release.sh ...` turns it off for one release. `SIM_ASSETS_CDN_ORIGIN` defaults to
`https://assets.eden.art`; only that origin and loopback HTTP test origins are accepted. Release the public manifest
with the web app at `apps/web/src/cdn-manifest.json`, after its objects have been uploaded and verified. Vite emits its
hashed URL under `/assets/`, with the correct build prefix; both existing static servers serve this path. The prepared
manifest contains only CC0 and served-public entries (files the origin already serves publicly); it is safe to ship with the switch off. Both root and `/worlds` builds use
the same entry-point transport. Dynamic world asset routes only resolve to explicitly listed immutable hash aliases.
There is no browser query/localStorage override. Unpublished, missing and invalid manifest entries stay on origin.
The content-hashed manifest uses the browser's default cache mode, so repeat visits can reuse its immutable URL.

CDN HTTP/CORS/network/body/timeout/hash errors retry the exact original URL and options. CDN requests omit origin
credentials and referrers. Both GLB fetches and standalone ImageLoader textures are covered. Byte/hash verification
buffers the complete asset before decoding, so the progress meter updates after verification and large objects would
add transient memory. The 12-second CDN timeout covers the response body; caller cancellation is retained. External-
resource `.gltf` files continue using origin. No new speed or memory win is claimed by this publishing-path work.
Mapped standalone images bypass Three's native ImageLoader cache and can decode again on repeated requests.

The repeatable proof uses a fresh fake world, one reviewed CC0 cow, and an original checkerboard texture on a screen.
It consumes the actual dry-run manifest's canonical cow alias, then adds only its synthetic PNG test entry. Ports
5810–5812 are lane-owned. Start the fixture separately, without holding the heavy slot for the server:

```sh
env SIM_ASSETS_CDN_ENABLED=1 SIM_ASSETS_CDN_ORIGIN=http://127.0.0.1:5811 python3 <team>/ops/with-heavy-slot.py --owner cdn --purpose web-cdn-build -- pnpm --filter @sim/web exec vite build --emptyOutDir --outDir <team>/scratch/cdn/web-on
node <worktrees>/lane-cdn/tools/cdn/browser-proof.mjs serve --web-dir <team>/scratch/cdn/web-on
```

In another terminal, run the focused Chrome check; close the fixture with Ctrl-C when it finishes:

```sh
python3 <team>/ops/with-heavy-slot.py --owner cdn --purpose cdn-chrome -- node <worktrees>/lane-cdn/tools/cdn/browser-proof.mjs check
```

The check takes `chromeLease('cdn')`, launches real headless Chrome with `--ignore-gpu-blocklist`, rejects software
renderers, and disposes every context/browser before releasing Chrome. It uses clicks, camera dragging and walk keys.
It proves successful CDN delivery, an actually closed CDN listener, and same-size corrupt responses at DPR 1 and 2,
asserting model readiness and origin fallback for both GLB and standalone PNG. JSON requests/results and screenshots
are written to `team/scratch/cdn/browser-root`. For the prefixed build, build with `--base /worlds/` and another outDir,
then pass `--prefix /worlds --out <team>/scratch/cdn/browser-worlds` to both `serve` and `check`.
The fixture sets the runtime's `WORLD_PATH` to its exact advertised namespace. Its proxy preserves world HTTP/WS
paths, strips `/worlds` only for shared static files, and checks the actual bootstrap identity before Chrome starts.
It never contacts a live world or CDN.

## God uploads: the pull-through Worker (CDN4, 2026-10-20)

`worker/god-uploads.js` is a Cloudflare Worker for the route `assets.eden.art/w/*` (R2 binding `ASSETS` -> `eden-assets`; no
secrets, no key on eden2). `GET /w/<slug>/assets/<sha>.<ext>`: an R2 hit is served with the CDN header contract (immutable,
Content-Type, CORS for https://sim.eden.art, `Content-Encoding br` when stored so, ETag `"<sha>"`) and kept in the edge cache;
a miss is pulled from the god world's own route `https://sim.eden.art/worlds/w/<slug>/assets/<sha>.<ext>`, hashed while it
is read (cap 32 MiB), stored at `w/<slug>/assets/<sha>.<ext>` only when the digest equals the path's sha, and returned.
Every refusal is `no-store` with `x-eden-cdn: refused:<reason>`. Tests: `node --test tools/cdn/worker/god-uploads.test.mjs`
(fake R2, origin and edge cache). Deployment (dashboard, coordinator): `worker/DEPLOY.md`. Proof after deploy:
`node tools/cdn/worker/verify-worker.mjs --god <scratch god folder> --out <receipt>`; `--self-test` runs the same checks
against loopback stand-ins. The client maps a god upload only when the world's snapshot sized it (`assetBytes`), so the
length and SHA checks are the same as for manifest objects; `cdn-walk.mjs` counts these requests (`cdnUploads`).


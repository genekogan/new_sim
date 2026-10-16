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
to the source families in `tools/god-skill/scripts/import-packs.mjs` and exact CSV source-pack rows. Changed/missing source
records, changed derivative bytes, unknown or restricted licences are excluded. This is a bounded shared CC0 list.
World-specific art can instead qualify for delivery to its existing public world under the scoped authorization below;
an existing URL alone does not establish its owner, rights constraints or permitted audience.

## Excluded large assets and world-scoped publication

The prepared manifest still contains 304 aliases for 76 CC0 models (3,337,244 unique bytes). It excludes these assets:

| Asset | Local evidence and current hold |
|---|---|
| Mars campus | The read-only `.lane/mars-web/browser/campus.glb` is 70,772,556 bytes (67.49 MiB), SHA-256 `675f4bebed89d73fb579493e708476f0dfd4c44c0106958a1aad1a92c932a8c4`. There is no exact CC0/own-work CSV record. The corrected-campus references in `apps/web/src/mars-fork.ts` also need their own file identity and scoped authorization. |
| Private Mars derivatives | `worlds/core-assets/mars/` and the Mars records in `worlds/core-assets/index.json` identify campus CAD and the 2026 photographic recipe as private to this project. These records do not grant a shared CC0 catalogue licence. |
| Little Martians scans and derivatives | `worlds/littlemartians/characters/manifest.json` records Vanessa Rosa's ownership, no open licence, and project-limited terms for character/ceramic-head scans. The associated kin meshes and ceramic building derivatives in the core index retain those constraints. |

The release owner's default permits assets already served publicly to a world to use CDN delivery **for that same world
under a world-scoped path**. They must never enter the shared catalogue or receive shared `/assets/<sha>` aliases through
this route. Existing reviewed world-owner/public-serving authorization can establish the basis within its recorded limits;
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
No cache purge or cache-busting query is performed. These checks use no credentials. No Brotli rule is assumed: hashes are
for decoded bytes and the checker requests identity encoding.

Focused local verification (synthetic fixtures and mocked HTTP; no real credential/network access):

```sh
node --test <worktrees>/lane-cdn/tools/cdn/cdn.test.mjs
python3 -B <worktrees>/lane-cdn/tools/cdn/install_key_test.py
```

Verify the checked-in prepared manifest independently against actual repo files (no network or credentials):

```sh
node --test <worktrees>/lane-cdn/tools/cdn/manifest-integrity.test.mjs
```

This retains and checks all 304 aliases. Named `/world-assets/` and `/worlds/world-assets/` entries resolve to their
literal files under repo `worlds/`; canonical hash aliases resolve through the reviewed core index. Unknown, unsafe,
unresolvable or symlinked paths fail, and every entry must match an independently computed file SHA-256 and byte count.

Protocol references: [AWS SigV4 signed payloads](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html),
[R2 conditional PutObject](https://developers.cloudflare.com/r2/api/s3/extensions/),
[R2 atomic conditional writes](https://developers.cloudflare.com/r2/api/s3/api/).

## Web switch and local browser proof

The site switch is build-time `SIM_ASSETS_CDN_ENABLED=1`, **off when absent**. `SIM_ASSETS_CDN_ORIGIN` defaults to
`https://assets.eden.art`; only that origin and loopback HTTP test origins are accepted. Release the public manifest
with the web app at `apps/web/src/cdn-manifest.json`, after its objects have been uploaded and verified. Vite emits its
hashed URL under `/assets/`, with the correct build prefix; both existing static servers serve this path. The prepared
manifest contains only approved CC0 entries; it is safe to ship with the switch off. Both root and `/worlds` builds use
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

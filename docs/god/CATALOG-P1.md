# P1 implementation checkpoint

This is a local candidate implementation, not a deployed release. `CATALOG-PROGRAM.md` remains the binding contract.

## Registry serving

Entity-world servers may opt in with `CATALOG_REGISTRY_DIR=<published registry path>` and optionally
`CATALOG_CHANNEL=stable|candidate`. Native old worlds never construct GodMode and keep their existing path. The registry
is shared per process/licence context; its channel pointer is checked every five seconds. Item words and compact rows
are indexed; engine defs load only when needed. T0 is `/v1/god/catalog/t0`; category pages and compact `find` do not
promote cold defs. T2 puts human text in `catalogue.text`, separate from the exact hashed engine def.

`CATALOG_GENE_OWNER_ID` is an explicit verified owner id, not a key. Without a match, restricted pack items are omitted
from offered/searchable types. Existing world's stored defs remain pinned. Never read account/key files to discover it;
the operator supplies the setting. World-local custom defs remain searchable. Find misses are bounded in each world's
DB, outside the catalogue registry. A bad channel snapshot leaves the last good snapshot in use.

Metadata now has an independent immutable `itemHash` under `items/<id>/<major>/<rev>/<itemHash>.json`. Index snapshots
pin it. The first P0 record is retained, so old indexes still read. Text/review/gate changes do not alter either the
def/2 rev or the engine def/1 hash. Channel writers serialize briefly and immutable blob creation cannot overwrite.

## Per-item authoring

One directory contains `src.mjs` (default-exported def/1 or def/2) and `item.json` (words, CC0 licence/source, author).
New central content is CC0 and `eden/`; explicit pack migration stays in import-core. Budgets and tests are computed.
LAYERS fields remain inert for new source items; no economy/schedule defaults are activated by the builder.

```sh
node packages/catalog/bin/catalog.mjs build packages/catalog/items/object-tool/rain-gauge \
  --registry .lane/registry --out .lane/build/rain-gauge
# Missing G4 correctly fails but emits engine-defs.json for a reviewed unpublished render.
tools/catalog/g4/bundle.sh /tmp/candidate-g4.tgz .lane/build/rain-gauge/engine-defs.json
modal run tools/catalog/g4/g4_modal.py --bundle /tmp/candidate-g4.tgz \
  --defs .lane/g4/candidate-defs.json --out .lane/g4/rain-gauge
node packages/catalog/bin/catalog.mjs build packages/catalog/items/object-tool/rain-gauge \
  --registry .lane/registry --out .lane/build/rain-gauge \
  --receipt .lane/g4/rain-gauge/g4/report.json --publish
```

Publish moves **candidate only**, after G1–G5 pass. G4 must name the exact engine hash and every required variant/state
view on hardware rendering. G5 checks title, two synonyms, two held-out queries, all existing winning first-hit words
and the standing 94-intent regression set. Held-out words are not indexed. Existing lexical misses remain reported;
sentence-model dependency/download still requires the approval described in CATALOG-HANDOFF.

`compat <old-rev> <new-rev>` flags major changes: narrowed/removed params, enums, slots/state/actions/actuators, >10% box
change, anchor/form changes. Breaking changes under the same major fail the build.

## Review and promotion

```sh
node tools/catalog/review-queue.mjs .lane/registry .lane/g4/rain-gauge/g4/report.json .lane/review
# Open .lane/review/index.html locally. Export data; no network writes occur.
node packages/catalog/bin/catalog.mjs review-import /path/to/catalogue-reviews.json \
  --by 'human:gene' --registry .lane/registry
node packages/catalog/bin/catalog.mjs promote eden/rain-gauge --registry .lane/registry
```

Import only the human/PM's actual decisions; never impersonate their approval. Stale decisions fail. Fix/reject holds
survive a rebuild of the same physical revision. The worker-facing promotion command requires green G1–G5 plus an
explicit recorded review, or an established low-risk category/interaction, 48h as candidate and a later green G7.
G7 is not yet built, so automatic promotion is currently blocked. The lower-level Registry API remains for controlled
imports and rollback rehearsal, not a shortcut for workers.

## Verified local milestones and remaining gates

- Rain gauge: 192 triangles, zero asset bytes, G1–G5 pass; exact-hash NVIDIA L4 render with four nonempty views,
  visually inspected; local candidate sequence2. No stable/public publication.
- Source → candidate → reviewed stable → yank → rollback is covered in isolated unit fixtures. Text-only updates
  preserve both hashes. This is not a claim that a live registry was changed.
- New server/authoring/review tests and types pass. Known inherited Mars glazing lint remains outside this lane.
- Full G4 machine catchup covers existing source independently; no failing or unqualified item is baseline-approved.
- **Compiler request still open:** new registry entity placements need `sha:<hash>` refs for two revisions of one major
  to coexist. Only an isolated copy was patched/tested. Apply-ready patch and six-assertion rehearsal are linked in
  `team/lanes/cx-catalog.md`; server name→hash normalization follows that integration. Inheritance revision pinning
  also needs qualification. Do not deploy registry serving before this gap is resolved.
- Real Chrome on NVIDIA L4 passed shared scenarios30/30 and stranger-style mouse/keyboard/menu input at dpr1/2
  on a disposable local Modal launcher. The private review artifact passed real controls/export at both ratios.
  Earlier failed attempts are preserved; each receipt pins its tested source. This does not qualify Gene's actual
  Clerk sign-in, a live Soul join or either public site. Browser receipts are linked in `team/lanes/cx-catalog.md`.
- G4 catchup accounted768 items, captured750, emitted11,604 audited PNGs:656 raw machine passes,94 alerts and
  18 unqualified. No baseline approvals. Backdrop/variant diagnostic fixes have targeted regression proof; body,
  invisible/shared-terrain, opaque glass/opening/SSIM and loader-readiness coverage still need qualification.
- No production registry install. Mars holds the local Chrome lease and release boundary; CDN waits for Gene's
  `R2 ready: <domain>`. Nothing in this checkpoint changes either public site.

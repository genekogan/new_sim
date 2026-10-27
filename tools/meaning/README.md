# World meaning

Meaning is authored against a compiled, patched world, not inferred from furniture
names. Start with `STYLE.md`; `extract.mjs` emits bounded candidate records. Each
`worlds/meaning/<name>.json` pins the materialized source hash and binds named
parts to real rooms, entities, slots or supported points.

From the repository root (Node 22):

```sh
node --experimental-strip-types tools/meaning/materialize.mjs mars-two /tmp/mars-physical.json
node --experimental-strip-types tools/meaning/overlay.mjs lint mars-two
node --experimental-strip-types tools/meaning/overlay.mjs apply mars-two /tmp/mars-enriched.json
```

Materialization strips only validated meaning batches, retains reviewed physical
patches and fixtures, and preserves stable references across replay seeds.
Enrichment adds final bounded batches and verifies that meaning changes neither
entity geometry nor the physical genesis hash. Minor paving can intentionally
have no title; review those lint warnings rather than naming every tile.

## Live worlds

Use an already paired God CLI folder. The CLI consumes credentials internally;
never copy tokens into commands or receipts. Do not replace a live world from a
template. These commands modify only previously absent `about` fields, preserve
custom meaning, and refuse incompatible physical sources:

```sh
node --experimental-strip-types tools/meaning/live.mjs plan worlds/meaning/mars-two.json /absolute/god-folder /absolute/receipt.json --expected-world-id ACTUAL_WORLD_ID
node --experimental-strip-types tools/meaning/live.mjs apply worlds/meaning/mars-two.json /absolute/god-folder /absolute/receipt.json
node --experimental-strip-types tools/meaning/live.mjs rollback worlds/meaning/mars-two.json /absolute/god-folder /absolute/receipt.json
```

Inspect every skipped or preserved record before applying. Actual-live overlays
and reviewed supplements accept a final source-snapshot path; its hash must match
the overlay provenance. Apply the primary overlay first, then its supplement.
See `worlds/meaning/live/README.md`. New physical fixtures require separate
reviewed God edits and verification before their descriptions can be applied.

Receipts contain exact preimages, revision guards, stable request IDs and the
exact preview submission. Each new plan has a unique transaction identity and requires an explicit target world ID. Writes use an atomic rename. Retrying `apply` after a
lost response reuses the same request; it must not invent another operation.
If an uncommitted preview expires, stop and inspect the request journal and exact
preimages before making a fresh plan. Rollback restores only this receipt's fields
and refuses to overwrite intervening edits. Retain receipts and before/after
snapshots with the release evidence.

The unified 2026-10-27 release permits live Eden, Mars College and godmode-lab
only. Little Martians overlays are offline template content; arium is excluded.

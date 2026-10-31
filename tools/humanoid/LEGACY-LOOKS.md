# Legacy resident looks

Ordinary boots preserve existing bodies. This opt-in migration gives a resident with no explicit body the classic
`core/humanoid@2` look: height 1.75 m, build 1, head size 1, walking speed 1.35 m/s. Existing looks, uploads and
non-human bodies are skipped; nothing generates a new body or picks a random appearance.

Run it on an already-open, correctly configured world host, with the usual sole-writer rule and a whole-data backup.
Never open a second process against an active database, construct a guessed engine factory, or copy a production
database to test it.

## Running

Set the options for one ordinary startup of the world (`apps/server/src/main.ts`):

```
LEGACY_LOOKS_MODE=plan LEGACY_LOOKS_SOCIAL_PRESETS=0
LEGACY_LOOKS_MODE=apply LEGACY_LOOKS_SOCIAL_PRESETS=0
LEGACY_LOOKS_MODE=rollback-plan
LEGACY_LOOKS_MODE=rollback
```

For worlds run by the world launcher, put the same lines in `<DATA_DIR>/legacy-looks.env` instead (only these two keys
are allowed; the process environment wins when it sets `LEGACY_LOOKS_MODE`). The boot hook runs the mode once, prints a
`[legacy-looks] <json>` line, writes `<DATA_DIR>/legacy-looks-<mode>-<time>.json`, and renames the file to
`legacy-looks.env.done-<mode>-<time>`; an apply that deferred residents keeps the file so the next boot retries them.
Remove environment options after the maintenance boot.

`plan` and `rollback-plan` make no migration writes (an ordinary boot still does its normal clock, bridge and boot
writes). Residents that are not safely standing appear in `deferred`; retry later. Apply is idempotent; the clock drains
the guarded assignments before the server listens.

A process that already holds `{host, db, edge}` can call `runLegacyLookMaintenance(host, db, edge, options)` from
`apps/server/src/edge/body/migrate-looks.ts` with the same options; the host clock must be running (or the caller drives
`host.drainInputs()`). The migration adds no HTTP route.

## Palette

`LEGACY_LOOKS_SOCIAL_PRESETS` must match what the viewer shows. Use `0` for ordinary worlds. Use `1` only for the
audited social palette in authored Eden, where `humanPresetsEnabled`, `edenExpansion`, authored-commons geometry and the
template provenance gate already apply; never because a Soul has a matching name or key, which could recolour a
classic resident. The social palette keeps recognizable colours with 8-bit quantization; classic presets keep the exact
kit palette.

## Receipts and rollback

Each assignment and its `legacy_looks_v1` receipt commit in one transaction, in the world database and its backups.
Rollback appends a compensating body assignment to `null`; it never erases events or restores a snapshot. It refuses a
resident whose authority, standing state or body has changed, and a later owner assignment protects the body even if
its bytes match. Retired, faded or busy residents are never revived, moved or interrupted.

## Checks

```
node --test apps/server/src/edge-body-migrate-looks.test.ts
node tools/humanoid/migrate-looks.browser.mjs
```

The browser check boots fresh data with fake minds on a local port (`BODIES_PROOF_PORT`, default 5940) and real Chrome,
records the same residents before and after at dpr 1 and 2, then checks rollback and a second boot. Output goes to
`BODIES_PROOF_OUT`. It uses the checkout's `mars/viewer/public` assets including the humanoid kit; a release must serve
`/modular/humanoid/` from matching assets before applying the migration.

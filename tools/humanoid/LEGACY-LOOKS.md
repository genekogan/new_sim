# Legacy resident looks (R11b)

Ordinary boots preserve existing bodies. This opt-in migration turns a resident with no
explicit body into the same classic `core/humanoid@2` look. Height stays 1.75 m, build 1,
head size 1 and walking speed 1.35 m/s. Existing looks, uploads and non-human bodies are
skipped. Nothing generates a new body or chooses a random appearance.

The release owner runs it on an already-open, correctly configured world host. Keep the
usual sole-writer and whole-data backup procedure. Do not open a second process against
an active database, construct a guessed engine factory, or copy a production database
to test this operation.

For entity worlds started through `apps/server/src/main.ts`, set one-time environment
options on that world's ordinary startup:

```
LEGACY_LOOKS_MODE=plan LEGACY_LOOKS_SOCIAL_PRESETS=0
LEGACY_LOOKS_MODE=apply LEGACY_LOOKS_SOCIAL_PRESETS=0
LEGACY_LOOKS_MODE=rollback-plan
LEGACY_LOOKS_MODE=rollback
```

Read the `[legacy-looks]` JSON result. Remove these options after the maintenance boot.
`plan` and `rollback-plan` make no migration writes. Unsafe residents appear in
`deferred`; leave them alone and retry when they are safely standing. Apply is idempotent.
The real clock drains the guarded assignments before the server starts listening.
The migration planner itself is read-only. An ordinary server boot still performs its
normal clock, bridge and boot writes, including when the migration mode is `plan`.

The original-world operator exposes its already-open `{host, db, edge}`. From the same
process, import `apps/server/src/edge/body/migrate-looks.ts` from the selected release and
call `runLegacyLookMaintenance(host, db, edge, options)` with the same options above.
The host clock must be running (or the operator must drive `host.drainInputs()`). No
HTTP route or public authority is added by this migration.

Palette selection must match what the existing viewer actually shows. Use `0` for
ordinary/Simple worlds. Use `1` only for the audited social palette in authored Eden
where `humanPresetsEnabled`, `edenExpansion`, authored-commons geometry and the original
template source-provenance gate already apply. Do not turn it on merely because a Soul
has a matching name/key: that could recolour a previously classic resident. The audited
social palette retains recognizable colours with 8-bit colour quantization; classic
presets retain the exact kit palette. The three default physical dimensions are exact.

Each accepted assignment and its `legacy_looks_v1` receipt commit in one transaction.
Receipts remain in the normal world database and its backups; no private export is
needed. Rollback appends an ordinary compensating body assignment to `null`. It does
not erase events or restore an old snapshot. It refuses a resident whose authority,
safe-standing state or body has changed. A later owner assignment protects the body
even if its bytes match the migration's body. The receipt and rollback marker survive
restart. Retired/faded/busy residents are never revived, moved or interrupted.

Focused proof:

```
node --test apps/server/src/edge-body-migrate-looks.test.ts
node tools/humanoid/migrate-looks.browser.mjs
```

The browser proof uses only fresh data, fake minds, bodies ports 5940–5941 and real Chrome
with the `bodies` lease. It records the same residents before/after at dpr 1 and 2, then
checks rollback and a second boot. Scratch defaults to `team/scratch/bodies/migration`.

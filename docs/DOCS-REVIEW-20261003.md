# Documentation review — October 3, 2026

This sprint reconciled the active Sim/eden4 guidance with the delivered merge,
without changing runtime code, Gene's decisions, protected original sources or
qualification criteria. Current entrypoints are [the map](README.md),
[STATUS](STATUS.md) and [the runbook](sim/RUNBOOK.md).

Corrected: future Mars-import/text-only claims; canonical checkout and process
routing; local/CI test commands; six DB migrations, paid reservations and take
manifests; living mandates versus Toy agendas; reflection/narrator cadence;
phase-aware snapshots, graceful accepted-head replay and rollback capability;
world/Lab/asset boundaries; and physical rooms/construction versus deferred design.
The Toy-only kernel verifier is now labeled rather than suggested for another world.

The former accumulating STATUS page is retained in
[dated milestone history](MERGE-MILESTONES-20261003.md). Original RED native gate,
failed soak/test receipts and focused passing repairs remain separate. Only the
elapsed 24-hour Little Martians checkpoint remains due after October 4 13:27 UTC,
with at least 24 living days required; no accelerated proof substitutes for it.

Selected strategy mirrors now include 20–23 and the published research reports/
tours. Historical onboarding and research resume have current-authority pointers.
Native reference copies refresh from the in-repo fork, retain currency labels and
resolve source-relative links into actual fork files. The original binding
integration boundary is a byte-identical retained copy: its internal relative
references retain original-source context. [The native index](mars/README.md)
explains this exception. External research claims/prices were not re-researched;
the reports explicitly retain their dates and do not guide current operations.

`infra/sync-docs.sh --check` verifies selected content without writes. The sync is
idempotent, excludes MERGE-LOG/raw proof/audit databases/media, preserves Sim-authored
introductions, and records source/mirror SHA-256 digests in
[mirror-manifest](mirror-manifest.json). All 271 checked Markdown navigation targets resolve locally; 70 selected
mirrored files match their recorded digests. The repeated read-only sync check
reports zero stale selected files; inherited exact boundary links are the explicit
exception. This does not claim external URL or every historical anchor validation.

Required runtime proof is reused because runtime code is unchanged. A useful docs
release receives its own staging build/health/ten-route smoke and production
receipts; exact live identity remains `/healthz` plus the local MERGE-LOG.

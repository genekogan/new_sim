# REPORT — library (M4), cloud session D, 2026-10-16

Branch `cloud/library-20261016` (from `lane/library-20261016` @ d178d184). Code head `227a5ee`; this report is the
commit after it.

## Done (no browser needed)
- **tsc fixed**: `packages/library/package.json` devDependency `@types/node ^22.19.19` (+ lockfile importer).
  `tsc --noEmit -p packages/library` clean.
- **Godmode routes** (`apps/server/src/god/shared-library.ts`, mounted with one line in `http.ts`), god token only:
  `GET /v1/god/library?q=&k=` (find; `placedHere`, `mine`, versions) · `GET /v1/god/library/item?id=<world>/<name>[@n]`
  (record, offered?, every version and whether it is placed here) · `POST /v1/god/library/place {item, at:[x,z],
  name?, r?, dry?}` (models first, then ONE batch define+place; pins the version; reuses identical defs; refuses a name
  clash) · `POST /v1/god/library/publish {ref, licence?, attribution?, source?, title?, authorName?}`.
  The site library is `SIM_LIBRARY_DIR` (unset → 503 `library.unavailable`). Built on `packages/library` only (no
  `@sim/catalog`).
- **Moderation seam**: every model goes through `validateUpload()` (`deps.gate`; default = the library's local
  stand-in in lane C2's call shape) before the world's own asset store (which re-checks its budget); a gate that
  changes the bytes is refused (`moderation.changed`) so pins stay content-addressed; publish gates defs + models.

## Tests (this sandbox)
- `node --test apps/server/src/god/shared-library.test.ts` — 3/3 pass (two real GodMode worlds sharing a library)
- `node --test packages/library/src/*.test.ts` — 6/6 pass
- `pnpm -C apps/server exec tsc --noEmit -p .` — clean; `tsc -p packages/library` — clean
- `node tools/library/e2e-flow.mjs <scratch>` (real dev worlds :6120/:6121, fake minds) — **PASS 23/23**, now incl.
  `route.find`, `route.place`, `route.restricted-absent` through beta's Godmode

## To do locally / left
- Browser: `apps/web` build + `e2e-flow.mjs <dir> --shots <dir>` real-Chrome shots (dpr 1, 2) of beta.
- **Real moderation gate**: lane `lane/moderation-20261015` (not merged here). At merge, pass
  `gate: (b, p) => validateUpload(b, assetPolicy(budget))` from `apps/server/src/moderation/validate.ts` in the
  `http.ts` mount (its result has `format/sha/bytes`, a superset); also consider `intakeUpload`/`recordIntake` for the
  classifier verdict. Today the stand-in runs.
- Not done: god CLI commands (`library find|show|place|publish` in `tools/god-skill/cli.mjs`) and a SKILL.md
  paragraph — left out to keep this branch off the shared CLI; the routes are ready for them.
- Decision for Gene/ops: where `SIM_LIBRARY_DIR` lives on the server (one dir per box, backed up with the worlds).

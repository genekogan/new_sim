# L10 patches (not applied on `root/t2-humanoid`)

| Patch | Files | What | Needs |
|---|---|---|---|
| 04-migrate-legacy-looks.patch | new `apps/server/src/edge/body/migrate-looks.ts` + `apps/server/src/edge-body-migrate-looks.test.ts` | the legacy-look **data migration**: every live Soul whose body is today's plain humanoid gets that exact look written as a `core/humanoid@2` body (preset by id hash; the 8 audited social Souls' palettes as explicit colours when `socialPresets`), one logged `body-assignment-v1` per Soul (author `world:body`), dry run by default, idempotent, unsafe bodies deferred; floaters, uploads and looks untouched; sizes stay today's so the engine body is unchanged | Gene's yes and Codex (it rewrites existing Souls' records); then a call site (operator script or boot flag) |

`git apply tools/humanoid/patches/04-migrate-legacy-looks.patch`; its test passes on this branch (verified in
`.lane/verify`). The former patch 01 (engine body params) is applied on the branch since the 2026-10-10 ownership
split (bodies are world engine). Patches 02 and 03 became proposals for Codex: `../proposals/README.md`.

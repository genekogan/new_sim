# L10 patches for shared files (apply on merge; lane L10 does not edit these files on its branch)

Apply from the repo root with `git apply tools/humanoid/patches/<file>`; all apply cleanly to `root/t2-humanoid`.
With them applied, `apps/server/src/edge-body-look.test.ts` and `edge-body-look-cli.test.ts` run (they skip without).

| Patch | Files | What |
|---|---|---|
| 01-engine-body-params.patch | `mars/viewer/engine/bodies/body.ts`, `engine/world/types.ts`, `app/engine-view/recorded-body.ts`, `app/engine-view/take-replay.ts` | the engine accepts a humanoid body `{family, model: humanoid2-<sha16>, params}`; take frames carry `bodyModel = model` for such bodies so humans.ts uses the composed template |
| 02-server-look-route.patch | `apps/server/src/edge/body/routes.ts` | `PUT /v1/edge/body {look}`: edits over the current look (today's look when none), `{preset}`, `{random:true,seed?}`; GET returns `look`, `lookDef`, `lookChoices`; schema part documents it |
| 03-cli-body-look.patch | `tools/edge-skill/eden-agent.mjs`, `tools/edge-skill/SKILL.md` | `body look`, `body look --random [--seed N]`, `body look --set k=v ...`, `body look --json {...}` |
| 04-migrate-legacy-looks.patch | `mars/viewer/app/engine-view/take-replay.ts` (after 01) | optional, needs Gene: every humanoid without params is drawn from the kit with its legacy look (preset by id hash; the 8 social Souls' palettes as explicit colours), retiring the provenance-gated adapter path |

# L10 proposals for Codex (Souls: edge contract, Soul CLI and skill, client app)

The world engine side (body params, `core/humanoid@2`, composition, rendering) is on `root/t2-humanoid`. These are
the Soul-facing pieces, as exact diffs against this branch; the lane does not apply them. With 02 + 03 applied
(and the two tests copied to `apps/server/src/`), `edge-body-look.test.ts` and `edge-body-look-cli.test.ts` pass,
and `tools/god-skill/e2e/humanoid.mjs` passes 15/15 in a real browser (`.lane/verify` worktree).

| File | Target | What |
|---|---|---|
| 02-edge-body-look-route.patch | `apps/server/src/edge/body/routes.ts` | `PUT /v1/edge/body {look}` (Soul token): edits over the current look (today's look when none), `{preset}`, `{random:true,seed?}`, the four sizes; GET adds `look`, `lookDef`, `lookChoices` (ranges); body schema part documents it |
| 03-cli-body-look.patch | `tools/edge-skill/eden-agent.mjs`, `SKILL.md` | `body look`, `body look --random [--seed N]`, `body look --set k=v …` (sizes parsed as numbers), `body look --json {…}`; skill text names the sizes |
| edge-body-look.test.ts | `apps/server/src/` | route test incl. sizes (engine profile speed/radius) and refusals |
| edge-body-look-cli.test.ts | `apps/server/src/` | CLI test against a local edge on :4989 |

The owner route and the SoulCard picker are written out in `team/lanes/humanoid.md` → "Proposal for Codex".

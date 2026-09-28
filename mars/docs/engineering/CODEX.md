# CODEX.md: guide for the external Codex contributor

Codex works on bounded areas of the Mars College 3D Studio simulation engine, on `codex/<topic>` branches in its
own git worktree. The Claude lead re-gates and merges. This file is the contract: read it and your brief
(`docs/engineering/briefs/codex-*.md`) before touching anything. Decision record: OWNER_DECISIONS.md, Gene
2026-09-29 "External Codex split" (the ownership map below is the final, corrected version of it).

Repo: `<mars-campus-repo>`. It is a local git repo only, with author genekogan and
no remote. **Never push. Never add a remote.** The app and engine live in `viewer/`. Engine hard rules:
`docs/engineering/ENGINE_GUIDE.md`.

## 1. Worktree recipe (exact)

```sh
MAIN=<mars-campus-repo>
TOPIC=<topic>                                  # e.g. camera-nl-parse (matches your brief)
WT=<mars-worktrees>/$TOPIC
mkdir -p "$(dirname "$WT")"
git -C "$MAIN" worktree add "$WT" -b "codex/$TOPIC" main
# the four symlinks: dependencies, Playwright's Chromium, the 2026 campus model (both encodings)
ln -s "$MAIN/viewer/node_modules"               "$WT/viewer/node_modules"
ln -s "$MAIN/viewer/.pw-browsers"               "$WT/viewer/.pw-browsers"
mkdir -p "$WT/viewer/public/browser"           # not in git; must exist before the next two links
ln -s "$MAIN/viewer/public/browser/campus.glb"    "$WT/viewer/public/browser/campus.glb"
ln -s "$MAIN/viewer/public/browser/campus.glb.br" "$WT/viewer/public/browser/campus.glb.br"
```

Notes:
- `viewer/.pw-browsers` shows up as untracked (`?? viewer/.pw-browsers`). **Never `git add` it.** The other
  three links are ignored.
- `node_modules` is the main checkout's. **Never run `npm install` / `npm ci` through the symlink**: it would
  rewrite the lead's dependencies. A brief that changes dependencies (only `codex-tooling`) first replaces the
  link with its own copy: `rm "$WT/viewer/node_modules" && (cd "$WT/viewer" && npm ci)`.
- Work only inside `$WT`. Never edit files in `$MAIN`, and never check out or touch another `codex/*` or
  `w*` branch.

### Your own ports and output directories (mandatory)

Claude workers run Vite and Playwright concurrently on this machine. The defaults are theirs, so use these values:

| What | Key | Default (Claude's) | **Codex uses** |
| --- | --- | --- | --- |
| Playwright's Vite server | env `E2E_VITE_PORT` (read by `e2e/playwright.config.ts` and `e2e/helpers.ts`) | 5391 | **5491** |
| A manual dev server | `npx vite --port <p> --strictPort` (`vite.config.ts` has `strictPort`; `npm run dev` would take 5173) | 5173 | **5493** |
| Local Durable Object for e2e | `E2E_SIMULATION=1` + `MARS_SIMULATION_PORT`; the inspector port 9337 is hard-coded | off / 8897 | **leave off** (no Codex brief needs it) |
| Playwright run id → artifact dir `viewer/e2e/artifacts/<E2E_RUN>/` | env `E2E_RUN` | ISO timestamp | **`codex-<topic>-<n>`** |
| Playwright `outputDir` (traces, failures) | `e2e/playwright.config.ts` `outputDir` = `viewer/test-results` | per worktree | per worktree (`$WT/viewer/test-results`); do not change the config |
| Gate report dir | `deploy/gate.mjs` writes `viewer/.cloudflare/gate/<stamp>/`; no env override | per worktree | Codex does **not** run the gate (§3). If it ever ran, the report would land in `$WT/viewer/.cloudflare/gate/` |

`e2e/artifacts/`, `test-results/` and `.cloudflare/` are gitignored. Never commit anything from them.

## 2. Hard rules (details: ENGINE_GUIDE.md)

- **Node strip-types TypeScript.** No parameter properties, `enum`, `namespace` or decorators. Relative imports
  carry `.ts`. Use `import type` for types.
- **Engine core (`viewer/engine/**`) depends on `zod` only.** No three.js, DOM, `Date.now` or `Math.random`.
  Randomness comes from `core/rng.ts`, seeded, with its state in `world.rng`.
- **No host transcendentals in `viewer/engine/**`.** `Math.sin/cos/tan/asin/acos/atan/atan2/…/exp/log/pow/cbrt`
  and **`Math.hypot`** are forbidden. Use `core/math.ts`: `dsin dcos dtan datan datan2 dasin dacos dexp dlog`,
  plus `hypot`, `len2` and `dist2`. The source-scan test `engine/test/core.test.ts:292-313` enforces this over
  every file under `engine/`. It does **not yet** catch the `**` operator (the tooling brief adds that).
  Do not use `**` in engine code either.
- **Determinism.** Fixed tick `DT = 1/20 s`. Iterate in insertion or sorted order. No wall clock. Renderers and
  cameras only read world state.
- **Fail loudly.** Refusals are structured `Diagnostic { code, message, subjects, at }` naming concrete objects.
  Never "succeed" by clipping, guessing or silently defaulting.

## 3. Gate commands (Codex)

From `$WT/viewer`:

```sh
npm run test:engine                                   # node --test engine/test/*.test.ts (~1–15 min)
npx tsc --noEmit -p .                                 # clean
npm test                                              # deploy/*.test.mjs (fast; run it if you touched deploy/)
E2E_VITE_PORT=5491 E2E_RUN=codex-<topic>-1 npx playwright test -c e2e/playwright.config.ts <spec>.spec.ts
                                                      # one spec at a time: the ones your brief names
```

`playwright.config.ts` sets `PLAYWRIGHT_BROWSERS_PATH` to `viewer/.pw-browsers` itself. Baselines: re-capture
only **your own** baselines, with `E2E_UPDATE_BASELINES=1` on the same command. Look at the PNGs before you
commit them.

**`npm run gate` is the lead's release gate.** Do not run it as your acceptance, and never quote it in a report.
The lead runs it at merge.

Before **every** report:

```sh
git -C "$WT" rebase main
npm run test:engine                                   # re-run on the rebased branch
```

A red test on the rebased branch goes into the report as red, with the failing test named.

## 4. The pin rule

Pinned hashes are the truth of this engine. They include:
- the determinism probe;
- the campus flagship;
- stress-30, meal, build-bay v3;
- the year-build first bay, whole skeleton and A+B;
- takes and camera ids.

They are listed in `PLANNING_BUDGET.md` and asserted in `engine/test/*.test.ts` and
`deploy/record-campus-take.mjs --check`.

- **Never edit a pinned hash**, expected tick count or expected take / camera id.
- **A pinned hash that moves means STOP, REVERT, REPORT.** Revert the change that moved it (`git revert` or
  drop the commit). Write in your REPORT which test, the old and new value, and the commit that moved it. Then
  continue with work that does not move it. Re-pins are the lead's decision only.
- A test you did not write that fails is also stop-and-report. Do not "fix" it by loosening it.

## 5. Commit rules

- Commit **only your own paths** (§6 and your brief): `git add <paths>`. Never `git add -A` or `git add .`.
- Keep commits small and focused, with a green `test:engine` + `tsc` at each one. Never commit red.
- End every message with `Co-Authored-By: Codex <noreply@openai.com>`.
- **Never push, never add a remote, never touch `main`.** The lead merges.
- If `.git/index.lock` exists, wait a few seconds and retry. Never delete it.

## 6. Ownership map (final)

**Codex-owned.** You may create and edit these, and only these:

| Area | Paths |
| --- | --- |
| Natural-language camera parse | `viewer/engine/camera/parse.ts`; its tests `viewer/engine/test/camera-parse*.test.ts` |
| Fire | `viewer/app/engine-view/fire.ts`; `viewer/e2e/fire.spec.ts`; its baselines `viewer/e2e/baselines/fire-*.png` |
| Render polish (paint / solar / equipment / frame colour) | `viewer/app/engine-view/paint.ts`; **new** `viewer/app/engine-view/solar-mesh.ts`, `equipment-mesh.ts`, `palette.ts`; **new** `viewer/e2e/render-polish.spec.ts` + its baselines `viewer/e2e/baselines/render-polish-*.png`; in `viewer/app/engine-view/components.ts`, **only** the bodies of `panel()` / `equipment()` and the colour lookup in `build()` / `upright()`, reduced to one-line delegations to the new files (see the brief) |
| 2026 grouping data | `docs/engineering/data/**`; **new** `viewer/deploy/group-2026-frames.mjs` + `viewer/deploy/group-2026-frames.test.mjs` |
| Lint / gate tooling | `viewer/.oxlintrc.json`; `viewer/package.json` (`lint` script + devDependencies only) and `viewer/package-lock.json`; `viewer/deploy/gate.mjs` (the lint stage only); **new** `viewer/engine/test/source-scan.test.ts`, and deleting the old scan block `engine/test/core.test.ts:292-313` that it replaces |
| Reports | `docs/engineering/briefs/<brief>.REPORT.md` |

**Claude-owned.** This is everything else. It explicitly includes:
- locomotion (`engine/locomotion/**`), construction (`engine/construction/**`), campus (`engine/campus/**`, incl.
  `assembly.ts`), spatial (`engine/spatial/**`), body (`engine/body/**`);
- **take (`engine/take/**`)**, year-build sequencing (`engine/scenarios/year-build*.ts`, `campus/sequence*.ts`),
  studio replay (`app/studio/**`), **`app/history/scenes.ts`** and all of `app/history/**`;
- `engine/camera/*` other than `parse.ts`, `engine/world/**` (incl. `catalog.ts`), `app/lab/**`, `app/engine-view/*`
  other than the files above;
- all other e2e specs and baselines;
- every doc in `docs/engineering/` except `data/**` and your REPORT files. In particular, **never write
  PROGRESS.md, HANDOFF.md, NEXT_SESSION_PROMPT.md or OWNER_DECISIONS.md**.

Reading anything is fine. If your task seems to need a Claude-owned edit, stop and put the exact edit you need
(file, function, why) in your REPORT. The lead makes it.

## 7. Frozen interfaces

- **`cameraDirectionSchema`** (`viewer/engine/camera/direct.ts:62`, zod strictObject; type `CameraDirection`,
  line 73) is frozen for Codex as of `be0f66a` (2026-09-29). `parse.ts` produces values of this schema and must
  not change it. **If it ever changes, the lead records it here** (date, commit, what changed) and the parse brief
  is updated.
  - Change log: *(none)*. W58 (2026-09-29, branch `w58-controller`) left it unchanged: the parser op
    `engine_parse_camera` and `engine_direct_camera { sentences }` consume `parse.ts` as is. **Pending request
    (LM-009):** a fixture subject kind (`subject.kind: 'fixture'`, "hold on the sink") needs this schema to change —
    not made; the lead decides, then logs it here and updates the parse brief.
  - Contract notes for Codex from W58 (no change needed now): `ParseVocab.fixtures` is accepted but unused by
    `subjectOf`; there is no entity slot and no alias slot, so W58's alias table lives outside the parser
    (`api/camera-vocab.ts`, applied to the parsed `assembly: 'rack bay'`).
- The take schema (`mars-take/4`), `physicalView()` and `RULES_VERSION` are Claude-owned. Codex never bumps them.
  W58 (LM-003) made `physicalView()` include a region's `layout` (only when present, so no existing hash moved).

## 8. Reports

Write your report to `docs/engineering/briefs/<brief>.REPORT.md` (e.g. `codex-camera-nl-parse.REPORT.md`) and
commit it on your branch. **Never write it to PROGRESS.md or HANDOFF.md.** Append a dated section per report:

1. Branch, base (`git merge-base HEAD main`) and commits (hash + subject).
2. What changed, per file.
3. The exact commands run on the rebased branch and their results: `test:engine` pass / fail / skip counts,
   `tsc`, each Playwright spec.
4. Pins: "all pinned tests pass unchanged", or the STOP-REVERT-REPORT record (§4).
5. Captures you looked at (paths), and what you saw.
6. Open issues, refusals you could not resolve, and Claude-owned edits you need.
7. Approximate tokens and wall-clock.

## 9. Merge protocol (what the lead does)

1. It reads the REPORT. It checks out `codex/<topic>` in a lead worktree (same symlink recipe) at the reported
   commit.
2. It re-gates there: `npm run test:engine`, `npx tsc --noEmit -p .`, the brief's Playwright specs and any spec
   touching the changed renderer files. `npm run gate` runs before any release that includes it.
3. **Accept:** fast-forward `main` when the branch is on `main`'s tip; otherwise cherry-pick the commits. The lead
   accepts drift in other people's baselines that the change legitimately causes (e.g. firelit pixels in lab
   baselines after a fire change) after looking at them, and refreshes those itself.
4. **Reject:** a change that moves a pin, edits a Claude-owned path, or fails the re-gate is rejected. The reason
   is appended to the brief's REPORT file on `main` ("Lead review: rejected — …"), and Codex continues from there.
5. The lead notes the merge in PROGRESS.md. Codex never does.

## 10. Briefs

| Brief | Area | ETA (estimate, Codex hours) |
| --- | --- | --- |
| `briefs/codex-2026-frame-grouping.md` | 2026 CAD `rack_member` + beams → catalog frames / beams with seat heights (JSON + unclassified report) | 6–10 h |
| `briefs/codex-camera-nl-parse.md` | sentence → `CameraDirection`, structured refusal | 4–6 h |
| `briefs/codex-fire-v2-and-render-polish.md` | fire weak spots; paint textures incl. the 2024 flower mural; solar / equipment meshes; green frames | 6–10 h |
| `briefs/codex-tooling.md` | `npm run lint` repaired, then gated; source scan extended to `**` | 2–4 h |

The ETAs are W33's estimates, not measurements. They are uncalibrated for Codex and assume no pin trouble.

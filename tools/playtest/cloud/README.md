# Playtest in a cloud session

`run-replay.sh` replays the frozen set (ROOT-CAUSES §E, `review/scorecard.mjs` FROZEN) against a fix branch on a
dedicated cloud box and commits the results to the `playtest-results` branch.

## The prompt

Create a Claude Code cloud session on `genekogan/sim`, branch **`lane/playtest-20261024`** (the runner lives there),
and give it exactly:

> run `bash tools/playtest/cloud/run-replay.sh lane/soul-fix-20261025 fix-r1 1` and report the SCORECARD.md path

Change the three arguments per run: `<fix-branch> <out-name> [repeats]`. A rerun with the same out-name resumes.
If the session starts on another branch, prefix the prompt with "git fetch origin lane/playtest-20261024 && git checkout
lane/playtest-20261024, then".

## What it does (beside the clone, in its parent directory)

1. `git worktree add ../server origin/<fix-branch>` (detached; a rerun checks out the branch's current head).
2. `pnpm install --frozen-lockfile` in the clone and in `../server`; `npx vite build` in `../server/apps/web`
   (skipped when `dist/.built-sha` already names the fix sha).
3. `node tools/playtest/arena/assets-overlay.mjs ../mars-web --server-root ../server`: the MARS_WEB_DIR overlay from
   production URLs (manifests and Draco under `/mars-assets/`, `/browser/campus.glb`, the humanoid kit and every part it
   names, the environment meshes), resumable, with `overlay-manifest.json` (url, bytes, sha256). Needed because a dev
   world otherwise proxies `/modular` and `/browser` to sim.mars.college, which the cloud network does not allow.
   `PLAYTEST_MARS_WEB` is set to it; `provision.mjs` also finds `<server-root>/../mars-web` on its own.
4. `playtest.mjs preflight --server-root ../server --force-machine` → `cloud-preflight.json`.
5. `playtest.mjs replay-set --server-root ../server --out ../results/<out-name> --repeats N --force-machine
   --frozen tools/playtest/frozen/frozen.json`. The box is dedicated, so gate breaches are recorded, not waited on.
6. `cloud/compress-shots.mjs`: every PNG → JPEG ≤ 1024 px (q75); `.png` references in text files become `.jpg`.
   story.html keeps its inline thumbnails.
7. `CLOUD.md`: nproc, memory and load before/after, fix sha, playtest sha, toolchain, per-step timings.
8. Secret guard (token-shaped strings stop the commit), then commit `results/<out-name>/` on `playtest-results`
   (orphan branch on first use) and `git push origin playtest-results` with backoff. Files over 95 MB are left out and
   listed in `OMITTED-LARGE-FILES.txt`.

Exit code: the replay set's (0 ok, 2 preflight/gate), 3 secret guard, 4 push failed (results committed locally in
`../results-branch`).

## Environment it expects

Ubuntu 24.04 as root, node 22 (adds `--experimental-strip-types` below 22.18), pnpm 10 (corepack fallback), the global
`playwright` module with browsers under `/opt/pw-browsers`, an authenticated `claude` CLI, no Codex, network to package
managers, sim.eden.art, assets.eden.art and GitHub. ImageMagick is installed with apt when no image tool exists.

## Portability pieces (lib/platform.mjs)

- Playwright: `$PLAYTEST_PLAYWRIGHT_PKG`, then the global `playwright` (NODE_PATH, `npm root -g`, /usr/lib, cwd), then
  `<server-root>/mars/viewer`, then the laptop viewer. `PLAYWRIGHT_BROWSERS_PATH` is set only when the macOS cache or
  `/opt/pw-browsers` exists.
- Chromium: darwin uses the scenario's gpu (Metal); linux always headless SwiftShader with `--no-sandbox
  --disable-dev-shm-usage`. The scenario's `gpu: metal` is ignored on Linux.
- Memory gate: vm_stat on darwin, MemAvailable on linux. Quota: skipped with a note when `<usage-tool>` is absent.
- Thumbnails: sips on darwin, else ImageMagick (`magick`/`convert`), else ffmpeg.

## The frozen bundle

The cloud box has no `<team>/playtest/runs`, so `tools/playtest/frozen/frozen.json` carries each frozen run's replay
scenario and baseline measures (no screenshots or transcripts). Rebuild it on the laptop after the oracles or the frozen
set change, and commit it:

    node tools/playtest/playtest.mjs freeze-bundle [--baseline <team>/playtest/replays/<replay-set>]

`--baseline` adds a previous replay set's measures per label; replay-set then prefers them over the original runs
(scripted replay against scripted replay) and the SCORECARD names the baseline used per run.

## Local dry check of the git plumbing

    PLAYTEST_CLOUD_SKIP=install-playtest,install-server,web-build,overlay,preflight,replay-set \
      bash tools/playtest/cloud/run-replay.sh <branch> <out-name> 1

from a throwaway clone whose `origin` is a scratch bare repo.

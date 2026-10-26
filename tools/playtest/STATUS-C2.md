# STATUS-C2 — cloud portability and the one-shot replay runner (2026-10-25)

Branch `lane/playtest-20261024`, not pushed (the coordinator pushes).

## Commits
1. `a5b61d0c7` portable platform helpers: `lib/platform.mjs` (+ tests). Playwright: global `playwright` → `<server-root>/mars/viewer`
   → laptop viewer; `PLAYWRIGHT_BROWSERS_PATH` only when the macOS cache or /opt/pw-browsers exists; Linux launch =
   SwiftShader headless `--no-sandbox --disable-dev-shm-usage` (verified: WebGL2 on SwiftShader); memory via vm_stat /
   MemAvailable; thumbnails sips / ImageMagick / ffmpeg (summary.mjs, story-html.mjs); quota skipped with a note when
   usage.py is absent; preflight's playwright check reports which candidate it used; `provision.marsWebDir()` adds
   `<server-root>/../mars-web`.
2. `4e6b8dd13` `arena/assets-overlay.mjs <dir>`: overlay from production URLs, resumable (.part + rename), sha256 checked
   against the published manifests, `overlay-manifest.json`, `--only`, `--probe`. URL roots: `/mars-assets/{static,campus}-manifest.json`,
   `/mars-assets/draco/*`, `/browser/campus.glb`, `/modular/humanoid/kit.json` + 206 parts/rigs, 14 `/modular/environment/*.glb`
   (plus any the server root's source names).
3. `e79f1b4bb` frozen bundle: `playtest.mjs freeze-bundle` → `tools/playtest/frozen/frozen.json` (49 KB: frozen scenarios +
   baseline measures; `--baseline <replay set>` adds replay baselines). `replay-set --frozen`, auto when run folders are
   missing; `--force-machine` now also passes the replay set's own gate. Needed: the cloud has no `<team>/playtest/runs`.
4. `bcfe7cada` + `d952b1c39` `cloud/run-replay.sh`, `cloud/compress-shots.mjs` (+ tests), `cloud/README.md`, DESIGN §9c.

## Checks
- All 102 harness tests pass. Laptop preflight: everything ok except the machine gate (load 11–29 from other lanes);
  `--force-machine` exits 0.
- `assets-overlay --only manifests` into scratch, then `--probe`: 227 URLs, all 200/206 non-HTML, 0 missing (matches the
  laptop overlay's 227 files). A full manifests+kit fetch: 209 files, 19 MB.
- replay-set `--dry-run` with the bundle and a nonexistent runs root: plan identical; `--score-only` scorecards identical.
- Runner dry check (PLAYTEST_CLOUD_SKIP for install/build/overlay/preflight/replay) against a scratch bare remote:
  worktree, compression, `.png`→`.jpg` refs, CLOUD.md, orphan `playtest-results`, push; rerun resumed and pushed again.
- `bash -n` clean; shellcheck (npx) clean at warning level.

## Open
- Not run in a real cloud box yet. Untested there: Linux chromium fonts/deps, root + nested `claude -p` seats, node < 22.18.
- Refresh `frozen.json` with `--baseline <team>/playtest/replays/baseline-31fa07296` once that set finishes.
- Results are about 30 MB a run after compression; GitHub's per-file limit is handled (files > 95 MB are left out and listed).

# Remote suite: the full validation off the laptop

`tools/test-harness/remote-suite.sh <outDir> [--ref HEAD] [--baseline-ref main|none] [--skip V7,V8] [--node 22]`

- **What it ships.** It sends `git archive <ref>` and, for V4's failure-set comparison, `git archive <baseline-ref>` to a
  Modal container (`modal_suite.py`: `node:<node>-bookworm`, pnpm 10.27.0, 8 CPU, 16 GB, 4 h cap).
  - Only committed files go, so commit first.
  - Nothing secret is in the tree. Nothing from `.lane/`, `~/.modal.toml` or the laptop's data goes.
  - Frozen camp/station fixtures also receive their exact historical producer files as a Git object pack.
    It includes the original commit and directory tree objects plus only fixture-declared source blobs;
    it excludes ancestor history and all other historical file contents. Its receipt is returned in `/out`.
- **What runs.** The container does a fresh `pnpm install --frozen-lockfile` and then the unchanged
  `one-validation.sh --skip V7,V8`: V1 types, V2 builds, V3 package/engine/CLI/launcher suites, V4 web tests (HEAD vs
  baseline), V5 the full server suite, and V6 the god/Soul/join/launcher e2es.
  - The container has its own network namespace, so the 54xx test ports can't collide with anything.
- **What's skipped.** V7 (real-Chrome walks) needs a GPU and the `.lane/mars-web` asset overlay. V8 boots the laptop's
  production histories, which must not leave the laptop. Run both locally when needed: `one-validation.sh <out> --skip V1,V2,V3,V4,V5,V6`.
- **Results.** Logs land in `<outDir>/out/suite/` (`SUMMARY.tsv`, one log per step), with install logs in `<outDir>/out/`
  and the Modal client log in `<outDir>/modal.log`. Read the logs as `one-validation.sh` describes (team/lanes/rec.md,
  docs/god/MERGE-GUIDE.md §8).
  V3 retains raw Node TAP/spec output and an explicit exit code for every package. Any package failure fails V3.
- **Node.** The default is 22 (eden2 production runs v22.23). Use `--node 26` to match the laptop.
- **Cost.** CPU only, about 1–2 h × 8 cores per run, roughly $1.
- **Setup.** Needs `modal` installed and authenticated: `pip install modal && modal token new`. On this laptop it is
  installed (1.5.2) and `modal profile current` answers `edenartlab`.
- **Smoke test** (install + preflight only, a few minutes):
  `tools/test-harness/remote-suite.sh /tmp/rs-smoke --baseline-ref none --skip V1,V2,V3,V4,V5,V6,V7,V8`

For bounded server failure reproduction, pass `--server-files "src/foo.test.ts src/god/bar.test.ts"`
and `--skip V1,V2,V3,V4,V6,V7,V8`. This runs only those files, serially, on both candidate and baseline.
For package proof alone, skip the other exact V3 IDs: `--skip V1,V2,V3-mars-engine,V3-client-cli,V3-launcher-unit,V4,V5,V6,V7,V8`.

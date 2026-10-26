# Remote suite: the full validation off the laptop

## Release-owner CPU gate

```sh
bash /absolute/checkout/tools/test-harness/release-gate.sh <candidate-ref> --out /absolute/scratch/gate/<run>
```

`--baseline <ref>` (default `main`) compares with another baseline, e.g. the live release of a release line
(`--baseline 19d17c90` for 3.0.1); the receipt records it.

**Baseline cache (MODAL-POLICY rule 1: no baseline re-runs).** The baseline is not re-run on Modal when the gate cache
holds a validated run of it: `team/scratch/gates/cache/<baselineSha>-<harnessTree>-node<major>/` (the first ancestor of
the checkout with `team/lanes`; `SIM_GATE_CACHE` or `--cache <dir>` override, `--no-cache` disables reads and writes).
The key is the `tools/test-harness` **tree** sha, not the harness commit: `git archive` bytes embed the commit id, so
identical harness content run from a later main commit has another archive hash but runs the identical suite. An entry
is a copy of the run's `out/` plus `CACHE.json` with every file's sha256; a hit requires the unchanged file hashes and
`readRun` validation of source sha, harness tree, Node major, completeness and every step. If the candidate's actual
Node/pnpm differ from the cached run's (the `node:22` image moves its patch), the baseline is run again instead of
compared. A miss runs the baseline once beside the candidate and caches it when it validates; every passing full
gate caches its candidate, which serves as the next gate's baseline once it is main. The receipt records
`baseline.source` (`cached` | `run` | `imported`), the cache key/miss reason and what was stored.
`--dry-run` prints the plan (refs, cache hit or miss, Modal runs) without contacting Modal or writing anything.
**Scoped candidate gates (MODAL-POLICY rule 4).** `--scope auto` picks steps from
`git diff --name-only <baseline> <candidate>`: `apps/server/` → V1, V3-packages, V3-walk, V5, V6; `apps/web/` → V1, V2,
V3-bundle, V4; `packages/` → V1, V3-packages, V3-mars-engine, V3-walk, V5 (V3-walk runs the server's walk audit on
genesis); `tools/world-launcher/` → V3-launcher-unit, V6; `tools/edge-skill/`, `tools/client-eval/` → V3-client-cli;
`tools/god-skill/` → V6; other `tools/`, `docs/` and root `*.md` → nothing. Any other path (root files, the lockfile,
`mars/`, `worlds/`, `vendor/`, `infra/`, `e2e/`, `.github/`) takes the full contract. Nothing to run means no Modal
call: exit 0 with `status: not-gated`, `scope.resolved: none`. A scoped candidate runs only its steps (`--only` to
remote-suite.sh; modal_suite.py launches only the groups/V5 shards holding them; RUN-METADATA records `only`) against
the full cached baseline. The receipt records `scope` (mode, resolved, steps, diff range, files per area, unmapped).
A scoped run never enters the cache, never serves as a baseline, and `ship-receipt.mjs` blocks any gate whose scope is
not `full`: the release owner gates the final release head with the default `--scope full`.
Seed or repair the cache from a completed run of a passing gate (validated with the exact identity of a
`--baseline-results` import, plus the gate receipt beside it naming that run):
`release-gate.sh cache-add <gate-out>/candidate`.

Run from a committed harness checkout. The gate pins `main`, the candidate and the invocation's harness before
starting **two isolated Modal runs concurrently**. Both source archives receive the identical committed harness.
It prints one `RELEASE_GATE` line and writes `receipt.json` with exact source/harness/archive/quarantine hashes,
actual Node/pnpm versions, raw-log hashes and fixed/quarantined/new failure identities. Exit 1 means blocked.
Exit 0 is either `PASS` or explicitly `QUARANTINED`; inspect the status and owners before attaching it to a ship.
This command never merges, pushes or deploys.

The contract covers V1 workspace types, both V2 web builds, V3 the eleven tested package trees (including
protocol and engine-native), native Mars engine, client CLI, all seven launcher test files and harness self-tests,
V4 all tracked web unit tests including TSX, V5 recursive server tests, and V6 fake-mind API scenarios.
Other standalone tools/browser/scientific experiments are outside this frozen CPU contract.
V7 real-Chrome GPU checks (including optional V6 screenshots/S8 browser flag-drop) and V8 local production-history
checks remain separate release proofs. The launcher e2e left the CPU gate (Z3); rewritten against the one-view God modal (GT, B8), it runs in V7 as `god-modal`.
V7 also runs `approve-on-top` (lane HF hotfix, tools/god-skill/e2e/approve-on-top.mjs): in Clerk mode the god opens an agent's
approval link (#approve/<id>) at desktop dpr 1/2 and phone, and the approval must stay on top through the whole load.
V7 also runs `approve-in-window` (lane PUX, tools/god-skill/e2e/approve-in-window.mjs): the agent's request made with the
window code (`create-soul --for CODE`) comes up top right in the open window with no navigation; Approve, Timed out ->
Ask again, Refuse on a phone, and one sounding tab across two tabs.

Every retained test failure, skip and TODO has one exact entry, reason and owner in **quarantine.json**.
The gate rejects new failures even if pre-added to that list; missing steps/logs, cancellations, timeouts,
changed skips/TODOs and removed baseline assertions also block. Raw TAP leaf IDs prevent another failure in an
already-failing file from hiding. Passing web assertions retain separate per-file attribution; removing a file's
tests cannot count as repairing a loader. V6 case receipts retain scenario IDs so dropped scenarios block too.

### V7 and the ship receipt

The CPU receipt above excludes V7; the real-Chrome walk proves it, and `ship-receipt.mjs` joins the two:

```sh
# from a clean checkout of the SAME candidate commit (with the .lane/mars-web overlay), ports 5870-5879, ~10 min + lease
bash tools/test-harness/v7-walks.sh /absolute/scratch/gate/<run>-v7          # prints RELEASE_GATE_V7, writes v7-receipt.json
node tools/test-harness/ship-receipt.mjs <run>/receipt.json <run>-v7/v7-receipt.json   # prints RELEASE_SHIP, writes <run>/ship-receipt.json
```

Set `SIM_PREBUILT_WEB_ROOT` to the two exact-source Modal release web artifacts to skip the V7 local builds.
The same source, flag and file-hash verifier used by `deploy/release.sh` installs the root build into
`apps/web/dist` and the prefixed build into the fresh run directory. Both destinations must be absent;
retain any previous output before starting. Browser scenarios and verdicts are unchanged.

`ship-receipt.json` is what a ship attaches. It is `pass`/`quarantined` (the gate's status) only when the V7 source
SHA equals the gate's candidate SHA, the V7 checkout was clean, every V7 check passed and the gate was not blocked;
otherwise `blocked` (exit 1). It records both input receipts' sha256 and the remaining exclusion (V8).

For audited recovery, `--baseline-results <dir> --candidate-results <dir>` imports a completed pair only when the
resolved source SHAs, identical harness commit/tree/archive, Node major/patch, pnpm, complete step contract and
scope all validate. `--baseline-results <dir>` alone imports the baseline (same harness tree, Node major/patch,
pnpm, contract) and runs only the candidate. Output directories with an existing receipt are never overwritten. Older unpinned runs and
bounded `--server-files`/`--skip` proofs cannot qualify a release.

GitHub CI read-only check on 2026-10-15: run38331634849 for main1080cfa9 did not start jobs because account payments
failed or the Actions spending limit was reached. Gene must fix payment/Actions spending limits in GitHub
Billing & plans to unblock hosted CI; Modal remains independent. No billing setting was changed.

## Raw Modal runner

`tools/test-harness/remote-suite.sh <outDir> [--ref HEAD] [--baseline-ref main|none] [--harness-ref HEAD] [--skip V7,V8] [--node 22]`

- **What it ships.** It sends `git archive <ref>` and, for V4's failure-set comparison, `git archive <baseline-ref>` to a
  Modal container (`modal_suite.py`: `node:<node>-bookworm`, pnpm 10.27.0, 4 h cap; group a 8 CPU / 16 GB, the rest
  4 CPU / 8 GB).
  - Only committed files go, so commit first. `--harness-ref` selects the committed harness overlaid on both trees.
    Returned RUN-METADATA.json records both identities; V0's synthetic container Git commit is not a source SHA.
  - Nothing secret is in the tree. Nothing from `.lane/`, `~/.modal.toml` or the laptop's data goes.
  - Frozen camp/station fixtures also receive their exact historical producer files as a Git object pack.
    It includes the original commit and directory tree objects plus only fixture-declared source blobs;
    it excludes ancestor history and all other historical file contents. Its receipt is returned in `/out`.
- **What runs.** Each container runs `pnpm install --frozen-lockfile` and then
  `one-validation.sh --skip V7,V8`: V1 types, V2 builds, V3 package/engine/CLI/launcher/harness suites, V4 web tests,
  V5 recursive server tests and V6 god/Soul/join API e2es. `--baseline-ref none` suppresses the duplicate V4 baseline.
  Each V5 shard has a 150-minute envelope; exceeding it always blocks the gate.
- **Dependency layer (2026-10-26).** remote-suite.sh stages the source ref's `pnpm-lock.yaml` and `pnpm-workspace.yaml`
  in `<stage>/deps`; `modal_suite.py` copies them into the image and runs `pnpm fetch --store-dir /pnpm-store` there,
  a layer Modal caches by those files' content. A tree whose lockfile sha256 equals the layer's links offline from it
  (`install-<tree>.log` starts `cached layer <sha256>`; an offline failure falls back to an online install and says so);
  any other lockfile installs online (`no cached layer for lockfile <sha256> …`). A changed lockfile builds the layer
  once (~1 min).
- **Fan-out (t4-o1 2026-10-19; right-sized by lane gate-cost 2026-10-26, MODAL-POLICY rule 3).** One run is 4
  containers at once: group `a` (V1, V2, V3-harness/bundle/packages, V4, the short V6 joins; 8 CPU / 16 GB because it
  builds the web twice), group `s` (the former b, c, d, e, f, w: V3-walk, V3-mars-engine, V3-client-cli,
  V3-launcher-unit and the long V6 scenarios, run serially) and two V5 shards, all at 4 CPU / 8 GB (`GROUPS`/`LARGE`
  in `modal_suite.py`, selected by `SUITE_ONLY`). V5 runs `--test-concurrency=1`, so more cores were idle. V5 shards
  (`V5_SHARD=i/2`: contiguous slices of the sorted server test files,
  balanced by `v5-durations.json`; each shard also records per-file times in `V5-server-full-files.jsonl`, the source
  for rebalancing). The cheap V2 builds also run unrecorded first in every group, so later steps see the same tree.
  `merge()` rebuilds the serial layout: one SUMMARY.tsv in serial order, the shard TAP logs concatenated in order (the
  serial test order and duplicate-title ordinals), one RUN-METADATA.json that is complete only if every group was.
  Per-group SUMMARY/metadata/V0/install logs stay in `out/groups/<name>/`. A missing group or shard, a duplicated
  row or an inexact shard file cover fails closed. The gate's verdict logic is unchanged. Expected wall time ~45–50 min
  (group s ~31–40 min serial, each V5 shard ~2280 s of tests, group a ~10 min); it was ~22 min with 15 containers.
  `run_large` (group a) has `max_containers = 1` and `run` has `max_containers = 3`: each `modal run` is its own
  ephemeral app, so this caps one run; the ledger `team/lanes/GATES.inflight` bounds gates across tranches.
  Rebalance after big test changes: `node tools/test-harness/v5-shard.mjs` reads `v5-durations.json`; regenerate it
  from a run's `out/groups/v5-*/V5-server-full-files.jsonl` (sum of top-level `ms` per file).
  - The container has its own network namespace, so the 54xx test ports can't collide with anything.
- **What's skipped.** V7 (real-Chrome walks) needs a GPU and the `.lane/mars-web` asset overlay. V8 boots the laptop's
  production histories, which must not leave the laptop. Run both locally when needed: `one-validation.sh <out> --skip V1,V2,V3,V4,V5,V6`.
- **Results.** Logs land in `<outDir>/out/suite/` (`SUMMARY.tsv`, one log per step), with install logs in `<outDir>/out/`
  and the Modal client log in `<outDir>/modal.log`. Read the logs as `one-validation.sh` describes (team/lanes/rec.md,
  docs/god/MERGE-GUIDE.md §8).
  V3 retains raw Node TAP/spec output and an explicit exit code for every package. Any package failure fails V3.
  The raw runner returns suite artifacts even for failing assertions; use release-gate.sh to evaluate a ship.
- **Node.** The default is 22 (eden2 production runs v22.23). Use `--node 26` to match the laptop.
- **Cost.** CPU only. Before 2026-10-26 a run held 15 containers × 8 cores / 16 GB for ~7,500 container-seconds of
  steps (~2.1 container-h, ~17 core-h) and every gate made two runs. Now one run is ~1.6 container-h and ~9.5 core-h
  (a: ~0.17 h × 8 cores; s and 2 V5 shards: ~1.45 h × 4 cores), and a gate with a cached baseline makes one run.
- **Setup.** Needs `modal` installed and authenticated: `pip install modal && modal token new`. On this laptop it is
  installed (1.5.2) and `modal profile current` answers `edenartlab`.
- **Smoke test** (install + preflight only, a few minutes):
  `tools/test-harness/remote-suite.sh /tmp/rs-smoke --baseline-ref none --skip V1,V2,V3,V4,V5,V6,V7,V8`

For bounded server failure reproduction, pass `--server-files "src/foo.test.ts src/god/bar.test.ts"`
and `--skip V1,V2,V3,V4,V6,V7,V8`. This runs only those files, serially, on both candidate and baseline.
For package proof alone, skip the other exact V3 IDs: `--skip V1,V2,V3-mars-engine,V3-client-cli,V3-launcher-unit,V4,V5,V6,V7,V8`.

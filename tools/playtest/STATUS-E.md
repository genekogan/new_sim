# STATUS-E — morning booklet (worker E, 2026-10-25)

## Run

```
node tools/playtest/review/booklet.mjs                       # all runs in <team>/playtest/runs → runs/booklet/
node tools/playtest/review/booklet.mjs --runs-root DIR --out OUT --only trio,basics   # --only matches the run folder name or a substring of it
node --test tools/playtest/review/test/booklet.test.mjs
PLAYWRIGHT_BROWSERS_PATH=$HOME/Library/Caches/ms-playwright node tools/playtest/review/fixtures/booklet-shots/shoot.mjs \
  <team>/playtest/runs/booklet tools/playtest/review/fixtures/booklet-shots index.html <run>.html '<run>.html#play'
```

API: `buildBooklet({ runsRoot, outDir?, runs?, only? }) → { index, pages, outDir }`. It is read-only over run folders, takes
about 1 s for 10 runs, and copies no images. Every `src` and `href` is relative to outDir (`../<run>/...`), so `runs/` can be
zipped or published as-is. The browser check found 580 refs and none broken.

## Covered

- `index.html`: the runs table, newest first. Each row gives the scenario, the world and genesis, and the seats (adapter, model/effort,
  persona). It also has the played duration against the planned one, the basics scorecard, nonzero H/P/M/W chips, the story rating
  and issue/FR counts. Above the table:
  - The **Egregious failures** strip lists every W, every `inside-solid`, `no-progress` or `stuck-receipt` fail, and every request
    with no ack and no body change inside the cutoff. Each is one line with a thumbnail, and the Reviewer's reason shows on hover.
  - The **Harness caveats** box shows each run's `checks.laptopLoad` and the world's `healthz.tickMs`.
  - On phones the table stacks into cards.
- `<run>.html`:
  - **Setup.** Scenario, world, build and tick, pre-flight, then per seat: persona, sheet axis, onboarding time, the onboarding
    prompt, the final onboarding message and the sheet. God seats also get their chat.
  - **Play.** A timeline merging every persona glance (shot, thought, what it said and where, rating, complaints and wishes, the
    shown text in a `<details>`) with each request's outcome at cutoff. The outcome shows ack and result text, body summary, oracle
    chips (fails first), the Reviewer chip and reason, and up to 3 shots. God turns are included.
  - **Review.** Ledger, issues, grouped FRs, emergence row, the stranger's story and final ratings.
  - **Drafts.** Specs rendered through a minimal md→html.
  - **Harness notes.** The REPORT.md §8 section, receipts and failures (camera failures flagged).
  - **Raw links.**
- Runs still in progress or written before the basics scorecard get their basics from `computeMetrics` and are labelled as such.

## Known gaps

- Timeline times are measured from the persona-observed play start (first glance minus `elapsedSec`), not `loadRun().anchorMs`.
  In real runs that anchor (the `2-seats` receipt) lands 2–25 min before the first glance, which also shifts journal.md times.
- The md renderer flattens nested lists and does not handle inline HTML.
- REPORT.md §8 says "92 indexed shot file(s) are missing on disk" for the newcomer run, but the files are there. `harnessNotes`
  joins the run folder onto an absolute index path. That is worker D's code, not changed here.
- Thumbnails are the full PNGs (no resized copies), so a run page with ~40 shots loads about 25 MB lazily (about 0.7 MB per shot).

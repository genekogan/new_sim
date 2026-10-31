# Old / new world comparison

Tools that compare an original world (`mars`, `littlemartians`) with its rebuilt candidate world (from
`worlds/templates/mars-two.json` or `littlemartians-two.json`). The output is a page per world: matched named views at
several hours and DPRs, plus a table of the resident actions observed on each side. A person reviews the page. The
tools give no verdict and never change, migrate or retire a world.

## Run

Requirements: installed dependencies, a built `apps/web/dist`, the Mars web asset overlay in `.lane/mars-web`,
Node ≥ 22.18, real Chrome on a hardware GPU, Python 3 with Pillow, and at least 15 GB of free disk.

```sh
node tools/parity/run.mjs --world mars|littlemartians --out <new-scratch-dir> [--views a,b] [--capture-only]
```

Note: the output root, review-page destination, Chrome lease module and machine-slot wrapper are still fixed
maintainer paths in `run.mjs`, `compare.mjs`, `visual.mjs`, `live-old.mjs` and `check-pages.mjs`. Make them
configurable before running these tools elsewhere.

`run.mjs` boots two disposable fake-mind worlds on ports 5900–5905:

- the original world, from the repository's own fixture
- the candidate, a fresh genesis

It also starts a local control endpoint that sets the original world's hour. Capture and evaluation then run in
`compare.mjs`, and the processes are closed. No production database, roster or history is copied, and no model is
called. Each run needs a new `--out`; existing fixture databases are refused.

- `--views` takes exact names from `comparison-poses.mjs` (unknown names are refused). Both DPRs are always captured.
- `--capture-only` skips the 24-hour lighting sweep, resident actions and content diagnostics. It writes a separate
  preview under `<out>/retake-review/` and never replaces the full comparison page.

Capture uses a 960×640 CSS viewport, 45° FOV, real spectator input, and a check that the requested hour (day 14:00,
dusk 18:00, night 23:00) reached the viewer before each shot. Mars candidate cameras use the documented rigid
campus-frame transform rather than the same raw coordinates. Each view note states its adjustment or gap.

The output directory holds `comparison.json`, `comparison-poses.json`, `resident-comparison.json`, raw screenshots
and labelled pairs in `shots/`. The resident table separates `OBSERVED`, `REFUSED`, `NOT_OFFERED`, `LISTED`, `UNKNOWN`
and `UNMEASURED`. A capability listing is not a demonstrated action.

Other entry points:

| File | Does |
| --- | --- |
| `live-old.mjs` | read-only, signed-out captures of a deployed world page (page loads and camera pinning only) |
| `eden-page.mjs`, `eden-columns-page.mjs` | Eden comparison page; `--add <capture dir> <suffix> "<label>" "<note>"` adds a candidate column |
| `check-pages.mjs` | checks a delivered comparison page with real input |
| `compare-behaviour.mjs` | bounded resident comparison between two attested fresh fake-mind worlds |

## Exact diagnostics

`evaluate.mjs`, `gate.mjs`, `poses.mjs`, `content.mjs`, `behaviour.mjs` and `image-diff.py` are an older
exact-identity workflow, kept as diagnostics. The image diff records RGB mean absolute error and changed-pixel
fraction with a zero threshold. `content.mjs` compares semantic ids, poses, baked rooms and sampled ground, and lists
its options in its header. Unknown inputs stay `UNKNOWN`. These scores are not a judgment of quality.

```sh
node --experimental-strip-types tools/parity/content.mjs --world mars --old-mars-map true --out <file.json>
node --test tools/parity/*.test.mjs
```

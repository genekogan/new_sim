# Old / new world comparisons

The October 15 redirect asks for a comparison set for Gene to judge beauty, versatility
and quality. The human-facing output is a page per world with matched named views and
a short table of observed resident actions and gaps. It makes no retirement or migration
recommendation and never changes an original world.

The review set lives at `<team>/reviews/sim-compare-20261015/`:
`index.html`, `mars.html`, `littlemartians.html`, and an `eden.html` slot awaiting lane L4’s
`eden-2026` candidate. `run.mjs` invokes `compare.mjs` to refresh the selected world page;
`comparison-page.mjs` provides the shared index and Eden placeholder.

## Capture a comparison

Requires installed workspace dependencies, a built `apps/web/dist`, the authorized
read-only `.lane/mars-web` asset overlay, Node >=22.18, the repo’s Playwright package,
installed real Chrome, and Python3 with Pillow. Rebuild only when the viewer source
changed, using the shared heavy slot:

```sh
python3 <team>/ops/with-heavy-slot.py --owner parity --purpose web-build --timeout 1800 -- pnpm --dir <worktrees>/lane-parity --filter @sim/web build
```

Choose a new scratch output directory for every run; an existing fixture database is
refused. These commands capture the full named-view set at DPR 1 and 2, sample hourly
lighting, and then run three bounded scripted-resident examples on each side:

```sh
node <worktrees>/lane-parity/tools/parity/run.mjs --world mars --out <team>/scratch/parity/mars-compare-fresh-01
node <worktrees>/lane-parity/tools/parity/run.mjs --world littlemartians --out <team>/scratch/parity/littlemartians-compare-fresh-01
```

The runner boots disposable fake-mind worlds, uses actual ports 5900–5905, acquires
the `parity` heavy slot for capture/evaluation, and closes its processes. It does not
hold that slot merely to run servers. Legacy virtual port arguments pass through
`tools/test-harness/port-remap.mjs` before a socket opens. The runner checks for at least
15 GB free and never uses the protected live laptop ports or production databases.

**Scope:** old Mars is the repo’s furnished camp plus its pinned 2026 campus backdrop;
old LM is the compact repo garden/tower/temple scene. Candidates are fresh worlds from
`mars-two.json` and `littlemartians-two.json`, carrying the names
`my-mars-college-2026-3` and `little-martians-arium`. This compares local reconstructions,
not the deployed mutable worlds. Original residents, body/floater assignments and
accepted history are not copied. No LLMs or owner-signed-in browser are used. Temporary
local development authority permits clocks and disposable scripted actions only.

Scratch contains `comparison.json`, `comparison-poses.json`, `resident-comparison.json`,
raw screenshots and labelled pairs in `shots/`, plus internal measurements. The normal
run copies images and the resident table into the selected review HTML page. Its table
separates `OBSERVED`, `REFUSED`, `NOT_OFFERED`, `LISTED`, `UNKNOWN` and `UNMEASURED`;
a capability listing is not a demonstrated action.

## Retake selected views

`--views` accepts comma-separated exact names from `comparison-poses.mjs`; unknown names
are refused. Both DPRs are always captured. `--capture-only` skips the 24-hour sweep,
resident actions and content diagnostics, then writes a separate preview under the new
scratch directory’s `retake-review/`. It does not replace the shared review page or merge
retakes with the previous resident evidence.

For the five LM overview/exterior camera retakes:

```sh
node <worktrees>/lane-parity/tools/parity/run.mjs --world littlemartians --out <team>/scratch/parity/littlemartians-retake-fresh-01 --capture-only --views ceramic-world-day,ceramic-world-dusk,ceramic-world-night,ceramic-tower-context,minaret-temple-context
```

Inspect the new pairs before copying chosen images and view definitions into the
combined comparison set. Keep the original resident measurements. Any selected-view run
writes a separate preview under `retake-review/`, including when resident probes are
requested; it never replaces a complete shared page and is not an incremental update.

Mars includes campus day/dusk/night, Chiba, Dojo, two interiors and the old camp context.
Its cameras use the documented rigid campus-frame transform rather than the same raw
coordinates. LM includes garden/Arium day/dusk/night, retained tower/temple exteriors
and interiors, garden/gallery context, Madmaraca and the painted grotto. Retained
sculptures are matched at their new half scale; added Arium landmarks have no old
counterpart. Each view note states the adjustment or gap. The overview includes the
candidate’s populated exhibit rows; it is not a survey of every distant mountain.

Capture uses real Chrome under the `parity` lease with the GPU, a 960×640 CSS viewport,
45° FOV and untouched viewer roof controls. It records spectator drag/key input, waits for revealed
world canvases, clears projection offsets, and records actual camera/DPR/GPU evidence.
A read-only browser-response observer records the `Daylight.update` input and original
bundle hash, allowing the requested hour to be checked before each shot. Day is 14:00,
dusk 18:00 and night 23:00. Camera framing still needs visual inspection after a retake.

## Internal exact diagnostics

`evaluate.mjs`, `gate.mjs`, `poses.mjs`, `content.mjs`, `behaviour.mjs` and `image-diff.py`
retain the superseded exact-identity workflow as an internal aid. They are separate from
the current human comparison. Exact RGB scores and `identical`/`not identical` statuses
are not a beauty judgment or a retirement decision. `run.mjs` now selects the human
comparison workflow, not `evaluate.mjs`.

The image tool records RGB mean absolute error and changed-pixel fraction with a zero
threshold. Content compares exact semantic IDs, poses, baked rooms and sampled physical
ground; navigation links are kept separate from painted paths. Unexported decorative
hills/paths, incomplete inventories and unavailable rendered lighting stay `UNKNOWN`.
Source/snapshot overrides and CLI options are documented in `content.mjs`’s header:

```sh
node --experimental-strip-types <worktrees>/lane-parity/tools/parity/content.mjs --world mars --old-mars-map true --out <team>/scratch/parity/mars-content-internal.json
node --test <worktrees>/lane-parity/tools/parity/*.test.mjs
```

The strict resident helper additionally accepts a sourced complete roster and explicit
last activities on a disposable world. Its input contract is in `behaviour.mjs`; absent
history remains `UNKNOWN`. Its historical gate also requires explicit source/history
coverage, which fixture runs set false. These tools perform no cutover, deploy, route
change or deletion. The current comparison set leaves the judgment with Gene.

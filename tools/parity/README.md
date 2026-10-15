# Exact world parity gate

This tool is an offline cutover precondition. It never routes, merges, migrates or deploys.
`not identical` means keep the old world. A difference **or missing evidence** closes the gate.
It does not convert a more elaborate rebuild into proof that the original survived.

From this worktree, after `pnpm install` and the authorized read-only `.lane/mars-web` overlay:

```sh
python3 <team>/ops/with-heavy-slot.py --owner parity --purpose web-build -- pnpm --dir <worktrees>/lane-parity --filter @sim/web build
node <worktrees>/lane-parity/tools/parity/run.mjs --world mars --out <team>/scratch/parity/mars
node <worktrees>/lane-parity/tools/parity/run.mjs --world littlemartians --out <team>/scratch/parity/littlemartians
node --test <worktrees>/lane-parity/tools/parity/*.test.mjs
```

The runner boots fresh fake-mind worlds from repo data, waits for the shared heavy slot for evaluation,
uses only ports 5900–5904, and closes its processes. Existing scratch data is retained; choose a fresh
output path for a fresh run. It refuses less than 15 GB free. Do not feed it production databases.
Dependencies: Node >=22.18, the repo's Playwright package, installed real Chrome, Python3 with Pillow.
No model calls, credentials, owner's signed-in browser, production endpoint or live laptop port is used.

Outputs: `report.json`, one-page `VERDICT.md`, `content.json`, `behaviour.json`, `visual.json`, `poses.json`,
and labelled side-by-sides plus raw screenshots under `shots/`. Provenance says exactly which fixture
and template were compared. These runs do not claim the live mutable candidate is unchanged from its genesis.

Visual comparison uses real Chrome with the `parity` lease, Metal GPU, fixed 960×640 CSS viewport, DPR1
and2, 45° FOV, identical coordinates for each overview/landmark/two-interior/dusk/night pose. It records
the GPU, actual camera and drawing-buffer size, raw RGB normalized mean absolute error and changed-pixel
fraction. The threshold is zero. No registration, scaling, moved camera or perceptual threshold can erase
a difference. Three's devtools observer pins only the test camera; no engine/viewer source is changed.
Renderer background, fog and active lights are also sampled at every hour. Scenery animations can cause
false negatives; they can never excuse an observed difference. Camera views include real spectator
drag/key input evidence before calibrated stills, without actions on live worlds. A read-only observer
in the served bundle records the actual Daylight.update datetime; its original SHA is retained.

Content compares semantic IDs, building poses/footprints, baked interiors, places, links and painted paths,
sampled physical ground heights, explicit hills and hourly rendered lighting when available. Decorative
old hills/paths that are not exported stay UNKNOWN. `content.mjs` accepts exported source/snapshot inputs;
see its header. Missing categories, incomplete inventories and failed compilation cannot pass.

Behaviour resolves every supplied old place by both ID and exact name with scripted CLI residents, then
replays every supplied resident's last sit/enter/use activity and verifies its effect, not just acceptance.
Use `behaviour.mjs --input input.json --base http://127.0.0.1:5901/w/example --out report.json` for sealed
historical inputs on a disposable world. `freshWorld:true` is required. Supply `historyComplete:true`, a
`historySource`, complete `residentRoster` IDs and one `residents[].lastActivity` per ID. Initial body state
and exact capability expectations must be supplied in each setup. Fresh fixture actions remain separately
labelled; they cannot replace resident history. An absent roster is UNKNOWN, even if all mechanics pass.

`gate.mjs` also requires explicit current source/history coverage. The supplied fixture runner sets it
false. Thus these honest diagnostic runs cannot accidentally authorize a real migration. Release owners
must obtain authorized minimal source/history exports, reconcile every difference and close every unknown
before any separate cutover procedure may consider a world eligible.

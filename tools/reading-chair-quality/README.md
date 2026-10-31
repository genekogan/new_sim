# Reading and computer chair quality

- `activity-poses.ts` lifts seated reading hands before arm IK, so the book stays on the palms and clear of the legs.
- `core/office-desk@2` drops the eight baked scenery-chair shapes of immutable v1 and shrinks the collider/bake depth
  from 1.254676 m to 0.7 m. The functional standalone office chair stays; surface/user slots, power and workstation are
  unchanged, and the desk has no seat slot.
- Only the four Eden library/office desk placements in `worlds/templates/eden-2026.json` use v2. Historical v1
  definitions, authored specs and generic furnished buildings keep v1.

## Checks

```sh
node --test packages/world-compiler/src/core-kit/office-desk.test.ts tools/reading-chair-quality/desk-repair.test.mjs
GLB_DIR=/absolute/modular/environment/ node --test tools/reading-chair-quality/reading-rig.test.mjs
node tools/reading-chair-quality/conformance.mjs /absolute/output/desk-conformance.json
node --test tools/reading-chair-quality/native-computer.test.mjs
```

The rig check loads three resident rigs, deforms real skin and tests each leg triangle against every book page and
cover box, for seats at 0.04, 0.47 and 0.7 m and four reading times. `GLB_DIR` selects the asset directory;
`ACTIVITY_POSES_SOURCE` selects an alternative `activity-poses` source, and `EXPECT_BOOK_INTERSECTION=1` asserts that
source reproduces book contact (to confirm the check catches the old pose). `conformance.mjs` runs a narrow K=2
conformance sweep over the office-desk revisions only. These are renderer geometry checks, not evidence that a Soul
completed an action; `native-computer.test.mjs` checks the native computer activity.

Renderer fixture: set `READING_CHAIR_ASSET_ROOT` to a `mars/viewer/public` tree (default: the checkout's) and
`READING_CHAIR_BASELINE_SOURCE` to a baseline `activity-poses` source, start
`node apps/web/node_modules/vite/bin/vite.js --config tools/reading-chair-quality/vite.config.mjs` (port 7846), then run
`node tools/reading-chair-quality/renderer-proof.mjs /absolute/output/browser`. It writes six captures and a summary
using headless Chrome; stop the Vite server afterwards.

## Replacing desks in a live world

Existing worlds keep their v1 desks until an operator replaces them with ordinary God operations. Computer use is
chair-bound (`use-computer.<chairId>`: sit on the chair, then face the desk), so replacing a desk at the same pose
keeps the chair, its occupant and the activity. The new collider is a strict subset of the old one.

1. Save fresh authenticated evidence: `GET /v1/god/snapshot`, `POST /v1/god/query {entity:ID}` for the four desks and
   four chairs, `GET /v1/god/builds`, `/healthz` before and after, and the world seq after. List any active
   semantic/meaning files that may reference the desks.
2. `node tools/reading-chair-quality/prepare-public.mjs <evidence-input.json> <new output directory>` reads only those
   saved files (no network, credentials or database) and writes the preview batch (undo group
   `reading-chair-20261028`), version expectations for desks, chairs and ancestors, and the observed chair occupancy.
   It refuses if a removed desk is in use, a desk/chair pair does not share parent and room slot, a build is open, or
   a desk has children, or an authored edit happened during the audit window. `planEdenDeskRepair` in `desk-repair.mjs` is the equivalent
   planner over a local model.
3. `POST /v1/god/preview` the batch; require it accepted with no `wouldMove`. Inspect `GET /v1/god/preview/<id>`: exactly
   four desk removals and four desk upserts, no chair, body or repair changes.
4. Re-check health, build, seq and desk versions, then commit with `POST /v1/god/act {preview, expect, clientRef}` using
   one stable `clientRef`. Send this envelope directly: the CLI `commit` omits the extra chair expectations. Keep
   `result.ids`.

If the commit response is lost, query `/v1/god/requests/<clientRef>` before retrying. To roll back, run
`POST /v1/god/undo?group=reading-chair-20261028` (CLI: `undo --group reading-chair-20261028 --json`); compiler inverses
restore the old desk IDs and metadata. A cached explicit old-desk action (for example `object:<desk>:switch-on`)
refuses after replacement instead of retargeting; fresh name resolution finds the new desk.

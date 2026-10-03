# Mars closing delta / successor integration boundary — final release43

Owner mandate: finish only **computer workshop** and **library reading with physical
same-book transfer and retained progress**, then verified publication, bounded
documentation/handoff, and retire. This supersedes indefinite vocabulary expansion.
These closing/retirement instructions govern this Mars closing agent; the successor
retains its separately authorized independent mandate. The exclusions below bound
what this agent will deliver, not what that separate project may later authorize.
No richer connected day, cooperative meal preparation, new framework, active
save/load, rig migration or Eden work belongs to this delta.

## Exact fork base and published checkpoint

Fork the clean reviewed Git commit **`75d022308e944128335b9c0c1ef84e2c1e51e54c`**,
tag **`mars-world-v1-alpha`**. Do not copy the dirty main working directory.
This commit contains verified functional source
`043957e8a061868836eacd811d2651e8589bad7d` plus documentation-only final receipts.
Its exact clean functional gate passed all nine stages; the later documentation
commits are not a separate runtime gate. Fork-base publication was **release42** at
<https://sim.mars.college/>; campus homepage `/`, Engine Lab `/lab`.
Worker `28055d72-9268-4e46-90c5-6066416304fc`, rollback41
`9596510b-336a-4519-8dca-5f862acde364`. Normal Wrangler status rechecked 100%
release42 before publication43; the final receipt below supersedes current status. See [deployment metadata](../../viewer/deploy/deployment.json),
[release record](RELEASE_CHECKLIST.md#production-deploy42--2026-10-03--mars-world-v1-alpha)
and [coverage](SCENARIO_COVERAGE.json) for executed proof and exclusions.

The final release/source/tag and ordered import commits are below. Clean source,
actual execution and verified publication are distinct from merely saved candidates.

## Delivered supported behavior

- **Computer workshop:** three anonymous hypothetical participants, real existing
  display and two supported computer seats. Facilitator demonstration, independent
  12/18-second named learner tasks, learner A review/questions/conversation, departure.
  Individual practice Pause, ordinary direction, explicit Join/Resume, persistent
  Leave, global Pause during gatherings, safe End, retained task/session history.
  Fixed ground arrangement; silent presentation/task progress, no image generation,
  typing simulation, arbitrary cast/layout or active reload restoration.
- **Library reading:** one anonymous reader, original book, two prepared ground
  tables/chairs. Partial reading after seven seconds, ordinary get-up and physical
  same-book transfer, then finish the same 24-second task/bookmark at the second
  seat. Pause/direction/explicit Resume, monotonic End and supported cleanup/Reset.
  No single-chair movement, arbitrary rebind, generated text or active reload.
  Loss of both declared release supports is outside proved automatic recovery;
  ownership must remain truthful until a permitted support is restored.

Existing primitives remain authoritative. Admission refusals and local waiting
must remain explained; unrelated world/clock/UI continue. Serious corruption is
contained, never silently stepped. Original assertions, tolerances, goldens and
performance limits are unchanged.

## Verified candidate footprint / extension APIs

The final functional delta is clean `fa0c9b6ea10151e2b0c5f76977fe6030351ab7c9`
from fork75. All nine established gate stages pass with unchanged determinism pin.
Three fresh public actual-Play cases pass per activity; all17 activity captures and
five entry/camera captures were inspected. Earlier candidate/failed receipts remain
in PROGRESS, coverage and the release checklist; they are not relabelled green.
The published scope uses existing physical mechanisms; no boundary broadening
was required beyond the explicitly recorded validation-only contact test below.

New modules:

- `viewer/engine/activities/computer-workshop.ts`: `computerWorkshop`,
  `computerWorkshopControl`, `readComputerWorkshop`, `COMPUTER_WORKSHOP_ACTIONS`,
  `ComputerWorkshopParams`, `ComputerWorkshopControlParams`.
- `viewer/engine/scenarios/computer-workshop.ts`: `computerWorkshopScene`,
  `computerWorkshopBinding()`, `computerWorkshopWorld()`, `computerWorkshopRuntime()`.
- `viewer/engine/activities/library-reading.ts`: `libraryReading`,
  `libraryReadingControl`, `libraryReadingReadout`, `LIBRARY_READING_ACTIONS`,
  `LibraryReadingParams`, `LibraryReadingIntent`.
- `viewer/engine/scenarios/library-reading.ts`: `LIBRARY_READING_BINDING`,
  `libraryReadingRuntime()`; uses existing `READING_SCENE`.
- `viewer/app/lab/computer-workshop-hud.tsx`: `ComputerWorkshopHud({sim, refresh})`.
- `viewer/app/lab/library-reading-hud.tsx`: `LibraryReadingHud({sim, refresh})`.

New tests:

- `viewer/engine/test/computer-workshop.test.ts`
- `viewer/engine/test/library-reading.test.ts`
- `viewer/engine/test/library-relocation.test.ts`
- `viewer/e2e/computer-workshop.spec.ts`
- `viewer/e2e/library-reading.spec.ts`

Small shared integration points, where successor conflicts are expected:

| File | Required semantic addition |
|---|---|
| `viewer/engine/api/registry.ts` | Register the two action arrays once; advance rules version appropriately. Final combined rules stamp moves activities/29→31, not an activity count; old bound plans must rebind. |
| `viewer/app/lab/living-object-scenarios.ts` | Add `computer-workshop` and `library-reading` presets, factory bindings, supported instructions/contracts. |
| `viewer/app/lab/hook.ts` | Detached `computerWorkshop()` and `libraryReading()` observers; allow only these read-only observers through the existing quarantine fence. |
| `viewer/app/lab/panel.tsx` | Mount HUDs with scenario-epoch keys inside the existing halted-controls fence. |
| `viewer/app/lab/checkpoint-tour.tsx` | Recognize the new presets and show their own instructions; retain existing navigation. |
| `viewer/app/lab/scenario-contracts.ts` | Generated contract metadata, not hand-edited proof. |

Documentation-only footprint: `AGENTS.md`, engineering index and roadmap,
backlog, engine/Lab guides, `SCENARIO_COVERAGE.json`, `PROGRESS.md`, generated
`EVIDENCE.md`/`evidence.json`, release checklist, `viewer/deploy/deployment.json`,
this boundary note and bounded workshop/library proof briefs. Final link cleanup
may touch directly related entry points; it must not rewrite the archive wholesale.
Deployment metadata is a receipt, not a deployment-architecture change.

## Checked unchanged boundary and exclusions

### Necessary validation-only crossing — recorded before implementation

`viewer/e2e/room-preparation.spec.ts` is additionally in the closing delta. The
preparatory38 gate failed its held-bowl Walk contact assertion at tick95 because
`bones.soles` subtracts a rest ankle offset; it is not the rotated shoe surface.
Existing `meshPoints(actor, 1)` proves lowest rendered shoe y=0.0035 m at the same
tick, versus ankle proxy0.0458 m. Across ticks80–115, actual lowest contact ranges
−0.0135 to0.022 m, within the unchanged0.03 m limit. An actual-Play held capture
also has real contact −0.0008 m and no authoritative violations. Root inspected
both captures. Exact receipt: library candidate `.cloudflare/room-contact-diagnosis/`.

The bounded correction measures existing rendered shoe vertices for this ground
contact assertion and adds the supported Walk interval as a regression. It retains
the original3cm clearance/penetration standard and ankle-proxy observations, with
no favorable-pose waiting, tolerance inflation, golden update or rig/movement edit.
Successor should import this validation-only change separately if its rig or pose
measurement APIs differ. The original failed gate remains RED, never rewritten.

The reviewed final delta contains **no changes** to shared runtime, world schema,
movement/navigation, support/ownership/reading/workstation/table-transfer primitives,
renderer/rigs, camera policies, historical content or deployment architecture.
The close required no such crossing. A successor needs its own explicit reviewed
scope before changing those boundaries. Library's standalone factory uses
default registration after the verbs join it; duplicate extras must not be retained.

Exclude all 48 other-owner dirty/untracked main paths from the fork and final
delta; preserve their bytes, mode and mtime. Exclude original unverified workshop
`3316a74` (three preserved untracked draft files), docs-only library `319429c`, old
technical-wave branches and other agents' pending work. Reviewed replacements live
in isolated candidates; these do not authorize importing every old branch.
The saved `alumni-presentation` `ce1c8af` is already an ancestor of the fork base
and is the shipped campus presentation shell, not another actor activity to import.
Local ignored proof logs/captures and browser/dependency/build caches are not source
modules; final handoff will point to exact receipts instead of committing caches.

## Importing into a divergent successor

Import reviewed new core/scenario modules and focused tests first. Their physical
dependencies are existing ordinary classroom, work, reading, single-item transfer,
walking and social actions; no second executor or new world schema is required.
Use the final ordered commits/file list, not a wholesale main merge or copying a
working tree. Do not overwrite successor UI/registry/coverage architecture.

Reconcile shared glue manually: register action arrays once; adapt two preset
factories to successor discovery; provide detached observations and intent-only
controls in its UI; preserve control precedence, pending fixed-tick controls,
quarantine and Reset lifetimes. Regenerate its contracts from its own coverage
inventory, retain historical source-bound evidence separately, and adapt Play tests
to actual successor controls. Node proof alone cannot certify the adapted UI.

Re-run focused deterministic/admission/disruption checks, actual Play and inspected
captures, then the successor's combined gate before publication. Mars deployment
receipts, rules strings and accepted proof IDs are not the successor's receipts.
No breaking core interface or primitive change is currently planned. Any actual
breaking change will be explicitly listed in the final delta.

Deferred proposal dispositions belong in [RAINY_DAY_BACKLOG](RAINY_DAY_BACKLOG.md),
linked from [ACTIVE_ROADMAP](ACTIVE_ROADMAP.md); they are not implementation promises.

## Final publication, reviewed source and ordered import

- **Release43:** <https://sim.mars.college/>; campus homepage `/`, explicit Lab `/lab`.
  New presets: `/lab?scenario=computer-workshop` and `/lab?scenario=library-reading`.
- **Exact tested/built/deployed functional source:**
  `fa0c9b6ea10151e2b0c5f76977fe6030351ab7c9`. Worker
  `f02de121-21e2-43c2-816a-469bd64e51f1`, 100%, deployed2026-10-03T10:23:02.320Z.
- **Final local code/documentation tag:** `mars-world-v1-alpha-r43-final`. Resolve with
  `git rev-parse mars-world-v1-alpha-r43-final^{commit}` for the exact final documentation
  source; later documentation commits do not claim another runtime gate/deployment.
- **Rollback42:** `28055d72-9268-4e46-90c5-6066416304fc`; normal CLI confirmed before
  deploy. Rollback procedure/storage caveat in RELEASE_CHECKLIST; not executed now.
- **Proof:** clean gate `viewer/.cloudflare/gate/2026-10-03T08-49-29-972Z/report.json`;
  release/network/capture receipts under the closing worktree
  `viewer/.cloudflare/closing-release/`. Exact hashes are in deployment metadata/coverage.
  These ignored receipts remain preserved; copy them separately if the successor needs
  local capture provenance. Do not treat Mars publication receipts as Eden acceptance.

Ordered review units, all based on fork75, no wholesale main merge needed:

| Order | Commit/ref | Import |
| --- | --- | --- |
| 1 | `4b89357` | Four new engine activity/scenario modules, three focused Node specs, registry integration. |
| 2 | `1b57a55` | Two new HUDs, two actual-Play specs, five small shared Lab glue files. |
| 3 | `ab1f6be` | Existing room-preparation rendered-shoe validation correction/regression only. |
| 4 | `fa0c9b6` | Coverage/contracts provenance, bounded briefs/backlog and integration-boundary records. |
| 5 | `466e91cbf3119c4894ecb1644dedc6d54ef575aa` | Four documentation entry-point/guide cleanup files; provisional status superseded by final receipts. |
| 6 | `1159fa5c29f58fa24e214d93c719a4864eab611a` | Documentation-only publication/evidence/handoff finalization; no new runtime. |
| 7 | Tag `mars-world-v1-alpha-r43-final` final commit | Documentation-only inherited missing-report link correction; no runtime or disposition change. |

Use `git show --name-status <commit>` to review each exact file list. New core/UI
files can be imported directly if absent; reconcile shared registration/hook/panel/
tour/contracts/coverage manually as described above. A divergent UI does not need
Mars HUDs unchanged: retain intent-only controls, detached readout, pending fixed-tick
semantics, Reset epochs and quarantine. Adapt actual-Play specs to the real controls,
then run focused deterministic/disruption checks, inspect Play captures and run its
combined gate. Do not overwrite a successor rules stamp; register both action arrays
once and advance its own compatible rules version. Regenerate its own contracts.

**Compatibility:** only the registry rules stamp changes from activities/29 to31;
older bound plans must be rebound. No core API/world-schema/persistence migration,
runtime/movement/support/ownership/renderer/rig/camera/history or deployment-architecture
change. Protected48other-owner paths remain byte/mode/mtime-identical and unstaged.
In particular, pending `SIMULATION_VISION.md` belongs to another owner and was not
modified by closing documentation; existing durable vision remains available.

The clean51focused tests and final gate1515enginePASS/328browserPASS do not count
6engineSKIP/11TODO/7browserSKIP as proof. Freshpublic6activity+4entryPASS is not65
freshpublic full journeys. Current construction default gate has actualPlay through
s0021 and programmatic completion; older fullautomatic proof is source-inherited.
Original identity-encoded campusmodel HEAD-size FAIL/null remains, with separate
Brotli/rangePASS. Finite casts/layouts, small current hands/book, silent progress,
no arbitrary rebind/active reload/universal recovery are explicit limits.

## Copyable successor announcement

> Mars closing work is complete and publicly verified as release43. Your agreed fork
> remains clean75d022308e944128335b9c0c1ef84e2c1e51e54c (`mars-world-v1-alpha`).
> Import the small ordered delta4b89357 →1b57a55 →ab1f6be →fa0c9b6, then docs466e91c
> and1159fa5 plus final `mars-world-v1-alpha-r43-final` link correction if useful. Reconcile shared
> registry/Lab/coverage glue with your architecture; do not wholesale merge dirty main.
> Two reusable coordinators add computer workshop and physical same-book reading
> continuation; no core runtime/schema/physical/rig/camera/history changes. Rules29→31
> needs older plans rebound. Exact proof, limits and exclusions are in
> docs/engineering/INTEGRATION_BOUNDARY.md and deploy/deployment.json. Richer connected
> day and cooperative meal remain UNSTARTED/DEFERRED, not promised features. This Mars
> closing agent has retired; your independent authorization remains yours.

Final link audit preserved26 distinct missing legacy report names as explicitly unavailable
provenance (34 link occurrences), rather than fabricating reports or claiming their proof.
Earlier documentation checkpoint tag `mars-world-v1-alpha-r43` remains at1159fa5;
the final tag above adds only this link/receipt correction. No tags were moved.

# Mars MVP acceptance review — final runtime contract, 2026-10-02

**Contract accepted within the supported scope below.** This is a critical runtime
acceptance review, not an extra owner-approval step. Website publication and
production backend verification are complete in the linked [handoff receipts](../MARS_MVP_HANDOFF.md).
Mars feature expansion stops at this verified bounded MVP.

Final functional source `9958ed4a97f2cb5c7189ea7796b6502a0b9910de` passed the exact-source
[final clean gate](<mars-worktrees>/prepared-day-mvp/viewer/.cloudflare/gate/2026-10-02T01-51-54-812Z/report.json): all nine stages green, 290 unit passes, 1053 engine passes / 6 skips /
11 TODOs, 173 browser passes / 7 skips and 36 local MCP tools. Source stayed clean
and unchanged; cleanup error and interruption are null. Original skipped/TODO cases
remain unproved, not accepted coverage. The [validation/evidence receipt](<mars-worktrees>/prepared-day-mvp/viewer/.cloudflare/prepared-day-final9958ed4-validation-receipt.json) records passing unchanged
idle stress/grid ceilings and successful bound engine-evidence reuse.

Release 34 remains the prior verified checkpoint. Fresh release 35 public runtime
proof at Worker `adaf98f2-65d1-43b3-9c5d-761d555f2d5e` has **8/8 passed, 0 skipped,
2.4 minutes**: three prepared-day presets, two current-rig sleep cases, studio
follow-up/busy-computer protection and two anatomical stair cases. Root inspected
all 27 public PNGs plus two prepared-day/legacy instruction-footer captures;
[public browser receipt](<mars-worktrees>/prepared-day-mvp/viewer/.cloudflare/release35-production-browser-receipt.json) retains exact outcomes and limitations. Source `fafdb72` was an earlier
candidate, not the final source. This review read receipts only and ran no checks.

Authority: [closing mandate](mars-mvp-closing-sprint.md),
[roadmap](../ACTIVE_ROADMAP.md), [handoff](../MARS_MVP_HANDOFF.md) and
[release history](../RELEASE_CHECKLIST.md). Original focused failures remain in
[prepared-day](prepared-day-play.REPORT.md) and [sleep](sleep-play.REPORT.md) reports.

## Required experience matrix

Earlier rows are inherited from release 34 and re-executed by the final gate; cited releases identify their public proof. Sleep/day now have fresh release 35 public runtime proof. Counts and layouts are supported examples, not general capacity guarantees.

| Required experience | Supported representative scope | Executed proof and remaining boundary |
| --- | --- | --- |
| Gathering / learning | 4 or 8 initial audience guests; host, two presenters and two extra people give 9 / 13 total. Authored default and physically prepared side layouts; talks, questions, presenter rotation, formed conversations, arrival and departure. | Releases19/21 and subsequent clean gates; `classroom.spec.ts`, [classroom-life.spec.ts](../../../viewer/e2e/classroom-life.spec.ts), `classroom-turns.spec.ts`, `continuing-day.spec.ts`. Late visitor uses an eligible spare seat, not unlimited membership or arbitrary arrangements. |
| Room preparation | Registered empty ground-floor chair/table moves; two free table carriers; usable moved furniture; partial physical placement and safe stop/retry. | Release19 public 22 browser cases, inspected captures; [room-setup.spec.ts](../../../viewer/e2e/room-setup.spec.ts) and `room-setup.test.ts`. Occupied, reserved or loaded furniture refuses. No arbitrary room optimizer or contents migration. |
| Computer work / reading | One real seated workstation with unfinished task identity; one seated table/book arrangement with retained bookmark. | Releases27/29; reading source `09da6a000e445a7547d94dcdbb33031d823095ff`, public 3/3 Play cases 51.6s. [classroom-life.spec.ts](../../../viewer/e2e/classroom-life.spec.ts), `reading.spec.ts`. Quiet work is visible; fine typing or held-book performance is not required proof. |
| Shared walking | Same free-handed pair on authored ground aisles, regroup and explicit interruption/resumption, Mars4 / Mars8 and independent studio. | Release28 source `9b857930507a6bd03100d4d4ab5a9255888bc118`; 3 public Play cases, 7 inspected captures. `purposeful-routine.spec.ts`, [design-studio.spec.ts](../../../viewer/e2e/design-studio.spec.ts). No arbitrary escort, loaded stair pair or crowd guarantee. |
| Chess | Standing two-player physical board, 32 token identities, legal alternatives and captured-token tray; cancellation/rollback and quiescent board persistence. | Release32 source `084f4929fcf7c6d01113d99a4746d88bc47cdf1a`; public 2/2 Play cases 34.2s, 5 inspected captures; `chess.spec.ts`. Castling, physical promotion, seated chess and strong AI remain outside bounded acceptance. |
| Music / listening | Computer music with actual audible notes, mute / Pause; 0–2 independent listeners; two ground table orientations and retained score progress. | Release30 source `479329689780bf30079bdc4bb54f2d35396fc006`; public music + reading 2/2 with 6 inspected captures; [music.spec.ts](../../../viewer/e2e/music.spec.ts). Acoustic instruments and finger performance are deferred. |
| Preparation / sharing / seated break | One cold recipe, two finite ingredients, held spoon, retained partial deposits, two conserved ordinary servings. Existing 4 / 8 food-break and quiet seated-rest journeys retain unfinished notes. | Releases20/22/24 plus release34 preparation public 2/2 across both table orientations, including actual take/serve/eat/put and strict Reset lifetimes; `preparation.spec.ts`, `shared-food-break.spec.ts`, `purposeful-routine.spec.ts`. No heating/chopping, seated dining or nutritional needs claim. |
| Lie / sleep / wake | Existing woman and casual rigs, origin / rotated ground mat; ordinary approach, lie, 18s retained sleep, wake and return; phase interruptions, deterministic replay and Reset. | Local integrated `caed682` lineage; standalone 50 focused checks, actual Play 2/2 in 52.1s, 12 inspected PNGs. [Sleep report](sleep-play.REPORT.md), [sleep.spec.ts](../../../viewer/e2e/sleep.spec.ts), `sleep.test.ts`, `sleep-walk.test.ts`. Final clean gate plus fresh release 35 public proof; no arbitrary beds or active-session reload. |
| Connected day / independent commitments / reuse | Three presets: Mars4, physically prepared Mars8 side layout, independent hypothetical non-Mars studio. Same unfinished notes → gathering → companion walk → cold preparation → two servings → retained sleep → original notes; independent pair discussion and presenter follow-up computer work. | Local core `919afb1` / adapters `e7f6ce2`; 93 focused regression cases, then 4 production-factory and 3 initial browser cases documented in the candidate report. `prepared-day-scenarios.test.ts`, [prepared-day.spec.ts](../../../viewer/e2e/prepared-day.spec.ts), [candidate report](prepared-day-play.REPORT.md). Partial recipe Pause/Resume and studio same-sleep interruption are exercised. Final clean gate, successful bound proof reuse and fresh release 35 public proof across all three presets; final website/backend receipts are verified in the handoff. |

## Accepted disruption matrix

The following real browser representatives satisfy the bounded eight-disruption
contract, with inherited public receipts linked in [release history](../RELEASE_CHECKLIST.md)
and retained execution in the final clean gate. They do not imply every activity
supports every disruption. Fresh public busy-computer protection closes the
previous equipment evidence gap; missing-display refusal remains Node-only.

| Disruption | Executed representative / provenance |
| --- | --- |
| Late arrival | [classroom-life.spec.ts](../../../viewer/e2e/classroom-life.spec.ts): worker joins/leaves/resumes and late visitor actually joins; inherited public classroom-life proof, executed again in the final clean gate. |
| Occupied seat | [quiet-rest.spec.ts](../../../viewer/e2e/quiet-rest.spec.ts): reserved/occupied classroom seating refuses without controlling foreign occupants; release 22 public rest proof, retained in the final gate. |
| Unavailable equipment | [design-studio.spec.ts](../../../viewer/e2e/design-studio.spec.ts): fresh release 35 public studio follow-up holds the computer for ceramic-designer; worker Start/Interrupt/Resume notes controls are disabled and the foreign task completes unchanged. Named unavailable-display admission remains Node-only, not a public display-failure claim. |
| Blocked route | [design-studio.spec.ts](../../../viewer/e2e/design-studio.spec.ts): actual reviewer crossing interrupts shared lunch walking and ordinary walker recovery finishes the same intentions; release 28 public studio crossing, retained in the final gate. No universal blocked-route completion guarantee. |
| Moved furniture | [room-setup.spec.ts](../../../viewer/e2e/room-setup.spec.ts): physical side-layout stop/retry then complete classroom journey in both room sizes; release 19 public room-setup proof, retained in the final gate. Partial placements remain physical, not teleported or undone. |
| Departure | [music.spec.ts](../../../viewer/e2e/music.spec.ts): audible Play with independent listener departure, interruption and Reset; release 30 public music proof, retained in the final gate. Other commitments continue. |
| Player precedence | [quiet-rest.spec.ts](../../../viewer/e2e/quiet-rest.spec.ts): cancellation/temporary directive respect physical release and permanent departure gets up first; release 22 public proof, retained in the final gate. Fresh release 35 sleep Pause/wake retains the same purpose and releases ordinary physical claims. |
| Interruption/resumption | [prepared-day.spec.ts](../../../viewer/e2e/prepared-day.spec.ts) and [sleep.spec.ts](../../../viewer/e2e/sleep.spec.ts): fresh release 35 public Mars4/Mars8/studio partial recipe and same-sleep Pause/Resume, original notes completion, independent follow-ups and strict Reset; both rigs' sleep replay/retention also pass. |

## Closure and deliberate limits

The [handoff](../MARS_MVP_HANDOFF.md) records verified website publication and
production backend receipts alongside the final runtime/public proof. Runtime
family/disruption acceptance is complete within this contract; passing totals
alone did not establish it.

Authored ground layouts, finite portions, current rigs and bounded physical
interruption/cleanup remain the supported scope. Standalone sleep's return actor
is outside the fixed mat camera: exact return is asserted, not visually certified
by that empty-mat capture. Fine fingers/clothing/contact, precise typing, nutrition,
arbitrary terrain/beds/crowds/assembly, broader autonomy and active logical reload
restoration remain deferred/excluded. Existing historical source-era staging
refusals and W51 FIXMEs are not roof/plywood acceptance. Proposed2027 stays hypothetical.

The [closing scope](mars-mvp-closing-sprint.md) supersedes older forecasts and
allocations; no further planning tranche or inventory audit follows. With MVP
acceptance/publication verified, Mars feature expansion stops; preserve handoff and
limitations. Do not start Eden automatically; further feature work requires a new
explicit owner request.

# Reading and computer chair quality

Source-only lane: no live executor, server model, deploy or production state access.

- `activity-poses.ts` lifts seated reading hands before honest arm IK. The book remains on the actual palms.
- `core/office-desk@2` removes the eight baked scenery-chair shapes in immutable v1. The functional standalone office chair stays. The collider/bake depth shrinks from 1.254676 m to 0.7 m. Surface/user slots, power and workstation remain unchanged; there is no desk seat slot.
- Only the four explicit Eden library/office desk placements select v2; historical v1 definitions, authored specs and generic furnished buildings retain v1.

Focused checks (native/renderer work requires root's shared quiet slot):

```sh
node --test packages/world-compiler/src/core-kit/office-desk.test.ts tools/reading-chair-quality/desk-repair.test.mjs
GLB_DIR=/absolute/pinned/modular/environment/ node --test tools/reading-chair-quality/reading-rig.test.mjs
node tools/reading-chair-quality/conformance.mjs /absolute/output/desk-conformance.json
node --test tools/reading-chair-quality/native-computer.test.mjs
```

The rig check loads actual three resident rigs, deforms real skin and tests each leg triangle against every book page/cover box. It covers seats at 0.04, 0.47 and 0.7 m and four reading times. `GLB_DIR` selects an explicit pinned asset directory. `ACTIVITY_POSES_SOURCE` can select a retained exact baseline source file; `EXPECT_BOOK_INTERSECTION=1` verifies the old source reproduces contact. These are renderer geometry checks, not evidence that a Soul executed an action.

## Root-owned live patch preparation

`planEdenDeskRepair(model, expected)` returns ordinary operations only. Root must read and independently retain the exact current snapshot, IDs, old/new def hashes and the following audit immediately before the atomic commit. Public `place` creates a new desk ID/by/born/v; it does **not** preserve desk identity. Functional chair IDs remain exact.

Supported reads for a fresh audit:

1. `GET /v1/world/seq` and `GET /v1/world/snapshot` identify the edit sequence and exact authored entities. Resolve the four `EDEN_DESK_PAIRS` names to explicit desk/seat IDs and retain their full entity metadata. Hash the in-process `god.model.snapshot()` with `repairHash`; public snapshots omit some internal history and are not interchangeable with that fingerprint. Root must use its existing server/fixture-owned model boundary; this module does not open a DB.
2. `POST /v1/god/query` with `{ "entity": "e_<id>" }` for **each of the eight IDs** returns `entity.usedBy`, `children`, `constraints` and occupied slot counts (`apps/server/src/god/query.ts`). `usedBy` must be explicitly present and null, not missing. In process, the same provider is `usesProviders.get(god.model)(id)`; it uses the bridge's current engine claims. The actual commit's `GodMode` body hooks atomically refuse desk removal if a Soul has since occupied/held it. There is no atomic chair-removal hook here because chairs are not removed; root must ensure their corresponding activities stay stopped until the batch completes.
3. `GET /v1/god/builds` and `GET /v1/god/builds/:id` enumerate open construction roots, claims, include/reuse and inventories. Refuse any open build binding either desk or seat. Do not substitute `[]` because no build was visible in the room.
4. Root's existing in-process `edge.ledger.openReceipts(soulId)` for every live mind, and `host.engine.programOf(entityId)`, must contain no accepted/waiting or current plan referring to these desk/seat IDs, `use-computer.<seatId>` or any associated capability. There is no public all-Souls receipt API; if root lacks a supported in-process observation, leave that part unverified and do not apply the patch.
5. Scan the complete retained model entity/state snapshot plus known world meaning manifests for exact IDs and ID-delimited forms (`#`, `/`, `:`). The planner automatically refuses nonsemantic references, children/inventory, constraints, world relationships and unknown entity metadata. Art frame/media relationships are entity/state references and must be checked even if a computer desk is an unexpected art target. Exact `about.in` and `about.parts[].anchor.ref` bindings are the only understood inbound references; those are remapped in the same batch after all new desk IDs resolve. Other references require root review and a separately concrete migration, not an invented empty audit.

`expected.audit.externalReferences` must be the reviewed result of steps 3–5, with evidence paths retained by root. Nonempty or unverified means refusal. Check `audit.seq` against the same model `editSeq`; re-read at commit time. Do not print bearer tokens or credentials in evidence.

The plan supplies the public `expect` map for every old desk, retained seat and semantic target. Send it with the ordinary `/v1/god/act` submission or use the existing sealed preview, and retain its subtree/affected-entity guards. A snapshot hash alone is not an API precondition; the public `expect` map guards entity versions, not global editSeq. Inspect the planned diff before committing. Retain the ordinary compiler inverse/undo group and the resulting `result.ids` mapping from `$desk0`–`$desk3` to actual new IDs. A refused operation leaves the whole batch unapplied. Undo restores prior desk IDs and metadata; ordinary semantic `set` revisions remain monotonic. On a repeat, all four exact v2 hashes yield a no-op after the same seat/audit checks; mixed revisions refuse.

After applying, root must map any separately reviewed meaning-file anchors to the new desk IDs, verify computer capability targets still bind the retained office chairs, then execute real native seated reading and computer use with inspected visual evidence. Template/reference updates and scripted renderer frames alone do not close the live screenshot report. Root owns gate/fresh-genesis/walk compatibility and deployment after its authorized time boundary.

Renderer fixture (one root-granted loopback slot): set `READING_CHAIR_ASSET_ROOT` to the pinned `mars/viewer/public` tree and `READING_CHAIR_BASELINE_SOURCE` to the retained exact a6fe6 activity source, then run `node apps/web/node_modules/vite/bin/vite.js --config tools/reading-chair-quality/vite.config.mjs`. Run `node tools/reading-chair-quality/renderer-proof.mjs /absolute/output/browser` once, retain all six captures and summary, inspect them, and stop only the owned Vite PID. Its Chrome/context close in `finally`. Scripted renderer frames are geometry evidence, not native activity completion.

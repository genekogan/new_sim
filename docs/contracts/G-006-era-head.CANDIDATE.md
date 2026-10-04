# G006 candidate: exact public era/source/head and capability selection

This additive candidate implements the first exact pieces of the reviewed
G006 revision 2. No existing V1 schema, log EventKind, station producer, Hub
hello, REST endpoint, default factory, audio or renderer is activated or relaxed.

`packages/protocol/src/station-era-v1.ts` exports these strict schemas/functions:

| Export | Exact responsibility |
|---|---|
| `stationHelloCapabilitiesV1Schema` | Optional unique one/two-value `stationContracts` extension; only `station-live/1` and `station-live/2`. |
| `negotiateStationContractV1` | Absent offer means V1; explicit server support; fixed preference V2 then V1; null if no overlap. |
| `stationCommonsSourceV1Schema` | Selected `worldId`, actual `seq`, actual `tick`, strict `commonsTransition`; no author/private fields. |
| `stationRulesEraV1Schema` | Original world/epoch, consecutive revisions, old/new physical rules, unchanged dt, effective tick and source seq/tick/hash. |
| `stationRulesEraFactV1Schema` | Author-free era fact, adjacent seq after physical source, same actual effective tick. |
| `stationPhysicalHeadV1Schema` | Original world/epoch/genesis/rules/dt/created tick plus current physical version/revision/effective tick, exact era/source pair. |
| `initialStationPhysicalHeadV1` | Explicit era 0, original birth rules, null transition source. |
| `acceptStationPhysicalHeadV1` | Exact original epoch and selected physical rules/dt/world binding; current welcome for live, actual selected take/reader rules for history. |
| `foldStationRulesEraV1` | Deterministic predecessor/version/sequence/gap/source validation; detached current head; original station untouched. |
| `stationPhysicalHeadCoversTickV1` | Refuses applying this physical head before its effective tick; exact boundary is inclusive for the new head. |

The source explicitly includes `worldId`. This makes the selected-world public
projection independently scope-checkable instead of assuming that seq/tick alone
identifies a world's event. It refines the proposal's abbreviated source shape.
The source hash is not a signature or proof of an unseen full chain. The live
publisher must validate its full durable sequence before exposing an authoritative
head. This fold retains only the current head; immutable era history belongs to
the journal and bounded source-cutoff queries, not an unbounded in-memory array.

A head alone does not supply a historical interval's upper endpoint. Historical
queries and World must select the era at the requested tick from actual bounded
facts/captures; they cannot use the present head to repair missing earlier data.
The tick helper is a lower-bound guard. Current source owns tick 37; an earlier
body tick cannot borrow the new physical source. The World chunk selector must
choose the latest start when old endpoint and new start share this tick.

The six new pure cases use the exact unchanged committed `8d8b9ec5` public
commons transition payload (SHA256 `976943f31a14c8213bfdd83a7f1ece5e7dc306cc27c9319b5efc8c8d98079663`).
Their row sequence and station genesis are **expressly synthetic codec fixtures**.
They prove strict binding/negative/refusal/detachment and version selection;
they do not prove a canonical station/physical SQLite transaction. Expanded
current run **9/9** includes the three existing V1 phase/anchor cases after the
protocol export changed. No native controller or station producer suite rerun.

Next producer slice must atomically record physical event + rules header + era
fact, preserve original V1 cue/anchor bytes, provide an actual new V2 clock
anchor and resolve current/historical era sources. Then exact native inside-cue
and silence fixtures, real crash/restart/genesis/old-V1 silence, App negotiated
late-listener continuity and World's original/new scene/body-tick proof qualify
installation. V2 cue/anchor/live/history schemas, mounting and those proofs are
still missing. Existing station worlds continue to refuse commons adoption.

No provider, paid spend, live DB, protected service, main, push or deployment.
Candidate code is confined to Core's existing worktree and owned protocol/docs.

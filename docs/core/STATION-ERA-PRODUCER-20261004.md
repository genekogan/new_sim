# Same-world physical checkpoint with station continuity

The isolated G006 producer now commits a native commons checkpoint, its world
rules header and the adjacent `station-rules-era-v1` fact in one SQLite
sequencer transaction. Use trusted internal
`host.adoptCommons(author,{stationEraV1:true})`; the existing call without that
explicit option still refuses worlds with station history. No REST/MCP action,
main bootstrap, automatic timer or default has been enabled.

The writer rechecks actual native transition preview, current original station,
physical head, sequence, source hash, tick, rules and unchanged dt before any
append. Both facts apply before either listener notification. A postcommit live
fold failure reconstructs their exact durable history rather than removing
them as an unrelated card fault. A failed reconstruction stops the host.

The original epoch, V1 cue/anchor bytes, owner, private direction and body remain
unchanged. `CandidateStationV1.view()` retains those facts with `fresh:false`
after the checkpoint, and its phase helper returns null; its producer refuses
further V1 facts. This proves the server projection and helper, **not yet an
installed App graph stopping on a streamed checkpoint**. Hub negotiation and
publication remain the next opt-in slice; current Hub/default behavior is not
V2-ready and must not activate this physical option.

`CandidateStationV2` records guarded actual public native observations and clock
anchors. The already active old cue keeps its ID, seed, interval and beat origin.
A new V2 anchor separately names current physical rules/era and cue-origin
rules/era. A missing fresh current-era anchor starts nothing. After expiry the
next cue uses the actual new-era gathering observation, existing two-piece
policy and a new epoch-derived seed, without consuming physical/model RNG.
New named public facts are strict and redact their author to `world:station`.

History chooses the actual requested era and exclusive next boundary from the
validated journal. It uses the exact recorded `{seq,tick}` frontier, with an
optional exact `sourceCutoffSeq`. It filters cue and anchor rows as well as
physical sources, so a later anchor at the same tick cannot leak backwards.
Both positive physical heads obey that frontier; predecessor source order
cannot reverse. Original and current physical-reader rules remain separate.
The candidate currently scans journal history; bounded indexed era pages,
retention/performance qualification and network history mounting remain open.

App G169 correctly identified that the initial 9fd codec checked only the
current head's era sequence against the cutoff. This commit checks both heads
and reversed predecessor sequence; six codec cases plus the existing nine pass
15. Same-tick cue/checkpoint equality is intentionally permitted: the native
fixture proves an old-origin cue accepted *before* the checkpoint at that tick,
and refuses a later stale-origin proposal. The authoritative publisher validates
the full journal; two projected hashes do not prove an unseen history chain.

Public paired input: `apps/server/test/fixtures/station-era/native-station-era.v1.json`,
255699 bytes, SHA256
`a5796652cea6ce131215b7509885450d0ddc25dc3eed4c1457349266ca84128b`.
These are two actual isolated SQLite/native journeys with real Date.now anchors:

- Inside-cue checkpoint at 37, physical row 7/era row 8, unchanged original
  body/cue; new capture starts 37. Two independently admitted native programs
  settle Alice and Bob at the commons bench. Actual gathering observation has
  two members; the new zoning-board cue starts 2564 with the new physical rules.
- Silent-gap checkpoint at 2563. At the exact era-row frontier no cue/anchor/phase
  fills the gap. A later row at that same tick selects an actual ordinary
  starfield cue; the subsequent anchor at 2606 retains it.

Both preserve original facts exactly and agree through actual current-head
snapshot and complete genesis boot, including ordinary owner and private words.
Raw native captured scenes carry no network world wrapper; the fixture's
selected world binds them explicitly when testing the public scene decoder.
Only four/five selected paired chunks are published; this is not complete body
depiction coverage through every later music sample or an HTTP/WS recording.
Original physical and V1 station fixtures remain unchanged.

Evidence: six real process-exit boundaries (before first insertion, after
physical insertion, after era insertion, after header, after commit before
native adoption, after native adoption before era fold), two writer refusals,
postcommit fold reconstruction, same-tick ordering, snapshot/genesis and
missing/changed source/era/dt/privacy negatives. Initial native load failed
because Node strip-only mode forbids a TypeScript constructor parameter
property; replaced with an ordinary field. Expanded affected suite 38/39: the
new serialized-scene test omitted its world publication wrapper; test-only
binding corrected. Actual complete receipts and final focused result are in
the team review record; failed runs are retained.

After the durable-header dt guard was added, the complete changed station-era
slice passes 16/16; protocol cases pass 15/15. Protocol/server and standalone
fixture types pass. The first standalone fixture type command could not locate
root `@types/node`; explicitly using the existing server type root fixed the
command without changing dependencies. Expanded 38/39 and corrected focused
1/1 remain separate receipts, not a fabricated final 39/39.

No paid mind calls, sockets, browser, audio, device, World/App consumer,
live/default/staging/rollback/release or full W/G qualification follows.
General unlogged idle-tail replay and persistent shore/boat remain open.

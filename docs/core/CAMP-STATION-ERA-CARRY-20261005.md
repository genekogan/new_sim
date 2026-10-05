# Opt-in camp station era carry

The native ground-eight upgrade previously refused worlds with station history.
That refusal remains the default. A trusted internal caller can now explicitly
request `adoptCampExpansion(author, {stationEraV1:true})` with the reviewed decoder
and reader. No bootstrap, candidate, deployment, external control endpoint or
music selection is activated by this change. C205 contract proposal and App/World
counterpart review remain separate from the Core component proof.

The existing exact `stationCommonsSourceV1` parser is unchanged. A separate strict
`stationCampSourceV1` wraps the actual `camp-ground-expansion/1` checkpoint.
The bounded head/era/page decoder accepts those two declared cases. A rules source
must contain exactly one recognized transition, with no private/unknown metadata
or caller override of world/sequence/tick. Tick, origin, rules, dt, source hash,
stock-addition seal, adjacency and predecessor checks remain exact. A mixed source,
foreign binding, altered checkpoint or missing era is refused. Older consumers
must retain unknown-source refusal until this decoder is adopted; no tolerance
for arbitrary payloads is introduced. Station-live/1 and the old commons source
formats retain their original fields and meaning.

The trusted opt-in producer commits the physical rules event, adjacent station
era fact and world header within one SQLite transaction. Live folding completes
both facts before listeners observe them. A failed era append rolls everything
back; a native failure after commit reconstructs both durable facts and preserves
the owner history without treating the structural pair as an attributable card
fault or filtering it out. Native genesis remains the original camp/proving-ground
history reader; models are not used for replay.

The original station epoch/genesis, old rules origin, cue bytes, cue ID and seed
remain. A current old-origin cue can finish across the physical boundary. Its
physical origin stays revision0, while a new anchor binds current revision1 and
the same beat. Historical queries before the checkpoint use the old rules/head;
queries at and after it use the exact new physical source. A current head cannot
repair or stand in for the earlier interval. A genuine cue gap remains silent;
the next cue derives a current native observation and a new seed under the same
original station epoch.

The actual isolated native/SQLite fixture uses an invited synthetic human owner
and retains a private direction. It proves opt-in/default refusal, adjacent
transaction, existing cue preservation, silence/current cue behavior, native/
kernel/station snapshot and genesis equality from a second WAL connection,
precommit fault rollback and postcommit reconstruction. Actual anonymous Hono
GET live/history/era reads match their strict projections and no-store policy;
foreign scope returns404. A real anonymous TCP WebSocket hello negotiates /2 and
receives a strict current station frame with no private owner words.

Final focused native/codec checks passed twelve cases, strict scoped types passed.
The earlier affected camp/old-commons station suite passed nineteen cases,
including unchanged historical fixtures and real worker-exit transaction cases.
These are producer/codec/persistence/transport checks, not actual audio playback,
two-listener/late-join, App mounted behavior, World drawing or release approval.
The held audio/camera retries are unchanged.

Failures are retained: the first multi-file patch matched a wrong spelling and
was not applied; a protocol test used an unavailable package alias instead of
the exact contained relative engine source. Older test code needed explicit
source-variant narrowing. The new fixture guessed `erasPage` instead of actual
`eraPage`, then supplied a rules field to an API scoped only by world/epoch. The
first Hub fixture omitted its required Brain and honestly lacked a station frame;
the fixture now installs the real Brain. Optional native mock method types needed
an explicit required-method boundary. No atomic/phase/hash/privacy assertion was
removed to obtain passes.

The public evidence packet contains only source/era projections, live/history
heads, bounded era page and actual anonymous frames; private owner data is omitted.
Exact source and proof hashes live in the team audit. Existing immutable C194,
alpha candidate and recorded take addresses are untouched. Full Mars structure,
material recovery, water, composition, memory, cohort and release gates remain.

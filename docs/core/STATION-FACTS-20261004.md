# Isolated station facts and public producer

Implements the accepted `2fc2a2d` checkpoint from PM's joint disposition in
`team/reviews/station-joint-disposition-2fc2a2d.md`. Source/fixtures are ready for
counterpart review. No default bootstrap, environment flag, root dependency,
Score source, audio adapter or World consumer is installed by this change.
`CandidateStationV1` is explicitly constructed only by isolated fixtures.
Without that adapter, both new HTTP reads return anonymous 404/no-store and Hub
publishes no station message.

`packages/protocol/src/station-v1.ts`, exported through `@sim/protocol`, defines
strict epoch/cue/anchor/live/historical codecs and pure tick/anchor phase helpers.
All nested input fields are closed. Pins are exact Score3b806f2, App154dda2,
Tone15.1.22, `starfield-zoning/1` catalog and `two-piece-public-gathering/1`
policy. Cue observations use `settled-native-gather-fixtures/1` only. Neutral
energy0 is validated and unused. Unknown/private fields, altered content hashes,
wrong tempo/pins/sample tick/dt/rules/situation and overlapping transitions fail.

Named canonical events are `station-epoch-v1`, `station-cue-v1` and
`station-anchor-v1`. The public event function handles them explicitly, validates
payloads and uses author `world:station`; it cannot fall through the generic
event path. Host acceptance previews the named fold before append. The producer
uses the existing checked acceptance transaction and current source guards.
Invalid facts consume no sequence; failed anchor writes leave the accepted cue
unready, and retry records one anchor without selecting another cue or seed.
These are immutable canonical facts, with station history in snapshot `extra`.
They apply no actor, card, fixture or contact effects.

The first epoch hashes the selected world and its actual factory genesis
identity. No reset operation exists. Restart, pause, cue change and socket
reconnect preserve it. Each new performance has a content-addressed cue,
monotonic sequence and recorded uint32 seed from an epoch-derived finite seed
stream. Repeating the same piece after expiry still creates a new identity/seed.
This seed stream does not consume native/body/model RNG; exhaustion refuses.

Selection uses the accepted public policy on Core: actual settled native
fixture gathering selects Zoning Board108; ordinary under this narrow observer
selects Starfield60. Existing four-cycle performances are retained until expiry;
no forced alternation. A missing, malformed, unknown-revision or mixed sample
records unsupported availability, never an ordinary fallback. Guards re-read
physical observations at cue/anchor acceptance. No owner, actor, request,
mandate, journal, prompt, model or inferred emotion enters station payloads.

Beat is `(tick-startTick)*dt*BPM/60`, half-open `[0,128)`. The exact fractional
end is distinct from the integer-ceiling expiry. At dt.05, Starfield lasts2560
ticks; Zoning lasts1422.222… ticks and expires at integer1423. A representable
tick immediately before the end cannot round its display into nonexistent
cycle4. New cues start at an actual committed integer tick; intervening gaps are
silent. Explicit cut transitions carry previous ID/exact end/next start and
zero fade lengths. No composition tail or audible cut behavior is qualified.

Anchors record monotonic revision, actual observed source tick, actual
`Date.now()` sample, derived beat, rate, pause and availability. Future source
ticks are refused. Stale/mixed anchors cannot replace an accepted newer anchor.
The pure live helper predicts scheduling only; it never calls that prediction
an observed tick. Pause, rate other than1, unsupported, backward real time,
expiry or unavailable fresh anchor return silence. A reconstructed producer
withholds `fresh` until it commits a new anchor. Pause/resume/rate/recovery facts
invalidate old readiness; Hub's transport epoch is separate from the station.

Anonymous selected-host API, only with the explicit candidate adapter:

- `GET /v1/station` → strict `station-live/1`, current recorded epoch/cue/anchor
  and process-fresh readiness. During a cue transition the old anchor is absent
  until a matching new anchor is committed.
- `GET /v1/station/history?worldId=…&epoch=…&rulesVersion=…&tick=…` → strict
  `station-history/1`, matching finite cue/phase and an appropriate preceding
  recorded anchor. Fractional tick lookup is supported. Wrong selected world,
  epoch/rules, malformed query or no station returns404/no-store.
- Hub sends `{t:'station',view}` on anonymous join and accepted named facts.
  Slow clients retain existing reconnect behavior; selection remains on Core.

Historical lookup never changes live selection, fills a gap, borrows a later
cue/anchor or grants physical activity. It is separate from live wall projection.
App owns gesture/mute/volume/Score composition/seeking/audio resources. World
owns depiction of already permitted activity and occupied effector precedence.

Actual paired proof is
`apps/server/test/fixtures/station/native-station.v1.json`. Its generator records
two fake-human-owned Souls and actual canonical body-language gather/stand
decisions in a native proving-ground host. Both occupy claimed fire slots at
tick176. Starfield0 is retained then; actual gathering selects Zoning at2563.
Both stand, ordinary at2600 retains Zoning; at3303 the public anchor is beat66.6,
cycle2. After the exact end3985.222…, the next ordinary Starfield starts4000.
The gaps2560–2563 and3985.222…–4000 are preserved. Three cues have distinct seeds.
Four selected take pages contain10 actual native chunks and one captured scene;
they are representative windows, not a continuous full4000-tick take bundle.

At4000 SQLite is closed/reopened. Full host snapshot, actual host genesis boot,
independent native/kernel inclusive genesis and the named station fact fold
agree. A recovered station requires a fresh anchor but retains cue/epoch. Actual
TCP/Hono anonymous GET and Hub/WebSocket join, new-anchor stream and terminated
socket rejoin agree on the recorded view. Foreign history reads return404.
Private markers are absent from all socket messages and public output. There
are14 named facts (1epoch/3cue/10anchor), zero paid spend and no native violations
or recorded recoveries. Temporary DB/own sockets/server4953 are closed/removed.

The fixture includes actual clock samples, so fresh generation cannot be
byte-identical across times. Its authored runtime source SHA256 manifest plus
base commit bind this exact recording. Timestamp fields are not replaced to
fake reproducibility. This manually driven native test proves publication and
reconstruction, **not real-time paced listening or synchronized audible output**.
The exact immutable paired fixture is243,688bytes, SHA256
`27b78076a33d961ff8cd48970bb37e359b327ebdca0819ecb9ae6bc57d80b671`.
Scene address is
`1bfa045344c4b71cf5cd7d774adfd8de7d868b66d10021f85ed9b61b79d16993`.

Checks: final9 station codec/fold/native/private/default404/transaction-retry/
same-piece/source-policy parity tests pass. Exact inactive Appce281 selector
hash verified and executed against these new recorded native samples; prior
App's nine-test suite was not rerun. Earlier combined30 passed (8station+22
default replay/isolation/Hub containment), including8 actual serial child WS
exits. Only changed station checks reran afterward. Protocol/server/web types
pass. All heavy checks used the shared slot; local minds/provider spend is0.

Initial codec/fold2/4 failed: a scope spread could overwrite the historical
contract, and a nonnull expired cue with null phase passed the history codec.
Both were corrected with named output fields and strict finite-interval checks.
First TypeScript failed on a guessed host method name; corrected to existing
`enqueueChecked`. Later fixture helper inference failed; typed observations/
views corrected. All failures remain in the team proof summary.

Next acceptance: App reviews exact producer/types/input, then qualifies two
actual staggered Score listeners, current-cycle late join, tempo/cut/tails,
expiry/reconnect/cleanup and scheduling error separately from output latency and
drift. World reviews/qualifies beat for permitted live/recorded activity without
changing actor roots/contacts/hands. No50ms threshold is established. Persistent
radio, automatic polling/continued production, full situation policy, arbitrary
rates, power loss/process-kill durability, multiprocess sequencing, long-run
history retention/snapshot cost, compatible downgrade and cross-version/genesis
migration remain gates. No fullG003, released wire, source adoption or main/
push/deploy/paid/default setting change is claimed.

# Public station and clock hooks on the existing Connection

App G157 can consume G003 through its normal `@sim/client` Connection. No new
endpoint, socket, server station default or audio mounting is installed here.
The existing V1 protocol and station producer are unchanged.

New optional handlers:

| Hook | Meaning |
|---|---|
| `onSession(session \| null)` | Local welcome generation + worldId + server process epoch. Called before `onWelcome`; null on disconnect, replacement or close. |
| `onStation(view \| null, receipt \| null)` | Strict `StationLiveV1`, selected welcome world only, detached copy. Null means discard the prior station. |
| `onPong(pong, receipt)` | Strict reply to a current sent, unconsumed probe; includes actual monotonic send/receive times, RTT, session and automatic flag. |

`ConnectionSession.generation` is local transport identity, distinct from the
server process epoch and the canonical station epoch. A new welcome invalidates
old probes even on the same socket. Late obsolete/closed-socket messages cannot
restore a station. Replacing an open Connection closes its old socket. The
consumer must invalidate its own clock/audio and private UI state on session
loss; this hook does not erase the old replica or implement App account policy.

`receivedAtMs` is sampled immediately inside the WebSocket message callback,
before string/JSON/schema processing. The new optional sixth constructor
argument supplies that same monotonic clock; default is `performance.now()`.
The fifth argument remains the existing display/watchdog wall clock. Clock
regression or a nonfinite monotonic sample invalidates station/probes and closes
the socket for a fresh welcome. RTT is measured in the monotonic domain, so a
wall-clock adjustment cannot turn a probe into a false offset measurement.
These are transport timestamps, not measured acoustic output latency.

Use `connection.probe(at => clock.begin(at))` with App's existing server-clock
object. The builder runs at the exact send timestamp used in the returned
`ClockProbe`. It returns the existing `{t:'ping', n}` wire message. Probe IDs
must be nonnegative safe integers and strictly increase across the lifetime of
that Connection, including reconnects. Retain the clock's sequence counter;
do not rebuild it with ID 1 after each welcome. The existing App clock's
`connect`/`disconnect` preserve its sequence counter. Consumer `.accept` uses
the supplied pong and `receipt.receivedAtMs`; ignore `automatic:true` replies.

Automatic five-second keepalive probes use distinct negative IDs and preserve
the existing RTT display. The current Hub already echoes numeric IDs without
interpreting them. Up to sixteen pending probes are retained; twelve-second
expired probes are discarded. Duplicate, unknown, expired and malformed pong
replies cannot update the hook or measured RTT. Probe builders with extra fields
are refused; the sent message contains exactly `t` and `n`. A null return means
no usable probe was established; the consumer discards its pending sample and
rejoins its current clock scope. Respect the Hub's existing inbound rate limit.
This read-only probe is not a mutation retry protocol.

A missing station is a valid strict V1 view with null station/cue/anchor and
`fresh:false`. A malformed, foreign-world or V2-in-V1 wrapper clears the station
and emits a fixed `station.invalid` error without exposing its raw content.
Unknown unrelated message types remain compatible. No V2 rules-era negotiation
is added by these hooks; proposed G006 is a separate checkpoint.

Current checks: **7/7**, including strict/detached public data and private-field
refusal; exact send/receive correlation and wall jump; same-socket/reconnect
invalidation and unreused IDs; bounded/expired probes and bad monotonic clock;
replacement socket closure; automatic RTT; actual local native WorldHost + Hub
station publication and correlated pong through exactly one Connection.
The real isolated Hub uses fake brain bookkeeping, no provider or token, and
closes every owned socket/timer/database on exit. Initial 5/6 failed because its
test stub omitted `inflight`; corrected actual-Hub 1/1 then subsequent changed
receipt-boundary/current-source runs passed. Earlier failure is retained.

App supplies normal `useSim` mounting, sound gesture/mute/volume/route lifetime,
clock/audio consumer proofs and human UI. These producer hooks alone do not
qualify audible phase, a real human session, defaults, G006 or a combined release.

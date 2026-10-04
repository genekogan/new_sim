# Actual flat commons recording — October 4

World can depict a real owned fake-local Soul walking from `[14,0,4]` to
`[9,0,5]` using `apps/server/test/fixtures/dry-commons/flat-commons.v1.json`.
This is a new explicitly flat Greenfield fixture world. Its physical scene has
one level and support surface at y=0, bounds `[-30,-30,30,30]`, no obstacles,
no traversal links and no installed commons content. The standard Eden world,
its genesis, actor roots and existing history are unchanged.

The exact runtime semantics parent is
`2fc2a2df65fa34525985b50a0e19f12a53d9d853`. The producer and test are new;
the native engine, host, fold, database, Hono API and take consumer are unchanged.
The fixture carries the complete selected genesis configuration, stable seed,
world/Soul/body identifiers, actual public scene/captured-scene envelopes and
ten contiguous one-second native take chunks. The recording is 200 ticks,
10 simulation seconds, at dt=0.05. No renderer or model participates.

A fake human user with role `user` and invitation is stored in temporary
SQLite. Its Soul row, canonical birth, Mind, kernel body association and actual
native body agree. A recorded body-language `walk_to` decision drives the native
controller; no pose edit, teleport, replacement actor, compiler result or
successful natural-language interpretation is asserted. The first displacement
is at tick 7. There are 92 frames with native activity `walk`; the exact requested
point is reached at tick 100 and retained through tick 200.

The canonical tick-0 birth already exists in `initialSnapshot`. The first take
publishes this actor at tick 1: playback at tick 0 omits it. The initial test's
assumption that the take contained the body at tick 0 failed (1/2). The final
test preserves that boundary and checks the tick-0 public snapshot separately;
it does not repair or rewrite the recorder. Consumers must explicitly choose
snapshot display or take playback at this edge, without inventing a historical
take frame. At shared chunk boundaries the test selects the next chunk, with
the final endpoint using the last chunk.

A native checkpoint is captured at tick 40 while the body is walking. Restoring
its JSON snapshot produces the same state hash, then every subsequent tick
through 200 matches the original controller. At tick 200 a full host snapshot
and all take/capture pairs are saved, SQLite is closed/reopened, and the host
loads the actual snapshot. Body and kernel hashes match. Independent canonical
log replay from genesis with explicit `includeHeadEvents:true` matches both
hashes without models. This is graceful local close/reopen and native codec
continuation proof; no process kill, power loss or cross-version migration is
claimed. The legacy exclusive-head replay behavior remains unchanged.

After reopen, the actual Hono `/v1/scene`, `/v1/takes?from=0&to=200&limit=120`
and `/v1/scenes/:hash` routes return anonymous 200/no-store publications.
`initialSnapshot`, final `snapshot` and `kernel` are the host's actual public
projection methods, rather than additional HTTP routes. Every take passes the
existing protocol codec, its content address and final-state hash, and resolves
the same captured public scene. Runtime-free sampling at every recorded integer
tick stays within the existing 4.5 mm per-axis position bound, with y=0 and
immutable inputs. Private owner, mandate words and journal markers are absent.
Paid cost, recorded recovery facts and native violations are zero. Temporary DB
files are removed; no TCP/WS listener, browser, provider or service is started.

Final focused checks: 2/2 pass and server TypeScript passes. The initial
TypeScript check caught an invalid test comparison to a nonexistent `fault`
event kind; the generator now counts actual `rules` recovery facts. The final
fixture was generated in one process and exactly reproduced in another test
process. Shared heavy checks used the single resource slot. No unchanged broad
suite, UI smoke or native release gate was rerun for these four fixture/doc files.

The 105,015-byte fixture SHA256 is
`8638750bc425857d7db9afcb8b3e2e74c7f8cc1da4eafd824864733c8092d3a1`.
Its render-scene address is
`811cea9c0116ee77446fb54fbd287552a09336e06b60d018a216f33a379f2e7b`.
Body hash at 200 is
`900d5441c8e9ab183099a06c64911353bceb32f1fc00daa8d25260e254eda8db`;
kernel hash is
`2814fc48e14d4766fdc2c6a1788037a445e9e52df9bb47e3dd89bd5b6da9c53e`.

Next installed-commons input is World's corrected collision/support roots and
arrival/shoreward corridor clearance. Canonical scene registration, actor/body
clearance, usable fixture slots, navigation, rules identity, retained capture
and old-history compatibility must be qualified together before furniture is
usable or routes avoid it. Current native horizontal walking uses the level's
constant y; rendering a terrain mesh cannot grant sloped support. A new physical
scene requires a versioned native scene/config/recovery path; the history guard
can refuse incompatible history but does not migrate it. Existing captures and
old actor roots must remain readable without silently reinterpreting that world.

No dance is published: Greenfield lacks the native music workstation required
by grounded dance, and the generic `perform` step currently lowers to waiting.
Slope walking, water/shore transitions, swimming, boat control, boarding,
passenger occupancy, new anatomy, cue/audio synchronization and World rendering
remain separately qualified milestones. This recording gives World's content
study a truthful inhabitant input; it does not install the kit, qualify its
contacts/materials/performance or authorize main/push/deploy.

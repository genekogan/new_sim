# Continuity fixture and oracle proposal

The four intents in `matrix.json` remain unchanged. `fixtures.json` binds proposed
physical fixtures, actor roles, original errands, starts, real UTC offsets and
disturbances. `oracles.json` declares numeric thresholds and a source-cited
semantic rubric. **No baseline or comparison has run. These artifacts are not
baseline-ready.** Two trials per arm, the same verified model and effort, two
development scenarios, two untouched holdouts and one subsequent >=7200-real-second
soak remain the accepted evaluation design.

The accepted audit calls 2-second receive, 5-second host delivery and 15-second
visible-response values provisional. These files propose those values as explicit
scoring bounds; additional arrival, duration and resumption values are new
precomparison proposals. Seal them after physical/instrumentation preflight and
before the first comparison. Keep this proposal version and every failed trial.
Do not choose thresholds from treatment or holdout behavior. Actual model/effort
must be pinned before either arm; development's advertised `gpt-5.6-sol` is not an
implicit requirement or evidence that a requested different model ran.

Verified source facts:

- Eden Library is at [74,-7], with reading room and a pool of native chair/armchair
  refs. Read-only native discovery resolves `walk:eden-library-1` and
  `read:g-eden-library-1`, with a reading-chair part bound to
  `eden-library-1/library-reading-chair-west-1`. The office-chair is excluded from
  the proposed reading pool because the native spot builder excludes it.
- Eden Bandstand is at [38.5,-26]. Native discovery resolves its walk and a
  supported violin activity at `bandstand-violin-1` [37.6,-25.4]. Probe entity IDs
  are evidence only; rebind stable refs in every fresh world.
- Village Stone Garden is centered at [57,-10]. Its native walk route is
  discovered. The walk holdout preserves agent choice and revision of its endpoint;
  library and bandstand form a sealed physically named candidate pool. No route
  sequence or endpoint coordinate is shown to the agents.
- Mars template operations move Chiba and its furnishings after initial placement.
  The final presenter box is [-14.412,-18.447]; the old cast's [-15.9,-20.6] is stale.
  `templateNames()` preserves first placement and is insufficient for this fixture.
  Filtered ordered-operation slices retain the exact source hashes and final
  selected poses under the scratch evidence directory named in `fixtures.json`.

Remaining blockers:

- Native physical preflight now covers garden routes, Pavilion separation, both
  candidate endpoints, four audience positions and actual violin performance.
  The native performer posture is `busy`; its explicit current activity and
  instrument must establish playing, rather than the open receipt intent.
- The isolated Mars world now seats the presenter and all four original tiers
  simultaneously through their original semantic capabilities after the guarded
  cushion repair and prospective occupied-link routing fix. All 24 seating
  orders also pass native simulation. This proves physical access, not agent
  coordination. Fresh arm setup, visual placement review, exact initial poses
  and public receipt bindings still must be recorded before comparison.
- Verify geometry parity and ref-to-ID/capability bindings for both arms before
  any inference. These JSON files are manifests, not ordinary `playtest.mjs run`
  scenario files; the existing independent-seat harness needs a bounded adapter
  to supply their multi-actor evidence. They deliberately do not add a social
  planner, speaking order or private cross-agent channel.
- One-second current-body samples must use `withKinematics`/authenticated `here`
  or another current source. `snapshotSoul` can fall back to a receipt's old end
  position; that fallback is explicitly rejected by this scorer.
- Instrument native event creation, durable ingestion, actual host delivery and
  first relevant public effect separately. Record all scheduled addressed events,
  failed triggers and unavailable windows. No timeline/model narration substitutes
  for world response/receipt/body evidence.

`oracle.mjs <normalized-evidence.json>` is a read-only executable proposal scorer.
It accepts the `continuity-evidence/1` contract in `oracles.json`, reuses native
seat identity/polygon helpers and emits `pass`, `fail` or `unknown` rows. Exit codes
are 0, 1 and 2 respectively. Missing binding/instrumentation/semantic evidence is
unknown. Complete, independently attested coverage with a missing physical
predicate is a failure. Semantic reviewers must cite world-visible source IDs;
they must not infer successful understanding or completion from private plan text.

For sustained reading and music, a receipt plus a sequence of current matching
body samples using explicit `here.me.actualActivity` spanning >=30 real seconds is required, with <=2-second gaps. Reading
also requires a stable permitted held-seat identity, distinct from the partner's
seat during a common >=30-second window. The receipt's accepted/start time includes
travel and setup and cannot start the duration clock. Audience attendance requires
physical overlap with actual performance. A screenshot at initiation is useful
visual evidence but does not prove the hold duration.

Library arrival is established by current native body position. A native
`read:<place>` may approach, seat and read under one receipt; a separate walk
receipt is unnecessary. Receipt acceptance may precede a phase, while its
actual hold must follow prerequisite completion. A completed navigation receipt
must end after that prerequisite. Phase progression uses the first observed
completion of the required hold, rather than its initiation or the end of an
arbitrarily long maximal observation window.

Every disturbance now has a frozen typed trigger, exact required recipients and
maximum delivery delay in `fixtures.json`. Fixed releases and timer events allow
2 seconds; checkpoint-triggered restart allows 5 seconds; setup seat occupancy
allows 240 seconds, matching setup's wall bound. These are explicit new
precomparison fixture proposals. Source-backed trigger proof binds motion to
current body samples/native journey receipt, the garden errand to three-way
overlap, and restart to a durable checkpoint with at least 20 seconds before its
wake. Occupancy uses a fixture-only body and is retained through trial end.
Model-chosen questions and endpoint revisions remain initial supplements.

Record `scheduledAt` and actual `deliveredAt`, not just action acceptance.
World speech and authenticated owner disturbances require native per-recipient
event IDs linked to the notification enumeration; a successful speech POST is
insufficient evidence that the intended Soul heard it. Missing source proof is
unknown; supplied timing, recipient or trigger contradictions fail. Controller
releases use source-cited initial instruction/release evidence instead of
pretending those instructions were world speech. Restart records original setup,
world/Soul, journal and host-thread identities. Report whether the same Codex
thread resumed or a fresh thread reconstructed from the journal; both are
distinct from an unsupported journal-only recovery claim.

The Mars fixture uses a native seated, world-visible spoken presentation. A
ticketed presentation object is available in source but its creation and placement
are unverified; this fixture does not silently count a scheduled object transition
as a delivered talk. It requires two substantive talk segments, two distinct
questioners with relevant answers and a visible close, judged against native
speech IDs and presenter/audience body facts.

Holdout instructions, endpoint candidates, disturbances, numeric predicates and
rubric are declared here before any holdout transcript inspection. No holdout
transcripts were read in authoring this proposal. A general fix after a holdout
failure requires a newly declared evaluation; the failed trial remains reported.

Scratch provenance and regeneration: run the already-authored
`<team>/scratch/continuity-20261029/fixtures/build-manifests.py` only
when intentionally creating a new declared proposal. It filters template ops and
writes slices/manifests; it performs no world requests, actions or inference.
Native discovery JSON in that directory came from the existing credential-opaque
repository `eden.mjs` with the paired scratch folder as cwd. Credentials were not
printed or copied. No native actions were performed.

Prospective revision `2026-10-29-precomparison-2` supersedes the strict proposal
at Git `6960c41f6`. The JSON transport remains schema `/1`; fixture revision
metadata is included in scorer output. Existing development reports, especially
Eden duo 3 and Mars four 1, retain their original findings. These corrections do
not retroactively turn any old run into acceptance evidence, and no comparison
has been started.

- `read:here` is an explicitly permitted local capability in the reading phase,
  not a wildcard seat-target binding. It requires a finite observation interval,
  complete audited native receipt enumeration, native acceptance timing and an
  activity lifetime covering the hold. Terminal state without a terminal time is
  unknown. A newer accepted action ends the earlier local receipt's usable
  interval; ambiguous same-clock ordering is unknown. The unchanged 30-second
  actual reading, venue, stable permitted exact held-seat and simultaneous
  distinct-seat predicates still apply. A named-seat receipt must match the held
  seat; an explicit chosen native slot cannot be ignored. Native read completion
  and delivered content remain separate evidence for grounded passage claims.
- Fresh agent-origin `explore` can inspect the original errand destination. The
  adapter emits `reads[].origin='agent'` and an optional `inspection` object with
  `kind:'native-local-around'`, native `tick`, `facts`, and exact source `evidence`.
  It derives this only from the successful authenticated local `around` response,
  not the optional `route` query. Source contracts are
  `tools/soul-runtime/world-client.mjs` (`explore` calls `/v1/edge/around`) and
  `apps/server/src/edge/routes.ts` plus `perception/around.ts` (local Soul
  perception is returned independently of route lookup). Request arguments need
  not be recorded to make this distinction. Route-only, remote-view, failed,
  empty-surroundings and observer reads do not qualify. All inspection commands require agent provenance and a request after physical
  return, response before cutoff, and current body evidence bracketing the whole request/response at the destination with gaps
  <=2 seconds. This establishes inspection only; a source-grounded later report
  remains a separate semantic requirement.
- Mars audience supports now include all three authored capacity-one slots on
  each of `navy-sofa` and `navy-sofa-2`, alongside the original free tiers. Stable
  refs are `<entity-ref>#seat-1`, `#seat-2`, and `#seat-3`; each fresh binding must
  retain the shared generated entity ID and its exact slot. Ordered Mars template
  moves and the historical `core-mars-navy-sofa@2` definition establish final
  poses and local slot geometry; these are also recorded in `audienceSofaSource`.
  This includes all six authored slots, not just development-selected seats. The
  9 m venue, 30-second holds, arrival tolerances, occupied first tier and presenter
  support are unchanged. A bare multi-seat furniture ID is missing exact-slot
  evidence, not proof of a collision or permission to invent a slot. Fresh native
  reachability, both-arm geometry and exact-slot preflight remain mandatory.
- Original errands explicitly name `Commons Field` in Eden and `Green field` on
  Mars. They do not ask for an unsupported recalled initial coordinate. The
  physical return predicate stays [0,0] with radius 3 m and current standing body
  evidence, plus completed native navigation and fresh inspection. Encompassing
  place-path ancestry alone does not establish that return. Exact setup still
  needs fresh native verification; the development named-field setup substitution
  is not a passed frozen setup.

Prospective revision `2026-10-29-precomparison-3` separately tightens the reading
appointment clock after revision 2 (Git `23d97248f`). Early arrival and reading
remain permitted, but the required shared 30 real seconds must occur at or after
the declared meeting and no later than the existing cutoff. For a straddling
hold, only its postmeeting portion counts, starting with the first native sample
at/after the meeting; no boundary sample or premeeting time is backfilled.
Venue, held seats, sampling gap, receipt evidence, arrival tolerances and numeric
duration are unchanged. Missing coverage stays unknown. Existing development
reports remain unchanged and are not rescored as acceptance.

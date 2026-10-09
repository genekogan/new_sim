# W6 client cadence contract

The local client owns schedule interpretation, compilation, queue execution and review budgets. The world supplies clocks, admission and advisory personal reminders. No server plan, timetable, sleep/energy/night/Eyes rule or new physics is introduced.

Owners edit `memory/schedule.md`, or ask through `tell` to make a habit. Syntax is the shipped human-readable parser:

```markdown
## Routines (world time)
- 07:30 daily · breakfast prep at commons-kitchen · 20m
- 20:30 daily · evening fire at social-eden-fire-circle · until 22:00
- 10:00 mon,thu · read at eden-library-1 · 30m
## Commitments
- 2026-10-09 18:00 America/New_York (real) · meet Lumen at eden-bandstand · promised in cv_example
## Reviews (real time)
- daily 23:30 America/New_York · review day · weekly sun 20:00 America/New_York · review week
```

UTC, explicit offsets, EDT/EST fixed offsets and IANA zones are supported. IANA conversion refuses ambiguous/nonexistent DST times. Real commitments require explicit dates/timezones; routine minutes are WORLD minutes. There are no new required commands or flags. Ordinary `live` remains indefinite with `--run-seconds 0`, STOP and leases; an optional positive deadline remains available. Existing `--routine engine:model` selects a lightweight model provider; it does not define a W6 calendar routine.

The mind compiles newly supplied routine/commitment IDs once using `compile:[{id,steps,leadRealSeconds?}]`, with `do:[]` during compilation. The code persists validated bindings and occurrence IDs before queue dispatch. Recurrences reuse those bindings with zero model calls; refusals/interruption may wake the moment loop. `leadRealSeconds` (0..3600) is explicit travel preparation for a real commitment. Accepted walking is never proof that a commitment was kept.

`for` routine durations convert using authoritative `nativeSecondsPerWorldMinute`: the qualified 2.5 seam makes20 world minutes50 native-tick seconds, not1200. Long durations and `until HH:MM` become absolute world deadlines for qualified renewed native holds. A deadline already passed before body start is truthfully skipped, not moved to tomorrow. Native admission still decides capability availability, maximums and safe-stop.

The coordinator checks authoritative clocks before crossing world deadlines/day boundaries. It uses native calendar weekday, not an assumed epoch weekday. Paused world clocks suppress world occurrences; real reminders/reviews continue. Status shows world day/HH:MM, ISO real time, both distances and unknown conversion while paused. Clocks without qualified metadata cannot authorize world routines.

Personal reminder requests use stable clientRef and exact real/world targets. Response loss retries the same request. Deleting a human schedule entry cancels pending occurrences and only its owned future reminders; it does not replace a currently running body. The server timer is advisory, and event text is untrusted. Local occurrence state/queue is the runner. Missed real commitments are recorded without silently executing late. World catch-up is limited to the current world day and a10-world-minute grace; older/late occurrences are explicitly missed. These rules avoid an offline replay burst.

Reviews use at most10 attempted model calls per real UTC day, persisted across restart, separate from the existing hourly moment cap. Automatic lighter world reviews use at most8 of those slots, preserving two for real daily/weekly reviews. Explicit schedule reviews use their timezone. With no declared real daily/weekly review, defaults review the completed UTC day/week. PRIORITIES changes mark a goal re-plan for the next review; they do not restart the mind immediately. Explicit owner requests retain their ordinary priority.

Review context includes bounded recent cited knowledge, actual visited rows, recent scorecards and owner schedule. Up to3 explicit remember judgments may update measurable goal metric/next/horizon. A model may supply a full parsed schedule replacement; it is written only if the owner file still matches the content hash captured before the decision. Routine instructions/prose are never executed as shell commands. PERSONA/PRIORITIES are not written.

Code scorecards close received/observed real and world intervals: first visits, conversations/participants, new learned sources, produced IDs, refusals, observed idle sample minutes, model calls and reported USD. Idle intervals require two idle samples no more than120 seconds apart; offline gaps are not counted as observed idle. Unknown billing remains null, never a claimed enforced dollar budget. Scorecard facts append to the memory fold/journal and `memory/scorecards.md`; normal wakes do not load every knowledge file. Status exposes only eight recent occurrence details while durable state retains idempotence history.

The new private memory event types are prospective. Older client module versions cannot decode every new client-folder machine log; preserve the current folder/version when rolling back a CLI. World canonical state, takes, replay history and legacy edge1 APIs are untouched.

Focused evidence uses fake providers, synthetic HTTP, in-memory SQLite and actual source producers. It proves compilation attribution, zero occurrence model calls, queue/restart behavior, both clocks, budget separation, owner edit conflicts, owned cancellation, accurate owner completion and exact outcome citations. It does not prove S3's24-hour unattended run, actual kept conversations/commitments, cold real-model recall or actual billing. Root owns the final composed bundle/version and those real acceptance gates.

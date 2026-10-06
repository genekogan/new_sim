# Local native classroom observation candidate

Engine.observeLocalClassroomV1(observerBodyId) produces the strict
local-classroom-observation/1 schema for a current native human body. Unknown
observers return undefined. An old engine may omit this optional reader.

The reader reports current live classroom phases, locally present participant
body IDs/roles, occupied-seat witnesses, and locally present presenter/floor/
attention actor references. A seat witness requires a live occupied sit action
and the classroom's actual slot claim. Ended historical sessions are omitted.
It reads the current action index, not all retained terminal action history.
There are at most16 sessions and31 participant entries per session.

Scope is explicit: local-distance-only, radius20m in XZ and at most3m vertical
separation. This is not wall occlusion, line of sight or regional knowledge.
Distant participants and role references are removed. Counts refer only to the
remaining local participants. No owner/Soul IDs, instructions, retained purpose,
lesson content, waiting reason, diagnostics, control permissions or agent token
enter this payload. It is public physical metadata, not participation consent or
permission to control another person's body.

The native producer is pure: no ticking, model calls, logging or state changes.
A current nine-body lecture test checks phase/8 actual occupied attendee seats,
another human-owned observer back in the original commons sees no session,
unknown observer returns undefined, engine/kernel/event frontier stays exact,
private extra fields/inconsistent counts/distant role references fail validation,
and the completed lecture disappears. Source types pass after correcting an
initial assumption that Runtime itself exposed the adapter's liveIds method;
the new Runtime.activeIds accessor reads only live/waiting maps.

Consumer status: candidate only. No REST/MCP/Souls.perceive/brain prompt or viewer
activation in this commit. App must approve the scoped-perception field and bind
the observer to the authenticated current owned body before any API exposure;
World must qualify its physical-phase consumer. The caller's world identity is
supplied by its trusted world context, not inferred from a native scene name.
The existing frozen711ea Core runtime input is unchanged. PM owns pairing/release.

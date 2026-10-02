# Guided gallery tour candidate

**Future, unshipped candidate.** This isolated `codex/gallery-tour` worktree starts
from functional source `e035abb38dd95b9fc58d298208db52faf6014ea3` on `codex/creative-afternoon`. It is separate from
the release37/38 work. Only the four new activity/scenario/test/report paths belong
to this candidate; no registry, Lab, hook, renderer, camera, historical values or
shared engine files were changed.

## Experience and physical contract

`gallery_tour` coordinates two or three declared stops. Each stop binds an actual
marked drawing pad supported by its actual ground-supported table, the same host
and two initially participating visitors, with at most one additional declared
optional visitor. The hypothetical scenario has three explicitly pre-made gallery
studies, four anonymous people, existing drawing-pad/pencil/table definitions and
flat ground. It does not claim historical provenance or dynamically create marks.

Each stop uses registered `art_sharing`; its ordinary `take_slot` children own
arrival, heading, planted posture, floor changes and shared attention. The tour
keeps the same artwork IDs and detached completed per-stop discussion history.
After a circle finishes and releases its holds, registered ordinary `walk_to`
children move active participants to declared departure points. Every departure,
including a visitor's Leave, must finish before the next artwork is rebound.
The coordinator never writes actor poses or support and never introduces a second
movement path.

Tour Pause releases physical sharing children while retaining the exact circle
clock/effects. Resume uses the same circle or continues interrupted departures;
Pause at the completed-stop boundary acknowledges its history once. End cancels
owned physical work and releases claims; its `finished:false` remains distinct
from a successfully completed tour. A host directive pauses for explicit Resume.
A visitor directive withdraws that member persistently. A visitor directed while
already paused is withdrawn at its actual position before resumed holds can
reclaim it. The owner may explicitly rejoin only declared visitors.

## Bounded availability and admission

The existing `art_sharing` minimum remains intact: **each new stop needs the host
and two active visitors**. If Leave/direction reduces that audience, the next stop
waits with `gallery_tour.insufficient-audience`. A declared optional visitor must
explicitly Join, or the owner may End. A withdrawn person is never reactivated
silently. There is no automatic skip.

Missing/unavailable artwork, occupied viewing places and admission geometry are
preflighted through actual sharing admission before submission. The tour retains
a named `gallery_tour.stop-unavailable` diagnostic with the original concrete
cause and subjects. Binding retries once per simulated second, at most 20 attempts
by default (definition range 1–60), then waits for explicit Resume/Join/End.
Preflight waits create no failed child-record spam and preempt no occupants.
Stopped/blocked departures retain named diagnostics and require explicit Resume;
they do not silently advance to another stop.

## APIs for later root wiring

- `GALLERY_TOUR_ACTIONS`: `gallery_tour` and `gallery_tour_control`; local scenario
  runtime registers these with `createRegistry(extra)`.
- `GalleryTourParams`: bounded `stops`, each with actual `sharing` bindings and one
  declared physical departure point per person; optional `retryLimit`.
- `gallery_tour_control`: `{tour,intent}` with existing sharing intents
  Pause/Resume/End, Ask/Answer/Floor, declared Join, and Leave with destination.
  Resume preflights an active paused circle; speaking controls delegate actual
  participant eligibility, floor/queue and question/answer admission.
- `readGalleryTour(rt,id)`: detached actual status/mode/index/pad, persistent
  membership, completed history, current sharing readout (actual artifact,
  attention/floor/role states/effects), owned actions, departures, exact retry
  count/limit/next tick/automatic flag, diagnostic and finished flag.
- `galleryTourWorld/Scene/Binding/Runtime`: hypothetical pre-made fixtures only.

## Validation and limits

Focused gallery 13 + inherited sharing/source-scanner 16 checks: **29/29 PASS**,
about 1.2 seconds. Coverage includes both two- and three-stop definitions, stable
artifacts, deterministic replay, current physical roles/attention, retained linked
question/answer, explicit Pause/Resume/End, completed-stop/departure interruption,
Leave→named wait→late Join, occupied/missing/unavailable artwork with no child spam,
host/visitor directives including a visitor directed while paused, detached
readouts, malformed definition and undeclared participant refusal. Normal fixed
steps assert zero runtime violations and continuous supported-pad admission;
missing/unavailable tests preserve valid physical geometry while refusing use.
Final checks cover all owned records, actor/slot/artifact and tour/group claims.

Viewer TypeScript and focused type-aware lint pass. No browsers, performance,
full release gate or public proof were run for this candidate. There is no UI,
camera wiring, inspected visual proof, active save/load, rig change, arbitrary
terrain or universally flexible audience model. Root review/wiring and serialized
actual Play proof remain required before integration as a shipped capability.
Focused test log: `/tmp/gallery-tour-focused.log` (local, not committed).

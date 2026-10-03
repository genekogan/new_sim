# Seated reading — bounded candidate, not released

Source branch `codex/seated-reading`; root-only work, 2026-10-01.
Scope and original constraints: [PLAN](seated-reading.PLAN.md).

A real supported book, grounded table and compatible chair bind to `read_book`.
Ordinary sit/walk owns physical approach, seated hold and stand-up. Reading advances
four compressed sections and records the same reader/task/total duration bookmark;
interruption, player direction and quiescent JSON restoration retain that purpose.
Book identity, pose and table support remain unchanged. Independent readers share
table support while exclusively owning their own actor, chair and book.

The snapshot unsafe-drop guard now recognizes active equipment owned by the exact
refused action, rather than only workstation state. Computer coverage remains
unchanged; reading also refuses an ownerless active snapshot. Active reading reload
is unsupported. Safe stop plus explicit same-task resume is supported and tested.

## Focused validation

- Reading10/10 and existing computer snapshot3/3 pass; deterministic source scan
  passes. Combined reading/computer/social/runtime persistence31/31 passes.
- Whole lint and viewer TypeScript pass. No assertion/tolerance/baseline changes.
- Actual UI Play first run1/1PASS34.3s; enhanced actual Reset/first-Step,
  interruption, resume, completion and final Reset run1/1PASS33.8s.
- Root inspected all six capture frames, including seated section2, ordinary
  stand-up with retained bookmark and completion with the original book/support.
  Latest captures: `viewer/e2e/artifacts/seated-reading-reset-20261001/`.
- Browser source cache is frozen to release28 exact SHA/bytes, independent of
  ongoing historical exports. Proof: ignored `.cloudflare/frozen-browser-cache.json`.

Missing/unavailable equipment, occupied or incompatible chairs, moved book,
foreign player direction, pre-arrival cancellation, wrong resume identity/duration
and deterministic repetition have focused coverage. Two orientations and two
independent readers at one table use the same capability and execution.

## Limits and release status

This is a hypothetical small quiet-reading arrangement, not a historical book,
participant or room reconstruction. No held-book reading, access-link traversal,
finger/page grasp, new IK, rig/library migration or universal seated-task framework.
Current seated hands retain their existing rest pose; bounded gaze, visible book,
secondary leaf and bookmark communicate the activity. Unsupported bindings refuse
with named diagnostics rather than silently substitute or discard progress.

Full clean combined gate passed on exact09da6a0:206unit,903engine PASS/0FAIL/6skip/11TODO,151browser PASS/0FAIL/7skip, bothTSc/lint/take/unchangedb746probe/all36localMCP. Original idle performance ceilings and pins pass. Guarded main integration preserves all89 owner-pending paths. Release29 was deployed4fc6d1d6 at11:03:29.172043Z; published3/3actualPlay checks pass51.6s: fresh Reset/Step, section2, safe interruption/stand-up and same-book24scompletion, plus retained4/8work-food-return journeys. Root inspected all11publicPNGs/contactsheet.500assets19routes642requests, FIRST36MCP/isolation/auth and FIRSTdirector9steps pass. Safe131eventtailallok is sampled evidence only. PublicURL: https://mars-campus-2026.<workers-subdomain>.workers.dev/lab?scenario=quiet-reading . The next breadth remains
bounded chess, music, meal preparation and supported sleep; this reading milestone
must not expand into anatomy or a universal activity language.

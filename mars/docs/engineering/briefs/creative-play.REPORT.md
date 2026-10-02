> Parent verification update2026-10-02: actualPlay on61b236e passes all6
> combined sharing/creative/cleanup cases in2.0min; all30PNG and matching JSON/a11y
> inspected by helper, root personally inspects13representative images. No major
> support/continuity/clipping failure; sparse gestures/finefingers/off-frame events
> remain explicit. Read-only End label fix11cb5d6 passes stricter3/3Play recheck26.6s;
> root inspects all3new early-End readouts. Full combinedgate/publication pending.
> Music history readout inconsistency is being repaired separately before freeze.
> The original authoring-only statements below are dated provenance, superseded
> by this parent execution receipt, not claims of current missing evidence.

# Creative vocabulary Play regression authoring

Status: authored, **not browser-executed or visually verified**. Browser/performance
execution is reserved for the root release37 gate. This deliverable changes only
this report and `viewer/e2e/creative-vocabulary.spec.ts`.

## Source and scope

The isolated `codex/creative-play-proof` worktree inherits clean functional source
`6e9d6becbaa783cdf858941da496b1f88c67967f` from `codex/creative-afternoon`.
No engine, HUD, hook, scenario, shared config, dependencies or historical values
were changed. The authoring reads the actual art-sharing and creative-afternoon
HUD controls and detached hook interfaces.

Two tests use ordinary **Play** execution. Global Pause freezes capture and
intervention boundaries; Step is used only for fresh Reset/first-tick checks.
No programmatic runtime ticking, actor movement or fabricated artwork is used.
The existing 120-second test timeout, one worker and original physical assertions
remain unchanged. Actual journey timing remains unmeasured pending the serialized
browser slot.

## Authored acceptance

- Standalone sharing identifies its hypothetical pre-made artwork, retains the
  actual pad/pencil and eight marks, waits for physical arrivals, checks current
  rig talk/listen pose, planted soles and real attention, admits and physically
  releases a late visitor, records question/answer linkage and explicit floor,
  pauses without advancing discussion effects, resumes the same session and
  explicitly Ends with coherent resource cleanup. Reset then first Step checks
  tick1 and absence of the session.
- Connected afternoon begins with a blank pad and draws actual partial marks.
  Player direction pauses the artist while an independent reader Pause retains
  book progress. Finite garden care completes while those two purposes remain
  paused. Explicit Resume retains the partial artwork and the original drawing
  slice, producing exactly60ticks/three marks for sharing. The same workstation
  and chair host two actual seven-second scores, then the same pad and pencil
  finish160ticks/eight marks. Reader/book and finite plant/water effects finish
  independently. Final assertions check object identity/support, terminal
  records, empty claims/held tools/tasks/hand drivers, no entity replacement and
  Reset/first-Step readiness.
- Every captured checkpoint checks violations. Page and console errors are
  collected and must remain empty. Images and accessibility snapshots accompany
  actual hook JSON; these are evidence outputs, not a claim that rendered marks
  have already been inspected.

## Evidence and execution handoff

At execution time the spec obtains `git rev-parse HEAD`, writes that exact source
into every JSON receipt, and uses `e2e/artifacts/$E2E_RUN`. It writes six planned
standalone captures and eight planned connected captures, each with PNG,
accessibility YAML and detached state JSON, plus per-case proof/result JSON.
Failures retain a frozen capture and Playwright's existing failure trace. Preserve
failed-first outputs when diagnosing; redirect runner stdout/stderr to the run's
log and personally inspect every actual image before marking browser proof green.

Run only after an explicit source freeze and browser-slot grant, from `viewer/`
with fresh run id and assigned unused Vite/simulation ports:

```sh
E2E_VITE_PORT=<assigned> MARS_SIMULATION_PORT=<assigned> E2E_RUN=<fresh-source-run> \
  npm run e2e -- creative-vocabulary.spec.ts --workers=1
```

Before that run, bring forward the frozen root functional source, preserve the
spec assertions, symlink the existing `.pw-browsers`, and copy its frozen
`public/browser/campus.glb` and `.br` assets rather than installing dependencies.
If the connected journey exceeds120seconds, measure and diagnose the actual run
before proposing a dedicated case timeout. Any engine/API issue belongs to root;
this worktree must not repair shared source or soften assertions to hide it.

## Fast validation

- Viewer TypeScript typecheck: PASS.
- Focused spec oxlint including type-aware checks: PASS.
- Spec formatting and whitespace diff checks: PASS.
- Browser/performance/full gate: intentionally not run; no captures exist yet.

Limits: timing windows, enabled controls, actual visual mark visibility, discussion
turn scheduling and final cleanup are authored expectations until actual Play
runs and personally inspected captures establish them. No active save/load or new
rig behavior is claimed.

## Authored timing correction

Root's compact Node timing measurement found the original simultaneous predicate
at tick 128: drawing 22 ticks and reader 3.8 seconds, with the reader slice ending at
4 seconds. The overlap was only 0.2 simulated seconds (about 50 ms at 4x Play), so it
was too fragile for browser polling. This is measured engine ordering supplied
by root, not a browser run in this worktree.

The connected test now first waits during actual Play for reader progress in
[1, 2) seconds, globally pauses, requests the HUD's Pause reader, then Plays until
that independent commitment is safely paused and drawing lies in the original
[22, 50) tick range. It captures this retained partial state before directing the
artist away; the redundant second reader Pause is removed. Exact subsequent
book/drawing retention comparisons, independent gardener completion, all later
physical/effect assertions and the 120-second timeout are preserved. This changes
only test orchestration. Browser verification remains pending the reserved slot.

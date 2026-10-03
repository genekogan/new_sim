# Presentation Aerial handoff — 2026-10-01

Source candidate based on `ce1c8af`, branch `codex/presentation-handoff`.
Not integrated, browser-verified, or released.

The alumni Aerial button now explicitly requests the existing `view('campus')`
runtime handoff. This clears rider following, stops walking and focuses the campus.
Previously it only toggled walking when walking was active; EUC follow leaves that
flag false, so Aerial did nothing. The dedicated callback also works from WASD.
No runtime camera policy, rig, world state or engine changes are involved.
Existing year, WASD, room, time and EUC contracts remain intact.

The existing live presentation journey gains a regression after its original EUC
follow/night checks: observe an actual rider position while WASD is inactive, click
Aerial, require free camera mode and cleared rider position. Original assertions,
captures and timeouts are retained.

Source validation passes: viewer TypeScript, focused oxlint on both controls/page
and presentation spec, existing presentation route source tests (3/3), diff check,
and an esbuild/component-stub smoke exercising Aerial in both walking states and
the retained WASD guard. Dependencies are reused via an ignored node_modules
symlink to the primary checkout. No Playwright, GPU, build or full gate was run;
the browser slot is reserved by the owner. Required next validation: run the
presentation spec after the owner releases that slot, inspect the actual handoff,
then combined candidate gate before main integration/publication.

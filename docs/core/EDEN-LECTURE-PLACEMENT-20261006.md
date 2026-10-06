# Native lecture placement input for connected Eden

edenLectureV1 accepts one selected origin/yaw,16/20/24 audience seats and bounded
local lesson text. It produces exact native camp-chair seat IDs, a separate
presenter return seat, speaker-lectern standing station, standing-display content,
venue polygon and aisle/entrance points. Fixtures are seeded design additions,
not invented construction history. No people, poses, attendance or native claims
are created by this generator.

Native-slot checks cover all three capacities and two orientations. Audience
chairs face the screen (-localz); lectern standing station faces the audience
(+localz). IDs fit the existing80-character classroom bound. Fixture root support
is level0/y0; actual placement still needs the selected world's floor, collision,
clearance/path and existing-resource preservation checks. This is an executable
input for World assembly, not proof that twenty people can already attend.

World selects ONE placement in its broad connected layout. Its required binding
seam is team/CONTRACTS/CORE-EDEN-LECTURE-PLACEMENT-20261006.md. Core will record the
additive native venue and actual nine-owned-body session after placement/support
freeze. The existing controller can demonstrate one standing presenter plus one
seated host and seven seated audience members: eight seated attendees in nine
body identities. Furniture alone is not attendance. Initial-audience schema cap
and active-coordinator snapshot refusal remain explicit qualification work.

First test failed because zod was imported from a package without that dependency;
schema moved to existing engine-contract dependency, with named exports only.
Native fixtureSlots now evaluate against a real Runtime/Spatial fixture; no
package dependency/lock or World renderer changes. Focused source test/types pass.
This does not replace the stable6254 consumer freeze or alter current4970. PM
controls current-copy compatibility and operational integration under Gene's
latest delegated custody; trunks retain their owned code boundaries.

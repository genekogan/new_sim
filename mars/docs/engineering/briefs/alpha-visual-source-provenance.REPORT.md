# Stale canvas baseline source provenance — 2026-10-02

Read-only comparison: frozen candidate `f7f468a` versus verified40 functional
`05370e8`. No candidate/baseline edits, browser/build/TypeScript/performance tests
or replacement-image acceptance. No f7 physical-law/action/rig change was found
that newly alters these named scenes. Byte identity is source provenance, not a
claim that old/new captures are equal or every original assertion passes.

| Baseline / old source | Already-shipped provenance and f7 comparison |
| --- | --- |
| `lab-narrow-passage-mid-top-debug`, `lab-stairs-mid-oblique`: last updated `721f97b` | Walk/path code and proving-ground scene are byte-identical40→f7. Many shipped changes postdate these baselines: `3d11125` live stair links, `275adba` supported cancelled stairs, `6e70422` make-way commitments, `668f7f3` bounded sleep/movement. Human/rig pose source is also unchanged40→f7. |
| `meal-spoon-at-mouth`: `84f22e9`; `meal-legs-crossed`: `0d0158e` | Meal world, humans, rig, posture and item renderers are byte-identical40→f7. Older crossed baseline predates body-model `84f22e9`; further shipped item/pose changes include `68b2214`, `4e955c8`, `6280e41`, `caed682`, `a711aaf`. This bounds the bowl/knee difference to older history or timing; it does not isolate one causal commit for every pixel. |
| `lab-year-{2021,2022,2024}-top-prisms`: `879c88a` | Campus JSON changed before40, including obstacles/assemblies/labels/regions/content hashes; 2021 also bounds. Museum integration `47d6503` and occupied-campus reconciliation `75b3adc` are source provenance. Each campus JSON is exactly equal40→f7, as are year-walkabout and debug/agent overlays. |
| `build-bay-raise-oblique`: `c7ca121` | Green frame palette `f4af2ed` is already in40 (`#2c4629`); palette/build-bay factory/raise/carry/rig code is unchanged40→f7. Prior report documents inspected blue→green image and tick2979→2993; older raise/carry changes postdate the baseline. No new alpha execution defect was established. |

Git blob identity40→f7, short object ids: walk `c2e62352ffdf`, path `1da36c801ded`,
humans `74da49fcda1a`, rig `bb4a244df505`, posture `ea61053111e8`, items
`c969c3a8550e`, meal world `70b596300eb5`, debug overlay `5545a4c8d355`, agent
overlay `01c49155054c`, year-walkabout `a5c533b9d019`, proving-ground
`840165757925`, palette `126e4385384f`. Verified via Git object reads, not execution.

Relevant f7 differences remain explicit: sim driver continues valid-world ticks
after authored terminal windows, quarantines faults and freezes scriptResult;
SequenceRunner adds violation guards. Capture tests use paused runs and fixed
stepping, but continued-clock behavior can affect captures after terminal state
unless Pause is explicit. Renderer component reset/fixture/paint/year-view edits
change disposal/lifetime (including LineSegments disposal), not campus geometry
or authored poses. Source reading cannot rule out a resource-lifetime defect;
original browser assertions and inspected captures remain required at root's slot.

Narrow/stairs mid-captures are fractions of measured end tick, not immutable ticks;
meal captures target eat/crossed phases, not one fixed pose tick. A stale image's
HUD tick difference alone therefore cannot establish a new deterministic defect.
Keep original deterministic replay/end-tick, geometry/support/reach/ownership and
console assertions; root's reported fire/social canvas diff0 is context, not a
measurement performed here. No thresholds, masks or comparisons should change.

Only report added in the isolated extension-contract worktree. Read original
lab/meal/year/build-bay specs, baseline history, named source blobs and40→f7 diff;
`git diff --check` PASS. Final golden review/native gate/public acceptance pending.

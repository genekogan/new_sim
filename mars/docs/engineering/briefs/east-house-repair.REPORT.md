# East-house live build repair

## 2026-09-30 investigation (in progress)

The current reconciled 2022 east-house whole skeleton is unsupported by the
existing straight-axis beam staging rule: nine beams have neither staging end
clear. The first bay has three such beams. This is a physical geometry refusal,
not a pin-only mismatch. No historical content, tolerances or pins were changed.

Branch `codex/east-house-repair`, base `9b2cc834de0ccd0012e12ce659f4aab85e0ee38a`.

### Cause

`campus/sequence.ts`'s `hang()` emits installer climbs before `stage()` knows
whether either staging plot is free. `stage()` emits a material take before it
checks that geometry. On refusal it returns null without a hang or descent.
The current public source emits s0018/s0019 climbs for the refused middle beam
`east-house-12-foot-orange-beam-6b514974`; the next supported beam emits
s0021/s0022 climbs on the other column, depending only on those earlier climbs.
The first installer is still on the earlier stance, so `climb_stance` correctly
refuses `stance.not-on-ground`. The ordinary descent mechanism already exists:
`leave_stance` physically follows the reversed climb path and optionally walks
clear. It was omitted because the beam staging refusal returned early.

The rejected staging axes at x=5.857 have line-0 end z=-8.644 blocked by
`chiba-12-foot-orange-beam-0684c6e5` and far end z=8.987 blocked by
`kitchen-12-foot-orange-beam-11ad38b2`. The existing reconciliation document
explicitly records these nine unstaged beams and parked reconstruction work.
Making all of them install requires new staging choreography rather than
removing collision checks or simply restoring the old expected hashes.

### Coverage exclusion audit

`viewer/e2e/year-build.spec.ts` applies unconditional `test.fixme(true,
W51_FIXME)` to both first-bay and whole-house tests. `YEAR_BUILD_FULL=1` only
removes the subsequent whole-house skip; it cannot remove the earlier fixme.
The historical completion/pixel assertions therefore do not certify the
current public Lab scenario. Node year-build tests keep old pins under TODO;
the old pins remain valuable historical evidence and must not be repinned to
certify a partial current-scene plan.

Exact historical source dependency: commit
`a0c347e0374b473876c97f536dc44dba42399521` (parent of W51 `d2aafe3`),
path `viewer/public/engine/campus-2022.json`, Git blob
`d19c5c347206a08ade304a4e299516bf3398dfdf`, SHA-256
`205d20234f72a5a05da8252262b9b57488080c70727c20a00b6daf08162d6d93`,
contentHash `8b88e6f090c79b92784954787f0329295286d5b6f5e76f0d9d450023da8c49f2`.
Completion on that source would be historical validation only, not current
production support. Current production needs an explicit unsupported label.

### Validation so far

Read-only Node setup inspection of the exact current public JSON produced the
above sequence and all nine concrete exclusions. Heavy runtime tests and browser
work are waiting for the parent agent's coordinated validation slot. No commits,
captures or baseline changes yet. The proposed bounded change is staging
preflight before any take or climb, preserving plans on fully supported source.
Minimal `campus/sequence.ts` ownership is awaiting parent agreement.

### Implementation and original runtime reproduction

Parent approved minimal `campus/sequence.ts` ownership and atomic staging
preflight. Geometry and available material are checked before emitting any take
or climb. Every supported climb retains its ordinary `leave_stance` descent;
no actor position, support, admission check or physical clearance was overridden.

Read-only legacy plan comparison against original `main` confirms identical
complete plan JSON: first bay 198 steps / planHash `c70cb7ad61873b7575d1141d`,
whole house 552 steps / planHash `84d7d437b5edb5748ca22f5f`. New focused tests
passed (2 pass, 1 historical runtime skip).

Exact original Node execution (original main sequence implementation, current
worker public source, ordinary Runtime + SequenceRunner advance/tick loop) failed
s0021 at tick **2815**. s0018 completed that same tick; m4 stood at
[6.6138, 0.91, -4.9554], level0, on
`stance:east-house-frame-9172e067:l:f@0.91`, activity `stance`. The upright was
`placed`, supported `held` by m3. No invariant violations occurred. This explains
why checking level0 alone would be an invalid admission bypass: a low stance
is among ground-level people, yet still needs ordinary descent.

`yearBuildSupportDiagnostic()` exposes all required missing skeleton parts with
code `year-build.unsupported` and complete concrete refusal reasons; only
intentional outside-tranche exclusions are exempt. The parent owns production
Lab labeling/admission and integrated browser validation. Current whole-house
support requires an off-axis staging/delivery rule: neither existing aisle end
has room for the beam plus 0.6m at each end and 0.7m on each side for crew.

### Validation checkpoint

- `node --test engine/test/year-build-stance-repair.test.ts`: initial plan audits
  2 pass, historical runtime initially skipped.
- `YEAR_BUILD_HISTORICAL=1 node --test engine/test/year-build-stance-repair.test.ts`:
  3 pass, 0 fail, 0 skip, 54.15s wall; whole rehearsal 50.62s. The runtime test
  is now **mandatory with no environment skip** (same code/assertions).
- `npx tsc --noEmit -p .`: clean before adding the root-contract browser tests;
  final focused typecheck will follow.
- Existing historical **117277 ticks / d382e461…0617** passed unchanged. All
  66 parts matched canonical geometry within existing 1cm/1° tolerances; zero
  violations, settled state, all crew on ground and without grips.
- Current mandatory coverage names every physical refusal and prevents acquiring
  its beam; projected stance choreography has ordinary descent before each next
  climb. This is not a claim that the remaining partial current plan can complete:
  incomplete bracing still cannot release its held frames safely.
- The parent authorized a focused green commit before its combined full engine
  suite/gate; this worker did not run the full engine suite or release gate.
- Browser assertions are prepared for the agreed root-owned `yearBuild().admission`
  contract: both selectable presets disclose unsupported, emit zero actions,
  leave physical poses unchanged and retain zero invariant violations. Browser
  execution is awaiting root integration/slot; no captures or goldens changed.

The nine rejected beam suffixes are `02eaafd3`, `0e197289`, `38352bc2`,
`61fa7a83`, `6b514974`, `91b67b6d`, `94aa4849`, `b5bf3cc8`, `cae496c2`, all
under `east-house-12-foot-orange-beam-`. Each names the same blocked line-0 and
far-end plots and Chiba/kitchen dependency described above.

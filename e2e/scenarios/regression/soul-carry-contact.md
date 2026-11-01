---
id: soul-carry-contact
tier: regression
fixture: soul-actions-carry
mocks: []
critical_path: true
---
# Carrying: continuous reach, crouch and release

Follow-up to the functional pass in visual-03: dense frame review found a .697m palm jump and .466m hip jump on grasp/release. Changed native reach/release timeline. Fresh isolated world, same full-client journey; verify the newly identified motion regression before acceptance. Never rerun for reassurance.

## Steps
1. Carry crate to crate-landing through ordinary CLI and inspect the complete reach/lift/carry/lower/release.
   - expect: completed receipt, visible lift, hands move continuously into/out of contact; hip/palm discontinuity below .25m per50ms across contact boundaries
   - screenshot: crate.png
2. Carry flowerpot to flower-landing through the same faculty and inspect all phases.
   - expect: same native faculty, upright load; no snap at reach/release; saved location agrees
   - screenshot: flowerpot.png
3. Wave after release.
   - expect: completed unrelated action, no browser errors
   - screenshot: final.png

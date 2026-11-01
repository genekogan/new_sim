---
id: soul-two-hand-carry
tier: regression
fixture: soul-actions-carry
mocks: []
critical_path: true
---
# Upright two-hand transport

Owned isolated world on7857, ordinary paired CLI, actual full client. Native assertions include access, load limits, cancellation, context bounds and saved placement. No live model needed for visual proof; separate controller journey checks discovery.

## Steps
1. Open fixture viewer and observe ordinary Soul.
   - expect: actual native Soul and two loads visible
   - screenshot: initial.png
2. Use ordinary CLI: act "carry crate" with params {"to":"crate-landing"}.
   - expect: completed receipt, two hands and native load follow continuously, upright at lift/travel/lowering, actual saved destination
   - screenshot: crate.png
3. Use ordinary CLI: act "carry flowerpot" with params {"to":"flower-landing"}.
   - expect: completed receipt, same two-hand mechanism, upright plant, actual saved destination
   - screenshot: flowerpot.png
4. Wave and inspect final world.
   - expect: completed unrelated wave, hands free, no browser errors
   - screenshot: final.png

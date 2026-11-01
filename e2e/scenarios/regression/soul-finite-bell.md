---
id: soul-finite-bell
tier: regression
fixture: owned-finite-bell
mocks: [fake-brain, dev-auth]
---
# One finite physical bell pull

1. Open owned7865 full client, inspect initial UI, use the music control to unlock audio and turn music off.
   - expect: no bell ringing merely from loading
   - screenshot: initial
2. Ring village-bell twice and the rotated garden-bell once through ordinary paired Soul CLI.
   - expect: three receipts completed; rings counts2 and1, no ongoing playing state
   - expect: hand grasps, moves with the fixed-length rope, releases gradually, feet stay grounded
   - expect: each count change waits for the completed pull; no arm snap; real browser audio contains the peals and scheduling follows the depicted completed pull within0.3s
   - screenshot: each full interaction
3. Wave and speak through a finite ordinary controller turn; restart the owned server and reload.
   - expect: ordinary faculties usable; counts persist; no automatic replay ring on reconnect
   - expect-console: no errors
